/* Nông Trại DeFi · UI module (prototype/ui.js)
   Dresses the HTML around the canvas: drawn logo and stat icons in the HUD with change pulses and an
   AVAX sparkline, zone emblems and motion for the panel (plus swipe-down on the phone sheet), toast
   kinds, a prompt bubble that floats over the farmer's head, log line entrances, a keycap hint and a
   once-per-session sunrise splash.
   It only talks to window.FARM and the DOM: no ids change, #p-stats / #p-actions are never touched,
   and nothing here alters what the game does. Styling lives in prototype/ui.css. */
(() => {
'use strict';
const F = window.FARM;
if (!F || typeof F.on !== 'function' || !F.stage || typeof document === 'undefined') return;

const doc = document, root = doc.documentElement;
const $ = s => doc.querySelector(s);
const XL = 'http://www.w3.org/1999/xlink';
const mq = q => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
const reduce = !!F.reduce || mq('(prefers-reduced-motion: reduce)');
const now = () => (window.performance && performance.now) ? performance.now() : Date.now();
const logged = new Set();
const report = (where, e) => { if (logged.has(where)) return; logged.add(where); try { console.error('[ui.js ' + where + ']', e); } catch (_) {} };
const guard = (where, fn) => function () { try { return fn.apply(this, arguments); } catch (e) { report(where, e); } };
const step = (where, fn) => { try { fn(); } catch (e) { report(where, e); } };
const svgUse = (id, cls) => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true" focusable="false"><use href="#${id}" xlink:href="#${id}"></use></svg>`;
function setUse(svg, id) {
  const u = svg && svg.querySelector('use');
  if (!u) return;
  u.setAttribute('href', '#' + id);
  try { u.setAttributeNS(XL, 'xlink:href', '#' + id); } catch (e) {}
}

/* ------------------------------------------------------------------ inline SVG sprite (multicolour) */
const SYMBOLS = {
  'ui-logo': ['0 0 40 40',
    '<circle cx="20" cy="20" r="18.6" fill="url(#ui-g-badge)" stroke="#f2c14e" stroke-width="1.6"/>' +
    '<circle cx="20" cy="20" r="15.4" fill="none" stroke="#f2c14e" stroke-opacity=".3" stroke-width=".8" stroke-dasharray="1.4 2.2"/>' +
    '<ellipse cx="20" cy="31.4" rx="9.6" ry="3" fill="#6b4226"/><ellipse cx="20" cy="30.7" rx="7.4" ry="1.7" fill="#8c5b37"/>' +
    '<path d="M20 30.6V19.6" stroke="#4f9e3d" stroke-width="2.2" stroke-linecap="round"/>' +
    '<path d="M20 27.4c-4.4.4-8.3-1.6-9.6-5.6 4.3-.9 8.3 1.2 9.6 5.6z" fill="#86d36f"/>' +
    '<path d="M20 24.8c4.4.4 8.3-1.6 9.6-5.6-4.3-.9-8.3 1.2-9.6 5.6z" fill="#5fb84f"/>' +
    '<path d="M6.8 17.6 20 6.2l13.2 11.4c-8.6 2.6-17.8 2.6-26.4 0z" fill="url(#ui-g-hat)"/>' +
    '<path d="M20 6.4 13.4 19M20 6.4l6.6 12.6M20 6.4v13.4" stroke="#a8772a" stroke-width=".7" stroke-opacity=".75"/>' +
    '<path d="M6.8 17.6c8.6 2.6 17.8 2.6 26.4 0" fill="none" stroke="#8f621d" stroke-width="1.2" stroke-linecap="round"/>' +
    '<circle cx="20" cy="6.4" r="1" fill="#fff3c4"/>'],
  'ui-i-day': ['0 0 20 20',
    '<rect x="2.5" y="4" width="15" height="13.5" rx="2.6" fill="#f3ecd9"/>' +
    '<path d="M2.5 6.6A2.6 2.6 0 0 1 5.1 4h9.8a2.6 2.6 0 0 1 2.6 2.6v2H2.5z" fill="#e8604a"/>' +
    '<rect x="5.6" y="2" width="2" height="4.2" rx="1" fill="#26372e"/><rect x="12.4" y="2" width="2" height="4.2" rx="1" fill="#26372e"/>' +
    '<circle cx="10" cy="13" r="2.7" fill="#f2c14e"/><path d="M10 9.4v.9M10 15.7v.9M6.4 13h.9M12.7 13h.9" stroke="#e0a23a" stroke-width="1" stroke-linecap="round"/>'],
  'ui-i-avax': ['0 0 20 20',
    '<circle cx="10" cy="10" r="8.6" fill="#e84142"/><circle cx="10" cy="10" r="7.4" fill="none" stroke="#fff" stroke-opacity=".2"/>' +
    '<path d="M9.3 5.5c.3-.6 1.1-.6 1.4 0l1.4 2.5-3.6 6.2H5.9c-.6 0-1-.7-.7-1.2z" fill="#fff"/>' +
    '<path d="M12.9 9.6c.3-.5 1.1-.5 1.4 0l1.6 2.8c.3.5-.1 1.2-.7 1.2h-3.2c-.6 0-1-.7-.7-1.2z" fill="#fff"/>'],
  'ui-i-sun': ['0 0 20 20',
    '<path d="M10 1.8v2.3M10 15.9v2.3M1.8 10h2.3M15.9 10h2.3M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6" stroke="#f2c14e" stroke-width="1.8" stroke-linecap="round"/>' +
    '<circle cx="10" cy="10" r="4.3" fill="#ffd45e"/><circle cx="8.8" cy="8.8" r="1.4" fill="#fff3c4"/>'],
  'ui-i-rain': ['0 0 20 20',
    '<path d="M5.6 12.6a3.4 3.4 0 0 1 .3-6.8 4.6 4.6 0 0 1 8.8 1.3 2.8 2.8 0 0 1-.2 5.5z" fill="#d6e7f0"/>' +
    '<path d="M6.6 14.6 5.6 17M10.2 14.6 9.2 17M13.8 14.6 12.8 17" stroke="#6cbde0" stroke-width="1.7" stroke-linecap="round"/>'],
  'ui-i-storm': ['0 0 20 20',
    '<path d="M5.4 11.8a3.4 3.4 0 0 1 .3-6.8 4.6 4.6 0 0 1 8.8 1.3 2.8 2.8 0 0 1-.2 5.5z" fill="#8e9db3"/>' +
    '<path d="M10.9 10.2 7.8 14.7h2.6l-1.3 3.8 4.2-5.6h-2.6l1.6-2.7z" fill="#f2c14e" stroke="#7a5512" stroke-width=".5" stroke-linejoin="round"/>'],
  'ui-i-wallet': ['0 0 20 20',
    '<path d="M4 6.2 13.6 3c.9-.3 1.8.4 1.8 1.3v2" fill="#7c522b"/>' +
    '<rect x="2" y="5.6" width="16" height="11.6" rx="2.6" fill="#a8723f"/><rect x="2" y="5.6" width="16" height="2.4" rx="1.2" fill="#c38c55"/>' +
    '<rect x="11.6" y="9.2" width="6.4" height="4.6" rx="1.6" fill="#7c522b"/><circle cx="14.4" cy="11.5" r="1.05" fill="#f2c14e"/>'],
  'ui-i-star': ['0 0 20 20',
    '<path d="M10 2.2l2.3 4.8 5.3.7-3.9 3.6 1 5.3L10 14l-4.7 2.6 1-5.3-3.9-3.6 5.3-.7z" fill="#f2c14e" stroke="#b07a1e" stroke-width=".8" stroke-linejoin="round"/>' +
    '<path d="M8.2 7.8 10 4.4" stroke="#fff3c4" stroke-width="1.1" stroke-linecap="round"/>'],
  'ui-i-net': ['0 0 20 20',
    '<ellipse cx="7.6" cy="15" rx="5.4" ry="2.2" fill="#b07a1e"/><rect x="2.2" y="12.2" width="10.8" height="2.8" fill="#b07a1e"/><ellipse cx="7.6" cy="12.2" rx="5.4" ry="2.2" fill="#f2c14e"/>' +
    '<ellipse cx="7.6" cy="9.8" rx="5.4" ry="2.2" fill="#b07a1e"/><rect x="2.2" y="7" width="10.8" height="2.8" fill="#b07a1e"/><ellipse cx="7.6" cy="7" rx="5.4" ry="2.2" fill="#ffd96b"/>' +
    '<path d="M13.4 8.6l2.7-3.4 2.7 3.4M16.1 5.4v8.2" fill="none" stroke="#86d36f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'],
  'ui-z-home': ['0 0 32 32',
    '<ellipse cx="16" cy="28" rx="13" ry="2" fill="#000" fill-opacity=".25"/>' +
    '<rect x="7" y="15" width="18" height="12" rx="1" fill="#efe3c8"/><rect x="7" y="24.6" width="18" height="2.4" fill="#d6c6a2"/>' +
    '<path d="M3 16.5 16 6l13 10.5z" fill="#d9b45a"/><path d="M6.5 13.7h19M9.9 10.9h12.2" stroke="#b8913b" stroke-width="1.4"/>' +
    '<path d="M3 16.5h26" stroke="#9c7a2e" stroke-width="1.6" stroke-linecap="round"/>' +
    '<rect x="13.5" y="19" width="5" height="8" rx=".6" fill="#5f3a20"/><circle cx="17.4" cy="23.2" r=".6" fill="#f2c14e"/>' +
    '<rect x="8.8" y="18.4" width="3.4" height="3" fill="#8fd0e4"/><rect x="19.8" y="18.4" width="3.4" height="3" fill="#8fd0e4"/>'],
  'ui-z-lend': ['0 0 32 32',
    '<ellipse cx="16" cy="25.4" rx="11.5" ry="3.6" fill="#6b4226"/><ellipse cx="16" cy="24.8" rx="9" ry="2.2" fill="#8c5b37"/>' +
    '<path d="M16 24.2c-6.5 0-10-3.6-9.4-8.2 2.6.3 4.6 1.7 5.6 3.6-.3-4.4 1.4-8 3.8-10 2.4 2 4.1 5.6 3.8 10 1-1.9 3-3.3 5.6-3.6.6 4.6-2.9 8.2-9.4 8.2z" fill="#5fae4c"/>' +
    '<path d="M16 23.8c-3.4 0-5.6-2.4-5.2-5.6 2.4.3 4.2 2 5.2 4.2 1-2.2 2.8-3.9 5.2-4.2.4 3.2-1.8 5.6-5.2 5.6z" fill="#a6e08c"/>' +
    '<path d="M16 22.4v-9" stroke="#3f8a3a" stroke-width="1" stroke-linecap="round"/><circle cx="24.6" cy="8" r="1.5" fill="#fff3b0"/>'],
  'ui-z-orchard': ['0 0 32 32',
    '<ellipse cx="16" cy="27.6" rx="9" ry="2.1" fill="#000" fill-opacity=".25"/>' +
    '<path d="M14.3 27.4V17h3.4v10.4z" fill="#7a4f2c"/><circle cx="16" cy="12.5" r="8.5" fill="#3d8a36"/>' +
    '<circle cx="10.4" cy="16.2" r="5" fill="#4f9e3d"/><circle cx="21.6" cy="16.2" r="5" fill="#4f9e3d"/><circle cx="12.8" cy="9.4" r="3.4" fill="#66b852"/>' +
    '<circle cx="11.4" cy="15.6" r="1.9" fill="#f2c14e"/><circle cx="20.2" cy="10.8" r="1.9" fill="#e8604a"/><circle cx="21" cy="17.6" r="1.9" fill="#f2c14e"/><circle cx="15.6" cy="14" r="1.6" fill="#e8604a"/>'],
  'ui-z-pond': ['0 0 32 32',
    '<ellipse cx="16" cy="19.6" rx="13.6" ry="8.2" fill="#3d8db4"/><ellipse cx="16" cy="18.4" rx="11" ry="5.6" fill="#4fa3c8"/>' +
    '<path d="M5.6 20.4c2-1 4-1 6 0M19.4 24c2-1 4-1 6 0" stroke="#a9def0" stroke-width="1.2" stroke-linecap="round" fill="none"/>' +
    '<path d="M17.6 17.2c2.6-2.6 6.4-2.6 8.6 0-2.2 2.6-6 2.6-8.6 0z" fill="#f08a4b"/><path d="M18 17.2l-3.2-2.4v4.8z" fill="#e2733a"/><circle cx="23.6" cy="16.8" r=".7" fill="#1c2a23"/>' +
    '<ellipse cx="10" cy="21.4" rx="5" ry="2" fill="#4f9e3d"/>' +
    '<path d="M10 20.4c-2.5-1-3.5-3.8-2.6-6.2 1.6.8 2.6 2.4 2.6 4.2 0-1.8 1-3.4 2.6-4.2.9 2.4-.1 5.2-2.6 6.2z" fill="#f4a3b8"/>' +
    '<path d="M10 20.4c-1-1.4-1.1-3.5 0-5.6 1.1 2.1 1 4.2 0 5.6z" fill="#fbd3de"/>'],
  'ui-z-market': ['0 0 32 32',
    '<rect x="5" y="13" width="1.5" height="13" fill="#7c522b"/><rect x="25.5" y="13" width="1.5" height="13" fill="#7c522b"/>' +
    '<rect x="4.5" y="17" width="23" height="9" rx="1" fill="#9b6a3c"/><rect x="4.5" y="24" width="23" height="2.4" fill="#7c522b"/>' +
    '<circle cx="9.4" cy="18.6" r="2.1" fill="#f2c14e"/><circle cx="14" cy="18.6" r="2.1" fill="#86d36f"/><circle cx="18.6" cy="18.6" r="2.1" fill="#e8604a"/><circle cx="23" cy="18.6" r="2.1" fill="#f2c14e"/>' +
    '<path d="M4 5h24l1 7H3z" fill="#e8604a"/><path d="M8 5h4l-.33 7H7.33zM16 5h4l.33 7H16zM24 5h4l1 7h-4.33z" fill="#f6efe0"/>' +
    '<path d="M3 12c0 1.3 1.1 2.3 2.6 2.3S8.3 13.3 8.3 12c0 1.3 1.1 2.3 2.6 2.3s2.6-1 2.6-2.3c0 1.3 1.1 2.3 2.6 2.3s2.6-1 2.6-2.3c0 1.3 1.1 2.3 2.6 2.3s2.6-1 2.6-2.3c0 1.3 1.1 2.3 2.6 2.3S29 13.3 29 12z" fill="#c94a35"/>'],
  'ui-z-coop': ['0 0 32 32',
    '<ellipse cx="16" cy="28" rx="13" ry="2" fill="#000" fill-opacity=".25"/>' +
    '<rect x="6" y="14" width="20" height="13" fill="#f1e2bf"/><path d="M3 15 16 5l13 10z" fill="#b5523b"/>' +
    '<path d="M6.9 12h18.2M10.8 9h10.4" stroke="#93402e" stroke-width="1.3"/>' +
    '<rect x="9" y="16.2" width="14" height="4.8" rx=".8" fill="#2b1d14"/>' +
    '<text x="16" y="20" font-size="4.2" font-weight="800" text-anchor="middle" fill="#f2c14e" font-family="Be Vietnam Pro,system-ui,sans-serif">HTX</text>' +
    '<rect x="13.6" y="22" width="4.8" height="5" fill="#5f3a20"/>' +
    '<path d="M27.6 28c-1.9 0-2.8-.9-2.6-2.7l.6-2.9h4l.6 2.9c.2 1.8-.7 2.7-2.6 2.7z" fill="#e9d39a"/><path d="M26 22.4h3.2" stroke="#b8913b" stroke-width="1" stroke-linecap="round"/>'],
  'ui-z-butler': ['0 0 32 32',
    '<path d="M16 4.4v4" stroke="#3a3a3a" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="3.8" r="2.3" fill="#e8604a"/><circle cx="15.3" cy="3.2" r=".7" fill="#ffd0c4"/>' +
    '<rect x="3.6" y="12.6" width="2.6" height="6" rx="1" fill="#256f66"/><rect x="25.8" y="12.6" width="2.6" height="6" rx="1" fill="#256f66"/>' +
    '<rect x="6" y="8" width="20" height="15.4" rx="5" fill="#2f8f83"/><rect x="8.4" y="10.8" width="15.2" height="8.6" rx="3" fill="#123d38"/>' +
    '<circle cx="12.6" cy="15.1" r="2" fill="#86f0d8"/><circle cx="19.4" cy="15.1" r="2" fill="#86f0d8"/><path d="M13.4 21.4h5.2" stroke="#bff3e8" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path d="M9 23.4h14l2 5H7z" fill="#256f66"/><path d="M16 24.2l2.6 1v1.6c0 1.3-1.1 2.2-2.6 2.6-1.5-.4-2.6-1.3-2.6-2.6v-1.6z" fill="#f2c14e"/>'],
  'ui-z-neighbor': ['0 0 32 32',
    '<ellipse cx="16" cy="27.4" rx="13.4" ry="2.4" fill="#6b4226"/>' +
    '<path d="M4 12l2-2 2 2v15H4zM10 12l2-2 2 2v15h-4zM18 12l2-2 2 2v15h-4zM24 12l2-2 2 2v15h-4z" fill="#a8723f"/>' +
    '<rect x="3" y="15" width="26" height="2" fill="#7c522b"/><rect x="3" y="21.6" width="26" height="2" fill="#7c522b"/>' +
    '<circle cx="10" cy="25.2" r="3.3" fill="#5fae4c"/><circle cx="16" cy="25.6" r="3.5" fill="#7cc964"/><circle cx="22" cy="25.2" r="3.3" fill="#5fae4c"/>' +
    '<path d="M25 3.6l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="#f2c14e"/><circle cx="7" cy="6" r="1.1" fill="#f2c14e"/>'],
  'ui-z-gate': ['0 0 32 32',
    '<rect x="6" y="11" width="4" height="17" fill="#d9c9a2"/><rect x="22" y="11" width="4" height="17" fill="#d9c9a2"/>' +
    '<rect x="5.4" y="25.6" width="5.2" height="2.4" fill="#a8977a"/><rect x="21.4" y="25.6" width="5.2" height="2.4" fill="#a8977a"/>' +
    '<path d="M2 9.6c3 .2 5-.6 6.5-2.4h15c1.5 1.8 3.5 2.6 6.5 2.4L28 12H4z" fill="#7c3b2a"/><path d="M8.5 7.2h15" stroke="#5f2b1e" stroke-width="1.6" stroke-linecap="round"/>' +
    '<path d="M11 5.4c1.5-.2 2.4-.8 3-2h4c.6 1.2 1.5 1.8 3 2z" fill="#93402e"/>' +
    '<rect x="10" y="13" width="12" height="4.2" rx=".6" fill="#2b1d14"/><path d="M12 15.1h8" stroke="#f2c14e" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="1.6 1"/>' +
    '<path d="M13 17.2v1.4M19 17.2v1.4" stroke="#5f2b1e" stroke-width=".7"/><ellipse cx="13" cy="20.3" rx="1.7" ry="2.1" fill="#e8604a"/><ellipse cx="19" cy="20.3" rx="1.7" ry="2.1" fill="#e8604a"/>'],
  'ui-z-design': ['0 0 32 32',
    '<rect x="5" y="6" width="22" height="20" rx="2" fill="#2f6f96"/>' +
    '<path d="M5 11h22M5 16h22M5 21h22M10 6v20M15 6v20M20 6v20" stroke="#7cc6ea" stroke-width=".6" stroke-opacity=".7"/>' +
    '<path d="M10 21v-5l5-4 5 4v5z" fill="none" stroke="#f3ecd9" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<rect x="3.4" y="5" width="3.2" height="22" rx="1.6" fill="#24577a"/><rect x="25.4" y="5" width="3.2" height="22" rx="1.6" fill="#24577a"/>' +
    '<path d="M20.6 27.2l6.4-9.4 1.8 1.2-6.4 9.4-2.3.6z" fill="#f2c14e"/><path d="M27 17.8l1.8 1.2.8-1.2-1.8-1.2z" fill="#e8604a"/>'],
  'ui-z-wallet': ['0 0 32 32',
    '<path d="M6 9.4 20.6 5c1.3-.4 2.6.5 2.6 1.9v2.5" fill="#7c522b"/>' +
    '<rect x="4" y="9" width="24" height="17" rx="3.6" fill="#a8723f"/><rect x="4" y="9" width="24" height="3.2" rx="1.6" fill="#c38c55"/>' +
    '<rect x="18" y="14.4" width="10" height="6.8" rx="2.2" fill="#7c522b"/><circle cx="21.8" cy="17.8" r="1.6" fill="#f2c14e"/>' +
    '<path d="M8 22.4h6" stroke="#7c522b" stroke-width="1.4" stroke-linecap="round"/>'],
};
const SPRITE_DEFS =
  '<linearGradient id="ui-g-hat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe390"/><stop offset=".55" stop-color="#f2c14e"/><stop offset="1" stop-color="#cf952f"/></linearGradient>' +
  '<radialGradient id="ui-g-badge" cx=".5" cy=".34" r=".72"><stop offset="0" stop-color="#3c5e4c"/><stop offset="1" stop-color="#15221b"/></radialGradient>';

function injectSprite() {
  if (doc.getElementById('ui-sprite')) return;
  let s = '<svg xmlns="http://www.w3.org/2000/svg" id="ui-sprite" aria-hidden="true" focusable="false" ' +
    'style="position:absolute;width:0;height:0;overflow:hidden;pointer-events:none"><defs>' + SPRITE_DEFS + '</defs>';
  for (const id in SYMBOLS) s += `<symbol id="${id}" viewBox="${SYMBOLS[id][0]}">${SYMBOLS[id][1]}</symbol>`;
  doc.body.insertAdjacentHTML('afterbegin', s + '</svg>');
}

/* ------------------------------------------------------------------ CSS icon variables (masks + art) */
function durian() {
  let d = '';
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 7.3 : 9.1;
    d += (i ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (13.6 + Math.sin(a) * r).toFixed(2);
  }
  let bumps = '';
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 2 + (i % 3) * 1.6;
    bumps += `<circle cx="${(12 + Math.cos(a) * r).toFixed(2)}" cy="${(13.6 + Math.sin(a) * r).toFixed(2)}" r=".75"/>`;
  }
  return `<path d="${d}Z" fill="#6f8c23"/><circle cx="12" cy="13.6" r="7.3" fill="#a9c93f"/><g fill="#7f9b2c">${bumps}</g>` +
    '<ellipse cx="9.4" cy="10.6" rx="2.6" ry="1.5" fill="#dcef8c" opacity=".75"/><path d="M12 4.6V2.4" stroke="#6b4226" stroke-width="1.7" stroke-linecap="round"/>';
}
const ICON_VARS = {
  /* masks: only alpha matters */
  '--ui-m-pause': '<rect x="6" y="4.5" width="4.4" height="15" rx="1.3"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.3"/>',
  '--ui-m-play': '<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8c.6-.4.6-1.2 0-1.6l-10-6.8C8.9 3.9 8 4.4 8 5.2z"/>',
  '--ui-m-ff': '<path d="M3.5 6.2v11.6c0 .8.9 1.2 1.5.7L12 13v4.8c0 .8.9 1.2 1.5.7l7.4-5.8c.5-.4.5-1.1 0-1.5l-7.4-5.8c-.6-.5-1.5-.1-1.5.7V11L5 5.5c-.6-.5-1.5-.1-1.5.7z"/>',
  '--ui-m-bolt': '<path d="M13.6 1.8 4.6 13.6h5.8L8.8 22.2l10-12.8h-5.9l2.2-7.6z"/>',
  '--ui-m-scroll': '<path d="M5 3.5h10.5L19.5 7.5V20.5H5z" fill="none" stroke="#000" stroke-width="2.2" stroke-linejoin="round"/><path d="M8.5 10.5h7.5M8.5 14h7.5M8.5 17.5h4.5" stroke="#000" stroke-width="2" stroke-linecap="round"/>',
  '--ui-m-wallet': '<path d="M5 7.2 15.6 4c.9-.3 1.9.4 1.9 1.4v1.8" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="round"/><rect x="3" y="7" width="18" height="13" rx="2.8" fill="none" stroke="#000" stroke-width="2.2"/><circle cx="16.6" cy="13.5" r="1.7"/>',
  '--ui-m-mail': '<rect x="3" y="5.5" width="18" height="13" rx="2.4" fill="none" stroke="#000" stroke-width="2.2"/><path d="M4.5 7.5 12 13l7.5-5.5" fill="none" stroke="#000" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>',
  '--ui-m-tap': '<path d="M9.4 11.2V5.3a1.8 1.8 0 0 1 3.6 0V10l4.2.9c1.3.3 2.2 1.6 2 2.9l-.8 4.9c-.2 1.3-1.3 2.3-2.7 2.3H11c-.9 0-1.7-.4-2.2-1.1l-3.5-4.6a1.6 1.6 0 0 1 2.4-2.1z"/>',
  /* full-colour art */
  '--ui-b-tap': '<path d="M9.4 11.2V5.3a1.8 1.8 0 0 1 3.6 0V10l4.2.9c1.3.3 2.2 1.6 2 2.9l-.8 4.9c-.2 1.3-1.3 2.3-2.7 2.3H11c-.9 0-1.7-.4-2.2-1.1l-3.5-4.6a1.6 1.6 0 0 1 2.4-2.1z" fill="#ffe390"/>',
  '--ui-b-chili': '<path d="M15.6 6.6c-1.2 6.5-5.5 11.5-11.5 13 .2 1.6 2 2.3 4 1.9 6.4-1.3 10.9-7.5 10.4-14.1z" fill="#e8604a"/>' +
    '<path d="M13.6 10.4c-.9 3-2.8 5.5-5.2 7" stroke="#ffb3a3" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M14.6 6.6c1-1.4 2.6-1.9 4-1.4" stroke="#4f9e3d" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M14.2 6c.9.6 2.5.7 3.8.3-.3 1.2-1.6 2-3 1.9z" fill="#6cc057"/>',
  '--ui-b-mango': '<path d="M12.5 6c4.8 0 8 3.6 7.6 8.2-.4 4.4-4.4 7-8.8 6.6-4.3-.4-7.5-3.4-7-7.2.6-4.2 3.6-7.6 8.2-7.6z" fill="#f2b43a"/>' +
    '<path d="M14.6 14.8c2 1.6 2 4.3.3 5.8 2.6-.6 4.6-2.8 5-5.6z" fill="#e2852f" opacity=".7"/><path d="M10.8 7.6c-3 .8-5 3.4-5.3 6.6" stroke="#ffe390" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
    '<path d="M12.5 6.2c.2-1.6 1-2.8 2.2-3.4" stroke="#6b4226" stroke-width="1.4" stroke-linecap="round" fill="none"/><path d="M13.6 4.4c2.6-1.8 5.6-1.6 7 .4-2.6 1.6-5.4 1.4-7-.4z" fill="#4f9e3d"/>',
  '--ui-b-durian': durian(),
  '--ui-b-game': '<rect x="2.5" y="7" width="19" height="11" rx="5.4" fill="#86d36f"/><rect x="2.5" y="7" width="19" height="4" rx="2" fill="#a6e08c"/>' +
    '<path d="M7 10.4v4.6M4.7 12.7h4.6" stroke="#14301a" stroke-width="1.9" stroke-linecap="round"/><circle cx="15.6" cy="11.4" r="1.35" fill="#e8604a"/><circle cx="18.1" cy="13.9" r="1.35" fill="#f2c14e"/>',
  '--ui-b-mail': '<rect x="2.5" y="5.5" width="19" height="13.5" rx="2.4" fill="#f3ecd9"/><path d="M3.6 7l8.4 6.4L20.4 7" fill="none" stroke="#e8604a" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  '--ui-b-ext': '<path d="M9 3.5a2.2 2.2 0 0 1 2.2 2.2v.8H15a1.5 1.5 0 0 1 1.5 1.5v3.5h.8a2.2 2.2 0 1 1 0 4.4h-.8v3.6a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-3.7h1a2 2 0 1 0 0-4h-1V8A1.5 1.5 0 0 1 5 6.5h1.8v-.8A2.2 2.2 0 0 1 9 3.5z" fill="#f2a03a"/>',
  '--ui-t-ok': '<circle cx="12" cy="12" r="10" fill="#86d36f"/><path d="M7.4 12.4l3.1 3.1 6.1-6.5" fill="none" stroke="#123018" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
  '--ui-t-warn': '<path d="M12 2.6 22.2 20.6H1.8z" fill="#f2c14e" stroke="#f2c14e" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v5.2" stroke="#3a2a0c" stroke-width="2.3" stroke-linecap="round"/><circle cx="12" cy="17.4" r="1.35" fill="#3a2a0c"/>',
  '--ui-t-danger': '<circle cx="12" cy="12" r="10" fill="#e8604a"/><path d="M12 6.6v6.6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="17" r="1.45" fill="#fff"/>',
  '--ui-t-storm': '<path d="M6.4 14.6a4.2 4.2 0 0 1 .4-8.4 5.6 5.6 0 0 1 10.8 1.6 3.4 3.4 0 0 1-.3 6.8z" fill="#c2d3e6"/><path d="M13 12.6 9.4 17.8h3l-1.5 4.4 4.9-6.6h-3l1.8-3z" fill="#f2c14e" stroke="#7a5512" stroke-width=".6" stroke-linejoin="round"/>',
  '--ui-t-info': '<circle cx="12" cy="12" r="10" fill="#6cbde0"/><path d="M12 10.6v6.4" stroke="#0f2a36" stroke-width="2.5" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.45" fill="#0f2a36"/>',
};
function iconVars() {
  const enc = s => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + s + '</svg>') + '")';
  for (const k in ICON_VARS) root.style.setProperty(k, enc(ICON_VARS[k]));
  root.classList.add('ui-on');
  if (reduce) root.classList.add('ui-reduce');
}

