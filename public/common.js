'use strict';
// ===== Общие утилиты: REST, формат, таймер-кольцо, звук, конфетти =====

const RES_ICONS = { 'Сырьё': '🪨', 'Труд': '👷', 'Энергия': '⚡' };
const TEAM_EMOJI = { A: '🍞', B: '🛋️', C: '👕', D: '💻', E: '🧱' };
const TEAM_COLOR = { A: '#f59e0b', B: '#a78bfa', C: '#f472b6', D: '#60a5fa', E: '#34d399' };

async function api(path, body) {
  const r = await fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return await r.json().catch(() => ({ ok: false, error: 'Некорректный ответ сервера' }));
}

function fmt(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('ru-RU');
}
function fmtE(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(2).replace('.', ',');
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function recipeText(recipe) {
  return Object.keys(recipe).map(r => recipe[r] + ' ' + r.toLowerCase()).join(' + ');
}

// ---------- Звук (WebAudio, без файлов) ----------
const Snd = {
  muted: (function () { try { return localStorage.getItem('rpd_mute') === '1'; } catch (e) { return false; } })(),
  ctx: null,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type, gain, delay) {
    if (this.muted) return;
    const c = this.ensure(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.value = gain || 0.05;
    o.connect(g); g.connect(c.destination);
    const t = c.currentTime + (delay || 0);
    g.gain.setValueAtTime(gain || 0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  },
  bid() { this.tone(660, .09, 'triangle', .06); },
  outbid() { this.tone(392, .12, 'sawtooth', .04); this.tone(294, .16, 'sawtooth', .04, .11); },
  chime() { this.tone(880, .12, 'sine', .05); this.tone(1108, .14, 'sine', .05, .12); this.tone(1318, .22, 'sine', .05, .24); },
  tick() { this.tone(950, .03, 'square', .018); },
  ding() { this.tone(988, .1, 'sine', .05); this.tone(1318, .14, 'sine', .04, .1); },
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, .2, 'triangle', .07, i * .14)); },
  toggle() { this.muted = !this.muted; try { localStorage.setItem('rpd_mute', this.muted ? '1' : '0'); } catch (e) {} }
};
document.addEventListener('pointerdown', function () { Snd.ensure(); }, { once: true });

function injectChrome() {
  // фавикон
  if (!document.querySelector('link[rel=icon]')) {
    const l = document.createElement('link');
    l.rel = 'icon';
    l.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🏭</text></svg>';
    document.head.appendChild(l);
  }
  // кнопка звука
  const tb = document.querySelector('.topbar');
  if (tb && !document.getElementById('sndBtn')) {
    const b = document.createElement('button');
    b.className = 'sndbtn'; b.id = 'sndBtn'; b.title = 'Звук вкл/выкл';
    const paint = () => { b.textContent = Snd.muted ? '🔇' : '🔊'; };
    b.onclick = () => { Snd.toggle(); paint(); };
    paint(); tb.appendChild(b);
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectChrome);
else injectChrome();

// ---------- Кольцевой таймер ----------
let _timerInt = null, _timerDur = 0, _timerEnd = null, _tickSec = -1;
function startTimer(elId, timerEnd, onZero) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (_timerInt) { clearInterval(_timerInt); _timerInt = null; }
  if (!timerEnd) {
    el.innerHTML = '<span class="tnone">⏱ —</span>';
    el.className = 'timer';
    _timerEnd = null; _timerDur = 0;
    return;
  }
  if (timerEnd !== _timerEnd) { _timerEnd = timerEnd; _timerDur = Math.max(1, Math.round((timerEnd - Date.now()) / 1000)); _tickSec = -1; }
  const C = 100; // длина окружности при r=15.9155
  const paint = () => {
    const left = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
    const pct = Math.max(0, Math.min(100, Math.round(left / _timerDur * 100)));
    const m = Math.floor(left / 60), s = left % 60;
    let cls = 'timer ring';
    if (pct <= 20 || left <= 30) cls += ' danger'; else if (pct <= 50) cls += ' warn';
    if (left <= 10 && left > 0) cls += ' urgent';
    el.className = cls;
    el.innerHTML =
      '<svg viewBox="0 0 36 36" aria-hidden="true">' +
      '<circle class="ring-bg" cx="18" cy="18" r="15.9155"/>' +
      '<circle class="ring-fg" cx="18" cy="18" r="15.9155" stroke-dasharray="' + pct + ' ' + (C - pct) + '"/>' +
      '</svg><span class="ring-text">' + m + ':' + String(s).padStart(2, '0') + '</span>';
    if (left <= 10 && left > 0 && left !== _tickSec) { _tickSec = left; Snd.tick(); }
    if (left <= 0) { clearInterval(_timerInt); _timerInt = null; if (onZero) onZero(); }
  };
  paint();
  _timerInt = setInterval(paint, 250);
}

