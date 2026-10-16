// npx hardhat run scripts/deploy-local.js --network localhost
// Local copy of the Fuji gasless stack. There is no Chainlink locally, so FarmCoop reads DemoPriceFeed.
const { ethers } = require("hardhat");
const { DAY_LENGTH, save } = require("./common");

async function main() {
  const [me] = await ethers.getSigners();
  const U = (n) => ethers.parseUnits(String(n), 6);
  const deploy = async (name, ...args) => (await ethers.getContractFactory(name)).deploy(...args);
  const send = async (p) => (await p).wait();
  const fwd = await deploy("FarmForwarder");
  const usdc = await deploy("GaslessUSDC", fwd);
  const gavax = await deploy("GaslessAVAX", fwd);
  const game = await deploy("FarmGame", fwd, usdc, DAY_LENGTH);
  const demoFeed = await deploy("DemoPriceFeed", ethers.parseUnits("10", 8));
  const coop = await deploy("FarmCoop", fwd, usdc, gavax, demoFeed, 365 * 86400, DAY_LENGTH);
  const pond = await deploy("FarmPond", fwd, usdc, gavax);
  const butler = await deploy("ButlerAccount", me, DAY_LENGTH);
  await send(usdc.mint(me, U(120000)));
  await send(usdc.approve(game, U(50000)));
  await send(game.fundRewards(U(50000)));
  await send(usdc.approve(coop, U(50000)));
  await send(coop.fund(U(50000)));
  await send(gavax.mint(me, ethers.parseUnits("2000", 18)));
  await send(usdc.approve(pond, U(20000)));
  await send(gavax.approve(pond, ethers.parseUnits("2000", 18)));
  await send(pond.addLiquidity(U(20000), ethers.parseUnits("2000", 18), 0));
  const out = {
    chainId: 31337, dayLength: DAY_LENGTH, forwarder: fwd.target, usdc: usdc.target, gavax: gavax.target, game: game.target,
    coop: coop.target, pond: pond.target, butler: butler.target, demoFeed: demoFeed.target,
  };
  save("local", out);
  console.log("Local gasless stack:", out);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
