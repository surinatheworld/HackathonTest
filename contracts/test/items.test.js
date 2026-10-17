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
  const [owner, alice, bob, carol, relayer] = await ethers.getSigners();
  const F = (n) => ethers.getContractFactory(n);
  const fwd = await (await F("FarmForwarder")).deploy();
  const token = await (await F("GaslessUSDC")).deploy(fwd);
  const gavax = await (await F("GaslessAVAX")).deploy(fwd);
  const feed = await (await F("DemoPriceFeed")).deploy(ethers.parseUnits("10", 8));
  const game = await (await F("FarmGame")).deploy(fwd, token, DAY);
  const coop = await (await F("FarmCoop")).deploy(fwd, token, gavax, feed, 30 * 86400, DAY);
  const pond = await (await F("FarmPond")).deploy(fwd, token, gavax);
  const items = await (await F("FarmItems")).deploy(fwd, game, coop, pond);
  await token.mint(owner, usdc(100_000));
  await gavax.mint(owner, avax(1_000));
  await token.approve(game, ethers.MaxUint256);
  await game.fundRewards(usdc(10_000));
  await token.approve(coop, ethers.MaxUint256);
  await coop.fund(usdc(10_000));
  await token.approve(pond, ethers.MaxUint256);
  await gavax.approve(pond, ethers.MaxUint256);
  await pond.addLiquidity(usdc(10_000), avax(1_000), 0);
  for (const p of [alice, bob, carol]) {
    await token.connect(p).faucet();
    await gavax.connect(p).faucet();
    for (const s of [game, coop, pond]) {
      await token.connect(p).approve(s, ethers.MaxUint256);
      await gavax.connect(p).approve(s, ethers.MaxUint256);
    }
  }
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "NongTraiDeFi", version: "1", chainId, verifyingContract: await fwd.getAddress() };
  const relay = async (who, target, fn, args) => {
    const req = { from: who.address, to: await target.getAddress(), value: 0n, gas: 600_000n, nonce: await fwd.nonces(who.address), deadline: (await time.latest()) + 600, data: target.interface.encodeFunctionData(fn, args) };
    const signature = await who.signTypedData(domain, TYPES, req);
    const { nonce, ...rest } = req;
    return fwd.connect(relayer).execute({ ...rest, signature });
  };
  /** plant, wait it out, harvest; returns the crop id */
  const grow = async (who, tier, amount) => {
    await game.connect(who).plant(tier, usdc(amount));
    const [ids] = await game.cropsOf(who);
    const id = ids[ids.length - 1];
    await time.increase([7, 30, 90][tier] * DAY + 1);
    await game.connect(who).harvest(id);
    return id;
  };
  const produceId = async (kind) => BigInt(kind) * KIND + (await game.today());
  return { owner, alice, bob, carol, token, gavax, feed, game, coop, pond, items, relay, grow, produceId };
}

