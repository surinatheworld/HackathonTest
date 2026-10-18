const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 60;
const usdc = (n) => ethers.parseUnits(String(n), 6);
const avax = (n) => ethers.parseUnits(String(n), 18);
const px = (n) => ethers.parseUnits(String(n), 8);
const TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

async function deploy() {
  const [owner, relayer, keeper, agent] = await ethers.getSigners();
  const alice = ethers.Wallet.createRandom().connect(ethers.provider);
  const bob = ethers.Wallet.createRandom().connect(ethers.provider);
  const F = (n) => ethers.getContractFactory(n);
  const fwd = await (await F("FarmForwarder")).deploy();
  const token = await (await F("GaslessUSDC")).deploy(fwd);
  const gavax = await (await F("GaslessAVAX")).deploy(fwd);
  const feed = await (await F("DemoPriceFeed")).deploy(px(10));
  const game = await (await F("FarmGame")).deploy(fwd, token, DAY);
  const coop = await (await F("FarmCoop")).deploy(fwd, token, gavax, feed, 2 * 86400, DAY);
  const pond = await (await F("FarmPond")).deploy(fwd, token, gavax);

  await token.mint(owner, usdc(100_000));
  await gavax.mint(owner, avax(1_000));
  await token.approve(coop, usdc(50_000));
  await coop.fund(usdc(50_000));
  await token.approve(pond, usdc(10_000));
  await gavax.approve(pond, avax(1_000));
  await pond.addLiquidity(usdc(10_000), avax(1_000), 0); // $10 per gAVAX
  await token.approve(game, usdc(10_000));
  await game.fundRewards(usdc(10_000));

  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "NongTraiDeFi", version: "1", chainId, verifyingContract: await fwd.getAddress() };
  const relay = async (who, target, fn, args) => {
    const req = {
      from: who.address,
      to: await target.getAddress(),
      value: 0n,
      gas: 600_000n,
      nonce: await fwd.nonces(who.address),
      deadline: (await time.latest()) + 600,
      data: target.interface.encodeFunctionData(fn, args),
    };
    const signature = await who.signTypedData(domain, TYPES, req);
    const { nonce, ...rest } = req;
    return fwd.connect(relayer).execute({ ...rest, signature });
  };
  const fundPlayer = async (who) => {
    await relay(who, token, "faucet", []);
    await relay(who, gavax, "faucet", []);
    for (const spender of [coop, pond, game]) {
      await relay(who, token, "approve", [await spender.getAddress(), ethers.MaxUint256]);
      await relay(who, gavax, "approve", [await spender.getAddress(), ethers.MaxUint256]);
    }
  };
  return { owner, relayer, keeper, agent, alice, bob, fwd, token, gavax, feed, game, coop, pond, relay, fundPlayer };
}

