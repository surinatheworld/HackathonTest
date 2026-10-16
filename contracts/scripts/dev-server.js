// npm run local
// Offline demo: Hardhat node + local deploy + a relayer loop + static server for the game.
// Open http://localhost:8790 . Add ?wallet=dev to use a built-in dev wallet instead of MetaMask/Core.
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "..", "prototype");
const PORT = Number(process.env.PORT || 8790);
const RPC_PORT = Number(process.env.RPC_PORT || 8545);
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const HH = path.join(path.dirname(require.resolve("hardhat/package.json")), "internal", "cli", "bootstrap.js");
const children = [];

function hardhat(args, opts = {}) {
  const p = spawn(process.execPath, [HH, ...args], { cwd: ROOT, stdio: opts.stdio || "inherit" });
  children.push(p);
  return p;
}

async function waitForRpc() {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Hardhat node did not start");
}

function run(args) {
  return new Promise((res, rej) => hardhat(args).on("exit", (c) => (c === 0 ? res() : rej(new Error(`hardhat ${args[0]} failed`)))));
}

function configJs(d) {
  const net = (name, extra) => `{chainId:31337,name:${JSON.stringify(name)},rpc:location.origin+"/rpc",explorer:"",currency:"ETH",${extra}}`;
  return `// Local dev config served by dev-server.js
window.FARM_CONFIG={dayLength:${d.dayLength},local:true,
cchain:${net("Local C-Chain", `blockchainID:"${d.cID}",usdc:"${d.usdc}",vault:"${d.vault}"`)},
l1:${net("Local Farm L1", `blockchainID:"${d.lID}",land:"${d.land}"`)}};
if(!window.ethereum&&/[?&]wallet=dev/.test(location.search)){
  const rpc=async(method,params=[])=>{const r=await fetch("/rpc",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:Date.now(),method,params})});const j=await r.json();if(j.error){const e=new Error(j.error.message);e.code=j.error.code;e.data=j.error.data;throw e}return j.result};
  window.ethereum={isDevWallet:true,on(){},async request({method,params}){
    if(method==="eth_requestAccounts"||method==="eth_accounts")return [(await rpc("eth_accounts"))[1]];
    if(method==="wallet_switchEthereumChain"||method==="wallet_addEthereumChain")return null;
    return rpc(method,params)}};
}
`;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

async function main() {
  console.log("Starting Hardhat node on", RPC);
  hardhat(["node", "--port", String(RPC_PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  await waitForRpc();
  await run(["run", "scripts/deploy-local.js", "--network", "localhost"]);
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "local.json"), "utf8"));

  // Relayer stand-in: deliver queued ICM messages every 2 s, like a real relayer would.
  const provider = new ethers.JsonRpcProvider(RPC);
  const relayer = await provider.getSigner(0);
  const tele = new ethers.Contract(d.teleporter, ["function pending() view returns (uint256)", "function deliverNext()"], relayer);
  setInterval(async () => {
    try {
      while ((await tele.pending()) > 0n) {
        await (await tele.deliverNext()).wait();
        console.log("[relayer] delivered 1 ICM message");
      }
    } catch (e) {
      console.error("[relayer]", e.shortMessage || e.message);
    }
  }, 2000);

  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/rpc" && req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try {
          const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
          res.writeHead(r.status, { "content-type": "application/json" });
          res.end(await r.text());
        } catch (e) {
          res.writeHead(502);
          res.end(String(e));
        }
        return;
      }
      if (url.pathname === "/chain-config.js") {
        res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
        res.end(configJs(d));
        return;
      }
      const file = path.join(WEB, url.pathname === "/" ? "index.html" : path.normalize(url.pathname).replace(/^([/\\])+/, ""));
      if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(PORT, () => console.log(`Game: http://localhost:${PORT}  (dev wallet: http://localhost:${PORT}/?wallet=dev)`));
}

const stop = () => {
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
main().catch((e) => {
  console.error(e);
  stop();
});
