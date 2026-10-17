// npm run multisig:deploy
// Deploys the team's 2-of-3 FarmMultisig on Fuji. Env: MULTISIG_OWNERS = three teammates' wallet addresses,
// comma-separated (public addresses only, never keys). MULTISIG_THRESHOLD defaults to 2.
// Then run `npm run multisig:handover` to give it the pooled-money contracts.
const { ethers, network } = require("hardhat");
const { load, save } = require("./common");

async function main() {
  if (network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const d = load("fuji-gasless");
  if (d.multisig) return console.log("FarmMultisig đã có:", d.multisig);
  const owners = (process.env.MULTISIG_OWNERS || "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => ethers.getAddress(a));
  const threshold = Number(process.env.MULTISIG_THRESHOLD || 2);
  if (owners.length < 3) throw new Error("Cần MULTISIG_OWNERS = 3 địa chỉ ví của 3 thành viên, cách nhau bằng dấu phẩy.");
  const ms = await (await ethers.getContractFactory("FarmMultisig")).deploy(owners, threshold);
  await ms.waitForDeployment();
  d.multisig = ms.target;
  save("fuji-gasless", d);
  console.log(`FarmMultisig ${ms.target}: ${threshold}/${owners.length} · ${owners.join(", ")}`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
