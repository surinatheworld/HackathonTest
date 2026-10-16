// npm run relayer
// Minimal ICM relayer for Nông Trại DeFi, used when the Builder Console managed relayer is down.
// Watches TeleporterMessenger on Fuji and the Game L1 for messages addressed to FarmVault / FarmLand,
// gets them signed by the public Avalanche signature aggregator, and delivers them on the other chain
// with the signed Warp message attached as an access-list predicate.
//
// Env: FUJI_RPC_URL overrides the Fuji RPC (the public one rate-limits bursts of eth_getLogs).
//      RELAYER_PRIVATE_KEY (falls back to PRIVATE_KEY). The key needs AVAX on Fuji and gas token on the L1.
//      RELAYER_ONCE=1 delivers what is pending and exits. RELAYER_C_TO_L1=1 also relays receipts back.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { loadWebConfig } = require("./common");

const TELEPORTER = "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";
const WARP = "0x0200000000000000000000000000000000000005";
const AGGREGATOR = process.env.SIG_AGGREGATOR_URL || "https://glacier-api.avax.network/v1/signatureAggregator/fuji/aggregateSignatures";
const STATE = path.join(__dirname, "..", "deployments", "relayer-state.json");
const POLL_MS = 4000;
const LOOKBACK = Number(process.env.RELAYER_LOOKBACK || 300); // blocks scanned on first start
const CHUNK = 100; // the public Fuji RPC serves at most 100 blocks per eth_getLogs

const TELEPORTER_ABI = [
  "event SendCrossChainMessage(bytes32 indexed messageID, bytes32 indexed destinationBlockchainID, (uint256 messageNonce, address originSenderAddress, bytes32 destinationBlockchainID, address destinationAddress, uint256 requiredGasLimit, address[] allowedRelayerAddresses, (uint256 receivedMessageNonce, address relayerRewardAddress)[] receipts, bytes message) message, (address feeTokenAddress, uint256 amount) feeInfo)",
  "function receiveCrossChainMessage(uint32 messageIndex, address relayerRewardAddress)",
  "function messageReceived(bytes32 messageID) view returns (bool)",
];
const WARP_ABI = ["event SendWarpMessage(address indexed sourceAddress, bytes32 indexed unsignedMessageID, bytes message)"];
const tIface = new ethers.Interface(TELEPORTER_ABI);
const wIface = new ethers.Interface(WARP_ABI);

/** subnet-evm predicate packing: bytes ‖ 0xff, right-padded with zeros to a multiple of 32. */
function packPredicate(hex) {
  const b = ethers.getBytes(hex);
  const len = Math.ceil((b.length + 1) / 32) * 32;
  const out = new Uint8Array(len);
  out.set(b);
  out[b.length] = 0xff;
  const keys = [];
  for (let i = 0; i < len; i += 32) keys.push(ethers.hexlify(out.slice(i, i + 32)));
  return keys;
}

async function aggregate(unsignedHex) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let r, t;
    try {
      r = await fetch(AGGREGATOR, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: unsignedHex.replace(/^0x/, "") }),
        signal: AbortSignal.timeout(30_000),
      });
      t = await r.text();
    } catch (e) {
      console.log(`  aggregator timeout/error (try ${attempt}): ${e.name}`);
      continue;
    }
    if (r.ok) return "0x" + JSON.parse(t).signedMessage.replace(/^0x/, "");
    console.log(`  aggregator ${r.status} (try ${attempt}): ${t.slice(0, 160)}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
  throw new Error("aggregator failed");
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2) + "\n");
}

async function main() {
  const cfg = loadWebConfig();
  if (!cfg?.l1) throw new Error("prototype/chain-config.js chưa có L1. Chạy npm run sync-config trước.");
  const key = process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!key) throw new Error("Thiếu RELAYER_PRIVATE_KEY hoặc PRIVATE_KEY trong contracts/.env");

  const mk = (name, c, app, rpc) => {
    const provider = new ethers.JsonRpcProvider(rpc || c.rpc, c.chainId, { staticNetwork: true });
    const wallet = new ethers.Wallet(key, provider);
    return { name, c, app: app.toLowerCase(), provider, wallet, tele: new ethers.Contract(TELEPORTER, TELEPORTER_ABI, wallet) };
  };
  const fuji = mk("Fuji", cfg.cchain, cfg.cchain.vault, process.env.FUJI_RPC_URL);
  const l1 = mk(cfg.l1.name, cfg.l1, cfg.l1.land);
  // C-Chain → L1 is off by default: the Builder Console managed L1 node stalled block production on a
  // transaction carrying a Fuji Warp message. FarmLand does not need those receipts.
  const routes = [{ src: l1, dst: fuji }];
  if (process.env.RELAYER_C_TO_L1) routes.push({ src: fuji, dst: l1 });
  const me = fuji.wallet.address;
  console.log(`Relayer ${me}`);
  for (const ch of [fuji, l1]) {
    console.log(`  ${ch.name}: ${ethers.formatEther(await ch.provider.getBalance(me))} ${ch.c.currency}`);
  }

  const state = loadState();
  const tick = async () => {
    for (const { src, dst } of routes) {
      const head = await src.provider.getBlockNumber();
      const from = state[src.name] != null ? state[src.name] + 1 : Math.max(0, head - LOOKBACK);
      if (from > head) continue;
      for (let start = from; start <= head; start += CHUNK) {
        const end = Math.min(head, start + CHUNK - 1);
        const logs = await src.provider.getLogs({ address: TELEPORTER, topics: [tIface.getEvent("SendCrossChainMessage").topicHash], fromBlock: start, toBlock: end });
        for (const log of logs) {
          const ev = tIface.parseLog(log);
          const m = ev.args.message;
          if (m.destinationBlockchainID.toLowerCase() !== dst.c.blockchainID.toLowerCase()) continue;
          if (m.destinationAddress.toLowerCase() !== dst.app) continue;
          const id = ev.args.messageID;
          if (await dst.tele.messageReceived(id)) continue;
          const receipt = await src.provider.getTransactionReceipt(log.transactionHash);
          const wlog = receipt.logs.find((l) => l.address.toLowerCase() === WARP.toLowerCase() && l.index < log.index + 2 && l.index >= log.index - 2) ||
            receipt.logs.find((l) => l.address.toLowerCase() === WARP.toLowerCase());
          const unsigned = wIface.parseLog(wlog).args.message;
          console.log(`${src.name} → ${dst.name}: message #${m.messageNonce} (${id.slice(0, 10)}…) from tx ${log.transactionHash.slice(0, 10)}…`);
          const signed = await aggregate(unsigned);
          const tx = await dst.tele.receiveCrossChainMessage(0, me, {
            accessList: [{ address: WARP, storageKeys: packPredicate(signed) }],
            gasLimit: m.requiredGasLimit + 700_000n,
          });
          const rc = await tx.wait();
          console.log(`  delivered on ${dst.name}: tx ${rc.hash} · gas ${rc.gasUsed}`);
        }
        state[src.name] = end;
        saveState(state);
        if (end < head) await new Promise((r) => setTimeout(r, 250)); // stay under public RPC rate limits
      }
    }
  };

  for (;;) {
    try {
      await tick();
    } catch (e) {
      console.error("tick error:", e.shortMessage || e.message);
    }
    if (process.env.RELAYER_ONCE) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
