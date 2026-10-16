// Wallet + contract layer for Nông Trại DeFi. Exposes window.FarmChain.
// Needs ethers v6 (UMD) and window.FARM_CONFIG from chain-config.js.
(() => {
  // Committed config first; otherwise the one deploy.html saved in this browser.
  const cfg = window.FARM_CONFIG || (() => { try { return JSON.parse(localStorage.getItem("farm-config")); } catch { return null; } })();
  const E = window.ethers;
  const ABI = {
    usdc: [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
      "function faucet()",
    ],
    vault: [
      "function deposit(uint256)",
      "function withdraw(uint256)",
      "function claim() returns (uint256)",
      "function pendingYield(address) view returns (uint256)",
      "function lends(address) view returns (uint256 principal, uint256 accrued, uint64 last)",
      "function rewardReserve() view returns (uint256)",
      "function locks(uint256) view returns (address user, uint8 tier, bool open, uint64 start, uint256 amount)",
      "function isRipe(uint256) view returns (bool)",
      "function claimLock(uint256 cropId)",
      "function exitLock(uint256 cropId)",
    ],
    land: [
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
      "event Planted(uint256 indexed cropId, address indexed owner, uint8 tier, uint256 amount)",
    ],
  };
  const STATUS = ["None", "Pending", "Growing", "Harvesting", "Harvested", "Uprooted", "Failed"];
  const U = (v) => E.parseUnits(String(v), 6);
  const toNum = (v) => Number(E.formatUnits(v, 6));

  const CH = { available: false, live: false, account: null, data: null, busy: null, reason: "", cfg, STATUS, hasL1: !!(cfg && cfg.l1) };
  const listeners = [];
  CH.on = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((f) => { try { f(CH); } catch (e) { console.error(e); } });

  if (!cfg) CH.reason = "Chưa có địa chỉ contract. Chạy npm run deploy trong thư mục contracts/ để sinh chain-config.js.";
  else if (!E) CH.reason = "Không tải được thư viện ethers.js.";
  else if (!window.ethereum) CH.reason = "Không thấy ví trình duyệt. Cài Core Wallet hoặc MetaMask rồi tải lại trang.";
  else CH.available = true;
  window.FarmChain = CH;
  if (!cfg || !E) return;

  const rc = new E.JsonRpcProvider(cfg.cchain.rpc, cfg.cchain.chainId, { staticNetwork: true });
  const rl = CH.hasL1 ? new E.JsonRpcProvider(cfg.l1.rpc, cfg.l1.chainId, { staticNetwork: true }) : null;
  const usdcR = new E.Contract(cfg.cchain.usdc, ABI.usdc, rc);
  const vaultR = new E.Contract(cfg.cchain.vault, ABI.vault, rc);
  const landR = CH.hasL1 ? new E.Contract(cfg.l1.land, ABI.land, rl) : null;

  async function switchTo(net) {
    const chainId = "0x" + net.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (e) {
      if (e.code !== 4902 && !/unrecognized|not added|unknown chain/i.test(e.message || "")) throw e;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId,
          chainName: net.name,
          rpcUrls: [net.rpc],
          nativeCurrency: { name: net.currency, symbol: net.currency, decimals: 18 },
          blockExplorerUrls: net.explorer ? [net.explorer] : undefined,
        }],
      });
    }
  }

  async function signer(netKey) {
    if (!cfg[netKey]) throw new Error("Chưa nối Game L1. Hoàn tất bước 3 và 4 trong deploy.html.");
    await switchTo(cfg[netKey]);
    return new E.BrowserProvider(window.ethereum).getSigner();
  }

  // Wallet requests go one at a time; later clicks wait in line instead of failing.
  let queue = Promise.resolve();
  function run(label, netKey, fn) {
    const job = queue.then(() => exec(label, netKey, fn));
    queue = job.catch(() => {});
    return job;
  }

  async function exec(label, netKey, fn) {
    CH.busy = label;
    emit();
    try {
      const s = await signer(netKey);
      const tx = await fn(s);
      CH.lastTx = { hash: tx.hash, net: netKey, label };
      emit();
      return await tx.wait();
    } finally {
      CH.busy = null;
      emit();
      // Refresh after the caller's .then() has logged the sent tx, so receipts appear after it.
      setTimeout(() => CH.refresh().catch(() => {}), 0);
    }
  }

  async function ensureAllowance(amount) {
    const have = await usdcR.allowance(CH.account, cfg.cchain.vault);
    if (have >= amount) return;
    await run("Cho phép FarmVault dùng USDC (Fuji)", "cchain", (s) =>
      new E.Contract(cfg.cchain.usdc, ABI.usdc, s).approve(cfg.cchain.vault, E.MaxUint256)
    );
  }

  CH.connect = async () => {
    const acc = await window.ethereum.request({ method: "eth_requestAccounts" });
    CH.account = E.getAddress(acc[0]);
    CH.live = true;
    window.ethereum.on?.("accountsChanged", (a) => {
      CH.account = a[0] ? E.getAddress(a[0]) : null;
      CH.live = !!a[0];
      CH.refresh().catch(() => {});
    });
    await CH.refresh();
    clearInterval(CH._timer);
    CH._timer = setInterval(() => CH.refresh().catch(() => {}), 5000);
    return CH.account;
  };

  CH.refresh = async () => {
    if (!CH.live || !CH.account) { emit(); return; }
    const a = CH.account;
    const [usdc, avax, lend, pending, reserve, crops, farmer, today, l1gas] = await Promise.all([
      usdcR.balanceOf(a),
      rc.getBalance(a),
      vaultR.lends(a),
      vaultR.pendingYield(a),
      vaultR.rewardReserve(),
      landR ? landR.cropsOf(a) : { ids: [], list: [] },
      landR ? landR.farmers(a) : { points: 0n, ripePoints: 0n, streak: 0n, guarded: false },
      landR ? landR.today() : 0n,
      rl ? rl.getBalance(a) : 0n,
    ]);
    // FarmVault on C-Chain is the source of truth for money; the L1 crop state is optimistic.
    const ids = crops.ids.map(Number);
    const lockList = await Promise.all(ids.map((id) => vaultR.locks(id).catch(() => null)));
    const ripeList = await Promise.all(ids.map((id, i) => (lockList[i]?.open ? vaultR.isRipe(id).catch(() => false) : false)));
    CH.data = {
      usdc: toNum(usdc),
      avax: Number(E.formatEther(avax)),
      l1gas: Number(E.formatEther(l1gas)),
      lendPrincipal: toNum(lend.principal),
      lendPending: toNum(pending),
      reserve: toNum(reserve),
      today: Number(today),
      farmer: {
        points: Number(farmer.points),
        ripePoints: Number(farmer.ripePoints),
        streak: Number(farmer.streak),
        guarded: farmer.guarded,
      },
      crops: crops.ids.map((id, i) => {
        const c = crops.list[i];
        return {
          id: Number(id),
          tier: Number(c.tier),
          days: [7, 30, 90][Number(c.tier)],
          status: STATUS[Number(c.status)],
          plantedAt: Number(c.plantedAt),
          lastWateredDay: Number(c.lastWateredDay),
          amount: toNum(c.amount),
          payout: toNum(c.payout),
          lock: lockList[i]
            ? { exists: Number(lockList[i].start) > 0, open: lockList[i].open, start: Number(lockList[i].start), ripe: ripeList[i] }
            : { exists: false, open: false, start: 0, ripe: false },
        };
      }),
    };
    emit();
  };

  CH.faucet = () => run("Nhận 1.000 USDC test (Fuji)", "cchain", (s) => new E.Contract(cfg.cchain.usdc, ABI.usdc, s).faucet());
  CH.lendDeposit = async (v) => {
    await ensureAllowance(U(v));
    return run("Gieo hạt vào ruộng rau (Fuji)", "cchain", (s) => new E.Contract(cfg.cchain.vault, ABI.vault, s).deposit(U(v)));
  };
  CH.lendClaim = () => run("Thu lãi ruộng rau (Fuji)", "cchain", (s) => new E.Contract(cfg.cchain.vault, ABI.vault, s).claim());
  CH.lendWithdraw = (v) => run("Rút khỏi ruộng rau (Fuji)", "cchain", (s) => new E.Contract(cfg.cchain.vault, ABI.vault, s).withdraw(U(v)));
  CH.plant = async (tier, v) => {
    await ensureAllowance(U(v));
    return run("Trồng cây trên Game L1", "l1", (s) => new E.Contract(cfg.l1.land, ABI.land, s).plant(tier, U(v), { gasLimit: L1_GAS.plant }));
  };
  // A quiet L1 only makes blocks when there are txs, so "latest" can be minutes old and gas estimation
  // would simulate harvest/water against a stale timestamp and fail. Fixed gas limits skip that.
  const L1_GAS = { plant: 600_000, harvest: 500_000, uproot: 500_000, water: 150_000, small: 150_000 };
  const landTx = (label, fn) => run(label, "l1", (s) => fn(new E.Contract(cfg.l1.land, ABI.land, s)));
  CH.harvest = (id) => landTx(`Thu hoạch cây #${id}`, (c) => c.harvest(id, { gasLimit: L1_GAS.harvest }));
  CH.uproot = (id) => landTx(`Nhổ sớm cây #${id}`, (c) => c.uproot(id, { gasLimit: L1_GAS.uproot }));
  const vaultTx = (label, fn) => run(label, "cchain", (s) => fn(new E.Contract(cfg.cchain.vault, ABI.vault, s)));
  CH.claimLock = (id) => vaultTx(`Rút cây #${id} trực tiếp trên Fuji`, (c) => c.claimLock(id));
  CH.exitLock = (id) => vaultTx(`Rút gốc cây #${id} trên Fuji`, (c) => c.exitLock(id));
  CH.water = (id) => landTx(`Tưới cây #${id}`, (c) => c.water(id, { gasLimit: L1_GAS.water }));
  CH.collect = () => landTx("Gom điểm mùa", (c) => c.collect({ gasLimit: L1_GAS.small }));
  CH.steal = (addr) => landTx("Hái trộm vườn hàng xóm", (c) => c.steal(E.getAddress(addr), { gasLimit: L1_GAS.small }));
  CH.setGuard = (b) => landTx(b ? "Thuê người giữ vườn" : "Bỏ người giữ vườn", (c) => c.setGuard(b, { gasLimit: L1_GAS.small }));
  CH.explorerTx = (net, hash) => (cfg[net].explorer ? `${cfg[net].explorer.replace(/\/$/, "")}/tx/${hash}` : "");
  CH.errMsg = (e) => {
    const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
    if (e?.code === 4001 || e?.code === "ACTION_REJECTED" || /user rejected|denied/i.test(m)) return "Bạn đã từ chối giao dịch trong ví.";
    return m.length > 160 ? m.slice(0, 160) + "…" : m;
  };
})();
