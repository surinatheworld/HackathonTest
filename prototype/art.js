/* Nông Trại DeFi · art module (prototype/art.js)
   Redraws the static village (ground, water, buildings, stalls, gate, fences, border forest, props, signs)
   and the sprites (villagers, lettuce, orchard trees). Layout and collision stay exactly as in index.html:
   everything is painted on top of FARM.map, nothing changes it. Exposes window.FarmArt.lights and
   .chimneys (world px) so prototype/fx.js lights windows and lanterns at night. */
(() => {
'use strict';
const F = window.FARM;
if (!F || window.FarmArt) return;
const { T, W, H, map, tile, hsh, ZONES, BEDS, SPOTS, NBEDS } = F;
const { G, P, WA, D, PL, SA, K, B } = F.TILE;
const FE = F.TILE.F;
const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- helpers */
const R = (g, c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
const ell = (g, x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, Math.max(.1, rx), Math.max(.1, ry), 0, 0, TAU); g.fill(); };
const at = (x, y) => tile(x, y);
const isWater = (t) => t === WA || t === K;
const grassy = (t) => t === G || t === B || t === FE;
const near = (x, y, px, py, d) => Math.hypot(x - px, y - py) < d;
const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];

const lights = [];
const chimneys = [];

/* Props must stay off zone interaction points, signs, crop spots, the orchard and paths. */
function freeSpot(x, y, pad = 1) {
  const tx = Math.floor(x), ty = Math.floor(y);
  for (let yy = ty - pad; yy <= ty + pad; yy++) for (let xx = tx - pad; xx <= tx + pad; xx++) {
    const t = at(xx, yy);
    if (t !== G) return false;
  }
  for (const z of ZONES) {
    if (near(x, y, z.ax, z.ay, 2.4)) return false;
    if (z.sx != null && near(x, y, z.sx, z.sy, 1.8)) return false;
  }
  const o = F.Z.orchard && F.Z.orchard.area;
  if (o && x >= o[0] - .5 && x <= o[2] + 1 && y >= o[1] - .5 && y <= o[3] + 1) return false;
  for (const s of SPOTS) if (near(x, y, s[0], s[1], 1.4)) return false;
  return true;
}

/* ---------------------------------------------------------------- ground */
const GRASS = ['#6cae4c', '#69aa49', '#70b250'];
function grassTile(g, x, y) {
  const px = x * T, py = y * T;
  // One base colour everywhere, so tiles never show as a checkerboard; texture comes from small specks.
  R(g, GRASS[0], px, py, T, T);
  for (let by = 0; by < T; by += 2) for (let bx = 0; bx < T; bx += 2) {
    const r = hsh(x * 16 + bx / 2, y * 16 + by / 2, 2);
    if (r < .07) R(g, '#66a748', px + bx, py + by, 2, 2);
    else if (r > .965) R(g, '#76b856', px + bx, py + by, 2, 2);
  }
  for (let k = 0; k < 5; k++) {
    if (hsh(x, y, 10 + k) > .62) continue;
    const tx = px + Math.floor(hsh(x, y, 20 + k) * 27), ty = py + Math.floor(hsh(x, y, 30 + k) * 25);
    R(g, '#4c8a36', tx, ty + 2, 1, 3); R(g, '#4c8a36', tx + 2, ty, 1, 5); R(g, '#4c8a36', tx + 4, ty + 2, 1, 3);
    R(g, '#8acb69', tx + 2, ty, 1, 1);
  }
  if (hsh(x, y, 40) < .085) {
    const c = pick(['#f7f1e8', '#f6d65c', '#f19ab0', '#b9a7f0'], hsh(x, y, 41));
    const fx = px + 4 + Math.floor(hsh(x, y, 42) * 22), fy = py + 4 + Math.floor(hsh(x, y, 43) * 22);
    R(g, '#4c8a36', fx + 1, fy + 2, 1, 3); R(g, c, fx, fy, 3, 1); R(g, c, fx + 1, fy - 1, 1, 3); R(g, '#f2c14e', fx + 1, fy, 1, 1);
  }
}

function edgeOverhang(g, x, y, base, line) {
  const px = x * T, py = y * T;
  const side = (nx, ny) => grassy(at(nx, ny));
  if (side(x, y - 1)) for (let i = 0; i < T; i += 2) { const l = 1 + Math.floor(hsh(px + i, py, 7) * 4); R(g, base, px + i, py, 2, l); R(g, line, px + i, py + l, 2, 1); }
  if (side(x, y + 1)) for (let i = 0; i < T; i += 2) { const l = 1 + Math.floor(hsh(px + i, py, 8) * 4); R(g, base, px + i, py + T - l, 2, l); R(g, line, px + i, py + T - l - 1, 2, 1); }
  if (side(x - 1, y)) for (let i = 0; i < T; i += 2) { const l = 1 + Math.floor(hsh(px, py + i, 9) * 4); R(g, base, px, py + i, l, 2); R(g, line, px + l, py + i, 1, 2); }
  if (side(x + 1, y)) for (let i = 0; i < T; i += 2) { const l = 1 + Math.floor(hsh(px, py + i, 11) * 4); R(g, base, px + T - l, py + i, l, 2); R(g, line, px + T - l - 1, py + i, 1, 2); }
}

function pathTile(g, x, y) {
  const px = x * T, py = y * T;
  R(g, '#d5ae74', px, py, T, T);
  for (let by = 0; by < T; by += 4) for (let bx = 0; bx < T; bx += 4) {
    const r = hsh(x * 8 + bx / 4, y * 8 + by / 4, 3);
    if (r < .12) R(g, '#cea870', px + bx, py + by, 4, 4); else if (r > .94) R(g, '#dbb880', px + bx, py + by, 4, 4);
  }
  for (let k = 0; k < 4; k++) if (hsh(x, y, k + 3) < .55) {
    const sx = px + 2 + Math.floor(hsh(x, y, k + 5) * 26), sy = py + 2 + Math.floor(hsh(x, y, k + 7) * 26);
    R(g, '#a98652', sx, sy + 1, 4, 2); R(g, '#bd9761', sx, sy, 4, 2); R(g, '#ead2a4', sx, sy, 2, 1);
  }
  edgeOverhang(g, x, y, '#6cae4c', '#b48d58');
}

function fieldTile(g, x, y) {
  const px = x * T, py = y * T;
  R(g, '#7a4a2a', px, py, T, T);
  for (let yy = 0; yy < T; yy += 8) { R(g, '#653d1f', px, py + yy + 5, T, 3); R(g, '#8d5b35', px, py + yy + 1, T, 2); }
  for (let k = 0; k < 6; k++) R(g, hsh(x, y, 60 + k) < .5 ? '#5a361b' : '#9a6a40', px + Math.floor(hsh(x, y, 70 + k) * 30), py + Math.floor(hsh(x, y, 80 + k) * 30), 2, 1);
  if (at(x, y - 1) !== D) R(g, '#a7774a', px, py, T, 2);
  if (at(x, y + 1) !== D) { R(g, '#4f2f16', px, py + T - 3, T, 3); }
  if (at(x - 1, y) !== D) R(g, '#5e391c', px, py, 2, T);
  if (at(x + 1, y) !== D) R(g, '#5e391c', px + T - 2, py, 2, T);
}

const STONES = ['#c9c1ad', '#bdb5a0', '#d3ccb9', '#b4ac96', '#c4bca6'];
function plazaTile(g, x, y) {
  const px = x * T, py = y * T;
  R(g, '#8f8877', px, py, T, T);
  for (let r = 0; r < 4; r++) {
    const off = (r + y) % 2 ? 4 : 0;
    for (let c = -1; c < 4; c++) {
      const sx = px + c * 8 + off, sy = py + r * 8;
      const x0 = Math.max(px, sx + 1), x1 = Math.min(px + T, sx + 8);
      if (x1 - x0 < 2) continue;
      const v = hsh(x * 5 + c, y * 5 + r, 12);
      R(g, pick(STONES, v), x0, sy + 1, x1 - x0, 6);
      R(g, 'rgba(255,255,255,.18)', x0, sy + 1, x1 - x0, 1);
      R(g, 'rgba(0,0,0,.12)', x0, sy + 6, x1 - x0, 1);
      if (v > .93) R(g, '#7f9a5e', x0, sy + 5, 3, 2);
    }
  }
}

function sandTile(g, x, y) {
  const px = x * T, py = y * T;
  R(g, '#e4cc94', px, py, T, T);
  for (let k = 0; k < 7; k++) R(g, hsh(x, y, 90 + k) < .5 ? '#d3b77a' : '#f1ddb0', px + Math.floor(hsh(x, y, 100 + k) * 30), py + Math.floor(hsh(x, y, 110 + k) * 30), 2, 1);
  const wet = '#cdb07a';
  if (isWater(at(x, y + 1))) R(g, wet, px, py + T - 5, T, 5);
  if (isWater(at(x, y - 1))) R(g, wet, px, py, T, 5);
  if (isWater(at(x - 1, y))) R(g, wet, px, py, 5, T);
  if (isWater(at(x + 1, y))) R(g, wet, px + T - 5, py, 5, T);
  if (grassy(at(x, y - 1)) || grassy(at(x - 1, y)) || grassy(at(x + 1, y)) || grassy(at(x, y + 1))) edgeOverhang(g, x, y, '#6cae4c', '#c7ab72');
}

function lerpHex(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * k));
  const gg = Math.round(((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * k));
  const bb = Math.round((pa & 255) + (((pb & 255) - (pa & 255)) * k));
  return '#' + ((1 << 24) | (r << 16) | (gg << 8) | bb).toString(16).slice(1);
}

