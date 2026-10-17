// Fee manager core: checks a player's signed ERC-2771 ForwardRequest against a strict policy, then
// submits it through FarmForwarder and pays the gas. Shared by the Cloudflare Pages Function
// (functions/api/relay.js) and the local dev server.
import { ethers } from "./ethers.min.js";

const FORWARDER_ABI = [
  "function execute((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) payable",
  "function verify((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request) view returns (bool)",
];
const GAME_ABI = [
  "function plant(uint8 tier, uint256 amount)",
  "function harvest(uint256 cropId)",
  "function uproot(uint256 cropId)",
  "function water(uint256 cropId)",
  "function collect()",
  "function steal(address victim)",
  "function setGuard(bool guarded)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "error NotRipe(uint256 readyAt)",
  "error NotYourCrop()",
  "error WrongStatus(uint8 status)",
  "error AlreadyWateredToday()",
  "error FarmFull()",
  "error BadTier()",
  "error ZeroAmount()",
  "error InsufficientPrincipal()",
  "error Guarded()",
  "error StealCooldown()",
  "error NothingToSteal()",
  "error NotAFarmer()",
  "error CannotStealFromYourself()",
];
const TOKEN_ABI = [
  "function faucet()",
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
];
const COOP_ABI = [
  "function depositCollateral(uint256 amount)",
  "function withdrawCollateral(uint256 amount)",
  "function borrow(uint256 amount)",
  "function repay(address user, uint256 amount)",
  "function liquidate(address user)",
  "error ZeroAmount()",
  "error InsufficientCollateral()",
  "error ExceedsBorrowLimit(uint256 maxBorrow)",
  "error NoDebt()",
  "error NotLiquidatable(uint256 healthBps)",
  "error StalePrice(uint256 updatedAt)",
  "error BadPrice()",
  "error NoLiquidity(uint256 available)",
];
const ITEMS_ABI = [
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
  "error NotTransferable()",
  "error NotYourCrop()",
  "error NotHarvested()",
  "error AlreadyClaimed()",
  "error AlreadyEarned()",
  "error NotEligible()",
  "error NotForSale()",
  "error NotEnoughPoints(uint256 have, uint256 need)",
  "error Spoiled(uint256 id)",
  "error NotTradable(uint256 id)",
  "error BadOffer()",
  "error OfferClosed()",
  "error OfferExpired()",
  "error NotForYou()",
  "error WrongItem(uint256 want, uint256 got)",
  "error NotAHat()",
];
const QUESTS_ABI = ["function complete()", "error NotDoneYet(uint256 quest)", "error AllDone()"];
const POND_ABI = [
  "function addLiquidity(uint256 usdcAmount, uint256 maxAvax, uint256 minShares)",
  "function zapIn(uint256 usdcAmount, uint256 minShares)",
  "function removeLiquidity(uint256 shares, uint256 minUsdc, uint256 minAvax)",
  "function zapOut(uint256 shares, uint256 minUsdc)",
  "function swap(bool usdcIn, uint256 amountIn, uint256 minOut)",
  "error ZeroAmount()",
  "error Slippage(uint256 got, uint256 min)",
  "error InsufficientShares()",
  "error EmptyPool()",
];
const MAX_GAS = 800_000n;
const MAX_DEADLINE_S = 3600;

const gameIface = new ethers.Interface(GAME_ABI);
const tokenIface = new ethers.Interface(TOKEN_ABI);
const coopIface = new ethers.Interface(COOP_ABI);
const pondIface = new ethers.Interface(POND_ABI);
const itemsIface = new ethers.Interface(ITEMS_ABI);
const questsIface = new ethers.Interface(QUESTS_ABI);
const ALL = [gameIface, coopIface, pondIface, itemsIface, questsIface, tokenIface];

// Which contracts the fee manager pays for, which functions on each, and where tokens may be approved.
function targets(config) {
  const a = (x) => (x ? ethers.getAddress(x) : null);
  const spenders = [config.game, config.coop, config.pond].filter(Boolean).map(a);
  const t = new Map([[a(config.game), { iface: gameIface }], [a(config.usdc), { iface: tokenIface, spenders }]]);
  if (config.gavax) t.set(a(config.gavax), { iface: tokenIface, spenders: [config.coop, config.pond].filter(Boolean).map(a) });
  if (config.coop) t.set(a(config.coop), { iface: coopIface });
  if (config.pond) t.set(a(config.pond), { iface: pondIface });
  if (config.items) t.set(a(config.items), { iface: itemsIface });
  if (config.quests) t.set(a(config.quests), { iface: questsIface });
  return t;
}

