const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 60;
const usdc = (n) => ethers.parseUnits(String(n), 6);
const avax = (n) => ethers.parseUnits(String(n), 18);
// Daily loops below take a little more than one game day per round, so start them at the top of a day.
const startOfDay = async () => time.increaseTo(Math.ceil(((await time.latest()) + 1) / DAY) * DAY + 1);
const KIND = 1_000_000_000n;
const TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
  ],
};

async function deploy() {
  const [owner, alice, bob, relayer] = await ethers.getSigners();
  const F = (n) => ethers.getContractFactory(n);
  const fwd = await (await F("FarmForwarder")).deploy();
  const token = await (await F("GaslessUSDC")).deploy(fwd);
  const gavax = await (await F("GaslessAVAX")).deploy(fwd);
  const feed = await (await F("DemoPriceFeed")).deploy(ethers.parseUnits("10", 8));
  const game = await (await F("FarmGame")).deploy(fwd, token, DAY);
  const coop = await (await F("FarmCoop")).deploy(fwd, token, gavax, feed, 365 * 86400, DAY);
  const pond = await (await F("FarmPond")).deploy(fwd, token, gavax);
  const items = await (await F("FarmItems")).deploy(fwd, game, coop, pond);
  const quests = await (await F("FarmQuests")).deploy(fwd, game, coop, pond, items, token);
  await token.mint(owner, usdc(100_000));
  await gavax.mint(owner, avax(1_000));
  await token.transfer(quests, usdc(5_000)); // reward pool
  await token.approve(game, ethers.MaxUint256);
  await game.fundRewards(usdc(10_000));
  await token.approve(coop, ethers.MaxUint256);
  await coop.fund(usdc(10_000));
  await token.approve(pond, ethers.MaxUint256);
  await gavax.approve(pond, ethers.MaxUint256);
  await pond.addLiquidity(usdc(10_000), avax(1_000), 0);
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "NongTraiDeFi", version: "1", chainId, verifyingContract: await fwd.getAddress() };
  const relay = async (who, target, fn, args) => {
    const req = { from: who.address, to: await target.getAddress(), value: 0n, gas: 800_000n, nonce: await fwd.nonces(who.address), deadline: (await time.latest()) + 600, data: target.interface.encodeFunctionData(fn, args) };
    const signature = await who.signTypedData(domain, TYPES, req);
    const { nonce, ...rest } = req;
    return fwd.connect(relayer).execute({ ...rest, signature });
  };
  const signed = async (who, target, fn, args, nonce) => {
    const req = { from: who.address, to: await target.getAddress(), value: 0n, gas: 300_000n, nonce, deadline: (await time.latest()) + 600, data: target.interface.encodeFunctionData(fn, args) };
    const signature = await who.signTypedData(domain, TYPES, req);
    const { nonce: _, ...rest } = req;
    return { ...rest, signature };
  };
  return { owner, alice, bob, token, gavax, feed, game, coop, pond, items, quests, relay, fwd, signed };
}