function waterDepth() {
  const d = new Float32Array(W * H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isWater(at(x, y))) continue;
    let best = 9;
    for (let yy = -4; yy <= 4; yy++) for (let xx = -4; xx <= 4; xx++) {
      const t = at(x + xx, y + yy);
      if (t >= 0 && !isWater(t)) best = Math.min(best, Math.hypot(xx, yy));
    }
    d[y * W + x] = Math.min(1, (best - 1) / 3);
  }
  return d;
}

function waterTile(g, x, y, depth) {
  const px = x * T, py = y * T;
  for (let by = 0; by < T; by += 8) for (let bx = 0; bx < T; bx += 8) {
    const k = Math.max(0, Math.min(1, depth + (hsh(x * 4 + bx / 8, y * 4 + by / 8, 13) - .5) * .25));
    R(g, lerpHex('#5fb6d4', '#2a729f', k), px + bx, py + by, 8, 8);
  }
  for (let k = 0; k < 3; k++) if (hsh(x, y, 120 + k) < .5) R(g, 'rgba(255,255,255,.16)', px + Math.floor(hsh(x, y, 130 + k) * 24), py + Math.floor(hsh(x, y, 140 + k) * 30), 6, 1);
  const shore = (nx, ny) => { const t = at(nx, ny); return t >= 0 && !isWater(t); };
  const foam = 'rgba(232,248,252,.9)', shallow = 'rgba(140,210,230,.55)';
  if (shore(x, y - 1)) { R(g, shallow, px, py, T, 7); for (let i = 0; i < T; i += 2) R(g, foam, px + i, py + 1 + Math.round(Math.sin((px + i) * .35) * 1), 2, 2); }
  if (shore(x, y + 1)) { R(g, shallow, px, py + T - 7, T, 7); for (let i = 0; i < T; i += 2) R(g, foam, px + i, py + T - 3 + Math.round(Math.sin((px + i) * .35) * 1), 2, 2); }
  if (shore(x - 1, y)) { R(g, shallow, px, py, 7, T); for (let i = 0; i < T; i += 2) R(g, foam, px + 1 + Math.round(Math.sin((py + i) * .35)), py + i, 2, 2); }
  if (shore(x + 1, y)) { R(g, shallow, px + T - 7, py, 7, T); for (let i = 0; i < T; i += 2) R(g, foam, px + T - 3 + Math.round(Math.sin((py + i) * .35)), py + i, 2, 2); }
}

function dockTile(g, x, y) {
  const px = x * T, py = y * T;
  R(g, 'rgba(0,0,0,.25)', px + 6, py + 3, T - 8, T);
  for (let yy = 0; yy < T; yy += 6) {
    R(g, hsh(x, y + yy, 14) < .5 ? '#a8733f' : '#b07b45', px + 4, py + yy, T - 8, 5);
    R(g, '#6e4825', px + 4, py + yy + 5, T - 8, 1);
    R(g, 'rgba(255,255,255,.14)', px + 4, py + yy, T - 8, 1);
  }
  R(g, '#5b3a1d', px + 3, py, 2, T); R(g, '#5b3a1d', px + T - 5, py, 2, T);
  if (at(x, y + 1) !== K) { R(g, '#4a2f17', px + 3, py + T - 2, 4, 6); R(g, '#4a2f17', px + T - 7, py + T - 2, 4, 6); }
}

