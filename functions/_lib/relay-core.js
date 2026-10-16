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
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
];
const USDC_ABI = ["function faucet()", "function approve(address spender, uint256 amount)"];
const MAX_GAS = 800_000n;
const MAX_DEADLINE_S = 3600;

const gameIface = new ethers.Interface(GAME_ABI);
const usdcIface = new ethers.Interface(USDC_ABI);

function policy(config, req) {
  const to = ethers.getAddress(req.to);
  const sel = ethers.dataSlice(req.data, 0, 4);
  if (to === ethers.getAddress(config.game)) {
    const fn = gameIface.getFunction(sel);
    if (!fn) return "Hàm này không được trả gas hộ.";
    return null;
  }
  if (to === ethers.getAddress(config.usdc)) {
    const fn = usdcIface.getFunction(sel);
    if (!fn) return "Hàm này không được trả gas hộ.";
    if (fn.name === "approve") {
      const [spender] = usdcIface.decodeFunctionData("approve", req.data);
      if (ethers.getAddress(spender) !== ethers.getAddress(config.game)) return "Chỉ trả gas cho approve tới FarmGame.";
    }
    return null;
  }
  return "Fee manager chỉ trả gas cho contract của Nông Trại DeFi.";
}

function explain(e) {
  const data = e?.data || e?.info?.error?.data || e?.error?.data;
  if (data && typeof data === "string" && data.length >= 10) {
    for (const iface of [gameIface, usdcIface]) {
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
  const tx = await fwd.execute(req, { gasLimit: req.gas + 150_000n });
  return json(200, { hash: tx.hash, relayer: wallet.address });
}
