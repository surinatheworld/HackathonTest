const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 60; // one game day = 60 s, same as the testnet deployment
const L1_ID = ethers.id("farm-l1");
const C_ID = ethers.id("fuji-c-chain");
const usdc = (n) => ethers.parseUnits(String(n), 6);
const S = { None: 0, Pending: 1, Growing: 2, Harvesting: 3, Harvested: 4, Uprooted: 5, Failed: 6 };

async function deploy() {
  const [owner, alice, bob, agent, attacker] = await ethers.getSigners();
  const tele = await (await ethers.getContractFactory("MockTeleporter")).deploy();
  const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const vault = await (await ethers.getContractFactory("FarmVault")).deploy(tele, token, DAY);
  const land = await (await ethers.getContractFactory("FarmLand")).deploy(tele, DAY);
  await tele.setChain(vault, C_ID);
  await tele.setChain(land, L1_ID);
  await vault.setRemote(L1_ID, land);
  await land.setRemote(C_ID, vault);
  await token.mint(owner, usdc(10_000));
  await token.approve(vault, usdc(10_000));
  await vault.fundRewards(usdc(10_000));
  for (const u of [alice, bob]) await token.connect(u).faucet();
  const relay = async () => {
    while ((await tele.pending()) > 0n) await tele.deliverNext();
  };
  return { owner, alice, bob, agent, attacker, tele, token, vault, land, relay };
}

describe("Vườn cây: ICM plant / harvest", () => {
  it("plants on the L1, locks USDC on C-Chain, and harvests principal + yield", async () => {
    const { alice, token, vault, land, relay } = await deploy();
    await token.connect(alice).approve(vault, usdc(100));
    await land.connect(alice).plant(0, usdc(100)); // cây ớt, 7 days
    let [, list] = await land.cropsOf(alice);
    expect(list[0].status).to.equal(S.Pending);

    await relay(); // PLANT -> vault, PLANTED -> land
    [, list] = await land.cropsOf(alice);
    expect(list[0].status).to.equal(S.Growing);
    expect(await token.balanceOf(alice)).to.equal(usdc(900));
    expect(await vault.totalLocked()).to.equal(usdc(100));

    await expect(land.connect(alice).harvest(1)).to.be.revertedWithCustomError(land, "NotRipe");
    await time.increase(7 * DAY + 1);
    await land.connect(alice).harvest(1);
    await relay();

    [, list] = await land.cropsOf(alice);
    expect(list[0].status).to.equal(S.Harvested);
    const expected = usdc(100) + (usdc(100) * 600n * 7n) / (10_000n * 365n);
    expect(await token.balanceOf(alice)).to.equal(usdc(900) + expected);
    expect(list[0].payout).to.equal(expected);
    expect((await land.farmers(alice)).points).to.equal(100n);
  });

  it("marks the crop failed when the player has not approved USDC on C-Chain", async () => {
    const { alice, token, land, relay } = await deploy();
    await land.connect(alice).plant(1, usdc(50));
    await relay();
    const [, list] = await land.cropsOf(alice);
    expect(list[0].status).to.equal(S.Failed);
    expect(await token.balanceOf(alice)).to.equal(usdc(1000));
    expect((await land.farmers(alice)).activeCrops).to.equal(0);
  });

  it("uproot returns principal only", async () => {
    const { alice, token, vault, land, relay } = await deploy();
    await token.connect(alice).approve(vault, usdc(200));
    await land.connect(alice).plant(2, usdc(200));
    await relay();
    await time.increase(30 * DAY);
    await land.connect(alice).uproot(1);
    await relay();
    const [, list] = await land.cropsOf(alice);
    expect(list[0].status).to.equal(S.Uprooted);
    expect(await token.balanceOf(alice)).to.equal(usdc(1000));
  });

  it("rejects messages that do not come from the paired contract via Teleporter", async () => {
    const { alice, attacker, tele, vault, land } = await deploy();
    const msg = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "uint256", "address", "uint8", "uint256"],
      [2, 1, alice.address, 0, 0]
    );
    await expect(vault.connect(attacker).receiveTeleporterMessage(L1_ID, land, msg)).to.be.revertedWithCustomError(
      vault,
      "NotTeleporter"
    );
    await expect(tele.forge(vault, L1_ID, attacker.address, msg)).to.be.revertedWithCustomError(vault, "UnknownSender");
    await expect(tele.forge(vault, ethers.id("other"), land, msg)).to.be.revertedWithCustomError(vault, "UnknownSender");
  });

  it("will not harvest someone else's crop", async () => {
    const { alice, bob, token, vault, land, relay } = await deploy();
    await token.connect(alice).approve(vault, usdc(100));
    await land.connect(alice).plant(0, usdc(100));
    await relay();
    await time.increase(8 * DAY);
    await expect(land.connect(bob).harvest(1)).to.be.revertedWithCustomError(land, "NotYourCrop");
  });
});

describe("ICM gas budget", () => {
  it("delivers every message within requiredGasLimit", async () => {
    const { alice, token, vault, land, relay } = await deploy();
    expect(await vault.requiredGasLimit()).to.equal(1_000_000n);
    expect(await land.requiredGasLimit()).to.equal(1_000_000n);
    await token.connect(alice).approve(vault, usdc(100));
    await land.connect(alice).plant(0, usdc(100));
    await relay(); // reverts with out-of-gas if the budget is too small
    await time.increase(7 * DAY + 1);
    await land.connect(alice).harvest(1);
    await relay();
    const [, list] = await land.cropsOf(alice);
    expect(list[0].status).to.equal(S.Harvested);
  });

  it("a too-small budget fails delivery instead of half-applying", async () => {
    const { owner, alice, token, tele, vault, land } = await deploy();
    await land.connect(owner).setRequiredGasLimit(50_000);
    await token.connect(alice).approve(vault, usdc(100));
    await land.connect(alice).plant(0, usdc(100));
    await expect(tele.deliverNext()).to.be.reverted;
    expect(await token.balanceOf(alice)).to.equal(usdc(1000));
  });
});

