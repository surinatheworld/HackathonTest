// Chợ đổi đồ: which market offers the game shows a player. Used by the game (window.FarmOffers, before chain.js)
// and by the tests (require). Offers meant for someone else are skipped while reading, not after a fixed cut, and
// one wallet fills at most a few rows, so a pile of cheap private offers cannot hide the real ones; the player's own
// offers and the ones meant for them are read first by id, so a pile of public offers cannot push them out either.
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

  /** Reads the offers in `first` (ids the player made or that are meant for them, from FarmItems.offersBy and
   *  offersFor) and then the newest ones, `batch` at a time (read(id) -> row), until `want` are picked or `maxScan`
   *  were read. However many public offers others post, the player's own and private ones are always read. */
  async function loadOffers(read, count, me, now, { want = 25, perMaker = 3, batch = 25, maxScan = 200, first = [] } = {}) {
    const seen = new Set();
    const ids0 = [...new Set(first.map(Number))].filter((i) => i >= 0 && i < count).sort((a, b) => b - a);
    ids0.forEach((i) => seen.add(i));
    const own = await Promise.all(ids0.map(read));
    const rows = [];
    let picked = pickOffers(own, me, now, { want, perMaker });
    for (let top = count - 1; top >= 0 && rows.length < maxScan && picked.length < want; top -= batch) {
      const ids = [];
      for (let i = top; i > top - batch && i >= 0; i--) if (!seen.has(i)) ids.push(i);
      rows.push(...(await Promise.all(ids.map(read))));
      picked = pickOffers([...own, ...rows], me, now, { want, perMaker }); // own and private ones first
    }
    return picked;
  }

  return { ZERO, pickOffers, loadOffers };
});