/* ---------------------------------------------------------------- nature */
function canopy(g, X, Y, r, c, cd, cl) {
  g.fillStyle = 'rgba(25,45,20,.28)'; ell(g, X + r * .35, Y + r * .95, r * 1.05, r * .38);
  R(g, '#5b3a1d', X - 2, Y, 4, r * .8); R(g, '#3f2812', X + 1, Y, 1, r * .8);
  g.fillStyle = '#1f3a1c'; ell(g, X, Y - r * .35, r + 1.5, r * .9 + 1.5); ell(g, X - r * .55, Y, r * .62 + 1.5, r * .55 + 1.5); ell(g, X + r * .55, Y, r * .62 + 1.5, r * .55 + 1.5);
  g.fillStyle = cd; ell(g, X, Y - r * .35, r, r * .9); ell(g, X - r * .55, Y, r * .62, r * .55); ell(g, X + r * .55, Y, r * .62, r * .55);
  g.fillStyle = c; ell(g, X - r * .1, Y - r * .5, r * .8, r * .68); ell(g, X - r * .55, Y - r * .1, r * .45, r * .4);
  g.fillStyle = cl; ell(g, X - r * .35, Y - r * .8, r * .38, r * .25);
}
function bamboo(g, X, Y, n, seed) {
  g.fillStyle = 'rgba(25,45,20,.25)'; ell(g, X + 4, Y + 2, 12, 4);
  for (let i = 0; i < n; i++) {
    const sx = X - 8 + i * 5 + Math.round(hsh(seed, i, 15) * 3), h = 28 + Math.floor(hsh(seed, i, 16) * 18);
    R(g, '#4f7d2c', sx, Y - h, 3, h); R(g, '#7fae45', sx, Y - h, 1, h);
    for (let k = 6; k < h; k += 8) R(g, '#3a5e1f', sx, Y - k, 3, 1);
    g.fillStyle = i % 2 ? '#5f9a35' : '#4c8a2c';
    g.beginPath(); g.moveTo(sx + 1, Y - h); g.lineTo(sx + 10, Y - h - 5); g.lineTo(sx + 2, Y - h + 3); g.fill();
    g.beginPath(); g.moveTo(sx + 1, Y - h + 8); g.lineTo(sx - 8, Y - h + 2); g.lineTo(sx, Y - h + 11); g.fill();
  }
}
function bush(g, X, Y, r, flowers, seed) {
  g.fillStyle = 'rgba(25,45,20,.25)'; ell(g, X + 3, Y + 2, r + 3, r * .4);
  g.fillStyle = '#2b4f24'; ell(g, X, Y - r * .4, r + 1.5, r * .75 + 1.5);
  g.fillStyle = '#3f7c33'; ell(g, X, Y - r * .4, r, r * .75);
  g.fillStyle = '#58a043'; ell(g, X - r * .25, Y - r * .6, r * .6, r * .42);
  if (flowers) for (let i = 0; i < 4; i++) R(g, flowers, X - r + 3 + Math.floor(hsh(seed, i, 17) * (r * 2 - 6)), Y - r * .9 + Math.floor(hsh(seed, i, 18) * r * .7), 2, 2);
}
function rock(g, X, Y, s) {
  g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, X + 2, Y + 2, s + 2, s * .45);
  g.fillStyle = '#6f7471'; ell(g, X, Y - s * .3, s, s * .7);
  g.fillStyle = '#8e9490'; ell(g, X - s * .2, Y - s * .5, s * .65, s * .42);
  R(g, '#b5bab4', X - s * .45, Y - s * .8, 2, 1);
}
function mushroom(g, X, Y) {
  R(g, '#f1e6d0', X - 1, Y - 4, 2, 4);
  g.fillStyle = '#d94b3a'; ell(g, X, Y - 5, 4, 2.5);
  R(g, '#fff3e0', X - 2, Y - 6, 1, 1); R(g, '#fff3e0', X + 1, Y - 5, 1, 1);
}
function flowerPatch(g, X, Y, seed) {
  for (let i = 0; i < 7; i++) {
    const fx = X - 9 + Math.floor(hsh(seed, i, 19) * 18), fy = Y - 6 + Math.floor(hsh(seed, i, 20) * 10);
    const c = pick(['#f7f1e8', '#f6d65c', '#f19ab0', '#e8604a', '#b9a7f0'], hsh(seed, i, 21));
    R(g, '#3f7c33', fx + 1, fy + 2, 1, 3); R(g, c, fx, fy, 3, 2); R(g, '#fff6cf', fx + 1, fy, 1, 1);
  }
}
function haystack(g, X, Y) {
  g.fillStyle = 'rgba(0,0,0,.22)'; ell(g, X + 3, Y + 2, 15, 5);
  g.fillStyle = '#b58a2e'; ell(g, X, Y - 9, 14, 12);
  g.fillStyle = '#d9ae45'; ell(g, X - 2, Y - 11, 11, 9);
  g.fillStyle = '#f0cd68'; ell(g, X - 4, Y - 15, 5, 3);
  for (let i = 0; i < 8; i++) R(g, '#9c7424', X - 11 + i * 3, Y - 5 + (i % 2), 1, 4);
}
function scarecrow(g, X, Y) {
  g.fillStyle = 'rgba(0,0,0,.22)'; ell(g, X + 2, Y + 1, 9, 3);
  R(g, '#6b4426', X - 1, Y - 30, 3, 30); R(g, '#6b4426', X - 12, Y - 22, 25, 3);
  R(g, '#c0533d', X - 8, Y - 24, 17, 12); R(g, '#9e3f2c', X - 8, Y - 14, 17, 2);
  R(g, '#d9ae45', X - 13, Y - 22, 3, 5); R(g, '#d9ae45', X + 11, Y - 22, 3, 5);
  g.fillStyle = '#f1e2bf'; ell(g, X, Y - 29, 5, 5);
  R(g, '#2a1d14', X - 2, Y - 30, 1, 1); R(g, '#2a1d14', X + 2, Y - 30, 1, 1);
  g.fillStyle = '#ecd79c'; g.beginPath(); g.moveTo(X - 11, Y - 31); g.lineTo(X + 11, Y - 31); g.lineTo(X, Y - 42); g.closePath(); g.fill();
  R(g, '#c4a25c', X - 11, Y - 32, 22, 1);
}
function well(g, X, Y) {
  g.fillStyle = 'rgba(0,0,0,.22)'; ell(g, X + 3, Y + 3, 17, 6);
  g.fillStyle = '#8c8576'; ell(g, X, Y - 4, 14, 8);
  g.fillStyle = '#a39c8b'; ell(g, X, Y - 6, 14, 7);
  g.fillStyle = '#2f5f7a'; ell(g, X, Y - 6, 9, 4.2);
  g.fillStyle = '#5c9cbd'; ell(g, X - 2, Y - 7, 4, 1.5);
  R(g, '#6b4426', X - 13, Y - 28, 3, 22); R(g, '#6b4426', X + 10, Y - 28, 3, 22);
  g.fillStyle = '#93402e'; g.beginPath(); g.moveTo(X - 17, Y - 25); g.lineTo(X + 17, Y - 25); g.lineTo(X, Y - 36); g.closePath(); g.fill();
  R(g, '#7a3326', X - 17, Y - 26, 34, 2);
  R(g, '#5a3619', X - 10, Y - 20, 20, 2); R(g, '#7a4f2c', X - 1, Y - 19, 3, 7);
}
function lantern(g, X, Y) {
  g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, X + 3, Y + 1, 5, 2);
  R(g, '#4a2f17', X - 1, Y - 30, 3, 30); R(g, '#4a2f17', X - 1, Y - 30, 9, 2); R(g, '#4a2f17', X + 6, Y - 29, 1, 3);
  g.fillStyle = '#c8392b'; ell(g, X + 6, Y - 21, 5, 6);
  g.fillStyle = '#e8604a'; ell(g, X + 5, Y - 22, 3, 4.5);
  R(g, '#f2c14e', X + 3, Y - 27, 7, 2); R(g, '#f2c14e', X + 3, Y - 16, 7, 2); R(g, '#f2c14e', X + 6, Y - 14, 1, 3);
  lights.push({ x: X + 6, y: Y - 21, r: 66, kind: 'lantern', color: '#ffb35c' });
}
function lotus(g, X, Y, flower, seed) {
  g.fillStyle = '#2f7a43'; ell(g, X, Y, 7, 4);
  g.fillStyle = '#3f9150'; ell(g, X - 1, Y - 1, 5, 3);
  g.fillStyle = '#2a729f'; g.beginPath(); g.moveTo(X, Y); g.lineTo(X + 7, Y - 2); g.lineTo(X + 7, Y + 1); g.fill();
  if (flower) {
    g.fillStyle = '#f3a6c0'; ell(g, X - 1, Y - 3, 3, 2.4); g.fillStyle = '#fbd3df'; ell(g, X - 1, Y - 4, 1.6, 1.4);
    R(g, '#f6d65c', X - 1, Y - 4, 1, 1);
  }
}
function reeds(g, X, Y, seed) {
  for (let i = 0; i < 5; i++) {
    const sx = X - 6 + i * 3, h = 10 + Math.floor(hsh(seed, i, 22) * 9);
    R(g, '#5f8f3a', sx, Y - h, 1, h);
    if (i % 2 === 0) R(g, '#7a4f2c', sx - 1, Y - h - 1, 3, 5);
  }
}