describe("Ruộng rau: lending", () => {
  it("accrues 4% APY in game days and pays from the reward reserve", async () => {
    const { alice, token, vault } = await deploy();
    await token.connect(alice).approve(vault, usdc(365));
    await vault.connect(alice).deposit(usdc(365));
    await time.increase(10 * DAY);
    await vault.connect(alice).claim();
    // 365 * 4% * 10 / 365 = 0.4 USDC
    const bal = await token.balanceOf(alice);
    expect(bal - usdc(635)).to.be.closeTo(usdc("0.4"), 2_000n); // ±3 s of accrual
    await vault.connect(alice).withdraw(usdc(365));
    expect(await token.balanceOf(alice)).to.equal(bal + usdc(365));
  });
});

describe("L1 game loop", () => {
  it("watering builds a streak, neighbours can steal 40% unless guarded", async () => {
    const { alice, bob, token, vault, land, relay } = await deploy();
    await token.connect(alice).approve(vault, usdc(100));
    await land.connect(alice).plant(1, usdc(100));
    await relay();
    await land.connect(alice).water(1);
    await expect(land.connect(alice).water(1)).to.be.revertedWithCustomError(land, "AlreadyWateredToday");
    await time.increase(DAY);
    await land.connect(alice).water(1);
    let a = await land.farmers(alice);
    expect(a.streak).to.equal(2);
    expect(a.ripePoints).to.equal(3n + 4n);

    await land.connect(bob).steal(alice);
    expect((await land.farmers(bob)).points).to.equal(2n); // 40% of 7, rounded down
    await expect(land.connect(bob).steal(alice)).to.be.revertedWithCustomError(land, "StealCooldown");

    await land.connect(alice).setGuard(true);
    await time.increase(DAY);
    await expect(land.connect(bob).steal(alice)).to.be.revertedWithCustomError(land, "Guarded");
    await land.connect(alice).collect();
    a = await land.farmers(alice);
    expect(a.points).to.equal(5n);
    expect(a.ripePoints).to.equal(0n);
  });
});

describe("Nhà quản gia AI: guardrails", () => {
  async function butlerSetup() {
    const ctx = await deploy();
    const { alice, agent, token, vault } = ctx;
    const acct = await (await ethers.getContractFactory("ButlerAccount")).deploy(alice, DAY);
    await token.connect(alice).transfer(acct, usdc(500));
    const sel = (c, f) => c.interface.getFunction(f).selector;
    // approve moves no money, so it is not counted; the spender is pinned to the vault
    await acct.connect(alice).setRule(token, sel(token, "approve"), true, 0, await vault.getAddress());
    await acct.connect(alice).setRule(vault, sel(vault, "deposit"), true, 1, ethers.ZeroAddress);
    await acct.connect(alice).setRule(vault, sel(vault, "claim"), true, 0, ethers.ZeroAddress);
    await acct.connect(alice).setAgent(agent, usdc(200));
    const now = await time.latest();
    await time.increaseTo(Math.ceil((now + 1) / DAY) * DAY + 1); // start of a fresh game day
    return { ...ctx, acct };
  }

  it("lets the agent deposit inside the cap", async () => {
    const { agent, token, vault, acct } = await butlerSetup();
    await acct.connect(agent).execute(token, token.interface.encodeFunctionData("approve", [await vault.getAddress(), usdc(80)]));
    await acct.connect(agent).execute(vault, vault.interface.encodeFunctionData("deposit", [usdc(80)]));
    expect((await vault.lends(acct)).principal).to.equal(usdc(80));
    expect(await acct.remainingToday()).to.equal(usdc(120));
  });

  it("blocks a prompt-injected transfer to an outside address", async () => {
    const { agent, attacker, token, acct } = await butlerSetup();
    const data = token.interface.encodeFunctionData("transfer", [attacker.address, usdc(500)]);
    await expect(acct.connect(agent).execute(token, data)).to.be.revertedWithCustomError(acct, "CallNotAllowed");
    const approve = token.interface.encodeFunctionData("approve", [attacker.address, usdc(500)]);
    await expect(acct.connect(agent).execute(token, approve)).to.be.revertedWithCustomError(acct, "ArgumentNotAllowed");
    expect(await token.balanceOf(acct)).to.equal(usdc(500));
  });

  it("enforces the daily cap and resets it the next game day", async () => {
    const { agent, token, vault, acct } = await butlerSetup();
    await acct.connect(agent).execute(token, token.interface.encodeFunctionData("approve", [vault.target, usdc(500)]));
    const dep = (n) => vault.interface.encodeFunctionData("deposit", [usdc(n)]);
    await expect(acct.connect(agent).execute(vault, dep(250))).to.be.revertedWithCustomError(acct, "DailyCapExceeded");
    await acct.connect(agent).execute(vault, dep(150));
    await expect(acct.connect(agent).execute(vault, dep(60))).to.be.revertedWithCustomError(acct, "DailyCapExceeded");
    await time.increase(DAY);
    await acct.connect(agent).execute(vault, dep(60));
    expect((await vault.lends(acct)).principal).to.equal(usdc(210));
  });

  it("kill switch revokes the agent immediately", async () => {
    const { alice, agent, token, vault, acct } = await butlerSetup();
    await acct.connect(alice).revokeAgent();
    const data = token.interface.encodeFunctionData("approve", [vault.target, usdc(1)]);
    await expect(acct.connect(agent).execute(token, data)).to.be.revertedWithCustomError(acct, "AgentIsRevoked");
  });
});
