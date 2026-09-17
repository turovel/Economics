'use strict';
// ===== Панель команды =====
// вход проверяется запросом /api/state (см. load())

let S = null;   // состояние с сервера
let me = null;  // данные моей команды

async function load() {
  try {
    const j = await api('/api/state');
    if (j.ok) {
      S = j.state; me = S.me;
      const nb = document.getElementById('netBadge');
      nb.textContent = 'на связи'; nb.className = 'badge ok';
      render();
    } else { location.href = '/'; }
  } catch (e) {
    const nb = document.getElementById('netBadge');
    nb.textContent = 'нет связи'; nb.className = 'badge no';
  }
}

function show(id, on) { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; }

function render() {
  if (!S || !me) return;
  document.getElementById('brand').textContent = (TEAM_EMOJI[me.id] || 'factory') + ' Команда ' + me.id + ' — ' + me.goods;
  document.getElementById('phaseName').textContent = PHASE_TITLES[S.phase] || S.phase;
  startTimer('timer', S.timerEnd);

  const eb = document.getElementById('eventBanner');
  if (S.event) {
    eb.style.display = 'block';
    eb.innerHTML = '📣 <b>Событие рынка:</b> ' + esc(S.event) +
      (S.taxPerUnit ? ' · налог ' + S.taxPerUnit + ' д.е. с каждой проданной единицы' : '');
  } else eb.style.display = 'none';

  show('p-round1', S.phase === 'lobby' || S.phase === 'round1');
  show('p-auction', S.phase === 'auction1' || S.phase === 'auction2' || S.phase === 'round6');
  show('p-produce', S.phase === 'round3');
  show('p-market', S.phase === 'market4');
  show('p-elast', S.phase === 'round5');
  show('p-elasts', S.phase === 'round6');
  show('p-final', S.phase === 'final');
  show('p-results', S.phase === 'results');

  renderRound1();
  renderAuction();
  renderProduce();
  renderMarket();
  renderElast();
  renderFinal();
  renderResults();

  const wh = document.getElementById('waitingHint');
  wh.innerHTML = 'Фаза: <b>' + esc(PHASE_TITLES[S.phase] || S.phase) + '</b> · Деньги: <b>' + fmt(me.money) +
    ' д.е.</b> · Потрачено на ресурсы: <b>' + fmt(me.spent) + ' д.е.</b>' +
    (me.round1Ready ? ' · ✅ анализ спроса отправлен' : '');
}

// ---------- Раунд 1 ----------
function renderRound1() {
  const btn = document.getElementById('btnReady1');
  const st = document.getElementById('ready1Status');
  document.getElementById('demandTbl').innerHTML = demandTableHTML(me.demand, me.price);
  btn.disabled = me.round1Ready || S.phase !== 'round1';
  st.innerHTML = me.round1Ready ? '<span class="badge ok">отправлено</span>' : '';
}

// ---------- Аукцион ----------
function renderAuction() {
  const box = document.getElementById('auctionBox');
  const form = document.getElementById('bidForm');
  const a = me.auction;
  if (S.phase === 'auction1' && !a) {
    box.textContent = 'Организатор скоро объявит лот. Подготовьте максимальные цены за каждый ресурс!';
    form.style.display = 'none';
    return;
  }
  if (!a) { box.textContent = 'Сейчас торгов нет. Следите за объявлениями.'; form.style.display = 'none'; return; }
  if (!a.closed) {
    box.innerHTML = '🔨 Лот: <b>' + (RES_ICONS[a.resource] || '') + ' ' + esc(a.resource) + '</b>' +
      ' · объём: <b>' + a.qty + ' ед.</b>' +
      ' · текущая цена: <b>' + fmt(a.price) + ' д.е./ед.</b>' +
      ' · весь лот стоит: <b>' + fmt(a.price * a.qty) + ' д.е.</b>';
    form.style.display = '';
    document.getElementById('bidRes').textContent = a.resource;
    document.getElementById('bidQty').textContent = a.qty + ' ед.';
    const inp = document.getElementById('bidInput');
    inp.min = a.price + 1;
    inp.value = '';
    document.getElementById('bidHint').textContent =
      'Ваши деньги: ' + fmt(me.money) + ' д.е. Ставка делается за весь лот сразу: ставка × ' + a.qty + ' спишется сразу.';
  } else {
    box.innerHTML = a.winner
      ? '✅ Лот ушёл команде ' + esc(a.winner) + ' по ' + fmt(a.finalPrice) + ' д.е./ед.'
      : 'Лот не продан: ставок не было.';
    form.style.display = 'none';
  }
}