/* ---------------------------------------------------------------- buildings */
function roofScales(g, X, Y, Wd, rh, c) {
  g.save();
  g.beginPath(); g.moveTo(X - 7, Y + rh); g.lineTo(X + Wd + 7, Y + rh); g.lineTo(X + Wd - 14, Y + 7); g.lineTo(X + 14, Y + 7); g.closePath();
  g.fillStyle = c.roof; g.fill(); g.clip();
  for (let yy = Y + 10, row = 0; yy < Y + rh + 2; yy += 7, row++) {
    const off = row % 2 ? 4 : 0;
    for (let xx = X - 10 + off; xx < X + Wd + 10; xx += 8) {
      g.fillStyle = c.roofD; g.beginPath(); g.arc(xx + 4, yy + 4, 4, 0, Math.PI); g.fill();
      R(g, c.roofL, xx + 1, yy, 5, 1);
    }
  }
  g.restore();
  R(g, c.roofD, X - 7, Y + rh - 3, Wd + 14, 4);
  R(g, 'rgba(0,0,0,.25)', X - 2, Y + rh + 1, Wd + 4, 3);
  // upturned eaves (Vietnamese curl)
  g.fillStyle = c.roofD;
  g.beginPath(); g.moveTo(X - 7, Y + rh); g.lineTo(X - 13, Y + rh - 9); g.lineTo(X - 3, Y + rh - 4); g.fill();
  g.beginPath(); g.moveTo(X + Wd + 7, Y + rh); g.lineTo(X + Wd + 13, Y + rh - 9); g.lineTo(X + Wd + 3, Y + rh - 4); g.fill();
  // ridge with curled ends
  R(g, c.roofD, X + 12, Y + 3, Wd - 24, 6); R(g, c.roofL, X + 12, Y + 3, Wd - 24, 1);
  R(g, c.roofD, X + 8, Y, 6, 5); R(g, c.roofD, X + Wd - 14, Y, 6, 5);
  R(g, c.roofD, X + 6, Y - 3, 3, 4); R(g, c.roofD, X + Wd - 9, Y - 3, 3, 4);
}
function windowAt(g, x, y, w, h, shutter) {
  R(g, '#4a2f17', x - 2, y - 2, w + 4, h + 4);
  R(g, '#9fd3e6', x, y, w, h); R(g, '#c9ecf6', x, y, w, 3); R(g, 'rgba(255,255,255,.55)', x + 2, y + 2, 3, 1);
  R(g, '#4a2f17', x + w / 2 - 1, y, 2, h); R(g, '#4a2f17', x, y + h / 2 - 1, w, 2);
  R(g, shutter, x - 6, y - 2, 4, h + 4); R(g, shutter, x + w + 2, y - 2, 4, h + 4);
  R(g, 'rgba(0,0,0,.18)', x - 6, y + h, 4, 2); R(g, 'rgba(0,0,0,.18)', x + w + 2, y + h, 4, 2);
  R(g, '#7a4f2c', x - 3, y + h + 2, w + 6, 4);
  for (let i = 0; i < 4; i++) R(g, ['#f19ab0', '#f6d65c', '#e8604a', '#f7f1e8'][i], x - 1 + i * (w / 4 + 1), y + h, 3, 3);
  lights.push({ x, y, w, h, kind: 'window', color: '#ffcf7a' });
}
function house(g, x0, y0, x1, y1, c) {
  const X = x0 * T, Y = y0 * T, Wd = (x1 - x0 + 1) * T, Ht = (y1 - y0 + 1) * T, rh = Math.round(Ht * .58);
  g.fillStyle = 'rgba(20,40,20,.3)';
  g.beginPath(); g.moveTo(X + 6, Y + Ht - 4); g.lineTo(X + Wd + 4, Y + Ht - 4); g.lineTo(X + Wd + 16, Y + Ht + 8); g.lineTo(X + 16, Y + Ht + 8); g.closePath(); g.fill();
  const wallTop = Y + rh - 10, wallH = Ht - (rh - 10) - 8;
  R(g, c.wall, X + 5, wallTop, Wd - 10, wallH);
  for (let yy = wallTop + 5; yy < wallTop + wallH; yy += 6) R(g, c.wallD, X + 5, yy, Wd - 10, 1);
  R(g, 'rgba(0,0,0,.12)', X + 5, wallTop, Wd - 10, 6);
  R(g, '#6b4426', X + 5, wallTop, 4, wallH); R(g, '#6b4426', X + Wd - 9, wallTop, 4, wallH);
  R(g, '#7f7869', X + 3, Y + Ht - 8, Wd - 6, 8);
  for (let xx = X + 4; xx < X + Wd - 6; xx += 9) R(g, '#9a9384', xx, Y + Ht - 7, 7, 3);
  R(g, 'rgba(0,0,0,.2)', X + 3, Y + Ht - 2, Wd - 6, 2);
  const dw = 20, dh = 26, dx = Math.round(X + Wd / 2 - dw / 2), dy = Y + Ht - 8 - dh;
  R(g, '#3f2812', dx - 2, dy - 2, dw + 4, dh + 2);
  R(g, '#7a4724', dx, dy, dw, dh); R(g, '#6a3d1f', dx + dw / 2 - 1, dy, 2, dh);
  R(g, '#8f5730', dx + 2, dy + 2, 6, dh - 4); R(g, '#8f5730', dx + dw - 8, dy + 2, 6, dh - 4);
  R(g, '#f2c14e', dx + dw - 5, dy + dh / 2, 2, 2); R(g, '#f2c14e', dx + 3, dy + dh / 2, 2, 2);
  R(g, '#a39c8b', dx - 4, Y + Ht - 8, dw + 8, 4); R(g, '#8c8576', dx - 6, Y + Ht - 4, dw + 12, 4);
  lights.push({ x: dx + 4, y: dy + 4, w: dw - 8, h: dh - 8, kind: 'door', color: '#ffb35c', i: .55 });
  const wy = Math.max(wallTop + 6, Y + Ht - 36), ww = 16, wh = 13;
  windowAt(g, X + 15, wy, ww, wh, c.trim);
  windowAt(g, X + Wd - 15 - ww, wy, ww, wh, c.trim);
  if (Wd >= 6 * T) { windowAt(g, X + Wd / 2 - ww - 26, wy, ww, wh, c.trim); windowAt(g, X + Wd / 2 + 26, wy, ww, wh, c.trim); }
  if (c.chimney) {
    const cx = X + Wd - 40, cy = Y + 2;
    R(g, '#7a3a2a', cx, cy - 10, 12, 22); R(g, '#9a4a35', cx, cy - 10, 12, 3); R(g, '#5a2a1e', cx - 1, cy - 12, 14, 3);
    chimneys.push({ x: cx + 6, y: cy - 12 });
  }
  roofScales(g, X, Y, Wd, rh, c);
  return { X, Y, Wd, Ht, rh, dx, dy, dw, dh };
}

