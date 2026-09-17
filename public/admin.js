'use strict';
// ===== Панель организаторов =====
// вход проверяется запросом /api/state (см. load())

let S = null;          // состояние с сервера
let tab = 'overview';  // активная вкладка
let edCache = null;    // последний расчёт эталонной эластичности
let esCache = null;

const PHASE_LIST = [
  ['lobby', 'Лобби — команды подключаются'],
  ['intro', 'Знакомство с игрой'],
  ['round1', 'Раунд 1 — Анализ спроса (7 мин)'],
  ['auction1', 'Раунд 2 — Аукцион ресурсов (10 мин)'],
  ['auction2', 'Торги по лоту'],
  ['round3', 'Раунд 3 — Производство (5 мин)'],
  ['market4', 'Раунд 4 — Цена и рыночное равновесие (7 мин)'],
  ['round5', 'Раунд 5 — Эластичность спроса (7 мин)'],
  ['round6', 'Раунд 6 — Эластичность предложения (5 мин)'],
  ['final', 'Раунд 7 — Итоговый расчёт (5 мин)'],
  ['results', 'Итоги и награждение']
];

async function load() {
  try {
    const j = await api('/api/state');
    if (j.ok && j.admin) {
      S = j.state;
      const nb = document.getElementById('netBadge');
      nb.textContent = 'на связи'; nb.className = 'badge ok';
      render();
    } else { location.href = '/'; }
  } catch (e) {
    const nb = document.getElementById('netBadge');
    nb.textContent = 'нет связи'; nb.className = 'badge no';
  }
}

function keepFocus() {
  const ae = document.activeElement;
  if (ae && ae.id && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
    return { id: ae.id, v: ae.value };
  }
  return null;
}
function restoreFocus(k) {
  if (!k) return;
  const el = document.getElementById(k.id);
  if (el && document.activeElement !== el) { return; } // не мешаем вводу
}

function render() {
  if (!S) return;
  const k = keepFocus();
  document.getElementById('phaseName').textContent = PHASE_TITLES[S.phase] || S.phase;
  startTimer('timer', S.timerEnd);

  const eb = document.getElementById('eventBanner');
  if (S.event) {
    eb.style.display = 'block';
    eb.innerHTML = '📣 <b>Активное событие:</b> ' + esc(S.event) +
      (S.taxPerUnit ? ' · налог ' + S.taxPerUnit + ' д.е./ед.' : '');
  } else eb.style.display = 'none';

  const sel = document.getElementById('phaseSel');
  if (document.activeElement !== sel) {
    if (!sel.options.length) {
      PHASE_LIST.forEach(p => {
        const o = document.createElement('option');
        o.value = p[0]; o.textContent = p[1];
        sel.appendChild(o);
      });
    }
    sel.value = S.phase;
  }

  const T = { overview: renderOverview, auction: renderAuction, market: renderMarket,
    events: renderEvents, scores: renderScores, results: renderResults, log: renderLog, reset: renderReset };
  (T[tab] || renderOverview)();
  restoreFocus(k);
}

function show(id, on) { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; }

