'use strict';
// ===== Панель команды · UI v2 =====
let S = null, me = null;
let prevTop = null, prevLeader = null, prevPhase = null, celebrated = false;

async function load() {
  try {
    const j = await api('/api/state');
    if (j.ok) {
      S = j.state; me = S.me;
      const nb = document.getElementById('netBadge');
      nb.textContent = 'на связи'; nb.className = 'badge ok';
      ensureHeader();
      render();
    } else { location.href = '/'; }
  } catch (e) {
    const nb = document.getElementById('netBadge');
    nb.textContent = 'нет связи'; nb.className = 'badge no';
  }
}

function ensureHeader() {
  const tb = document.querySelector('.topbar');
  if (tb && !document.getElementById('moneyChip')) {
    const s = document.createElement('span');
    s.className = 'moneychip'; s.id = 'moneyChip'; s.title = 'Ваши деньги, д.е.';
    const badge = document.getElementById('netBadge');
    tb.insertBefore(s, badge);
  }
  const b = document.getElementById('brand');
  if (b) b.style.color = TEAM_COLOR[me.id] || '';
}

function show(id, on) { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; }

function render() {
  if (!S || !me) return;
  document.getElementById('brand').textContent = (TEAM_EMOJI[me.id] || '🏭') + ' Команда ' + me.id + ' — ' + me.goods;
  document.getElementById('phaseName').textContent = PHASE_TITLES[S.phase] || S.phase;
  startTimer('timer', S.timerEnd);
  setNum(document.getElementById('moneyChip'), me.money, 'money');
  if (prevPhase && prevPhase !== S.phase) Snd.ding();
  prevPhase = S.phase;

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
    (me.round1Ready ? ' · ✅ анализ отправлен' : '');
}

// ---------- Раунд 1 ----------
function renderRound1() {
  const btn = document.getElementById('btnReady1');
  document.getElementById('demandTbl').innerHTML =
    '<div class="tblwrap">' + demandTableHTML(me.demand, me.price) + '</div>' +
    '<p class="notice" style="margin-top:6px">Зелёная строка — цена с максимальной выручкой (найдите её сами и сверьтесь).</p>';
  btn.disabled = me.round1Ready || S.phase !== 'round1';
  document.getElementById('ready1Status').innerHTML = me.round1Ready ? '<span class="badge ok">отправлено</span>' : '';
}

// ---------- Аукцион ----------
function renderAuction() {
  const box = document.getElementById('auctionBox');
  const form = document.getElementById('bidForm');
  const a = me.auction;
  if (!a) {
    box.innerHTML = '<p class="notice">Организатор скоро объявит лот. Подготовьте максимальные цены за каждый ресурс!</p>';
    form.style.display = 'none';
    prevTop = null; prevLeader = null;
    return;
  }
  if (a.closed) {
    box.innerHTML = '<p class="notice">' + (a.winner
      ? '✅ Лот «' + esc(a.resource) + '» ушёл команде ' + esc(a.winner) + ' по ' + fmt(a.finalPrice) + ' д.е./ед.'
      : 'Лот не продан: ставок не было.') + '</p>';
    form.style.display = 'none';
    prevTop = null; prevLeader = null;
    return;
  }
  // звуки: перебили ставку / новый лидер
  if (prevTop !== null && a.price > prevTop) {
    if (a.leader && a.leader !== me.id) Snd.outbid();
  }
  prevTop = a.price; prevLeader = a.leader;

  const amLeader = a.leader === me.id;
  const leaderHtml = amLeader
    ? '<span class="badge me">👑 ВЫ ЛИДЕР</span>'
    : (a.leader ? '<span class="badge warn">👑 Лидер: команда ' + esc(a.leader) + '</span>' : '<span class="badge no">ставок нет</span>');

  box.innerHTML =
    '<div class="auc-stage">' +
    '<div class="res">' + (RES_ICONS[a.resource] || '') + ' Лот: ' + esc(a.resource) + ' · ' + a.qty + ' ед.</div>' +
    '<div class="price">' + fmt(a.price) + '</div>' +
    '<div class="per">д.е. за единицу · весь лот = ' + fmt(a.price * a.qty) + ' д.е.</div>' +
    '<div class="leader">' + leaderHtml + '</div>' +
    '</div>';

  form.style.display = '';
  const inp = document.getElementById('bidInput');
  inp.min = a.price + 1;
  if (!inp.value) inp.placeholder = '> ' + a.price;
  let qb = document.getElementById('bidQuick');
  if (!qb) {
    qb = document.createElement('div');
    qb.id = 'bidQuick'; qb.className = 'quickbids';
    document.getElementById('bidForm').appendChild(qb);
  }
  qb.innerHTML = [1, 10, 25, 50].map(d =>
    '<button type="button" class="secondary" data-add="' + d + '">+' + d + '</button>').join('') +
    '<span class="notice">Ваши деньги: <b>' + fmt(me.money) + '</b> д.е.</span>';
  qb.querySelectorAll('button').forEach(b => {
    b.onclick = () => { inp.value = a.price + Number(b.dataset.add); };
  });
  document.getElementById('bidHint').textContent =
    'Ставка × ' + a.qty + ' ед. спишется сразу при победе. Минимум: ' + (a.price + 1) + ' д.е.';
}

