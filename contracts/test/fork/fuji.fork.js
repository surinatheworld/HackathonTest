// Runs against a local fork of Fuji, using the gasless contracts that are really deployed there.
// The owner is impersonated, so nothing here needs or touches a real key.
// npm run test:fork
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { load } = require("../../scripts/common");

const U = (n) => ethers.parseUnits(String(n), 6);

describe("Fuji gasless deployment (fork)", function () {
  this.timeout(300_000);
  let d, owner, player, agent, usdc, game, butler;

  before(async function () {
    if (!process.env.FORK_FUJI) this.skip();
    d = load("fuji-gasless");
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [d.owner] });
    await network.provider.send("hardhat_setBalance", [d.owner, "0x56BC75E2D63100000"]);
    owner = await ethers.getSigner(d.owner);
    [player, agent] = await ethers.getSigners();
    usdc = await ethers.getContractAt("GaslessUSDC", d.usdc);
    game = await ethers.getContractAt("FarmGame", d.game);
    butler = await ethers.getContractAt("ButlerAccount", d.butler);
  });

  it("is wired as deployed", async () => {
    expect(await game.owner()).to.equal(d.owner);
    expect(await game.usdc()).to.equal(d.usdc);
    expect(await game.isTrustedForwarder(d.forwarder)).to.equal(true);
    expect(await usdc.isTrustedForwarder(d.forwarder)).to.equal(true);
    expect(await game.dayLength()).to.equal(BigInt(d.dayLength));
    expect(await game.rewardReserve()).to.be.gte(U(49_000));
    expect(await butler.owner()).to.equal(d.owner);
  });

  it("plant and harvest on the deployed game", async () => {
    await usdc.connect(player).faucet();
    await usdc.connect(player).approve(game, U(100));
    await game.connect(player).plant(0, U(100));
    const [ids] = await game.cropsOf(player);
    await time.increase(7 * Number(d.dayLength) + 1);
    const before = await usdc.balanceOf(player);
    await game.connect(player).harvest(ids[ids.length - 1]);
    expect((await usdc.balanceOf(player)) - before).to.be.gt(U(100));
  });

  it("Quản gia: owner can revoke the agent at once", async () => {
    const realAgent = await butler.agent();
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [realAgent] });
    await network.provider.send("hardhat_setBalance", [realAgent, "0x56BC75E2D63100000"]);
    const a = await ethers.getSigner(realAgent);
    const data = game.interface.encodeFunctionData("claim");
    await butler.connect(a).execute(game, data); // allowed while active
    await butler.connect(owner).revokeAgent();
    await expect(butler.connect(a).execute(game, data)).to.be.revertedWithCustomError(butler, "AgentIsRevoked");
    await expect(butler.connect(agent).execute(game, data)).to.be.revertedWithCustomError(butler, "NotAuthorized");
  });
});