// ---------- Вкладка: Команды ----------
function renderOverview() {
  const el = document.getElementById('tab-overview');
  show('tab-overview', true);
  let rows = '';
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    const t = S.teams[id];
    rows += '<tr>' +
      '<td>' + (TEAM_EMOJI[id] || '') + ' <b>' + id + '</b> — ' + esc(t.name) + '</td>' +
      '<td class="num">' + fmt(t.money) + '</td>' +
      '<td class="num">' + (t.bought['Сырьё'] || 0) + '</td>' +
      '<td class="num">' + (t.bought['Труд'] || 0) + '</td>' +
      '<td class="num">' + (t.bought['Энергия'] || 0) + '</td>' +
      '<td class="num">' + fmt(t.spent) + '</td>' +
      '<td class="num">' + (t.productionLocked ? t.produced : '—') + '</td>' +
      '<td class="num">' + (t.price != null ? t.price : '—') + (t.priceLocked ? ' 🔒' : '') + '</td>' +
      '<td>' + (t.round1Ready ? '<span class="badge ok">✓</span>' : '<span class="badge no">—</span>') + '</td>' +
      '<td>' + (t.finalSubmitted ? '<span class="badge ok">✓</span>' : '<span class="badge no">—</span>') + '</td>' +
      '<td class="num"><b>' + t.score + '</b></td>' +
      '<td><button class="secondary" data-act="adj" data-team="' + id + '">± деньги</button></td>' +
      '</tr>';
  }
  el.innerHTML =
    '<div class="panel"><h3>📊 Команды <span class="hint">банкир · состояние денег и ресурсов</span></h3>' +
    '<table class="tbl"><thead><tr><th>Команда</th><th>Деньги, д.е.</th><th>🪨 Сырьё</th><th>👷 Труд</th><th>⚡ Энергия</th>' +
    '<th>Затраты</th><th>Выпуск</th><th>Цена</th><th>Анализ</th><th>Отчёт</th><th>Баллы</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="notice" style="margin-top:10px">Команды подключаются на адрес этого компьютера: <b>http://&lt;IP-адрес ноутбука&gt;:3088</b> (IP подскажет консоль сервера). Пароли команд: A2026…E2026.</p></div>';
}

// ---------- Вкладка: Аукцион ----------
function renderAuction() {
  const el = document.getElementById('tab-auction');
  show('tab-auction', true);
  const pools = S.resourcePools;
  let poolHtml = '<div class="stat-grid">';
  for (const r of ['Сырьё', 'Труд', 'Энергия']) {
    poolHtml += '<div class="stat"><div class="lbl">' + (RES_ICONS[r] || '') + ' ' + r + ' · старт ' + fmt({ 'Сырьё': 100, 'Труд': 150, 'Энергия': 100 }[r]) + ' д.е./ед.</div><div class="val">' + pools[r].available + ' / ' + pools[r].total + '</div></div>';
  }
  poolHtml += '</div>';

  const a = S.auction;
  let lotHtml = '<p class="notice">Лот не выставлен. Выставьте ресурс на торги — ставки команд появятся здесь в реальном времени.</p>';
  if (a && !a.closed) {
    let bids = (a.bids || []).map(b => '<tr><td>' + (TEAM_EMOJI[b.team] || '') + ' ' + b.team + ' — ' + esc(S.teams[b.team] ? S.teams[b.team].name : '') + '</td><td class="num"><b>' + fmt(b.price) + '</b></td><td class="num">' + fmt(b.price * a.qty) + '</td></tr>').join('');
    if (!bids) bids = '<tr><td colspan="3" class="notice">ставок пока нет</td></tr>';
    lotHtml =
      '<div class="panel" style="border-color:rgba(255,183,3,0.5)">' +
      '<h3>🔨 Идут торги: ' + (RES_ICONS[a.resource] || '') + ' ' + esc(a.resource) + ' — ' + a.qty + ' ед.</h3>' +
      '<p>Текущая максимальная цена: <b style="font-size:20px;color:#ffd166">' + fmt(a.price) + ' д.е./ед.</b> · весь лот: <b>' + fmt(a.price * a.qty) + ' д.е.</b></p>' +
      '<table class="tbl" style="max-width:520px"><thead><tr><th>Команда</th><th>Ставка, д.е./ед.</th><th>Всего за лот</th></tr></thead><tbody>' + bids + '</tbody></table>' +
      '<div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap">' +
      '<button data-act="a-close">🏁 Закрыть лот (продать лидеру)</button>' +
      '</div></div>';
  } else if (a && a.closed) {
    lotHtml = '<p class="notice">Лот закрыт. ' + (a.winner ? ('Победитель: команда ' + a.winner + ' по ' + fmt(a.finalPrice) + ' д.е./ед.') : 'Ставок не было, ресурс остался на складе.') + '</p>';
  }

  let opts = '';
  for (const r of ['Сырьё', 'Труд', 'Энергия']) {
    opts += '<option value="' + r + '"' + (pools[r].available <= 0 ? ' disabled' : '') + '>' + r + ' (свободно ' + pools[r].available + ')</option>';
  }
  let teamOpts = '';
  for (const id of ['A', 'B', 'C', 'D', 'E']) teamOpts += '<option value="' + id + '">' + id + ' — ' + esc(S.teams[id].name) + '</option>';

  el.innerHTML =
    '<div class="panel"><h3>📦 Склад ресурсов <span class="hint">аукционист</span></h3>' + poolHtml +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:12px">' +
    '<select id="lotRes">' + opts + '</select>' +
    '<input type="number" id="lotQty" placeholder="кол-во" style="width:110px" min="1">' +
    '<button data-act="lot-start">🔨 Выставить лот</button>' +
    '<span class="notice">Цена старта: 100 / 150 / 100 д.е. за единицу</span>' +
    '</div></div>' +
    '<div class="panel"><h3>Ставки</h3>' + lotHtml +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px">' +
    '<span class="notice">Записать ставку вручную (если торги устные):</span>' +
    '<select id="bidTeam" style="width:auto">' + teamOpts + '</select>' +
    '<input type="number" id="bidPrice" placeholder="д.е./ед." style="width:120px">' +
    '<button class="secondary" data-act="a-bid">Записать ставку</button>' +
    '</div>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px">' +
    '<span class="notice">Продать вне аукциона:</span>' +
    '<select id="qsTeam" style="width:auto">' + teamOpts + '</select>' +
    '<select id="qsRes">' + opts + '</select>' +
    '<input type="number" id="qsQty" placeholder="ед." style="width:90px">' +
    '<input type="number" id="qsPrice" placeholder="д.е./ед." style="width:120px">' +
    '<button class="secondary" data-act="qs">Продать</button>' +
    '</div></div>';
}

