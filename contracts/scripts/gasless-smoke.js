// node scripts/gasless-smoke.js [relayUrl]
// End-to-end check on Fuji with a brand-new wallet that holds 0 AVAX: faucet, approve, plant, deposit,
// all signed by the player and paid by the fee manager. Without a relayUrl it runs the fee manager code
// (functions/_lib/relay-core.js) in-process with RELAYER_PRIVATE_KEY (or PRIVATE_KEY) from contracts/.env.
// SMOKE_LOCAL=1 runs the same steps against `npx hardhat node` + deploy-local.js (Hardhat account #0 pays).
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
  const local = !!process.env.SMOKE_LOCAL;
  const d = load(local ? "local" : "fuji-gasless");
  const chainId = local ? 31337 : 43113;
  if (!d) throw new Error("Chưa deploy (deployments/fuji-gasless.json).");
  const rpc = local ? "http://127.0.0.1:8545" : process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
  const provider = new ethers.JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const relayUrl = process.argv[2];
  const core = relayUrl ? null : await import(pathToFileURL(path.join(__dirname, "..", "..", "functions", "_lib", "relay-core.js")).href);
  const HARDHAT_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const env = { RELAYER_PRIVATE_KEY: local ? HARDHAT_0 : process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY, FUJI_RPC_URL: rpc };
  const config = { chainId, rpc, forwarder: d.forwarder, game: d.game, usdc: d.usdc, gavax: d.gavax, coop: d.coop, pond: d.pond };

  const player = ethers.Wallet.createRandom();
  console.log("Player", player.address, "· AVAX", ethers.formatEther(await provider.getBalance(player.address)));
  const fwd = new ethers.Contract(d.forwarder, ["function nonces(address) view returns (uint256)"], provider);
  const usdcI = new ethers.Interface(["function faucet()", "function approve(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
  const gameI = new ethers.Interface(["function plant(uint8,uint256)", "function deposit(uint256)", "function cropsOf(address) view returns (uint256[] ids, tuple(address owner,uint8 tier,uint8 status,uint64 plantedAt,uint64 lastWateredDay,uint256 amount,uint256 payout)[] list)", "function lends(address) view returns (uint256,uint256,uint64)"]);
  const domain = { name: "NongTraiDeFi", version: "1", chainId, verifyingContract: d.forwarder };

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
  if (d.coop) {
    const coopI = new ethers.Interface(["function depositCollateral(uint256)", "function borrow(uint256)", "function positionOf(address) view returns (uint256,uint256,uint256,uint256,uint256)"]);
    const pondI = new ethers.Interface(["function zapIn(uint256,uint256)", "function positionOf(address) view returns (uint256,uint256,uint256,uint256)"]);
    await send("gAVAX faucet()", d.gavax, usdcI.encodeFunctionData("faucet"));
    await send("approve(FarmCoop, gAVAX)", d.gavax, usdcI.encodeFunctionData("approve", [d.coop, ethers.MaxUint256]));
    await send("depositCollateral(5 gAVAX)", d.coop, coopI.encodeFunctionData("depositCollateral", [ethers.parseUnits("5", 18)]));
    await send("borrow(10 USDC)", d.coop, coopI.encodeFunctionData("borrow", [ethers.parseUnits("10", 6)]));
    await send("approve(FarmPond, USDC)", d.usdc, usdcI.encodeFunctionData("approve", [d.pond, ethers.MaxUint256]));
    await send("zapIn(100 USDC)", d.pond, pondI.encodeFunctionData("zapIn", [ethers.parseUnits("100", 6), 1]));
    const [col, debt, value, , health] = await new ethers.Contract(d.coop, coopI, provider).positionOf(player.address);
    console.log(`Coop: ${ethers.formatUnits(col, 18)} gAVAX ≈ $${ethers.formatUnits(value, 6)} · nợ ${ethers.formatUnits(debt, 6)} USDC · health ${Number(health) / 1e4}`);
    const [, , , lp] = await new ethers.Contract(d.pond, pondI, provider).positionOf(player.address);
    console.log(`Pond: vị thế ≈ ${ethers.formatUnits(lp, 6)} USDC`);
  }
  // Fee manager must refuse a target outside the farm.
  if (relayUrl || core) {
    const nonce = await fwd.nonces(player.address);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const data = usdcI.encodeFunctionData("approve", [player.address, 1]);
    const signature = await player.signTypedData(domain, TYPES, { from: player.address, to: d.usdc, value: 0n, gas: 100000n, nonce, deadline, data });
    const body = { request: { from: player.address, to: d.usdc, value: "0", gas: "100000", deadline, data, signature } };
    const r = relayUrl
      ? await fetch(relayUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      : await core.relay(body, env, config);
    console.log(`approve tới ví lạ → ${r.status} (${(await r.json()).error})`);
    if (r.status !== 403) throw new Error("Fee manager lẽ ra phải từ chối approve tới ví lạ.");
  }

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