/* ------------------------------------------------------------------ HUD */
const num = t => { const m = String(t).replace(/\./g, '').replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };
const wxKey = t => /bão/i.test(t) ? 'bao' : /mưa/i.test(t) ? 'mua' : 'nang';
const WX_ICON = { nang: 'ui-i-sun', mua: 'ui-i-rain', bao: 'ui-i-storm' };
/* when to flash a stat: 'any' on every change (with a cooldown), 'rel' only once the value has moved
   by a meaningful amount since the last flash, so steadily ticking numbers stay calm */
const CHIPS = [
  ['h-day', 'ui-i-day', { mode: 'any', cool: 900, neutral: true }],
  ['h-price', 'ui-i-avax', { mode: 'rel', th: .02, cool: 1400, trend: true }],
  ['h-wx', 'ui-i-sun', { mode: 'wx', cool: 0 }],
  ['h-wallet', 'ui-i-wallet', { mode: 'any', cool: 200 }],
  ['h-pts', 'ui-i-star', { mode: 'rel', th: .03, abs: 2.5, cool: 1400 }],
  ['h-net', 'ui-i-net', { mode: 'rel', th: .012, cool: 1600 }],
];
let spark = null, sctx = null, sparkW = 0, sparkH = 0, sparkT = 0;

function pulse(s, dir, t) {
  s.at = t; s.flip = !s.flip;
  const c = s.chip.classList;
  c.remove('ui-pa', 'ui-pb', 'ui-up', 'ui-down');
  c.add(s.flip ? 'ui-pa' : 'ui-pb');
  if (dir > 0) c.add('ui-up'); else if (dir < 0) c.add('ui-down');
}
function onChip(s) {
  const text = s.el.textContent;
  if (text === s.last) return;             // the core rewrites every 200 ms; only real changes count
  s.last = text;
  const o = s.o, t = now(), v = num(text);
  if (o.trend) {
    const tr = s.el.classList.contains('down') ? 'down' : 'up';
    if (tr !== s.trend) {
      const had = s.trend != null;
      s.trend = tr; s.chip.setAttribute('data-ui-trend', tr);
      if (had && t - s.at >= o.cool) { pulse(s, tr === 'up' ? 1 : -1, t); s.pv = v; return; }
    }
  }
  if (o.mode === 'wx') {
    const k = wxKey(text);
    if (k === s.wx) return;
    s.wx = k; setUse(s.svg, WX_ICON[k]); s.chip.setAttribute('data-ui-wx', k);
    pulse(s, k === 'bao' ? -1 : k === 'nang' ? 1 : 0, t);
    return;
  }
  if (!isFinite(v)) return;
  if (!isFinite(s.pv)) { s.pv = v; return; }
  if (o.mode === 'any') {
    if (t - s.at >= o.cool) pulse(s, o.neutral ? 0 : Math.sign(v - s.pv), t);
    s.pv = v;
    return;
  }
  const d = v - s.pv, need = Math.max(o.abs || 0, Math.abs(s.pv) * o.th);
  if (Math.abs(d) >= need && t - s.at >= o.cool) { pulse(s, Math.sign(d), t); s.pv = v; }
}