// ---------- Вкладка: Рынок ----------
function renderMarket() {
  const el = document.getElementById('tab-market');
  show('tab-market', true);

  let head = '<tr><th>Цена, д.е.</th>';
  for (const id of ['A', 'B', 'C', 'D', 'E']) head += '<th>' + (TEAM_EMOJI[id] || '') + ' ' + id + ' — ' + esc(S.teams[id].name) + '</th>';
  head += '<th>Шкала цен</th></tr>';
  let body = '';
  for (const p of [100, 200, 300, 400, 500]) {
    body += '<tr><td class="num"><b>' + p + '</b></td>';
    for (const id of ['A', 'B', 'C', 'D', 'E']) body += '<td class="num">' + S.teams[id].demand[p] + '</td>';
    body += '<td class="notice">' + (p === 100 ? 'min' : (p === 500 ? 'max' : '')) + '</td></tr>';
  }
  const demandTbl = '<table class="tbl"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
    '<p class="notice" style="margin-top:6px">Таблица спроса (упрощённая модель игры). Хлеб/Одежда/Стройматериалы — эластичный спрос, Мебель/Электроника — неэластичный.</p>';

  let mrows = '';
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    const t = S.teams[id];
    mrows += '<tr><td>' + (TEAM_EMOJI[id] || '') + ' ' + id + '</td>' +
      '<td class="num">' + (t.price != null ? t.price : '—') + (t.priceLocked ? ' 🔒' : '') + '</td>' +
      '<td class="num">' + (t.productionLocked ? t.produced : '—') + '</td>' +
      '<td class="num">' + (t.sold || (S.market && S.market.resolved ? 0 : '—')) + '</td>' +
      '<td class="num">' + (S.market && S.market.resolved ? t.unsold : '—') + '</td>' +
      '<td class="num">' + (t.revenue ? fmt(t.revenue) : '—') + '</td>' +
      '<td class="num">' + (t.taxPaid ? fmt(t.taxPaid) : (S.taxPerUnit && S.market && S.market.resolved ? 0 : '—')) + '</td>' +
      '<td class="num" style="color:' + (t.profit >= 0 ? '#7be3a0' : '#ff8fa3') + '">' + (S.market && S.market.resolved ? fmt(t.profit) : '—') + '</td></tr>';
  }
  const salesTbl = '<table class="tbl"><thead><tr><th>Команда</th><th>Цена</th><th>Выпуск</th><th>Продано</th><th>Избыток</th><th>Выручка</th><th>Налог</th><th>Прибыль</th></tr></thead><tbody>' + mrows + '</tbody></table>' +
    '<div style="margin-top:10px"><button data-act="resolve">⚖ Свести рынок (продажи по ценам команд)</button>' +
    (S.market && S.market.resolved ? ' <span class="badge ok">рынок сведён</span>' : '') + '</div>';

  const edPanel =
    '<div class="panel"><h3>📈 Эластичность спроса: эталон и ответы команд <span class="hint">аналитик</span></h3>' +
    '<p class="notice">Введите старую и новую цену — сервер рассчитает эталонные коэффициенты по таблицам спроса. Сравните с ответами команд.</p>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">' +
    '<input type="number" id="edP1" placeholder="цена была" style="width:130px" value="300">' +
    '<input type="number" id="edP2" placeholder="цена стала" style="width:130px" value="400">' +
    '<button data-act="ed-calc">Рассчитать эталон</button></div><div id="edOut" style="margin-top:10px">' + (edCache ? edTableHTML() : '') + '</div></div>';

  const esPanel =
    '<div class="panel"><h3>🧗 Эластичность предложения: эталон и ответы команд</h3>' +
    '<p class="notice">Введите две точки (цена; объём предложения) — сервер рассчитает эталонный коэффициент.</p>' +
    '<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">' +
    '<input type="number" id="esP1" placeholder="P была" style="width:110px" value="300">' +
    '<input type="number" id="esQ1" placeholder="Qs была" style="width:110px" value="4">' +
    '<input type="number" id="esP2" placeholder="P стала" style="width:110px" value="500">' +
    '<input type="number" id="esQ2" placeholder="Qs стала" style="width:110px" value="8">' +
    '<button data-act="es-calc">Рассчитать эталон</button></div><div id="esOut" style="margin-top:10px">' + (esCache ? esHTML() : '') + '</div></div>';

  el.innerHTML =
    '<div class="panel"><h3>💰 Раунд 4: рынок и равновесие</h3>' + salesTbl + '</div>' +
    '<div class="panel"><h3>📋 Таблицы спроса всех команд</h3>' + demandTbl + '</div>' +
    edPanel + esPanel;
}

