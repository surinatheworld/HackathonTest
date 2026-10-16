// node scripts/gasless-smoke.js [relayUrl]
// End-to-end check on Fuji with a brand-new wallet that holds 0 AVAX: faucet, approve, plant, deposit,
// all signed by the player and paid by the fee manager. Without a relayUrl it runs the fee manager code
// (functions/_lib/relay-core.js) in-process with RELAYER_PRIVATE_KEY (or PRIVATE_KEY) from contracts/.env.
require("dotenv").config();
const path = require("path");
const { pathToFileURL } = require("url");
const { ethers } = require("ethers");
const { load } = require("./common");

const TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
  ],
};

async function main() {
  const d = load("fuji-gasless");
  if (!d) throw new Error("Chưa deploy (deployments/fuji-gasless.json).");
  const rpc = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
  const provider = new ethers.JsonRpcProvider(rpc, 43113, { staticNetwork: true });
  const relayUrl = process.argv[2];
  const core = relayUrl ? null : await import(pathToFileURL(path.join(__dirname, "..", "..", "functions", "_lib", "relay-core.js")).href);
  const env = { RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY, FUJI_RPC_URL: rpc };
  const config = { chainId: 43113, rpc, forwarder: d.forwarder, game: d.game, usdc: d.usdc };

  const player = ethers.Wallet.createRandom();
  console.log("Player", player.address, "· AVAX", ethers.formatEther(await provider.getBalance(player.address)));
  const fwd = new ethers.Contract(d.forwarder, ["function nonces(address) view returns (uint256)"], provider);
  const usdcI = new ethers.Interface(["function faucet()", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
  const gameI = new ethers.Interface(["function plant(uint8,uint256)", "function deposit(uint256)", "function cropsOf(address) view returns (uint256[] ids, tuple(address owner,uint8 tier,uint8 status,uint64 plantedAt,uint64 lastWateredDay,uint256 amount,uint256 payout)[] list)", "function lends(address) view returns (uint256,uint256,uint64)"]);
  const domain = { name: "NongTraiDeFi", version: "1", chainId: 43113, verifyingContract: d.forwarder };

  const send = async (label, to, data, gas = 300000) => {
    const nonce = await fwd.nonces(player.address);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const signature = await player.signTypedData(domain, TYPES, { from: player.address, to, value: 0n, gas: BigInt(gas), nonce, deadline, data });
    const body = { request: { from: player.address, to, value: "0", gas: String(gas), deadline, data, signature } };
    const r = relayUrl
      ? await fetch(relayUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      : await core.relay(body, env, config);
    const j = await r.json();
    if (r.status !== 200) throw new Error(`${label}: ${r.status} ${j.error}`);
    const rc = await provider.waitForTransaction(j.hash, 1, 120000);
    console.log(`✓ ${label} · tx ${j.hash} · gas ${rc.gasUsed} paid by ${j.relayer}`);
  };

  await send("faucet()", d.usdc, usdcI.encodeFunctionData("faucet"));
  await send("approve(FarmGame)", d.usdc, usdcI.encodeFunctionData("approve", [d.game, ethers.MaxUint256]));
  await send("plant(cây ớt, 10 USDC)", d.game, gameI.encodeFunctionData("plant", [0, ethers.parseUnits("10", 6)]));
  await send("deposit(50 USDC)", d.game, gameI.encodeFunctionData("deposit", [ethers.parseUnits("50", 6)]));

  const game = new ethers.Contract(d.game, gameI, provider);
  const usdc = new ethers.Contract(d.usdc, usdcI, provider);
  const [, list] = await game.cropsOf(player.address);
  console.log("Crops:", list.map((c) => `${ethers.formatUnits(c.amount, 6)} USDC, status ${c.status}`).join("; "));
  console.log("Lent:", ethers.formatUnits((await game.lends(player.address))[0], 6), "USDC · wallet USDC", ethers.formatUnits(await usdc.balanceOf(player.address), 6));
  console.log("Player AVAX still", ethers.formatEther(await provider.getBalance(player.address)), "(never paid gas)");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