function stall(g, x, y, c, i) {
  const X = x * T, Y = y * T, w = 2.4 * T;
  g.fillStyle = 'rgba(0,0,0,.2)'; ell(g, X + w / 2 + 6, Y + 46, w / 2 + 4, 6);
  R(g, '#5a3619', X + 2, Y + 8, 3, 36); R(g, '#5a3619', X + w - 5, Y + 8, 3, 36);
  R(g, '#9b6a3c', X, Y + 24, w, 18); R(g, '#b07b45', X, Y + 24, w, 3); R(g, '#6e4825', X, Y + 39, w, 3);
  for (let k = 0; k < 3; k++) {
    const bx = X + 6 + k * 24;
    R(g, '#8a5a2e', bx, Y + 20, 18, 9); R(g, '#a8733f', bx, Y + 20, 18, 2);
    const fc = ['#e8604a', '#f2c14e', '#86d36f', '#f6efe0', '#a9c93f', '#c0533d'][(k + i * 2) % 6];
    for (let m = 0; m < 4; m++) { g.fillStyle = fc; ell(g, bx + 4 + m * 3.5, Y + 19 - (m % 2) * 2, 3, 2.6); }
    R(g, 'rgba(255,255,255,.35)', bx + 3, Y + 16, 2, 1);
  }
  g.fillStyle = '#c99a4a'; ell(g, X - 4, Y + 42, 7, 4); g.fillStyle = '#a97a34'; ell(g, X - 4, Y + 40, 6, 2.6);
  for (let k = 0; k < 6; k++) { R(g, k % 2 ? '#f6efe0' : c, X - 3 + k * (w + 6) / 6, Y, (w + 6) / 6 + 1, 13); }
  for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? '#f6efe0' : c; g.beginPath(); g.arc(X - 3 + k * (w + 6) / 6 + (w + 6) / 12, Y + 13, (w + 6) / 12, 0, Math.PI); g.fill(); }
  R(g, 'rgba(255,255,255,.25)', X - 3, Y, w + 6, 2);
  R(g, 'rgba(0,0,0,.18)', X, Y + 17, w, 3);
  R(g, '#4a2f17', X + w - 2, Y + 14, 1, 4);
  g.fillStyle = '#c8392b'; ell(g, X + w - 2, Y + 21, 3.5, 4.2); R(g, '#f2c14e', X + w - 4, Y + 16, 5, 1); R(g, '#f2c14e', X + w - 4, Y + 25, 5, 1);
  lights.push({ x: X + w - 2, y: Y + 21, r: 54, kind: 'lantern', color: '#ffb35c' });
}

function gate(g) {
  const lx = 20 * T, rx = 23 * T;
  for (const px of [lx, rx]) {
    g.fillStyle = 'rgba(0,0,0,.25)'; ell(g, px + T / 2 + 4, 2 * T - 2, 15, 4);
    R(g, '#cbb991', px + 5, 10, T - 10, 2 * T - 12);
    R(g, '#e0d2ae', px + 5, 10, 4, 2 * T - 12);
    for (let y = 18; y < 2 * T - 6; y += 10) R(g, '#b2a27d', px + 5, y, T - 10, 2);
    R(g, '#9c8c68', px + 2, 2 * T - 9, T - 4, 7); R(g, '#b9a983', px + 2, 2 * T - 9, T - 4, 2);
  }
  // two-tier roof with curled ends
  const x0 = 19.3 * T, x1 = 24.7 * T;
  g.fillStyle = '#5f2b1e'; g.beginPath(); g.moveTo(x0 - 6, 22); g.lineTo(x1 + 6, 22); g.lineTo(x1 - 14, 8); g.lineTo(x0 + 14, 8); g.closePath(); g.fill();
  g.save(); g.beginPath(); g.moveTo(x0 - 6, 22); g.lineTo(x1 + 6, 22); g.lineTo(x1 - 14, 8); g.lineTo(x0 + 14, 8); g.closePath(); g.clip();
  g.fillStyle = '#a8452f'; g.fillRect(x0 - 8, 6, x1 - x0 + 16, 18);
  for (let yy = 8; yy < 24; yy += 6) for (let xx = x0 - 8 + (yy % 12 ? 4 : 0); xx < x1 + 8; xx += 8) { g.fillStyle = '#7c3121'; g.beginPath(); g.arc(xx + 4, yy + 3, 4, 0, Math.PI); g.fill(); }
  g.restore();
  g.fillStyle = '#5f2b1e';
  g.beginPath(); g.moveTo(x0 - 6, 22); g.lineTo(x0 - 15, 9); g.lineTo(x0 + 2, 17); g.fill();
  g.beginPath(); g.moveTo(x1 + 6, 22); g.lineTo(x1 + 15, 9); g.lineTo(x1 - 2, 17); g.fill();
  R(g, '#5f2b1e', x0 + 10, 2, x1 - x0 - 20, 6); R(g, '#c0533d', x0 + 10, 2, x1 - x0 - 20, 1);
  R(g, '#f2c14e', (x0 + x1) / 2 - 3, -2, 6, 6);
  // name board
  const bx = 20.75 * T, bw = 2.5 * T;
  R(g, '#3f2812', bx - 2, 27, bw + 4, 20); R(g, '#7c1f1a', bx, 29, bw, 16); R(g, '#f2c14e', bx, 29, bw, 1); R(g, '#f2c14e', bx, 44, bw, 1);
  g.font = '800 10px "Be Vietnam Pro", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#3f1210'; g.fillText('CỔNG C-CHAIN', bx + bw / 2 + 1, 38);
  g.fillStyle = '#ffd96a'; g.fillText('CỔNG C-CHAIN', bx + bw / 2, 37);
  for (const lxp of [lx + T - 2, rx + 2]) {
    R(g, '#4a2f17', lxp, 24, 1, 6);
    g.fillStyle = '#c8392b'; ell(g, lxp, 34, 4, 5); R(g, '#f2c14e', lxp - 3, 29, 6, 1); R(g, '#f2c14e', lxp - 3, 39, 6, 1);
    lights.push({ x: lxp, y: 34, r: 70, kind: 'gate', color: '#ffb35c' });
  }
}