function edTableHTML() {
  let rows = '';
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    const c = edCache[id];
    const sub = S.teams[id].elasticity;
    const match = sub && Math.abs(Number(sub.ed) - Math.abs(c.ed)) < 0.06;
    rows += '<tr><td>' + (TEAM_EMOJI[id] || '') + ' ' + id + ' — ' + esc(S.teams[id].name) + '</td>' +
      '<td class="num">' + c.q1 + ' → ' + c.q2 + '</td>' +
      '<td class="num"><b>' + fmtE(c.ed) + '</b></td>' +
      '<td>' + esc(c.type) + '</td>' +
      '<td class="num">' + (sub ? esc(sub.ed) + ' (' + esc(sub.type || '—') + ')' : '—') + '</td>' +
      '<td>' + (sub ? (match ? '<span class="badge ok">верно</span>' : '<span class="badge no">проверить</span>') : '<span class="badge warn">нет ответа</span>') + '</td></tr>';
  }
  return '<table class="tbl"><thead><tr><th>Команда</th><th>Спрос</th><th>Эталон E</th><th>Тип (эталон)</th><th>Ответ команды</th><th>Сверка</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="notice" style="margin-top:6px">Сверка по модулю коэффициента (допуск 0,06). Эталон считает сервер по методу средней точки.</p>';
}

