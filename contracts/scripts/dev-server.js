// npm run local
// Offline demo of the gasless game: Hardhat node + local deploy + the same fee manager code as the
// Cloudflare Pages Function (functions/_lib/relay-core.js) + a static server. Open http://localhost:8790
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..");
const WEB = path.join(ROOT, "..");
const PORT = Number(process.env.PORT || 8790);
const RPC_PORT = Number(process.env.RPC_PORT || 8545);
const RPC = `http://127.0.0.1:${RPC_PORT}`;
// Hardhat's well-known account #0: pays gas for relayed requests on the local chain only.
const LOCAL_RELAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
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
  return `// Local dev config served by dev-server.js
window.FARM_CONFIG={dayLength:${d.dayLength},relayUrl:"/api/relay",local:true,
cchain:{chainId:31337,name:"Local C-Chain",rpc:location.origin+"/rpc",explorer:"",currency:"ETH",forwarder:"${d.forwarder}",usdc:"${d.usdc}",game:"${d.game}",butler:"${d.butler}"}};
`;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function sendResponse(res, r) {
  res.writeHead(r.status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(await r.text());
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

async function main() {
  console.log("Starting Hardhat node on", RPC);
  hardhat(["node", "--port", String(RPC_PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  await waitForRpc();
  await run(["run", "scripts/deploy-local.js", "--network", "localhost"]);
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, "deployments", "local.json"), "utf8"));
  const core = await import(pathToFileURL(path.join(WEB, "functions", "_lib", "relay-core.js")).href);
  const relayConfig = { chainId: 31337, rpc: RPC, forwarder: d.forwarder, game: d.game, usdc: d.usdc };
  const env = { RELAYER_PRIVATE_KEY: LOCAL_RELAYER_KEY, FUJI_RPC_URL: RPC };

  http
    .createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");
      try {
        if (url.pathname === "/rpc" && req.method === "POST") {
          const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: await readBody(req) });
          return sendResponse(res, r);
        }
        if (url.pathname === "/api/relay") {
          if (req.method === "POST") {
            const body = JSON.parse((await readBody(req)).toString() || "{}");
            const r = await core.relay(body, env, relayConfig);
            console.log("[fee manager]", r.status, body?.request?.data?.slice(0, 10));
            return sendResponse(res, r);
          }
          return sendResponse(res, await core.relayStatus(env, relayConfig));
        }
        if (url.pathname === "/prototype/chain-config.js") {
          res.writeHead(200, { "content-type": TYPES[".js"], "cache-control": "no-store" });
          return res.end(configJs(d));
        }
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: e.message }));
      }
      // Serve only the game: index.html and prototype/. Never the rest of the repo (contracts/.env).
      const rel = url.pathname === "/" ? "index.html" : path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
      const file = path.join(WEB, rel);
      const allowed = rel === "index.html" || file.startsWith(path.join(WEB, "prototype") + path.sep);
      if (!allowed || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        return res.end("Not found");
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(file).pipe(res);
    })
    .listen(PORT, () => console.log(`Game: http://localhost:${PORT}`));
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