function fences(g) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (at(x, y) !== FE) continue;
    const px = x * T, py = y * T;
    const hz = at(x - 1, y) === FE || at(x + 1, y) === FE, vt = at(x, y - 1) === FE || at(x, y + 1) === FE;
    R(g, 'rgba(0,0,0,.18)', px + 2, py + 26, T, 3);
    if (hz) { R(g, '#8b5c34', px, py + 11, T, 3); R(g, '#8b5c34', px, py + 20, T, 3); R(g, '#a9774a', px, py + 11, T, 1); R(g, '#a9774a', px, py + 20, T, 1); }
    if (vt) { R(g, '#8b5c34', px + 13, py, 3, T); R(g, '#a9774a', px + 13, py, 1, T); }
    R(g, '#5b3a1d', px + 12, py + 6, 6, 22); R(g, '#7a4f2c', px + 12, py + 6, 2, 22); R(g, '#a9774a', px + 11, py + 4, 8, 3);
  }
}

function sign(g, x, y, text) {
  g.font = '700 11px "Be Vietnam Pro", system-ui, sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 18, px = Math.round(x * T - w / 2), py = Math.round(y * T - 24);
  g.fillStyle = 'rgba(0,0,0,.25)'; ell(g, x * T + 3, py + 31, w / 2, 3);
  R(g, '#4a2c14', px + 5, py + 14, 4, 16); R(g, '#4a2c14', px + w - 9, py + 14, 4, 16);
  R(g, '#3d2410', px - 1, py - 1, w + 2, 21);
  R(g, '#9a6534', px, py, w, 19); R(g, '#b57b43', px, py, w, 2); R(g, '#7a4c26', px, py + 15, w, 4);
  R(g, '#5a3619', px + 3, py + 3, 1, 1); R(g, '#5a3619', px + w - 4, py + 3, 1, 1);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#4a2c14'; g.fillText(text, x * T, py + 10);
  g.fillStyle = '#fff2d6'; g.fillText(text, x * T, py + 9);
}

/* ---------------------------------------------------------------- static layer */
function buildStatic() {
  if (typeof document === 'undefined') return null;
  lights.length = 0; chimneys.length = 0;
  const c = document.createElement('canvas'); c.width = W * T; c.height = H * T;
  const g = c.getContext('2d'); if (!g) return null;
  g.imageSmoothingEnabled = false;
  const depth = waterDepth();

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = map[y * W + x];
    if (t === G || t === B || t === FE) grassTile(g, x, y);
    else if (t === P) pathTile(g, x, y);
    else if (t === D) fieldTile(g, x, y);
    else if (t === PL) plazaTile(g, x, y);
    else if (t === SA) sandTile(g, x, y);
    else if (t === WA || t === K) waterTile(g, x, y, depth[y * W + x]);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map[y * W + x] === K) dockTile(g, x, y);

  // pond life
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = map[y * W + x];
    if (t === WA && depth[y * W + x] > .3 && hsh(x, y, 150) < .22) lotus(g, x * T + 8 + hsh(x, y, 151) * 16, y * T + 10 + hsh(x, y, 152) * 12, hsh(x, y, 153) < .45, x * 31 + y);
    if (t === SA && (at(x - 1, y) === WA || at(x + 1, y) === WA) && hsh(x, y, 154) < .55) reeds(g, x * T + 16, y * T + 26, x * 17 + y);
  }

  // decorative nature (drawn top to bottom so lower things overlap upper ones)
  const deco = [];
  for (let x = 0; x < W; x++) {
    if (at(x, 0) === G && !(x >= 19 && x <= 24)) deco.push({ y: .3, f: () => canopy(g, x * T + 16, 6, 17 + hsh(x, 0, 160) * 4, '#4f9e3d', '#3d8236', '#7cc95e') });
    if (at(x, H - 1) === G) deco.push({ y: H - .2, f: () => (hsh(x, H, 161) < .3 ? bamboo(g, x * T + 16, (H - 1) * T + 30, 4, x) : canopy(g, x * T + 16, (H - 1) * T + 22, 17 + hsh(x, H, 162) * 4, '#4a973b', '#387a33', '#76c25a')) });
  }
  for (let y = 1; y < H - 1; y++) {
    if (at(0, y) === G) deco.push({ y: y + .6, f: () => (hsh(0, y, 163) < .3 ? bamboo(g, 10, y * T + 26, 3, y) : canopy(g, 6, y * T + 20, 16 + hsh(0, y, 164) * 4, '#4f9e3d', '#3d8236', '#7cc95e')) });
    if (at(W - 1, y) === G) deco.push({ y: y + .6, f: () => (hsh(W, y, 165) < .3 ? bamboo(g, W * T - 12, y * T + 26, 3, y + 99) : canopy(g, W * T - 6, y * T + 20, 16 + hsh(W, y, 166) * 4, '#4a973b', '#387a33', '#76c25a')) });
  }
  // inner ring of bushes and scattered props
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const cx = x + .5, cy = y + .6, r = hsh(x, y, 170);
    if (!freeSpot(cx, cy, 0)) continue;
    const edge = x === 1 || y === 1 || x === W - 2 || y === H - 2;
    if (edge && r < .4) { deco.push({ y: cy, f: () => bush(g, cx * T, cy * T, 9 + hsh(x, y, 171) * 4, hsh(x, y, 172) < .4 ? pick(['#f19ab0', '#f6d65c', '#f7f1e8'], hsh(x, y, 173)) : null, x * 7 + y) }); continue; }
    if (!freeSpot(cx, cy, 1)) continue;
    if (r < .035) deco.push({ y: cy, f: () => rock(g, cx * T, cy * T, 5 + hsh(x, y, 174) * 4) });
    else if (r < .06) deco.push({ y: cy, f: () => bush(g, cx * T, cy * T, 8 + hsh(x, y, 175) * 3, null, x + y * 3) });
    else if (r < .085) deco.push({ y: cy, f: () => flowerPatch(g, cx * T, cy * T, x * 13 + y) });
    else if (r < .095) deco.push({ y: cy, f: () => mushroom(g, cx * T, cy * T) });
  }
  // set pieces
  deco.push({ y: 5.2, f: () => scarecrow(g, 12.6 * T, 5.2 * T) });
  deco.push({ y: 9.6, f: () => haystack(g, 12.7 * T, 9.6 * T) });
  deco.push({ y: 20.1, f: () => well(g, 41.4 * T, 20.1 * T) });
  for (const [x, y] of [[3.2, 13.55], [10.2, 13.55], [15.3, 13.55], [26.4, 13.55], [33.2, 13.55], [41.0, 16.7], [20.45, 6.6], [20.45, 11.4], [23.55, 19.4], [23.55, 26.6], [20.45, 25.6]]) {
    if (grassy(at(Math.floor(x), Math.floor(y)))) deco.push({ y, f: () => lantern(g, Math.round(x * T), Math.round(y * T)) });
  }
  deco.sort((a, b) => a.y - b.y).forEach((d) => d.f());

  fences(g);
  // buildings (on their B footprints)
  const butler = house(g, 14, 3, 19, 7, { roof: '#2f8f83', roofD: '#21675e', roofL: '#55b3a6', wall: '#efe3c8', wallD: 'rgba(120,95,60,.18)', trim: '#2f8f83', chimney: false });
  const ax = 17 * T;
  R(g, '#3a3a3a', ax - 1, 3 * T - 22, 3, 26); R(g, '#5a5a5a', ax - 1, 3 * T - 22, 1, 26);
  g.fillStyle = '#cfd6d4'; ell(g, ax + 9, 3 * T - 18, 7, 4); g.fillStyle = '#9aa4a2'; ell(g, ax + 9, 3 * T - 17, 4, 2); R(g, '#3a3a3a', ax + 1, 3 * T - 18, 8, 1);
  R(g, '#e8604a', ax - 3, 3 * T - 27, 7, 6);
  lights.push({ x: ax, y: 3 * T - 24, r: 30, kind: 'beacon', color: '#ff5a4a', i: .7 });
  const coop = house(g, 25, 19, 31, 23, { roof: '#b5523b', roofD: '#8d3d2b', roofL: '#d4745b', wall: '#f1e2bf', wallD: 'rgba(120,95,60,.18)', trim: '#7c3b2a', chimney: true });
  R(g, '#2b1d14', coop.dx - 32, coop.dy - 20, coop.dw + 64, 16); R(g, '#f2c14e', coop.dx - 32, coop.dy - 20, coop.dw + 64, 1);
  g.fillStyle = '#f2c14e'; g.font = '800 11px "Be Vietnam Pro", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('HỢP TÁC XÃ', coop.dx + coop.dw / 2, coop.dy - 12);
  const home = house(g, 34, 18, 38, 21, { roof: '#d9b45a', roofD: '#b18a33', roofL: '#ecd283', wall: '#e9d9b4', wallD: 'rgba(120,95,60,.18)', trim: '#5b8f3a', chimney: true });
  for (const fx of [home.X + 9, home.X + home.Wd - 19]) { g.fillStyle = '#3f7c33'; ell(g, fx + 5, home.Y + home.Ht - 4, 7, 4); R(g, '#f19ab0', fx + 2, home.Y + home.Ht - 8, 2, 2); R(g, '#f6d65c', fx + 7, home.Y + home.Ht - 7, 2, 2); }
  void butler;

  [[14, 18.2, '#e8604a'], [17.2, 18.2, '#3d8db4'], [14, 21.6, '#2f8f83'], [17.2, 21.6, '#e8604a']].forEach(([x, y, col], i) => stall(g, x, y, col, i));
  chimneys.push({ x: 16.5 * T, y: 24.3 * T, steam: true });
  gate(g);
  for (const z of ZONES) if (z.sx != null) sign(g, z.sx, z.sy, z.name);
  return c;
}