describe("Nhiệm vụ (FarmQuests): 18 quests, easy to hard, checked on-chain", () => {
  it("a player walks through all five chapters in order and earns 760 test USDC", async () => {
    const { alice, bob, token, gavax, game, coop, pond, items, quests } = await deploy();
    let paid = 0n;
    const done = async (q) => {
      const [cur, ready, reward] = await quests.status(alice);
      expect(cur).to.equal(BigInt(q));
      expect(ready, `quest ${q} should be ready`).to.equal(true);
      const before = await token.balanceOf(alice);
      const [, hint] = await quests.hintFor(alice, q);
      await quests.connect(alice).complete(hint);
      expect((await token.balanceOf(alice)) - before).to.equal(reward);
      paid += reward;
    };
    const notYet = async (q) => {
      await expect(quests.connect(alice).complete(0)).to.be.revertedWithCustomError(quests, "NotDoneYet").withArgs(q);
    };

    // Chương 1: Làm quen
    await notYet(0);
    await token.connect(alice).faucet();
    await done(0);
    await notYet(1);
    for (const s of [game, coop, pond]) { await token.connect(alice).approve(s, ethers.MaxUint256); await gavax.connect(alice).approve(s, ethers.MaxUint256); }
    await game.connect(alice).deposit(usdc(10));
    await done(1);
    await game.connect(alice).plant(2, usdc(10)); // crop 1: a durian for chương 5, ripe in 90 days
    await done(2);
    await game.connect(alice).water(1);
    await done(3);

    // Chương 2: Chăm vườn
    await game.connect(alice).plant(0, usdc(100)); // crop 2: chili
    await notYet(4);
    await time.increase(7 * DAY + 1);
    await game.connect(alice).harvest(2);
    await done(4);
    await done(5); // 100 points from the harvest
    await items.connect(alice).claimHarvest(2);
    await done(6);
    await items.connect(alice).buy(2001, 1);
    await done(7);

    // Chương 3: Tài chính
    await pond.connect(alice).zapIn(usdc(50), 1);
    await done(8);
    await gavax.connect(alice).faucet();
    await coop.connect(alice).depositCollateral(avax(10));
    await coop.connect(alice).borrow(usdc(20));
    await done(9);
    await notYet(10); // still in debt
    await coop.connect(alice).repay(alice, usdc(1_000));
    await done(10);

    // Chương 4: Làng xóm
    const [ids] = await items.itemsOf(alice);
    const chili = ids.find((id) => id / KIND === 1n);
    await items.connect(alice).makeOffer({ giveIds: [chili], giveAmts: [1], wantIds: [2n * KIND], wantAmts: [1] }, ethers.ZeroAddress, 1);
    await done(11);
    await token.connect(bob).faucet();
    await token.connect(bob).approve(game, ethers.MaxUint256);
    await game.connect(bob).plant(0, usdc(10));
    const [bobIds] = await game.cropsOf(bob);
    await game.connect(bob).water(bobIds[0]);
    await notYet(12);
    await game.connect(alice).steal(bob);
    await done(12);
    await game.connect(alice).setGuard(true);
    await done(13);

    // Chương 5: Bậc thầy
    await notYet(14);
    await startOfDay();
    for (let d = 0; d < 7; d++) { await time.increase(DAY); await game.connect(alice).water(1); }
    await items.connect(alice).claimBadge(1005, 0);
    await done(14);
    await coop.connect(alice).borrow(usdc(20)); // health 3.75 >= 1.5
    await startOfDay();
    await items.connect(alice).startWatch(1004);
    await items.connect(alice).startWatch(1003);
    for (let d = 0; d < 3; d++) { await time.increase(DAY); await items.connect(alice).startWatch(1003); await items.connect(alice).startWatch(1004); } // daily check-ins
    await items.connect(alice).claimBadge(1004, 0);
    await items.connect(alice).claimBadge(1003, 0);
    await done(15);
    await time.increase(90 * DAY);
    await game.connect(alice).harvest(1);
    await items.connect(alice).claimBadge(1002, 1);
    await done(16);
    await items.connect(alice).claimBadge(1001, 0);
    await items.connect(alice).claimBadge(1006, 0);
    await done(17);

    expect(await quests.progress(alice)).to.equal(18n);
    expect(paid).to.equal(usdc(760));
    await expect(quests.connect(alice).complete(0)).to.be.revertedWithCustomError(quests, "AllDone");
    const [q, ready, reward] = await quests.status(alice);
    expect([q, ready, reward]).to.deep.equal([18n, false, 0n]);
  });

  it("quests unlock one at a time: doing a later one first does not skip ahead", async () => {
    const { alice, token, game, quests } = await deploy();
    await token.connect(alice).faucet();
    await token.connect(alice).approve(game, ethers.MaxUint256);
    await game.connect(alice).plant(0, usdc(10)); // quest 2's condition, before quest 1
    await quests.connect(alice).complete(0); // quest 0
    await expect(quests.connect(alice).complete(0)).to.be.revertedWithCustomError(quests, "NotDoneYet").withArgs(1);
    expect((await quests.hintFor(alice, 2))[0]).to.equal(true);
    expect(await quests.progress(alice)).to.equal(1n);
  });

  it("pays rewards from the funded pool, never mints; a dry pool owes the reward instead of blocking progress", async () => {
    const { owner, alice, token, game, quests } = await deploy();
    await token.connect(alice).faucet();
    const supply = await token.totalSupply();
    await quests.connect(alice).complete(0);
    expect(await token.totalSupply()).to.equal(supply);
    expect(await quests.rewardPool()).to.equal(usdc(4_990));
    await expect(quests.connect(alice).withdrawPool(alice, 1)).to.be.revertedWithCustomError(quests, "OwnableUnauthorizedAccount");
    await quests.withdrawPool(owner, usdc(4_990));
    await token.connect(alice).approve(game, ethers.MaxUint256);
    await game.connect(alice).deposit(usdc(10));
    const before = await token.balanceOf(alice);
    await expect(quests.connect(alice).complete(0)).to.emit(quests, "RewardOwed").withArgs(alice.address, 1n, usdc(10));
    expect(await quests.progress(alice), "the learning path goes on").to.equal(2n);
    expect(await quests.owed(alice)).to.equal(usdc(10));
    expect(await token.balanceOf(alice)).to.equal(before);
    await expect(quests.connect(alice).claimOwed()).to.be.revertedWithCustomError(quests, "RewardPoolEmpty").withArgs(0, usdc(10));
    await expect(quests.connect(owner).claimOwed()).to.be.revertedWithCustomError(quests, "NothingOwed");
    await token.transfer(quests, usdc(4)); // a partial top-up pays what it can
    await expect(quests.connect(alice).claimOwed()).to.emit(quests, "OwedPaid").withArgs(alice.address, usdc(4), usdc(6));
    await token.transfer(quests, usdc(100));
    await quests.connect(alice).claimOwed();
    expect(await quests.owed(alice)).to.equal(0n);
    expect((await token.balanceOf(alice)) - before).to.equal(usdc(10));
    expect(await quests.rewardPool()).to.equal(usdc(94));
  });

  it("a contract cannot play quests, so it cannot spin up throwaway players to drain the pool", async () => {
    const { owner, token, game, quests } = await deploy();
    const farmer = await (await ethers.getContractFactory("QuestFarmerMock")).deploy();
    await token.transfer(farmer, usdc(10) + 1n); // funded by a plain transfer, no faucet needed
    // Before the fix this took 40 USDC from the pool, and a loop of such farmers emptied it in a few transactions.
    await expect(farmer.run(token, game, quests)).to.be.revertedWithCustomError(quests, "NotAPlayer");
    expect(await quests.rewardPool()).to.equal(usdc(5_000));
    expect(await quests.progress(farmer)).to.equal(0n);
    await quests.connect(owner).complete(0); // a wallet still plays as before
    expect(await quests.progress(owner)).to.equal(1n);
  });

  it("claiming costs the same gas however long the player has played (no history scans)", async () => {
    const { alice, token, game, quests } = await deploy();
    await token.connect(alice).faucet();
    await token.connect(alice).approve(game, ethers.MaxUint256);
    await quests.connect(alice).complete(0); // quest 0
    await game.connect(alice).deposit(usdc(10));
    await quests.connect(alice).complete(0); // quest 1
    for (let i = 0; i < 80; i++) { await game.connect(alice).plant(0, usdc(1)); await game.connect(alice).uproot(i + 1); }
    const [ready, hint] = await quests.hintFor(alice, 2);
    expect(ready).to.equal(true);
    const gas = await quests.connect(alice).complete.estimateGas(hint);
    expect(gas, "under the 300k the game sends").to.be.lt(150_000n);
    await expect(quests.connect(alice).complete(9999)).to.be.revertedWithCustomError(quests, "NotDoneYet").withArgs(2);
    await quests.connect(alice).complete(hint, { gasLimit: 300_000 });
    expect(await quests.progress(alice)).to.equal(3n);
  });

  it("works gasless for a wallet with no AVAX, owed rewards included", async () => {
    const { owner, token, quests, relay } = await deploy();
    const zero = ethers.Wallet.createRandom().connect(ethers.provider);
    await relay(zero, token, "faucet", []);
    await relay(zero, quests, "complete", [0]);
    expect(await quests.progress(zero.address)).to.equal(1n);
    expect(await token.balanceOf(zero.address)).to.equal(usdc(1_010));
    await quests.withdrawPool(owner, await quests.rewardPool());
    await relay(zero, token, "approve", [await quests.game(), ethers.MaxUint256]);
    const game = await ethers.getContractAt("FarmGame", await quests.game());
    await relay(zero, game, "deposit", [usdc(10)]);
    await relay(zero, quests, "complete", [0]);
    expect(await quests.owed(zero.address)).to.equal(usdc(10));
    await token.transfer(quests, usdc(10));
    await relay(zero, quests, "claimOwed", []);
    expect(await quests.owed(zero.address)).to.equal(0n);
    expect(await token.balanceOf(zero.address)).to.equal(usdc(1_010));
    expect(await ethers.provider.getBalance(zero.address)).to.equal(0n);
  });

  it("a player alone in the village can pick from Vườn bác Tư (the built-in neighbour) and finish quests 12 and 13", async () => {
    const { alice, bob, token, game, quests } = await deploy();
    const N = await game.NEIGHBOUR();
    const before = await game.farmers(N);
    await expect(game.connect(alice).steal(N)).to.be.revertedWithCustomError(game, "NotAFarmer"); // needs a crop
    await token.connect(alice).faucet();
    await token.connect(alice).approve(game, ethers.MaxUint256);
    await game.connect(alice).plant(0, usdc(10));
    expect(await quests.check(alice, 12, 0)).to.equal(false);
    await expect(game.connect(alice).steal(N)).to.emit(game, "Stolen").withArgs(alice.address, N, 3n);
    expect((await game.farmers(alice)).points).to.equal(3n);
    expect(await quests.check(alice, 12, 0)).to.equal(true);
    await expect(game.connect(alice).steal(N)).to.be.revertedWithCustomError(game, "StealCooldown");
    await game.connect(alice).setGuard(true);
    expect(await quests.check(alice, 13, 0)).to.equal(true);
    // Still open to everyone the next day, and the neighbour's own record never changes.
    await token.connect(bob).faucet();
    await token.connect(bob).approve(game, ethers.MaxUint256);
    await game.connect(bob).plant(0, usdc(10));
    await game.connect(bob).steal(N);
    await time.increase(DAY);
    await game.connect(alice).steal(N);
    expect((await game.farmers(alice)).points).to.equal(6n);
    expect(await game.farmers(N)).to.deep.equal(before);
  });

  it("many offline keys can play in one forwarder batch (a known testnet limit), but at most 1,000 USDC leaves the pool per hour", async () => {
    const { alice, token, quests, fwd, signed } = await deploy();
    const keys = Array.from({ length: 110 }, () => ethers.Wallet.createRandom());
    const reqs = [];
    for (const k of keys) reqs.push(await signed(k, token, "faucet", [], 0n), await signed(k, quests, "complete", [0], 1n));
    await fwd.connect(alice).executeBatch(reqs, ethers.ZeroAddress, { gasLimit: 29_000_000 });
    for (const k of keys) expect(await quests.progress(k.address)).to.equal(1n);
    // 100 rewards of 10 USDC were paid, the other 10 players are owed theirs; the pool was not emptied.
    expect(await quests.rewardPool()).to.equal(usdc(4_000));
    const owedKeys = [];
    for (const k of keys) if ((await quests.owed(k.address)) > 0n) owedKeys.push(k);
    expect(owedKeys.length).to.equal(10);
    expect(await quests.payableNow()).to.equal(0n);
    // A real player this hour is owed too, and is paid once the next hour starts.
    await token.connect(alice).faucet();
    await quests.connect(alice).complete(0);
    expect(await quests.owed(alice)).to.equal(usdc(10));
    await expect(quests.connect(alice).claimOwed()).to.be.revertedWithCustomError(quests, "RewardPoolEmpty");
    await time.increase(3600);
    expect(await quests.payableNow()).to.equal(usdc(1_000));
    await quests.connect(alice).claimOwed();
    expect(await quests.owed(alice)).to.equal(0n);
    expect(await quests.paidThisHour()).to.equal(usdc(10));
  });
});
