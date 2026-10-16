// npx hardhat run scripts/deploy-fuji.js --network fuji
const { ethers, network } = require("hardhat");
const { TELEPORTER, DAY_LENGTH, save, blockchainID, requireTeleporter } = require("./common");

async function main() {
  if (network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const [me] = await ethers.getSigners();
  console.log("Deployer:", me.address, "·", ethers.formatEther(await ethers.provider.getBalance(me)), "AVAX");
  await requireTeleporter(ethers, "Fuji C-Chain");

  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await usdc.waitForDeployment();
  console.log("MockUSDC   ", usdc.target);

  const vault = await (await ethers.getContractFactory("FarmVault")).deploy(TELEPORTER, usdc.target, DAY_LENGTH);
  await vault.waitForDeployment();
  console.log("FarmVault  ", vault.target);

  // Sponsor pool: the mock yield for the MVP.
  const pool = ethers.parseUnits("50000", 6);
  await (await usdc.mint(me.address, pool)).wait();
  await (await usdc.approve(vault.target, pool)).wait();
  await (await vault.fundRewards(pool)).wait();
  console.log("Reward pool funded: 50,000 USDC");

  // Demo butler account owned by the deployer; the agent key is set later with butler-demo.js.
  const butler = await (await ethers.getContractFactory("ButlerAccount")).deploy(me.address, DAY_LENGTH);
  await butler.waitForDeployment();
  const sel = (c, f) => c.interface.getFunction(f).selector;
  await (await butler.setRule(usdc.target, sel(usdc, "approve"), true, 0, vault.target)).wait();
  await (await butler.setRule(vault.target, sel(vault, "deposit"), true, 1, ethers.ZeroAddress)).wait();
  await (await butler.setRule(vault.target, sel(vault, "claim"), true, 0, ethers.ZeroAddress)).wait();
  console.log("ButlerAccount", butler.target);

  const id = await blockchainID(ethers);
  save("fuji", {
    chainId: 43113,
    blockchainID: id,
    dayLength: DAY_LENGTH,
    usdc: usdc.target,
    vault: vault.target,
    butler: butler.target,
    deployer: me.address,
  });
  console.log("Fuji blockchainID", id, "→ deployments/fuji.json");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