/* ---------------------------------------------------------------- sprites */
const OUT = '#2a1d14';
function farmer(g, x, y, o) {
  const X = Math.round(x * T), Y = Math.round(y * T), t = performance.now() / 1000;
  const m = !!o.moving, s = m ? Math.sin(o.walk) : 0;
  const bob = m ? Math.abs(Math.sin(o.walk)) * 1.6 : (Math.sin(t * 2.1 + x * 3) > .2 ? .6 : 0);
  const dir = o.dir < 0 ? -1 : 1;
  g.fillStyle = 'rgba(0,0,0,.28)'; ell(g, X, Y, 10, 3.6);
  // legs
  const ll = s > 0 ? 2 : 0, rl = s < 0 ? 2 : 0;
  R(g, OUT, X - 7, Y - 9 - ll, 6, 9 + ll); R(g, OUT, X + 1, Y - 9 - rl, 6, 9 + rl);
  R(g, '#3b2c22', X - 6, Y - 8 - ll, 4, 6 + ll); R(g, '#3b2c22', X + 2, Y - 8 - rl, 4, 6 + rl);
  R(g, '#20160f', X - 6, Y - 2 - ll, 4, 2); R(g, '#20160f', X + 2, Y - 2 - rl, 4, 2);
  // body
  const by = Math.round(Y - 22 - bob);
  R(g, OUT, X - 9, by - 1, 18, 15);
  R(g, o.shirt, X - 8, by, 16, 13);
  R(g, 'rgba(255,255,255,.2)', X - 8, by, 16, 2);
  R(g, 'rgba(0,0,0,.2)', X - 8, by + 10, 16, 3);
  R(g, 'rgba(0,0,0,.25)', X - 1, by + 2, 2, 8);
  // arms
  const as = Math.round(s * 2);
  R(g, OUT, X - 12, by + 1 + as, 5, 10); R(g, OUT, X + 7, by + 1 - as, 5, 10);
  R(g, o.shirt, X - 11, by + 2 + as, 3, 5); R(g, o.shirt, X + 8, by + 2 - as, 3, 5);
  R(g, '#f1c69b', X - 11, by + 7 + as, 3, 3); R(g, '#f1c69b', X + 8, by + 7 - as, 3, 3);
  // head
  const hy = by - 5;
  g.fillStyle = OUT; ell(g, X, hy, 7.5, 7);
  g.fillStyle = '#f1c69b'; ell(g, X, hy, 6.4, 6);
  g.fillStyle = '#ffb3a0'; ell(g, X + dir * 4, hy + 2, 1.6, 1);
  const blink = !m && (t * 1000 + x * 997) % 3600 < 130;
  R(g, '#2b1d14', X + dir * 2 - 1, hy - (blink ? 0 : 1), 2, blink ? 1 : 2);
  // nón lá
  const ty = hy - 2;
  g.fillStyle = OUT; g.beginPath(); g.moveTo(X - 15, ty + 1); g.lineTo(X + 15, ty + 1); g.lineTo(X, ty - 14); g.closePath(); g.fill();
  g.fillStyle = '#ecd79c'; g.beginPath(); g.moveTo(X - 13, ty); g.lineTo(X + 13, ty); g.lineTo(X, ty - 12); g.closePath(); g.fill();
  g.fillStyle = '#d4bb78'; g.beginPath(); g.moveTo(X, ty - 12); g.lineTo(X + 13, ty); g.lineTo(X + 5, ty); g.closePath(); g.fill();
  R(g, '#c4a25c', X - 9, ty - 4, 18, 1); R(g, '#c4a25c', X - 5, ty - 8, 10, 1);
  R(g, '#fff1c4', X - 6, ty - 6, 3, 1);
  R(g, '#a07c3a', X - 13, ty, 26, 1);
  if (o.antenna) {
    R(g, '#3a3a3a', X - 1, ty - 20, 2, 8);
    g.fillStyle = (performance.now() % 900 < 450) ? '#e8604a' : '#f2c14e'; ell(g, X, ty - 21, 2.6, 2.6);
  }
}

