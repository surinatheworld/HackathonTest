// npx hardhat run scripts/deploy-gasless.js --network fuji
// Deploys the Fuji-only gasless stack (forwarder, USDC, gAVAX, FarmGame + yield source, FarmCoop on
// Chainlink AVAX/USD, FarmPond, ButlerAccount), funds it, hands ownership to OWNER_ADDRESS and writes the
// configs for the game (prototype/chain-config.js) and the fee manager (functions/_lib/relay-config.js).
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { DAY_LENGTH, save } = require("./common");

const FUJI_RPC = "https://api.avax-test.network/ext/bc/C/rpc";
// Chainlink AVAX / USD on Fuji (8 decimals): https://docs.chain.link/data-feeds/price-feeds/addresses?network=avalanche
const CHAINLINK_AVAX_USD = process.env.CHAINLINK_AVAX_USD || "0x5498BB86BC934c8D34FDA08E81D444153d0D06aD";
const MAX_PRICE_AGE = 2 * 86400; // the Fuji feed's heartbeat is 24 h

async function main() {
  if (network.name !== "fuji") throw new Error("Chạy với --network fuji");
  const owner = ethers.getAddress(process.env.OWNER_ADDRESS || "");
  const [me] = await ethers.getSigners();
  const U = (n) => ethers.parseUnits(String(n), 6);
  const startBlock = await ethers.provider.getBlockNumber();
  console.log("Deployer:", me.address, "·", ethers.formatEther(await ethers.provider.getBalance(me)), "AVAX");
  const deploy = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    console.log(name.padEnd(16), c.target);
    return c;
  };
  const send = async (p) => (await p).wait();

  const fwd = await deploy("FarmForwarder");
  const usdc = await deploy("GaslessUSDC", fwd.target);
  const gavax = await deploy("GaslessAVAX", fwd.target);
  const game = await deploy("FarmGame", fwd.target, usdc.target, DAY_LENGTH);
  const coop = await deploy("FarmCoop", fwd.target, usdc.target, gavax.target, CHAINLINK_AVAX_USD, MAX_PRICE_AGE, DAY_LENGTH);
  const pond = await deploy("FarmPond", fwd.target, usdc.target, gavax.target);
  const price = await coop.price();
  console.log("Chainlink AVAX/USD:", ethers.formatUnits(price, 8));
  // Starts at the Chainlink price; only used when the owner points the coop at it for a demo.
  const demoFeed = await deploy("DemoPriceFeed", price);
  const yieldSource = await deploy("MockYieldSource", usdc.target, game.target, 500, DAY_LENGTH);

  // Reward pool 50,000 USDC; 40,000 of it is parked in the yield source, the rest stays liquid.
  await send(usdc.mint(me.address, U(50000 + 50000 + 20000)));
  await send(usdc.approve(game.target, U(50000)));
  await send(game.fundRewards(U(50000)));
  await send(game.setYieldSource(yieldSource.target));
  await send(game.invest(U(40000)));
  console.log("Reward pool 50,000 USDC (40,000 in MockYieldSource at 5%)");

  await send(usdc.approve(coop.target, U(50000)));
  await send(coop.fund(U(50000)));
  console.log("Hợp tác xã: 50,000 USDC to lend");

  // Ao cá seeded with 20,000 USDC and the matching gAVAX at the Chainlink price.
  const avaxSeed = (U(20000) * 10n ** 20n) / price;
  await send(gavax.mint(me.address, avaxSeed));
  await send(usdc.approve(pond.target, U(20000)));
  await send(gavax.approve(pond.target, avaxSeed));
  await send(pond.addLiquidity(U(20000), avaxSeed, 0));
  console.log("Ao cá: 20,000 USDC +", ethers.formatUnits(avaxSeed, 18), "gAVAX");

  const butler = await deploy("ButlerAccount", me.address, DAY_LENGTH);
  const sel = (c, f) => c.interface.getFunction(f).selector;
  await send(butler.setRule(usdc.target, sel(usdc, "approve"), true, 0, game.target));
  await send(butler.setRule(game.target, sel(game, "deposit"), true, 1, ethers.ZeroAddress));
  await send(butler.setRule(game.target, sel(game, "claim"), true, 0, ethers.ZeroAddress));
  if (process.env.AGENT_PRIVATE_KEY) {
    const agent = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY).address;
    const until = Math.floor(Date.now() / 1000) + 86400 * Number(process.env.AGENT_VALID_DAYS || 60);
    await send(butler.setAgent(agent, U(process.env.AGENT_DAILY_CAP || 200), until));
    console.log("ButlerAccount agent", agent, "until", new Date(until * 1000).toISOString().slice(0, 10));
  }
  await send(usdc.mint(butler.target, U(500)));

  // The demo feed stays with the deployer so `npm run drought` can move its price.
  await send(game.transferOwnership(owner));
  await send(coop.transferOwnership(owner));
  await send(butler.transferOwnership(owner));
  console.log("Owner of FarmGame, FarmCoop and ButlerAccount →", owner);

  const addrs = {
    forwarder: fwd.target, usdc: usdc.target, gavax: gavax.target, game: game.target, coop: coop.target, pond: pond.target,
    butler: butler.target, yieldSource: yieldSource.target, chainlinkAvaxUsd: CHAINLINK_AVAX_USD, demoFeed: demoFeed.target,
  };
  save("fuji-gasless", { chainId: 43113, dayLength: DAY_LENGTH, maxPriceAge: MAX_PRICE_AGE, demoFeedSeed: price.toString(), startBlock, owner, deployer: me.address, ...addrs });

  const web = {
    dayLength: DAY_LENGTH,
    owner,
    relayUrl: "/api/relay",
    privyAppId: process.env.PRIVY_APP_ID || "cmvb7x7s001zg0fkxwxk6yx5n",
    cchain: { chainId: 43113, name: "Avalanche Fuji C-Chain", rpc: FUJI_RPC, explorer: "https://testnet.snowtrace.io", currency: "AVAX", ...addrs },
  };
  const repo = path.join(__dirname, "..", "..");
  fs.writeFileSync(path.join(repo, "prototype", "chain-config.js"), `// Generated by contracts/scripts/deploy-gasless.js\nwindow.FARM_CONFIG = ${JSON.stringify(web, null, 2)};\n`);
  const relayCfg = { chainId: 43113, rpc: FUJI_RPC, forwarder: fwd.target, game: game.target, usdc: usdc.target, gavax: gavax.target, coop: coop.target, pond: pond.target };
  fs.writeFileSync(
    path.join(repo, "functions", "_lib", "relay-config.js"),
    `// Generated by contracts/scripts/deploy-gasless.js\nexport default ${JSON.stringify(relayCfg, null, 2)};\n`
  );
  console.log("Wrote prototype/chain-config.js and functions/_lib/relay-config.js");
  console.log("Deployer left:", ethers.formatEther(await ethers.provider.getBalance(me)), "AVAX");
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