// ---------- Производство ----------
function renderProduce() {
  const rs = document.getElementById('resStats');
  let html = '<div class="stat hero"><div class="lbl">💰 Деньги</div><div class="val money" id="psMoney">' + fmt(me.money) + '</div></div>';
  for (const r of ['Сырьё', 'Труд', 'Энергия']) {
    html += '<div class="stat"><div class="lbl">' + (RES_ICONS[r] || '') + ' ' + r + '</div><div class="val">' + (me.bought[r] || 0) + '</div></div>';
  }
  rs.innerHTML = html;

  let limiting = null, best = Infinity;
  for (const r of Object.keys(me.recipe)) {
    const can = Math.floor((me.bought[r] || 0) / me.recipe[r]);
    if (can < best) { best = can; limiting = r; }
  }
  document.getElementById('goodsInfo').innerHTML =
    'Товар: <b>' + esc(me.goods) + '</b><br>Рецепт 1 единицы: <b>' + recipeText(me.recipe) + '</b>' +
    '<br>Предел выпуска: <b>10 ед.</b><br>' +
    '<span class="badge warn">Ограничивает: ' + esc(limiting || '—') + ' — на ' + (isFinite(best) ? best : 0) + ' ед.</span>';

  const form = document.getElementById('produceForm');
  const hint = document.getElementById('produceHint');
  if (me.productionLocked) {
    form.style.display = 'none';
    hint.innerHTML = '<span class="badge ok">🏗️ Производство запущено: ' + me.produced + ' ед.</span>';
  } else {
    form.style.display = '';
    const feas = me.produced;
    const inp = document.getElementById('produceQty');
    inp.max = feas; inp.value = Math.max(1, Math.min(Number(inp.value) || 1, feas));
    hint.textContent = 'Потолок по ресурсам: ' + feas + ' ед. Можно выпустить меньше — остальное не пропадёт, но и не заработает.';
  }
}

// ---------- Рынок ----------
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
  document.getElementById('btnLockPrice').disabled = me.priceLocked;
  sel.disabled = me.priceLocked;
  st.innerHTML = me.priceLocked ? '<span class="badge ok">цена зафиксирована: ' + me.price + ' д.е.</span>' : '';

  const mr = document.getElementById('marketResult');
  if (!me.priceLocked) { mr.innerHTML = ''; return; }
  const resolved = me.marketInfo && me.marketInfo.resolved;
  const have = me.productionLocked ? me.produced : me.produced;
  const d = me.marketInfo && me.marketInfo.demandAtMyPrice != null ? me.marketInfo.demandAtMyPrice : null;
  if (resolved) {
    mr.innerHTML =
      '<div class="stat-grid">' +
      '<div class="stat"><div class="lbl">Цена</div><div class="val">' + me.price + '</div></div>' +
      '<div class="stat"><div class="lbl">Спрос</div><div class="val">' + (d != null ? d : '—') + '</div></div>' +
      '<div class="stat"><div class="lbl">Продано</div><div class="val good">' + me.sold + ' ед.</div></div>' +
      '<div class="stat"><div class="lbl">Избыток</div><div class="val bad">' + me.unsold + ' ед.</div></div>' +
      '<div class="stat"><div class="lbl">Выручка</div><div class="val money">' + fmt(me.revenue) + '</div></div>' +
      '<div class="stat"><div class="lbl">Прибыль</div><div class="val ' + (me.profit >= 0 ? 'good' : 'bad') + '">' + fmt(me.profit) + '</div></div>' +
      '</div>' +
      '<p class="notice" style="margin-top:8px">' + (me.unsold > 0
        ? '⚠ Избыток: произвели больше, чем готовы купить. Лишние единицы не проданы, ресурсы на них потрачены зря.'
        : (d != null && d > me.sold ? 'Дефицит: спрос был больше выпуска — можно было продать дороже.' : 'Рынок сбалансирован.')) + '</p>';
  } else {
    mr.innerHTML =
      '<div class="stat-grid">' +
      '<div class="stat"><div class="lbl">Ваш выпуск</div><div class="val">' + have + ' ед.</div></div>' +
      '<div class="stat"><div class="lbl">Спрос по вашей цене</div><div class="val">' + (d != null ? d + ' ед.' : '—') + '</div></div>' +
      '</div><p class="notice" style="margin-top:8px">⏳ Аналитик сводит рынок…</p>';
  }
}

