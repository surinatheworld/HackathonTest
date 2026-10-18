// Cloudflare Pages Function: POST /api/relay  (GET for status)
// Needs the encrypted environment variable RELAYER_PRIVATE_KEY (a testnet key holding Fuji AVAX).
// Errors never echo raw provider messages: they can carry the key (if it was pasted wrongly) or a keyed RPC URL.
import { relay, relayStatus, publicMessage, statusLimited } from "../_lib/relay-core.js";
import config from "../_lib/relay-config.js";

const fail = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return fail(400, { error: "Body phải là JSON." });
  }
  try {
    return await relay(body, env, config, { ip: request.headers.get("cf-connecting-ip") });
  } catch (e) {
    console.error("[relay]", e?.shortMessage || e?.code || "error");
    return fail(500, { error: publicMessage(e) });
  }
}

export async function onRequestGet({ request, env }) {
  const limit = await statusLimited(request.headers.get("cf-connecting-ip"));
  if (limit) return limit;
  try {
    return await relayStatus(env, config);
  } catch (e) {
    console.error("[relay status]", e?.shortMessage || e?.code || "error");
    return fail(500, { ready: false, error: publicMessage(e) });
  }
}
