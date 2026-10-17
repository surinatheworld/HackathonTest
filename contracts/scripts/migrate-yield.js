// npm run migrate:yield
// Moves FarmGame on Fuji to a MockYieldSource that pays interest from a funded reserve instead of minting.
// Anyone (the deployer, PRIVATE_KEY) deploys the new source and funds its interest reserve. Switching FarmGame
// over needs its owner: run this as the owner to do it all at once, otherwise the script prints the owner's
// three calls for Snowtrace (Write Contract), and a second run as the owner (or via the multisig) finishes.
// Env: INTEREST_RESERVE (default 100,000 USDC), INVEST (default 10,000 USDC).
const { ethers, network } = require("hardhat");
const { load, save } = require("./common");

async function main() {
  if (network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const d = load("fuji-gasless");
  const [me] = await ethers.getSigners();
  const U = (n) => ethers.parseUnits(String(n), 6);
  const game = await ethers.getContractAt("FarmGame", d.game);
  const usdc = await ethers.getContractAt("GaslessUSDC", d.usdc);
  const send = async (label, p) => { const tx = await p; await tx.wait(); console.log(`${label} · ${tx.hash}`); };

  let src;
  if (d.yieldSourceNext) {
    src = await ethers.getContractAt("MockYieldSource", d.yieldSourceNext);
    console.log("MockYieldSource mới (đã deploy)", src.target);
  } else {
    src = await (await ethers.getContractFactory("MockYieldSource")).deploy(d.usdc, d.game, 500, d.dayLength);
    await src.waitForDeployment();
    console.log("MockYieldSource mới", src.target);
    const reserve = U(process.env.INTEREST_RESERVE || 100_000);
    await send("mint test USDC cho quỹ lãi", usdc.mint(me.address, reserve));
    await send("nạp quỹ lãi", usdc.transfer(src.target, reserve));
    d.yieldSourceNext = src.target;
    save("fuji-gasless", d);
  }
  const invested = await game.invested();
  const amount = U(process.env.INVEST || 10_000);
  if ((await game.owner()).toLowerCase() !== me.address.toLowerCase()) {
    if (invested > 0n) await send("harvestYield (nguồn cũ, ai gọi cũng được)", game.harvestYield());
    const now = await game.invested();
    console.log(`
Phần còn lại cần ví owner ${await game.owner()}. Trên Snowtrace mở FarmGame ${d.game} → Contract → Write Contract, kết nối ví owner rồi gọi lần lượt:`);
    if (now > 0n) console.log(`  1. divest(${now})`);
    console.log(`  ${now > 0n ? 2 : 1}. setYieldSource(${src.target})`);
    console.log(`  ${now > 0n ? 3 : 2}. invest(${amount})`);
    console.log("Xong thì chạy lại lệnh này để ghi địa chỉ mới vào deployments.");
    if ((await game.yieldSource()).toLowerCase() !== src.target.toLowerCase()) return;
  } else {
    if (invested > 0n) {
      await send("harvestYield (nguồn cũ)", game.harvestYield());
      await send(`divest ${ethers.formatUnits(invested, 6)} USDC`, game.divest(invested));
    }
    await send("setYieldSource", game.setYieldSource(src.target));
  }
  if ((await game.yieldSource()).toLowerCase() !== src.target.toLowerCase()) return;
  if ((await game.owner()).toLowerCase() === me.address.toLowerCase() && (await game.invested()) === 0n) {
    await send(`invest ${ethers.formatUnits(amount, 6)} USDC`, game.invest(amount));
  }
  if (d.yieldSource !== src.target) d.yieldSourceOld = d.yieldSource;
  d.yieldSource = src.target;
  delete d.yieldSourceNext;
  save("fuji-gasless", d);
  console.log(`Xong. Quỹ lãi ${ethers.formatUnits(await src.interestReserve(), 6)} USDC, đang gửi ${ethers.formatUnits(await game.invested(), 6)} USDC.`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
