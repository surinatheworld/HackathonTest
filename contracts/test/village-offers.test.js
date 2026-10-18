// Off-chain views: the village indexer (functions/_lib/village.js, fed by the Avalanche Data API) and the
// Chợ đổi đồ picker (prototype/offers.js). Neither touches a chain, so the Data API is stubbed.
const path = require("path");
const { pathToFileURL } = require("url");
const { expect } = require("chai");

const ROOT = path.join(__dirname, "..", "..");
const A = (n) => "0x" + n.toString(16).padStart(40, "0");
const H = (n) => "0x" + n.toString(16).padStart(64, "0");

describe("Village indexer (Avalanche Data API)", () => {
  const POOL = A(0xfee1);
  const config = {
    chainId: 43113, forwarder: A(0xf0), game: A(0x9a), usdc: A(0x05d), gavax: A(0xa1), coop: A(0xc0), pond: A(0x90),
    items: A(0x17), quests: A(0x9e), butler: A(0xb7), relayers: [POOL], notPlayers: [],
  };
  let build, realFetch;
  before(async () => {
    ({ build } = await import(pathToFileURL(path.join(ROOT, "functions", "_lib", "village.js")).href));
    realFetch = globalThis.fetch;
  });
  after(() => { globalThis.fetch = realFetch; });
  const serve = (pages) => {
    globalThis.fetch = async (url) => {
      const u = String(url);
      const body = u.includes(`/addresses/${config.forwarder}/transactions`) ? { transactions: pages.forwarder || [] }
        : u.includes(`/tokens/${config.usdc}/transfers`) ? { transfers: pages.transfers || [] }
        : u.includes(`/addresses/${config.butler}/transactions`) ? { transactions: [] }
        : { transactions: [], transfers: [] };
      return { ok: true, json: async () => body };
    };
  };
  const exec = (from, i) => ({ nativeTransaction: { method: { methodName: "executeBatch" }, from: { address: from }, gasUsed: "100000", gasPrice: "1", blockTimestamp: 0, txHash: H(i) } });

  it("counts only forwarder calls sent by the fee manager's own wallets as sponsored", async () => {
    const stranger = A(0xbad);
    serve({ forwarder: [...Array.from({ length: 50 }, (_, i) => exec(stranger, i)), exec(POOL, 99)] });
    const v = await build({}, config);
    expect(v.stats.sponsoredTxs).to.equal(1);
    expect(v.stats.relayersUsed).to.equal(1);
  });

  it("drops Data API rows whose address or tx hash is not plain hex, so nothing odd reaches the page", async () => {
    const ok = { from: { address: "0x0000000000000000000000000000000000000000" }, to: { address: A(0x1234) }, value: "1000000000", txHash: H(1), blockTimestamp: 1 };
    const badWho = { ...ok, to: { address: '"><img src=x onerror=alert(1)>' } };
    const badHash = { ...ok, to: { address: A(0x5678) }, txHash: "javascript:alert(1)" };
    serve({ transfers: [badWho, badHash, ok] });
    const v = await build({}, config);
    expect(v.activity.map((a) => a.who)).to.deep.equal([A(0x1234)]);
    expect(v.farmers.map((f) => f.who)).to.deep.equal([A(0x1234)]);
  });
});

describe("Chợ đổi đồ picker (prototype/offers.js)", () => {
  const { pickOffers, loadOffers, ZERO } = require(path.join(ROOT, "prototype", "offers.js"));
  const ALICE = A(0xa11ce), SPAM = A(0x5a), ME = A(0x3e);

  it("a pile of cheap offers cannot hide a real public offer, and one maker fills at most 3 rows", async () => {
    // Offer 0: alice's public offer. Offers 1-60: the spammer's, 30 private (for someone else) and 30 public.
    const rows = [{ id: 0, maker: ALICE, taker: ZERO, expires: 9e9, open: true }];
    for (let i = 1; i <= 60; i++) rows.push({ id: i, maker: SPAM, taker: i % 2 ? A(0x77) : ZERO, expires: 9e9, open: true });
    const shown = await loadOffers(async (i) => rows[i], rows.length, ME, 1000);
    expect(shown.map((o) => o.id)).to.include(0);
    expect(shown.filter((o) => o.maker === SPAM).length).to.equal(3);
  });

  it("keeps the player's own offers and offers meant for them; skips closed, expired and other people's private ones", () => {
    const rows = [
      { id: 5, maker: ME, taker: A(0x77), expires: 9e9, open: true },
      { id: 4, maker: ALICE, taker: ME, expires: 9e9, open: true },
      { id: 3, maker: ALICE, taker: A(0x77), expires: 9e9, open: true },
      { id: 2, maker: ALICE, taker: ZERO, expires: 10, open: true },
      { id: 1, maker: ALICE, taker: ZERO, expires: 9e9, open: false },
    ];
    expect(pickOffers(rows, ME, 1000).map((o) => o.id)).to.deep.equal([5, 4]);
  });
});