function esHTML() {
  let rows = '';
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    const sub = S.teams[id].elasticityS;
    const match = sub && Math.abs(Number(sub.es) - Math.abs(esCache.es)) < 0.06;
    rows += '<tr><td>' + (TEAM_EMOJI[id] || '') + ' ' + id + '</td>' +
      '<td class="num">' + (sub ? esc(sub.es) + (sub.concl ? ' · ' + esc(sub.concl) : '') : '—') + '</td>' +
      '<td>' + (sub ? (match ? '<span class="badge ok">верно</span>' : '<span class="badge no">проверить</span>') : '<span class="badge warn">нет ответа</span>') + '</td></tr>';
  }
  return '<p>Эталон: <b>' + fmtE(esCache.es) + '</b> — ' + esc(esCache.type) + '</p>' +
    '<table class="tbl" style="max-width:640px"><thead><tr><th>Команда</th><th>Ответ команды (E, вывод)</th><th>Сверка</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ---------- Вкладка: События ----------
function renderEvents() {
  const el = document.getElementById('tab-events');
  show('tab-events', true);
  el.innerHTML =
    '<div class="panel"><h3>📣 События рынка <span class="hint">ведущий</span></h3>' +
    '<p class="notice">Событие показывается всем командам баннером на их панелях. Выбирайте момент: обычно событие объявляется в раундах 5–6.</p>' +
    '<div style="display:grid; gap:10px; margin-top:10px">' +
    '<div><button data-act="ev-energy">⚡ Авария на электростанции (энергии доступно 10 ед. вместо 30)</button></div>' +
    '<div style="display:flex; gap:8px; align-items:center"><button data-act="ev-tax">🧾 Ввести налог, д.е./ед.:</button>' +
    '<input type="number" id="taxVal" value="100" style="width:100px"></div>' +
    '<div><button data-act="ev-costs">📈 Подорожали ресурсы: производители наращивают выпуск только при более высоких ценах (текст)</button></div>' +
    '<div><button class="danger" data-act="ev-clear">✖ Убрать событие с экранов</button></div>' +
    '</div></div>';
}