function hud() {
  const brand = $('.hud .brand');
  if (brand && !brand.querySelector('.ui-logo')) brand.insertAdjacentHTML('afterbegin', svgUse('ui-logo', 'ui-logo'));

  for (const id of ['sp0', 'sp1', 'sp2', 'b-storm', 'b-design', 'b-wallet']) {
    const b = doc.getElementById(id);
    if (!b) continue;
    b.classList.add('ui-i');
    // the core rewrites only #b-wallet's text, so the others can carry a label span that phones hide
    if (id !== 'b-wallet' && !b.querySelector('.ui-lbl') && b.childElementCount === 0) {
      const label = b.textContent;
      b.textContent = '';
      const sp = doc.createElement('span');
      sp.className = 'ui-lbl';
      sp.textContent = label;
      b.appendChild(sp);
    }
  }
  const bd = doc.getElementById('b-design');
  if (bd && !bd.getAttribute('title')) bd.setAttribute('title', 'Bản thiết kế');

  for (const [id, icon, o] of CHIPS) {
    const el = doc.getElementById(id), chip = el && el.closest && el.closest('.chip');
    if (!chip || chip.querySelector('.ui-ci')) continue;
    chip.insertAdjacentHTML('afterbegin', '<span class="ui-ci" aria-hidden="true">' + svgUse(icon) + '</span>');
    const lab = chip.querySelector('small');
    if (lab && !chip.getAttribute('title')) chip.setAttribute('title', lab.textContent.trim());
    const text = el.textContent;
    const s = { el, chip, o, svg: chip.querySelector('.ui-ci svg'), last: text, pv: num(text), at: -1e9, flip: false, wx: null, trend: null };
    if (o.mode === 'wx') { s.wx = wxKey(text); setUse(s.svg, WX_ICON[s.wx]); chip.setAttribute('data-ui-wx', s.wx); }
    if (o.trend) { s.trend = el.classList.contains('down') ? 'down' : 'up'; chip.setAttribute('data-ui-trend', s.trend); sparkInit(chip); }
    if (typeof MutationObserver === 'function') {
      new MutationObserver(guard('chip ' + id, () => onChip(s))).observe(el, { childList: true, characterData: true, subtree: true });
    }
  }
}

