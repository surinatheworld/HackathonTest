// npm run verify:fuji
// Publishes the source of MockUSDC, FarmVault and ButlerAccount on testnet.snowtrace.io so judges can read it.
// Addresses come from prototype/chain-config.js (sync-config) or deployments/fuji.json (script deploy).
// The bytecode deploy.html uses is exported from this same compile, so the sources match.
const hre = require("hardhat");
const { TELEPORTER, load, loadWebConfig } = require("./common");

async function verify(label, address, constructorArguments) {
  if (!address) return console.log(`- ${label}: không có địa chỉ, bỏ qua`);
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`✓ ${label} ${address}`);
  } catch (e) {
    const m = String(e.message || e);
    if (/already verified/i.test(m)) console.log(`✓ ${label} ${address} (đã verify trước đó)`);
    else console.log(`✗ ${label} ${address}: ${m.split("\n")[0]}`);
  }
}

async function main() {
  if (hre.network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const web = loadWebConfig();
  const file = load("fuji");
  const c = web?.cchain || file;
  if (!c?.vault) throw new Error("Chưa có địa chỉ contract. Chạy npm run sync-config -- <ví owner> trước.");
  const dayLength = web?.dayLength ?? file?.dayLength;
  const owner = web?.owner ?? file?.deployer;

  await verify("MockUSDC", c.usdc, []);
  await verify("FarmVault", c.vault, [TELEPORTER, c.usdc, dayLength]);
  await verify("ButlerAccount", c.butler, [owner, dayLength]);
  console.log(`Xem: https://testnet.snowtrace.io/address/${c.vault}#code`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
