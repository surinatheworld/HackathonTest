// Stateful fuzzing (JS, no Foundry needed): seeded random sequences of player and admin actions across
// FarmGame, FarmPond, FarmCoop and FarmQuests, with the money invariants checked after every step.
// FUZZ_SEEDS=1,2,3 and FUZZ_STEPS=150 widen the search; the defaults keep CI fast. Seeds are fixed, so a
// failure always replays the same way.
const { expect, AssertionError } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 60;
const U = (n) => ethers.parseUnits(String(n), 6);
const A = (n) => ethers.parseUnits(String(n), 18);
const SEEDS = (process.env.FUZZ_SEEDS || "1,2,3").split(",").map(Number);
const STEPS = Number(process.env.FUZZ_STEPS || 120);

function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (xs) => xs[Math.floor(next() * xs.length)] };
}

async function setup() {
  const [owner, ...rest] = await ethers.getSigners();
  const players = rest.slice(0, 5);
  const F = (n) => ethers.getContractFactory(n);
  const fwd = await (await F("FarmForwarder")).deploy();
  const usdc = await (await F("GaslessUSDC")).deploy(fwd);
  const gavax = await (await F("GaslessAVAX")).deploy(fwd);
  const feed = await (await F("DemoPriceFeed")).deploy(ethers.parseUnits("20", 8));
  const game = await (await F("FarmGame")).deploy(fwd, usdc, DAY);
  const coop = await (await F("FarmCoop")).deploy(fwd, usdc, gavax, feed, 365 * 86400, DAY);
  const pond = await (await F("FarmPond")).deploy(fwd, usdc, gavax);
  const items = await (await F("FarmItems")).deploy(fwd, game, coop, pond);
  const quests = await (await F("FarmQuests")).deploy(fwd, game, coop, pond, items, usdc);
  const source = await (await F("MockYieldSource")).deploy(usdc, game, 500, DAY);

  await usdc.mint(owner, U(200_000));
  await gavax.mint(owner, A(10_000));
  await usdc.approve(game, ethers.MaxUint256);
  await game.fundRewards(U(5_000));
  await game.setYieldSource(source);
  await usdc.transfer(source, U(500)); // interest reserve
  await usdc.approve(coop, ethers.MaxUint256);
  await coop.fund(U(20_000));
  await usdc.approve(pond, ethers.MaxUint256);
  await gavax.approve(pond, ethers.MaxUint256);
  await pond.addLiquidity(U(20_000), A(1_000), 0);
  await usdc.transfer(quests, U(2_000));
  for (const p of players) {
    await usdc.mint(p, U(5_000));
    await gavax.mint(p, A(200));
    for (const s of [game, coop, pond]) {
      await usdc.connect(p).approve(s, ethers.MaxUint256);
      await gavax.connect(p).approve(s, ethers.MaxUint256);
    }
  }
  return { owner, players, usdc, gavax, feed, game, coop, pond, quests, source };
}

async function checkInvariants(c, crops, label) {
  const { usdc, gavax, game, coop, pond, quests, players, owner } = c;
  // FarmGame: everything it owes players and the reward pool is backed by USDC held or parked in the source.
  const [held, invested, lent, locked, reserve] = await Promise.all([
    usdc.balanceOf(game), game.invested(), game.totalLent(), game.totalLocked(), game.rewardReserve(),
  ]);
  expect(held + invested, `${label}: FarmGame solvent`).to.be.gte(lent + locked + reserve);
  let sumLent = 0n, sumLocked = 0n;
  for (const p of players) sumLent += (await game.lends(p)).principal;
  for (const id of crops) {
    const cr = await game.crops(id);
    if (cr.status === 1n) sumLocked += cr.amount;
  }
  expect(sumLent, `${label}: totalLent = sum of principal`).to.equal(lent);
  expect(sumLocked, `${label}: totalLocked = sum of growing crops`).to.equal(locked);
  // FarmPond: reserves are really held, shares add up.
  expect(await usdc.balanceOf(pond), `${label}: pond USDC held`).to.be.gte(await pond.reserveUsdc());
  expect(await gavax.balanceOf(pond), `${label}: pond gAVAX held`).to.be.gte(await pond.reserveAvax());
  let shares = await pond.sharesOf(owner);
  for (const p of players) shares += await pond.sharesOf(p);
  expect(shares, `${label}: shares add up`).to.be.lte(await pond.totalShares());
  // FarmCoop: collateral is really held and adds up.
  let coll = 0n;
  for (const p of players) coll += (await coop.positions(p)).collateral;
  expect(coll, `${label}: totalCollateral = sum of collateral`).to.equal(await coop.totalCollateral());
  expect(await gavax.balanceOf(coop), `${label}: coop gAVAX held`).to.be.gte(coll);
  // FarmQuests: rewards only ever leave the funded pool; what a dry pool could not pay is owed, never lost.
  let paid = 0n;
  for (const p of players) {
    const n = await quests.progress(p);
    expect(n).to.be.lte(18n);
    let earned = 0n;
    for (let q = 0n; q < n; q++) earned += await quests.rewardOf(q);
    const owed = await quests.owed(p);
    expect(owed, `${label}: owed <= earned`).to.be.lte(earned);
    paid += earned - owed;
  }
  expect((await quests.rewardPool()) + paid, `${label}: quest pool conserved`).to.equal(U(2_000));
}