// ---------- Производство ----------
function renderProduce() {
  const rs = document.getElementById('resStats');
  let html = '<div class="stat"><div class="lbl">Деньги</div><div class="val money">' + fmt(me.money) + '</div></div>';
  for (const r of ['Сырьё', 'Труд', 'Энергия']) {
    html += '<div class="stat"><div class="lbl">' + (RES_ICONS[r] || '') + ' ' + r + '</div><div class="val">' + (me.bought[r] || 0) + '</div></div>';
  }
  rs.innerHTML = html;

  document.getElementById('goodsInfo').innerHTML =
    'Товар: <b>' + esc(me.goods) + '</b><br>Рецепт 1 единицы: <b>' + recipeText(me.recipe) + '</b>' +
    '<br>Предел выпуска: <b>10 ед.</b><br><span style="opacity:.8">Максимально возможно сейчас: <b>' +
    (me.productionLocked ? me.produced : me.produced) + ' ед.</b></span>';

  const form = document.getElementById('produceForm');
  const hint = document.getElementById('produceHint');
  if (me.productionLocked) {
    form.style.display = 'none';
    hint.innerHTML = '<span class="badge ok">Производство запущено: ' + me.produced + ' ед.</span>';
  } else {
    form.style.display = '';
    const feas = me.produced;
    const inp = document.getElementById('produceQty');
    inp.max = feas; inp.value = Math.max(1, Math.min(Number(inp.value) || 1, feas));
    let limiting = [];
    for (const r of Object.keys(me.recipe)) {
      const can = Math.floor((me.bought[r] || 0) / me.recipe[r]);
      limiting.push(r + ': на ' + can + ' ед.');
    }
    hint.textContent = 'Ограничения по ресурсам — ' + limiting.join(', ') + '. Итого потолок: ' + feas + ' ед.';
  }
}

// ---------- Рынок (раунд 4) ----------
function renderMarket() {
  const sel = document.getElementById('priceSel');
  if (!sel.options.length) {
    for (let p = 100; p <= 500; p += 50) {
      const o = document.createElement('option');
      o.value = p; o.textContent = p + ' д.е.';
      sel.appendChild(o);
    }
  }
  if (me.price) sel.value = String(me.price);
  const st = document.getElementById('priceStatus');
  const btn = document.getElementById('btnLockPrice');
  btn.disabled = me.priceLocked;
  sel.disabled = me.priceLocked;
  st.innerHTML = me.priceLocked ? '<span class="badge ok">цена зафиксирована: ' + me.price + ' д.е.</span>' : '';

  const mr = document.getElementById('marketResult');
  if (!me.priceLocked) { mr.innerHTML = ''; return; }
  let html = '<div class="stat-grid" style="margin-top:6px">' +
    '<div class="stat"><div class="lbl">Ваш выпуск</div><div class="val">' + (me.productionLocked ? me.produced : me.produced) + ' ед.</div></div>' +
    '<div class="stat"><div class="lbl">Спрос по вашей цене</div><div class="val">' + (me.marketInfo && me.marketInfo.demandAtMyPrice != null ? me.marketInfo.demandAtMyPrice + ' ед.' : '—') + '</div></div>' +
    '<div class="stat"><div class="lbl">Продано</div><div class="val">' + (me.sold ? me.sold + ' ед.' : '—') + '</div></div>' +
    '<div class="stat"><div class="lbl">Не продано (избыток)</div><div class="val">' + (me.sold || me.unsold ? me.unsold + ' ед.' : '—') + '</div></div>' +
    '</div>';
  if (me.marketInfo && me.marketInfo.resolved) {
    html += '<div class="notice" style="margin-top:8px">Аналитик свёл рынок: если спрос меньше выпуска — возникает <b>избыток</b>, если больше — <b>дефицит</b>.</div>';
  }
  mr.innerHTML = html;
}

