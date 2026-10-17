/* Nông Trại DeFi · tutorial (prototype/tutorial.js)
   A short guided tour for first-time players: move, minimap, deposit in Ruộng rau, plant in Vườn cây, the risk
   zones, then the real wallet. Every step can be skipped and the whole tour can be skipped; "Hướng dẫn" in the
   HUD replays it. It only talks to window.FARM and the DOM. */
(() => {
'use strict';
const F = window.FARM;
if (!F || window.FarmTutorial) return;
const doc = document, $ = (s) => doc.querySelector(s);
const KEY = 'ntd.tutorial.v1';
const T = F.T, TAU = Math.PI * 2;

const store = {
  get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } },
};

/* ---------------------------------------------------------------- steps
   target: zone id → arrow on the map; el: CSS selector → glowing outline; done(ev): completes the step. */
const STEPS = [
  { title: 'Chào mừng tới làng!', text: 'Mỗi khu trong làng là một cách cho tiền sinh lời, giống ngoài đời nhưng dùng <b>tiền thử</b>. Hướng dẫn chỉ mất khoảng 1 phút.', next: 'Bắt đầu' },
  { title: 'Di chuyển', text: 'Đi bằng <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> hoặc phím mũi tên. Trên điện thoại thì <b>chạm vào bản đồ</b>. Thử đi vài bước nhé.', done: (e) => e.type === 'moved' },
  { title: 'Bản đồ nhỏ', text: 'Góc màn hình là <b>bản đồ nhỏ</b>. Bấm vào một khu trên đó, nhân vật tự đi tới.', el: '.mm', next: 'Đã hiểu' },
  { title: 'Ruộng rau = gửi tiết kiệm', text: 'Đi theo <b>mũi tên vàng</b> tới <b>Ruộng rau</b>, đứng cạnh biển gỗ rồi bấm <kbd>E</kbd>.', target: 'lend', done: (e) => e.type === 'open' && e.id === 'lend' },
  { title: 'Gieo hạt', text: 'Ruộng rau giống <b>gửi tiết kiệm</b>: gửi USDC vào, mỗi ngày có lãi (4%/năm), rút lúc nào cũng được. Bấm <b>Gieo hạt (gửi)</b> để thử.', el: '[data-act="lend-dep"],[data-act="c-lend-dep"]', done: (e) => e.type === 'act' && /lend-dep$/.test(e.act) },
  { title: 'Vườn cây = gửi có kỳ hạn', text: 'Giờ tới <b>Vườn cây</b>. Tiền bị <b>khóa</b> 7, 30 hoặc 90 ngày. Khóa càng lâu, lãi càng cao. Nhổ sớm thì lấy lại tiền nhưng mất lãi.', target: 'orchard', done: (e) => e.type === 'open' && e.id === 'orchard' },
  { title: 'Rủi ro: Ao cá và Hợp tác xã', text: '<b>Ao cá</b>: góp tiền để người khác đổi tiền, bạn được chia phí, nhưng giá biến động thì tiền góp có thể hao. <b>Hợp tác xã</b>: vay tiền bằng cách gửi AVAX làm đảm bảo, giá AVAX giảm mạnh thì bị lấy mất AVAX. Bấm <b>Gây bão</b> để xem (chỉ là mô phỏng).', el: '#b-storm', next: 'Tiếp' },
  { title: 'Chơi thật trên blockchain', text: 'Bấm <b>Kết nối ví</b> rồi chọn <b>Email / Google</b>. Không cần cài gì, không mất phí: game trả phí giao dịch giúp bạn. Vào Ruộng rau, bấm <b>Nhận 1.000 USDC test</b> để có tiền chơi.', el: '#b-wallet', next: 'Tiếp' },
  { title: 'Sẵn sàng rồi!', text: 'Muốn xem lại, bấm <b>Hướng dẫn</b> trên thanh trên cùng. Chúc bạn được mùa!', next: 'Chơi thôi' },
];

