// ============================================================
// Общие клиентские утилиты (подключается на всех страницах)
// ============================================================
'use strict';

const RES_ICONS = { 'Сырьё': '🪨', 'Труд': '👷', 'Энергия': '⚡' };
const TEAM_EMOJI = { A: '🍞', B: '🛋️', C: '👕', D: '💻', E: '🧱' };

// ---------- REST ----------
async function api(path, body) {
  const r = await fetch(path, {
    method: body !== undefined ? 'POST' : 'GET',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({ ok: false, error: 'Некорректный ответ сервера' }));
  return j;
}

// ---------- Форматирование ----------
function fmt(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('ru-RU');
}
function fmtE(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '—';
  const x = Number(n);
  return (x > 0 ? '' : '') + x.toFixed(2).replace('.', ',');
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Таймер ----------
let _timerInt = null;
function startTimer(elId, timerEnd, onZero) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (_timerInt) clearInterval(_timerInt);
  if (!timerEnd) { el.textContent = ''; return; }
  const tick = () => {
    const left = Math.max(0, Math.round((timerEnd - Date.now()) / 1000));
    const m = Math.floor(left / 60), s = left % 60;
    el.textContent = `⏱ ${m}:${String(s).padStart(2, '0')}`;
    el.style.color = left <= 30 ? '#ff6b6b' : '';
    if (left <= 0) { clearInterval(_timerInt); _timerInt = null; if (onZero) onZero(); }
  };
  tick();
  _timerInt = setInterval(tick, 500);
}

// ---------- Таблица спроса ----------
function demandTableHTML(demand, myPrice) {
  const prices = Object.keys(demand).map(Number).sort((a, b) => a - b);
  let rows = '';
  for (const p of prices) {
    const tr = demand[p];
    const rev = p * tr;
    const hl = myPrice === p ? ' class="hl"' : '';
    rows += `<tr${hl}><td>${p}</td><td>${tr}</td><td>${fmt(rev)}</td></tr>`;
  }
  return `<table class="tbl"><thead><tr><th>Цена, д.е.</th><th>Спрос, шт.</th><th>Выручка TR, д.е.</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- Рецептура ----------
function recipeText(recipe) {
  return Object.keys(recipe).map(r => `${recipe[r]} ${r.toLowerCase()}${recipe[r] > 1 ? 'а' : ''}`).join(' + ');
}

// ---------- Тосты ----------
function toast(msg, ok = true) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = ok ? '#1b4332' : '#641220';
  t.style.display = 'block';
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// ---------- Фаза ----------
const PHASE_TITLES = {
  lobby: 'Ожидание начала',
  intro: 'Знакомство с игрой',
  round1: 'Раунд 1 · Анализ спроса',
  auction1: 'Раунд 2 · Аукцион ресурсов',
  auction2: 'Торги по лоту',
  round3: 'Раунд 3 · Производство',
  market4: 'Раунд 4 · Рынок и равновесие',
  round5: 'Раунд 5 · Эластичность спроса',
  round6: 'Раунд 6 · Эластичность предложения',
  final: 'Раунд 7 · Итоговый расчёт',
  results: 'Итоги игры'
};
