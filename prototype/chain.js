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
      "function transfer(address to, uint256 amount) returns (bool)",
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
      "function totalShares() view returns (uint256)",
      "function positionOf(address) view returns (uint256 shares, uint256 usdcPart, uint256 avaxPart, uint256 valueUsdc)",
    ],
    items: [
      "function itemsOf(address) view returns (uint256[] ids, uint256[] amounts)",
      "function pointsOf(address) view returns (uint256)",
      "function hatOf(address) view returns (uint256)",
      "function today() view returns (uint64)",
      "function claimedCrop(uint256) view returns (bool)",
      "function canEarn(address,uint256,uint256) view returns (bool)",
      "function fishSince(address) view returns (uint64)",
      "function fishSeen(address) view returns (uint64)",
      "function safeSince(address) view returns (uint64)",
      "function feePerUnit() view returns (uint256)",
      "function feePool() view returns (uint256)",
      "function offerCount() view returns (uint256)",
      "function offer(uint256) view returns (tuple(address maker, address taker, uint64 expires, bool open, uint256[] giveIds, uint256[] giveAmts, uint256[] wantIds, uint256[] wantAmts))",
      "function claimHarvest(uint256 cropId)",
      "function discard(uint256 id, uint256 amount)",
      "function startWatch(uint256 badgeId)",
      "function claimBadge(uint256 badgeId, uint256 arg)",
      "function buy(uint256 id, uint256 amount)",
      "function craftFruitTray(uint256 chiliId, uint256 mangoId, uint256 durianId)",
      "function equipHat(uint256 id)",
      "function makeOffer((uint256[] giveIds, uint256[] giveAmts, uint256[] wantIds, uint256[] wantAmts) legs, address taker, uint256 durationDays)",
      "function acceptOffer(uint256 offerId, uint256[] payIds)",
      "function cancelOffer(uint256 offerId)",
    ],
    quests: [
      "function status(address) view returns (uint256 quest, bool ready, uint256 reward)",
      "function complete(uint256 hint)",
      "function hintFor(address,uint256) view returns (bool ready, uint256 hint)",
      "function rewardPool() view returns (uint256)",
      "error NotDoneYet(uint256 quest)",
      "error AllDone()",
      "error RewardPoolEmpty(uint256 available, uint256 needed)",
    ],
    forwarder: ["function nonces(address) view returns (uint256)"],
    butler: [
      "function owner() view returns (address)",
      "function agent() view returns (address)",
      "function agentActive() view returns (bool)",
      "function dailyCap() view returns (uint256)",
      "function remainingToday() view returns (uint256)",
    ],
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
  const itemsR = c.items ? new E.Contract(c.items, ABI.items, rp) : null;
  const itemsI = new E.Interface(ABI.items);
  CH.hasItems = !!itemsR;
  const questsR = c.quests ? new E.Contract(c.quests, ABI.quests, rp) : null;
  const questsI = new E.Interface(ABI.quests);
  CH.hasQuests = !!questsR;
  /** Nhiệm vụ, easy to hard. zone: where to go (a map zone or a panel), how: one plain sentence. Rewards are test USDC. */
  CH.QUESTS = [
    { ch: 1, title: "Nhận tiền thử", how: "Vào Ruộng rau, bấm Nhận 1.000 USDC test.", zone: "lend", reward: 10 },
    { ch: 1, title: "Gửi tiết kiệm", how: "Gửi ít nhất 10 USDC vào Ruộng rau (Gieo hạt).", zone: "lend", reward: 10 },
    { ch: 1, title: "Trồng cây đầu tiên", how: "Trồng một cây bất kỳ ở Vườn cây.", zone: "orchard", reward: 10 },
    { ch: 1, title: "Tưới cây", how: "Tưới cây vừa trồng ở Vườn cây.", zone: "orchard", reward: 10 },
    { ch: 2, title: "Thu hoạch", how: "Trồng cây ớt, chờ chín (7 ngày game, khoảng 7 phút) rồi thu hoạch.", zone: "orchard", reward: 20 },
    { ch: 2, title: "Có 10 điểm mùa", how: "Thu hoạch cây hoặc gom điểm chín ở Vườn bác Tư.", zone: "neighbor", reward: 20 },
    { ch: 2, title: "Nhận nông sản", how: "Mở Kho đồ, nhận nông sản của cây đã thu hoạch.", zone: "inventory", reward: 20 },
    { ch: 2, title: "Mua đồ trang trí", how: "Mua một món ở Tiệm đồ trong Kho đồ bằng điểm mùa.", zone: "inventory", reward: 20 },
    { ch: 3, title: "Thả cá", how: "Góp tiền vào Ao cá (Thả cá).", zone: "pond", reward: 30 },
    { ch: 3, title: "Vay ở Hợp tác xã", how: "Nhận gAVAX, gửi vào kho thóc rồi vay một ít USDC.", zone: "coop", reward: 40 },
    { ch: 3, title: "Trả hết nợ", how: "Trả hết khoản vay ở Hợp tác xã.", zone: "coop", reward: 50 },
    { ch: 4, title: "Đăng đề nghị đổi đồ", how: "Ở Chợ phiên, đăng một đề nghị đổi đồ.", zone: "market", reward: 30 },
    { ch: 4, title: "Hái trộm", how: "Hỏi bạn bè địa chỉ ví, hái trộm điểm chín của họ ở Vườn bác Tư.", zone: "neighbor", reward: 30 },
    { ch: 4, title: "Thuê người giữ vườn", how: "Ở Vườn bác Tư, bấm Thuê người giữ vườn.", zone: "neighbor", reward: 30 },
    { ch: 5, title: "Nông dân chăm chỉ", how: "Tưới cây 7 ngày liên tục, rồi nhận huy hiệu trong Kho đồ.", zone: "inventory", reward: 50 },
    { ch: 5, title: "Vay an toàn", how: "Vay ở Hợp tác xã, giữ nguyên khoản vay 3 ngày với hệ số an toàn từ 1,5, rồi nhận huy hiệu.", zone: "inventory", reward: 80 },
    { ch: 5, title: "Kiên nhẫn", how: "Thu hoạch một cây sầu riêng 90 ngày (khoảng 90 phút), rồi nhận huy hiệu.", zone: "inventory", reward: 100 },
    { ch: 5, title: "Lão nông", how: "Có đủ 5 huy hiệu bài học, rồi nhận huy hiệu Lão nông.", zone: "inventory", reward: 200 },
  ];
  CH.CHAPTERS = { 1: "Làm quen", 2: "Chăm vườn", 3: "Tài chính", 4: "Làng xóm", 5: "Bậc thầy" };
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
    // Build the whole snapshot first and swap it in at the end, so the UI never sees a half-read state.
    const next = {
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
    Object.assign(next, { coop, pond, gavax: toAvax(gavax) });
    if (questsR) {
      const q = await questsR.status(a).catch(() => null);
      next.quest = q ? { index: Number(q.quest), ready: q.ready, reward: toNum(q.reward), done: Number(q.quest) >= CH.QUESTS.length } : CH.data?.quest || null;
    }
    next.items = await readItems(a, next.crops).catch((e) => { console.error("[items]", e); return CH.data?.items || null; });
    if (CH.account !== a) return; // the wallet changed while reading
    CH.data = next;
    emit();
  };

  // ---------- Kho đồ (FarmItems) ----------
  const KIND = 1_000_000_000n;
  /** Catalog shown in the game. Badges: soulbound, earned by a DeFi lesson. Cosmetics: points or crafting. */
  const CATALOG = {
    1: { name: "Ớt", icon: "chili", rarity: "thường", kind: "produce", desc: "Thu hoạch từ cây ớt. Hỏng sau 7 ngày kể từ ngày cây chín." },
    2: { name: "Xoài", icon: "mango", rarity: "thường", kind: "produce", desc: "Thu hoạch từ cây xoài. Hỏng sau 7 ngày kể từ ngày cây chín." },
    3: { name: "Sầu riêng", icon: "durian", rarity: "hiếm", kind: "produce", desc: "Thu hoạch từ cây sầu riêng 90 ngày. Hỏng sau 7 ngày kể từ ngày cây chín." },
    1001: { name: "Hạt giống đầu tiên", icon: "seed", rarity: "huy hiệu", kind: "badge", desc: "Gửi tiền vào Ruộng rau lần đầu.", lesson: "Gửi tiết kiệm" },
    1002: { name: "Kiên nhẫn", icon: "hourglass", rarity: "huy hiệu", kind: "badge", desc: "Thu hoạch một cây sầu riêng 90 ngày.", lesson: "Khóa càng lâu, lãi càng cao" },
    1003: { name: "Người nuôi cá", icon: "fish", rarity: "huy hiệu", kind: "badge", desc: "Giữ cá trong Ao cá 3 ngày, mỗi ngày game bấm Điểm danh một lần.", lesson: "Góp thanh khoản" },
    1004: { name: "Vay an toàn", icon: "shield", rarity: "huy hiệu", kind: "badge", desc: "Giữ nguyên một khoản vay ở Hợp tác xã 3 ngày (không trả, không vay thêm), hệ số an toàn từ 1,5 trở lên.", lesson: "Vay có trách nhiệm" },
    1005: { name: "Nông dân chăm chỉ", icon: "can", rarity: "huy hiệu", kind: "badge", desc: "Tưới cây 7 ngày liên tục.", lesson: "Kiên trì" },
    1006: { name: "Lão nông", icon: "crown", rarity: "huyền thoại", kind: "badge", desc: "Có đủ 5 huy hiệu trên.", lesson: "Tốt nghiệp DeFi cơ bản" },
    1007: { name: "Cúp mùa vụ", icon: "trophy", rarity: "huyền thoại", kind: "badge", desc: "Top 10 cuối mùa. Mỗi mùa chỉ có 10 cúp." },
    2001: { name: "Nón lá đỏ", icon: "hat", color: "#d9534a", rarity: "thường", kind: "cosmetic", price: 20, desc: "Đội lên cho nhân vật." },
    2002: { name: "Nón lá xanh", icon: "hat", color: "#5fae6a", rarity: "thường", kind: "cosmetic", price: 20, desc: "Đội lên cho nhân vật." },
    2003: { name: "Nón lá vàng", icon: "hat", color: "#f2c14e", rarity: "hiếm", kind: "cosmetic", price: 150, desc: "Đội lên cho nhân vật. Đắt nhất tiệm." },
    2004: { name: "Đèn lồng nhà", icon: "lantern", rarity: "thường", kind: "cosmetic", price: 40, desc: "Treo trước Nhà mình." },
    2005: { name: "Hàng rào hoa", icon: "flowers", rarity: "thường", kind: "cosmetic", price: 60, desc: "Trồng quanh Nhà mình." },
    2006: { name: "Mâm ngũ quả", icon: "tray", rarity: "hiếm", kind: "cosmetic", desc: "Ghép từ 3 ớt + 2 xoài + 1 sầu riêng còn tươi. Bày ở Nhà mình." },
  };
  CH.CATALOG = CATALOG;
  CH.BADGES = [1001, 1002, 1003, 1004, 1005, 1006, 1007];
  CH.SHOP = [2001, 2002, 2003, 2004, 2005];
  CH.itemInfo = (id) => {
    const n = BigInt(id);
    const kind = n / KIND;
    if (kind >= 1n && kind <= 3n) return { ...CATALOG[Number(kind)], produceKind: Number(kind), day: Number(n % KIND) };
    return CATALOG[Number(n)] || { name: "Vật phẩm #" + id, icon: "box", rarity: "thường", kind: "other", desc: "" };
  };

  async function readItems(a, crops) {
    if (!itemsR) return null;
    const harvested = crops.filter((cr) => cr.status === "Harvested");
    const [inv, points, hat, today, fishSince, safeSince, feePerUnit, claimed, fishSeen] = await Promise.all([
      itemsR.itemsOf(a), itemsR.pointsOf(a), itemsR.hatOf(a), itemsR.today(), itemsR.fishSince(a), itemsR.safeSince(a), itemsR.feePerUnit(),
      Promise.all(harvested.map((cr) => itemsR.claimedCrop(cr.id))),
      itemsR.fishSeen(a),
    ]);
    const durian = harvested.find((cr) => cr.tier === 2);
    const can = await Promise.all(CH.BADGES.slice(0, 6).map((b) => itemsR.canEarn(a, b, b === 1002 && durian ? durian.id : 0)));
    const t = Number(today);
    const list = inv.ids.map((id, i) => {
      const info = CH.itemInfo(id);
      const fresh = info.kind === "produce" ? t <= info.day + 7 : true;
      return { id: id.toString(), amount: Number(inv.amounts[i]), ...info, fresh, daysLeft: info.kind === "produce" ? info.day + 7 - t : null };
    });
    const owns = (id) => list.some((x) => x.id === String(id));
    return {
      list, points: Number(points), hat: Number(hat), today: t, feePerUnit: Number(feePerUnit),
      unclaimed: harvested.filter((_, i) => !claimed[i]).map((cr) => cr.id),
      durianCrop: durian ? durian.id : 0,
      badges: CH.BADGES.map((b, i) => ({ id: b, ...CATALOG[b], owned: owns(b), can: i < 6 ? can[i] : false })),
      fishSince: Number(fishSince), safeSince: Number(safeSince), fishSeen: Number(fishSeen),
    };
  }

  /** The last `n` market offers, newest first. */
  CH.loadOffers = async (n = 25) => {
    if (!itemsR) return [];
    const count = Number(await itemsR.offerCount());
    const ids = [];
    for (let i = count - 1; i >= 0 && ids.length < n; i--) ids.push(i);
    const now = Math.floor(Date.now() / 1000);
    const rows = await Promise.all(ids.map((i) => itemsR.offer(i)));
    return rows.map((o, k) => ({
      id: ids[k], maker: o.maker, taker: o.taker, expires: Number(o.expires), open: o.open && Number(o.expires) >= now,
      give: o.giveIds.map((id, j) => ({ id: id.toString(), amount: Number(o.giveAmts[j]), ...CH.itemInfo(id) })),
      want: o.wantIds.map((id, j) => ({ id: id.toString(), amount: Number(o.wantAmts[j]), ...CH.itemInfo(id) })),
    }));
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
    sentAt = performance.now();
    const r = await fetch(relayUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error || `Fee manager trả lỗi ${r.status}`);
      err.relayStatus = r.status;
      err.notSent = !!j.notSent; // the fee manager broadcast nothing for this request
      throw err;
    }
    // 202: broadcast but not confirmed yet. Any of these hashes may be the one that runs the request.
    return j.hashes?.length ? j.hashes : [j.hash];
  }

  // ---------- per-player gas stats: how fast each transaction confirmed and what the fee manager paid ----------
  let sentAt = 0;
  const statsKey = () => `farm-gas-v1:${CH.account}`;
  CH.gasStats = () => {
    try { return JSON.parse(localStorage.getItem(statsKey())) || { count: 0, avax: 0, ms: 0 }; } catch { return { count: 0, avax: 0, ms: 0 }; }
  };
  let avaxUsd = 0;
  CH.avaxUsd = () => avaxUsd || CH.data?.coop?.price || 0;
  async function recordTx(rc, path, ms) {
    const avax = Number(E.formatEther((rc.gasUsed || 0n) * (rc.gasPrice || 0n)));
    CH.lastTx = { ...CH.lastTx, ms, avax, path };
    if (path === "gasless") {
      const st = CH.gasStats();
      st.count++; st.avax += avax; st.ms += ms;
      try { localStorage.setItem(statsKey(), JSON.stringify(st)); } catch {}
    }
    if (!avaxUsd && coopR) avaxUsd = Number(E.formatUnits(await coopR.price().catch(() => 0n), 8));
  }

  async function exec(label, target, iface, fn, args, gas) {
    CH.busy = label;
    emit();
    try {
      const data = iface.encodeFunctionData(fn, args);
      let hashes;
      try {
        hashes = await relayed(target, data, gas);
        CH.lastPath = "gasless";
      } catch (e) {
        // The fee manager is off, empty or busy and sent nothing: MetaMask users can pay their own gas. Never
        // when it may have broadcast already, or the action would run twice.
        if (e.relayStatus === 503 && e.notSent && CH.walletKind === "metamask") {
          await switchToFuji();
          sentAt = performance.now();
          const tx = await signer.sendTransaction({ to: target, data, gasLimit: gas });
          hashes = [tx.hash];
          CH.lastPath = "self-paid";
        } else throw e;
      }
      let hash = hashes[hashes.length - 1];
      CH.lastTx = { hash, label };
      emit();
      const rc = await Promise.any(hashes.map((h) => rp.waitForTransaction(h, 1, 120_000).then((x) => x || Promise.reject()))).catch(() => null);
      if (rc) CH.lastTx.hash = hash = rc.hash;
      if (!rc || rc.status !== 1) throw new Error("Giao dịch thất bại trên chain: " + hash);
      await recordTx(rc, CH.lastPath, Math.round(performance.now() - sentAt)).catch(() => {});
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
  // Harvest, then pick up the produce for the Kho đồ in the same flow (a second gasless signature).
  CH.harvest = async (id) => {
    const rc = await run(`Thu hoạch cây #${id}`, c.game, gameI, "harvest", [id], GAS.harvest);
    if (itemsR) await CH.claimHarvest(id).catch((e) => console.warn("[items] claimHarvest", e));
    return rc;
  };
  CH.uproot = (id) => run(`Nhổ sớm cây #${id}`, c.game, gameI, "uproot", [id], GAS.uproot);
  CH.water = (id) => run(`Tưới cây #${id}`, c.game, gameI, "water", [id], GAS.water);
  CH.collect = () => run("Gom điểm mùa", c.game, gameI, "collect", [], GAS.small);
  CH.steal = (addr) => run("Hái trộm vườn hàng xóm", c.game, gameI, "steal", [E.getAddress(addr)], GAS.small);
  CH.setGuard = (b) => run(b ? "Thuê người giữ vườn" : "Bỏ người giữ vườn", c.game, gameI, "setGuard", [b], GAS.small);

  // ---------- Kho đồ ----------
  const GI = 250_000;
  CH.completeQuest = () => {
    const q = CH.data?.quest;
    // The contract checks only the record named by the hint (a crop for quests 2 and 4), so gas stays flat.
    return questsR.hintFor(CH.account, BigInt(q?.index ?? 0)).then(([, hint]) =>
      run(`Nhận thưởng nhiệm vụ: ${CH.QUESTS[q?.index]?.title || ""}`, c.quests, questsI, "complete", [hint], 300_000));
  };
  CH.claimHarvest = (cropId) => run(`Nhận nông sản cây #${cropId}`, c.items, itemsI, "claimHarvest", [cropId], GI);
  CH.claimBadge = (id, arg = 0) => run(`Nhận huy hiệu ${CATALOG[id]?.name || id}`, c.items, itemsI, "claimBadge", [id, arg], GI);
  CH.startWatch = (id) => run(`Điểm danh huy hiệu ${CATALOG[id]?.name || id}`, c.items, itemsI, "startWatch", [id], GI);
  CH.buyItem = (id, n = 1) => run(`Mua ${CATALOG[id]?.name || id}`, c.items, itemsI, "buy", [id, n], GI);
  CH.equipHat = (id) => run(id ? `Đội ${CATALOG[id]?.name}` : "Đội nón lá thường", c.items, itemsI, "equipHat", [id], GI);
  CH.discard = (id, n) => run("Bỏ nông sản hỏng", c.items, itemsI, "discard", [BigInt(id), n], GI);
  /** Uses the freshest batch of each kind the player holds. */
  CH.craftTray = () => {
    const list = CH.data?.items?.list || [];
    const pick = (k, need) => list.filter((x) => x.produceKind === k && x.fresh && x.amount >= need).sort((p, q) => q.day - p.day)[0];
    const a = pick(1, 3), b = pick(2, 2), d = pick(3, 1);
    if (!a || !b || !d) return Promise.reject(new Error("Cần 3 ớt, 2 xoài và 1 sầu riêng còn tươi."));
    return run("Ghép Mâm ngũ quả", c.items, itemsI, "craftFruitTray", [BigInt(a.id), BigInt(b.id), BigInt(d.id)], 300_000);
  };
  /** give: {id, amount} a concrete item the player holds. want: {kind (1-3) | id (cosmetic), amount}. */
  CH.makeOffer = ({ giveId, giveAmount, wantKind, wantId, wantAmount, taker, days = 3 }) => {
    const want = wantKind ? BigInt(wantKind) * KIND : BigInt(wantId);
    const legs = { giveIds: [BigInt(giveId)], giveAmts: [BigInt(giveAmount)], wantIds: [want], wantAmts: [BigInt(wantAmount)] };
    return run("Đăng đề nghị đổi đồ", c.items, itemsI, "makeOffer", [legs, taker ? E.getAddress(taker) : E.ZeroAddress, days], 600_000);
  };
  /** Pays each wanted leg with the freshest matching batch from the inventory. */
  CH.acceptOffer = (o) => {
    const list = CH.data?.items?.list || [];
    const pay = o.want.map((w) => {
      const kind = BigInt(w.id) / KIND;
      const m = kind >= 1n && kind <= 3n
        ? list.filter((x) => x.produceKind === Number(kind) && x.fresh && x.amount >= w.amount).sort((p, q) => q.day - p.day)[0]
        : list.find((x) => x.id === w.id && x.amount >= w.amount);
      if (!m) throw new Error(`Bạn chưa có đủ ${w.amount} ${w.name}${kind >= 1n && kind <= 3n ? " còn tươi" : ""}.`);
      return BigInt(m.id);
    });
    return run(`Đổi đồ (đề nghị #${o.id})`, c.items, itemsI, "acceptOffer", [o.id, pay], 600_000);
  };
  CH.cancelOffer = (id) => run(`Huỷ đề nghị #${id}`, c.items, itemsI, "cancelOffer", [id], 400_000);
  /** Gift test USDC or gAVAX to a friend. */
  CH.gift = (token, to, v) => {
    const addr = E.getAddress(to);
    return token === "gavax"
      ? run(`Tặng ${v} gAVAX`, c.gavax, usdcI, "transfer", [addr, A(v)], GAS.usdc)
      : run(`Tặng ${v} USDC`, c.usdc, usdcI, "transfer", [addr, U(v)], GAS.usdc);
  };

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
  // FarmPond's own integer math, mirrored so zaps carry a real slippage limit: a bot that moves the price
  // right before a player's zap makes the zap revert instead of taking part of the deposit.
  const isqrt = (n) => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
  const pondSwapOut = (amountIn, rIn, rOut) => { const f = amountIn * 9_970n; return (f * rOut) / (rIn * 10_000n + f); };
  const pondState = async () => { const [ru, ra, ts] = await Promise.all([pondR.reserveUsdc(), pondR.reserveAvax(), pondR.totalShares()]); return { ru, ra, ts }; };
  CH.pondAdd = async (v) => {
    await ensureAllowance(U(v), c.pond, usdcR, "Cho phép Ao cá dùng USDC");
    const amount = U(v);
    const { ru, ra, ts } = await pondState();
    const swapIn = (isqrt(ru * (ru * 3_988_009n + amount * 3_988_000n)) - ru * 1_997n) / 1_994n;
    const avaxOut = pondSwapOut(swapIn, ru, ra);
    const a = ((amount - swapIn) * ts) / (ru + swapIn), b = (avaxOut * ts) / (ra - avaxOut);
    return run("Thả cá vào ao", c.pond, pondI, "zapIn", [amount, minus(a < b ? a : b)], GAS.pond);
  };
  /** Take out a fraction (0..1] of the position, paid out in USDC. */
  CH.pondOut = async (fraction = 1) => {
    const p = await pondR.positionOf(CH.account);
    if (p.shares === 0n) throw new Error("Ao đang trống.");
    const shares = fraction >= 1 ? p.shares : (p.shares * BigInt(Math.round(fraction * 10_000))) / 10_000n;
    // zapOut burns first, then sells the gAVAX part into the smaller pool that is left.
    const { ru, ra, ts } = await pondState();
    const usdcPart = (ru * shares) / ts, avaxPart = (ra * shares) / ts;
    const sold = pondSwapOut(avaxPart, ra - avaxPart, ru - usdcPart);
    return run("Vớt cá", c.pond, pondI, "zapOut", [shares, minus(usdcPart + sold)], GAS.pond);
  };
  CH.pondSwap = async (usdcIn, v) => {
    const amount = usdcIn ? U(v) : A(v);
    await ensureAllowance(amount, c.pond, usdcIn ? usdcR : avaxR, usdcIn ? "Cho phép Ao cá dùng USDC" : "Cho phép Ao cá dùng gAVAX");
    const out = await pondR.quote(usdcIn, amount);
    return run(usdcIn ? "Mua gAVAX ở chợ" : "Bán gAVAX ở chợ", c.pond, pondI, "swap", [usdcIn, amount, minus(out)], GAS.pond);
  };

  /** The demo ButlerAccount on Fuji: its agent session key, kill switch and daily cap, read live. */
  CH.readButler = async () => {
    if (!c.butler) return null;
    const b = new E.Contract(c.butler, ABI.butler, rp);
    const [owner, agent, active, cap, left, held, lend] = await Promise.all([
      b.owner(), b.agent(), b.agentActive(), b.dailyCap(), b.remainingToday(), usdcR.balanceOf(c.butler), gameR.lends(c.butler),
    ]);
    return { address: c.butler, owner, agent, active, cap: toNum(cap), left: toNum(left), held: toNum(held), lent: toNum(lend.principal ?? lend[0]) };
  };
  CH.explorerTx = (hash) => (c.explorer ? `${c.explorer.replace(/\/$/, "")}/tx/${hash}` : "");
  CH.errMsg = (e) => {
    const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
    if (e?.code === 4001 || e?.code === "ACTION_REJECTED" || /user rejected|denied/i.test(m)) return "Bạn đã từ chối trong ví.";
    const map = { NotRipe: "Cây chưa chín.", AlreadyWateredToday: "Hôm nay đã tưới cây này rồi.", NothingToSteal: "Vườn này chưa có điểm chín để hái.", Guarded: "Vườn đó có người giữ.", StealCooldown: "Mỗi ngày chỉ hái trộm được một lần.", FarmFull: "Vườn đã kín chỗ (12 cây).", NotAFarmer: "Phải có ít nhất một cây đang trồng mới được hái trộm.", CannotStealFromYourself: "Không thể hái trộm vườn của chính mình.", ExceedsBorrowLimit: "Vượt hạn mức vay (60% giá trị kho thóc).", NotLiquidatable: "Kho thóc này vẫn an toàn, chưa thể thanh lý.", NoDebt: "Không có khoản nợ nào.", StalePrice: "Giá AVAX từ Chainlink đã cũ, tạm dừng vay.", NoLiquidity: "Hợp tác xã tạm hết USDC cho vay.", InsufficientCollateral: "Kho thóc không đủ gAVAX.", Slippage: "Giá trong ao vừa đổi, thử lại.", InsufficientShares: "Bạn không có đủ phần trong ao.", EmptyPool: "Ao chưa có thanh khoản.", ERC20InsufficientBalance: "Ví chưa đủ USDC. Bấm Nhận 1.000 USDC test.", NotEnoughPoints: "Chưa đủ điểm mùa.", Spoiled: "Nông sản đã hỏng (quá 7 ngày).", NotTradable: "Món này không đổi được (huy hiệu gắn với ví của bạn).", NotTransferable: "Vật phẩm chỉ đổi được qua chợ.", OfferClosed: "Đề nghị này đã xong hoặc đã huỷ.", OfferExpired: "Đề nghị đã hết hạn.", NotForYou: "Đề nghị này không dành cho bạn.", WrongItem: "Món đưa ra không khớp với đề nghị.", AlreadyClaimed: "Đã nhận nông sản của cây này rồi.", AlreadyEarned: "Bạn đã có huy hiệu này.", NotEligible: "Chưa đủ điều kiện.", NotForSale: "Món này không bán.", BadOffer: "Đề nghị không hợp lệ.", NotAHat: "Đó không phải nón.", NotDoneYet: "Bạn chưa làm xong nhiệm vụ này.", AllDone: "Bạn đã xong mọi nhiệm vụ.", RewardPoolEmpty: "Quỹ thưởng nhiệm vụ tạm hết, đội ngũ sẽ nạp thêm. Nhiệm vụ vẫn giữ nguyên, nhận sau nhé." };
    for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
    return m.length > 180 ? m.slice(0, 180) + "…" : m;
  };
  CH.checkRelay();
})();
