// node scripts/new-wallet.js
// Creates a fresh TESTNET-ONLY deployer key and agent key in contracts/.env (never committed).
// node scripts/new-wallet.js --split-relayer   (once, before a redeploy): the old PRIVATE_KEY was both the deployer
// and the fee manager's gas wallet. It becomes RELAYER_PRIVATE_KEY (same address, keeps its AVAX; it stays the
// Cloudflare secret) and a new PRIVATE_KEY is made for deploying and minting, which never goes online.
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const envPath = path.join(__dirname, "..", ".env");
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : fs.readFileSync(envPath + ".example", "utf8");

function ensure(name) {
  const m = env.match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})\\s*$`, "m"));
  if (m) return new Wallet(m[1]);
  const w = Wallet.createRandom();
  env = env.match(new RegExp(`^${name}=.*$`, "m"))
    ? env.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${w.privateKey}`)
    : env + `\n${name}=${w.privateKey}\n`;
  return w;
}

if (process.argv.includes("--split-relayer")) {
  const old = env.match(/^PRIVATE_KEY=(0x[0-9a-fA-F]{64})\s*$/m);
  if (/^RELAYER_PRIVATE_KEY=0x[0-9a-fA-F]{64}\s*$/m.test(env)) console.log("RELAYER_PRIVATE_KEY đã có, giữ nguyên.");
  else if (old) {
    env = env.replace(/^PRIVATE_KEY=.*$/m, "PRIVATE_KEY=");
    const line = `RELAYER_PRIVATE_KEY=${old[1]}`;
    env = /^RELAYER_PRIVATE_KEY=.*$/m.test(env) ? env.replace(/^RELAYER_PRIVATE_KEY=.*$/m, line) : `${env}\n${line}\n`;
    console.log("Ví trả gas (RELAYER_PRIVATE_KEY):", new Wallet(old[1]).address);
  }
}
const deployer = ensure("PRIVATE_KEY");
const agent = ensure("AGENT_PRIVATE_KEY");
fs.writeFileSync(envPath, env);
console.log("Deployer address:", deployer.address);
console.log("Agent address:   ", agent.address);
console.log("Keys saved to contracts/.env (gitignored). Testnet only, never send real funds here.");