// ---------- Эластичность ----------
function renderElast() {
  if (me.elasticity) {
    document.getElementById('elastStatus').innerHTML = '<span class="badge ok">расчёт отправлен</span>';
  }
  if (me.elasticityS) {
    document.getElementById('elastSStatus').innerHTML = '<span class="badge ok">расчёт отправлен</span>';
  }
}

// ---------- Финал ----------
function renderFinal() {
  const st = document.getElementById('finalStats');
  const capital = me.money + me.revenue;
  st.innerHTML =
    '<div class="stat"><div class="lbl">Остаток денег</div><div class="val money">' + fmt(me.money) + '</div></div>' +
    '<div class="stat"><div class="lbl">Затраты на ресурсы</div><div class="val">' + fmt(me.spent) + '</div></div>' +
    '<div class="stat"><div class="lbl">Произведено</div><div class="val">' + me.produced + ' ед.</div></div>' +
    '<div class="stat"><div class="lbl">Цена</div><div class="val">' + (me.price || '—') + '</div></div>' +
    '<div class="stat"><div class="lbl">Продано</div><div class="val">' + me.sold + ' ед.</div></div>' +
    '<div class="stat"><div class="lbl">Выручка</div><div class="val">' + fmt(me.revenue) + '</div></div>' +
    '<div class="stat"><div class="lbl">Налог уплачен</div><div class="val">' + fmt(me.taxPaid) + '</div></div>' +
    '<div class="stat"><div class="lbl">Прибыль</div><div class="val" style="color:' + (me.profit >= 0 ? '#7be3a0' : '#ff8fa3') + '">' + fmt(me.profit) + '</div></div>' +
    '<div class="stat"><div class="lbl">Итоговый капитал = деньги + выручка</div><div class="val money">' + fmt(capital) + '</div></div>';
  const btn = document.getElementById('btnFinal');
  btn.disabled = me.finalSubmitted;
  document.getElementById('finalStatus').innerHTML = me.finalSubmitted ? '<span class="badge ok">отчёт отправлен</span>' : '';
}

// ---------- Итоги ----------
function renderResults() {
  const box = document.getElementById('resultsBox');
  if (S.phase !== 'results') { box.textContent = 'Организатор ещё не подвёл итоги.'; return; }
  if (!S.results) { box.textContent = 'Организатор подводит итоги...'; return; }
  let rows = '';
  for (const r of S.results) {
    const hl = r.id === me.id ? ' class="hl"' : '';
    rows += '<tr' + hl + '><td>' + r.place + '</td><td>' + (TEAM_EMOJI[r.id] || '') + ' ' + r.id + ' — ' + esc(r.name) +
      '</td><td>' + fmt(r.capital) + '</td><td>' + fmt(r.profit) + '</td><td>' + r.score + '</td></tr>';
  }
  box.innerHTML = '<table class="tbl"><thead><tr><th>Место</th><th>Команда</th><th>Капитал, д.е.</th><th>Прибыль, д.е.</th><th>Баллы</th></tr></thead><tbody>' + rows + '</tbody></table>';
  const st2 = document.getElementById('finalStats2');
  const capital = me.money + me.revenue;
  st2.innerHTML =
    '<div class="stat"><div class="lbl">Ваш капитал</div><div class="val money">' + fmt(capital) + '</div></div>' +
    '<div class="stat"><div class="lbl">Ваша прибыль</div><div class="val">' + fmt(me.profit) + '</div></div>';
}

