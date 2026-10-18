// npm run top-up:quests
// Tops the FarmQuests reward pool back up to QUEST_POOL (default 20,000 test USDC). Many fresh wallets can work
// through the quests and spend the pool (each player earns at most 760 USDC); when it runs dry, quests wait
// (RewardPoolEmpty) instead of failing, and this refills it. Rewards are always paid from the pool, never minted
// by FarmQuests; on testnet the team's wallet gets the test USDC from the open faucet token.
require("dotenv").config();
const { ethers } = require("ethers");
const { load, fujiProvider } = require("./common");

async function main() {
  const d = load("fuji-gasless");
  const provider = await fujiProvider(ethers);
  const me = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const usdc = new ethers.Contract(d.usdc, ["function mint(address,uint256)", "function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], me);
  const target = ethers.parseUnits(process.env.QUEST_POOL || "20000", 6);
  const pool = await usdc.balanceOf(d.quests);
  console.log(`Quỹ nhiệm vụ ${d.quests}: ${ethers.formatUnits(pool, 6)} USDC`);
  if (pool >= target) return console.log("Đủ rồi, không cần nạp.");
  const need = target - pool;
  if ((await usdc.balanceOf(me.address)) < need) await (await usdc.mint(me.address, need)).wait();
  const tx = await usdc.transfer(d.quests, need);
  await tx.wait();
  console.log(`Đã nạp ${ethers.formatUnits(need, 6)} USDC · ${tx.hash}`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
