// Cloudflare Pages Function: GET /api/village (fee manager totals, news feed, quest leaderboard, neighbours),
// indexed from the Avalanche Data API. Optional env DATA_API_KEY raises the Data API rate limit.
import { village } from "../_lib/village.js";
import config from "../_lib/relay-config.js";

export async function onRequestGet({ env }) {
  try {
    const body = await village(env, config);
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=15" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 502,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
}
