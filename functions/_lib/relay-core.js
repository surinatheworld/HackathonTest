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
const ALL = [gameIface, coopIface, pondIface, itemsIface, tokenIface];

// Which contracts the fee manager pays for, which functions on each, and where tokens may be approved.
function targets(config) {
  const a = (x) => (x ? ethers.getAddress(x) : null);
  const spenders = [config.game, config.coop, config.pond].filter(Boolean).map(a);
  const t = new Map([[a(config.game), { iface: gameIface }], [a(config.usdc), { iface: tokenIface, spenders }]]);
  if (config.gavax) t.set(a(config.gavax), { iface: tokenIface, spenders: [config.coop, config.pond].filter(Boolean).map(a) });
  if (config.coop) t.set(a(config.coop), { iface: coopIface });
  if (config.pond) t.set(a(config.pond), { iface: pondIface });
  if (config.items) t.set(a(config.items), { iface: itemsIface });
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

export async function relayStatus(env, config) {
  if (!env.RELAYER_PRIVATE_KEY) return json(503, { ready: false, reason: "RELAYER_PRIVATE_KEY chưa được cấu hình." });
  const provider = new ethers.JsonRpcProvider(env.FUJI_RPC_URL || config.rpc, config.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(env.RELAYER_PRIVATE_KEY);
  const bal = await provider.getBalance(wallet.address);
  return json(200, { ready: bal > 0n, relayer: wallet.address, balance: ethers.formatEther(bal), forwarder: config.forwarder });
}

export async function relay(body, env, config) {
  if (!env.RELAYER_PRIVATE_KEY) return json(503, { error: "Fee manager chưa bật: thiếu RELAYER_PRIVATE_KEY." });
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

  const provider = new ethers.JsonRpcProvider(env.FUJI_RPC_URL || config.rpc, config.chainId, { staticNetwork: true });
  const wallet = new ethers.Wallet(env.RELAYER_PRIVATE_KEY, provider);
  const fwd = new ethers.Contract(config.forwarder, FORWARDER_ABI, wallet);
  if (!(await fwd.verify(req))) return json(400, { error: "Chữ ký không hợp lệ, đã dùng hoặc đã hết hạn." });
  // Simulate the inner call exactly as the forwarder will make it (ERC-2771: data ‖ signer, sent by the
  // forwarder), so the player sees the target's own revert reason instead of a generic FailedInnerCall.
  try {
    await provider.call({ from: config.forwarder, to: req.to, data: ethers.concat([req.data, req.from]), gasLimit: req.gas });
  } catch (e) {
    return json(422, { error: "Giao dịch sẽ thất bại: " + explain(e) });
  }
  // One relayer wallet serves every player and the public Fuji RPC does not show pending transactions, so
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
    const rc = await provider.waitForTransaction(tx.hash, 1, 12_000).catch(() => null);
    if (rc) return json(200, { hash: tx.hash, relayer: wallet.address, status: rc.status });
    // not mined in time: either dropped, or still waiting
    if (!(await fwd.verify(req).catch(() => true))) return json(200, { hash: tx.hash, relayer: wallet.address });
  }
  console.warn("[relay] gave up", lastError?.shortMessage || lastError?.message || "not mined");
  return json(503, { error: "Fee manager đang bận, thử lại sau vài giây." });
}