function policy(config, req) {
  const rule = targets(config).get(ethers.getAddress(req.to));
  if (!rule) return "Fee manager chỉ trả gas cho contract của Nông Trại DeFi.";
  const fn = rule.iface.getFunction(ethers.dataSlice(req.data, 0, 4));
  if (!fn) return "Hàm này không được trả gas hộ.";
  if (fn.name === "approve") {
    const [spender] = rule.iface.decodeFunctionData("approve", req.data);
    if (!rule.spenders.includes(ethers.getAddress(spender))) return "Chỉ trả gas cho approve tới contract của Nông Trại DeFi.";
  }
  return null;
}

function explain(e) {
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  if (data && typeof data === "string" && data.length >= 10) {
    for (const iface of ALL) {
      try {
        const p = iface.parseError(data);
        if (p) return p.name;
      } catch {}
    }
  }
  return e?.shortMessage || e?.reason || e?.message || String(e);
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// Rate limits, so a stranger with many fresh wallets cannot drain the relayer pool. Counters live in this
// isolate's memory and, where Cloudflare offers it, the colo's Cache API; both are best effort and reset
// with the window. Limits per IP stay loose because a whole classroom can share one IP.
const LIMITS = {
  ip: [{ n: 300, s: 60 }, { n: 10_000, s: 86_400 }],
  wallet: [{ n: 40, s: 60 }, { n: 500, s: 86_400 }],
};
const counters = new Map();

async function bump(id, windowS) {
  const slot = Math.floor(Date.now() / 1000 / windowS);
  const key = `${id}:${windowS}:${slot}`;
  let n = (counters.get(key) || 0) + 1;
  counters.set(key, n);
  if (counters.size > 5000) for (const k of counters.keys()) if (!k.endsWith(`:${windowS}:${slot}`)) counters.delete(k);
  try {
    const cache = globalThis.caches?.default;
    if (cache) {
      const url = "https://rate-limit.nongtrai.internal/" + encodeURIComponent(key);
      const hit = await cache.match(url);
      n = Math.max(n, (hit ? Number(await hit.text()) || 0 : 0) + 1);
      await cache.put(url, new Response(String(n), { headers: { "cache-control": `max-age=${windowS}` } }));
    }
  } catch {}
  return n;
}

async function limited(kind, id) {
  if (!id) return null;
  for (const { n, s } of LIMITS[kind]) {
    if ((await bump(`${kind}:${id}`, s)) > n) {
      const wait = s - (Math.floor(Date.now() / 1000) % s);
      const msg = s < 3600 ? "Bạn thao tác nhanh quá, đợi một phút rồi thử lại." : "Hôm nay bạn đã dùng hết lượt được trả gas hộ, mai quay lại nhé.";
      return new Response(JSON.stringify({ error: msg }), {
        status: 429,
        headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": String(wait) },
      });
    }
  }
  return null;
}

// Relayer pool: the configured key plus child keys derived from it, so no extra secret is needed. Each player
// sticks to one wallet (picked from their address), so players spread over the pool and stop racing for the
// same nonce. A child wallet with too little AVAX is skipped; fund them with `npm run fund:relayers`.
const POOL_SIZE = 4;
const MIN_BALANCE = ethers.parseEther("0.01");

export function relayerKeys(env) {
  const base = ethers.hexlify(env.RELAYER_PRIVATE_KEY.startsWith("0x") ? env.RELAYER_PRIVATE_KEY : "0x" + env.RELAYER_PRIVATE_KEY);
  const n = Math.max(1, Math.min(16, Number(env.RELAYER_POOL_SIZE) || POOL_SIZE));
  const keys = [base];
  for (let i = 1; i < n; i++) keys.push(ethers.keccak256(ethers.solidityPacked(["bytes32", "string", "uint8"], [base, "nong-trai-relayer", i])));
  return keys;
}

async function pickWallet(env, provider, from) {
  const keys = relayerKeys(env);
  const start = Number(BigInt(ethers.keccak256(from)) % BigInt(keys.length));
  for (let k = 0; k < keys.length; k++) {
    const i = (start + k) % keys.length;
    const w = new ethers.Wallet(keys[i], provider);
    if (i === 0 || (await provider.getBalance(w.address)) >= MIN_BALANCE) return w;
  }
}

export async function relayStatus(env, config) {
  if (!env.RELAYER_PRIVATE_KEY) return json(503, { ready: false, reason: "RELAYER_PRIVATE_KEY chưa được cấu hình." });
  const provider = new ethers.JsonRpcProvider(env.FUJI_RPC_URL || config.rpc, config.chainId, { staticNetwork: true });
  const addrs = relayerKeys(env).map((k) => new ethers.Wallet(k).address);
  const bals = await Promise.all(addrs.map((a) => provider.getBalance(a)));
  const total = bals.reduce((a, b) => a + b, 0n);
  return json(200, {
    ready: bals[0] > 0n || bals.some((b) => b >= MIN_BALANCE),
    relayer: addrs[0],
    balance: ethers.formatEther(total),
    pool: addrs.map((a, i) => ({ address: a, balance: ethers.formatEther(bals[i]), active: i === 0 || bals[i] >= MIN_BALANCE })),
    forwarder: config.forwarder,
  });
}

export async function relay(body, env, config, meta = {}) {
  if (!env.RELAYER_PRIVATE_KEY) return json(503, { error: "Fee manager chưa bật: thiếu RELAYER_PRIVATE_KEY." });
  const ipLimit = await limited("ip", meta.ip);
  if (ipLimit) return ipLimit;
  const r = body?.request;
  if (!r || !r.from || !r.to || !r.data || !r.signature) return json(400, { error: "Thiếu request." });
  let req;
  try {
    req = {
      from: ethers.getAddress(r.from),
      to: ethers.getAddress(r.to),
      value: BigInt(r.value ?? 0),
      gas: BigInt(r.gas),
      deadline: Number(r.deadline),
      data: ethers.hexlify(r.data),
      signature: ethers.hexlify(r.signature),
    };
  } catch {
    return json(400, { error: "Request không hợp lệ." });
  }
  if (req.value !== 0n) return json(400, { error: "Không hỗ trợ gửi kèm tiền." });
  if (req.gas > MAX_GAS) return json(400, { error: "Gas vượt hạn mức của fee manager." });
  const now = Math.floor(Date.now() / 1000);
  if (req.deadline < now || req.deadline > now + MAX_DEADLINE_S) return json(400, { error: "Hạn của request không hợp lệ." });
  const deny = policy(config, req);
  if (deny) return json(403, { error: deny });
  const walletLimit = await limited("wallet", req.from);
  if (walletLimit) return walletLimit;

  const provider = new ethers.JsonRpcProvider(env.FUJI_RPC_URL || config.rpc, config.chainId, { staticNetwork: true });
  const wallet = await pickWallet(env, provider, req.from);
  const fwd = new ethers.Contract(config.forwarder, FORWARDER_ABI, wallet);
  if (!(await fwd.verify(req))) return json(400, { error: "Chữ ký không hợp lệ, đã dùng hoặc đã hết hạn." });
  // Simulate the inner call exactly as the forwarder will make it (ERC-2771: data ‖ signer, sent by the
  // forwarder), so the player sees the target's own revert reason instead of a generic FailedInnerCall.
  try {
    await provider.call({ from: config.forwarder, to: req.to, data: ethers.concat([req.data, req.from]), gasLimit: req.gas });
  } catch (e) {
    return json(422, { error: "Giao dịch sẽ thất bại: " + explain(e) });
  }
  // Several players can share one pool wallet and the public Fuji RPC does not show pending transactions, so
  // requests arriving together can pick the same nonce: the node keeps one and silently drops the others.
  // So only answer once the transaction is mined (Fuji: ~2 s). If it was dropped, the forwarder still accepts
  // the request (verify() is true until it runs), and it is sent again with a fresh nonce. It can never run twice.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt) await sleep(200 + Math.random() * 700);
    let tx;
    try {
      const nonce = await provider.getTransactionCount(wallet.address, "latest");
      tx = await fwd.execute(req, { gasLimit: req.gas + 150_000n, nonce });
    } catch (e) {
      lastError = e;
      const m = String(e?.shortMessage || e?.message || e);
      if (/nonce|replacement|already known|underpriced/i.test(m)) continue;
      throw e;
    }
    const rc = await provider.waitForTransaction(tx.hash, 1, 6_000).catch(() => null);
    if (rc) return json(200, { hash: tx.hash, relayer: wallet.address, status: rc.status });
    // not mined in time: either dropped, or still waiting
    if (!(await fwd.verify(req).catch(() => true))) return json(200, { hash: tx.hash, relayer: wallet.address });
  }
  console.warn("[relay] gave up", lastError?.shortMessage || lastError?.message || "not mined");
  return json(503, { error: "Fee manager đang bận, thử lại sau vài giây." });
}
