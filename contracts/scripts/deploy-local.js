// npx hardhat run scripts/deploy-local.js --network localhost
// Local copy of the Fuji gasless stack: FarmForwarder, GaslessUSDC, FarmGame, ButlerAccount.
const { ethers } = require("hardhat");
const { DAY_LENGTH, save } = require("./common");

async function main() {
  const [me] = await ethers.getSigners();
  const fwd = await (await ethers.getContractFactory("FarmForwarder")).deploy();
  const usdc = await (await ethers.getContractFactory("GaslessUSDC")).deploy(fwd);
  const game = await (await ethers.getContractFactory("FarmGame")).deploy(fwd, usdc, DAY_LENGTH);
  const butler = await (await ethers.getContractFactory("ButlerAccount")).deploy(me, DAY_LENGTH);
  const pool = ethers.parseUnits("50000", 6);
  await (await usdc.mint(me, pool)).wait();
  await (await usdc.approve(game, pool)).wait();
  await (await game.fundRewards(pool)).wait();
  const out = { chainId: 31337, dayLength: DAY_LENGTH, forwarder: fwd.target, usdc: usdc.target, game: game.target, butler: butler.target };
  save("local", out);
  console.log("Local gasless stack:", out);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
