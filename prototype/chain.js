// Wallet + contract layer for Nông Trại DeFi. Exposes window.FarmChain.
// Needs ethers v6 (UMD) and window.FARM_CONFIG from chain-config.js.
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
    vault: [
      "function deposit(uint256)",
      "function withdraw(uint256)",
      "function claim() returns (uint256)",
      "function pendingYield(address) view returns (uint256)",
      "function lends(address) view returns (uint256 principal, uint256 accrued, uint64 last)",
      "function rewardReserve() view returns (uint256)",
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

  const CH = { available: false, live: false, account: null, data: null, busy: null, reason: "", cfg, STATUS };
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
  const rl = new E.JsonRpcProvider(cfg.l1.rpc, cfg.l1.chainId, { staticNetwork: true });
  const usdcR = new E.Contract(cfg.cchain.usdc, ABI.usdc, rc);
  const vaultR = new E.Contract(cfg.cchain.vault, ABI.vault, rc);
  const landR = new E.Contract(cfg.l1.land, ABI.land, rl);

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
      landR.cropsOf(a),
      landR.farmers(a),
      landR.today(),
      rl.getBalance(a),
    ]);
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
    return run("Trồng cây trên Game L1", "l1", (s) => new E.Contract(cfg.l1.land, ABI.land, s).plant(tier, U(v)));
  };
  const landTx = (label, fn) => run(label, "l1", (s) => fn(new E.Contract(cfg.l1.land, ABI.land, s)));
  CH.harvest = (id) => landTx(`Thu hoạch cây #${id}`, (c) => c.harvest(id));
  CH.uproot = (id) => landTx(`Nhổ sớm cây #${id}`, (c) => c.uproot(id));
  CH.water = (id) => landTx(`Tưới cây #${id}`, (c) => c.water(id));
  CH.collect = () => landTx("Gom điểm mùa", (c) => c.collect());
  CH.steal = (addr) => landTx("Hái trộm vườn hàng xóm", (c) => c.steal(E.getAddress(addr)));
  CH.setGuard = (b) => landTx(b ? "Thuê người giữ vườn" : "Bỏ người giữ vườn", (c) => c.setGuard(b));
  CH.explorerTx = (net, hash) => (cfg[net].explorer ? `${cfg[net].explorer.replace(/\/$/, "")}/tx/${hash}` : "");
  CH.errMsg = (e) => {
    const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
    if (e?.code === 4001 || e?.code === "ACTION_REJECTED" || /user rejected|denied/i.test(m)) return "Bạn đã từ chối giao dịch trong ví.";
    return m.length > 160 ? m.slice(0, 160) + "…" : m;
  };
})();