function sparkInit(chip) {
  if (spark) return;
  const c = doc.createElement('canvas');
  c.className = 'ui-spark';
  c.setAttribute('aria-hidden', 'true');
  chip.appendChild(c);
  spark = c;
  sctx = c.getContext ? c.getContext('2d') : null;
  sizeSpark();
}
function sizeSpark() { if (spark) { sparkW = spark.clientWidth || 0; sparkH = spark.clientHeight || 0; } }
function drawSpark() {
  if (!sctx || !sparkW || !sparkH) return;
  const h = F.st && F.st.hist;
  if (!h || h.length < 2) return;
  const d = Math.min(2, window.devicePixelRatio || 1), W = Math.max(1, Math.round(sparkW * d)), H = Math.max(1, Math.round(sparkH * d));
  if (spark.width !== W || spark.height !== H) { spark.width = W; spark.height = H; }
  const g = sctx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const n = Math.min(h.length, 72), i0 = h.length - n;
  let lo = Infinity, hi = -Infinity;
  for (let i = i0; i < h.length; i++) { const p = h[i].p; if (p < lo) lo = p; if (p > hi) hi = p; }
  if (!isFinite(lo) || !isFinite(hi)) return;
  const span = Math.max(hi - lo, Math.abs(hi) * .004, 1e-6);
  const x0 = 2 * d, x1 = W - 2 * d, y0 = 3 * d, y1 = H - 2 * d;
  const X = i => x0 + (x1 - x0) * (i - i0) / Math.max(1, n - 1), Y = p => y1 - (y1 - y0) * (p - lo) / span;
  const down = spark.parentNode && spark.parentNode.getAttribute && spark.parentNode.getAttribute('data-ui-trend') === 'down';
  const col = down ? '255,128,108' : '134,211,111';
  g.beginPath();
  for (let i = i0; i < h.length; i++) { const x = X(i), y = Y(h[i].p); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.lineTo(x1, y1); g.lineTo(x0, y1); g.closePath();
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, 'rgba(' + col + ',.30)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
  g.fillStyle = gr; g.fill();
  g.beginPath();
  for (let i = i0; i < h.length; i++) { const x = X(i), y = Y(h[i].p); if (i === i0) g.moveTo(x, y); else g.lineTo(x, y); }
  g.lineWidth = 1.3 * d; g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = 'rgba(' + col + ',.8)'; g.stroke();
  g.fillStyle = 'rgba(' + col + ',1)';
  g.beginPath(); g.arc(X(h.length - 1), Y(h[h.length - 1].p), 1.9 * d, 0, Math.PI * 2); g.fill();
}

/* ------------------------------------------------------------------ hint */
let hintEl = null, hintDim = false, hintX = 0, hintY = 0;
function hint() {
  hintEl = $('.hint');
  if (!hintEl || hintEl.querySelector('kbd')) return;
  hintEl.innerHTML =
    '<span class="ui-kg" aria-hidden="true"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>/</span>' +
    '<kbd aria-label="phím mũi tên">←↑↓→</kbd><span>đi</span><span class="ui-sep" aria-hidden="true"></span>' +
    '<kbd>E</kbd><span>mở</span><span class="ui-sep" aria-hidden="true"></span>' +
    '<span class="ui-tap" aria-hidden="true"></span><span>chạm khu vực để tới</span>';
  hintX = F.player.x; hintY = F.player.y;
}
function hintTick() {
  if (hintDim || !hintEl) return;
  const p = F.player;
  if (Math.abs(p.x - hintX) + Math.abs(p.y - hintY) > 5) { hintDim = true; hintEl.classList.add('ui-dim'); }
}

/* ------------------------------------------------------------------ zone panel */
const ZONE_ART = { home: 1, lend: 1, orchard: 1, pond: 1, market: 1, coop: 1, butler: 1, neighbor: 1, gate: 1, design: 1, wallet: 1 };
let panel = null, phead = null, emblem = null, shown = false, lastId = null, swapFlip = false, closeTok = 0, swiped = false;
function setZone(id) {
  if (!panel) return;
  panel.setAttribute('data-ui-zone', id || '');
  if (emblem) setUse(emblem, 'ui-z-' + (ZONE_ART[id] ? id : 'home'));
}
function panelSetup() {
  panel = $('#panel');
  if (!panel) return;
  phead = panel.querySelector('.phead');
  if (phead && !phead.querySelector('.ui-emblem')) {
    phead.insertAdjacentHTML('afterbegin', '<span class="ui-emblem" aria-hidden="true">' + svgUse('ui-z-home') + '</span>');
    emblem = phead.querySelector('.ui-emblem svg');
  }
  shown = !panel.hidden;
  lastId = F.current || null;
  if (lastId) setZone(lastId);

  F.on('open', guard('open', id => {
    closeTok++;
    panel.classList.remove('ui-closing');
    setZone(id);
    if (shown && id !== lastId && !reduce) {   // switching boards while open: refresh the content, keep the frame
      panel.classList.remove('ui-swap-a', 'ui-swap-b');
      panel.classList.add(swapFlip ? 'ui-swap-a' : 'ui-swap-b');
      swapFlip = !swapFlip;
    }
    shown = true; lastId = id;
  }));
  F.on('close', guard('close', () => {
    shown = false;
    panel.classList.remove('ui-swap-a', 'ui-swap-b');
    if (swiped || reduce) return;
    const tok = ++closeTok;
    panel.classList.add('ui-closing');                       // keeps it painted while it slides away
    setTimeout(() => { if (tok === closeTok) panel.classList.remove('ui-closing'); }, 320);
  }));
  swipeSetup();
}
function swipeSetup() {
  if (!phead) return;
  let pid = null, y0 = 0, dy = 0, t0 = 0;
  phead.addEventListener('pointerdown', guard('swipe', e => {
    if (pid !== null || e.pointerType === 'mouse' || (window.innerWidth || 0) > 760 || !F.current) return;
    if (e.target && e.target.closest && e.target.closest('button,a,input,select')) return;
    pid = e.pointerId; y0 = e.clientY; dy = 0; t0 = now();
    try { phead.setPointerCapture(pid); } catch (_) {}
    panel.style.transition = 'none';
  }));
  phead.addEventListener('pointermove', guard('swipe', e => {
    if (e.pointerId !== pid) return;
    dy = Math.max(0, e.clientY - y0);
    panel.style.transform = dy > 0 ? 'translateY(' + Math.round(dy) + 'px)' : '';
  }));
  const end = guard('swipe', e => {
    if (e.pointerId !== pid) return;
    pid = null;
    const v = dy / Math.max(16, now() - t0);
    if (dy > 90 || (dy > 28 && v > .55)) {
      swiped = true;
      panel.style.transition = reduce ? 'none' : 'transform .2s cubic-bezier(.5,0,.75,0)';
      panel.style.transform = 'translateY(calc(100% + 24px))';
      setTimeout(() => {
        try { if (F.current) F.closePanel(); } catch (err) { report('swipe close', err); }
        panel.style.transition = ''; panel.style.transform = ''; swiped = false;
      }, reduce ? 0 : 190);
    } else if (dy > 0) {
      panel.style.transition = 'transform .32s cubic-bezier(.2,1.3,.4,1)';
      panel.style.transform = '';
      setTimeout(() => { if (pid === null) panel.style.transition = ''; }, 340);
    } else panel.style.transition = '';
    dy = 0;
  });
  phead.addEventListener('pointerup', end);
  phead.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ toast */
function kindOf(msg) {
  const m = String(msg || '').toLowerCase();
  if (/bão/.test(m)) return 'storm';
  if (/hạn hán|thanh lý|lỗi|thất bại|revert|từ chối|bị huỷ|bị hủy/.test(m)) return 'danger';
  if (/^đã|thành công/.test(m)) return 'ok';
  if (/trộm|nhập |chỉ còn|chỉ có|chỉ vay|chưa|không|trống|kín chỗ|vượt|đang nợ|đang canh|hãy|trước/.test(m)) return 'warn';
  return 'info';
}
function toastSetup() {
  const el = $('#toast');
  if (!el) return;
  let flip = false, wasHidden = el.hidden, tok = 0;
  F.on('toast', guard('toast', msg => {
    el.setAttribute('data-ui-kind', kindOf(msg));
    tok++;
    el.classList.remove('ui-leaving');
    if (!el.hidden) { flip = !flip; el.classList.toggle('ui-tb', flip); }   // replay entrance + timer
  }));
  if (typeof MutationObserver !== 'function') return;
  new MutationObserver(guard('toast hide', () => {
    const h = el.hidden;
    if (h === wasHidden) return;
    wasHidden = h;
    if (h && !reduce) {
      const my = ++tok;
      el.classList.add('ui-leaving');
      setTimeout(() => { if (my === tok) el.classList.remove('ui-leaving'); }, 300);
    } else el.classList.remove('ui-leaving');
  })).observe(el, { attributes: true, attributeFilter: ['hidden'] });
}

/* ------------------------------------------------------------------ prompt bubble over the farmer */
let pr = null, prVis = false, prLeave = 0, prL = null, prW = 0, prH = 0, px = NaN, py = NaN, ptail = NaN, below = false, anchored = false, stageW = 0;
let canAnchor = false;
function measureStage() { stageW = (F.stage && F.stage.clientWidth) || 0; }
function promptSetup() {
  pr = $('#prompt');
  if (!pr) return;
  prVis = !pr.hidden;
  try { canAnchor = !!(window.CSS && CSS.supports && CSS.supports('translate', '1px 2px')); } catch (e) { canAnchor = false; }
  measureStage();
}
function syncPrompt() {
  if (!pr) return;
  const t = now(), vis = !pr.hidden;
  if (vis !== prVis) {
    prVis = vis;
    if (vis) { pr.classList.remove('ui-leaving'); prLeave = 0; }
    else if (anchored && !reduce) { pr.classList.add('ui-leaving'); prLeave = t + 190; }
  }
  if (prLeave && t >= prLeave) { pr.classList.remove('ui-leaving'); prLeave = 0; }
  if (!canAnchor || (!vis && !prLeave)) return;
  const lbl = pr.getAttribute('data-l') || '';
  if (lbl !== prL || !prW) { prL = lbl; prW = pr.offsetWidth || 0; prH = pr.offsetHeight || 0; }
  if (!prW || !prH) return;
  if (!stageW) measureStage();
  const p = F.player, head = F.toScreen(p.x, p.y - 1.42);
  let x = head.x, y = head.y, b = false;
  const half = prW / 2 + 8;
  if (stageW > half * 2) x = Math.min(stageW - half, Math.max(half, x));
  if (y - prH < 8) { y = F.toScreen(p.x, p.y + .45).y; b = true; }   // near the top edge: hang it under the feet
  x = Math.round(x); y = Math.round(y);
  const tail = Math.round(Math.max(18 - prW / 2, Math.min(prW / 2 - 18, head.x - x)));
  if (b !== below) { below = b; pr.classList.toggle('ui-below', b); }
  if (x !== px || y !== py) { px = x; py = y; pr.style.translate = x + 'px ' + y + 'px'; }
  if (tail !== ptail) { ptail = tail; pr.style.setProperty('--ui-tail', tail + 'px'); }
  if (!anchored) { anchored = true; pr.classList.add('ui-anchored'); }
}

/* ------------------------------------------------------------------ transaction log */
function logSetup() {
  const el = $('#log');
  if (!el) return;
  let flip = false;
  F.on('tx', guard('tx', () => {
    const p = el.querySelector('p');                 // renderLog puts the newest letter first
    if (p && !reduce) p.classList.add('ui-new');
    flip = !flip;
    el.classList.remove('ui-ping-a', 'ui-ping-b');
    el.classList.add(flip ? 'ui-ping-a' : 'ui-ping-b');
  }));
}

/* ------------------------------------------------------------------ splash */
const SPLASH_KEY = 'ntd.splash.v1';
const GAME_KEYS = new Set(['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'e', ' ', 'enter', 'escape']);
function landSVG() {
  const R = (a, b, c) => { try { return F.hsh(a, b, c); } catch (e) { return .5; } };
  const f1 = v => v.toFixed(1);
  let s = '<svg class="ui-sp-land" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="ui-sp-fld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f5b35"/><stop offset="1" stop-color="#0f1d14"/></linearGradient>' +
    '<linearGradient id="ui-sp-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b3552"/><stop offset="1" stop-color="#202a30"/></linearGradient>' +
    '<radialGradient id="ui-sp-lg"><stop offset="0" stop-color="#ffd27a" stop-opacity=".95"/><stop offset=".4" stop-color="#ff8a4a" stop-opacity=".45"/><stop offset="1" stop-color="#e8604a" stop-opacity="0"/></radialGradient></defs>';
  s += '<path d="M0 252L96 206L170 236L292 138L382 214L472 170L560 228L700 118L802 206L902 160L1012 224L1112 176L1200 212V420H0Z" fill="#4c3058"/>';
  s += '<path d="M292 138L322 166L304 160L288 172L266 160ZM700 118L732 148L712 141L694 154L670 142ZM902 160L926 182L910 178L896 186L880 178Z" fill="#f4c9b8" opacity=".5"/>';
  s += '<path d="M0 292C140 254 260 290 380 270C520 246 610 290 742 270C880 250 990 288 1200 262V420H0Z" fill="url(#ui-sp-hill)"/>';
  let v = '<path d="M0 318C200 305 400 315 600 309C800 303 1000 315 1200 307V420H0Z"/>';
  let lights = '';
  for (const [x, w, h] of [[150, 120, 26], [304, 88, 22], [792, 110, 26], [934, 128, 24], [1088, 84, 20]]) {
    const y = 312;
    v += `<rect x="${x + 8}" y="${y - h}" width="${w - 16}" height="${h + 6}"/><path d="M${x - 12} ${y - h + 2}Q${x} ${y - h - 2} ${x + 10} ${y - h - 18}H${x + w - 10}Q${x + w} ${y - h - 2} ${x + w + 12} ${y - h + 2}Z"/>`;
    lights += `<rect x="${x + 22}" y="${y - h + 8}" width="8" height="7"/><rect x="${x + w - 30}" y="${y - h + 8}" width="8" height="7"/>`;
  }
  // cổng làng silhouetted against the sun
  v += '<rect x="546" y="236" width="16" height="80"/><rect x="638" y="236" width="16" height="80"/>' +
    '<path d="M514 245Q536 242 546 226H654Q664 242 686 245L672 253H528Z"/><path d="M556 224Q568 222 574 209H626Q632 222 644 224Z"/>' +
    '<rect x="566" y="253" width="68" height="14" rx="2"/>';
  for (const [cx, n, ci] of [[44, 9, 0], [1132, 8, 1], [462, 5, 2], [738, 5, 3]]) {
    for (let i = 0; i < n; i++) {
      const x = cx + (i - n / 2) * 7 + R(i, ci, 3) * 6, top = 196 + R(i, ci, 1) * 64, bend = (R(i, ci, 2) - .5) * 44;
      v += `<path d="M${f1(x)} 314Q${f1(x + bend * .35)} ${f1((314 + top) / 2)} ${f1(x + bend)} ${f1(top)}" fill="none" stroke="#14201b" stroke-width="${f1(3 + R(i, ci, 4) * 2)}" stroke-linecap="round"/>`;
      for (let k = 0; k < 4; k++) {
        const tt = .4 + k * .18, lx = x + bend * tt * tt, ly = 314 + (top - 314) * tt, a = (R(i, k, ci + 5) - .5) * 130;
        v += `<ellipse cx="${f1(lx)}" cy="${f1(ly)}" rx="12" ry="2.8" transform="rotate(${a.toFixed(0)} ${f1(lx)} ${f1(ly)})"/>`;
      }
    }
  }
  for (const [x, top] of [[258, 188], [1012, 198]]) {
    v += `<path d="M${x} 314Q${x + 7} 258 ${x + 2} ${top}" fill="none" stroke="#14201b" stroke-width="4"/>`;
    for (let k = 0; k < 7; k++) {
      const a = (-165 + k * 25) * Math.PI / 180, cx = x + 2, ex = cx + Math.cos(a) * 38, ey = top + Math.sin(a) * 22 + 14;
      v += `<path d="M${cx} ${top}Q${f1(cx + Math.cos(a) * 22)} ${f1(top + Math.sin(a) * 22 - 6)} ${f1(ex)} ${f1(ey)}" fill="none" stroke="#14201b" stroke-width="3" stroke-linecap="round"/>`;
    }
  }
  s += '<g fill="#14201b">' + v + '</g>';
  s += '<g fill="#ffcf7a" opacity=".75">' + lights + '</g>';
  s += '<path d="M578 260H622" stroke="#f2c14e" stroke-width="2" stroke-dasharray="5 3" opacity=".75"/>';
  s += '<circle cx="574" cy="283" r="24" fill="url(#ui-sp-lg)"/><circle cx="626" cy="283" r="24" fill="url(#ui-sp-lg)"/>' +
    '<path d="M574 267V275M626 267V275" stroke="#14201b" stroke-width="1.6"/>' +
    '<ellipse cx="574" cy="282" rx="6" ry="7.5" fill="#e8604a"/><ellipse cx="626" cy="282" rx="6" ry="7.5" fill="#e8604a"/>' +
    '<rect x="571" y="274" width="6" height="2" fill="#f2c14e"/><rect x="623" y="274" width="6" height="2" fill="#f2c14e"/>';
  s += '<path d="M0 334C300 321 900 321 1200 334V420H0Z" fill="url(#ui-sp-fld)"/>';
  let rows = '';
  for (let k = -11; k <= 11; k++) rows += `M${600 + k * 42} 330L${600 + k * 200} 420`;
  s += `<path d="${rows}" fill="none" stroke="#4d8a4c" stroke-width="1.6" opacity=".5"/>`;
  s += '<path d="M0 351C300 340 900 340 1200 351M0 378C300 365 900 365 1200 378" fill="none" stroke="#5c9a55" stroke-width="2" opacity=".42"/>';
  s += '<g fill="#ffd27a" opacity=".55"><ellipse cx="520" cy="343" rx="26" ry="1.6"/><ellipse cx="690" cy="347" rx="34" ry="1.8"/><ellipse cx="610" cy="360" rx="44" ry="2"/><ellipse cx="420" cy="367" rx="30" ry="1.8"/><ellipse cx="800" cy="373" rx="40" ry="2"/></g>';
  s += '<g fill="#0d1811"><path d="M846 406l4-27h14l4 27z"/><circle cx="857" cy="371" r="6"/><path d="M835 369L857 352L879 369Q857 374 835 369Z"/></g>' +
    '<path d="M835 369Q857 374 879 369" stroke="#ffcf7a" stroke-width="1.3" fill="none" opacity=".85"/>';
  return s + '</svg>';
}
function splash() {
  let seen = false;
  try { seen = window.sessionStorage.getItem(SPLASH_KEY) === '1'; } catch (e) {}
  if (seen || !doc.body) return false;
  try { window.sessionStorage.setItem(SPLASH_KEY, '1'); } catch (e) {}
  let done = false, timer = 0;
  const el = doc.createElement('div');
  const dismiss = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    try { window.removeEventListener('keydown', onKey, true); } catch (e) {}
    try {
      if (reduce) el.remove();
      else { el.classList.add('ui-out'); setTimeout(() => { try { el.remove(); } catch (e) {} }, 700); }
    } catch (e) { report('splash', e); }
    step('boot', () => boot(true));
  };
  const onKey = e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (GAME_KEYS.has(String(e.key || '').toLowerCase())) { e.preventDefault(); e.stopPropagation(); }
    dismiss();
  };
  timer = setTimeout(dismiss, 2600);        // armed first, so a later failure can never strand the overlay
  try {
    el.className = 'ui-splash';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="ui-sp-day"></div><div class="ui-sp-stars"></div>' +
      '<div class="ui-sp-sunwrap"><div class="ui-sp-rays"></div><div class="ui-sp-sun"></div></div>' +
      '<svg class="ui-sp-birds" viewBox="0 0 120 40" aria-hidden="true" focusable="false"><path d="M10 22q6-7 12 0q6-7 12 0M48 10q5-6 10 0q5-6 10 0M82 26q4-5 8 0q4-5 8 0" fill="none" stroke="#2a1a2c" stroke-width="2.2" stroke-linecap="round"/></svg>' +
      landSVG() +
      '<div class="ui-sp-motes"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      '<div class="ui-sp-card">' + svgUse('ui-logo', 'ui-sp-logo') +
        '<h1 class="ui-sp-title">Nông Trại <span>DeFi</span></h1>' +
        '<p class="ui-sp-sub">Gieo rau, trồng cây, thả cá: mỗi khu vườn trong làng là một cơ chế DeFi thật trên Avalanche.</p>' +
        '<span class="ui-sp-cta">Chạm để vào làng</span>' +
        '<p class="ui-sp-keys">hoặc nhấn phím bất kỳ</p>' +
        '<div class="ui-sp-bar"><i></i></div>' +
      '</div>';
    el.addEventListener('pointerdown', e => { try { e.preventDefault(); } catch (_) {} dismiss(); });
    el.addEventListener('click', dismiss);
    window.addEventListener('keydown', onKey, true);
    doc.body.appendChild(el);
  } catch (e) { report('splash', e); dismiss(); }
  return true;
}
function boot(replayPanel) {
  if (reduce) return;
  const app = F.app || $('#app');
  if (app) { app.classList.add('ui-boot'); setTimeout(() => app.classList.remove('ui-boot'), 1700); }
  if (replayPanel && panel && !panel.hidden) panel.classList.toggle('ui-re');   // slide the board in once the village shows
}

/* ------------------------------------------------------------------ wire up */
step('sprite', injectSprite);
step('icons', iconVars);
step('hud', hud);
step('hint', hint);
step('panel', panelSetup);
step('toast', toastSetup);
step('prompt', promptSetup);
step('log', logSetup);
let splashOn = false;
step('splash', () => { splashOn = splash(); });
if (!splashOn) step('boot', () => boot(false));

F.on('frame', guard('frame', dt => {
  hintTick();
  sparkT += dt || 0;
  if (sparkT >= .5) { sparkT = 0; drawSpark(); }
}));
F.on('screen', guard('screen', syncPrompt));
F.on('resize', guard('resize', () => { measureStage(); sizeSpark(); prW = 0; drawSpark(); }));
step('spark', drawSpark);
})();
