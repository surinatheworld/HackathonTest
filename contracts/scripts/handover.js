// Finish a scripted deploy and hand every contract to the project wallet.
//   npx hardhat run scripts/handover.js --network fuji     (agent grant, butler funds, ownership)
//   npx hardhat run scripts/handover.js --network farml1   (FarmLand ownership)
// Env: OWNER_ADDRESS (project wallet), AGENT_PRIVATE_KEY (agent session key), AGENT_DAILY_CAP (default 200).
const { ethers, network } = require("hardhat");
const { load } = require("./common");

async function main() {
  const owner = ethers.getAddress(process.env.OWNER_ADDRESS || "");
  const [me] = await ethers.getSigners();
  const U = (n) => ethers.parseUnits(String(n), 6);
  const give = async (label, c) => {
    const cur = await c.owner();
    if (cur.toLowerCase() === owner.toLowerCase()) return console.log(`${label}: owner is already ${owner}`);
    if (cur.toLowerCase() !== me.address.toLowerCase()) throw new Error(`${label}: owned by ${cur}, cannot hand over`);
    await (await c.transferOwnership(owner)).wait();
    console.log(`${label}: owner → ${owner}`);
  };

  if (network.name === "fuji") {
    const f = load("fuji");
    const usdc = await ethers.getContractAt("MockUSDC", f.usdc);
    const vault = await ethers.getContractAt("FarmVault", f.vault);
    const butler = await ethers.getContractAt("ButlerAccount", f.butler);
    if (process.env.AGENT_PRIVATE_KEY && (await butler.owner()).toLowerCase() === me.address.toLowerCase()) {
      const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address;
      if ((await butler.agent()) !== agent || !(await butler.agentActive())) {
        await (await butler.setAgent(agent, U(process.env.AGENT_DAILY_CAP || 200), Math.floor(Date.now() / 1000) + 86400 * Number(process.env.AGENT_VALID_DAYS || 60))).wait();
        console.log(`ButlerAccount: agent ${agent} granted`);
      }
      if ((await usdc.balanceOf(butler.target)) < U(100)) {
        await (await usdc.mint(butler.target, U(500))).wait();
        console.log("ButlerAccount: funded with 500 test USDC");
      }
    }
    await give("FarmVault", vault);
    await give("ButlerAccount", butler);
  } else if (network.name === "farml1") {
    const l = load("farml1");
    await give("FarmLand", await ethers.getContractAt("FarmLand", l.land));
  } else throw new Error("Chạy với --network fuji hoặc --network farml1");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
