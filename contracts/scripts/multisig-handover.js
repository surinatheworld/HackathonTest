// npm run multisig:handover
// Gives FarmMultisig (2-of-3) ownership of every contract that holds or steers pooled money:
// FarmGame (reward pool, yield source), FarmCoop (lending pool, price feed choice), FarmQuests (quest reward pool)
// and FarmItems (market fee, season trophies). Runs as the current owner (PRIVATE_KEY). One-way: after this,
// changing those contracts needs two teammates (submit → confirm → execute on FarmMultisig).
// DemoPriceFeed stays with the deployer: it holds no money, and FarmCoop only listens to it after the multisig
// calls setOracle, so the on-stage "hạn hán" demo still needs two teammates to switch it on.
const { ethers, network } = require("hardhat");
const { load } = require("./common");

async function main() {
  if (network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const d = load("fuji-gasless");
  if (!d.multisig) throw new Error("Chưa có FarmMultisig: chạy npm run multisig:deploy trước.");
  const [me] = await ethers.getSigners();
  const ms = await ethers.getContractAt("FarmMultisig", d.multisig);
  console.log(`FarmMultisig ${d.multisig}: ${await ms.threshold()}/${(await ms.owners()).length}`);
  const list = [
    ["FarmGame", d.game],
    ["FarmCoop", d.coop],
    ["FarmQuests", d.quests],
    ["FarmItems", d.items],
  ];
  for (const [name, addr] of list) {
    if (!addr) continue;
    const c = await ethers.getContractAt(name, addr);
    const cur = await c.owner();
    if (cur.toLowerCase() === d.multisig.toLowerCase()) {
      console.log(`${name}: đã thuộc multisig`);
      continue;
    }
    if (cur.toLowerCase() !== me.address.toLowerCase()) throw new Error(`${name} thuộc ${cur}, không phải ví đang chạy.`);
    if (!process.env.CONFIRM) {
      console.log(`${name}: sẽ chuyển ${cur} → ${d.multisig} (chạy lại với CONFIRM=1 để thực hiện)`);
      continue;
    }
    await (await c.transferOwnership(d.multisig)).wait();
    console.log(`${name}: owner → ${await c.owner()}`);
  }
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