// ---------- Эластичность ----------
function renderElast() {
  document.getElementById('elastStatus').innerHTML = me.elasticity ? '<span class="badge ok">расчёт принят</span>' : '';
  document.getElementById('elastSStatus').innerHTML = me.elasticityS ? '<span class="badge ok">расчёт принят</span>' : '';
  if (me.price && !document.getElementById('p1').value) document.getElementById('p1').value = me.price;
  if (me.price && !document.getElementById('p2').value) document.getElementById('p2').value = me.price + 100;
}

// ---------- Финал ----------
function renderFinal() {
  const st = document.getElementById('finalStats');
  const capital = me.money + me.revenue - me.taxPaid;
  st.innerHTML =
    '<div class="stat"><div class="lbl">Остаток денег</div><div class="val money">' + fmt(me.money) + '</div></div>' +
    '<div class="stat"><div class="lbl">Затраты на ресурсы</div><div class="val">' + fmt(me.spent) + '</div></div>' +
    '<div class="stat"><div class="lbl">Произведено</div><div class="val">' + me.produced + ' ед.</div></div>' +
    '<div class="stat"><div class="lbl">Цена</div><div class="val">' + (me.price || '—') + '</div></div>' +
    '<div class="stat"><div class="lbl">Продано</div><div class="val">' + me.sold + ' ед.</div></div>' +
    '<div class="stat"><div class="lbl">Выручка</div><div class="val">' + fmt(me.revenue) + '</div></div>' +
    '<div class="stat"><div class="lbl">Налог</div><div class="val">' + fmt(me.taxPaid) + '</div></div>' +
    '<div class="stat"><div class="lbl">Прибыль</div><div class="val ' + (me.profit >= 0 ? 'good' : 'bad') + '">' + fmt(me.profit) + '</div></div>' +
    '<div class="stat hero"><div class="lbl">🏆 Капитал = деньги + выручка − налог</div><div class="val money">' + fmt(capital) + '</div></div>';
  document.getElementById('btnFinal').disabled = me.finalSubmitted;
  document.getElementById('finalStatus').innerHTML = me.finalSubmitted ? '<span class="badge ok">отчёт отправлен</span>' : '';
}

