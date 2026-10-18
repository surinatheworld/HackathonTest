// Chợ đổi đồ: which market offers the game shows a player. Used by the game (window.FarmOffers, before chain.js)
// and by the tests (require). Offers meant for someone else are skipped while reading, not after a fixed cut, and
// one wallet fills at most a few rows, so a pile of cheap private offers cannot hide the real ones.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FarmOffers = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const ZERO = "0x0000000000000000000000000000000000000000";

  /** rows: offers newest first ({ maker, taker, expires, open }). Keeps the open, unexpired ones `me` made or may
   *  take (public, or meant for `me`), at most `perMaker` from each other maker, up to `want` rows. */
  function pickOffers(rows, me, now, { want = 25, perMaker = 3 } = {}) {
    me = String(me || "").toLowerCase();
    const per = new Map();
    const out = [];
    for (const o of rows) {
      if (out.length >= want) break;
      if (!o.open || Number(o.expires) < now) continue;
      const maker = String(o.maker).toLowerCase(), taker = String(o.taker).toLowerCase();
      if (maker !== me) {
        if (taker !== ZERO && taker !== me) continue;
        const n = per.get(maker) || 0;
        if (n >= perMaker) continue;
        per.set(maker, n + 1);
      }
      out.push(o);
    }
    return out;
  }

  /** Reads offers newest first, `batch` at a time (read(id) -> row), until `want` are picked or `maxScan` were read. */
  async function loadOffers(read, count, me, now, { want = 25, perMaker = 3, batch = 25, maxScan = 200 } = {}) {
    const rows = [];
    let picked = [];
    for (let top = count - 1; top >= 0 && rows.length < maxScan; top -= batch) {
      const ids = [];
      for (let i = top; i > top - batch && i >= 0; i--) ids.push(i);
      rows.push(...(await Promise.all(ids.map(read))));
      picked = pickOffers(rows, me, now, { want, perMaker });
      if (picked.length >= want) break;
    }
    return picked;
  }

  return { ZERO, pickOffers, loadOffers };
});
