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
    coop: [
      "function depositCollateral(uint256)",
      "function withdrawCollateral(uint256)",
      "function borrow(uint256)",
      "function repay(address user, uint256 amount)",
      "function liquidate(address user)",
      "function price() view returns (uint256)",
      "function positionOf(address) view returns (uint256 collateral, uint256 debt, uint256 value, uint256 maxBorrow, uint256 healthBps)",
    ],
    pond: [
      "function zapIn(uint256 usdcAmount, uint256 minShares)",
      "function zapOut(uint256 shares, uint256 minUsdc)",
      "function swap(bool usdcIn, uint256 amountIn, uint256 minOut)",
      "function quote(bool usdcIn, uint256 amountIn) view returns (uint256)",
      "function poolPrice() view returns (uint256)",
      "function reserveUsdc() view returns (uint256)",
      "function reserveAvax() view returns (uint256)",
      "function positionOf(address) view returns (uint256 shares, uint256 usdcPart, uint256 avaxPart, uint256 valueUsdc)",
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
  const GAS = { plant: 300_000, harvest: 250_000, uproot: 200_000, water: 120_000, small: 120_000, lend: 250_000, usdc: 120_000, coop: 250_000, pond: 300_000 };
  const SLIPPAGE_BPS = 100n; // 1% for pond trades
  const KEY = "farm-wallet-v1";
  const U = (v) => E.parseUnits(String(v), 6);
  const toNum = (v) => Number(E.formatUnits(v, 6));
  const A = (v) => E.parseUnits(String(v), 18);
  const toAvax = (v) => Number(E.formatUnits(v, 18));

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
  // Hợp tác xã and Ao cá exist from the second Fuji deploy on; older configs simply leave them out.
  const coopR = c.coop ? new E.Contract(c.coop, ABI.coop, rp) : null;
  const pondR = c.pond ? new E.Contract(c.pond, ABI.pond, rp) : null;
  const avaxR = c.gavax ? new E.Contract(c.gavax, ABI.usdc, rp) : null;
  const coopI = new E.Interface(ABI.coop);
  const pondI = new E.Interface(ABI.pond);
  CH.hasCoop = !!(coopR && avaxR);
  CH.hasPond = !!(pondR && avaxR);
  const domain = { name: "NongTraiDeFi", version: "1", chainId: c.chainId, verifyingContract: c.forwarder };
  const relayUrl = cfg.relayUrl || "/api/relay";
  let signer = null;
  let privy = null; // prototype/privy.js, loaded on first use
  CH.hasPrivy = !!cfg.privyAppId;

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
  CH.privyWallets = () => (CH.walletKind === "privy" && privy ? privy.wallets() : []);
  CH.usePrivyWallet = async (address) => {
    if (CH.walletKind !== "privy") throw new Error("Không phải ví Privy.");
    const { provider } = await privy.use(address);
    signer = await new E.BrowserProvider(provider).getSigner();
    CH.account = E.getAddress(await signer.getAddress());
    CH.lastTx = null;
    await CH.refresh();
    return CH.account;
  };
  CH.exportPrivyKey = () => (CH.walletKind === "privy" ? privy.exportKey() : Promise.reject(new Error("Không phải ví Privy.")));
  /** Ask MetaMask to show a farm token (USDC or gAVAX) in its asset list. */
  CH.watchToken = (which = "usdc") => {
    if (!window.ethereum) return Promise.reject(new Error("Không thấy MetaMask/Core."));
    const t = which === "gavax" ? { address: c.gavax, symbol: "gAVAX", decimals: 18 } : { address: c.usdc, symbol: "USDC", decimals: 6 };
    return window.ethereum.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: t } });
  };
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
    } else if (kind === "privy") {
      if (!cfg.privyAppId) throw new Error("Chưa cấu hình Privy App ID.");
      privy = privy || (await import("/prototype/privy.js"));
      const { provider } = await privy.connect();
      signer = await new E.BrowserProvider(provider).getSigner();
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
    if (CH.walletKind === "privy") privy?.logout().catch(() => {});
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
    const [coop, pond, gavax] = await Promise.all([readCoop(a), readPond(a), avaxR ? avaxR.balanceOf(a) : 0n]);
    Object.assign(CH.data, { coop, pond, gavax: toAvax(gavax) });
    emit();
  };

  async function readCoop(a) {
    if (!CH.hasCoop) return null;
    try {
      const [p, price] = await Promise.all([coopR.positionOf(a), coopR.price()]);
      return {
        collateral: toAvax(p.collateral), debt: toNum(p.debt), value: toNum(p.value), maxBorrow: toNum(p.maxBorrow),
        // healthBps is MaxUint256 without debt; 1.0 = exactly at the liquidation line.
        health: p.debt === 0n ? Infinity : Number(p.healthBps) / 10_000,
        price: Number(E.formatUnits(price, 8)), priceOk: true,
      };
    } catch (e) {
      // Chainlink is stale or unreachable: positionOf needs a price, so report that instead.
      return { collateral: 0, debt: 0, value: 0, maxBorrow: 0, health: Infinity, price: 0, priceOk: false, error: CH.errMsg(e) };
    }
  }

  async function readPond(a) {
    if (!CH.hasPond) return null;
    const [p, price, ru, ra] = await Promise.all([pondR.positionOf(a), pondR.poolPrice(), pondR.reserveUsdc(), pondR.reserveAvax()]);
    return {
      shares: p.shares, usdcPart: toNum(p.usdcPart), avaxPart: toAvax(p.avaxPart), value: toNum(p.valueUsdc),
      price: Number(E.formatUnits(price, 8)), reserveUsdc: toNum(ru), reserveAvax: toAvax(ra),
    };
  }

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

  async function ensureAllowance(amount, spender = c.game, token = usdcR, label = "Cho phép FarmGame dùng USDC") {
    const have = await token.allowance(CH.account, spender);
    if (have >= amount) return;
    await run(label, token.target, usdcI, "approve", [spender, E.MaxUint256], GAS.usdc);
  }
  const minus = (v) => (v * (10_000n - SLIPPAGE_BPS)) / 10_000n;

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

  // ---------- Hợp tác xã ----------
  CH.avaxFaucet = () => run("Nhận 20 gAVAX test", c.gavax, usdcI, "faucet", [], GAS.usdc);
  CH.coopDeposit = async (v) => {
    await ensureAllowance(A(v), c.coop, avaxR, "Cho phép Hợp tác xã dùng gAVAX");
    return run("Gửi gAVAX vào kho thóc", c.coop, coopI, "depositCollateral", [A(v)], GAS.coop);
  };
  CH.coopWithdraw = (v) => run("Rút gAVAX khỏi kho thóc", c.coop, coopI, "withdrawCollateral", [A(v)], GAS.coop);
  CH.coopBorrow = (v) => run("Vay phân bón", c.coop, coopI, "borrow", [U(v)], GAS.coop);
  CH.coopRepay = async (v) => {
    await ensureAllowance(U(v), c.coop, usdcR, "Cho phép Hợp tác xã nhận USDC trả nợ");
    return run("Trả nợ Hợp tác xã", c.coop, coopI, "repay", [CH.account, U(v)], GAS.coop);
  };
  /** Repay someone's unhealthy debt and take their gAVAX plus 10%. */
  CH.coopLiquidate = async (user, debt) => {
    await ensureAllowance(U(debt), c.coop, usdcR, "Cho phép Hợp tác xã nhận USDC");
    return run("Thanh lý kho thóc", c.coop, coopI, "liquidate", [E.getAddress(user)], GAS.coop);
  };

  // ---------- Ao cá ----------
  CH.pondAdd = async (v) => {
    await ensureAllowance(U(v), c.pond, usdcR, "Cho phép Ao cá dùng USDC");
    return run("Thả cá vào ao", c.pond, pondI, "zapIn", [U(v), 1], GAS.pond);
  };
  /** Take out a fraction (0..1] of the position, paid out in USDC. */
  CH.pondOut = async (fraction = 1) => {
    const p = await pondR.positionOf(CH.account);
    if (p.shares === 0n) throw new Error("Ao đang trống.");
    const shares = fraction >= 1 ? p.shares : (p.shares * BigInt(Math.round(fraction * 10_000))) / 10_000n;
    const sold = await pondR.quote(false, (p.avaxPart * shares) / p.shares);
    const min = minus((p.usdcPart * shares) / p.shares + sold);
    return run("Vớt cá", c.pond, pondI, "zapOut", [shares, min], GAS.pond);
  };
  CH.pondSwap = async (usdcIn, v) => {
    const amount = usdcIn ? U(v) : A(v);
    await ensureAllowance(amount, c.pond, usdcIn ? usdcR : avaxR, usdcIn ? "Cho phép Ao cá dùng USDC" : "Cho phép Ao cá dùng gAVAX");
    const out = await pondR.quote(usdcIn, amount);
    return run(usdcIn ? "Mua gAVAX ở chợ" : "Bán gAVAX ở chợ", c.pond, pondI, "swap", [usdcIn, amount, minus(out)], GAS.pond);
  };

  CH.explorerTx = (hash) => (c.explorer ? `${c.explorer.replace(/\/$/, "")}/tx/${hash}` : "");
  CH.errMsg = (e) => {
    const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
    if (e?.code === 4001 || e?.code === "ACTION_REJECTED" || /user rejected|denied/i.test(m)) return "Bạn đã từ chối trong ví.";
    const map = { NotRipe: "Cây chưa chín.", AlreadyWateredToday: "Hôm nay đã tưới cây này rồi.", NothingToSteal: "Vườn này chưa có điểm chín để hái.", Guarded: "Vườn đó có người giữ.", StealCooldown: "Mỗi ngày chỉ hái trộm được một lần.", FarmFull: "Vườn đã kín chỗ (12 cây).", NotAFarmer: "Phải có ít nhất một cây đang trồng mới được hái trộm.", CannotStealFromYourself: "Không thể hái trộm vườn của chính mình.", ExceedsBorrowLimit: "Vượt hạn mức vay (60% giá trị kho thóc).", NotLiquidatable: "Kho thóc này vẫn an toàn, chưa thể thanh lý.", NoDebt: "Không có khoản nợ nào.", StalePrice: "Giá AVAX từ Chainlink đã cũ, tạm dừng vay.", NoLiquidity: "Hợp tác xã tạm hết USDC cho vay.", InsufficientCollateral: "Kho thóc không đủ gAVAX.", Slippage: "Giá trong ao vừa đổi, thử lại.", InsufficientShares: "Bạn không có đủ phần trong ao.", EmptyPool: "Ao chưa có thanh khoản.", ERC20InsufficientBalance: "Ví chưa đủ USDC. Bấm Nhận 1.000 USDC test." };
    for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
    return m.length > 180 ? m.slice(0, 180) + "…" : m;
  };
  CH.checkRelay();
})();