function lettuce(g, x, y, s) {
  const X = Math.round(x * T), Y = Math.round(y * T);
  g.fillStyle = '#4f2f16'; ell(g, X, Y + 5, 12, 5);
  g.fillStyle = '#6b4226'; ell(g, X, Y + 4, 11, 4.4);
  R(g, '#8c5a35', X - 6, Y + 2, 6, 1);
  if (s <= 0) { R(g, '#5fae4c', X - 3, Y - 1, 2, 5); R(g, '#9be07f', X - 3, Y - 2, 2, 2); R(g, '#5fae4c', X + 2, Y - 2, 2, 6); R(g, '#9be07f', X + 2, Y - 3, 2, 2); return; }
  const r = 3 + s * 1.9, n = 5 + s;
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU;
    g.fillStyle = '#2f6a2a'; ell(g, X + Math.cos(a) * r * .62, Y + Math.sin(a) * r * .36, r * .62 + .8, r * .5 + .8);
  }
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU;
    g.fillStyle = k % 2 ? '#5fae4c' : '#78c461'; ell(g, X + Math.cos(a) * r * .6, Y - 1 + Math.sin(a) * r * .34, r * .6, r * .48);
  }
  g.fillStyle = '#a6e08c'; ell(g, X, Y - 2, r * .45, r * .34);
  if (s >= 3) { g.fillStyle = '#d4f5bf'; ell(g, X - 1, Y - 3, r * .2, r * .14); }
}

function tree(g, x, y, l) {
  const X = Math.round(x * T), Y = Math.round(y * T), t = performance.now() / 1000;
  if (!l) {
    g.fillStyle = '#5a361b'; ell(g, X, Y + 1, 10, 4); g.fillStyle = '#7a4f2c'; ell(g, X, Y, 8, 3);
    R(g, '#8b5c34', X + 7, Y - 12, 2, 13); R(g, '#e9d9b4', X + 3, Y - 13, 9, 5); R(g, '#8b5c34', X + 3, Y - 13, 9, 1);
    return;
  }
  const pr = Math.max(0, Math.min(1, (F.st.day - l.start) / l.days)), ripe = F.ripe(l);
  const sz = .38 + .62 * pr, sway = Math.sin(t * 1.3 + l.id * 1.7) * 1.4 * sz;
  g.fillStyle = 'rgba(25,45,20,.28)'; ell(g, X + 4, Y + 2, 17 * sz + 4, 5);
  if (l.days === 7) {
    // chili bush
    const r = 13 * sz;
    R(g, '#5b3a1d', X - 1, Y - 6 * sz, 3, 6 * sz);
    g.fillStyle = '#1f3a1c'; ell(g, X + sway, Y - 9 * sz, r + 1.5, r * .8 + 1.5);
    g.fillStyle = '#3f8a35'; ell(g, X + sway, Y - 9 * sz, r, r * .8);
    g.fillStyle = '#5fae4c'; ell(g, X - 3 + sway, Y - 12 * sz, r * .6, r * .45);
    const n = ripe ? 8 : pr > .7 ? Math.floor((pr - .7) / .3 * 5) : 0;
    for (let k = 0; k < n; k++) {
      const a = k * 2.3 + l.id, fx = X + sway + Math.cos(a) * r * .65, fy = Y - 9 * sz + Math.sin(a) * r * .45;
      R(g, '#7a1d12', fx - 1, fy - 3, 3, 7); R(g, '#e2442f', fx - 1, fy - 3, 2, 6); R(g, '#4f9e3d', fx - 1, fy - 4, 2, 1);
    }
    return;
  }
  const mango = l.days === 30;
  const th = (mango ? 20 : 26) * sz, r = (mango ? 17 : 19) * sz;
  R(g, '#3f2812', X - 3, Y - th, 6, th); R(g, '#6b4226', X - 2, Y - th, 3, th); R(g, '#8b5c34', X - 2, Y - th, 1, th);
  const cx = X + sway, cy = Y - th - r * .3;
  const [c1, c2, c3] = mango ? ['#3e8f39', '#2f7432', '#62b04e'] : ['#2f7a3a', '#245f2d', '#4f9a4a'];
  g.fillStyle = '#16301a'; ell(g, cx, cy, r + 1.5, r * .82 + 1.5); ell(g, cx - r * .6, cy + r * .35, r * .55 + 1.5, r * .48 + 1.5); ell(g, cx + r * .6, cy + r * .35, r * .55 + 1.5, r * .48 + 1.5);
  g.fillStyle = c2; ell(g, cx, cy, r, r * .82); ell(g, cx - r * .6, cy + r * .35, r * .55, r * .48); ell(g, cx + r * .6, cy + r * .35, r * .55, r * .48);
  g.fillStyle = c1; ell(g, cx - r * .12, cy - r * .15, r * .78, r * .62);
  g.fillStyle = c3; ell(g, cx - r * .35, cy - r * .45, r * .4, r * .26);
  const n = ripe ? 7 : pr > .7 ? Math.floor((pr - .7) / .3 * 4) : 0;
  for (let k = 0; k < n; k++) {
    const a = k * 2.1 + l.id, fx = cx + Math.cos(a) * r * .62, fy = cy + r * .1 + Math.sin(a) * r * .45;
    if (mango) { g.fillStyle = '#9a5a12'; ell(g, fx + .5, fy + .5, 3.4, 4.4); g.fillStyle = '#f2b33d'; ell(g, fx, fy, 3, 4); R(g, '#ffe08a', fx - 1, fy - 2, 1, 2); }
    else { g.fillStyle = '#5f6a14'; ell(g, fx, fy, 5, 5); g.fillStyle = '#b5c43c'; ell(g, fx, fy, 4.2, 4.2); for (let q = 0; q < 6; q++) { const b = q / 6 * TAU; R(g, '#6f7a1a', Math.round(fx + Math.cos(b) * 4), Math.round(fy + Math.sin(b) * 4), 1, 1); } }
  }
}

/* ---------------------------------------------------------------- install */
window.FarmArt = { buildStatic, lights, chimneys, version: 1 };
F.SPR.farmer = farmer;
F.SPR.lettuce = lettuce;
F.SPR.tree = tree;
try { F.rebuildStatic(); } catch (e) { console.error('[art.js] rebuild', e); }
try { (document.fonts && document.fonts.ready || Promise.resolve()).then(() => { try { F.rebuildStatic(); } catch (e) { console.error('[art.js] rebuild', e); } }); } catch (e) { /* ignore */ }
})();