// ---------- Анимация чисел ----------
const _prevNums = {};
function setNum(el, val, key) {
  if (!el) return;
  key = key || el.id || ('k' + Math.random());
  const from = Number(_prevNums[key] !== undefined ? _prevNums[key] : val) || 0;
  const to = Number(val) || 0;
  _prevNums[key] = to;
  if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 600;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- Конфетти ----------
function confetti(ms) {
  if (document.getElementById('confettiCv')) return;
  const c = document.createElement('canvas');
  c.id = 'confettiCv';
  c.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  c.width = window.innerWidth; c.height = window.innerHeight;
  document.body.appendChild(c);
  const x = c.getContext('2d');
  const colors = ['#ffb703', '#fb8500', '#2dc653', '#8ecae6', '#ef476f', '#ffd166'];
  const P = Array.from({ length: 150 }, () => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
    s: 4 + Math.random() * 7, v: 2 + Math.random() * 3.5,
    a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.25,
    col: colors[Math.floor(Math.random() * colors.length)]
  }));
  let n = 0, max = Math.round((ms || 3500) / 16);
  const iv = setInterval(() => {
    x.clearRect(0, 0, c.width, c.height);
    P.forEach(p => {
      p.y += p.v; p.a += p.va; p.x += Math.sin(p.a) * 1.4;
      x.save(); x.translate(p.x, p.y); x.rotate(p.a);
      x.fillStyle = p.col; x.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62);
      x.restore();
    });
    if (++n > max) { clearInterval(iv); c.remove(); }
  }, 16);
}

// ---------- Таблица спроса (подсвечивает максимум выручки) ----------
function demandTableHTML(demand, myPrice) {
  const prices = Object.keys(demand).map(Number).sort((a, b) => a - b);
  let maxRev = -1, maxP = null;
  for (const p of prices) { const rev = p * demand[p]; if (rev > maxRev) { maxRev = rev; maxP = p; } }
  let rows = '';
  for (const p of prices) {
    const tr = demand[p], rev = p * tr;
    let cls = '';
    if (myPrice === p) cls = ' class="hl"';
    else if (p === maxP) cls = ' class="best"';
    rows += '<tr' + cls + '><td>' + p + '</td><td>' + tr + '</td><td>' + fmt(rev) + '</td></tr>';
  }
  return '<table class="tbl"><thead><tr><th>Цена, д.е.</th><th>Спрос, шт.</th><th>Выручка TR, д.е.</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ---------- Тосты ----------
function toast(msg, ok) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = ok === false ? 'bad' : 'good';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'hide'; }, 3600);
}

const PHASE_TITLES = {
  lobby: 'Ожидание начала', intro: 'Знакомство с игрой',
  round1: 'Раунд 1 · Анализ спроса', auction1: 'Раунд 2 · Аукцион ресурсов',
  auction2: 'Торги по лоту', round3: 'Раунд 3 · Производство',
  market4: 'Раунд 4 · Рынок и равновесие', round5: 'Раунд 5 · Эластичность спроса',
  round6: 'Раунд 6 · Эластичность предложения', final: 'Раунд 7 · Итоговый расчёт',
  results: 'Итоги игры'
};