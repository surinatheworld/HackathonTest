// npm run verify:fuji
// Publishes the source of the Fuji gasless stack on testnet.snowtrace.io (via Routescan).
const hre = require("hardhat");
const { load } = require("./common");

async function verify(label, address, constructorArguments) {
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`✓ ${label} ${address}`);
  } catch (e) {
    const m = String(e.message || e);
    console.log(/already verified/i.test(m) ? `✓ ${label} ${address} (đã verify trước đó)` : `✗ ${label} ${address}: ${m.split("\n")[0]}`);
  }
}

async function main() {
  if (hre.network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const d = load("fuji-gasless");
  if (!d) throw new Error("Chưa deploy (deployments/fuji-gasless.json).");
  await verify("FarmForwarder", d.forwarder, []);
  await verify("GaslessUSDC", d.usdc, [d.forwarder]);
  await verify("FarmGame", d.game, [d.forwarder, d.usdc, d.dayLength]);
  await verify("ButlerAccount", d.butler, [d.deployer, d.dayLength]);
  if (d.coop) {
    await verify("GaslessAVAX", d.gavax, [d.forwarder]);
    await verify("FarmCoop", d.coop, [d.forwarder, d.usdc, d.gavax, d.chainlinkAvaxUsd, d.maxPriceAge, d.dayLength]);
    await verify("FarmPond", d.pond, [d.forwarder, d.usdc, d.gavax]);
    await verify("MockYieldSource", d.yieldSource, [d.usdc, d.game, 500, d.dayLength]);
    await verify("DemoPriceFeed", d.demoFeed, [d.demoFeedSeed]);
  }
  console.log(`Xem: https://testnet.snowtrace.io/address/${d.game}#code`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
