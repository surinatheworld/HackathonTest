// Pair FarmVault and FarmLand. Run once per network:
//   npx hardhat run scripts/link.js --network fuji
//   npx hardhat run scripts/link.js --network farml1
const { ethers, network } = require("hardhat");
const { load, writeFrontendConfig } = require("./common");

async function main() {
  const fuji = load("fuji");
  const l1 = load("farml1");
  if (!fuji || !l1) throw new Error("Deploy cả hai phía trước (deployments/fuji.json và deployments/farml1.json).");

  let app, remoteID, remote;
  if (network.name === "fuji") {
    app = await ethers.getContractAt("FarmVault", fuji.vault);
    [remoteID, remote] = [l1.blockchainID, l1.land];
  } else if (network.name === "farml1") {
    app = await ethers.getContractAt("FarmLand", l1.land);
    [remoteID, remote] = [fuji.blockchainID, fuji.vault];
  } else throw new Error("Chạy với --network fuji hoặc --network farml1");

  const same = (await app.remoteAddress()).toLowerCase() === remote.toLowerCase() && (await app.remoteChainID()) === remoteID;
  if (same) {
    console.log(`${network.name}: already paired`);
  } else {
    await (await app.setRemote(remoteID, remote)).wait();
    console.log(`${network.name}: paired with ${remote} on ${remoteID}`);
  }

  const out = writeFrontendConfig();
  if (out) console.log("Frontend config →", out);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
