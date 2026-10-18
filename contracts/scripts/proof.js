// npm run proof:readme
// The "Bằng chứng trên Fuji" links come from real runs, not from hand edits: gasless-smoke.js (on Fuji) and
// butler-demo.js append every tx they send to deployments/fuji-proof.json, and this script rewrites the README block
// between <!-- proof:start --> and <!-- proof:end --> and writes butlerBlockedTx into prototype/chain-config.js.
// A run against a new deployment (another forwarder or butler) starts the file over, so old links never mix in.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const FILE = path.join(__dirname, "..", "deployments", "fuji-proof.json");
const EXPLORER = "https://testnet.snowtrace.io";
const isHash = (h) => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);
const lc = (a) => String(a || "").toLowerCase();

function readProof(file = FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Appends one step. `stack` = { forwarder, butler } of the deployment the tx belongs to. */
function recordProof(stack, entry, file = FILE) {
  if (!isHash(entry.hash)) throw new Error(`Không phải mã tx: ${entry.hash}`);
  let p = readProof(file);
  if (!p || lc(p.forwarder) !== lc(stack.forwarder) || lc(p.butler) !== lc(stack.butler)) p = { forwarder: stack.forwarder, butler: stack.butler, steps: [] };
  p.steps = p.steps.filter((s) => s.step !== entry.step); // the newest run of a step wins
  p.steps.push({ step: entry.step, text: entry.text, hash: entry.hash, contract: entry.contract, ok: entry.ok !== false });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
  return p;
}

/** The README block (Markdown), only from hashes in the proof file. */
function renderProof(p, explorer = EXPLORER) {
  const steps = (p?.steps || []).filter((s) => isHash(s.hash));
  if (!steps.length) return "Chưa có bằng chứng cho bản này. Chạy `npm run smoke:gasless` và `npm run butler:demo`, rồi `npm run proof:readme`.";
  const link = (s) => `${s.text} ([tx](${explorer}/tx/${s.hash}))`;
  const smoke = steps.filter((s) => !s.step.startsWith("butler"));
  const butler = steps.filter((s) => s.step.startsWith("butler"));
  const out = [];
  if (smoke.length) out.push(`- Một ví mới, 0 AVAX từ đầu đến cuối (\`npm run smoke:gasless\`, fee manager trả gas): ${smoke.map(link).join(", ")}.`);
  if (butler.length) out.push(`- Quản gia tự động (\`npm run butler:demo\`): ${butler.map(link).join(", ")}.`);
  return out.join("\n");
}

function applyProof({ readme = path.join(ROOT, "README.md"), config = path.join(ROOT, "prototype", "chain-config.js"), file = FILE } = {}) {
  const p = readProof(file);
  const md = fs.readFileSync(readme, "utf8");
  const re = /(<!-- proof:start -->\r?\n)[\s\S]*?(\r?\n<!-- proof:end -->)/; // CRLF on a Windows checkout
  if (!re.test(md)) throw new Error("README thiếu <!-- proof:start --> ... <!-- proof:end -->");
  fs.writeFileSync(readme, md.replace(re, (_, a, b) => a + renderProof(p) + b));
  const blocked = (p?.steps || []).find((s) => s.step === "butler-blocked" && isHash(s.hash));
  if (fs.existsSync(config)) {
    const src = fs.readFileSync(config, "utf8");
    const m = src.match(/window\.FARM_CONFIG\s*=\s*([\s\S]*?);\s*$/m);
    if (m && m[1].trim() !== "null") {
      const cfg = JSON.parse(m[1]);
      if (blocked && lc(cfg.cchain?.butler) === lc(p.butler)) cfg.butlerBlockedTx = blocked.hash;
      else delete cfg.butlerBlockedTx; // never show a tx from another deployment
      fs.writeFileSync(config, src.replace(m[1], JSON.stringify(cfg, null, 2)));
    }
  }
  return p;
}

if (require.main === module) {
  const p = applyProof();
  console.log(`README cập nhật với ${p?.steps?.length || 0} tx từ ${path.relative(ROOT, FILE)}.`);
}

module.exports = { recordProof, renderProof, applyProof, readProof };
