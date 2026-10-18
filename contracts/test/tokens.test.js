const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const usdc = (n) => ethers.parseUnits(String(n), 6);
const avax = (n) => ethers.parseUnits(String(n), 18);
const TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
  ],
};

async function deploy() {
  const [owner, stranger, relayer, honest] = await ethers.getSigners();
  const F = (n) => ethers.getContractFactory(n);
  const fwd = await (await F("FarmForwarder")).deploy();
  const token = await (await F("GaslessUSDC")).deploy(fwd);
  const gavax = await (await F("GaslessAVAX")).deploy(fwd);
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "NongTraiDeFi", version: "1", chainId, verifyingContract: await fwd.getAddress() };
  const relay = async (who, target, fn, args) => {
    const req = { from: who.address, to: await target.getAddress(), value: 0n, gas: 300_000n, nonce: await fwd.nonces(who.address), deadline: (await time.latest()) + 600, data: target.interface.encodeFunctionData(fn, args) };
    const signature = await who.signTypedData(domain, TYPES, req);
    const { nonce, ...rest } = req;
    return fwd.connect(relayer).execute({ ...rest, signature });
  };
  return { owner, stranger, relayer, honest, fwd, token, gavax, relay };
}

describe("Test tokens (GaslessUSDC, GaslessAVAX): only the deployer mints, the faucet is one wallet, once an hour", () => {
  for (const [name, amount] of [["GaslessUSDC", usdc(1_000)], ["GaslessAVAX", avax(20)]]) {
    const pick = (c) => (name === "GaslessUSDC" ? c.token : c.gavax);

    it(`${name}: a stranger cannot mint; the deployer can`, async () => {
      const c = await deploy();
      const t = pick(c);
      expect(await t.minter()).to.equal(c.owner.address);
      await expect(t.connect(c.stranger).mint(c.stranger, 10n ** 30n)).to.be.revertedWithCustomError(t, "NotMinter");
      await t.mint(c.honest, 5n);
      expect(await t.balanceOf(c.honest)).to.equal(5n);
    });

    it(`${name}: the faucet gives each wallet ${name === "GaslessUSDC" ? "1,000 USDC" : "20 gAVAX"} at most once an hour`, async () => {
      const c = await deploy();
      const t = pick(c);
      await t.connect(c.stranger).faucet();
      const nextAt = await t.nextFaucetAt(c.stranger);
      expect(nextAt).to.equal(BigInt(await time.latest()) + 3600n);
      await expect(t.connect(c.stranger).faucet()).to.be.revertedWithCustomError(t, "FaucetCooldown").withArgs(nextAt);
      await t.connect(c.honest).faucet(); // another wallet is not held up
      await time.increase(3600);
      await t.connect(c.stranger).faucet();
      expect(await t.balanceOf(c.stranger)).to.equal(amount * 2n);
    });

    it(`${name}: a contract cannot take the faucet (no throwaway players made in a constructor)`, async () => {
      const c = await deploy();
      const t = pick(c);
      const M = await ethers.getContractFactory("FaucetFarmerMock");
      await expect(M.connect(c.stranger).deploy(t, c.stranger)).to.be.revertedWithCustomError(t, "NotAPlayer");
      expect(await t.totalSupply()).to.equal(0n);
    });

    it(`${name}: a wallet with no AVAX still takes the faucet through the fee manager, with its own cooldown`, async () => {
      const c = await deploy();
      const t = pick(c);
      const zero = ethers.Wallet.createRandom().connect(ethers.provider);
      const other = ethers.Wallet.createRandom().connect(ethers.provider);
      await c.relay(zero, t, "faucet", []);
      await c.relay(other, t, "faucet", []); // the forwarder itself is not rate limited
      expect(await t.balanceOf(zero.address)).to.equal(amount);
      expect(await t.balanceOf(other.address)).to.equal(amount);
      expect(await t.balanceOf(await c.fwd.getAddress())).to.equal(0n);
      // The fee manager uses executeBatch, which skips a failed call; plain execute reverts on it.
      await expect(c.relay(zero, t, "faucet", [])).to.be.reverted;
      expect(await t.balanceOf(zero.address)).to.equal(amount);
      expect(await ethers.provider.getBalance(zero.address)).to.equal(0n);
    });
  }

  it("the audit's coop drain (contract farmers borrowing against faucet gAVAX) now reverts, and honest loans still work", async () => {
    const { owner, stranger, honest, fwd, token, gavax } = await deploy();
    const feed = await (await ethers.getContractFactory("DemoPriceFeed")).deploy(ethers.parseUnits("10", 8));
    const coop = await (await ethers.getContractFactory("FarmCoop")).deploy(fwd, token, gavax, feed, 365 * 86400, 60);
    await token.mint(owner, usdc(10_000));
    await token.approve(coop, ethers.MaxUint256);
    await coop.fund(usdc(10_000));
    const drainer = await (await ethers.getContractFactory("CoopDrainerMock")).deploy();
    // Before the fix each farmer borrowed 120 USDC, and 2 calls of 45 farmers emptied this coop.
    await expect(drainer.connect(stranger).drain(gavax, token, coop, 45)).to.be.revertedWithCustomError(gavax, "NotAPlayer");
    expect(await token.balanceOf(coop)).to.equal(usdc(10_000));
    await gavax.connect(honest).faucet();
    await gavax.connect(honest).approve(coop, ethers.MaxUint256);
    await coop.connect(honest).depositCollateral(avax(20));
    await coop.connect(honest).borrow(usdc(10));
    expect(await token.balanceOf(honest)).to.equal(usdc(10));
  });
});
