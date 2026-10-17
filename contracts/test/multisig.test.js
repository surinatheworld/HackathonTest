const { expect } = require("chai");
const { ethers } = require("hardhat");

const usdc = (n) => ethers.parseUnits(String(n), 6);

async function deploy() {
  const [deployer, an, binh, chi, stranger] = await ethers.getSigners();
  const F = (n) => ethers.getContractFactory(n);
  const ms = await (await F("FarmMultisig")).deploy([an, binh, chi], 2);
  const fwd = await (await F("FarmForwarder")).deploy();
  const token = await (await F("GaslessUSDC")).deploy(fwd);
  const game = await (await F("FarmGame")).deploy(fwd, token, 60);
  const quests = await (await F("FarmQuests")).deploy(fwd, game, game, game, game, token);
  await token.mint(deployer, usdc(10_000));
  await token.transfer(quests, usdc(1_000));
  await game.transferOwnership(ms);
  await quests.transferOwnership(ms);
  return { deployer, an, binh, chi, stranger, ms, token, game, quests };
}

describe("FarmMultisig: the team's 2-of-3 wallet that owns the pooled money", () => {
  it("rejects a bad setup", async () => {
    const [a, b] = await ethers.getSigners();
    const F = await ethers.getContractFactory("FarmMultisig");
    await expect(F.deploy([a, b], 1)).to.be.revertedWithCustomError(F, "BadSetup");
    await expect(F.deploy([a, b], 3)).to.be.revertedWithCustomError(F, "BadSetup");
    await expect(F.deploy([a, a, b], 2)).to.be.revertedWithCustomError(F, "BadSetup");
    await expect(F.deploy([a, ethers.ZeroAddress], 2)).to.be.revertedWithCustomError(F, "BadSetup");
  });

  it("one teammate alone cannot move the quest reward pool; two can", async () => {
    const { deployer, an, binh, chi, ms, token, quests } = await deploy();
    await expect(quests.withdrawPool(deployer, 1)).to.be.revertedWithCustomError(quests, "OwnableUnauthorizedAccount");
    const data = quests.interface.encodeFunctionData("withdrawPool", [chi.address, usdc(400)]);
    await ms.connect(an).submit(quests, 0, data);
    await expect(ms.connect(an).execute(0)).to.be.revertedWithCustomError(ms, "NotEnoughConfirmations").withArgs(1, 2);
    await expect(ms.connect(an).confirm(0)).to.be.revertedWithCustomError(ms, "AlreadyConfirmed");
    await ms.connect(binh).confirm(0);
    await ms.connect(chi).execute(0);
    expect(await token.balanceOf(chi)).to.equal(usdc(400));
    expect(await quests.rewardPool()).to.equal(usdc(600));
    await expect(ms.connect(an).execute(0)).to.be.revertedWithCustomError(ms, "AlreadyExecuted");
  });

  it("strangers cannot submit, confirm or execute", async () => {
    const { an, stranger, ms, game } = await deploy();
    const data = game.interface.encodeFunctionData("transferOwnership", [stranger.address]);
    await expect(ms.connect(stranger).submit(game, 0, data)).to.be.revertedWithCustomError(ms, "NotOwner");
    await ms.connect(an).submit(game, 0, data);
    await expect(ms.connect(stranger).confirm(0)).to.be.revertedWithCustomError(ms, "NotOwner");
    await expect(ms.connect(stranger).execute(0)).to.be.revertedWithCustomError(ms, "NotOwner");
  });

  it("a confirmation can be taken back before execution", async () => {
    const { an, binh, ms, game } = await deploy();
    await ms.connect(an).submit(game, 0, game.interface.encodeFunctionData("setYieldSource", [ethers.ZeroAddress]));
    await ms.connect(binh).confirm(0);
    await ms.connect(binh).revoke(0);
    expect((await ms.getCall(0)).confirmations).to.equal(1n);
    await expect(ms.connect(an).execute(0)).to.be.revertedWithCustomError(ms, "NotEnoughConfirmations");
    await expect(ms.connect(binh).revoke(0)).to.be.revertedWithCustomError(ms, "NotConfirmed");
  });

  it("a failing call reverts and stays pending", async () => {
    const { an, binh, ms, quests } = await deploy();
    await ms.connect(an).submit(quests, 0, quests.interface.encodeFunctionData("withdrawPool", [an.address, usdc(5_000)]));
    await ms.connect(binh).confirm(0);
    await expect(ms.connect(an).execute(0)).to.be.revertedWithCustomError(ms, "CallFailed");
    expect((await ms.getCall(0)).executed).to.equal(false);
  });

  it("a lost key is replaced only by a 2-of-3 decision", async () => {
    const { an, binh, chi, stranger, ms } = await deploy();
    await expect(ms.connect(an).replaceOwner(chi, stranger)).to.be.revertedWithCustomError(ms, "OnlySelf");
    await ms.connect(an).submit(ms, 0, ms.interface.encodeFunctionData("replaceOwner", [chi.address, stranger.address]));
    await ms.connect(binh).confirm(0);
    await ms.connect(an).execute(0);
    expect(await ms.owners()).to.deep.equal([an.address, binh.address, stranger.address]);
    expect(await ms.isOwner(chi)).to.equal(false);
  });
});