/* ---------------------------------------------------------------- styles */
const css = `
.tut{position:absolute;left:50%;bottom:calc(74px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:8;width:min(440px,calc(100% - 32px));
  background:linear-gradient(180deg,#26372e,#1c2a23);border:2px solid #f2c14e;border-radius:16px;box-shadow:0 18px 44px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.08);
  color:#f3ecd9;font-family:"Be Vietnam Pro",system-ui,sans-serif;padding:14px 16px 12px;display:flex;flex-direction:column;gap:8px;animation:tut-in .35s cubic-bezier(.2,1.4,.4,1)}
.tut[hidden]{display:none!important}
.tut-top{display:flex;align-items:center;gap:10px}
.tut-badge{flex:none;width:34px;height:34px;border-radius:50%;background:#f2c14e;color:#0f1814;display:grid;place-items:center;font:800 15px "Baloo 2",system-ui,sans-serif;box-shadow:0 0 0 3px rgba(242,193,78,.25)}
.tut h3{margin:0;font:800 19px/1.1 "Baloo 2",system-ui,sans-serif;color:#f2c14e;text-wrap:balance}
.tut p{margin:0;font-size:13.5px;line-height:1.55;color:#d9d3bf}
.tut p b{color:#f3ecd9}
.tut kbd{font-family:ui-monospace,Consolas,monospace;font-size:11px;background:#0f1814;border:1px solid #3a5145;border-bottom-width:2px;border-radius:5px;padding:0 5px;margin:0 1px;color:#f3ecd9}
.tut-foot{display:flex;align-items:center;gap:8px;margin-top:2px}
.tut-dots{display:flex;gap:4px;margin-right:auto}
.tut-dots i{width:7px;height:7px;border-radius:50%;background:#3a5145}
.tut-dots i.on{background:#f2c14e}
.tut-dots i.done{background:#86d36f}
.tut button{white-space:nowrap;font:700 13px "Be Vietnam Pro",system-ui,sans-serif;border-radius:9px;padding:7px 12px;cursor:pointer;border:1px solid #3a5145;background:#26372e;color:#f3ecd9}
.tut button:hover{border-color:#f2c14e}
.tut button.go{background:#f2c14e;color:#0f1814;border-color:#f2c14e}
.tut button.skip{background:transparent;color:#aebaa3}
.tut-wait{white-space:nowrap;font-size:12px;color:#f2c14e;display:flex;align-items:center;gap:6px}
.tut-wait::before{content:"";width:8px;height:8px;border-radius:50%;background:#f2c14e;animation:tut-pulse 1s infinite}
.tut-glow{outline:3px solid #f2c14e!important;outline-offset:3px;border-radius:10px;animation:tut-ring 1.2s ease-in-out infinite}
@keyframes tut-in{from{opacity:0;transform:translate(-50%,16px) scale(.96)}to{opacity:1;transform:translate(-50%,0) scale(1)}}
@keyframes tut-pulse{50%{opacity:.25}}
@keyframes tut-ring{50%{outline-color:rgba(242,193,78,.35);box-shadow:0 0 18px rgba(242,193,78,.6)}}
@media (max-width:760px){.tut{bottom:auto;top:calc(10px + env(safe-area-inset-top,0px))}.app.open .tut{top:10px}}
@media (prefers-reduced-motion:reduce){.tut,.tut-glow,.tut-wait::before{animation:none!important}}
`;
const style = doc.createElement('style'); style.textContent = css; doc.head.appendChild(style);

/* ---------------------------------------------------------------- DOM */
const card = doc.createElement('div');
card.className = 'tut'; card.hidden = true; card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite'); card.setAttribute('aria-label', 'Hướng dẫn chơi');
card.innerHTML = `<div class="tut-top"><div class="tut-badge" id="tut-n">1</div><h3 id="tut-t"></h3></div><p id="tut-x"></p>
  <div class="tut-foot"><div class="tut-dots" id="tut-d"></div><span class="tut-wait" id="tut-w" hidden>Đang chờ…</span>
  <button class="skip" id="tut-skip" type="button">Bỏ qua</button><button class="go" id="tut-next" type="button">Tiếp</button></div>`;
F.stage.appendChild(card);
const el = { n: $('#tut-n'), t: $('#tut-t'), x: $('#tut-x'), d: $('#tut-d'), w: $('#tut-w'), skip: $('#tut-skip'), next: $('#tut-next') };

// replay button in the HUD
const ctrls = $('.hud .ctrls');
const replay = doc.createElement('button');
replay.className = 'btn'; replay.id = 'b-tutorial'; replay.type = 'button'; replay.textContent = 'Hướng dẫn'; replay.title = 'Xem lại hướng dẫn chơi';
if (ctrls) ctrls.insertBefore(replay, $('#b-design') || null);

/* ---------------------------------------------------------------- state */
let i = -1, glowEl = null, start = null;
const active = () => i >= 0;

function clearGlow() { if (glowEl) glowEl.classList.remove('tut-glow'); glowEl = null; }
function applyGlow() {
  clearGlow();
  const s = STEPS[i];
  if (!s || !s.el) return;
  const e = $(s.el);
  if (e) { glowEl = e; e.classList.add('tut-glow'); }
}