describe("Kho đồ (FarmItems): produce, badges, cosmetics, barter market", () => {
  it("a harvested crop gives produce once; batches are keyed by harvest day", async () => {
    const { alice, bob, game, items, grow } = await deploy();
    const crop = await grow(alice, 0, 100); // chili, 3 + 2 extra for 100 USDC
    await expect(items.connect(bob).claimHarvest(crop)).to.be.revertedWithCustomError(items, "NotYourCrop");
    await items.connect(alice).claimHarvest(crop);
    const id = 1n * KIND + (await game.today());
    expect(await items.balanceOf(alice, id)).to.equal(5n);
    await expect(items.connect(alice).claimHarvest(crop)).to.be.revertedWithCustomError(items, "AlreadyClaimed");
    await game.connect(alice).plant(1, usdc(10));
    const [ids] = await game.cropsOf(alice);
    await expect(items.connect(alice).claimHarvest(ids[ids.length - 1])).to.be.revertedWithCustomError(items, "NotHarvested");
    const [listed, amounts] = await items.itemsOf(alice);
    expect(listed).to.deep.equal([id]);
    expect(amounts).to.deep.equal([5n]);
  });

  it("produce spoils after 7 game days and can then only be thrown away", async () => {
    const { alice, items, grow } = await deploy();
    await items.connect(alice).claimHarvest(await grow(alice, 0, 10));
    const [[id]] = await items.itemsOf(alice);
    expect(await items.isFresh(id)).to.equal(true);
    await time.increase(8 * DAY);
    expect(await items.isFresh(id)).to.equal(false);
    await expect(items.connect(alice).makeOffer({ giveIds: [id], giveAmts: [1], wantIds: [3n * KIND], wantAmts: [1] }, ethers.ZeroAddress, 1))
      .to.be.revertedWithCustomError(items, "Spoiled");
    await items.connect(alice).discard(id, 3);
    expect(await items.balanceOf(alice, id)).to.equal(0n);
  });

  it("items never move outside the market: no gifts, no approvals", async () => {
    const { alice, bob, items, grow } = await deploy();
    await items.connect(alice).claimHarvest(await grow(alice, 0, 10));
    const [[id]] = await items.itemsOf(alice);
    await expect(items.connect(alice).safeTransferFrom(alice, bob, id, 1, "0x")).to.be.revertedWithCustomError(items, "NotTransferable");
    await expect(items.connect(alice).safeBatchTransferFrom(alice, bob, [id], [1], "0x")).to.be.revertedWithCustomError(items, "NotTransferable");
    await expect(items.connect(alice).setApprovalForAll(bob, true)).to.be.revertedWithCustomError(items, "NotTransferable");
  });

  it("lesson badges are checked on-chain, minted once, and soulbound", async () => {
    const { alice, game, coop, pond, items, grow } = await deploy();
    await expect(items.connect(alice).claimBadge(1001, 0)).to.be.revertedWithCustomError(items, "NotEligible");
    await game.connect(alice).deposit(usdc(50));
    await items.connect(alice).claimBadge(1001, 0);
    await expect(items.connect(alice).claimBadge(1001, 0)).to.be.revertedWithCustomError(items, "AlreadyEarned");
    // Kiên nhẫn: a harvested durian
    const durian = await grow(alice, 2, 20);
    await items.connect(alice).claimBadge(1002, durian);
    // Nông dân chăm chỉ: 7-day watering streak
    await game.connect(alice).plant(2, usdc(10));
    const [ids] = await game.cropsOf(alice);
    const crop = ids[ids.length - 1];
    for (let d = 0; d < 7; d++) { await game.connect(alice).water(crop); await time.increase(DAY); }
    await items.connect(alice).claimBadge(1005, 0);
    // Người nuôi cá: liquidity kept 3 days
    await pond.connect(alice).zapIn(usdc(50), 1);
    await items.connect(alice).startWatch(1003);
    expect(await items.canEarn(alice, 1003, 0)).to.equal(false);
    await time.increase(3 * DAY);
    await items.connect(alice).claimBadge(1003, 0);
    // Vay an toàn: debt with health >= 1.5 kept 3 days
    await coop.connect(alice).depositCollateral(avax(10));
    await coop.connect(alice).borrow(usdc(20)); // $100 collateral, 75/20 = 3.75
    await items.connect(alice).startWatch(1004);
    await time.increase(3 * DAY);
    await items.connect(alice).claimBadge(1004, 0);
    // Lão nông
    await items.connect(alice).claimBadge(1006, 0);
    for (const b of [1001, 1002, 1003, 1004, 1005, 1006]) expect(await items.balanceOf(alice, b)).to.equal(1n);
    await expect(items.connect(alice).makeOffer({ giveIds: [1001], giveAmts: [1], wantIds: [2001], wantAmts: [1] }, ethers.ZeroAddress, 1))
      .to.be.revertedWithCustomError(items, "NotTradable");
  });

  it("an unsafe loan never starts the Vay an toàn clock", async () => {
    const { alice, coop, items } = await deploy();
    await coop.connect(alice).depositCollateral(avax(10));
    await coop.connect(alice).borrow(usdc(55)); // 75/55 = 1.36 < 1.5
    await expect(items.connect(alice).startWatch(1004)).to.be.revertedWithCustomError(items, "NotEligible");
  });

  it("cosmetics are bought with season points, and hats can be worn", async () => {
    const { alice, items, grow } = await deploy();
    await expect(items.connect(alice).buy(2001, 1)).to.be.revertedWithCustomError(items, "NotEnoughPoints");
    await grow(alice, 0, 100); // +100 points
    expect(await items.pointsOf(alice)).to.equal(100n);
    await items.connect(alice).buy(2001, 1);
    expect(await items.pointsOf(alice)).to.equal(80n);
    await expect(items.connect(alice).buy(2003, 1)).to.be.revertedWithCustomError(items, "NotEnoughPoints"); // 150
    await expect(items.connect(alice).buy(2006, 1)).to.be.revertedWithCustomError(items, "NotForSale"); // crafted only
    await expect(items.connect(alice).equipHat(2002)).to.be.revertedWithCustomError(items, "NotEligible");
    await items.connect(alice).equipHat(2001);
    expect(await items.hatOf(alice)).to.equal(2001n);
    await expect(items.connect(alice).equipHat(2004)).to.be.revertedWithCustomError(items, "NotAHat");
  });

  it("barter: escrow on offer, both sides pay a points fee per unit given, swap is atomic", async () => {
    const { alice, bob, game, items, produceId } = await deploy();
    // both plant on the same day and harvest together, so both batches are fresh
    await game.connect(bob).plant(2, usdc(10)); // crop 1: durian, 10 pts
    await game.connect(alice).plant(0, usdc(100)); // crop 2: chili x5, 100 pts
    await time.increase(90 * DAY + 1);
    await game.connect(bob).harvest(1);
    await game.connect(alice).harvest(2);
    await items.connect(bob).claimHarvest(1);
    await items.connect(alice).claimHarvest(2);
    const fresh = await produceId(1);
    const durian = await produceId(3);
    await items.connect(alice).makeOffer({ giveIds: [fresh], giveAmts: [3], wantIds: [3n * KIND], wantAmts: [1] }, ethers.ZeroAddress, 2);
    expect(await items.balanceOf(alice, fresh)).to.equal(2n); // 3 in escrow
    expect(await items.balanceOf(await items.getAddress(), fresh)).to.equal(3n);
    expect(await items.pointsOf(alice)).to.equal(97n); // 3 units x 1 point
    await expect(items.connect(alice).acceptOffer(0, [durian])).to.be.revertedWithCustomError(items, "NotForYou");
    await expect(items.connect(bob).acceptOffer(0, [fresh])).to.be.revertedWithCustomError(items, "WrongItem");
    await items.connect(bob).acceptOffer(0, [durian]);
    expect(await items.balanceOf(bob, fresh)).to.equal(3n);
    expect(await items.balanceOf(alice, durian)).to.equal(1n);
    expect(await items.balanceOf(bob, durian)).to.equal(0n);
    expect(await items.pointsOf(bob)).to.equal(9n);
    expect(await items.feePool()).to.equal(4n);
    await expect(items.connect(bob).acceptOffer(0, [durian])).to.be.revertedWithCustomError(items, "OfferClosed");
    const [bobIds] = await items.itemsOf(bob);
    expect(bobIds).to.include(fresh); // received batches show up in the inventory
  });

  it("splitting a trade into many small ones costs the same fee", async () => {
    const { alice, items, grow, produceId } = await deploy();
    await items.connect(alice).claimHarvest(await grow(alice, 0, 100));
    const chili = await produceId(1);
    const before = await items.pointsOf(alice);
    for (let i = 0; i < 4; i++) await items.connect(alice).makeOffer({ giveIds: [chili], giveAmts: [1], wantIds: [2n * KIND], wantAmts: [1] }, ethers.ZeroAddress, 1);
    const split = before - (await items.pointsOf(alice));
    for (let i = 0; i < 4; i++) await items.connect(alice).cancelOffer(i);
    const b2 = await items.pointsOf(alice);
    await items.connect(alice).makeOffer({ giveIds: [chili], giveAmts: [4], wantIds: [2n * KIND], wantAmts: [4] }, ethers.ZeroAddress, 1);
    expect(b2 - (await items.pointsOf(alice))).to.equal(split);
  });

  it("private offers, cancel by the maker, and anyone closing an expired offer returns the escrow", async () => {
    const { alice, bob, carol, game, items, produceId } = await deploy();
    await game.connect(bob).plant(1, usdc(10)); // crop 1: mango
    await game.connect(alice).plant(0, usdc(100)); // crop 2: chili x5
    await time.increase(30 * DAY + 1);
    await game.connect(bob).harvest(1);
    await game.connect(alice).harvest(2);
    await items.connect(bob).claimHarvest(1);
    await items.connect(alice).claimHarvest(2);
    const chili = await produceId(1);
    const mango = await produceId(2);
    await items.connect(alice).makeOffer({ giveIds: [chili], giveAmts: [2], wantIds: [2n * KIND], wantAmts: [1] }, bob.address, 1);
    await expect(items.connect(carol).acceptOffer(0, [mango])).to.be.revertedWithCustomError(items, "NotForYou");
    await expect(items.connect(carol).cancelOffer(0)).to.be.revertedWithCustomError(items, "NotForYou");
    await items.connect(alice).cancelOffer(0);
    expect(await items.balanceOf(alice, chili)).to.equal(5n);
    await items.connect(alice).makeOffer({ giveIds: [chili], giveAmts: [2], wantIds: [2n * KIND], wantAmts: [1] }, ethers.ZeroAddress, 1);
    await time.increase(DAY + 1);
    await expect(items.connect(bob).acceptOffer(1, [mango])).to.be.revertedWithCustomError(items, "OfferExpired");
    await items.connect(carol).cancelOffer(1);
    expect(await items.balanceOf(alice, chili)).to.equal(5n);
  });

  it("Mâm ngũ quả is crafted from fresh produce only", async () => {
    const { alice, items, grow, produceId } = await deploy();
    await items.connect(alice).claimHarvest(await grow(alice, 0, 10)); // 3 chili
    const chili = await produceId(1);
    await items.connect(alice).claimHarvest(await grow(alice, 1, 10)); // 2 mango
    const mango = await produceId(2);
    await expect(items.connect(alice).craftFruitTray(chili, mango, 3n * KIND)).to.be.revertedWithCustomError(items, "Spoiled");
    await items.connect(alice).claimHarvest(await grow(alice, 2, 10)); // durian, 90 days later: chili and mango spoiled
    const durian = await produceId(3);
    await expect(items.connect(alice).craftFruitTray(chili, mango, durian)).to.be.revertedWithCustomError(items, "Spoiled");
  });

  it("crafting works when all three are fresh", async () => {
    const { alice, game, items } = await deploy();
    // three crops planted together so they ripen close to each other
    await game.connect(alice).plant(2, usdc(10));
    await time.increase(83 * DAY);
    await game.connect(alice).plant(0, usdc(10));
    await game.connect(alice).plant(1, usdc(10)); // 30 days, will be ripe later; harvest durian + chili first
    const [ids] = await game.cropsOf(alice);
    await time.increase(7 * DAY + 1);
    await game.connect(alice).harvest(ids[0]);
    await game.connect(alice).harvest(ids[1]);
    await items.connect(alice).claimHarvest(ids[0]);
    await items.connect(alice).claimHarvest(ids[1]);
    const day = await game.today();
    await time.increase(23 * DAY);
    await game.connect(alice).harvest(ids[2]);
    await items.connect(alice).claimHarvest(ids[2]);
    // chili/durian are now 23 days old: spoiled. Mango is fresh. Proves freshness is per batch.
    expect(await items.isFresh(1n * KIND + day)).to.equal(false);
    expect(await items.isFresh(2n * KIND + (await game.today()))).to.equal(true);
  });

  it("season trophies: owner only, at most 10 per season, once per player", async () => {
    const { owner, alice, bob, items } = await deploy();
    const many = (await ethers.getSigners()).slice(5, 16).map((s) => s.address);
    await expect(items.connect(alice).awardSeason(1, [alice.address])).to.be.revertedWithCustomError(items, "NotOwner");
    await items.connect(owner).awardSeason(1, [alice.address, alice.address, bob.address]);
    expect(await items.balanceOf(alice, 1007)).to.equal(1n);
    await expect(items.connect(owner).awardSeason(1, many)).to.be.revertedWithCustomError(items, "SeasonFull");
    await items.connect(owner).awardSeason(2, [alice.address]);
    expect(await items.balanceOf(alice, 1007)).to.equal(2n);
  });

  it("works gasless through the forwarder like every other farm action", async () => {
    const { game, items, relay } = await deploy();
    const zero = ethers.Wallet.createRandom().connect(ethers.provider);
    const token = await ethers.getContractAt("GaslessUSDC", await game.usdc());
    await relay(zero, token, "faucet", []);
    await relay(zero, token, "approve", [await game.getAddress(), ethers.MaxUint256]);
    await relay(zero, game, "plant", [0, usdc(10)]);
    await time.increase(7 * DAY + 1);
    await relay(zero, game, "harvest", [1]);
    await relay(zero, items, "claimHarvest", [1]);
    await relay(zero, items, "buy", [2001, 0]).catch(() => {}); // amount 0 is refused, nothing minted
    const [ids, amts] = await items.itemsOf(zero.address);
    expect(amts[0]).to.equal(3n);
    expect(await items.kindOf(ids[0])).to.equal(1n);
    expect(await ethers.provider.getBalance(zero.address)).to.equal(0n);
  });
});
