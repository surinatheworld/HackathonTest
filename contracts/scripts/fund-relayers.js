// npm run fund:relayers
// Tops up the fee manager's relayer pool from the deployer wallet (PRIVATE_KEY in .env). The pool addresses
// come from GET /api/relay, so the relayer key never has to leave Cloudflare.
// Env: RELAY_STATUS_URL (default: the live site), RELAYER_TARGET_AVAX (default 0.05), DRY=1 to only print.
require("dotenv").config();
const { ethers } = require("ethers");

const URL_ = process.env.RELAY_STATUS_URL || "https://hanazono-b9s.pages.dev/api/relay";
const TARGET = ethers.parseEther(process.env.RELAYER_TARGET_AVAX || "0.05");

async function main() {
  const status = await (await fetch(URL_, { cache: "no-store" })).json();
  if (!status.pool) throw new Error(`${URL_} chưa trả về danh sách ví (pool). Deploy bản fee manager mới trước.`);
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc", 43113);
  const funder = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  console.log(`Ví nạp: ${funder.address} (${ethers.formatEther(await provider.getBalance(funder.address))} AVAX)`);
  if (status.pool.some((w) => w.address.toLowerCase() === funder.address.toLowerCase()))
    console.log("Lưu ý: ví nạp cũng là ví trả gas #0. Giữ nó trên 0,01 AVAX, dưới mức đó fee manager bỏ qua nó.");
  for (const [i, w] of status.pool.entries()) {
    const bal = await provider.getBalance(w.address);
    // Every pool wallet is topped up, the first one too, unless it is the funding wallet itself.
    const need = w.address.toLowerCase() === funder.address.toLowerCase() ? 0n : TARGET - bal;
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
