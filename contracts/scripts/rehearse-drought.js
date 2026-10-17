// npm run rehearse:drought
// Dress rehearsal of the on-stage "hạn hán" on a local fork of Fuji, using the contracts that are really
// deployed. The owner and deployer are impersonated, so no key is needed and nothing touches the real chain.
const { ethers, network } = require("hardhat");
const { load } = require("./common");

async function impersonate(addr) {
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [addr] });
  await network.provider.send("hardhat_setBalance", [addr, "0x56BC75E2D63100000"]);
  return ethers.getSigner(addr);
}

async function main() {
  if (!process.env.FORK_FUJI) throw new Error("Chạy bằng: npm run rehearse:drought");
  const d = load("fuji-gasless");
  const [player, keeper] = await ethers.getSigners();
  const owner = await impersonate(d.owner);
  const deployer = await impersonate(d.deployer);
  const coop = await ethers.getContractAt("FarmCoop", d.coop);
  const feed = await ethers.getContractAt("DemoPriceFeed", d.demoFeed);
  const usdc = await ethers.getContractAt("GaslessUSDC", d.usdc);
  const gavax = await ethers.getContractAt("GaslessAVAX", d.gavax);
  const fmtU = (v) => Number(ethers.formatUnits(v, 6)).toFixed(2);
  const fmtA = (v) => Number(ethers.formatUnits(v, 18)).toFixed(3);
  const health = async () => {
    const h = await coop.healthOf(player);
    return h > 10n ** 30n ? "không nợ" : (Number(h) / 1e4).toFixed(3);
  };

  console.log(`Giá Chainlink thật: $${ethers.formatUnits(await coop.price(), 8)}`);
  await feed.connect(deployer).setPrice(await coop.price());
  await coop.connect(owner).setOracle(d.demoFeed, 86400);
  console.log("1. Owner gọi setOracle(DemoPriceFeed) ✓");

  await gavax.connect(player).faucet();
  await gavax.connect(player).approve(coop, ethers.MaxUint256);
  await coop.connect(player).depositCollateral(ethers.parseUnits("10", 18));
  const [, , value, maxBorrow] = await coop.positionOf(player);
  const loan = (maxBorrow * 95n) / 100n;
  await coop.connect(player).borrow(loan);
  console.log(`2. Người chơi gửi 10 gAVAX (≈ $${fmtU(value)}), vay ${fmtU(loan)} USDC · hệ số an toàn ${await health()}`);

  await feed.connect(deployer).setPrice(ethers.parseUnits("6", 8));
  console.log(`3. npm run drought -- 6 → giá $6 · hệ số an toàn ${await health()}`);

  await usdc.mint(keeper, ethers.parseUnits("1000", 6));
  await usdc.connect(keeper).approve(coop, ethers.MaxUint256);
  const before = await gavax.balanceOf(keeper);
  await coop.connect(keeper).liquidate(player);
  const seized = (await gavax.balanceOf(keeper)) - before;
  const p = await coop.positions(player);
  console.log(`4. npm run drought -- liquidate → bot trả ${fmtU(loan)} USDC nợ, lấy ${fmtA(seized)} gAVAX (≈ $${fmtU((seized * 6n) / 10n ** 12n)}, gồm 10% phạt)`);
  console.log(`   Người chơi còn ${fmtA(p.collateral)} gAVAX trong kho, nợ ${fmtU(p.debt)} USDC`);

  await coop.connect(owner).setOracle(d.chainlinkAvaxUsd, 172800);
  console.log(`5. Owner trả lại Chainlink ✓ · giá $${ethers.formatUnits(await coop.price(), 8)}`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