describe("Hợp tác xã (FarmCoop): collateral, borrow, liquidation", () => {
  it("a zero-gas player deposits gAVAX and borrows up to 60% of its Chainlink-priced value", async () => {
    const { alice, token, coop, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    await relay(alice, coop, "depositCollateral", [avax(10)]); // 10 gAVAX × $10 = $100
    const [, , value, maxBorrow] = await coop.positionOf(alice.address);
    expect(value).to.equal(usdc(100));
    expect(maxBorrow).to.equal(usdc(60));
    const before = await token.balanceOf(alice.address);
    await relay(alice, coop, "borrow", [usdc(60)]);
    expect((await token.balanceOf(alice.address)) - before).to.equal(usdc(60));
    await expect(relay(alice, coop, "borrow", [usdc(1)])).to.be.reverted;
    await expect(relay(alice, coop, "withdrawCollateral", [avax(1)])).to.be.reverted;
    expect(await ethers.provider.getBalance(alice.address)).to.equal(0n);
  });

  it("debt grows at 8% a game year and can be repaid by the player or a friend", async () => {
    const { alice, bob, coop, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    await fundPlayer(bob);
    await relay(alice, coop, "depositCollateral", [avax(10)]);
    await relay(alice, coop, "borrow", [usdc(50)]);
    await time.increase(365 * DAY);
    const debt = await coop.debtOf(alice.address);
    expect(debt).to.be.closeTo(usdc(54), usdc(0.01));
    await relay(bob, coop, "repay", [alice.address, usdc(20)]);
    await relay(alice, coop, "repay", [alice.address, usdc(1_000)]); // capped at the debt
    expect(await coop.debtOf(alice.address)).to.equal(0n);
    await relay(alice, coop, "withdrawCollateral", [avax(10)]);
    expect((await coop.positions(alice.address)).collateral).to.equal(0n);
  });

  it("a price crash (hạn hán) makes the position liquidatable; the keeper repays and takes collateral + 10%", async () => {
    const { owner, keeper, alice, token, gavax, feed, coop, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    await relay(alice, coop, "depositCollateral", [avax(10)]);
    await relay(alice, coop, "borrow", [usdc(60)]);
    await expect(coop.connect(keeper).liquidate(alice.address)).to.be.revertedWithCustomError(coop, "NotLiquidatable");
    await feed.connect(owner).setPrice(px(7)); // $70 × 75% = 52.5 < 60
    expect(await coop.healthOf(alice.address)).to.be.lt(10_000n);
    await token.mint(keeper, usdc(100));
    await token.connect(keeper).approve(coop, usdc(100));
    await coop.connect(keeper).liquidate(alice.address);
    const seized = await gavax.balanceOf(keeper.address);
    expect(seized).to.be.closeTo((avax(60) * 11n) / 70n, avax(0.001)); // 60 × 1.1 / 7
    const p = await coop.positions(alice.address);
    expect(p.debt).to.equal(0n);
    expect(p.collateral).to.equal(avax(10) - seized);
  });

  it("refuses a stale price for borrowing, but collateral without debt can always come home", async () => {
    const { alice, coop, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    await relay(alice, coop, "depositCollateral", [avax(5)]);
    await time.increase(3 * 86400);
    await expect(coop.price()).to.be.revertedWithCustomError(coop, "StalePrice");
    await expect(relay(alice, coop, "borrow", [usdc(1)])).to.be.reverted;
    await relay(alice, coop, "withdrawCollateral", [avax(5)]);
  });

  it("only the owner can switch the oracle", async () => {
    const { keeper, coop } = await deploy();
    await expect(coop.connect(keeper).setOracle(keeper.address, 1)).to.be.revertedWithCustomError(coop, "NotOwner");
  });
});

describe("Ao cá (FarmPond): x·y=k pool", () => {
  // Same integer math as prototype/chain.js (CH.pondAdd / CH.pondOut), so the UI's slippage limits are exact.
  const isqrt = (n) => { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; };
  const swapOut = (a, rIn, rOut) => { const f = a * 9_970n; return (f * rOut) / (rIn * 10_000n + f); };
  const previewIn = async (pond, amount) => {
    const [ru, ra, ts] = [await pond.reserveUsdc(), await pond.reserveAvax(), await pond.totalShares()];
    const swapIn = (isqrt(ru * (ru * 3_988_009n + amount * 3_988_000n)) - ru * 1_997n) / 1_994n;
    const avaxOut = swapOut(swapIn, ru, ra);
    const x = ((amount - swapIn) * ts) / (ru + swapIn), y = (avaxOut * ts) / (ra - avaxOut);
    return x < y ? x : y;
  };
  const previewOut = async (pond, shares) => {
    const [ru, ra, ts] = [await pond.reserveUsdc(), await pond.reserveAvax(), await pond.totalShares()];
    const up = (ru * shares) / ts, ap = (ra * shares) / ts;
    return up + swapOut(ap, ra - ap, ru - up);
  };

  it("the UI's zap previews match the contract exactly, so a sandwich makes the zap revert", async () => {
    const { owner, token, pond } = await deploy();
    const bob = (await ethers.getSigners())[9];
    await token.mint(owner, usdc(100_000));
    await token.approve(pond, ethers.MaxUint256);
    const big = usdc(20_000);
    const expected = await previewIn(pond, big);
    await pond.zapIn(big, expected); // exact: would revert if the preview were 1 share too high
    expect(await pond.sharesOf(owner)).to.be.gte(expected);
    // a large holder can exit in full with the exact preview as the minimum
    const shares = await pond.sharesOf(owner);
    const out = await previewOut(pond, shares);
    const before = await token.balanceOf(owner);
    await pond.zapOut(shares, out);
    expect((await token.balanceOf(owner)) - before).to.equal(out);
    // a front-run swap moves the price; the zap with the UI's 1% limit now reverts instead of losing ~half
    const min = ((await previewIn(pond, usdc(1_000))) * 99n) / 100n;
    await token.mint(bob, usdc(30_000));
    await token.connect(bob).approve(pond, ethers.MaxUint256);
    await pond.connect(bob).swap(true, usdc(20_000), 0);
    await expect(pond.zapIn(usdc(1_000), min)).to.be.revertedWithCustomError(pond, "Slippage");
  });

  it("zapIn with USDC only, then zapOut back to USDC, loses only the swap fees", async () => {
    const { alice, token, pond, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    const start = await token.balanceOf(alice.address);
    await relay(alice, pond, "zapIn", [usdc(100), 1]);
    const [shares, , , value] = await pond.positionOf(alice.address);
    expect(shares).to.be.gt(0n);
    expect(value).to.be.closeTo(usdc(100), usdc(0.5));
    await relay(alice, pond, "zapOut", [shares, usdc(99)]);
    const lost = start - (await token.balanceOf(alice.address));
    expect(lost).to.be.lt(usdc(0.7));
    expect(await pond.sharesOf(alice.address)).to.equal(0n);
  });

  it("impermanent loss is real: after the price doubles, LP is worth less than holding", async () => {
    const { alice, bob, token, gavax, pond, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    await fundPlayer(bob);
    await relay(alice, pond, "addLiquidity", [usdc(100), avax(10), 0]);
    const shares = await pond.sharesOf(alice.address);
    // Bob buys gAVAX until the pool price is about $20.
    await token.mint(bob.address, usdc(5_000));
    await relay(bob, pond, "swap", [true, usdc(4_150), 0]);
    expect(await pond.poolPrice()).to.be.closeTo(px(20), px(0.5));
    const u0 = await token.balanceOf(alice.address);
    const a0 = await gavax.balanceOf(alice.address);
    await relay(alice, pond, "removeLiquidity", [shares, 0, 0]);
    const gotU = (await token.balanceOf(alice.address)) - u0;
    const gotA = (await gavax.balanceOf(alice.address)) - a0;
    const lpValue = gotU + (gotA * 20n) / 10n ** 12n; // gAVAX at $20 in USDC units
    const holdValue = usdc(100) + usdc(200);
    expect(lpValue).to.be.lt(holdValue);
    expect(lpValue).to.be.gt((holdValue * 90n) / 100n); // ~5.7% IL at 2× plus fees earned
  });

  it("enforces slippage, share ownership and the locked minimum liquidity", async () => {
    const { alice, pond, relay, fundPlayer } = await deploy();
    await fundPlayer(alice);
    const out = await pond.quote(true, usdc(100));
    await expect(relay(alice, pond, "swap", [true, usdc(100), out + 1n])).to.be.reverted;
    await relay(alice, pond, "swap", [true, usdc(100), out]);
    await expect(relay(alice, pond, "removeLiquidity", [1, 0, 0])).to.be.reverted; // owns no shares
    expect(await pond.sharesOf("0x000000000000000000000000000000000000dEaD")).to.equal(1000n);
  });
});

describe("FarmGame hardening and real yield", () => {
  it("the reward pool cannot be drained: payouts cap at the reserve and principal always returns", async () => {
    const [owner] = await ethers.getSigners();
    const fwd = await (await ethers.getContractFactory("FarmForwarder")).deploy();
    const token = await (await ethers.getContractFactory("GaslessUSDC")).deploy(fwd);
    const game = await (await ethers.getContractFactory("FarmGame")).deploy(fwd, token, DAY);
    await token.mint(owner, usdc(1_000_001));
    await token.approve(game, ethers.MaxUint256);
    await game.fundRewards(usdc(1)); // tiny pool
    await game.plant(2, usdc(1_000_000)); // 90 days at 14% would want ~34,520 USDC
    await time.increase(90 * DAY);
    const due = await game.cropYield(1);
    const before = await token.balanceOf(owner);
    await game.harvest(1);
    expect((await token.balanceOf(owner)) - before).to.equal(usdc(1_000_001));
    expect(await game.rewardReserve()).to.equal(0n);
    expect(await token.balanceOf(game)).to.equal(0n);
    // The interest the pool could not pay is owed, not lost: claim() pays it once the pool is refilled.
    expect((await game.lends(owner)).accrued).to.equal(due - usdc(1));
    await game.fundRewards(due);
    const mid = await token.balanceOf(owner);
    await game.claim();
    expect((await token.balanceOf(owner)) - mid).to.equal(due - usdc(1));
    expect(await game.rewardReserve()).to.equal(usdc(1));
  });

  it("a farm holds at most 12 growing crops, and nobody steals from themselves", async () => {
    const [owner] = await ethers.getSigners();
    const fwd = await (await ethers.getContractFactory("FarmForwarder")).deploy();
    const token = await (await ethers.getContractFactory("GaslessUSDC")).deploy(fwd);
    const game = await (await ethers.getContractFactory("FarmGame")).deploy(fwd, token, DAY);
    await token.mint(owner, usdc(100));
    await token.approve(game, ethers.MaxUint256);
    for (let i = 0; i < 12; i++) await game.plant(0, usdc(1));
    await expect(game.plant(0, usdc(1))).to.be.revertedWithCustomError(game, "FarmFull");
    await game.uproot(1);
    await game.plant(0, usdc(1));
    await expect(game.steal(owner.address)).to.be.revertedWithCustomError(game, "CannotStealFromYourself");
  });

  it("idle USDC earns in a yield source; harvestYield refills the reward pool; exits pull funds back", async () => {
    const { owner, alice, token, game, relay, fundPlayer } = await deploy();
    const src = await (await ethers.getContractFactory("MockYieldSource")).deploy(token, game, 500, DAY);
    await expect(game.connect(alice.connect(ethers.provider)).setYieldSource.staticCall(src)).to.be.reverted;
    await game.connect(owner).setYieldSource(src);
    await token.mint(owner, usdc(1_000));
    await token.connect(owner).transfer(src, usdc(1_000)); // interest reserve: the source pays from it, never mints
    await fundPlayer(alice);
    await relay(alice, game, "deposit", [usdc(1_000)]);
    const idle = await token.balanceOf(game);
    await game.connect(owner).invest(idle); // everything, so the player's exit must divest
    await expect(game.connect(owner).setYieldSource(ethers.ZeroAddress)).to.be.revertedWithCustomError(game, "SourceInUse");
    await time.increase(365 * DAY);
    const reserve0 = await game.rewardReserve();
    await game.harvestYield();
    const gain = (await game.rewardReserve()) - reserve0;
    expect(gain).to.be.closeTo((idle * 5n) / 100n, usdc(1));
    const before = await token.balanceOf(alice.address);
    await relay(alice, game, "withdraw", [usdc(1_000)]);
    expect((await token.balanceOf(alice.address)) - before).to.equal(usdc(1_000));
    expect(await game.invested()).to.be.lt(idle);
  });

  it("switching yield sources pulls interest left in the old one into the reward pool", async () => {
    const { owner, token, game } = await deploy();
    const F = await ethers.getContractFactory("MockYieldSource");
    const oldSrc = await F.deploy(token, game, 500, DAY);
    await game.connect(owner).setYieldSource(oldSrc);
    await token.mint(owner, usdc(1_000));
    await token.connect(owner).transfer(oldSrc, usdc(1_000));
    const idle = await token.balanceOf(game);
    await game.connect(owner).invest(idle);
    await time.increase(30 * DAY);
    await game.harvestYield();
    await time.increase(30 * DAY); // interest keeps accruing between the harvest and the divest
    await game.connect(owner).divest(await game.invested());
    const left = await oldSrc.balance();
    expect(left).to.be.gt(0n);
    const reserve0 = await game.rewardReserve();
    await game.connect(owner).setYieldSource(await F.deploy(token, game, 500, DAY));
    expect(await oldSrc.balance()).to.equal(0n);
    expect(await game.rewardReserve()).to.be.gte(reserve0 + left);
  });

  it("the testnet yield source never mints: interest stops when its reserve runs out, principal stays whole", async () => {
    const { owner, token, game } = await deploy();
    const src = await (await ethers.getContractFactory("MockYieldSource")).deploy(token, game, 500, DAY);
    await game.connect(owner).setYieldSource(src);
    await token.mint(owner, usdc(10));
    await token.connect(owner).transfer(src, usdc(10));
    const idle = await token.balanceOf(game);
    await game.connect(owner).invest(idle);
    const supply = await token.totalSupply();
    await time.increase(10 * 365 * DAY);
    expect(await src.balance()).to.equal(idle + usdc(10));
    await game.harvestYield();
    await game.connect(owner).divest(await game.invested());
    expect(await token.totalSupply()).to.equal(supply);
    expect(await src.interestReserve()).to.equal(0n);
    expect(await token.balanceOf(src)).to.equal(0n);
  });

  it("the Aave v3 adapter supplies, reports aToken growth, and withdraws for the game", async () => {
    const [owner] = await ethers.getSigners();
    const fwd = await (await ethers.getContractFactory("FarmForwarder")).deploy();
    const token = await (await ethers.getContractFactory("GaslessUSDC")).deploy(fwd);
    const game = await (await ethers.getContractFactory("FarmGame")).deploy(fwd, token, DAY);
    const pool = await (await ethers.getContractFactory("MockAavePool")).deploy(token);
    const src = await (await ethers.getContractFactory("AaveV3YieldSource")).deploy(pool, token, pool, game);
    await game.setYieldSource(src);
    await token.mint(owner, usdc(1_000));
    await token.approve(game, ethers.MaxUint256);
    await game.fundRewards(usdc(1_000));
    await game.invest(usdc(1_000));
    await pool.accrue(src, usdc(25));
    expect(await src.balance()).to.equal(usdc(1_025));
    await game.harvestYield();
    expect(await game.rewardReserve()).to.equal(usdc(1_025));
    await expect(src.withdraw(1)).to.be.revertedWithCustomError(src, "NotClient");
  });
});

describe("Quản gia: session key expiry", () => {
  it("an expired agent key stops working on its own; a past expiry is refused", async () => {
    const [owner, agent] = await ethers.getSigners();
    const butler = await (await ethers.getContractFactory("ButlerAccount")).deploy(owner, DAY);
    await expect(butler.setAgent(agent, 1, (await time.latest()) - 1)).to.be.revertedWithCustomError(butler, "BadExpiry");
    const until = (await time.latest()) + 3600;
    await butler.setAgent(agent, 1, until);
    const target = await butler.getAddress();
    const data = butler.interface.encodeFunctionData("remainingToday");
    await butler.setRule(target, data.slice(0, 10), true, 0, ethers.ZeroAddress);
    await butler.connect(agent).execute(target, data);
    await time.increaseTo(until + 1);
    await expect(butler.connect(agent).execute(target, data)).to.be.revertedWithCustomError(butler, "AgentExpired");
  });
});
