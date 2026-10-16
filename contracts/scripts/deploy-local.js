// npx hardhat run scripts/deploy-local.js --network localhost
// Local stand-in for both chains: one Hardhat node, a MockTeleporter acting as messenger + relayer.
const { ethers } = require("hardhat");
const { DAY_LENGTH, save } = require("./common");

async function main() {
  const [me] = await ethers.getSigners();
  const tele = await (await ethers.getContractFactory("MockTeleporter")).deploy();
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault = await (await ethers.getContractFactory("FarmVault")).deploy(tele, usdc, DAY_LENGTH);
  const land = await (await ethers.getContractFactory("FarmLand")).deploy(tele, DAY_LENGTH);
  const cID = ethers.id("local-c-chain");
  const lID = ethers.id("local-farm-l1");
  await (await tele.setChain(vault, cID)).wait();
  await (await tele.setChain(land, lID)).wait();
  await (await vault.setRemote(lID, land)).wait();
  await (await land.setRemote(cID, vault)).wait();
  const pool = ethers.parseUnits("50000", 6);
  await (await usdc.mint(me, pool)).wait();
  await (await usdc.approve(vault, pool)).wait();
  await (await vault.fundRewards(pool)).wait();
  const out = {
    dayLength: DAY_LENGTH,
    teleporter: tele.target,
    usdc: usdc.target,
    vault: vault.target,
    land: land.target,
    cID,
    lID,
  };
  save("local", out);
  console.log("Local stack:", out);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
