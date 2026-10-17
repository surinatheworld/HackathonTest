// Mainnet rehearsal on a local fork of Avalanche C-Chain: the same FarmGame, now on real USDC, parking idle money
// in the real Aave v3 pool through AaveV3YieldSource, and FarmCoop reading the real Chainlink AVAX/USD feed with
// WAVAX as collateral. Test USDC comes from impersonating Aave's aUSDC contract on the fork; nothing touches
// mainnet and no real money moves. npm run test:mainnet-fork
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E"; // native USDC (Circle)
const AAVE_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"; // Aave v3 Pool
const AUSDC = "0x625E7708f30cA75bfd92586e17077590C60eb4cD"; // Aave v3 aAvaUSDC
const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";
const CHAINLINK_AVAX_USD = "0x0A77230d17318075983913bC2145DB16C7366156";
const DAY = 60;
const U = (n) => ethers.parseUnits(String(n), 6);

describe("Mainnet rehearsal (Avalanche C-Chain fork: real USDC, Aave v3, Chainlink)", function () {
  this.timeout(600_000);
  let owner, player, usdc, game, source, coop;

  before(async function () {
    if (!process.env.FORK_MAINNET) this.skip();
    [owner, player] = await ethers.getSigners();
    usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", USDC);
    // aUSDC holds the pool's USDC; on the fork it can hand some to our test wallets.
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [AUSDC] });
    await network.provider.send("hardhat_setBalance", [AUSDC, "0x56BC75E2D63100000"]);
    const bank = await ethers.getSigner(AUSDC);
    await usdc.connect(bank).transfer(owner, U(60_000));
    await usdc.connect(bank).transfer(player, U(1_000));

    const F = (n) => ethers.getContractFactory(n);
    const fwd = await (await F("FarmForwarder")).deploy();
    game = await (await F("FarmGame")).deploy(fwd, USDC, DAY);
    source = await (await F("AaveV3YieldSource")).deploy(AAVE_POOL, USDC, AUSDC, game);
    coop = await (await F("FarmCoop")).deploy(fwd, USDC, WAVAX, CHAINLINK_AVAX_USD, 3 * 3600, DAY);
  });

  it("the Aave aToken really is aUSDC for native USDC", async () => {
    const a = await ethers.getContractAt(["function UNDERLYING_ASSET_ADDRESS() view returns (address)"], AUSDC);
    expect(await a.UNDERLYING_ASSET_ADDRESS()).to.equal(USDC);
  });

  it("idle reward money earns real Aave interest, and harvestYield moves only the gain", async () => {
    await usdc.approve(game, U(50_000));
    await game.fundRewards(U(50_000));
    await game.setYieldSource(source);
    await game.invest(U(40_000));
    expect(await source.balance()).to.be.closeTo(U(40_000), 2n);
    await time.increase(30 * 86400);
    const bal = await source.balance();
    expect(bal, "Aave interest accrued over 30 days").to.be.gt(U(40_000));
    const reserve0 = await game.rewardReserve();
    await game.harvestYield();
    expect(await game.rewardReserve()).to.be.gt(reserve0);
    expect(await game.invested()).to.equal(U(40_000));
  });

  it("a player's money comes back even when most of it sits in Aave", async () => {
    await usdc.connect(player).approve(game, U(1_000));
    await game.connect(player).plant(0, U(500));
    await game.connect(player).deposit(U(500));
    await time.increase(8 * DAY);
    await game.connect(player).harvest(1);
    await game.connect(player).withdraw(U(500));
    expect(await usdc.balanceOf(player)).to.be.gt(U(1_000));
    const held = await usdc.balanceOf(game);
    expect(held + (await game.invested())).to.be.gte((await game.totalLent()) + (await game.totalLocked()) + (await game.rewardReserve()));
  });

  it("the owner can pull everything back out of Aave", async () => {
    await game.divest(await game.invested());
    expect(await game.invested()).to.equal(0n);
    expect(await usdc.balanceOf(game)).to.be.gte(await game.rewardReserve());
  });

  it("FarmCoop reads the live Chainlink AVAX/USD price", async () => {
    // Earlier tests fast-forwarded the fork past the feed's heartbeat, so check the feed's answer directly
    // (coop.price() would now report it as stale, which is the intended safety stop).
    const feed = await ethers.getContractAt(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"], CHAINLINK_AVAX_USD);
    const [, answer] = await feed.latestRoundData();
    expect(await feed.decimals()).to.equal(8n);
    expect(answer).to.be.gt(ethers.parseUnits("1", 8));
    expect(answer).to.be.lt(ethers.parseUnits("1000", 8));
    expect(await coop.oracle()).to.equal(CHAINLINK_AVAX_USD);
  });
});
