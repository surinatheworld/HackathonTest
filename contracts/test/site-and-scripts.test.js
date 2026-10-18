// Checks that need no chain: the page text and its offline numbers, the hosting headers, and the safety checks in
// the team's scripts (key separation, Fuji-only providers, proof links).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const ROOT = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

describe("Game page text and offline numbers", () => {
  it("shows no contract jargon to players", () => {
    for (const w of ["PolicyModule", "KILL SWITCH", "Whitelist", "session key", "SmartAccount", "unlock", "*0.8/", "Quản gia AI", "quản gia AI"])
      expect(html, w).to.not.include(w);
  });

  it("the offline Hạn hán lesson liquidates at the same line as FarmCoop", () => {
    const sol = fs.readFileSync(path.join(__dirname, "..", "contracts", "gasless", "FarmCoop.sol"), "utf8");
    const bps = (name) => Number(sol.match(new RegExp(`${name} = ([0-9_]+);`))[1].replace(/_/g, ""));
    const [, liq, ltv] = html.match(/const LIQ=([0-9.]+),LTV=([0-9.]+);/).map(Number);
    expect(liq).to.equal(bps("LIQ_THRESHOLD_BPS") / 1e4);
    expect(ltv).to.equal(bps("LTV_BPS") / 1e4);
    // same formula as FarmCoop._health: collateral value * threshold / debt, liquidation below 1.0
    expect(html).to.include("const hf=()=>st.debt>0?collateral()*LIQ/st.debt:Infinity;");
  });
});

describe("Hosting headers (_headers)", () => {
  const { inlineHashes } = require("../scripts/csp");
  const headers = fs.readFileSync(path.join(ROOT, "_headers"), "utf8");
  const enforced = headers.match(/^\s*Content-Security-Policy: (.*)$/m)[1];

  it("enforces script-src without 'unsafe-inline', and allows each inline script by its hash (run npm run csp)", () => {
    const scriptSrc = enforced.split(";").map((s) => s.trim()).find((s) => s.startsWith("script-src"));
    expect(scriptSrc).to.be.a("string");
    expect(scriptSrc).to.not.match(/unsafe-inline|unsafe-eval|\*/);
    const hashes = inlineHashes(html);
    expect(hashes.length).to.be.greaterThan(0);
    for (const h of hashes) expect(scriptSrc, "inline script hash out of date: npm run csp").to.include(h);
    expect(enforced).to.include("frame-ancestors 'none'");
    expect(enforced).to.include("object-src 'none'");
  });
});

describe("Script safety checks", () => {
  const { assertSeparateKeys, fujiProvider } = require("../scripts/common");

  it("refuses a deploy key that is also a fee manager wallet, or no relayer at all", () => {
    const a = ethers.Wallet.createRandom().address, b = ethers.Wallet.createRandom().address;
    expect(() => assertSeparateKeys(a, [b, a.toLowerCase()])).to.throw(/trùng/);
    expect(() => assertSeparateKeys(a, [])).to.throw(/Thiếu/);
    expect(() => assertSeparateKeys(a, [b])).to.not.throw();
  });

  it("only signs on Fuji: a provider that answers another chain id is refused", async () => {
    const fake = (id) => ({ JsonRpcProvider: class { send() { return Promise.resolve(id); } } });
    let err;
    try { await fujiProvider(fake("0x7a69"), "http://x"); } catch (e) { err = e; }
    expect(err?.message).to.match(/không phải Fuji/);
    expect(await fujiProvider(fake("0xa869"), "http://x")).to.be.an("object");
    // drought, top-up and fund-relayers all go through it
    for (const f of ["drought.js", "top-up-quests.js", "fund-relayers.js", "butler-demo.js"])
      expect(fs.readFileSync(path.join(__dirname, "..", "scripts", f), "utf8"), f).to.include("fujiProvider(ethers");
  });

  it("fund-relayers only pays addresses listed in relay-config.js", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "fund-relayers.js"), "utf8");
    expect(src).to.match(/strange\.length\) throw/);
  });
});

describe("Proof links (npm run proof:readme)", () => {
  const { recordProof, renderProof, applyProof } = require("../scripts/proof");
  const H = (n) => "0x" + n.toString(16).padStart(64, "0");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proof-"));
  const file = path.join(dir, "fuji-proof.json");
  const stack = { forwarder: "0x" + "f".repeat(40), butler: "0x" + "b".repeat(40) };

  it("writes only hashes from the proof file, and a new deployment starts it over", () => {
    expect(() => recordProof(stack, { step: "x", text: "x", hash: "javascript:alert(1)" }, file)).to.throw();
    recordProof({ ...stack, forwarder: "0x" + "1".repeat(40) }, { step: "old", text: "bản cũ", hash: H(9) }, file);
    recordProof(stack, { step: "faucet()", text: "nhận USDC test", hash: H(1) }, file);
    recordProof(stack, { step: "butler-blocked", text: "bị chặn", hash: H(2), ok: false }, file);
    const p = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(p.steps.map((s) => s.step)).to.deep.equal(["faucet()", "butler-blocked"]);
    const md = renderProof(p);
    const found = md.match(/0x[0-9a-fA-F]+/g);
    expect(found).to.deep.equal([H(1), H(2)]);
    for (const h of found) expect(h).to.match(/^0x[0-9a-f]{64}$/);
  });

  it("rewrites the README block and the butler tx in chain-config only for the same butler", () => {
    const readme = path.join(dir, "README.md");
    const config = path.join(dir, "chain-config.js");
    fs.writeFileSync(readme, "a\n<!-- proof:start -->\ncũ 0xdead\n<!-- proof:end -->\nb\n");
    fs.writeFileSync(config, `// x\nwindow.FARM_CONFIG = ${JSON.stringify({ cchain: { butler: stack.butler } }, null, 2)};\n`);
    applyProof({ readme, config, file });
    const md = fs.readFileSync(readme, "utf8");
    expect(md).to.include(H(1)).and.to.not.include("0xdead");
    expect(md.startsWith("a\n<!-- proof:start -->\n")).to.equal(true);
    expect(fs.readFileSync(config, "utf8")).to.include(`"butlerBlockedTx": "${H(2)}"`);
    fs.writeFileSync(config, `window.FARM_CONFIG = ${JSON.stringify({ cchain: { butler: "0x" + "c".repeat(40) }, butlerBlockedTx: H(5) }, null, 2)};\n`);
    applyProof({ readme, config, file });
    expect(fs.readFileSync(config, "utf8")).to.not.include("butlerBlockedTx");
  });
});
