const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 60;
const usdc = (n) => ethers.parseUnits(String(n), 6);
const S = { None: 0, Growing: 1, Harvested: 2, Uprooted: 3 };
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
  const [owner, relayer, agent, attacker] = await ethers.getSigners();
  // Players are fresh wallets with zero gas, like an in-game wallet.
  const alice = ethers.Wallet.createRandom().connect(ethers.provider);
  const bob = ethers.Wallet.createRandom().connect(ethers.provider);
  const fwd = await (await ethers.getContractFactory("FarmForwarder")).deploy();
  const token = await (await ethers.getContractFactory("GaslessUSDC")).deploy(fwd);
  const game = await (await ethers.getContractFactory("FarmGame")).deploy(fwd, token, DAY);
  await token.mint(owner, usdc(10_000));
  await token.approve(game, usdc(10_000));
  await game.fundRewards(usdc(10_000));
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "NongTraiDeFi", version: "1", chainId, verifyingContract: await fwd.getAddress() };

  /** Sign as `who` and submit through the relayer; `who` never pays gas. */
  const relay = async (who, target, fn, args, opts = {}) => {
    const data = target.interface.encodeFunctionData(fn, args);
    const req = {
      from: who.address,
      to: await target.getAddress(),
      value: 0n,
      gas: opts.gas ?? 500_000n,
      nonce: opts.nonce ?? (await fwd.nonces(who.address)),
      deadline: opts.deadline ?? (await time.latest()) + 600,
      data,
    };
    const signature = await (opts.signer ?? who).signTypedData(domain, TYPES, req);
    const { nonce, ...rest } = req;
    const request = { ...rest, signature };
    return { request, tx: opts.dry ? null : await fwd.connect(relayer).execute(request) };
  };
  return { owner, relayer, agent, attacker, alice, bob, fwd, token, game, relay, domain };
}

describe("Gasless farm on Fuji (ERC-2771 fee manager)", () => {
  it("a zero-gas wallet gets USDC, plants, and harvests principal + yield; the relayer pays", async () => {
    const { alice, token, game, relay } = await deploy();
    expect(await ethers.provider.getBalance(alice.address)).to.equal(0n);
    await relay(alice, token, "faucet", []);
    await relay(alice, token, "approve", [await game.getAddress(), ethers.MaxUint256]);
    await relay(alice, game, "plant", [0, usdc(100)]);
    expect(await token.balanceOf(alice.address)).to.equal(usdc(900));
    let [, list] = await game.cropsOf(alice.address);
    expect(list[0].owner).to.equal(alice.address);
    expect(list[0].status).to.equal(S.Growing);

    await expect(relay(alice, game, "harvest", [1])).to.be.reverted; // NotRipe
    await time.increase(7 * DAY + 1);
    await relay(alice, game, "harvest", [1]);
    const expected = usdc(100) + (usdc(100) * 600n * 7n) / (10_000n * 365n);
    expect(await token.balanceOf(alice.address)).to.equal(usdc(900) + expected);
    [, list] = await game.cropsOf(alice.address);
    expect(list[0].status).to.equal(S.Harvested);
    expect((await game.farmers(alice.address)).points).to.equal(100n);
    expect(await ethers.provider.getBalance(alice.address)).to.equal(0n); // never paid gas
  });

  it("uproot returns principal only", async () => {
    const { alice, token, game, relay } = await deploy();
    await relay(alice, token, "faucet", []);
    await relay(alice, token, "approve", [await game.getAddress(), ethers.MaxUint256]);
    await relay(alice, game, "plant", [2, usdc(200)]);
    await time.increase(30 * DAY);
    await relay(alice, game, "uproot", [1]);
    expect(await token.balanceOf(alice.address)).to.equal(usdc(1000));
  });

  it("lending works gasless: deposit, accrue, claim, withdraw", async () => {
    const { alice, token, game, relay } = await deploy();
    await relay(alice, token, "faucet", []);
    await relay(alice, token, "approve", [await game.getAddress(), ethers.MaxUint256]);
    await relay(alice, game, "deposit", [usdc(365)]);
    await time.increase(10 * DAY);
    await relay(alice, game, "claim", []);
    expect((await token.balanceOf(alice.address)) - usdc(635)).to.be.closeTo(usdc("0.4"), 2_000n);
    await relay(alice, game, "withdraw", [usdc(365)]);
    expect((await game.lends(alice.address)).principal).to.equal(0n);
  });

  it("a signed request cannot be replayed", async () => {
    const { alice, relayer, fwd, token, relay } = await deploy();
    const { request } = await relay(alice, token, "faucet", []);
    await expect(fwd.connect(relayer).execute(request)).to.be.reverted;
    expect(await token.balanceOf(alice.address)).to.equal(usdc(1000));
  });

  it("nobody can act for another player", async () => {
    const { alice, bob, token, game, fwd, relay } = await deploy();
    await relay(alice, token, "faucet", []);
    await relay(alice, token, "approve", [await game.getAddress(), ethers.MaxUint256]);
    await relay(alice, game, "plant", [0, usdc(100)]);
    // Bob signs a request that claims to come from Alice.
    const { request } = await relay(alice, game, "uproot", [1], { signer: bob, dry: true });
    expect(await fwd.verify(request)).to.equal(false);
    await expect(fwd.execute(request)).to.be.reverted;
    // Bob, as himself, is not the crop owner.
    await expect(relay(bob, game, "uproot", [1])).to.be.reverted;
  });

  it("expired requests are rejected", async () => {
    const { alice, fwd, token, relay } = await deploy();
    const { request } = await relay(alice, token, "faucet", [], { deadline: (await time.latest()) - 1, dry: true });
    expect(await fwd.verify(request)).to.equal(false);
  });

  it("direct calls still work for wallets that pay their own gas", async () => {
    const { owner, token, game } = await deploy();
    await token.connect(owner).faucet();
    await token.connect(owner).approve(game, usdc(50));
    await game.connect(owner).plant(0, usdc(50));
    const [, list] = await game.cropsOf(owner.address);
    expect(list[0].owner).to.equal(owner.address);
  });

  it("game loop: water streak, collect, steal unless guarded — all gasless", async () => {
    const { alice, bob, token, game, relay } = await deploy();
    await relay(alice, token, "faucet", []);
    await relay(alice, token, "approve", [await game.getAddress(), ethers.MaxUint256]);
    await relay(alice, game, "plant", [1, usdc(100)]);
    await relay(alice, game, "water", [1]);
    await expect(relay(alice, game, "water", [1])).to.be.reverted; // once per game day
    await time.increase(DAY);
    await relay(alice, game, "water", [1]);
    expect((await game.farmers(alice.address)).ripePoints).to.equal(7n);
    await relay(bob, game, "steal", [alice.address]);
    expect((await game.farmers(bob.address)).points).to.equal(2n);
    await relay(alice, game, "setGuard", [true]);
    await time.increase(DAY);
    await expect(relay(bob, game, "steal", [alice.address])).to.be.reverted;
    await relay(alice, game, "collect", []);
    expect((await game.farmers(alice.address)).points).to.equal(5n);
  });

  it("only the owner can hand over the game", async () => {
    const { owner, attacker, game } = await deploy();
    await expect(game.connect(attacker).transferOwnership(attacker.address)).to.be.revertedWithCustomError(game, "NotOwner");
    await game.connect(owner).transferOwnership(attacker.address);
    expect(await game.owner()).to.equal(attacker.address);
  });
});