// ---------- Вкладка: Баллы ----------
function renderScores() {
  const el = document.getElementById('tab-scores');
  show('tab-scores', true);
  let rows = '';
  for (const id of ['A', 'B', 'C', 'D', 'E']) {
    const t = S.teams[id];
    rows += '<tr><td>' + (TEAM_EMOJI[id] || '') + ' ' + id + ' — ' + esc(t.name) + '</td>' +
      '<td class="num">' + t.score + '</td>' +
      '<td><input type="number" id="sc-' + id + '" value="' + t.score + '" min="0" max="60" style="width:90px"></td>' +
      '<td><button data-act="score" data-team="' + id + '">💾 Сохранить</button></td></tr>';
  }
  el.innerHTML =
    '<div class="panel"><h3>⭐ Баллы команд <span class="hint">аналитик</span></h3>' +
    '<p class="notice">Критерии системы оценки (максимум 60): анализ спроса 10 · расчёт эластичности 15 · рациональная закупка 10 · определение предложения 10 · расчёт выручки и прибыли 10 · обоснование решений 5. Итог по критериям оцените на основе журнала и ответов команд, затем сохраните итоговый балл.</p>' +
    '<table class="tbl" style="max-width:720px"><thead><tr><th>Команда</th><th>Текущий балл</th><th>Новый балл</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// ---------- Вкладка: Итоги ----------
function renderResults() {
  const el = document.getElementById('tab-results');
  show('tab-results', true);
  const list = ['A', 'B', 'C', 'D', 'E'].map(id => {
    const t = S.teams[id];
    return { id, name: t.name, capital: t.money + t.revenue - t.taxPaid, profit: t.profit, score: t.score };
  }).sort((a, b) => b.capital - a.capital);
  let rows = '';
  list.forEach((r, i) => {
    rows += '<tr' + (i === 0 ? ' class="hl"' : '') + '><td>' + (i + 1) + '</td><td>' + (TEAM_EMOJI[r.id] || '') + ' ' + r.id + ' — ' + esc(r.name) + '</td>' +
      '<td class="num"><b>' + fmt(r.capital) + '</b></td><td class="num">' + fmt(r.profit) + '</td><td class="num">' + r.score + '</td></tr>';
  });
  const byScore = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id, s: S.teams[id].score })).sort((a, b) => b.s - a.s);
  let rows2 = '';
  byScore.forEach((r, i) => {
    rows2 += '<tr><td>' + (i + 1) + '</td><td>' + (TEAM_EMOJI[r.id] || '') + ' ' + r.id + ' — ' + esc(S.teams[r.id].name) + '</td><td class="num">' + r.s + '</td></tr>';
  });
  el.innerHTML =
    '<div class="panel"><h3>🏆 Итоги по капиталу <span class="hint">победитель игры</span></h3>' +
    '<table class="tbl"><thead><tr><th>Место</th><th>Команда</th><th>Капитал</th><th>Прибыль</th><th>Баллы</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<p class="notice" style="margin-top:8px">Капитал = остаток денег + выручка − налог.</p></div>' +
    '<div class="panel"><h3>⭐ Итоги по баллам</h3><table class="tbl" style="max-width:560px"><thead><tr><th>Место</th><th>Команда</th><th>Баллы</th></tr></thead><tbody>' + rows2 + '</tbody></table></div>';
}

// ---------- Вкладка: Журнал ----------
function renderLog() {
  const el = document.getElementById('tab-log');
  show('tab-log', true);
  const items = (S.log || []).map(l => '<div><span class="t">' + esc(l.t) + '</span>' + esc(l.msg) + '</div>').join('');
  el.innerHTML = '<div class="panel"><h3>📜 Журнал событий <span class="hint">все действия с отметками времени</span></h3><div class="logbox">' + (items || 'пусто') + '</div></div>';
}

// ---------- Вкладка: Сброс ----------
function renderReset() {
  const el = document.getElementById('tab-reset');
  show('tab-reset', true);
  el.innerHTML =
    '<div class="panel"><h3>♻️ Сброс игры</h3>' +
    '<p class="notice">Полностью очищает: деньги, ресурсы, лоты, ответы и баллы команд. Используйте между группами (потоками). Журнал сохраняется.</p>' +
    '<button class="danger big" data-act="reset">♻️ Сбросить игру полностью</button></div>';
}

