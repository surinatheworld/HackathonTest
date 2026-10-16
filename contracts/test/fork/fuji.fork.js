// Runs against a local fork of Fuji, using the contracts that are really deployed there.
// The owner is impersonated, so nothing here needs or touches a real key.
// FORK_FUJI=1 npx hardhat test test/fork/fuji.fork.js
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { loadWebConfig } = require("../../scripts/common");

const TELEPORTER = "0x253b2784c75e510dD0fF1da844684a1aC0aa5fcf";
const U = (n) => ethers.parseUnits(String(n), 6);

describe("Fuji deployment (fork)", function () {
  this.timeout(300_000);
  let cfg, owner, player, agent, usdc, vault, butler;

  before(async function () {
    if (!process.env.FORK_FUJI) this.skip();
    cfg = loadWebConfig();
    const c = cfg.cchain;
    const imp = async (a) => {
      await network.provider.request({ method: "hardhat_impersonateAccount", params: [a] });
      await network.provider.send("hardhat_setBalance", [a, "0x56BC75E2D63100000"]);
      return ethers.getSigner(a);
    };
    owner = await imp(cfg.owner);
    [player, agent] = await ethers.getSigners();
    usdc = await ethers.getContractAt("MockUSDC", c.usdc);
    vault = await ethers.getContractAt("FarmVault", c.vault);
    butler = await ethers.getContractAt("ButlerAccount", c.butler);
  });

  it("is wired as configured", async () => {
    expect(await vault.owner()).to.equal(cfg.owner);
    expect(await vault.usdc()).to.equal(cfg.cchain.usdc);
    expect(await vault.teleporter()).to.equal(TELEPORTER);
    expect(await vault.dayLength()).to.equal(BigInt(cfg.dayLength));
    expect(await vault.rewardReserve()).to.be.gte(U(50_000));
    expect(await butler.owner()).to.equal(cfg.owner);
  });

  it("Ruộng rau: deposit, accrue, claim, withdraw on the deployed vault", async () => {
    await usdc.connect(player).faucet();
    await usdc.connect(player).approve(vault, U(500));
    await vault.connect(player).deposit(U(365));
    await time.increase(10 * Number(cfg.dayLength));
    const before = await usdc.balanceOf(player);
    await vault.connect(player).claim();
    expect((await usdc.balanceOf(player)) - before).to.be.closeTo(U("0.4"), 3_000n);
    await vault.connect(player).withdraw(U(365));
    expect((await vault.lends(player)).principal).to.equal(0n);
  });

  it("only the real Teleporter may deliver, and only from the paired L1", async () => {
    const msg = ethers.AbiCoder.defaultAbiCoder().encode(["uint8", "uint256", "address", "uint8", "uint256"], [1, 1, player.address, 0, U(1)]);
    await expect(vault.connect(player).receiveTeleporterMessage(ethers.ZeroHash, ethers.ZeroAddress, msg)).to.be.revertedWithCustomError(vault, "NotTeleporter");
    await network.provider.request({ method: "hardhat_impersonateAccount", params: [TELEPORTER] });
    await network.provider.send("hardhat_setBalance", [TELEPORTER, "0x56BC75E2D63100000"]);
    const tele = await ethers.getSigner(TELEPORTER);
    await expect(vault.connect(tele).receiveTeleporterMessage(ethers.id("not-our-l1"), player.address, msg)).to.be.revertedWithCustomError(vault, "UnknownSender");
  });

  it("owner can lift requiredGasLimit to 1M (step 4 of deploy.html)", async () => {
    await vault.connect(owner).setRequiredGasLimit(1_000_000);
    expect(await vault.requiredGasLimit()).to.equal(1_000_000n);
    await expect(vault.connect(player).setRequiredGasLimit(1)).to.be.revertedWithCustomError(vault, "NotOwner");
  });

  it("Quản gia: owner grants the agent, agent deposits within cap, injections revert", async () => {
    await butler.connect(owner).setAgent(agent.address, U(200));
    await usdc.connect(owner).mint(butler, U(500));
    const ex = (t, d) => butler.connect(agent).execute(t, d);
    await ex(usdc, usdc.interface.encodeFunctionData("approve", [cfg.cchain.vault, ethers.MaxUint256]));
    await ex(vault, vault.interface.encodeFunctionData("deposit", [U(50)]));
    expect((await vault.lends(butler)).principal).to.equal(U(50));
    await expect(ex(usdc, usdc.interface.encodeFunctionData("transfer", [player.address, U(450)]))).to.be.revertedWithCustomError(butler, "CallNotAllowed");
    await expect(ex(usdc, usdc.interface.encodeFunctionData("approve", [player.address, U(450)]))).to.be.revertedWithCustomError(butler, "ArgumentNotAllowed");
    await expect(ex(vault, vault.interface.encodeFunctionData("deposit", [U(151)]))).to.be.revertedWithCustomError(butler, "DailyCapExceeded");
    await butler.connect(owner).revokeAgent();
    await expect(ex(vault, vault.interface.encodeFunctionData("claim"))).to.be.revertedWithCustomError(butler, "AgentIsRevoked");
  });
});
