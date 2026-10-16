// node scripts/smoke.js
// End-to-end check on the real networks: plant on the Game L1, wait until FarmVault on C-Chain locks the USDC.
require("dotenv").config();
const { ethers } = require("ethers");
const { load } = require("./common");
const art = (n) => require(`../artifacts/contracts/${n}.json`).abi;

const STATUS = ["None", "Pending", "Growing", "Harvesting", "Harvested", "Uprooted", "Failed"];

async function main() {
  const fuji = load("fuji");
  const l1 = load("farml1");
  if (!fuji || !l1) throw new Error("Chưa deploy đủ hai phía.");
  const pc = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc");
  const pl = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
  const wc = new ethers.Wallet(process.env.PRIVATE_KEY, pc);
  const wl = new ethers.Wallet(process.env.PRIVATE_KEY, pl);

  const usdc = new ethers.Contract(fuji.usdc, art("cchain/MockUSDC.sol/MockUSDC"), wc);
  const vault = new ethers.Contract(fuji.vault, art("cchain/FarmVault.sol/FarmVault"), wc);
  const land = new ethers.Contract(l1.land, art("l1/FarmLand.sol/FarmLand"), wl);

  const amount = ethers.parseUnits("10", 6);
  if ((await usdc.balanceOf(wc.address)) < amount) await (await usdc.faucet()).wait();
  if ((await usdc.allowance(wc.address, vault.target)) < amount) await (await usdc.approve(vault.target, ethers.MaxUint256)).wait();
  console.log("C-Chain: USDC approved for FarmVault");

  const tx = await land.plant(0, amount);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return land.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "Planted");
  const cropId = ev.args.cropId;
  console.log(`L1: planted crop #${cropId} (tx ${rc.hash}), waiting for ICM round trip…`);

  const t0 = Date.now();
  const c = await land.crops(cropId);
  console.log(`L1: crop #${cropId} is ${STATUS[Number(c.status)]} (optimistic)`);
  for (;;) {
    const lock = await vault.locks(cropId);
    if (lock.open) {
      console.log(`C-Chain: FarmVault locked ${ethers.formatUnits(lock.amount, 6)} USDC for crop #${cropId} after ${((Date.now() - t0) / 1000).toFixed(1)} s ✓`);
      break;
    }
    if (Date.now() - t0 > 180_000) {
      console.log("Hết 3 phút mà C-Chain chưa khóa. Kiểm tra relayer (npm run relayer) đang chạy và có gas.");
      process.exitCode = 1;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