// ---------- Итоги ----------
function renderResults() {
  const box = document.getElementById('resultsBox');
  if (S.phase !== 'results') { box.textContent = 'Организатор ещё не подвёл итоги.'; return; }
  if (!S.results) { box.textContent = 'Организатор подводит итоги…'; return; }
  if (!celebrated) { celebrated = true; confetti(4200); Snd.fanfare(); }
  const top3 = S.results.filter(r => r.place <= 3);
  const rest = S.results.filter(r => r.place > 3);
  const heights = { 1: 'p1', 2: 'p2', 3: 'p3' };
  const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
  let pod = '<div class="podium">';
  for (const r of top3) {
    pod += '<div class="col ' + heights[r.place] + '"><div class="medal">' + medals[r.place] + '</div>' +
      '<div class="tname">' + (TEAM_EMOJI[r.id] || '') + ' ' + r.id + ' · ' + esc(r.name) + '</div>' +
      '<div class="cap">' + fmt(r.capital) + '</div><div class="bar"></div></div>';
  }
  pod += '</div>';
  let rows = '';
  for (const r of rest) {
    rows += '<tr' + (r.id === me.id ? ' class="hl"' : '') + '><td>' + r.place + '</td><td>' + (TEAM_EMOJI[r.id] || '') + ' ' + r.id + ' — ' + esc(r.name) + '</td><td class="num">' + fmt(r.capital) + '</td><td class="num">' + fmt(r.profit) + '</td><td class="num">' + r.score + '</td></tr>';
  }
  box.innerHTML = pod +
    (rows ? '<div class="tblwrap" style="margin-top:14px"><table class="tbl"><thead><tr><th>Место</th><th>Команда</th><th>Капитал, д.е.</th><th>Прибыль, д.е.</th><th>Баллы</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    '<p class="notice" style="margin-top:8px">Капитал = остаток денег + выручка − налог.</p>';
  const st2 = document.getElementById('finalStats2');
  st2.innerHTML =
    '<div class="stat hero"><div class="lbl">Ваш капитал</div><div class="val money">' + fmt(me.money + me.revenue - me.taxPaid) + '</div></div>' +
    '<div class="stat"><div class="lbl">Ваша прибыль</div><div class="val ' + (me.profit >= 0 ? 'good' : 'bad') + '">' + fmt(me.profit) + '</div></div>';
}

// ---------- Обработчики ----------
document.getElementById('btnReady1').onclick = async () => {
  const j = await api('/api/team/ready1', {});
  if (!j.ok) toast(j.error, false); else { Snd.bid(); toast('Анализ отправлен организаторам'); }
  load();
};

document.getElementById('btnBid').onclick = async () => {
  const a = me.auction;
  if (!a || a.closed) return;
  const price = Math.floor(Number(document.getElementById('bidInput').value));
  if (!price) { toast('Введите ставку', false); return; }
  if (price <= a.price) { toast('Ставка должна быть выше ' + a.price + ' д.е.', false); return; }
  if (price * a.qty > me.money) { toast('Не хватит денег: ' + price + ' × ' + a.qty + ' = ' + fmt(price * a.qty) + ' д.е.', false); return; }
  const j = await api('/api/team/bid', { price });
  if (j.ok) { Snd.bid(); toast('🔨 Ставка принята: ' + price + ' д.е./ед.'); document.getElementById('bidInput').value = ''; }
  else toast(j.error, false);
  load();
};

document.getElementById('btnProduce').onclick = async () => {
  const qty = Math.floor(Number(document.getElementById('produceQty').value));
  const j = await api('/api/team/produce', { qty });
  if (j.ok) { Snd.chime(); toast('🏗️ Производство запущено: ' + qty + ' ед.'); }
  else toast(j.error, false);
  load();
};

document.getElementById('btnLockPrice').onclick = async () => {
  const price = Number(document.getElementById('priceSel').value);
  const j1 = await api('/api/team/price', { price });
  if (!j1.ok) { toast(j1.error, false); return; }
  const j2 = await api('/api/team/lockPrice', {});
  if (j2.ok) { Snd.ding(); toast('🔒 Цена зафиксирована: ' + price + ' д.е.'); }
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
  if (!p1 || !p2 || (q1 === 0 && q2 === 0) || Number.isNaN(ed)) { toast('Заполните все поля расчёта', false); return; }
  if (!type) { toast('Выберите тип спроса', false); return; }
  const j = await api('/api/team/elasticity', { p1, p2, q1, q2, ed, type });
  if (j.ok) { Snd.ding(); toast('📨 Расчёт отправлен организаторам'); }
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
  if (j.ok) { Snd.ding(); toast('📨 Расчёт отправлен организаторам'); }
  else toast(j.error, false);
  load();
};

document.getElementById('btnFinal').onclick = async () => {
  const j = await api('/api/team/final', {});
  if (j.ok) { Snd.chime(); toast('📨 Отчёт отправлен'); }
  else toast(j.error, false);
  load();
};

let notesKey = 'rpd_notes';
document.getElementById('notes').addEventListener('input', (e) => {
  try { localStorage.setItem(notesKey, e.target.value); } catch (err) {}
});

load();
setInterval(load, 3000);