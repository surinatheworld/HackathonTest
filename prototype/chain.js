// Wallet + contract layer for Nông Trại DeFi on Fuji C-Chain. Exposes window.FarmChain.
// Gasless: every action is an EIP-712 ForwardRequest signed by the player and submitted by the fee
// manager (/api/relay) through FarmForwarder. Wallets: an in-game wallet (key kept in this browser,
// testnet only) or MetaMask/Core. Needs ethers v6 (UMD) and window.FARM_CONFIG from chain-config.js.
(() => {
  const cfg = window.FARM_CONFIG;
  const E = window.ethers;
  const ABI = {
    usdc: [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function faucet()",
    ],
    game: [
      "function deposit(uint256)",
      "function withdraw(uint256)",
      "function claim() returns (uint256)",
      "function pendingYield(address) view returns (uint256)",
      "function lends(address) view returns (uint256 principal, uint256 accrued, uint64 last)",
      "function rewardReserve() view returns (uint256)",
      "function plant(uint8 tier, uint256 amount) returns (uint256)",
      "function harvest(uint256 cropId)",
      "function uproot(uint256 cropId)",
      "function water(uint256 cropId)",
      "function collect()",
      "function steal(address victim)",
      "function setGuard(bool guarded)",
      "function today() view returns (uint64)",
      "function cropsOf(address) view returns (uint256[] ids, tuple(address owner, uint8 tier, uint8 status, uint64 plantedAt, uint64 lastWateredDay, uint256 amount, uint256 payout)[] list)",
      "function farmers(address) view returns (uint256 points, uint256 ripePoints, uint32 streak, uint64 lastWaterDay, uint64 lastStealDay, bool guarded, uint16 activeCrops)",
    ],
    forwarder: ["function nonces(address) view returns (uint256)"],
  };
  const STATUS = ["None", "Growing", "Harvested", "Uprooted"];
  const TYPES = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };
  const GAS = { plant: 300_000, harvest: 250_000, uproot: 200_000, water: 120_000, small: 120_000, lend: 250_000, usdc: 120_000 };
  const KEY = "farm-wallet-v1";
  const U = (v) => E.parseUnits(String(v), 6);
  const toNum = (v) => Number(E.formatUnits(v, 6));

  const CH = { available: false, live: false, account: null, data: null, busy: null, reason: "", cfg, STATUS, hasL1: true, walletKind: null, gasless: null };
  const listeners = [];
  CH.on = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((f) => { try { f(CH); } catch (e) { console.error(e); } });

  if (!cfg || !cfg.cchain?.game) CH.reason = "Chưa có địa chỉ contract (prototype/chain-config.js).";
  else if (!E) CH.reason = "Không tải được thư viện ethers.js.";
  else CH.available = true;
  CH.hasMetaMask = !!window.ethereum;
  window.FarmChain = CH;
  if (!CH.available) return;

  const c = cfg.cchain;
  const rp = new E.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true });
  const usdcR = new E.Contract(c.usdc, ABI.usdc, rp);
  const gameR = new E.Contract(c.game, ABI.game, rp);
  const fwdR = new E.Contract(c.forwarder, ABI.forwarder, rp);
  const usdcI = new E.Interface(ABI.usdc);
  const gameI = new E.Interface(ABI.game);
  const domain = { name: "NongTraiDeFi", version: "1", chainId: c.chainId, verifyingContract: c.forwarder };
  const relayUrl = cfg.relayUrl || "/api/relay";
  let signer = null;

  // ---------- fee manager status ----------
  CH.checkRelay = async () => {
    try {
      const r = await fetch(relayUrl, { cache: "no-store" });
      const j = await r.json();
      CH.gasless = !!j.ready;
      CH.relayInfo = j;
    } catch {
      CH.gasless = false;
    }
    emit();
    return CH.gasless;
  };

  // ---------- wallets ----------
  function loadGameWallet() {
    let pk = null;
    try { pk = localStorage.getItem(KEY); } catch {}
    if (!pk) {
      pk = E.Wallet.createRandom().privateKey;
      try { localStorage.setItem(KEY, pk); } catch {}
    }
    return new E.Wallet(pk, rp);
  }
  CH.hasSavedGameWallet = () => { try { return !!localStorage.getItem(KEY); } catch { return false; } };
  CH.exportKey = () => (CH.walletKind === "game" ? signer.privateKey : null);
  CH.importKey = (pk) => {
    const w = new E.Wallet(pk.trim());
    try { localStorage.setItem(KEY, w.privateKey); } catch {}
    return w.address;
  };

  async function switchToFuji() {
    const chainId = "0x" + c.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (e) {
      if (e.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(e.message || "")) throw e;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId, chainName: c.name, rpcUrls: [c.rpc], nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 }, blockExplorerUrls: c.explorer ? [c.explorer] : undefined }],
      });
    }
  }

  CH.connect = async (kind = "game") => {
    if (kind === "metamask") {
      if (!window.ethereum) throw new Error("Không thấy MetaMask/Core. Dùng Ví trong game cho nhanh.");
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await switchToFuji();
      signer = await new E.BrowserProvider(window.ethereum).getSigner();
      window.ethereum.on?.("accountsChanged", async (a) => {
        if (!a[0]) return CH.disconnect();
        signer = await new E.BrowserProvider(window.ethereum).getSigner();
        CH.account = await signer.getAddress();
        CH.refresh().catch(() => {});
      });
    } else {
      signer = loadGameWallet();
    }
    CH.walletKind = kind;
    CH.account = E.getAddress(await signer.getAddress());
    CH.live = true;
    await Promise.all([CH.refresh(), CH.checkRelay()]);
    clearInterval(CH._timer);
    CH._timer = setInterval(() => CH.refresh().catch(() => {}), 6000);
    return CH.account;
  };

  CH.disconnect = () => {
    clearInterval(CH._timer);
    signer = null;
    CH.live = false;
    CH.account = null;
    CH.data = null;
    CH.walletKind = null;
    emit();
  };

  CH.refresh = async () => {
    if (!CH.live || !CH.account) { emit(); return; }
    const a = CH.account;
    const [usdc, avax, lend, pending, reserve, crops, farmer, today] = await Promise.all([
      usdcR.balanceOf(a), rp.getBalance(a), gameR.lends(a), gameR.pendingYield(a), gameR.rewardReserve(),
      gameR.cropsOf(a), gameR.farmers(a), gameR.today(),
    ]);
    CH.data = {
      usdc: toNum(usdc),
      avax: Number(E.formatEther(avax)),
      lendPrincipal: toNum(lend.principal),
      lendPending: toNum(pending),
      reserve: toNum(reserve),
      today: Number(today),
      farmer: { points: Number(farmer.points), ripePoints: Number(farmer.ripePoints), streak: Number(farmer.streak), guarded: farmer.guarded },
      crops: crops.ids.map((id, i) => {
        const x = crops.list[i];
        return {
          id: Number(id), tier: Number(x.tier), days: [7, 30, 90][Number(x.tier)], status: STATUS[Number(x.status)],
          plantedAt: Number(x.plantedAt), lastWateredDay: Number(x.lastWateredDay), amount: toNum(x.amount), payout: toNum(x.payout),
        };
      }),
    };
    emit();
  };

  // ---------- sending ----------
  let queue = Promise.resolve();
  function run(label, target, iface, fn, args, gas) {
    const job = queue.then(() => exec(label, target, iface, fn, args, gas));
    queue = job.catch(() => {});
    return job;
  }

  async function relayed(target, data, gas) {
    const from = CH.account;
    const nonce = await fwdR.nonces(from);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const req = { from, to: target, value: 0n, gas: BigInt(gas), nonce, deadline, data };
    if (CH.walletKind === "metamask") await switchToFuji();
    const signature = await signer.signTypedData(domain, TYPES, req);
    const body = { request: { from, to: target, value: "0", gas: String(gas), deadline, data, signature } };
    const r = await fetch(relayUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || `Fee manager trả lỗi ${r.status}`);
      err.relayStatus = r.status;
      throw err;
    }
    return j.hash;
  }

  async function exec(label, target, iface, fn, args, gas) {
    CH.busy = label;
    emit();
    try {
      const data = iface.encodeFunctionData(fn, args);
      let hash;
      try {
        hash = await relayed(target, data, gas);
        CH.lastPath = "gasless";
      } catch (e) {
        // Fee manager not configured yet: MetaMask users can still pay their own gas.
        if (e.relayStatus === 503 && CH.walletKind === "metamask") {
          await switchToFuji();
          const tx = await signer.sendTransaction({ to: target, data, gasLimit: gas });
          hash = tx.hash;
          CH.lastPath = "self-paid";
        } else throw e;
      }
      CH.lastTx = { hash, label };
      emit();
      const rc = await rp.waitForTransaction(hash, 1, 120_000);
      if (!rc || rc.status !== 1) throw new Error("Giao dịch thất bại trên chain: " + hash);
      return rc;
    } finally {
      CH.busy = null;
      emit();
      setTimeout(() => CH.refresh().catch(() => {}), 0);
    }
  }

  async function ensureAllowance(amount) {
    const have = await usdcR.allowance(CH.account, c.game);
    if (have >= amount) return;
    await run("Cho phép FarmGame dùng USDC", c.usdc, usdcI, "approve", [c.game, E.MaxUint256], GAS.usdc);
  }

  CH.faucet = () => run("Nhận 1.000 USDC test", c.usdc, usdcI, "faucet", [], GAS.usdc);
  CH.lendDeposit = async (v) => { await ensureAllowance(U(v)); return run("Gieo hạt vào ruộng rau", c.game, gameI, "deposit", [U(v)], GAS.lend); };
  CH.lendClaim = () => run("Thu lãi ruộng rau", c.game, gameI, "claim", [], GAS.lend);
  CH.lendWithdraw = (v) => run("Rút khỏi ruộng rau", c.game, gameI, "withdraw", [U(v)], GAS.lend);
  CH.plant = async (tier, v) => { await ensureAllowance(U(v)); return run("Trồng cây", c.game, gameI, "plant", [tier, U(v)], GAS.plant); };
  CH.harvest = (id) => run(`Thu hoạch cây #${id}`, c.game, gameI, "harvest", [id], GAS.harvest);
  CH.uproot = (id) => run(`Nhổ sớm cây #${id}`, c.game, gameI, "uproot", [id], GAS.uproot);
  CH.water = (id) => run(`Tưới cây #${id}`, c.game, gameI, "water", [id], GAS.water);
  CH.collect = () => run("Gom điểm mùa", c.game, gameI, "collect", [], GAS.small);
  CH.steal = (addr) => run("Hái trộm vườn hàng xóm", c.game, gameI, "steal", [E.getAddress(addr)], GAS.small);
  CH.setGuard = (b) => run(b ? "Thuê người giữ vườn" : "Bỏ người giữ vườn", c.game, gameI, "setGuard", [b], GAS.small);
  CH.explorerTx = (hash) => (c.explorer ? `${c.explorer.replace(/\/$/, "")}/tx/${hash}` : "");
  CH.errMsg = (e) => {
    const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
    if (e?.code === 4001 || e?.code === "ACTION_REJECTED" || /user rejected|denied/i.test(m)) return "Bạn đã từ chối trong ví.";
    const map = { NotRipe: "Cây chưa chín.", AlreadyWateredToday: "Hôm nay đã tưới cây này rồi.", NothingToSteal: "Vườn này chưa có điểm chín để hái.", Guarded: "Vườn đó có người giữ.", StealCooldown: "Mỗi ngày chỉ hái trộm được một lần.", FarmFull: "Vườn đã kín chỗ (12 cây).", ERC20InsufficientBalance: "Ví chưa đủ USDC. Bấm Nhận 1.000 USDC test." };
    for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
    return m.length > 180 ? m.slice(0, 180) + "…" : m;
  };
  CH.checkRelay();
})();
