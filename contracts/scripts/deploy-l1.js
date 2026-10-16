// npx hardhat run scripts/deploy-l1.js --network farml1
const { ethers, network } = require("hardhat");
const { TELEPORTER, DAY_LENGTH, save, blockchainID, requireTeleporter } = require("./common");

async function main() {
  if (network.name !== "farml1") throw new Error("Chạy với --network farml1");
  const [me] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log("Deployer:", me.address, "·", ethers.formatEther(await ethers.provider.getBalance(me)), "native token");
  await requireTeleporter(ethers, `L1 (chainId ${chainId})`);

  const land = await (await ethers.getContractFactory("FarmLand")).deploy(TELEPORTER, DAY_LENGTH);
  await land.waitForDeployment();
  console.log("FarmLand   ", land.target);

  const id = await blockchainID(ethers);
  save("farml1", { chainId: Number(chainId), blockchainID: id, dayLength: DAY_LENGTH, land: land.target, deployer: me.address });
  console.log("L1 blockchainID", id, "→ deployments/farml1.json");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