// ---------- Обработчики ----------
document.getElementById('btnReady1').onclick = async () => {
  const j = await api('/api/team/ready1', {});
  if (!j.ok) toast(j.error, false);
  load();
};

document.getElementById('btnBid').onclick = async () => {
  const a = me.auction;
  if (!a || a.closed) return;
  const price = Math.floor(Number(document.getElementById('bidInput').value));
  if (!price) { toast('Введите ставку', false); return; }
  if (price <= a.price) { toast('Ставка должна быть выше текущей цены ' + a.price + ' д.е.', false); return; }
  if (price * a.qty > me.money) { toast('Не хватит денег: ' + price + ' × ' + a.qty + ' = ' + fmt(price * a.qty) + ' д.е.', false); return; }
  const j = await api('/api/team/bid', { price });
  if (j.ok) toast('Ставка принята: ' + price + ' д.е./ед.');
  else toast(j.error, false);
  load();
};

document.getElementById('btnProduce').onclick = async () => {
  const qty = Math.floor(Number(document.getElementById('produceQty').value));
  const j = await api('/api/team/produce', { qty });
  if (j.ok) toast('Производство запущено: ' + qty + ' ед.');
  else toast(j.error, false);
  load();
};

document.getElementById('btnLockPrice').onclick = async () => {
  const price = Number(document.getElementById('priceSel').value);
  const j1 = await api('/api/team/price', { price });
  if (!j1.ok) { toast(j1.error, false); return; }
  const j2 = await api('/api/team/lockPrice', {});
  if (j2.ok) toast('Цена зафиксирована: ' + price + ' д.е.');
  else toast(j2.error, false);
  load();
};

document.getElementById('btnElast').onclick = async () => {
  const p1 = Number(document.getElementById('p1').value);
  const p2 = Number(document.getElementById('p2').value);
  const q1 = Number(document.getElementById('q1').value);
  const q2 = Number(document.getElementById('q2').value);
  const ed = Number(document.getElementById('ed').value);
  const type = document.getElementById('etype').value;
  if (!p1 || !p2 || q1 === 0 && q2 === 0 || Number.isNaN(ed)) { toast('Заполните все поля расчёта', false); return; }
  if (!type) { toast('Выберите тип спроса', false); return; }
  const j = await api('/api/team/elasticity', { p1, p2, q1, q2, ed, type });
  if (j.ok) toast('Расчёт отправлен организаторам');
  else toast(j.error, false);
  load();
};

document.getElementById('btnElastS').onclick = async () => {
  const sp1 = Number(document.getElementById('sp1').value);
  const sp2 = Number(document.getElementById('sp2').value);
  const sq1 = Number(document.getElementById('sq1').value);
  const sq2 = Number(document.getElementById('sq2').value);
  const es = Number(document.getElementById('es').value);
  const concl = document.getElementById('sconcl').value;
  if (!sp1 || !sp2 || Number.isNaN(es)) { toast('Заполните поля расчёта', false); return; }
  if (!concl) { toast('Выберите вывод', false); return; }
  const j = await api('/api/team/elasticityS', { sp1, sp2, sq1, sq2, es, concl });
  if (j.ok) toast('Расчёт отправлен организаторам');
  else toast(j.error, false);
  load();
};

document.getElementById('btnFinal').onclick = async () => {
  const j = await api('/api/team/final', {});
  if (j.ok) toast('Отчёт отправлен');
  else toast(j.error, false);
  load();
};

// ---------- Блокнот ----------
let notesKey = 'rpd_notes';
document.getElementById('notes').addEventListener('input', (e) => {
  try { localStorage.setItem(notesKey, e.target.value); } catch (err) {}
});

// ---------- Цикл ----------
load();
setInterval(load, 3000);