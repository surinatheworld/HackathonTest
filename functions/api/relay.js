// Cloudflare Pages Function: POST /api/relay  (GET for status)
// Needs the encrypted environment variable RELAYER_PRIVATE_KEY (a testnet key holding Fuji AVAX).
import { relay, relayStatus } from "../_lib/relay-core.js";
import config from "../_lib/relay-config.js";

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Body phải là JSON." }), { status: 400 });
  }
  try {
    return await relay(body, env, config, { ip: request.headers.get("cf-connecting-ip") });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.shortMessage || e?.message || String(e) }), { status: 500 });
  }
}

export async function onRequestGet({ env }) {
  try {
    return await relayStatus(env, config);
  } catch (e) {
    return new Response(JSON.stringify({ ready: false, error: e?.message || String(e) }), { status: 500 });
  }
}
