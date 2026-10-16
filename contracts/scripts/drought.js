// npm run drought -- <price in USD>   e.g. npm run drought -- 6
// npm run drought -- reset            back to the live Chainlink price
// npm run drought -- liquidate        act as the keeper: liquidate every coop position below health 1.0
// Moves DemoPriceFeed for an on-stage "hạn hán" (AVAX crash). Runs as the deployer (PRIVATE_KEY), which
// owns the demo feed. FarmCoop only follows it after its owner calls setOracle(demoFeed, …): see docs/DEPLOY.md.
require("dotenv").config();
const { ethers } = require("ethers");
const { load } = require("./common");

const FEED = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function setPrice(int256)"];
const COOP = [
  "function oracle() view returns (address)",
  "function healthOf(address) view returns (uint256)",
  "function debtOf(address) view returns (uint256)",
  "function liquidate(address user) returns (uint256)",
  "event Borrowed(address indexed user, uint256 amount, uint256 debt)",
];
const ROUTESCAN = "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api";
const USDC = ["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"];

async function liquidateAll(d, provider, me) {
  const coop = new ethers.Contract(d.coop, COOP, me);
  const usdc = new ethers.Contract(d.usdc, USDC, me);
  // The public Fuji RPC serves logs 100 blocks at a time, so read them from Routescan (Snowtrace's API) instead.
  const borrowers = new Set();
  const topic = coop.interface.getEvent("Borrowed").topicHash;
  for (let page = 1; ; page++) {
    const url = `${ROUTESCAN}?module=logs&action=getLogs&address=${d.coop}&topic0=${topic}&fromBlock=${d.startBlock}&toBlock=latest&page=${page}&offset=1000`;
    const j = await (await fetch(url)).json();
    const logs = Array.isArray(j.result) ? j.result : [];
    logs.forEach((l) => borrowers.add(ethers.getAddress(ethers.dataSlice(l.topics[1], 12))));
    if (logs.length < 1000) break;
  }
  console.log(`${borrowers.size} ví từng vay ở Hợp tác xã.`);
  let n = 0;
  for (const user of borrowers) {
    const debt = await coop.debtOf(user);
    if (debt === 0n) continue;
    const h = await coop.healthOf(user);
    if (h >= 10_000n) {
      console.log(`  ${user}: an toàn (${Number(h) / 1e4})`);
      continue;
    }
    // Test USDC is freely mintable, so the keeper mints what it needs to repay.
    const need = debt + debt / 100n + 1_000_000n;
    await (await usdc.mint(me.address, need)).wait();
    await (await usdc.approve(d.coop, need)).wait();
    const tx = await coop.liquidate(user);
    await tx.wait();
    n++;
    console.log(`  ${user}: hệ số ${Number(h) / 1e4} → đã thanh lý · tx ${tx.hash}`);
  }
  console.log(n ? `Đã thanh lý ${n} vị thế.` : "Không có vị thế nào dưới 1,0.");
}

async function main() {
  const d = load("fuji-gasless");
  if (!d?.demoFeed) throw new Error("Chưa deploy DemoPriceFeed (deployments/fuji-gasless.json).");
  const arg = process.argv[2];
  if (!arg) throw new Error("Cách dùng: npm run drought -- <giá USD> | reset | liquidate");
  const provider = new ethers.JsonRpcProvider(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc");
  const me = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  if (arg === "liquidate") return liquidateAll(d, provider, me);

  const feed = new ethers.Contract(d.demoFeed, FEED, me);
  const coop = new ethers.Contract(d.coop, COOP, provider);
  const next = arg === "reset" ? (await new ethers.Contract(d.chainlinkAvaxUsd, FEED, provider).latestRoundData())[1] : ethers.parseUnits(arg, 8);
  const tx = await feed.setPrice(next);
  await tx.wait();
  console.log(`DemoPriceFeed → $${ethers.formatUnits(next, 8)} · tx ${tx.hash}`);
  const using = (await coop.oracle()).toLowerCase();
  if (using === d.demoFeed.toLowerCase()) console.log("Hợp tác xã đang dùng DemoPriceFeed: giá mới có hiệu lực ngay.");
  else console.log(`Hợp tác xã vẫn dùng Chainlink (${using}). Owner cần gọi setOracle(${d.demoFeed}, 86400) trước, xem docs/DEPLOY.md.`);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
