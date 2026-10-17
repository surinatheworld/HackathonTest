// npm run smoke:items -- [relayUrl]
// Two brand-new wallets with 0 AVAX play the Kho đồ loop on Fuji through the fee manager: plant a chili,
// harvest, take the produce, earn a badge, buy and wear a hat, trade hat ⇄ chili with each other, gift USDC,
// and check that a direct item gift is refused. Takes ~8 minutes (a chili ripens in 7 game days of 60 s).
require("dotenv").config();
const path = require("path");
const { pathToFileURL } = require("url");
const { ethers } = require("ethers");
const { load } = require("./common");

const TYPES = { ForwardRequest: [
  { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "gas", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" }] };

async function main() {
  const d = load("fuji-gasless");
  if (!d?.items) throw new Error("Chưa deploy FarmItems (npm run deploy:items).");
  const rpc = process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
  const provider = new ethers.JsonRpcProvider(rpc, 43113, { staticNetwork: true });
  const relayUrl = process.argv[2];
  const core = relayUrl ? null : await import(pathToFileURL(path.join(__dirname, "..", "..", "functions", "_lib", "relay-core.js")).href);
  const env = { RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY, FUJI_RPC_URL: rpc };
  const config = { chainId: 43113, rpc, forwarder: d.forwarder, game: d.game, usdc: d.usdc, gavax: d.gavax, coop: d.coop, pond: d.pond, items: d.items };
  const domain = { name: "NongTraiDeFi", version: "1", chainId: 43113, verifyingContract: d.forwarder };
  const fwd = new ethers.Contract(d.forwarder, ["function nonces(address) view returns (uint256)"], provider);
  const usdcI = new ethers.Interface(["function faucet()", "function approve(address,uint256)", "function transfer(address,uint256)", "function balanceOf(address) view returns (uint256)"]);
  const gameI = new ethers.Interface(["function plant(uint8,uint256)", "function deposit(uint256)", "function harvest(uint256)", "function nextCropId() view returns (uint256)", "function readyAt(uint256) view returns (uint256)"]);
  const itemsA = require("../artifacts/contracts/gasless/FarmItems.sol/FarmItems.json").abi;
  const itemsI = new ethers.Interface(itemsA);
  const items = new ethers.Contract(d.items, itemsA, provider);
  const game = new ethers.Contract(d.game, gameI, provider);

  const raw = async (who, to, data, gas) => {
    const nonce = await fwd.nonces(who.address);
    const deadline = Math.floor(Date.now() / 1000) + 600;
    const signature = await who.signTypedData(domain, TYPES, { from: who.address, to, value: 0n, gas: BigInt(gas), nonce, deadline, data });
    const body = { request: { from: who.address, to, value: "0", gas: String(gas), deadline, data, signature } };
    const r = relayUrl ? await fetch(relayUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) : await core.relay(body, env, config);
    return { status: r.status, json: await r.json() };
  };
  const send = async (who, label, to, data, gas = 400000) => {
    const { status, json } = await raw(who, to, data, gas);
    if (status !== 200) throw new Error(`${label}: ${status} ${json.error}`);
    await provider.waitForTransaction(json.hash, 1, 120000);
    console.log(`✓ ${who.tag} ${label} · tx ${json.hash}`);
    return json.hash;
  };

  const A = ethers.Wallet.createRandom(); A.tag = "A";
  const B = ethers.Wallet.createRandom(); B.tag = "B";
  console.log("A", A.address, "\nB", B.address);
  const crops = {};
  for (const p of [A, B]) {
    await send(p, "faucet()", d.usdc, usdcI.encodeFunctionData("faucet"));
    await send(p, "approve(FarmGame)", d.usdc, usdcI.encodeFunctionData("approve", [d.game, ethers.MaxUint256]));
    crops[p.tag] = await game.nextCropId();
    await send(p, "plant(cây ớt, 100 USDC)", d.game, gameI.encodeFunctionData("plant", [0, ethers.parseUnits("100", 6)]));
  }
  await send(A, "deposit(50 USDC)", d.game, gameI.encodeFunctionData("deposit", [ethers.parseUnits("50", 6)]));
  await send(A, "claimBadge(Hạt giống đầu tiên)", d.items, itemsI.encodeFunctionData("claimBadge", [1001, 0]));

  const ready = Number(await game.readyAt(crops.B));
  for (;;) {
    const now = (await provider.getBlock("latest")).timestamp;
    if (now > ready + 2) break;
    console.log(`… chờ cây ớt chín, còn ${ready + 2 - now} giây`);
    await new Promise((r) => setTimeout(r, Math.min(60, ready + 3 - now) * 1000));
  }
  for (const p of [A, B]) {
    await send(p, `harvest(#${crops[p.tag]})`, d.game, gameI.encodeFunctionData("harvest", [crops[p.tag]]));
    await send(p, `claimHarvest(#${crops[p.tag]})`, d.items, itemsI.encodeFunctionData("claimHarvest", [crops[p.tag]]));
  }
  const [idsB] = await items.itemsOf(B.address);
  const chiliB = idsB.find((id) => id / 1_000_000_000n === 1n);
  console.log("A points", (await items.pointsOf(A.address)).toString(), "· B items", (await items.itemsOf(B.address)).amounts.map(String).join(","));

  await send(A, "buy(Nón lá đỏ)", d.items, itemsI.encodeFunctionData("buy", [2001, 1]));
  await send(A, "equipHat(Nón lá đỏ)", d.items, itemsI.encodeFunctionData("equipHat", [2001]));
  const offerId = await items.offerCount();
  const legs = { giveIds: [2001], giveAmts: [1], wantIds: [1_000_000_000n], wantAmts: [2] };
  await send(A, "equipHat(0) trước khi đổi nón", d.items, itemsI.encodeFunctionData("equipHat", [0]));
  await send(A, "makeOffer(1 Nón lá đỏ ⇄ 2 Ớt)", d.items, itemsI.encodeFunctionData("makeOffer", [legs, ethers.ZeroAddress, 3]), 600000);
  await send(B, `acceptOffer(#${offerId})`, d.items, itemsI.encodeFunctionData("acceptOffer", [offerId, [chiliB]]), 600000);
  console.log("B hat", (await items.balanceOf(B.address, 2001)).toString(), "· A chili", (await items.itemsOf(A.address)).amounts.map(String).join(","));

  await send(A, "transfer(5 USDC → B)", d.usdc, usdcI.encodeFunctionData("transfer", [B.address, ethers.parseUnits("5", 6)]));
  const usdc = new ethers.Contract(d.usdc, usdcI, provider);
  console.log("B USDC", ethers.formatUnits(await usdc.balanceOf(B.address), 6));

  const gift = await raw(B, d.items, itemsI.encodeFunctionData("safeTransferFrom", [B.address, A.address, chiliB, 1, "0x"]), 200000);
  console.log(`Tặng vật phẩm trực tiếp → ${gift.status} (${gift.json.error})`);
  if (gift.status === 200) throw new Error("Fee manager / contract lẽ ra phải chặn tặng vật phẩm.");
  console.log("A AVAX", ethers.formatEther(await provider.getBalance(A.address)), "· B AVAX", ethers.formatEther(await provider.getBalance(B.address)));
}

main().catch((e) => {
  console.error(e.shortMessage || e.message || e);
  process.exitCode = 1;
});