function render() {
  const s = STEPS[i];
  el.n.textContent = String(i + 1);
  el.t.textContent = s.title;
  el.x.innerHTML = s.text;
  el.d.innerHTML = STEPS.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('');
  const waits = !!s.done;
  el.w.hidden = !waits;
  el.next.textContent = waits ? 'Bỏ bước' : (s.next || 'Tiếp');
  el.next.classList.toggle('go', !waits);
  el.skip.hidden = i === STEPS.length - 1;
  card.hidden = false;
  // restart the entrance animation
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  applyGlow();
}

function go(k) {
  i = k;
  if (i >= STEPS.length) return finish();
  if (STEPS[i].done && STEPS[i].done({ type: 'enter' })) return go(i + 1);
  if (i === 1) start = { x: F.player.x, y: F.player.y };
  render();
}
function finish() { i = -1; card.hidden = true; clearGlow(); store.set('done'); }
function begin() { if (F.current && F.current !== 'home') F.closePanel(); go(0); }

el.next.onclick = () => go(i + 1);
el.skip.onclick = () => { finish(); F.toast('Đã bỏ qua hướng dẫn. Bấm "Hướng dẫn" trên thanh trên cùng để xem lại.'); };
replay.onclick = () => begin();
addEventListener('keydown', (e) => { if (active() && e.key === 'Escape' && !F.current) { finish(); } });

function event(ev) {
  if (!active()) return;
  const s = STEPS[i];
  if (s.done && s.done(ev)) setTimeout(() => { if (active() && STEPS[i] === s) go(i + 1); }, ev.type === 'act' ? 900 : 350);
}
F.on('open', (id) => { event({ type: 'open', id }); if (active()) setTimeout(applyGlow, 60); });
F.on('close', () => { if (active()) setTimeout(applyGlow, 60); });
F.stage.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-act]'); if (b) event({ type: 'act', act: b.dataset.act }); }, true);
F.on('frame', () => {
  if (!active() || i !== 1 || !start) return;
  if (Math.hypot(F.player.x - start.x, F.player.y - start.y) > 2) { start = null; event({ type: 'moved' }); }
});

/* ---------------------------------------------------------------- map arrow */
function targetPoint() {
  const s = active() && STEPS[i];
  if (!s || !s.target || F.current === s.target) return null;
  const z = F.Z[s.target];
  return z ? { x: (z.sx != null ? z.sx : z.ax) * T, y: ((z.sx != null ? z.sy : z.ay) - 1.4) * T } : null;
}
F.on('worldTop', (ctx, t) => {
  const p = targetPoint(); if (!p) return;
  const b = F.reduce ? 0 : Math.sin(t * 5) * 5, x = Math.round(p.x), y = Math.round(p.y + b);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.moveTo(x - 11, y - 13); ctx.lineTo(x + 11, y - 13); ctx.lineTo(x + 2, y + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a1d14'; ctx.beginPath(); ctx.moveTo(x - 12, y - 17); ctx.lineTo(x + 12, y - 17); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.moveTo(x - 9, y - 15); ctx.lineTo(x + 9, y - 15); ctx.lineTo(x, y - 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff1b8'; ctx.fillRect(x - 6, y - 14, 5, 2);
  ctx.restore();
});
// off-screen: an edge arrow pointing toward the target
F.on('screen', (ctx, t, w, h) => {
  const p = targetPoint(); if (!p) return;
  const k = F.zoom * F.dpr, sx = (p.x - F.cam.x) * k, sy = (p.y - F.cam.y) * k, m = 60 * F.dpr;
  if (sx > m && sx < w - m && sy > m && sy < h - m) return;
  const cx = w / 2, cy = h / 2, a = Math.atan2(sy - cy, sx - cx);
  const ex = Math.max(m, Math.min(w - m, sx)), ey = Math.max(m, Math.min(h - m, sy));
  ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
  const s = F.dpr * (1 + (F.reduce ? 0 : Math.sin(t * 6) * .08));
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(15,24,20,.85)'; ctx.beginPath(); ctx.arc(0, 0, 17, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#f2c14e'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#f2c14e'; ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
  ctx.restore();
});

/* ---------------------------------------------------------------- auto start after the splash */
window.FarmTutorial = { start: begin, stop: finish, get step() { return i; }, steps: STEPS.length };
if (store.get() !== 'done') {
  let tries = 0;
  const wait = setInterval(() => {
    tries++;
    if (!$('.ui-splash') || tries > 60) { clearInterval(wait); setTimeout(() => { if (!active() && store.get() !== 'done') begin(); }, 500); }
  }, 300);
}
})();
