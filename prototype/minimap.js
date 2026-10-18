/* Nông Trại DeFi · minimap plugin.
   A lacquered-wood minimap docked in a corner of the stage, plus a full village map overlay.
   Talks only to window.FARM (see the bottom of index.html). Static layers (downscaled ground,
   zone badges, labels) are cached in offscreen canvases; the live layer (player, butler, letters,
   camera, day/night, weather) redraws at ~18 fps from FARM's 'frame' hook and immediately on
   interaction. Placement is measured against the panel, log, hint and prompt so it never covers them. */
(function () {
  'use strict';
  var F = window.FARM;
  if (!F || !F.stage || typeof F.on !== 'function' || F.minimap) return;

  var doc = document, win = window;
  var T = F.T || 32, W = F.W || 46, H = F.H || 30, TAU = Math.PI * 2;
  var ZONES = F.ZONES || [], Z = F.Z || {};
  var st = F.st || {}, player = F.player || { x: 0, y: 0, dir: 1 }, butler = F.butler || { x: 0, y: 0 };
  var cam = F.cam || { x: 0, y: 0 };
  var REDUCE = !!F.reduce;
  var LS_KEY = 'nongtrai.minimap.collapsed';
  var MINI_DT = 1 / 18, BIG_DT = 1 / 24, POLL_DT = 0.6;
  var NODASH = [];

  /* ---------- helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mk(w, h) { var c = doc.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
  function el(tag, cls, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function attr(e, o) { for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) e.setAttribute(k, o[k]); return e; }
  function nowSec() { return (win.performance && performance.now ? performance.now() : Date.now()) / 1000; }
  function dprNow() { var d = +F.dpr; if (!(d > 0)) d = Math.min(2, win.devicePixelRatio || 1); return d; }
  var mq = null; try { mq = win.matchMedia ? win.matchMedia('(max-width: 760px)') : null; } catch (e) { mq = null; }
  function isPhone() { return mq ? !!mq.matches : (win.innerWidth || 1024) <= 760; }
  function smooth(g) { g.imageSmoothingEnabled = true; try { g.imageSmoothingQuality = 'high'; } catch (e) { /* older engines */ } }
  function rr(g, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  function ellF(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill(); }
  function poly(g, p) { g.beginPath(); g.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }
  function frac(v) { return v - Math.floor(v); }
  /* time of day: frac(st.day) 0 = midnight, .5 = noon (same in sim and on-chain mode) */
  function sunHeight() { var d = +st.day; if (!isFinite(d)) d = 0.5; return -Math.cos(TAU * frac(d)); }
  function nightAmt() { var v = clamp((0.12 - sunHeight()) / 0.5, 0, 1); return v * v * (3 - 2 * v); }
  function duskAmt() { var v = 1 - Math.abs(sunHeight() + 0.02) / 0.32; return v > 0 ? v : 0; }
  function isTyping(e) {
    var t = e && e.target; if (!t) return false;
    if (t.isContentEditable) return true;
    var n = t.tagName; return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT';
  }
  function focusEl(e) { try { if (e && e.focus) e.focus({ preventScroll: true }); } catch (_) { try { e.focus(); } catch (__) { /* ignore */ } } }

  /* ---------- zone geometry ---------- */
  var ZI = [], ZIX = {};
  (function () {
    for (var i = 0; i < ZONES.length; i++) {
      var z = ZONES[i], a = z.area || [z.ax - 1, z.ay - 1, z.ax + 1, z.ay + 1];
      var p = { z: z, id: z.id, i: i, x: clamp((a[0] + a[2]) / 2, 0.9, W - 0.9), y: clamp((a[1] + a[3]) / 2, 0.9, H - 0.9) };
      ZI.push(p); ZIX[z.id] = p;
    }
  })();
  function zoneAt(x, y) {
    for (var i = 0; i < ZONES.length; i++) {
      var a = ZONES[i].area;
      if (a && x >= a[0] && x <= a[2] && y >= a[1] && y <= a[3]) return ZONES[i];
    }
    return null;
  }
  /* warm window / lantern lights that come on at night (tile coords, strength) */
  var LIGHTS = [
    [35.2, 21.3, 1], [37.8, 21.3, 1],
    [26.2, 22.4, .9], [30.8, 22.4, .9],
    [15.2, 6.4, .9], [18.8, 6.4, .9],
    [20.5, 1.9, .8], [23.5, 1.9, .8],
    [15.4, 18.6, .7], [18.6, 18.6, .7], [15.4, 22, .7], [18.6, 22, .7],
    [7.5, 17.4, .55]
  ];

  /* ---------- zone icons (drawn on a 26-unit badge, icon art within about ±9 units) ---------- */
  var ICON = {
    home: function (g) {
      g.fillStyle = '#7a4f2c'; g.fillRect(3.2, -7.2, 2.2, 4);
      g.fillStyle = '#f3e6c6'; g.fillRect(-6.2, -1, 12.4, 8);
      g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(-6.2, 5.6, 12.4, 1.4);
      g.fillStyle = '#e2b84f'; poly(g, [-8.8, 0.2, 0, -7.8, 8.8, 0.2]);
      g.fillStyle = 'rgba(255,255,255,.28)'; poly(g, [-8.8, 0.2, 0, -7.8, 0, -5.8, -6.2, 0.2]);
      g.fillStyle = '#a8822f'; g.fillRect(-8.8, -0.4, 17.6, 1.3);
      g.fillStyle = '#6b3f1f'; g.fillRect(-1.7, 2, 3.4, 5);
      g.fillStyle = '#f2c14e'; g.fillRect(0.7, 4.2, 0.8, 0.8);
      g.fillStyle = '#8fd0e4'; g.fillRect(-5.1, 1.4, 2.6, 2.4); g.fillRect(2.5, 1.4, 2.6, 2.4);
    },
    lend: function (g) {
      g.fillStyle = '#5b3920'; ellF(g, 0, 6.2, 7.6, 2.1);
      g.fillStyle = '#4f9a3f'; circ(g, -4.3, 1.8, 3.8); circ(g, 4.3, 1.8, 3.8);
      g.fillStyle = '#5fae4c'; circ(g, -2.3, -1.7, 4.1); circ(g, 2.4, -1.6, 4.1);
      g.fillStyle = '#7cc964'; circ(g, 0, 0.8, 4.3);
      g.fillStyle = '#b4ea98'; circ(g, -0.7, -0.2, 2);
      g.strokeStyle = 'rgba(47,100,40,.85)'; g.lineWidth = 0.7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 4.6); g.lineTo(0, -1.4); g.moveTo(0, 2.6); g.lineTo(-2, 0.6); g.moveTo(0, 2.2); g.lineTo(2, 0.2); g.stroke();
    },
    orchard: function (g) {
      g.fillStyle = 'rgba(0,0,0,.3)'; ellF(g, 0, 7.3, 5.8, 1.5);
      g.fillStyle = '#6b4226'; g.fillRect(-1.4, 1.6, 2.8, 5.8);
      g.fillStyle = '#3d8a36'; circ(g, 0, -2.4, 6.1);
      g.fillStyle = '#4f9e3d'; circ(g, -4.4, 0.6, 3.8); circ(g, 4.4, 0.6, 3.8);
      g.fillStyle = '#6dbb55'; circ(g, -1.8, -4.4, 2.6);
      g.fillStyle = '#e8604a'; circ(g, 3.1, -3.2, 1.35); circ(g, -3.6, 0.9, 1.3);
      g.fillStyle = '#f2c14e'; circ(g, 1.2, 1, 1.25);
    },
    pond: function (g) {
      g.strokeStyle = '#6cbde0'; g.lineWidth = 1.1; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-7.2, 6.4); g.quadraticCurveTo(-5.4, 5, -3.6, 6.4); g.quadraticCurveTo(-1.8, 7.8, 0, 6.4);
      g.quadraticCurveTo(1.8, 5, 3.6, 6.4); g.quadraticCurveTo(5.4, 7.8, 7.2, 6.4); g.stroke();
      g.fillStyle = '#d0662a'; poly(g, [3.4, -0.9, 8.6, -4.6, 7.4, -0.9, 8.6, 2.8]);
      g.fillStyle = '#d0662a'; poly(g, [-1.6, -4, 1.4, -6.2, 2.4, -3.4]);
      g.fillStyle = '#f0883e'; ellF(g, -0.8, -0.9, 5.9, 3.6);
      g.fillStyle = '#fbeedb'; ellF(g, 0.6, -0.4, 1.9, 1.5);
      g.fillStyle = 'rgba(255,255,255,.35)'; ellF(g, -2, -2.1, 2.8, 1);
      g.fillStyle = '#0f1814'; circ(g, -4, -1.3, 0.85);
    },
    market: function (g) {
      g.fillStyle = '#7c522b'; g.fillRect(-7.2, -2, 1.6, 9); g.fillRect(5.6, -2, 1.6, 9);
      g.fillStyle = '#9b6a3c'; g.fillRect(-8, 2.8, 16, 4);
      g.fillStyle = '#7c522b'; g.fillRect(-8, 5.8, 16, 1.2);
      g.fillStyle = '#f2c14e'; circ(g, -4.4, 2.6, 1.6);
      g.fillStyle = '#86d36f'; circ(g, -0.9, 2.4, 1.7);
      g.fillStyle = '#e8604a'; circ(g, 2.6, 2.6, 1.6);
      g.fillStyle = '#f6efe0'; circ(g, 5.4, 2.7, 1.3);
      var sw = 17 / 6;
      for (var k = 0; k < 6; k++) {
        g.fillStyle = k % 2 ? '#f6efe0' : '#e8604a';
        g.fillRect(-8.5 + k * sw, -7.4, sw + 0.05, 4.5);
        g.beginPath(); g.arc(-8.5 + k * sw + sw / 2, -2.95, sw / 2, 0, Math.PI); g.fill();
      }
      g.fillStyle = '#b5523b'; g.fillRect(-9, -8.4, 18, 1.4);
    },
    coop: function (g) {
      g.fillStyle = '#f1e2bf'; g.fillRect(-7, -1.5, 14, 8.5);
      g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(-7, 5.6, 14, 1.4);
      g.fillStyle = '#b5523b'; poly(g, [-9, -0.5, 0, -8, 9, -0.5]);
      g.fillStyle = 'rgba(255,255,255,.2)'; poly(g, [-9, -0.5, 0, -8, 0, -6, -6.6, -0.5]);
      g.fillStyle = '#93402e'; g.fillRect(-9, -1.2, 18, 1.4);
      g.fillStyle = '#7c3b2a'; g.fillRect(-3.2, 1.2, 6.4, 5.8);
      g.strokeStyle = '#f1e2bf'; g.lineWidth = 0.9;
      g.beginPath(); g.moveTo(-3.2, 1.2); g.lineTo(3.2, 7); g.moveTo(3.2, 1.2); g.lineTo(-3.2, 7); g.stroke();
      g.fillStyle = '#2b1d14'; circ(g, 0, -3.6, 1.4);
      g.fillStyle = '#f2c14e'; circ(g, 0, -3.6, 0.55);
    },
    butler: function (g) {
      g.strokeStyle = '#cfd8d3'; g.lineWidth = 1.1; g.beginPath(); g.moveTo(0, -4.6); g.lineTo(0, -8); g.stroke();
      g.fillStyle = '#e8604a'; circ(g, 0, -8.4, 1.6);
      g.fillStyle = '#25756b'; g.fillRect(-8, -1.2, 1.8, 4); g.fillRect(6.2, -1.2, 1.8, 4);
      g.fillStyle = '#25756b'; g.fillRect(-3.5, 5.6, 7, 2.4);
      g.fillStyle = '#2f8f83'; rr(g, -6.4, -4.8, 12.8, 10.6, 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(-4.8, -4.2, 9.6, 1.1);
      g.fillStyle = '#0f1814'; rr(g, -4.6, -2.2, 9.2, 5.4, 1.8); g.fill();
      g.fillStyle = '#86f0e0'; circ(g, -2.1, 0.3, 1.2); circ(g, 2.1, 0.3, 1.2);
      g.fillRect(-1.4, 2, 2.8, 0.6);
    },
    neighbor: function (g) {
      g.fillStyle = '#7b5ea7'; rr(g, -5.6, 4.6, 11.2, 4.4, 2); g.fill();
      g.fillStyle = '#f0c597'; circ(g, 0, 2, 3.4);
      g.fillStyle = '#2b1d14'; circ(g, -1.2, 2.3, 0.5); circ(g, 1.2, 2.3, 0.5);
      g.fillStyle = '#e9d39a'; poly(g, [-9.2, -0.6, 0, -8.6, 9.2, -0.6]);
      g.fillStyle = 'rgba(255,255,255,.3)'; poly(g, [-9.2, -0.6, 0, -8.6, -1, -6.4, -6.6, -0.6]);
      g.fillStyle = '#c4a25c'; g.fillRect(-9.2, -1.1, 18.4, 1.2);
      g.strokeStyle = 'rgba(140,110,50,.7)'; g.lineWidth = 0.6;
      g.beginPath(); g.moveTo(0, -8.6); g.lineTo(-4.4, -1); g.moveTo(0, -8.6); g.lineTo(4.4, -1); g.stroke();
      g.strokeStyle = '#8a6a3a'; g.beginPath(); g.moveTo(-3.1, -0.4); g.lineTo(-1.2, 5); g.moveTo(3.1, -0.4); g.lineTo(1.2, 5); g.stroke();
    },
    gate: function (g) {
      g.fillStyle = 'rgba(0,0,0,.28)'; ellF(g, 0, 7.6, 8, 1.4);
      g.fillStyle = '#e6d8b4'; g.fillRect(-7.6, -3, 3.2, 10.4); g.fillRect(4.4, -3, 3.2, 10.4);
      g.fillStyle = '#a8977a'; g.fillRect(-7.6, 5.8, 3.2, 1.6); g.fillRect(4.4, 5.8, 3.2, 1.6);
      g.fillStyle = '#7c3b2a'; poly(g, [-9.6, -3.2, 9.6, -3.2, 7.8, -6.6, -7.8, -6.6]);
      poly(g, [-9.6, -3.2, -10.6, -6.6, -8, -4.8]); poly(g, [9.6, -3.2, 10.6, -6.6, 8, -4.8]);
      g.fillStyle = '#5f2b1e'; g.fillRect(-9, -3.7, 18, 1); g.fillRect(-6.6, -7.6, 13.2, 1.2);
      g.fillStyle = '#2b1d14'; g.fillRect(-3.4, -2, 6.8, 2.8);
      g.fillStyle = '#f2c14e'; g.fillRect(-2.4, -1.1, 4.8, 1);
    }
  };
  function iconFallback(g) { g.fillStyle = '#f2c14e'; circ(g, 0, 0, 4.5); g.fillStyle = '#1c2a23'; circ(g, 0, 0, 2); }
  function badge(g, cx, cy, u, hot) {
    g.fillStyle = 'rgba(0,0,0,.42)'; ellF(g, cx, cy + 1.7 * u, 11 * u, 10.6 * u);
    var gr = g.createRadialGradient(cx - 3.5 * u, cy - 4.5 * u, u, cx, cy, 12 * u);
    gr.addColorStop(0, hot ? '#4d6644' : '#37503f'); gr.addColorStop(1, hot ? '#1f2f20' : '#14201a');
    g.fillStyle = gr; circ(g, cx, cy, 11 * u);
    g.lineWidth = (hot ? 2.1 : 1.5) * u; g.strokeStyle = hot ? '#ffd76a' : 'rgba(242,193,78,.92)';
    g.beginPath(); g.arc(cx, cy, (hot ? 10.5 : 10.75) * u, 0, TAU); g.stroke();
    g.lineWidth = 0.8 * u; g.strokeStyle = 'rgba(255,240,200,.18)';
    g.beginPath(); g.arc(cx, cy, 9.2 * u, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
  }
  function drawIcon(g, id, cx, cy, u, hot) {
    if (hot) {
      g.save(); g.shadowColor = 'rgba(255,214,106,.95)'; g.shadowBlur = 7 * u;
      g.fillStyle = 'rgba(255,214,106,.55)'; circ(g, cx, cy, 11 * u); g.restore();
    }
    badge(g, cx, cy, u, hot);
    g.save(); g.translate(cx, cy); g.scale(u, u); g.lineCap = 'butt';
    try { (ICON[id] || iconFallback)(g); } catch (e) { /* keep the badge */ }
    g.restore();
  }
  function iconSprite(id, S, hot) {
    var A = hot ? Math.round(S * 1.7) : S, c = mk(A, A), g = c.getContext('2d');
    drawIcon(g, id, A / 2, A / 2, (S / 26) * (hot ? 1.14 : 1), hot);
    return c;
  }
  function glowSprite(R) {
    var c = mk(R * 2, R * 2), g = c.getContext('2d'), gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0, 'rgba(255,222,140,.95)'); gr.addColorStop(0.3, 'rgba(255,184,84,.5)'); gr.addColorStop(1, 'rgba(255,150,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2); return c;
  }
  function dotSprite(D) {
    var r = D / 2, c = mk(D, D), g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, '#fffbe8'); gr.addColorStop(0.32, '#f6cf63'); gr.addColorStop(0.6, 'rgba(242,193,78,.42)'); gr.addColorStop(1, 'rgba(242,193,78,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D); return c;
  }
  function compass(g, x, y, k) {
    var r = 15 * k;
    g.fillStyle = 'rgba(0,0,0,.3)'; circ(g, x, y + 1.5 * k, r);
    g.fillStyle = 'rgba(17,27,22,.85)'; circ(g, x, y, r);
    g.lineWidth = k; g.strokeStyle = 'rgba(242,193,78,.7)'; g.beginPath(); g.arc(x, y, r - 0.5 * k, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(242,193,78,.35)'; g.beginPath();
    g.moveTo(x - r + 3 * k, y); g.lineTo(x - r + 6 * k, y); g.moveTo(x + r - 3 * k, y); g.lineTo(x + r - 6 * k, y); g.stroke();
    g.fillStyle = '#e8604a'; poly(g, [x, y - 11 * k, x + 3.4 * k, y, x - 3.4 * k, y]);
    g.fillStyle = '#f3ecd9'; poly(g, [x, y + 11 * k, x + 3.4 * k, y, x - 3.4 * k, y]);
    g.fillStyle = '#1c2a23'; circ(g, x, y, 1.6 * k);
    g.font = '800 ' + (11 * k).toFixed(1) + 'px "Baloo 2", system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 3 * k; g.strokeStyle = 'rgba(15,24,20,.85)'; g.strokeText('B', x, y - r - 6 * k);
    g.fillStyle = '#f2c14e'; g.fillText('B', x, y - r - 6 * k); /* B = Bắc (north) */
  }

  /* ---------- cached layers ---------- */
  var TILE_COL = ['#69aa4b', '#d2ab6e', '#3d8db4', '#8c5b37', '#8b5c34', '#b98e5a', '#c2bba8', '#e3cd93', '#a8723f'];
  function sized(c, w, h) { if (!c) return mk(w, h); if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; return c; }
  function buildBase(w, h, big) {
    var c = mk(w, h), g = c.getContext('2d');
    var src = F.staticCanvas;
    if (src && src.width > 0 && src.height > 0) {
      /* halve step by step for a clean downscale instead of one aliased jump */
      var cur = src, cw = src.width, ch = src.height, flip = false, sA = null, sB = null;
      while (cw > w * 2.2 && ch > h * 2.2) {
        var nw = Math.max(w, Math.round(cw / 2)), nh = Math.max(h, Math.round(ch / 2));
        var tmp = flip ? (sB = sized(sB, nw, nh)) : (sA = sized(sA, nw, nh));
        var tg = tmp.getContext('2d');
        tg.setTransform(1, 0, 0, 1, 0, 0); tg.clearRect(0, 0, nw, nh); smooth(tg);
        tg.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
        cur = tmp; cw = nw; ch = nh; flip = !flip;
      }
      smooth(g);
      var hasFilter = 'filter' in g;
      if (hasFilter) g.filter = big ? 'saturate(1.1) contrast(1.04)' : 'saturate(1.18) contrast(1.06) brightness(1.03)';
      g.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
      if (hasFilter) g.filter = 'none';
    } else {
      var map = F.map;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var t = map ? map[y * W + x] : 0, x0 = Math.floor(x * w / W), y0 = Math.floor(y * h / H);
        g.fillStyle = TILE_COL[t] || TILE_COL[0];
        g.fillRect(x0, y0, Math.floor((x + 1) * w / W) - x0, Math.floor((y + 1) * h / H) - y0);
      }
    }
    /* a soft top-left light and a vignette make the downscaled ground read like a printed map card */
    var lg = g.createLinearGradient(0, 0, w, h);
    lg.addColorStop(0, 'rgba(255,244,214,.12)'); lg.addColorStop(0.45, 'rgba(255,244,214,0)'); lg.addColorStop(1, 'rgba(10,16,12,.16)');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    var R = Math.sqrt(w * w + h * h) / 2, vg = g.createRadialGradient(w / 2, h / 2, R * 0.45, w / 2, h / 2, R);
    vg.addColorStop(0, 'rgba(8,14,10,0)'); vg.addColorStop(1, big ? 'rgba(8,14,10,.3)' : 'rgba(8,14,10,.42)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    return c;
  }

  function View(big) {
    this.big = big; this.cv = null; this.g = null;
    this.cssW = 0; this.cssH = 0; this.k = 1; this.w = 0; this.h = 0; this.sx = 1; this.sy = 1;
    this.base = null; this.marks = null; this.ico = {}; this.icoA = {}; this.S = 8; this.A = 14;
    this.glow = null; this.glowR = 4; this.dot = null; this.D = 6;
    this.ix = []; this.iy = []; this.labels = [];
    this.dash = [3, 3]; this.dash2 = [3, 3]; this.youW = 0; this.youFont = '800 10px sans-serif';
    this.hover = null; this.dirty = true; this.stale = true; this.src = null;
  }
  function buildMarks(V) {
    var c = mk(V.w, V.h), g = c.getContext('2d'), k = V.k, S = V.S, i;
    for (i = 0; i < ZI.length; i++) g.drawImage(V.ico[ZI[i].id], Math.round(V.ix[i] - S / 2), Math.round(V.iy[i] - S / 2));
    if (V.big) {
      g.font = '700 ' + (12 * k).toFixed(1) + 'px "Be Vietnam Pro", system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (i = 0; i < ZI.length; i++) {
        var name = ZI[i].z.name || ZI[i].id, tw = g.measureText(name).width, pw = tw + 16 * k, ph = 20 * k;
        var lx = clamp(V.ix[i], pw / 2 + 3 * k, V.w - pw / 2 - 3 * k), ly = V.iy[i] + S / 2 + 3 * k + ph / 2;
        if (ly + ph / 2 > V.h - 3 * k) ly = V.iy[i] - S / 2 - 3 * k - ph / 2;
        var L = V.labels[i]; L.x = lx - pw / 2; L.y = ly - ph / 2; L.w = pw; L.h = ph;
        g.fillStyle = 'rgba(0,0,0,.35)'; rr(g, L.x, L.y + 1.5 * k, pw, ph, ph / 2); g.fill();
        g.fillStyle = 'rgba(17,27,22,.92)'; rr(g, L.x, L.y, pw, ph, ph / 2); g.fill();
        g.lineWidth = k; g.strokeStyle = 'rgba(242,193,78,.62)'; rr(g, L.x + 0.5 * k, L.y + 0.5 * k, pw - k, ph - k, ph / 2); g.stroke();
        g.fillStyle = '#f6eedb'; g.fillText(name, lx, ly + 0.5 * k);
      }
      compass(g, V.w - 28 * k, V.h - 26 * k, k);
      V.youFont = '800 ' + (10.5 * k).toFixed(1) + 'px "Be Vietnam Pro", system-ui, sans-serif';
      g.font = V.youFont;
      V.youW = g.measureText('Bạn').width + 12 * k;
    }
    return c;
  }
  function buildView(V) {
    V.src = F.staticCanvas; V.stale = false;
    var k = V.k, i;
    V.base = buildBase(V.w, V.h, V.big);
    var css = V.big ? 26 : (V.cssW < 140 ? 11 : 15);
    V.S = Math.max(8, Math.round(css * k)); V.A = Math.round(V.S * 1.7);
    V.ico = {}; V.icoA = {};
    for (i = 0; i < ZI.length; i++) { V.ico[ZI[i].id] = iconSprite(ZI[i].id, V.S, false); V.icoA[ZI[i].id] = iconSprite(ZI[i].id, V.S, true); }
    V.ix.length = 0; V.iy.length = 0; V.labels.length = 0;
    var m = V.S / 2 + k;
    for (i = 0; i < ZI.length; i++) {
      V.ix.push(clamp(ZI[i].x * V.sx, m, V.w - m)); V.iy.push(clamp(ZI[i].y * V.sy, m, V.h - m));
      V.labels.push({ x: -1e4, y: -1e4, w: 0, h: 0 });
    }
    V.glowR = Math.max(4, Math.round(1.5 * V.sx)); V.glow = glowSprite(V.glowR);
    V.D = Math.max(5, Math.round((V.big ? 11 : 7) * k)); V.dot = dotSprite(V.D);
    V.dash = [3 * k, 2.5 * k]; V.dash2 = [2.5 * k, 3 * k];
    V.marks = buildMarks(V);
    V.dirty = true;
  }
  function sizeView(V, cssW, cssH) {
    var k = dprNow(), w = Math.max(1, Math.round(cssW * k)), h = Math.max(1, Math.round(cssH * k));
    if (!V.stale && V.w === w && V.h === h && V.k === k && V.src === F.staticCanvas) return;
    V.cssW = cssW; V.cssH = cssH; V.k = k; V.w = w; V.h = h;
    if (V.cv.width !== w) V.cv.width = w;
    if (V.cv.height !== h) V.cv.height = h;
    V.sx = w / W; V.sy = h / H;
    buildView(V);
  }

  /* ---------- live layer ---------- */
  var NOW = nowSec();
  var heading = (player.dir || 1) < 0 ? Math.PI : 0, hx = +player.x || 0, hy = +player.y || 0;
  var PINGS = [];
  for (var pi = 0; pi < 8; pi++) PINGS.push({ on: false, x: 0, y: 0, t0: 0, c: 0 });
  var PING_COL = ['#f2c14e', '#fff7e6', '#86d36f'];
  var miniV = new View(false), bigV = new View(true);

  function ping(x, y, c) {
    if (REDUCE || !(isFinite(x) && isFinite(y))) return;
    var best = PINGS[0];
    for (var i = 0; i < PINGS.length; i++) { var p = PINGS[i]; if (!p.on) { best = p; break; } if (p.t0 < best.t0) best = p; }
    best.on = true; best.x = x; best.y = y; best.t0 = NOW; best.c = c | 0;
    miniV.dirty = true; bigV.dirty = true;
  }
  function trackPlayer() {
    var x = +player.x, y = +player.y; if (!isFinite(x) || !isFinite(y)) return;
    var dx = x - hx, dy = y - hy; hx = x; hy = y;
    if (dx * dx + dy * dy > 1e-6 && dx * dx + dy * dy < 4) {
      var d = Math.atan2(dy, dx) - heading;
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      heading += d * 0.35;
    }
  }
  function curZoneId() { var c = F.current; return c && ZIX[c] ? c : null; }
  function nearZoneId() { var n = F.near; return n && ZIX[n.id] ? n.id : null; }

  function drawLife(V, t) {
    var g = V.g, sx = V.sx, sy = V.sy, k = V.k, big = V.big, i, x, y;
    var BEDS = F.BEDS || [], SPOTS = F.SPOTS || [], NB = F.NBEDS || [];
    var q = Math.max(1, Math.round(sx * (big ? 0.5 : 0.46))), q2 = Math.max(1, Math.round(q * 0.6)), q3 = Math.max(1, Math.round(q * 0.42));
    var lp = (st.lend && +st.lend.p) || 0, beds = Math.min(BEDS.length, Math.ceil(lp / 40));
    for (i = 0; i < BEDS.length; i++) {
      x = Math.round(BEDS[i][0] * sx - q / 2); y = Math.round(BEDS[i][1] * sy - q / 2);
      if (i < beds) {
        g.fillStyle = (i & 1) ? '#6fc45a' : '#86d36f'; g.fillRect(x, y, q, q);
        if (big) { g.fillStyle = '#c4f0a8'; g.fillRect(x + Math.round(q * 0.25), y + Math.round(q * 0.2), q3, q3); }
      } else { g.fillStyle = '#5b3920'; g.fillRect(x + Math.round(q * 0.2), y + Math.round(q * 0.3), q2, q3); }
    }
    var ripeN = st.neighbor ? +st.neighbor.ripe || 0 : 0;
    for (i = 0; i < NB.length; i++) {
      x = Math.round(NB[i][0] * sx - q / 2); y = Math.round(NB[i][1] * sy - q / 2);
      g.fillStyle = ripeN > i * 8 ? '#b6dc5e' : '#5fae4c'; g.fillRect(x, y, q, q);
    }
    var locks = st.locks || [], day = +st.day || 0;
    for (i = 0; i < SPOTS.length; i++) {
      var s = SPOTS[i], l = locks[i], cx = s[0] * sx, cy = (s[1] - 0.45) * sy;
      if (!l) { g.fillStyle = '#5b3920'; g.fillRect(Math.round(cx - q2 / 2), Math.round(cy + 0.25 * sy), q2, q3); continue; }
      var pr = l.days > 0 ? clamp((day - l.start) / l.days, 0, 1) : 1, r = Math.max(1.2 * k, (0.22 + 0.4 * pr) * sx);
      g.fillStyle = l.days === 90 ? '#2c7439' : l.days === 30 ? '#3d8a36' : '#4f9e3d'; circ(g, cx, cy, r);
      g.fillStyle = 'rgba(255,255,255,.2)'; circ(g, cx - r * 0.3, cy - r * 0.35, r * 0.45);
      var rp = false; try { rp = F.ripe ? !!F.ripe(l) : pr >= 1; } catch (e) { rp = pr >= 1; }
      if (rp) {
        g.fillStyle = l.days === 7 ? '#e8604a' : l.days === 30 ? '#f2c14e' : '#c8e04a';
        circ(g, cx + r * 0.35, cy + r * 0.1, Math.max(k, r * 0.4));
        if (!REDUCE) {
          var ss = Math.max(1, Math.round(1.3 * k));
          g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4 + i); g.fillStyle = '#fff6cf';
          g.fillRect(Math.round(cx + r * 0.9), Math.round(cy - r * 1.1), ss, ss); g.globalAlpha = 1;
        }
      }
    }
    var lpv = 0; try { lpv = (F.lpVal ? +F.lpVal() : 0) + (st.lp ? +st.lp.fees || 0 : 0); } catch (e) { lpv = 0; }
    var nfish = Math.min(16, Math.ceil(lpv / 30));
    if (nfish > 0) {
      var fw = Math.max(2, Math.round(0.5 * sx)), fh = Math.max(1, Math.round(0.22 * sy));
      g.globalAlpha = 0.8; g.fillStyle = big ? '#f0883e' : '#174c66';
      for (i = 0; i < nfish; i++) {
        x = 3 + ((i * 2.3) % 8) + Math.sin(t * 0.6 + i) * 0.8; y = 19 + ((i * 1.7) % 6.5) + Math.cos(t * 0.5 + i * 1.3) * 0.6;
        g.fillRect(Math.round(x * sx - fw / 2), Math.round(y * sy - fh / 2), fw, fh);
      }
      g.globalAlpha = 1;
    }
    if (big) { g.fillStyle = '#0f1814'; circ(g, 42.5 * sx, 9.3 * sy, 3 * k); g.fillStyle = '#9b7fd1'; circ(g, 42.5 * sx, 9.3 * sy, 2.1 * k); }
  }
  function drawRain(V, t, storm) {
    var g = V.g, w = V.w, h = V.h, k = V.k;
    var n = storm ? (V.big ? 70 : 26) : (V.big ? 40 : 14), sp = (storm ? 150 : 105) * k;
    var sl = (storm ? 5 : 2.4) * k, len = (storm ? 9 : 7) * k, ww = w + 30 * k, hh = h + 20 * k;
    g.strokeStyle = storm ? 'rgba(214,226,255,.55)' : 'rgba(214,226,255,.45)'; g.lineWidth = Math.max(1, 0.9 * k);
    g.beginPath();
    for (var i = 0; i < n; i++) {
      var x = ((i * 97.3 * k + t * sp * 0.35) % ww) - 15 * k, y = ((i * 61.7 * k + t * sp) % hh) - 10 * k;
      g.moveTo(x, y); g.lineTo(x - sl, y + len);
    }
    g.stroke();
  }
  function areaHi(V, id, mode, t) {
    var z = Z[id]; if (!z || !z.area) return;
    var g = V.g, k = V.k, a = z.area;
    var x0 = clamp(a[0], 0, W) * V.sx, y0 = clamp(a[1], 0, H) * V.sy, x1 = clamp(a[2], 0, W) * V.sx, y1 = clamp(a[3], 0, H) * V.sy;
    rr(g, x0 + k, y0 + k, x1 - x0 - 2 * k, y1 - y0 - 2 * k, 4 * k);
    if (mode === 2) { /* open panel: solid gold */
      g.globalAlpha = 0.16; g.fillStyle = '#f2c14e'; g.fill();
      g.globalAlpha = 0.95; g.lineWidth = 1.5 * k; g.strokeStyle = '#f2c14e'; g.stroke();
    } else if (mode === 1) { /* standing near: marching dashes */
      g.globalAlpha = 0.08; g.fillStyle = '#f2c14e'; g.fill();
      g.globalAlpha = REDUCE ? 0.8 : 0.55 + 0.35 * Math.sin(t * 5);
      g.setLineDash(V.dash); g.lineDashOffset = REDUCE ? 0 : -t * 10 * k;
      g.lineWidth = 1.2 * k; g.strokeStyle = '#f2c14e'; g.stroke();
      g.setLineDash(NODASH); g.lineDashOffset = 0;
    } else { /* hover / focus: cream */
      g.globalAlpha = 0.13; g.fillStyle = '#fff7e6'; g.fill();
      g.globalAlpha = 0.9; g.lineWidth = 1.2 * k; g.strokeStyle = '#fff7e6'; g.stroke();
    }
    g.globalAlpha = 1;
  }
  function hotIcon(V, id, t, pulse) {
    var p = ZIX[id]; if (!p) return;
    var g = V.g, x = V.ix[p.i], y = V.iy[p.i], A = V.A;
    if (pulse && !REDUCE) {
      var f = (t * 0.9) % 1;
      g.globalAlpha = (1 - f) * 0.85; g.lineWidth = 1.4 * V.k; g.strokeStyle = '#ffd76a';
      g.beginPath(); g.arc(x, y, V.S * (0.55 + f * 0.65), 0, TAU); g.stroke(); g.globalAlpha = 1;
    }
    var spr = V.icoA[id]; if (spr) g.drawImage(spr, Math.round(x - A / 2), Math.round(y - A / 2));
  }
  function drawPings(V) {
    var g = V.g, any = false;
    for (var i = 0; i < PINGS.length; i++) {
      var P = PINGS[i]; if (!P.on) continue;
      var f = (NOW - P.t0) / 0.9; if (f >= 1 || f < 0) { P.on = false; continue; }
      any = true;
      g.globalAlpha = (1 - f) * (1 - f); g.lineWidth = (V.big ? 2 : 1.5) * V.k; g.strokeStyle = PING_COL[P.c] || PING_COL[0];
      g.beginPath(); g.arc(P.x * V.sx, P.y * V.sy, V.S * (0.35 + f * 0.9), 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    return any;
  }
  function drawLetters(V) {
    var L0 = F.letters; if (!L0 || !L0.length) return;
    var g = V.g, sx = V.sx, sy = V.sy, D = V.D, arc = 60 / T, k = V.k;
    for (var i = 0; i < L0.length; i++) {
      var L = L0[i]; if (!L) continue;
      var kk = +L.t; if (!(kk >= 0 && kk < 1)) continue;
      if (kk > 0.9 && !L.__mm) { L.__mm = 1; ping(L.x1, L.y1, 0); }
      for (var j = 3; j >= 1; j--) {
        var tt = kk - j * 0.035; if (tt <= 0) continue;
        var lx = (L.x0 + (L.x1 - L.x0) * tt) * sx, ly = (L.y0 + (L.y1 - L.y0) * tt - Math.sin(tt * Math.PI) * arc) * sy;
        g.globalAlpha = 0.55 - j * 0.14; g.drawImage(V.dot, lx - D * 0.35, ly - D * 0.35, D * 0.7, D * 0.7);
      }
      g.globalAlpha = 1;
      var x = (L.x0 + (L.x1 - L.x0) * kk) * sx, y = (L.y0 + (L.y1 - L.y0) * kk - Math.sin(kk * Math.PI) * arc) * sy;
      g.drawImage(V.dot, x - D / 2, y - D / 2);
      if (V.big) {
        var ew = 7 * k, eh = 5 * k;
        g.fillStyle = '#fbf6ea'; g.fillRect(x - ew / 2, y - eh / 2, ew, eh);
        g.strokeStyle = '#b9ad91'; g.lineWidth = 0.8 * k; g.beginPath();
        g.moveTo(x - ew / 2, y - eh / 2); g.lineTo(x, y + 0.6 * k); g.lineTo(x + ew / 2, y - eh / 2); g.stroke();
        g.fillStyle = '#e8604a'; g.fillRect(x - 0.9 * k, y - 0.3 * k, 1.8 * k, 1.8 * k);
      }
    }
  }
  function drawCam(V) {
    var z = +F.zoom, d = +F.dpr, cv = F.cv; if (!(z > 0) || !(d > 0) || !cv) return;
    var g = V.g, k = V.k, sx = V.sx, sy = V.sy;
    var vw = cv.width / (z * d) / T, vh = cv.height / (z * d) / T;
    var x0 = clamp(cam.x / T * sx, k, V.w - k), y0 = clamp(cam.y / T * sy, k, V.h - k);
    var x1 = clamp((cam.x / T + vw) * sx, k, V.w - k), y1 = clamp((cam.y / T + vh) * sy, k, V.h - k);
    if (x1 - x0 < 4 * k || y1 - y0 < 4 * k) return;
    g.fillStyle = 'rgba(255,250,235,.07)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.lineWidth = k; g.strokeStyle = 'rgba(15,24,20,.55)'; g.strokeRect(x0 - k, y0 - k, x1 - x0 + 2 * k, y1 - y0 + 2 * k);
    g.strokeStyle = 'rgba(255,250,235,.72)'; g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    var c = Math.min(7 * k, (x1 - x0) / 3, (y1 - y0) / 3);
    g.lineWidth = 1.8 * k; g.strokeStyle = '#f2c14e'; g.lineCap = 'square'; g.beginPath();
    g.moveTo(x0, y0 + c); g.lineTo(x0, y0); g.lineTo(x0 + c, y0);
    g.moveTo(x1 - c, y0); g.lineTo(x1, y0); g.lineTo(x1, y0 + c);
    g.moveTo(x1, y1 - c); g.lineTo(x1, y1); g.lineTo(x1 - c, y1);
    g.moveTo(x0 + c, y1); g.lineTo(x0, y1); g.lineTo(x0, y1 - c);
    g.stroke(); g.lineCap = 'butt';
  }
  function drawDest(V, t) {
    if (player.tx == null || player.ty == null) return;
    var g = V.g, k = V.k, px = player.x * V.sx, py = player.y * V.sy, tx = player.tx * V.sx, ty = player.ty * V.sy;
    if (!isFinite(tx) || !isFinite(ty)) return;
    g.lineWidth = 3 * k; g.strokeStyle = 'rgba(15,24,20,.4)'; g.beginPath(); g.moveTo(px, py); g.lineTo(tx, ty); g.stroke();
    g.setLineDash(V.dash2); g.lineDashOffset = REDUCE ? 0 : -t * 14 * k;
    g.lineWidth = 1.4 * k; g.strokeStyle = '#f2c14e'; g.beginPath(); g.moveTo(px, py); g.lineTo(tx, ty); g.stroke();
    g.setLineDash(NODASH); g.lineDashOffset = 0;
    var r = (V.big ? 5 : 3) * k;
    g.fillStyle = '#0f1814'; circ(g, tx, ty, r * 0.8);
    g.fillStyle = '#f2c14e'; circ(g, tx, ty, r * 0.55);
    g.lineWidth = 1.3 * k; g.strokeStyle = '#f2c14e'; g.beginPath();
    g.arc(tx, ty, r * (1.35 + (REDUCE ? 0 : 0.25 * Math.sin(t * 6))), 0, TAU); g.stroke();
  }
  function drawButler(V, t) {
    var g = V.g, k = V.k, x = butler.x * V.sx, y = butler.y * V.sy, r = (V.big ? 4 : 2.6) * k;
    if (!isFinite(x) || !isFinite(y)) return;
    g.fillStyle = '#0f1814'; circ(g, x, y, r + 1.1 * k);
    g.fillStyle = '#4fd1c1'; circ(g, x, y, r);
    g.fillStyle = 'rgba(255,255,255,.45)'; circ(g, x - r * 0.3, y - r * 0.35, r * 0.4);
    var a = Math.max(1, Math.round(1.6 * k));
    g.fillStyle = REDUCE || ((t * 2) | 0) % 2 ? '#e8604a' : '#f2c14e';
    g.fillRect(Math.round(x - a / 2), Math.round(y - r - 1.2 * k - a), a, a);
  }
  function drawPlayer(V, t) {
    var g = V.g, k = V.k, x = player.x * V.sx, y = player.y * V.sy;
    if (!isFinite(x) || !isFinite(y)) return;
    var s = (V.big ? 1.45 : 1) * (REDUCE ? 1 : 1 + 0.07 * Math.sin(t * 4));
    if (!REDUCE) {
      var f = (t * 0.8) % 1;
      g.globalAlpha = (1 - f) * 0.8; g.lineWidth = 1.5 * k; g.strokeStyle = '#f2c14e';
      g.beginPath(); g.arc(x, y, (4 + f * 9) * k * (V.big ? 1.4 : 1), 0, TAU); g.stroke();
    } else {
      g.globalAlpha = 0.65; g.lineWidth = 1.3 * k; g.strokeStyle = '#f2c14e';
      g.beginPath(); g.arc(x, y, 8 * k * (V.big ? 1.4 : 1), 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(15,24,20,.45)'; circ(g, x, y + 0.8 * k, 5.6 * k * s);
    var c = Math.cos(heading), sn = Math.sin(heading), L = 6.4 * k * s, B = 4.5 * k * s, N = 1.6 * k * s;
    g.beginPath();
    g.moveTo(x + L * c, y + L * sn);
    g.lineTo(x - B * c + B * 0.95 * sn, y - B * sn - B * 0.95 * c);
    g.lineTo(x - N * c, y - N * sn);
    g.lineTo(x - B * c - B * 0.95 * sn, y - B * sn + B * 0.95 * c);
    g.closePath();
    g.lineJoin = 'round'; g.lineWidth = 2.4 * k; g.strokeStyle = '#0f1814'; g.stroke();
    g.fillStyle = '#fff6dc'; g.fill();
    g.fillStyle = '#2f5d9e'; circ(g, x - 0.4 * B * c, y - 0.4 * B * sn, 1.1 * k * s);
    g.lineJoin = 'miter';
    if (V.big && V.youW > 0) {
      var pw = V.youW, ph = 16 * k, ly = y - 14 * k * s - ph / 2;
      if (ly - ph / 2 < 2 * k) ly = y + 14 * k * s + ph / 2;
      var lx = clamp(x, pw / 2 + 2 * k, V.w - pw / 2 - 2 * k);
      g.fillStyle = 'rgba(15,24,20,.9)'; rr(g, lx - pw / 2, ly - ph / 2, pw, ph, ph / 2); g.fill();
      g.lineWidth = k; g.strokeStyle = 'rgba(242,193,78,.8)'; g.stroke();
      g.font = V.youFont;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff6dc'; g.fillText('Bạn', lx, ly + 0.5 * k);
    }
  }
  function drawView(V, t) {
    var g = V.g; if (!g || !V.w) return;
    var w = V.w, h = V.h;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    smooth(g);
    if (V.base) g.drawImage(V.base, 0, 0); else { g.fillStyle = '#4f8a39'; g.fillRect(0, 0, w, h); }
    drawLife(V, t);
    /* time of day: warm wash at dawn and dusk, deep blue at night with lit windows and lanterns */
    var n = nightAmt(), d = duskAmt(), i;
    if (d > 0.01) { g.globalAlpha = 0.16 * d; g.fillStyle = '#ff8a3d'; g.fillRect(0, 0, w, h); }
    if (n > 0.01) {
      g.globalAlpha = 0.5 * n; g.fillStyle = '#0a1330'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      var R = V.glowR;
      for (i = 0; i < LIGHTS.length; i++) {
        var Lg = LIGHTS[i];
        g.globalAlpha = n * Lg[2] * (REDUCE ? 1 : 0.85 + 0.15 * Math.sin(t * 3 + i * 1.7));
        g.drawImage(V.glow, Lg[0] * V.sx - R, Lg[1] * V.sy - R);
      }
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    var wx = st.weather;
    if (wx === 'mưa' || wx === 'bão') {
      var storm = wx === 'bão';
      g.globalAlpha = storm ? 0.36 : 0.2; g.fillStyle = storm ? '#141c34' : '#2a4562'; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
      if (!REDUCE) drawRain(V, t, storm);
    }
    var cur = curZoneId(), near = nearZoneId(), hov = V.hover && ZIX[V.hover] ? V.hover : null;
    if (cur) areaHi(V, cur, 2, t);
    if (near && near !== cur) areaHi(V, near, 1, t);
    if (hov && hov !== cur && hov !== near) areaHi(V, hov, 3, t);
    if (V.marks) g.drawImage(V.marks, 0, 0);
    if (cur) hotIcon(V, cur, t, false);
    if (near && near !== cur) hotIcon(V, near, t, true);
    if (hov && hov !== cur && hov !== near) hotIcon(V, hov, t, false);
    drawPings(V);
    drawLetters(V);
    drawCam(V);
    drawDest(V, t);
    if (st.butler && st.butler.hired) drawButler(V, t);
    drawPlayer(V, t);
  }

  /* ---------- styles ---------- */
  var CSS = [
    '.mm{position:absolute;left:0;top:0;z-index:4;box-sizing:border-box;width:238px;padding:0 6px;border-radius:14px;',
    'background:linear-gradient(180deg,#2d4035 0%,#1f2e26 24%,#18251e 100%);border:1px solid rgba(242,193,78,.62);',
    'box-shadow:0 14px 34px rgba(0,0,0,.42),0 3px 0 rgba(8,12,10,.35),inset 0 1px 0 rgba(255,236,190,.14),inset 0 -1px 0 rgba(0,0,0,.4);',
    'color:var(--ink,#f3ecd9);font-family:var(--body,"Be Vietnam Pro",system-ui,sans-serif);-webkit-user-select:none;user-select:none;',
    '-webkit-tap-highlight-color:transparent;will-change:transform;animation:mm-enter .55s cubic-bezier(.2,.8,.2,1) .15s backwards}',
    '.mm::before{content:"";position:absolute;left:10px;right:10px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,226,150,.55),transparent);pointer-events:none}',
    '.mm.mm-anim{transition:transform .4s cubic-bezier(.2,.8,.2,1),opacity .24s ease,visibility 0s linear 0s}',
    '.mm.mm-anim.mm-away{transition:transform .4s cubic-bezier(.2,.8,.2,1),opacity .2s ease,visibility 0s linear .2s}',
    '.mm.mm-away{opacity:0;visibility:hidden;pointer-events:none}',
    '@keyframes mm-enter{from{opacity:0}to{opacity:1}}',
    '.mm-head{display:flex;align-items:center;gap:6px;height:32px;padding:0 0 0 3px;cursor:default}',
    '.mm-title{display:flex;align-items:center;gap:6px;min-width:0;font-family:var(--display,"Baloo 2",system-ui,sans-serif);font-weight:800;font-size:14.5px;line-height:1;letter-spacing:.02em;color:var(--straw,#f2c14e);text-shadow:0 1px 0 rgba(0,0,0,.5);white-space:nowrap}',
    '.mm-title svg{flex:none;display:block;filter:drop-shadow(0 1px 0 rgba(0,0,0,.45))}',
    '.mm-live{flex:none;width:7px;height:7px;border-radius:50%;background:var(--leaf,#86d36f);animation:mm-live 1.8s ease-out infinite}',
    '.mm-live[hidden]{display:none}',
    '@keyframes mm-live{0%{box-shadow:0 0 0 0 rgba(134,211,111,.6)}100%{box-shadow:0 0 0 7px rgba(134,211,111,0)}}',
    '.mm-sp{flex:1;min-width:0}',
    '.mm-wx{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:6px}',
    '.mm-wx svg{display:block}',
    '.mm-wx.mm-pop{animation:mm-pop .6s cubic-bezier(.2,.8,.2,1)}',
    '@keyframes mm-pop{0%{transform:scale(.6);background:rgba(242,193,78,.35)}100%{transform:none;background:transparent}}',
    '.mm-btn{flex:none;display:grid;place-items:center;width:24px;height:24px;padding:0;margin:0;border-radius:7px;border:1px solid var(--line,#3a5145);',
    'background:linear-gradient(180deg,#2c3f34,#22322a);color:var(--ink,#f3ecd9);cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,236,190,.08),0 1px 0 rgba(0,0,0,.3);',
    'transition:border-color .15s,color .15s,transform .1s}',
    '.mm-btn:hover{border-color:var(--straw,#f2c14e);color:var(--straw,#f2c14e)}',
    '.mm-btn:active{transform:translateY(1px)}',
    '.mm-btn svg{display:block;transition:transform .3s cubic-bezier(.2,.8,.2,1)}',
    '.mm[data-anchor=top] .mm-tog svg{transform:rotate(180deg)}',
    '.mm.mm-collapsed .mm-tog svg{transform:rotate(180deg)}',
    '.mm[data-anchor=top].mm-collapsed .mm-tog svg{transform:none}',
    '.mm-body{position:relative;overflow:hidden}',
    '.mm.mm-anim .mm-body{transition:height .4s cubic-bezier(.2,.8,.2,1)}',
    '.mm-well{position:relative;border-radius:9px;background:#0f1814;box-shadow:0 0 0 1px rgba(5,9,7,.8),0 1px 0 1px rgba(255,236,190,.07)}',
    '.mm-well::after{content:"";position:absolute;inset:0;border-radius:9px;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(242,193,78,.24),inset 0 2px 10px rgba(0,0,0,.5),inset 0 -1px 6px rgba(0,0,0,.3)}',
    '.mm.mm-collapsed .mm-well{visibility:hidden;transition:visibility 0s linear .4s}',
    '.mm canvas.mm-cv{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:9px;cursor:pointer;touch-action:none;display:block}',
    '.mm-pins{position:absolute;inset:0;pointer-events:none}',
    '.mm-pin{position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;padding:0;border:0;border-radius:50%;background:transparent;pointer-events:none;cursor:pointer}',
    '.mm-pin:focus{outline:none}',
    '.mm-pin:focus-visible{outline:none;box-shadow:0 0 0 2px var(--straw,#f2c14e),0 0 0 4px rgba(15,24,20,.85)}',
    '.mm-tip{position:absolute;left:0;top:0;z-index:3;pointer-events:none;max-width:230px;padding:6px 10px 7px;border-radius:9px;background:rgba(15,24,20,.96);',
    'border:1px solid rgba(242,193,78,.6);box-shadow:0 8px 20px rgba(0,0,0,.45);font-size:12px;line-height:1.25;color:var(--ink,#f3ecd9);white-space:nowrap;',
    'opacity:0;transform:translateY(4px);transition:opacity .14s ease,transform .14s ease}',
    '.mm-tip.mm-on{opacity:1;transform:none}',
    '.mm-tip.mm-below{transform:translateY(-4px)}',
    '.mm-tip.mm-below.mm-on{transform:none}',
    '.mm-tip b{display:block;font-family:var(--display,"Baloo 2",system-ui,sans-serif);font-weight:800;font-size:14px;color:var(--straw,#f2c14e);line-height:1.15}',
    '.mm-tip small{display:block;color:var(--muted,#aebaa3);font-size:11px;margin-top:1px}',
    '.mm-tip::after{content:"";position:absolute;left:var(--mm-ax,50%);bottom:-5px;width:8px;height:8px;margin-left:-5px;background:rgba(15,24,20,.96);',
    'border-right:1px solid rgba(242,193,78,.6);border-bottom:1px solid rgba(242,193,78,.6);transform:rotate(45deg)}',
    '.mm-tip.mm-below::after{bottom:auto;top:-5px;transform:rotate(225deg)}',
    '.mm.mm-phone{border-radius:12px;padding:0 5px}',
    '.mm.mm-phone .mm-head{height:26px;gap:4px;padding-left:2px}',
    '.mm.mm-phone .mm-title{font-size:12.5px;gap:4px}',
    '.mm.mm-phone .mm-title svg{width:12px;height:12px}',
    '.mm.mm-phone .mm-btn{width:22px;height:22px;border-radius:6px}',
    '.mm.mm-phone .mm-wx,.mm.mm-phone .mm-live{display:none}',
    '.mm.mm-phone .mm-pin{width:16px;height:16px;margin:-8px 0 0 -8px}',
    '.mm.mm-phone .mm-tip{max-width:180px}',
    '.mm-safe{position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;',
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}',
    /* big map overlay */
    '.mm-ov{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:12px;',
    'padding-left:max(12px,env(safe-area-inset-left,0px));padding-right:max(12px,env(safe-area-inset-right,0px));padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));',
    'background:radial-gradient(120% 95% at 50% 45%,rgba(15,24,20,.5),rgba(6,10,8,.86));opacity:0;transition:opacity .22s ease;',
    'color:var(--ink,#f3ecd9);font-family:var(--body,"Be Vietnam Pro",system-ui,sans-serif)}',
    '.mm-ov[hidden]{display:none!important}',
    '.mm-ov.mm-in{opacity:1}',
    '.mm-card{position:relative;box-sizing:border-box;width:min(90vw,900px,100%);max-height:100%;display:flex;flex-direction:column;overflow:hidden;',
    'background:linear-gradient(180deg,#2c3f34 0%,#1f2e26 16%,#18251e 100%);border:1px solid rgba(242,193,78,.6);border-radius:18px;',
    'box-shadow:0 30px 80px rgba(0,0,0,.55),0 4px 0 rgba(8,12,10,.4),inset 0 1px 0 rgba(255,236,190,.14);',
    'transform:translateY(12px) scale(.97);transition:transform .32s cubic-bezier(.2,.8,.2,1)}',
    '.mm-card::before{content:"";position:absolute;left:18px;right:18px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,226,150,.6),transparent);pointer-events:none}',
    '.mm-ov.mm-in .mm-card{transform:none}',
    '.mm-chead{flex:none;display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--line,#3a5145)}',
    '.mm-chead>div{min-width:0}',
    '.mm-ctag{display:flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--straw,#f2c14e);font-weight:700}',
    '.mm-card h2{font-family:var(--display,"Baloo 2",system-ui,sans-serif);font-weight:800;font-size:27px;line-height:1.05;margin:3px 0 5px;color:var(--ink,#f3ecd9)}',
    '.mm-csub{margin:0;font-size:12.5px;color:var(--muted,#aebaa3);line-height:1.45}',
    '.mm-csub b{color:var(--ink,#f3ecd9);font-weight:700}',
    '.mm-x{margin-left:auto;flex:none;width:34px;height:34px;display:grid;place-items:center;padding:0;border-radius:9px;border:1px solid var(--line,#3a5145);',
    'background:var(--board-2,#26372e);color:var(--ink,#f3ecd9);cursor:pointer;transition:border-color .15s,color .15s}',
    '.mm-x:hover{border-color:var(--straw,#f2c14e);color:var(--straw,#f2c14e)}',
    '.mm-cbody{display:grid;grid-template-columns:minmax(0,1fr) 236px;gap:16px;padding:16px 18px 14px;min-height:0;overflow:auto;align-items:start}',
    '.mm-fig{position:relative;margin:0;justify-self:center;border-radius:12px;background:#0f1814;',
    'box-shadow:0 0 0 1px rgba(5,9,7,.85),0 0 0 4px rgba(242,193,78,.16),0 12px 28px rgba(0,0,0,.38)}',
    '.mm-fig::after{content:"";position:absolute;inset:0;border-radius:12px;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(242,193,78,.32),inset 0 3px 16px rgba(0,0,0,.45)}',
    '.mm-fig canvas.mm-bcv{position:absolute;left:0;top:0;width:100%;height:100%;border-radius:12px;cursor:pointer;touch-action:none;display:block}',
    '.mm-fig .mm-tip{max-width:260px}',
    '.mm-leg{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}',
    '.mm-leg li{margin:0}',
    '.mm-li{box-sizing:border-box;display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:0 10px;width:100%;text-align:left;',
    'padding:6px 10px 6px 6px;border-radius:11px;border:1px solid var(--line,#3a5145);background:linear-gradient(180deg,#2a3c32,#23342b);',
    'color:var(--ink,#f3ecd9);font:inherit;cursor:pointer;transition:border-color .15s,background .15s,transform .15s}',
    '.mm-li:hover,.mm-li.mm-hot{border-color:rgba(242,193,78,.8);background:linear-gradient(180deg,#34493c,#293c31)}',
    '.mm-li:active{transform:translateY(1px)}',
    '.mm-li canvas.mm-ico{position:static;width:30px;height:30px;display:block;pointer-events:none}',
    '.mm-lt{min-width:0;display:flex;flex-direction:column}',
    '.mm-lt b{font-size:13.5px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.mm-lt small{font-size:11.5px;color:var(--muted,#aebaa3);line-height:1.3}',
    '.mm-st{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;white-space:nowrap}',
    '.mm-st:empty{display:none}',
    '.mm-st.g{background:#2f4639;color:var(--leaf,#86d36f)}',
    '.mm-st.y{background:#4a3e1f;color:var(--straw,#f2c14e)}',
    '.mm-key{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;padding:10px 18px 14px;border-top:1px solid var(--line,#3a5145);font-size:11.5px;color:var(--muted,#aebaa3)}',
    '.mm-key span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
    '.mm-key svg{flex:none;display:block}',
    '.mm-kbd{font-family:var(--mono,ui-monospace,Consolas,monospace);font-size:10.5px;padding:1px 5px;border-radius:4px;border:1px solid var(--line,#3a5145);background:var(--deep,#0f1814);color:var(--ink,#f3ecd9)}',
    '.mm-keys{margin-left:auto}',
    '@media (max-width:760px){',
    '.mm-cbody{grid-template-columns:1fr;padding:12px 12px 10px;gap:12px}',
    '.mm-leg{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr))}',
    '.mm-chead{padding:12px 12px 10px}',
    '.mm-card h2{font-size:22px}',
    '.mm-key{padding:8px 12px 12px;gap:4px 12px}',
    '.mm-keys{display:none!important}',
    '}',
    '@media (prefers-reduced-motion:reduce){',
    '.mm,.mm.mm-anim,.mm.mm-anim .mm-body,.mm-ov,.mm-card,.mm-tip,.mm-btn,.mm-btn svg,.mm-li{transition:none!important}',
    '.mm,.mm-live,.mm-wx.mm-pop{animation:none!important}',
    '}'
  ].join('');

  var SVG = {
    compass: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 3.1 10.1 8H5.9z" fill="#e8604a"/><path d="M8 12.9 10.1 8H5.9z" fill="currentColor"/></svg>',
    expand: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9.2 6.8M2.5 13.5l4.3-4.3"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
    close: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    'nắng': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="3.2" fill="#f2c14e"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1" stroke="#f2c14e" stroke-width="1.4" stroke-linecap="round"/></svg>',
    'mưa': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4.6 10.2a3 3 0 0 1 .3-6 3.8 3.8 0 0 1 7.1 1.4 2.3 2.3 0 0 1-.4 4.6z" fill="#c9d3c2"/><path d="M5.5 12l-.6 1.6M8.5 12l-.6 1.6M11.5 12l-.6 1.6" stroke="#6cbde0" stroke-width="1.3" stroke-linecap="round"/></svg>',
    'bão': '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4.6 9.4a3 3 0 0 1 .3-6 3.8 3.8 0 0 1 7.1 1.4 2.3 2.3 0 0 1-.4 4.6z" fill="#8a97ab"/><path d="M8.6 8.2 6.6 11.4h2l-1 3.2 3-4.2h-2.1l1.1-2.2z" fill="#f2c14e"/></svg>',
    kPlayer: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><path d="M12 7 3 2.6 5 7 3 11.4z" fill="#fff6dc" stroke="#0f1814" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    kButler: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="7" cy="7.6" r="3.8" fill="#4fd1c1" stroke="#0f1814" stroke-width="1.4"/><rect x="6.2" y="1.4" width="1.6" height="1.6" fill="#e8604a"/></svg>',
    kLetter: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="5.6" fill="#f2c14e" opacity=".3"/><circle cx="7" cy="7" r="2.8" fill="#f6cf63"/><circle cx="6.3" cy="6.3" r="1" fill="#fffbe8"/></svg>',
    kView: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><rect x="1.5" y="3" width="11" height="8" fill="rgba(255,250,235,.12)" stroke="#fff6dc" stroke-width=".9"/><path d="M1.5 5.6V3h2.6M12.5 5.6V3H9.9M1.5 8.4V11h2.6M12.5 8.4V11H9.9" stroke="#f2c14e" stroke-width="1.5" fill="none"/></svg>',
    kDest: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.8" fill="none" stroke="#f2c14e" stroke-width="1.4"/><circle cx="7" cy="7" r="2" fill="#f2c14e"/></svg>'
  };
  var WX_LABEL = { 'nắng': 'Thời tiết: Nắng', 'mưa': 'Thời tiết: Mưa', 'bão': 'Thời tiết: Bão' };
  var WX_LINE = { 'nắng': 'Trời nắng', 'mưa': 'Trời mưa', 'bão': 'Có bão' };

  /* ---------- state ---------- */
  var stage = F.stage, root, head, wxEl, liveEl, bigBtn, togBtn, body, well, pinsWrap, tip, tipB, tipS, safeProbe;
  var ov, card, chead, closeBtn, fig, bigTip, bigTipB, bigTipS, infoEl, keyEl, LEG = [], PINS = [];
  var panelEl = null, logEl = null, hintEl = null, promptEl = null;
  var collapsed = false, bigOpen = false, lastFocus = null, hideTimer = 0, pinIdx = 0, legK = 0;
  var lay = { ready: false, phone: false, cw: 0, ch: 0, x: 0, y: 0, rw: 0, pad: 6, headH: 32, away: false, anchor: '' };
  var OBS = [{ on: false, x: 0, y: 0, w: 0, h: 0 }, { on: false, x: 0, y: 0, w: 0, h: 0 }, { on: false, x: 0, y: 0, w: 0, h: 0 }, { on: false, x: 0, y: 0, w: 0, h: 0 }];
  var SAFE = { t: 0, r: 0, b: 0, l: 0 };
  var miniAcc = 0, bigAcc = 0, pollAcc = 0, needRebuild = false, lastWx = null, lastLive = null, lastDpr = 0, lastInfo = '';
  var errs = 0, broken = false;
  var dest = { on: false, x: 0, y: 0 };
  var walkPt = { x: 0, y: 0 };

  function loadCollapsed() { try { return !!(win.localStorage && localStorage.getItem(LS_KEY) === '1'); } catch (e) { return false; } }
  function saveCollapsed(v) { try { if (win.localStorage) localStorage.setItem(LS_KEY, v ? '1' : '0'); } catch (e) { /* private mode */ } }

  /* ---------- layout ---------- */
  function readSafe() {
    SAFE.t = SAFE.r = SAFE.b = SAFE.l = 0;
    if (!safeProbe || !win.getComputedStyle) return SAFE;
    try {
      var cs = getComputedStyle(safeProbe);
      SAFE.t = parseFloat(cs.paddingTop) || 0; SAFE.r = parseFloat(cs.paddingRight) || 0;
      SAFE.b = parseFloat(cs.paddingBottom) || 0; SAFE.l = parseFloat(cs.paddingLeft) || 0;
    } catch (e) { /* keep zeros */ }
    return SAFE;
  }
  function shown(e) { return !!(e && !e.hidden && e.offsetParent != null && e.offsetWidth > 0); }
  function obsFrom(o, e, m) {
    if (shown(e)) { o.on = true; o.x = e.offsetLeft - m; o.y = e.offsetTop - m; o.w = e.offsetWidth + 2 * m; o.h = e.offsetHeight + 2 * m; } else o.on = false;
  }
  function isPanelOpen() {
    var a = F.app; if (!a || !a.classList || !a.classList.contains('open')) return false;
    return panelEl ? shown(panelEl) : true;
  }
  function hits(x, y, w, h) {
    for (var i = 0; i < OBS.length; i++) {
      var o = OBS[i]; if (!o.on) continue;
      if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) return true;
    }
    return false;
  }
  function place(anim) {
    if (!root) return;
    var sw = stage.clientWidth, sh = stage.clientHeight; if (!sw || !sh) return;
    var phone = isPhone();
    var cw = phone ? (sw <= 380 ? 108 : 116) : (sw >= 1280 ? 224 : (sw >= 1000 ? 206 : 188));
    var ch = Math.round(cw * H / W), pad = phone ? 5 : 6, headH = phone ? 26 : 32;
    var rw = cw + pad * 2 + 2, rhFull = 2 + headH + ch + pad, rh = collapsed ? 2 + headH : rhFull;
    var sf = readSafe(), gap = phone ? 8 : 12, open = isPanelOpen();
    /* Always the top-left corner (like Ngọc Rồng Online): the quest tracker sits under it, and the quest panel
       (docked left on desktop) opens below it while there is room, otherwise the minimap steps aside. */
    var x = Math.max(gap, sf.l), y = gap, anchor = 'top', away = false;
    rh = collapsed ? 2 + headH : rhFull;
    if (open && panelEl && shown(panelEl)) {
      if (phone) away = panelEl.offsetTop < y + rh + gap;
      else if (panelEl.classList.contains('left')) away = sh - (y + rh) - 2 * gap < 380;
      else away = panelEl.offsetLeft < x + rw + gap;
    }
    stage.style.setProperty('--mm-bot', (away ? 0 : y + rh) + 'px');
    x = Math.round(x); y = Math.round(y);
    var same = lay.ready && lay.cw === cw && lay.x === x && lay.y === y && lay.away === away && lay.anchor === anchor && lay.phone === phone && lay.collapsed === collapsed;
    if (same) return;
    var animate = anim && lay.ready && !REDUCE;
    if (!animate) root.classList.remove('mm-anim');
    root.classList.toggle('mm-phone', phone);
    root.classList.toggle('mm-away', away);
    root.setAttribute('data-anchor', anchor);
    root.style.width = rw + 'px';
    root.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)' + (away ? ' scale(.96)' : '');
    body.style.height = (collapsed ? 0 : ch + pad) + 'px';
    well.style.height = ch + 'px';
    var resized = lay.cw !== cw || lay.phone !== phone;
    lay.phone = phone; lay.cw = cw; lay.ch = ch; lay.x = x; lay.y = y; lay.rw = rw; lay.pad = pad; lay.headH = headH;
    lay.away = away; lay.anchor = anchor; lay.collapsed = collapsed;
    /* a pending rebuild (resize / new static layer) is done once on the next frame instead of per event */
    if (resized) { if (!needRebuild) sizeMini(); placePins(); }
    if (!animate) { void root.offsetWidth; root.classList.add('mm-anim'); }
    lay.ready = true;
    if (miniV.hover) showMiniTip(miniV.hover);
    miniV.dirty = true;
  }
  function sizeMini() { if (lay.cw) sizeView(miniV, lay.cw, lay.ch); }
  function placePins() {
    var cw = lay.cw, ch = lay.ch, m = lay.phone ? 10 : 13;
    for (var i = 0; i < PINS.length; i++) {
      var p = ZI[i];
      PINS[i].style.left = Math.round(clamp(p.x / W * cw, m, cw - m)) + 'px';
      PINS[i].style.top = Math.round(clamp(p.y / H * ch, m, ch - m)) + 'px';
    }
  }

  /* ---------- tooltips ---------- */
  function showMiniTip(id) {
    var p = id ? ZIX[id] : null;
    if (!p || !miniV.k || lay.away || collapsed) { tip.classList.remove('mm-on'); return; }
    tipB.textContent = p.z.name || p.id; tipS.textContent = p.z.tag || '';
    var mx = lay.pad + miniV.ix[p.i] / miniV.k, my = lay.headH + miniV.iy[p.i] / miniV.k, r = miniV.S / miniV.k / 2;
    var tw = tip.offsetWidth || 140, th = tip.offsetHeight || 38, sw = stage.clientWidth || 800, limR = sw - 6;
    if (!lay.phone && isPanelOpen() && panelEl && panelEl.offsetLeft > lay.x) limR = Math.min(limR, panelEl.offsetLeft - 4);
    var left = Math.max(6 - lay.x, Math.min(mx - tw / 2, limR - lay.x - tw));
    var below = lay.y + my - r - 9 - th < 4;
    var top = below ? my + r + 9 : my - r - 9 - th;
    tip.style.left = Math.round(left) + 'px'; tip.style.top = Math.round(top) + 'px';
    tip.style.setProperty('--mm-ax', Math.round(clamp(mx - left, 12, tw - 12)) + 'px');
    tip.classList.toggle('mm-below', below); tip.classList.add('mm-on');
  }
  function showBigTip(id) {
    var p = id ? ZIX[id] : null;
    if (!p || !bigV.k) { bigTip.classList.remove('mm-on'); return; }
    bigTipB.textContent = p.z.name || p.id; bigTipS.textContent = (p.z.tag || '') + ' · nhấn để đi tới';
    var mx = bigV.ix[p.i] / bigV.k, my = bigV.iy[p.i] / bigV.k, r = bigV.S / bigV.k / 2;
    var tw = bigTip.offsetWidth || 180, th = bigTip.offsetHeight || 40, fw = bigV.cssW || 400;
    var left = Math.max(4, Math.min(mx - tw / 2, fw - tw - 4));
    var below = my - r - 9 - th < 4, top = below ? my + r + 26 : my - r - 9 - th;
    bigTip.style.left = Math.round(left) + 'px'; bigTip.style.top = Math.round(top) + 'px';
    bigTip.style.setProperty('--mm-ax', Math.round(clamp(mx - left, 12, tw - 12)) + 'px');
    bigTip.classList.toggle('mm-below', below); bigTip.classList.add('mm-on');
  }
  function setMiniHover(id) {
    if (miniV.hover === id) return;
    miniV.hover = id; showMiniTip(id);
    if (miniV.w && !lay.away && !collapsed) drawView(miniV, NOW);
  }
  function setBigHover(id) {
    if (bigV.hover === id) return;
    var prev = bigV.hover; bigV.hover = id;
    for (var i = 0; i < LEG.length; i++) if (LEG[i].id === prev || LEG[i].id === id) LEG[i].btn.classList.toggle('mm-hot', LEG[i].id === id);
    showBigTip(id);
    if (bigOpen && bigV.w) drawView(bigV, NOW);
  }

  /* ---------- hit testing & travel ---------- */
  function hitZone(V, px, py) {
    var k = V.k || 1, R = V.S / k * 0.62 + (V.big ? 2 : 3), best = null, bd = R * R, i;
    for (i = 0; i < ZI.length; i++) {
      var dx = px - V.ix[i] / k, dy = py - V.iy[i] / k, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = ZI[i].z; }
    }
    if (best) return best;
    if (V.big) for (i = 0; i < V.labels.length; i++) {
      var L = V.labels[i], qx = px * k, qy = py * k;
      if (qx >= L.x && qx <= L.x + L.w && qy >= L.y && qy <= L.y + L.h) return ZI[i].z;
    }
    return zoneAt(px / V.cssW * W, py / V.cssH * H);
  }
  function snapWalkable(x, y, out) {
    x = clamp(x, 0.5, W - 0.5); y = clamp(y, 0.5, H - 0.5); out.x = x; out.y = y;
    if (typeof F.solid !== 'function' || !F.solid(x, y)) return out;
    var bd = 1e9, fx = Math.floor(x), fy = Math.floor(y);
    for (var r = 1; r <= 6 && bd === 1e9; r++) {
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        var cx = fx + dx + 0.5, cy = fy + dy + 0.5;
        if (cx < 0 || cy < 0 || cx > W || cy > H || F.solid(cx, cy)) continue;
        var d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
        if (d < bd) { bd = d; out.x = cx; out.y = cy; }
      }
    }
    return out;
  }
  function markDest() { dest.on = player.tx != null; dest.x = player.tx; dest.y = player.ty; }
  function travelZone(z) {
    if (!z || typeof F.walkTo !== 'function') return;
    F.walkTo(z.ax, z.ay, z.id); markDest();
    ping(z.ax, z.ay - 0.2, 1);
    miniV.dirty = bigV.dirty = true;
  }
  function travelPoint(x, y) {
    if (typeof F.walkTo !== 'function') return;
    var p = snapWalkable(x, y, walkPt);
    F.walkTo(p.x, p.y); markDest();
    ping(p.x, p.y, 1);
    miniV.dirty = bigV.dirty = true;
  }
  function pointerIn(V, e) {
    var r = V.cv.getBoundingClientRect();
    walkPt.x = e.clientX - r.left; walkPt.y = e.clientY - r.top;
    return r.width > 0 && r.height > 0;
  }

  /* ---------- collapse / big map ---------- */
  function setCollapsed(v) {
    collapsed = !!v; saveCollapsed(collapsed);
    root.classList.toggle('mm-collapsed', collapsed);
    togBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var lbl = collapsed ? 'Mở rộng bản đồ nhỏ (phím M)' : 'Thu gọn bản đồ nhỏ (phím M)';
    togBtn.setAttribute('aria-label', lbl); togBtn.title = lbl;
    if (collapsed) setMiniHover(null);
    place(true);
    miniV.dirty = true;
  }
  function toggleCollapsed() { setCollapsed(!collapsed); }
  function drawLegendIcons() {
    var k = dprNow(); if (k === legK) return; legK = k;
    var S = Math.round(30 * k);
    for (var i = 0; i < LEG.length; i++) {
      var c = LEG[i].cv; c.width = S; c.height = S;
      var g = c.getContext('2d'); g.clearRect(0, 0, S, S);
      drawIcon(g, LEG[i].id, S / 2, S / 2, S / 26 * 0.98, false);
    }
  }
  function layoutBig() {
    if (!bigOpen) return;
    var phone = isPhone(), cardW = card.clientWidth || 640, ovH = ov.clientHeight || 520;
    var innerW = cardW - 2 - (phone ? 24 : 36), availW = innerW - (phone ? 0 : 236 + 16);
    var hh = chead.offsetHeight || 84, kh = keyEl.offsetHeight || 40;
    var availH = ovH - 24 - 2 - hh - kh - (phone ? 22 : 30);
    if (phone) availH = Math.max(150, availH * 0.7);
    var mw = Math.max(180, Math.floor(Math.min(availW, availH * W / H))), mh = Math.round(mw * H / W);
    fig.style.width = mw + 'px'; fig.style.height = mh + 'px';
    sizeView(bigV, mw, mh);
    bigV.dirty = true;
  }
  function updateBigInfo() {
    var d = +st.day || 0, live = !!(F.CH && F.CH.live);
    var day = live ? (Math.floor(d) % 365 + 1) + '/365' : String(Math.floor(d));
    var s = 'Ngày ' + day + ' · ' + (WX_LINE[st.weather] || 'Trời nắng') + (live ? ' · On-chain' : '');
    if (s !== lastInfo) { lastInfo = s; infoEl.textContent = s; }
  }
  function updateLegendStatus() {
    var cur = curZoneId(), near = nearZoneId();
    for (var i = 0; i < LEG.length; i++) {
      var L = LEG[i], txt = '', cls = 'mm-st';
      if (L.id === cur) { txt = 'Đang mở'; cls = 'mm-st y'; } else if (L.id === near) { txt = 'Bạn ở đây'; cls = 'mm-st g'; }
      if (L.last !== txt) { L.last = txt; L.st.textContent = txt; L.st.className = cls; }
    }
  }
  function openBig() {
    if (bigOpen || !ov) return;
    bigOpen = true; clearTimeout(hideTimer);
    lastFocus = doc.activeElement || null;
    ov.hidden = false; bigBtn.setAttribute('aria-expanded', 'true');
    setMiniHover(null);
    updateBigInfo(); updateLegendStatus(); drawLegendIcons();
    layoutBig();
    void ov.offsetWidth; ov.classList.add('mm-in');
    focusEl(closeBtn);
    drawView(bigV, NOW);
  }
  function closeBig(travelled) {
    if (!bigOpen) return;
    bigOpen = false; ov.classList.remove('mm-in'); bigBtn.setAttribute('aria-expanded', 'false');
    setBigHover(null);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { if (!bigOpen) ov.hidden = true; }, REDUCE ? 0 : 230);
    var t = travelled ? F.cv : lastFocus;
    var alive = t && (typeof doc.contains !== 'function' || doc.contains(t));
    focusEl(alive ? t : F.cv);
    lastFocus = null; miniV.dirty = true;
  }
  function legendFocusables() { var a = [closeBtn]; for (var i = 0; i < LEG.length; i++) a.push(LEG[i].btn); return a; }
  function trapTab(e) {
    var f = legendFocusables(), a = doc.activeElement, i = f.indexOf(a);
    if (i < 0) { e.preventDefault(); focusEl(f[0]); return; }
    if (e.shiftKey && i === 0) { e.preventDefault(); focusEl(f[f.length - 1]); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); focusEl(f[0]); }
  }
  function moveLegendFocus(key) {
    var n = LEG.length; if (!n) return;
    var a = doc.activeElement, i = -1;
    for (var j = 0; j < n; j++) if (LEG[j].btn === a) i = j;
    if (key === 'Home') i = 0; else if (key === 'End') i = n - 1;
    else if (key === 'ArrowDown' || key === 'ArrowRight') i = i < 0 ? 0 : (i + 1) % n;
    else i = i < 0 ? n - 1 : (i - 1 + n) % n;
    focusEl(LEG[i].btn);
  }
  function setPinIdx(i, focus) {
    pinIdx = i;
    for (var j = 0; j < PINS.length; j++) PINS[j].tabIndex = j === i ? 0 : -1;
    if (focus) focusEl(PINS[i]);
  }

  /* ---------- DOM ---------- */
  function build() {
    if (!doc.getElementById('mm-style')) {
      var s = el('style'); s.id = 'mm-style'; s.textContent = CSS;
      (doc.head || doc.documentElement || doc.body).appendChild(s);
    }
    panelEl = doc.getElementById('panel'); logEl = doc.getElementById('log'); promptEl = doc.getElementById('prompt');
    hintEl = stage.querySelector ? stage.querySelector('.hint') : null;

    safeProbe = el('div', 'mm-safe'); attr(safeProbe, { 'aria-hidden': 'true' });
    stage.appendChild(safeProbe);

    root = el('div', 'mm'); root.id = 'mm-root';
    attr(root, { role: 'region', 'aria-label': 'Bản đồ nhỏ' });
    head = el('div', 'mm-head');
    var title = el('span', 'mm-title', SVG.compass + '<span>Bản đồ</span>');
    liveEl = el('span', 'mm-live'); liveEl.hidden = true; attr(liveEl, { title: 'Đang chơi on-chain', 'aria-hidden': 'true' });
    title.appendChild(liveEl);
    wxEl = el('span', 'mm-wx'); attr(wxEl, { role: 'img' });
    bigBtn = el('button', 'mm-btn mm-big', SVG.expand);
    attr(bigBtn, { type: 'button', 'aria-label': 'Mở bản đồ lớn', title: 'Bản đồ lớn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'mm-ov' });
    togBtn = el('button', 'mm-btn mm-tog', SVG.chevron);
    attr(togBtn, { type: 'button', 'aria-controls': 'mm-body' });
    head.appendChild(title); head.appendChild(el('span', 'mm-sp')); head.appendChild(wxEl); head.appendChild(bigBtn); head.appendChild(togBtn);

    body = el('div', 'mm-body'); body.id = 'mm-body';
    well = el('div', 'mm-well');
    miniV.cv = el('canvas', 'mm-cv');
    attr(miniV.cv, { role: 'img', 'aria-label': 'Bản đồ nhỏ của làng: vị trí của bạn, các khu, quản gia và thư giao dịch đang bay. Chạm vào bản đồ để đi tới đó.' });
    miniV.g = miniV.cv.getContext('2d');
    pinsWrap = el('div', 'mm-pins'); attr(pinsWrap, { role: 'group', 'aria-label': 'Các khu trên bản đồ nhỏ, dùng phím mũi tên để chọn' });
    for (var i = 0; i < ZI.length; i++) {
      var b = el('button', 'mm-pin'); var z = ZI[i].z;
      attr(b, { type: 'button', 'aria-label': 'Đi tới ' + z.name + (z.tag ? ': ' + z.tag : '') });
      b.tabIndex = i === 0 ? 0 : -1; b.setAttribute('data-i', String(i));
      pinsWrap.appendChild(b); PINS.push(b);
    }
    well.appendChild(miniV.cv); well.appendChild(pinsWrap); body.appendChild(well);
    tip = el('div', 'mm-tip'); attr(tip, { 'aria-hidden': 'true' });
    tipB = el('b'); tipS = el('small'); tip.appendChild(tipB); tip.appendChild(tipS);
    root.appendChild(head); root.appendChild(body); root.appendChild(tip);
    stage.appendChild(root);

    /* big map overlay */
    ov = el('div', 'mm-ov'); ov.id = 'mm-ov'; ov.hidden = true;
    card = el('div', 'mm-card'); attr(card, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mm-ctitle', 'aria-describedby': 'mm-csub' });
    chead = el('div', 'mm-chead');
    var hl = el('div');
    hl.appendChild(el('div', 'mm-ctag', SVG.compass + '<span>Bản đồ làng</span>'));
    var h2 = el('h2'); h2.id = 'mm-ctitle'; h2.textContent = 'Hôm nay đi đâu?'; hl.appendChild(h2);
    var sub = el('p', 'mm-csub'); sub.id = 'mm-csub';
    infoEl = el('b'); sub.appendChild(infoEl);
    sub.appendChild(doc.createTextNode(' · Chạm vào một khu trên bản đồ hoặc trong danh sách, nhân vật sẽ tự đi tới và mở bảng.'));
    hl.appendChild(sub);
    closeBtn = el('button', 'mm-x', SVG.close); attr(closeBtn, { type: 'button', 'aria-label': 'Đóng bản đồ lớn', title: 'Đóng (Esc)' });
    chead.appendChild(hl); chead.appendChild(closeBtn);

    var cbody = el('div', 'mm-cbody');
    fig = el('div', 'mm-fig');
    bigV.cv = el('canvas', 'mm-bcv');
    attr(bigV.cv, { role: 'img', 'aria-label': 'Bản đồ lớn của làng với tên các khu, vị trí của bạn, quản gia và thư giao dịch. Chạm vào một khu để đi tới đó.' });
    bigV.g = bigV.cv.getContext('2d');
    bigTip = el('div', 'mm-tip'); attr(bigTip, { 'aria-hidden': 'true' });
    bigTipB = el('b'); bigTipS = el('small'); bigTip.appendChild(bigTipB); bigTip.appendChild(bigTipS);
    fig.appendChild(bigV.cv); fig.appendChild(bigTip);
    var leg = el('ul', 'mm-leg'); attr(leg, { 'aria-label': 'Các khu trong làng' });
    for (var j = 0; j < ZI.length; j++) {
      var zz = ZI[j].z, li = el('li'), lb = el('button', 'mm-li'), ic = el('canvas', 'mm-ico'), lt = el('span', 'mm-lt');
      attr(lb, { type: 'button', 'data-z': zz.id }); attr(ic, { 'aria-hidden': 'true' });
      var nb = el('b'); nb.textContent = zz.name; var ns = el('small'); ns.textContent = zz.tag || '';
      lt.appendChild(nb); lt.appendChild(ns);
      var sp = el('span', 'mm-st');
      lb.appendChild(ic); lb.appendChild(lt); lb.appendChild(sp); li.appendChild(lb); leg.appendChild(li);
      LEG.push({ id: zz.id, z: zz, btn: lb, cv: ic, st: sp, last: null });
    }
    cbody.appendChild(fig); cbody.appendChild(leg);
    keyEl = el('div', 'mm-key',
      '<span>' + SVG.kPlayer + 'Bạn</span><span>' + SVG.kButler + 'Quản gia tự động</span><span>' + SVG.kLetter + 'Thư giao dịch</span>' +
      '<span>' + SVG.kView + 'Vùng đang nhìn</span><span>' + SVG.kDest + 'Điểm đến</span>' +
      '<span class="mm-keys"><span class="mm-kbd">M</span>thu gọn bản đồ nhỏ</span><span><span class="mm-kbd">Esc</span>đóng</span>');
    card.appendChild(chead); card.appendChild(cbody); card.appendChild(keyEl);
    ov.appendChild(card);
    stage.appendChild(ov);
  }

  function bindEvents() {
    bigBtn.addEventListener('click', function () { if (bigOpen) closeBig(false); else openBig(); });
    togBtn.addEventListener('click', toggleCollapsed);

    var cv = miniV.cv;
    cv.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (!pointerIn(miniV, e)) return;
      e.preventDefault();
      var px = walkPt.x, py = walkPt.y, z = hitZone(miniV, px, py);
      if (z) travelZone(z); else travelPoint(px / miniV.cssW * W, py / miniV.cssH * H);
      if (miniV.w) drawView(miniV, NOW);
    });
    cv.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (!pointerIn(miniV, e)) return;
      var z = hitZone(miniV, walkPt.x, walkPt.y);
      setMiniHover(z ? z.id : null);
    });
    cv.addEventListener('pointerleave', function () { setMiniHover(null); });

    pinsWrap.addEventListener('keydown', function (e) {
      var k = e.key, n = PINS.length, i = pinIdx;
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') { e.stopPropagation(); return; }
      if (k === 'ArrowRight' || k === 'ArrowDown') i = (i + 1) % n;
      else if (k === 'ArrowLeft' || k === 'ArrowUp') i = (i - 1 + n) % n;
      else if (k === 'Home') i = 0;
      else if (k === 'End') i = n - 1;
      else return;
      e.preventDefault(); e.stopPropagation(); setPinIdx(i, true);
    });
    PINS.forEach(function (b, i) {
      b.addEventListener('click', function () { setPinIdx(i, false); travelZone(ZI[i].z); });
      b.addEventListener('focus', function () { pinIdx = i; setMiniHover(ZI[i].id); });
      b.addEventListener('blur', function () { if (miniV.hover === ZI[i].id) setMiniHover(null); });
    });

    /* big map */
    closeBtn.addEventListener('click', function () { closeBig(false); });
    ov.addEventListener('pointerdown', function (e) { if (e.target === ov) { e.preventDefault(); closeBig(false); } });
    bigV.cv.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (!pointerIn(bigV, e)) return;
      e.preventDefault();
      var px = walkPt.x, py = walkPt.y, z = hitZone(bigV, px, py);
      if (z) travelZone(z); else travelPoint(px / bigV.cssW * W, py / bigV.cssH * H);
      closeBig(true);
    });
    bigV.cv.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      if (!pointerIn(bigV, e)) return;
      var z = hitZone(bigV, walkPt.x, walkPt.y); setBigHover(z ? z.id : null);
    });
    bigV.cv.addEventListener('pointerleave', function () { setBigHover(null); });
    LEG.forEach(function (L) {
      L.btn.addEventListener('click', function () { travelZone(L.z); closeBig(true); });
      L.btn.addEventListener('pointerenter', function () { setBigHover(L.id); });
      L.btn.addEventListener('pointerleave', function () { if (bigV.hover === L.id) setBigHover(null); });
      L.btn.addEventListener('focus', function () { setBigHover(L.id); });
      L.btn.addEventListener('blur', function () { if (bigV.hover === L.id) setBigHover(null); });
    });

    /* keys: capture phase so the big map can swallow Escape / movement before the game sees them */
    win.addEventListener('keydown', function (e) {
      try {
        var k = e.key; if (!k) return;
        if (bigOpen) {
          if (k === 'Escape' || k === 'Esc') { e.preventDefault(); e.stopPropagation(); closeBig(false); return; }
          if (k === 'Tab') { trapTab(e); return; }
          if (!isTyping(e)) {
            if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
              e.preventDefault(); e.stopPropagation(); moveLegendFocus(k); return;
            }
            var lk = k.length === 1 ? k.toLowerCase() : k;
            if (lk === 'w' || lk === 'a' || lk === 's' || lk === 'd' || lk === 'e' || lk === ' ' || lk === 'Enter') e.stopPropagation();
          }
        }
        if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
        if ((k === 'm' || k === 'M') && !e.repeat) { e.preventDefault(); toggleCollapsed(); }
      } catch (err) { /* never break the game's keyboard */ }
    }, true);
  }

  /* ---------- head info (weather glyph, live dot) ---------- */
  function updateHead() {
    var wx = WX_LABEL[st.weather] ? st.weather : 'nắng';
    if (wx !== lastWx) {
      var first = lastWx === null; lastWx = wx;
      wxEl.innerHTML = SVG[wx]; wxEl.setAttribute('aria-label', WX_LABEL[wx]); wxEl.title = WX_LABEL[wx];
      if (!first && !REDUCE) { wxEl.classList.remove('mm-pop'); void wxEl.offsetWidth; wxEl.classList.add('mm-pop'); }
    }
    var live = !!(F.CH && F.CH.live);
    if (live !== lastLive) { lastLive = live; liveEl.hidden = !live; }
  }

  /* ---------- per-frame ---------- */
  function poll() {
    updateHead();
    var k = dprNow();
    if (k !== lastDpr) { lastDpr = k; needRebuild = true; }
    if (miniV.w && F.staticCanvas !== miniV.src) needRebuild = true;
    place(true);
    if (bigOpen) { updateBigInfo(); updateLegendStatus(); }
  }
  function onFrame(dt, now) {
    if (broken) return;
    try {
      NOW = (+now || 0) / 1000; dt = +dt || 0;
      trackPlayer();
      pollAcc += dt;
      if (pollAcc >= POLL_DT) { pollAcc = 0; poll(); }
      if (needRebuild) {
        needRebuild = false; miniV.stale = true; bigV.stale = true; legK = 0; lastDpr = dprNow();
        sizeMini();
        if (bigOpen) { drawLegendIcons(); layoutBig(); }
      }
      if (bigOpen) {
        bigAcc += dt;
        if (bigV.dirty || bigAcc >= BIG_DT) { bigAcc = 0; bigV.dirty = false; drawView(bigV, NOW); }
      } else if (!lay.away && !collapsed && miniV.w) {
        miniAcc += dt;
        if (miniV.dirty || miniAcc >= MINI_DT) { miniAcc = 0; miniV.dirty = false; drawView(miniV, NOW); }
      }
    } catch (e) {
      errs++;
      if (errs >= 5) { broken = true; try { console.error('[minimap] stopped after repeated errors', e); } catch (_) { /* ignore */ } }
    }
  }
  /* gold destination pin in the world for walks started from the map */
  function onWorld(g, t) {
    if (!dest.on) return;
    if (player.tx == null || player.tx !== dest.x || player.ty !== dest.y) { dest.on = false; return; }
    var X = dest.x * T, Y = dest.y * T, f = REDUCE ? 0.5 : (t * 1.4) % 1, bob = REDUCE ? 0 : Math.sin(t * 5) * 2;
    g.save();
    g.globalAlpha = 0.9 * (1 - f); g.strokeStyle = '#f2c14e'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(X, Y, 8 + 10 * f, 3.5 + 4 * f, 0, 0, TAU); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,.25)'; ellF(g, X, Y, 5, 2);
    g.fillStyle = '#f2c14e'; g.strokeStyle = '#5a3d10'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(X, Y - 5 + bob); g.lineTo(X - 5, Y - 13 + bob); g.lineTo(X, Y - 21 + bob); g.lineTo(X + 5, Y - 13 + bob); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#fff3c4'; g.beginPath(); g.moveTo(X, Y - 19 + bob); g.lineTo(X - 2.5, Y - 13 + bob); g.lineTo(X, Y - 13 + bob); g.closePath(); g.fill();
    g.restore();
  }

  function init() {
    collapsed = loadCollapsed();
    build();
    bindEvents();
    root.classList.toggle('mm-collapsed', collapsed);
    togBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    var lbl = collapsed ? 'Mở rộng bản đồ nhỏ (phím M)' : 'Thu gọn bản đồ nhỏ (phím M)';
    togBtn.setAttribute('aria-label', lbl); togBtn.title = lbl;
    lastDpr = dprNow();
    updateHead();
    place(false);
    sizeMini();
    if (miniV.w) drawView(miniV, NOW);

    F.on('frame', onFrame);
    F.on('world', onWorld);
    F.on('resize', function () { needRebuild = true; place(false); });
    F.on('open', function () { place(true); miniV.dirty = true; });
    F.on('close', function () { place(true); miniV.dirty = true; });
    F.on('tx', function (o) {
      if (!o) return;
      var z = Z[o.zone];
      if (o.from === 'gate') ping(22, 1.2, 0); else if (z) ping(z.ax, z.ay - 0.6, 2);
    });

    F.minimap = {
      root: root, overlay: ov,
      open: openBig, close: function () { closeBig(false); },
      isOpen: function () { return bigOpen; },
      toggle: toggleCollapsed, setCollapsed: setCollapsed,
      isCollapsed: function () { return collapsed; },
      refresh: function () { needRebuild = true; place(false); }
    };
  }

  try { init(); } catch (e) { try { console.error('[minimap] init failed', e); } catch (_) { /* ignore */ } }
})();
