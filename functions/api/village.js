// Cloudflare Pages Function: GET /api/village (fee manager totals, news feed, quest leaderboard, neighbours),
// indexed from the Avalanche Data API. Optional env DATA_API_KEY raises the Data API rate limit.
import { village } from "../_lib/village.js";
import { publicMessage, statusLimited } from "../_lib/relay-core.js";
import config from "../_lib/relay-config.js";

export async function onRequestGet({ request, env }) {
  const limit = await statusLimited(request.headers.get("cf-connecting-ip"));
  if (limit) return limit;
  try {
    const body = await village(env, config);
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=15, stale-while-revalidate=60" },
    });
  } catch (e) {
    console.error("[village]", e?.shortMessage || e?.code || "error");
    return new Response(JSON.stringify({ error: publicMessage(e) }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