// ---------- Клики ----------
document.addEventListener('click', async (e) => {
  const tb = e.target.closest('.tabbtn');
  if (tb) {
    tab = tb.dataset.tab;
    document.querySelectorAll('.tabbtn').forEach(b => b.style.opacity = b === tb ? '1' : '0.6');
    ['overview', 'auction', 'market', 'events', 'scores', 'results', 'log', 'reset'].forEach(t => show('tab-' + t, t === tab));
    render();
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const post = async (path, body) => {
    const j = await api(path, body);
    if (!j.ok) toast(j.error || 'Ошибка', false);
    load();
    return j;
  };
  if (act === 'adj') {
    const id = btn.dataset.team;
    const v = prompt('На сколько изменить деньги команды ' + id + '? (например, 500 или -200)');
    if (v === null || v === '' || isNaN(Number(v))) return;
    await post('/api/admin/adjmoney', { team: id, amount: Number(v) });
  }
  if (act === 'lot-start') {
    const res = document.getElementById('lotRes').value;
    const qty = Math.floor(Number(document.getElementById('lotQty').value));
    if (!qty) { toast('Введите количество', false); return; }
    await post('/api/admin/auction/start', { resource: res, qty });
  }
  if (act === 'a-bid') {
    const team = document.getElementById('bidTeam').value;
    const price = Math.floor(Number(document.getElementById('bidPrice').value));
    if (!price) { toast('Введите цену ставки', false); return; }
    await post('/api/admin/auction/bid', { team, price });
  }
  if (act === 'a-close') await post('/api/admin/auction/close', {});
  if (act === 'qs') {
    const team = document.getElementById('qsTeam').value;
    const res = document.getElementById('qsRes').value;
    const qty = Math.floor(Number(document.getElementById('qsQty').value));
    const price = Math.floor(Number(document.getElementById('qsPrice').value));
    if (!qty || !price) { toast('Введите количество и цену', false); return; }
    await post('/api/admin/quicksell', { team, resource: res, qty, price });
  }
  if (act === 'resolve') await post('/api/admin/resolve', {});
  if (act === 'ed-calc') {
    const p1 = Number(document.getElementById('edP1').value);
    const p2 = Number(document.getElementById('edP2').value);
    const j = await post('/api/admin/ed', { p1, p2 });
    if (j.ok) { edCache = j.teams; render(); }
  }
  if (act === 'es-calc') {
    const p1 = Number(document.getElementById('esP1').value);
    const q1 = Number(document.getElementById('esQ1').value);
    const p2 = Number(document.getElementById('esP2').value);
    const q2 = Number(document.getElementById('esQ2').value);
    const j = await post('/api/admin/es', { p1, q1, p2, q2 });
    if (j.ok) { esCache = { es: j.es, type: j.type }; render(); }
  }
  if (act === 'ev-energy') await post('/api/admin/event', { text: 'Из-за аварии на электростанции на продажу выставляется только 10 единиц энергии вместо 30.', supplyShock: { 'Энергия': 10 } });
  if (act === 'ev-tax') {
    const tax = Math.floor(Number(document.getElementById('taxVal').value) || 0);
    await post('/api/admin/event', { text: 'Государство ввело налог ' + tax + ' д.е. с каждой проданной единицы товара.', taxPerUnit: tax });
  }
  if (act === 'ev-costs') await post('/api/admin/event', { text: 'Цены на энергию выросли: производители готовы наращивать предложение только при более высоких ценах на товары.' });
  if (act === 'ev-clear') await post('/api/admin/event', { text: null, taxPerUnit: 0 });
  if (act === 'score') {
    const id = btn.dataset.team;
    const v = Math.max(0, Math.min(60, Math.floor(Number(document.getElementById('sc-' + id).value) || 0)));
    await post('/api/admin/grade', { team: id, points: v });
  }
  if (act === 'reset') {
    if (confirm('Точно сбросить игру? Все данные команд будут очищены.')) await post('/api/admin/reset', {});
  }
});

// ---------- Верхняя панель ----------
document.getElementById('btnPhase').onclick = async () => {
  const p = document.getElementById('phaseSel').value;
  const j = await api('/api/admin/phase', { phase: p });
  if (j.ok) toast('Фаза: ' + p);
  else toast(j.error, false);
  load();
};
document.getElementById('btnTimerStart').onclick = async () => {
  const min = Number(document.getElementById('timerMin').value) || 0;
  const j = await api('/api/admin/timer', { minutes: min });
  if (j.ok) toast('Таймер: ' + min + ' мин');
  else toast(j.error, false);
  load();
};
document.getElementById('btnTimerStop').onclick = async () => {
  await api('/api/admin/timer', { minutes: 0 });
  load();
};
document.getElementById('btnEvent').onclick = async () => {
  const text = document.getElementById('eventText').value.trim();
  if (!text) { toast('Введите текст объявления', false); return; }
  const j = await api('/api/admin/event', { text });
  if (j.ok) { document.getElementById('eventText').value = ''; toast('Объявление показано командам'); }
  else toast(j.error, false);
  load();
};

load();
setInterval(load, 3000);