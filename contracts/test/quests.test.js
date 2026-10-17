const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 60;
const usdc = (n) => ethers.parseUnits(String(n), 6);
const avax = (n) => ethers.parseUnits(String(n), 18);
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
  return { owner, alice, bob, token, gavax, feed, game, coop, pond, items, quests, relay };
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
      await quests.connect(alice).complete();
      expect((await token.balanceOf(alice)) - before).to.equal(reward);
      paid += reward;
    };
    const notYet = async (q) => {
      await expect(quests.connect(alice).complete()).to.be.revertedWithCustomError(quests, "NotDoneYet").withArgs(q);
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
    for (let d = 0; d < 7; d++) { await time.increase(DAY); await game.connect(alice).water(1); }
    await items.connect(alice).claimBadge(1005, 0);
    await done(14);
    await coop.connect(alice).borrow(usdc(20)); // health 3.75 >= 1.5
    await items.connect(alice).startWatch(1004);
    await items.connect(alice).startWatch(1003);
    await time.increase(3 * DAY);
    await items.connect(alice).claimBadge(1004, 0);
    await done(15);
    await time.increase(90 * DAY);
    await game.connect(alice).harvest(1);
    await items.connect(alice).claimBadge(1002, 1);
    await done(16);
    await items.connect(alice).claimBadge(1001, 0);
    await items.connect(alice).claimBadge(1003, 0);
    await items.connect(alice).claimBadge(1006, 0);
    await done(17);

    expect(await quests.progress(alice)).to.equal(18n);
    expect(paid).to.equal(usdc(760));
    await expect(quests.connect(alice).complete()).to.be.revertedWithCustomError(quests, "AllDone");
    const [q, ready, reward] = await quests.status(alice);
    expect([q, ready, reward]).to.deep.equal([18n, false, 0n]);
  });

  it("quests unlock one at a time: doing a later one first does not skip ahead", async () => {
    const { alice, token, game, quests } = await deploy();
    await token.connect(alice).faucet();
    await token.connect(alice).approve(game, ethers.MaxUint256);
    await game.connect(alice).plant(0, usdc(10)); // quest 2's condition, before quest 1
    await quests.connect(alice).complete(); // quest 0
    await expect(quests.connect(alice).complete()).to.be.revertedWithCustomError(quests, "NotDoneYet").withArgs(1);
    expect(await quests.check(alice, 2)).to.equal(true);
    expect(await quests.progress(alice)).to.equal(1n);
  });

  it("works gasless for a wallet with no AVAX", async () => {
    const { token, quests, relay } = await deploy();
    const zero = ethers.Wallet.createRandom().connect(ethers.provider);
    await relay(zero, token, "faucet", []);
    await relay(zero, quests, "complete", []);
    expect(await quests.progress(zero.address)).to.equal(1n);
    expect(await token.balanceOf(zero.address)).to.equal(usdc(1_010));
    expect(await ethers.provider.getBalance(zero.address)).to.equal(0n);
  });
});
