// node scripts/new-wallet.js
// Creates a fresh TESTNET-ONLY deployer key and agent key in contracts/.env (never committed).
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

const deployer = ensure("PRIVATE_KEY");
const agent = ensure("AGENT_PRIVATE_KEY");
fs.writeFileSync(envPath, env);
console.log("Deployer address:", deployer.address);
console.log("Agent address:   ", agent.address);
console.log("Keys saved to contracts/.env (gitignored). Testnet only, never send real funds here.");
