// Village indexer: reads the farm's history from the Avalanche Data API (data-api.avax.network, no node or
// subgraph of our own) and turns it into what the game shows: fee manager totals, a village news feed, the
// quest leaderboard and recently active neighbours. Cached for 30 s per Cloudflare isolate and colo.
import { ethers } from "./ethers.min.js";
import { relayerKeys } from "./relay-core.js";

const API = "https://data-api.avax.network/v1/chains";
const TTL_S = 30;
const PAGES = 10; // 100 items per page

let memo = null;

async function list(env, chainId, path, key, pages = PAGES) {
  const out = [];
  let token = "";
  const headers = env.DATA_API_KEY ? { "x-glacier-api-key": env.DATA_API_KEY } : {};
  for (let i = 0; i < pages; i++) {
    const url = `${API}/${chainId}/${path}${path.includes("?") ? "&" : "?"}pageSize=100${token ? `&pageToken=${token}` : ""}`;
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Data API ${r.status} ${path}`);
    const j = await r.json();
    out.push(...(j[key] || []));
    token = j.nextPageToken;
    if (!token) return { items: out, complete: true };
  }
  return { items: out, complete: false };
}

const lc = (a) => (a || "").toLowerCase();
const usd = (v) => Number(v) / 1e6;

function label(t, c) {
  const from = lc(t.from.address), to = lc(t.to.address), v = usd(t.value);
  const ZERO = "0x0000000000000000000000000000000000000000";
  if (from === ZERO) return { who: to, text: `nhận ${v} USDC test` };
  if (from === c.quests) return { who: to, text: `xong một nhiệm vụ, được thưởng ${v} USDC` };
  if (to === c.game) return { who: from, text: `gieo ${v} USDC vào ruộng` };
  if (from === c.game) return { who: to, text: `thu về ${v} USDC từ ruộng` };
  if (from === c.coop) return { who: to, text: `vay ${v} USDC ở Hợp tác xã` };
  if (to === c.coop) return { who: from, text: `trả ${v} USDC cho Hợp tác xã` };
  if (to === c.pond) return { who: from, text: `thả ${v} USDC xuống Ao cá` };
  if (from === c.pond) return { who: to, text: `vớt ${v} USDC từ Ao cá` };
  return null;
}

async function build(env, config) {
  const chainId = config.chainId;
  const c = Object.fromEntries(Object.entries(config).map(([k, v]) => [k, lc(String(v))]));
  // Not players: the farm contracts and the team's own wallets (fee manager pool, which is also the deployer).
  const contracts = new Set([c.game, c.coop, c.pond, c.quests, c.items, c.forwarder, c.usdc, c.gavax].filter(Boolean));
  if (env.RELAYER_PRIVATE_KEY) for (const k of relayerKeys(env)) contracts.add(lc(new ethers.Wallet(k).address));
  const [txs, transfers, rewards] = await Promise.all([
    list(env, chainId, `addresses/${config.forwarder}/transactions`, "transactions"),
    list(env, chainId, `tokens/${config.usdc}/transfers`, "transfers", 3),
    config.quests ? list(env, chainId, `addresses/${config.quests}/transactions:listErc20`, "transactions") : { items: [], complete: true },
  ]);

  // Fee manager: every FarmForwarder.execute is one transaction the fee manager paid for.
  const now = Date.now() / 1000;
  let gasWei = 0n, day = 0;
  const relayers = new Set();
  for (const { nativeTransaction: t } of txs.items) {
    if (!/^execute/.test(t.method?.methodName || "")) continue;
    gasWei += BigInt(t.gasUsed || 0) * BigInt(t.gasPrice || 0);
    if (now - t.blockTimestamp < 86_400) day++;
    relayers.add(lc(t.from.address));
  }
  const sponsored = txs.items.filter(({ nativeTransaction: t }) => /^execute/.test(t.method?.methodName || "")).length;

  // News feed and neighbours from the latest test-USDC transfers.
  const activity = [];
  const farmers = new Map();
  for (const t of transfers.items) {
    const l = label(t, c);
    if (!l || contracts.has(l.who)) continue;
    if (activity.length < 15) activity.push({ who: l.who, text: l.text, at: t.blockTimestamp, tx: t.txHash });
    if (!farmers.has(l.who)) farmers.set(l.who, t.blockTimestamp);
  }

  // Quest leaderboard: each reward transfer out of FarmQuests is one completed quest.
  const done = new Map();
  for (const t of rewards.items) {
    const tr = t.erc20Transfer || t;
    if (lc(tr.from?.address) !== c.quests) continue;
    const who = lc(tr.to?.address);
    const e = done.get(who) || { who, quests: 0, usdc: 0, at: 0 };
    e.quests++;
    e.usdc += usd(tr.value);
    e.at = Math.max(e.at, tr.blockTimestamp || t.blockTimestamp || 0);
    done.set(who, e);
  }
  const leaderboard = [...done.values()].sort((a, b) => b.quests - a.quests || a.at - b.at).slice(0, 10);

  return {
    updatedAt: Math.floor(now),
    source: "Avalanche Data API",
    stats: {
      sponsoredTxs: sponsored,
      sponsoredTxsComplete: txs.complete,
      sponsoredLast24h: day,
      gasPaidAvax: Number(gasWei) / 1e18,
      relayersUsed: relayers.size,
      questsCompleted: [...done.values()].reduce((a, e) => a + e.quests, 0),
    },
    activity,
    leaderboard,
    farmers: [...farmers.entries()].slice(0, 12).map(([who, at]) => ({ who, at })),
  };
}

export async function village(env, config) {
  const fresh = (m) => m && Date.now() / 1000 - m.updatedAt < TTL_S;
  if (fresh(memo)) return memo;
  const cache = globalThis.caches?.default;
  const key = "https://village.nongtrai.internal/v1";
  try {
    const hit = cache && (await cache.match(key));
    if (hit) {
      const m = await hit.json();
      if (fresh(m)) return (memo = m);
    }
  } catch {}
  memo = await build(env, config);
  try {
    if (cache) await cache.put(key, new Response(JSON.stringify(memo), { headers: { "cache-control": `max-age=${TTL_S}` } }));
  } catch {}
  return memo;
}
