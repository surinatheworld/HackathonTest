// npm run fund:relayers
// Tops up the fee manager's relayer pool from the deployer wallet (PRIVATE_KEY in .env). The pool addresses
// come from GET /api/relay, so the relayer key never has to leave Cloudflare, but only addresses also listed in
// functions/_lib/relay-config.js (relayers) get AVAX: a wrong or preview URL cannot pick the recipients.
// Env: RELAY_STATUS_URL (default: the live site), RELAYER_TARGET_AVAX (default 0.05), DRY=1 to only print.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { fujiProvider } = require("./common");

const URL_ = process.env.RELAY_STATUS_URL || "https://hanazono-b9s.pages.dev/api/relay";
const TARGET = ethers.parseEther(process.env.RELAYER_TARGET_AVAX || "0.05");

async function main() {
  const status = await (await fetch(URL_, { cache: "no-store" })).json();
  if (!status.pool) throw new Error(`${URL_} chưa trả về danh sách ví (pool). Deploy bản fee manager mới trước.`);
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "functions", "_lib", "relay-config.js"), "utf8").match(/export default ([\s\S]*);\s*$/)[1]);
  const known = new Set((cfg.relayers || []).map((a) => a.toLowerCase()));
  const strange = status.pool.filter((w) => !known.has(String(w.address).toLowerCase()));
  if (strange.length) throw new Error(`${URL_} trả về ví không có trong relay-config.js: ${strange.map((w) => w.address).join(", ")}. Không nạp.`);
  const provider = await fujiProvider(ethers);
  const funder = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Ví nạp: ${funder.address} (${ethers.formatEther(await provider.getBalance(funder.address))} AVAX)`);
  if (known.has(funder.address.toLowerCase())) throw new Error("Ví nạp (PRIVATE_KEY) đang là ví trả gas. Dùng ví deploy riêng, không để trên Cloudflare.");
  for (const [i, w] of status.pool.entries()) {
    const bal = await provider.getBalance(w.address);
    const need = TARGET - bal;
    console.log(`#${i} ${w.address}  ${ethers.formatEther(bal)} AVAX${need > 0n ? `  → nạp ${ethers.formatEther(need)}` : ""}`);
    if (need <= 0n || process.env.DRY) continue;
    const tx = await funder.sendTransaction({ to: w.address, value: need });
    await tx.wait();
    console.log(`   ${tx.hash}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