describe("Invariants under random play (seeded stateful fuzzing)", function () {
  this.timeout(600_000);
  for (const seed of SEEDS) {
    it(`seed ${seed}: ${STEPS} random actions keep every pool solvent`, async () => {
      const r = rng(seed);
      const c = await setup();
      const { players, owner, game, coop, pond, quests, feed } = c;
      const crops = [];
      const anyCrop = () => r.pick(crops.length ? crops : [1n]);
      let ok = 0;
      const actions = [
        (p) => game.connect(p).deposit(U(1 + r.int(500))),
        (p) => game.connect(p).withdraw(U(1 + r.int(300))),
        (p) => game.connect(p).claim(),
        async (p) => {
          const tx = await game.connect(p).plant(r.int(3), U(1 + r.int(400)));
          crops.push((await game.nextCropId()) - 1n);
          return tx;
        },
        (p) => game.connect(p).harvest(anyCrop()),
        (p) => game.connect(p).uproot(anyCrop()),
        (p) => game.connect(p).water(anyCrop()),
        (p) => game.connect(p).collect(),
        (p) => game.connect(p).steal(r.pick(players).address),
        (p) => game.connect(p).setGuard(r.next() < 0.5),
        () => game.connect(owner).invest(U(1 + r.int(3_000))),
        () => game.connect(owner).divest(U(1 + r.int(3_000))),
        () => game.harvestYield(),
        (p) => pond.connect(p).zapIn(U(1 + r.int(800)), 0),
        async (p) => pond.connect(p).zapOut((await pond.sharesOf(p)) / BigInt(1 + r.int(3)), 0),
        async (p) => {
          const usdcIn = r.next() < 0.5;
          const amt = usdcIn ? U(1 + r.int(1_500)) : A(1 + r.int(60));
          const k0 = (await pond.reserveUsdc()) * (await pond.reserveAvax());
          const tx = await pond.connect(p).swap(usdcIn, amt, 0);
          const k1 = (await pond.reserveUsdc()) * (await pond.reserveAvax());
          expect(k1, "a swap never shrinks the pond").to.be.gte(k0);
          return tx;
        },
        (p) => coop.connect(p).depositCollateral(A(1 + r.int(80))),
        (p) => coop.connect(p).withdrawCollateral(A(1 + r.int(80))),
        (p) => coop.connect(p).borrow(U(1 + r.int(600))),
        (p) => coop.connect(p).repay(p.address, U(1 + r.int(600))),
        (p) => coop.connect(p).liquidate(r.pick(players).address),
        () => feed.connect(owner).setPrice(ethers.parseUnits(String(5 + r.int(30)), 8)),
        async (p) => quests.connect(p).complete((await quests.hintFor(p, await quests.progress(p)))[1]),
        (p) => quests.connect(p).claimOwed(),
        () => time.increase(1 + r.int(DAY * 20)),
      ];
      for (let i = 0; i < STEPS; i++) {
        const p = r.pick(players);
        const k = r.int(actions.length);
        try {
          await actions[k](p);
          ok++;
        } catch (e) {
          if (e instanceof AssertionError) throw e;
          // a revert is fine: that action was not allowed in that state
        }
        await checkInvariants(c, crops, `seed ${seed} step ${i} action ${k}`);
      }

      // Everyone leaves: principal and growing crops come back, and the reward pool is still backed.
      await feed.connect(owner).setPrice(ethers.parseUnits("20", 8));
      await time.increase(DAY * 100);
      for (const p of players) {
        const l = await game.lends(p);
        if (l.principal > 0n) await game.connect(p).withdraw(l.principal);
        await game.connect(p).claim();
      }
      for (const id of crops) {
        const cr = await game.crops(id);
        if (cr.status === 1n) await game.connect(await ethers.getSigner(cr.owner)).harvest(id);
      }
      expect(await game.totalLent()).to.equal(0n);
      expect(await game.totalLocked()).to.equal(0n);
      await checkInvariants(c, crops, `seed ${seed} after exit`);
      expect(ok, "enough actions succeeded to be meaningful").to.be.gte(STEPS / 4);
    });
  }
});
