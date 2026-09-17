// ============================================================
// Деловая игра «Рынок под давлением» — сервер
// Чистый Node.js, без внешних зависимостей.
// Запуск:  node server.js   →  http://localhost:3088
// ============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 3088;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'state.json');

// ---------- Игровые константы ----------
const TEAM_IDS = ['A', 'B', 'C', 'D', 'E'];
const TEAM_NAMES = { A: 'Хлеб', B: 'Мебель', C: 'Одежда', D: 'Электроника', E: 'Стройматериалы' };
const RESOURCES = ['Сырьё', 'Труд', 'Энергия'];
const RES_BASE_PRICE = { 'Сырьё': 100, 'Труд': 150, 'Энергия': 100 };
const RES_TOTAL = { 'Сырьё': 50, 'Труд': 30, 'Энергия': 30 };
const START_CAPITAL = 10000;
const MAX_OUTPUT = 10;
const ADMIN_PASS = 'admin';

// Ресурсы на 1 единицу товара
const TEAM_RECIPES = {
  A: { 'Сырьё': 1, 'Энергия': 1 },
  B: { 'Сырьё': 1, 'Труд': 1 },
  C: { 'Сырьё': 1, 'Труд': 1 },
  D: { 'Сырьё': 1, 'Энергия': 1 },
  E: { 'Сырьё': 1, 'Энергия': 1 }
};

// Таблицы спроса: цена → объём спроса (упрощённая модель)
const DEMAND = {
  A: { 100: 10, 200: 8, 300: 6, 400: 4, 500: 2 },   // эластичный
  B: { 100: 10, 200: 9, 300: 8, 400: 7, 500: 6 },   // неэластичный
  C: { 100: 10, 200: 8, 300: 6, 400: 4, 500: 2 },   // эластичный
  D: { 100: 10, 200: 9, 300: 8, 400: 7, 500: 6 },   // неэластичный
  E: { 100: 10, 200: 8, 300: 6, 400: 4, 500: 2 }    // эластичный
};

// ---------- Состояние ----------
function teamKey(id) {
  return {
    id,
    name: TEAM_NAMES[id],
    goods: TEAM_NAMES[id],
    recipe: TEAM_RECIPES[id],
    demand: DEMAND[id],
    money: START_CAPITAL,
    bought: { 'Сырьё': 0, 'Труд': 0, 'Энергия': 0 },
    spent: 0,
    price: null,        // выбранная цена товара
    produced: 0,        // определённый выпуск
    sold: 0,            // фактически продано (мини-рынок)
    revenue: 0,
    profit: 0,
    unsold: 0,
    taxPaid: 0,
    round1Ready: false, // анализ спроса
    priceLocked: false, // цена зафиксирована (раунд 4)
    productionLocked: false,
    finalSubmitted: false,
    elasticity: null,   // результат расчёта команды (спрос)
    elasticityS: null,  // результат расчёта команды (предложение)
    score: 0
  };
}

function freshState() {
  return {
    phase: 'lobby',
    timerEnd: null,
    event: null,
    taxPerUnit: 0,
    supplyShock: null,
    secondAuctionDone: false,
    resourcePools: {
      'Сырьё': { total: RES_TOTAL['Сырьё'], available: RES_TOTAL['Сырьё'] },
      'Труд': { total: RES_TOTAL['Труд'], available: RES_TOTAL['Труд'] },
      'Энергия': { total: RES_TOTAL['Энергия'], available: RES_TOTAL['Энергия'] }
    },
    auction: null,          // {resource, qty, price, bids:[{team,price}], winner}
    market: null,           // {orders:[{team,qty,price}]} мини-рынок раунда 4
    auction2: null,
    log: [],
    teams: {},
    round: 0
  };
}
TEAM_IDS.forEach(id => { }); // (идентификация команд выполняется в freshState)

let state = freshState();
TEAM_IDS.forEach(id => { state.teams[id] = teamKey(id); });

// ---------- Сохранение / загрузка ----------
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) { console.error('save error', e); }
}
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (s && s.teams) { state = s; console.log('Состояние загружено из state.json'); }
    }
  } catch (e) { console.error('load error', e); }
}
loadState();

// ---------- Лог ----------
function log(msg) {
  state.log.push({ t: new Date().toLocaleTimeString('ru-RU'), msg });
  if (state.log.length > 300) state.log = state.log.slice(-300);
}

// ---------- Хелперы ----------
function teamPublic(t) {
  const feasible = Math.floor(Math.min(...RESOURCES.map(r =>
    (t.recipe[r] ? Math.floor((t.bought[r] || 0) / t.recipe[r]) : Infinity)
  ).concat([MAX_OUTPUT])));
  return {
    id: t.id, name: t.name, goods: t.goods, recipe: t.recipe, demand: t.demand,
    money: t.money, bought: t.bought, spent: t.spent,
    price: t.price, priceLocked: t.priceLocked,
    produced: t.productionLocked ? t.produced : feasible,
    productionLocked: t.productionLocked,
    sold: t.sold, revenue: t.revenue, profit: t.profit, unsold: t.unsold,
    taxPaid: t.taxPaid, score: t.score,
    round1Ready: t.round1Ready, finalSubmitted: t.finalSubmitted,
    elasticity: t.elasticity, elasticityS: t.elasticityS
  };
}

function demandAt(teamId, price) {
  const table = DEMAND[teamId];
  if (table[price] !== undefined) return table[price];
  // линейная интерполяция между ближайшими узлами
  const prices = Object.keys(table).map(Number).sort((a, b) => a - b);
  let lo = prices[0], hi = prices[prices.length - 1];
  for (let i = 0; i < prices.length - 1; i++) {
    if (price >= prices[i] && price <= prices[i + 1]) { lo = prices[i]; hi = prices[i + 1]; break; }
  }
  if (price < lo) return table[lo];
  if (price > hi) return 0;
  const q1 = table[lo], q2 = table[hi];
  return Math.round(q1 + (q2 - q1) * (price - lo) / (hi - lo));
}

// Эластичность по методу средней точки + классификация
function midpoint(q1, q2, p1, p2) {
  const avgQ = (q1 + q2) / 2, avgP = (p1 + p2) / 2;
  if (!avgQ || !avgP) return { value: 0, label: 'не определена' };
  const e = ((q2 - q1) / avgQ) / ((p2 - p1) / avgP);
  const a = Math.abs(e);
  let label;
  if (q1 === q2) label = 'совершенно неэластичный';
  else if (Math.abs(a - 1) < 0.005) label = 'единичная эластичность';
  else if (a > 1) label = 'эластичный';
  else label = 'неэластичный';
  return { value: Math.round(e * 100) / 100, label };
}

// Итоговая таблица (места по капиталу)
function leaderboard() {
  return TEAM_IDS.map(id => {
    const t = state.teams[id];
    return { id, name: t.name, capital: t.money + t.revenue - t.taxPaid, profit: t.profit, score: t.score };
  }).sort((a, b) => b.capital - a.capital).map((r, i) => Object.assign({}, r, { place: i + 1 }));
}

// ---------- API ----------
const api = {
  'POST /api/login': (body) => {
    if (body.role === 'admin') {
      if (body.pass !== ADMIN_PASS) return { ok: false, error: 'Неверный пароль организатора' };
      return { ok: true, redirect: '/admin.html' };
    }
    if (body.role === 'team') {
      const id = String(body.id || '').toUpperCase();
      if (!TEAM_IDS.includes(id)) return { ok: false, error: 'Неизвестная команда' };
      if (body.pass !== String(id) + '2026') return { ok: false, error: 'Неверный пароль команды' };
      return { ok: true, redirect: '/team.html' };
    }
    return { ok: false, error: 'Некорректный запрос' };
  },

  'GET /api/state': (body, q, sess) => {
    const isAdmin = sess === 'admin';
    const pub = { phase: state.phase, round: state.round, event: state.event, timerEnd: state.timerEnd, taxPerUnit: state.taxPerUnit };
    if (isAdmin) {
      pub.teams = {};
      TEAM_IDS.forEach(id => { pub.teams[id] = teamPublic(state.teams[id]); });
      pub.resourcePools = state.resourcePools;
      pub.auction = state.auction;
      pub.market = state.market;
      pub.log = state.log.slice(-40).reverse();
      pub.auction2 = state.auction2;
      return { ok: true, admin: true, state: pub };
    }
    const id = sess;
    if (!id || !state.teams[id]) return { ok: false, error: 'Требуется вход' };
    const t = state.teams[id];
    const mine = teamPublic(t);
    if (state.phase === 'market4' && state.market) {
      mine.marketInfo = {
        resolved: !!state.market.resolved,
        demandAtMyPrice: mine.price != null ? demandAt(id, mine.price) : null
      };
    }
    if ((state.phase === 'auction2' || state.phase === 'auction1' || state.phase === 'round6') && state.auction) {
      mine.auction = {
        resource: state.auction.resource, qty: state.auction.qty, price: state.auction.price,
        closed: state.auction.closed, winner: state.auction.winner, finalPrice: state.auction.finalPrice
      };
    }
    if (state.phase === 'results') pub.results = leaderboard();
    return { ok: true, admin: false, state: { ...pub, me: mine } };
  },

  'POST /api/admin/phase': (body) => {
    const p = body.phase;
    state.phase = p;
    state.round++;
    if (PHASE_TIMER[p]) state.timerEnd = Date.now() + PHASE_TIMER[p] * 1000;
    else state.timerEnd = null;
    if (p === 'market4') { state.market = { orders: [] }; }
    if (p === 'final') { state.timerEnd = null; }
    log(`Организатор перевёл игру в фазу «${PHASE_TITLES[p] || p}»`);
    return { ok: true };
  },

  'POST /api/admin/event': (body) => {
    state.event = body.text || null;
    if (body.taxPerUnit !== undefined) state.taxPerUnit = Math.max(0, Number(body.taxPerUnit) || 0);
    if (body.supplyShock) {
      state.supplyShock = body.supplyShock;
      for (const r of RESOURCES) {
        if (body.supplyShock[r] !== undefined) {
          state.resourcePools[r].available = Math.min(state.resourcePools[r].available, body.supplyShock[r]);
          state.resourcePools[r].total = Math.min(state.resourcePools[r].total, body.supplyShock[r]);
        }
      }
    }
    log('Событие рынка: ' + (state.event || '—') + (state.taxPerUnit ? ` (налог ${state.taxPerUnit} д.е./ед.)` : ''));
    return { ok: true };
  },

  'POST /api/admin/auction/start': (body) => {
    const res = body.resource;
    if (!RESOURCES.includes(res)) return { ok: false, error: 'Неизвестный ресурс' };
    const available = state.resourcePools[res].available;
    const qty = Math.max(1, Math.min(Number(body.qty) || available, available));
    if (available <= 0) return { ok: false, error: `Ресурс «${res}» закончился` };
    state.auction = {
      resource: res, qty, price: RES_BASE_PRICE[res],
      bids: [], winner: null, finalPrice: null, closed: false
    };
    if (state.phase === 'auction1') state.phase = 'auction2';
    state.timerEnd = null;
    log(`Аукцион: лот «${res}» — ${qty} ед., старт ${RES_BASE_PRICE[res]} д.е./ед.`);
    return { ok: true };
  },

  'POST /api/admin/auction/bid': (body) => {
    const a = state.auction;
    if (!a || a.closed) return { ok: false, error: 'Нет активного лота' };
    const team = String(body.team || '').toUpperCase();
    if (!TEAM_IDS.includes(team)) return { ok: false, error: 'Неизвестная команда' };
    const t = state.teams[team];
    const price = Math.floor(Number(body.price) || 0);
    if (price <= a.price) return { ok: false, error: `Ставка должна быть выше ${a.price}` };
    if (price * a.qty > t.money) return { ok: false, error: `У команды «${t.name}» недостаточно денег` };
    a.price = price;
    a.bids.push({ team, price, t: Date.now() });
    log(`Ставка: команда ${team} («${t.name}») — ${price} д.е./ед. за «${a.resource}»`);
    return { ok: true };
  },

  // Прямая продажа вне аукциона (например, торги шли устно)
  'POST /api/admin/quicksell': (body) => {
    const team = String(body.team || '').toUpperCase();
    const res = body.resource;
    if (!TEAM_IDS.includes(team)) return { ok: false, error: 'Неизвестная команда' };
    if (!RESOURCES.includes(res)) return { ok: false, error: 'Неизвестный ресурс' };
    const t = state.teams[team];
    const qty = Math.floor(Number(body.qty) || 0);
    const price = Math.floor(Number(body.price) || 0);
    if (!(qty > 0 && price > 0)) return { ok: false, error: 'Введите количество и цену' };
    if (qty > state.resourcePools[res].available) return { ok: false, error: `На складе только ${state.resourcePools[res].available} ед.` };
    const cost = qty * price;
    if (cost > t.money) return { ok: false, error: `У команды «${t.name}» не хватает денег (нужно ${cost} д.е.)` };
    t.money -= cost;
    t.spent += cost;
    t.bought[res] = (t.bought[res] || 0) + qty;
    state.resourcePools[res].available -= qty;
    log(`Вне аукциона: команда ${team} («${t.name}») купила ${qty} ед. «${res}» по ${price} д.е. = ${cost} д.е.`);
    return { ok: true };
  },

  // Таймер фазы
  'POST /api/admin/timer': (body) => {
    const min = Number(body.minutes);
    if (!min) { state.timerEnd = null; log('Таймер остановлен'); return { ok: true }; }
    state.timerEnd = Date.now() + min * 60 * 1000;
    log(`Таймер запущен на ${min} мин`);
    return { ok: true };
  },

  // Коррекция денег команды (банкир)
  'POST /api/admin/adjmoney': (body) => {
    const team = String(body.team || '').toUpperCase();
    if (!TEAM_IDS.includes(team)) return { ok: false, error: 'Неизвестная команда' };
    const amt = Math.floor(Number(body.amount) || 0);
    if (!amt) return { ok: false, error: 'Введите сумму' };
    const t = state.teams[team];
    t.money = Math.max(0, t.money + amt);
    log(`Банкир: деньги команды ${team} («${t.name}») изменены на ${amt} д.е. — стало ${t.money} д.е.`);
    return { ok: true };
  },

  'POST /api/admin/auction/close': (body) => {
    const a = state.auction;
    if (!a || a.closed) return { ok: false, error: 'Нет активного лота' };
    a.closed = true;
    a.finalPrice = a.price;
    if (a.bids.length > 0) {
      const last = a.bids[a.bids.length - 1];
      const winner = state.teams[last.team];
      const cost = last.price * a.qty;
      if (winner.money >= cost) {
        a.winner = last.team;
        winner.money -= cost;
        winner.spent += cost;
        winner.bought[a.resource] = (winner.bought[a.resource] || 0) + a.qty;
        state.resourcePools[a.resource].available -= a.qty;
        log(`Лот «${a.resource}» продан: команда ${last.team} («${winner.name}») — ${a.qty} ед. по ${last.price} д.е. = ${cost} д.е.`);
      } else {
        log(`⚠ Лот «${a.resource}» не продан: у победителя не хватило денег.`);
      }
    } else {
      log(`Лот «${a.resource}» не продан: ставок не было.`);
    }
    state.auction = a;
    return { ok: true, winner: a.winner };
  },

  'POST /api/admin/grade': (body) => {
    const team = String(body.team || '').toUpperCase();
    const pts = Math.max(0, Math.min(60, Number(body.points) || 0));
    if (!TEAM_IDS.includes(team)) return { ok: false, error: 'Неизвестная команда' };
    state.teams[team].score = pts;
    return { ok: true };
  },

  // Свести рынок раунда 4: продать каждой команде min(выпуск, спрос)
  'POST /api/admin/resolve': () => {
    if (state.phase !== 'market4') return { ok: false, error: 'Рынок сводится в фазе «Рынок и равновесие»' };
    let any = false;
    TEAM_IDS.forEach(id => {
      const t = state.teams[id];
      if (t.price == null) return;
      const have = t.productionLocked ? t.produced
        : Math.min(MAX_OUTPUT, ...RESOURCES.map(r => t.recipe[r] ? Math.floor((t.bought[r] || 0) / t.recipe[r]) : Infinity));
      const d = demandAt(id, t.price);
      const sold = Math.min(have, d);
      const unsold = have - sold;
      const revenue = sold * t.price;
      const tax = state.taxPerUnit * sold;
      t.produced = have;
      t.productionLocked = true;
      t.sold = sold;
      t.unsold = unsold;
      t.revenue = revenue;
      t.taxPaid = tax;
      t.profit = revenue - t.spent - tax;
      any = true;
      log(`Рынок: команда ${id} («${t.name}») — цена ${t.price} д.е., спрос ${d} шт., продано ${sold} шт., выручка ${revenue} д.е.`);
    });
    if (!any) return { ok: false, error: 'Ни одна команда не зафиксировала цену' };
    state.market = state.market || { orders: [] };
    state.market.resolved = true;
    log('Рынок сведён аналитиком. Результаты продаж показаны командам.');
    return { ok: true };
  },

  // Эталонная эластичность спроса по всем командам (для проверки расчётов)
  'POST /api/admin/ed': (body) => {
    const p1 = Number(body.p1), p2 = Number(body.p2);
    if (!(p1 > 0 && p2 > 0 && p1 !== p2)) return { ok: false, error: 'Цены должны быть положительными и разными' };
    const teams = {};
    TEAM_IDS.forEach(id => {
      const q1 = demandAt(id, p1), q2 = demandAt(id, p2);
      const m = midpoint(q1, q2, p1, p2);
      teams[id] = { q1, q2, ed: m.value, type: m.label };
    });
    return { ok: true, teams };
  },

  // Эталонная эластичность предложения по введённым точкам
  'POST /api/admin/es': (body) => {
    const p1 = Number(body.p1), p2 = Number(body.p2);
    const q1 = Number(body.q1), q2 = Number(body.q2);
    if (!(p1 > 0 && p2 > 0)) return { ok: false, error: 'Введите цены больше нуля' };
    const m = midpoint(q1, q2, p1, p2);
    return { ok: true, es: m.value, type: m.label };
  },

  'POST /api/admin/reset': () => {
    const keep = { log: state.log };
    state = freshState();
    TEAM_IDS.forEach(id => { state.teams[id] = teamKey(id); });
    state.log = keep.log;
    log('♻ Игра полностью сброшена организатором');
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (e) {}
    return { ok: true };
  },

  'POST /api/team/ready1': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    t.round1Ready = true;
    log(`Команда ${sess} завершила анализ спроса`);
    return { ok: true };
  },

  'POST /api/team/price': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    if (t.priceLocked) return { ok: false, error: 'Цена уже зафиксирована' };
    const price = Math.floor(Number(body.price) || 0);
    if (![100, 150, 200, 250, 300, 350, 400, 450, 500].includes(price))
      return { ok: false, error: 'Допустимые цены: 100, 150, 200, 250, 300, 350, 400, 450, 500' };
    t.price = price;
    return { ok: true };
  },

  'POST /api/team/lockPrice': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    if (t.price == null) return { ok: false, error: 'Сначала выберите цену' };
    t.priceLocked = true;
    log(`Команда ${sess} («${t.name}») зафиксировала цену товара: ${t.price} д.е.`);
    return { ok: true };
  },

  'POST /api/team/produce': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    if (t.productionLocked) return { ok: false, error: 'Выпуск уже зафиксирован' };
    const feasible = Math.min(MAX_OUTPUT, ...RESOURCES.map(r =>
      t.recipe[r] ? Math.floor((t.bought[r] || 0) / t.recipe[r]) : Infinity
    ));
    if (!isFinite(feasible) || feasible <= 0) return { ok: false, error: 'Недостаточно ресурсов для производства' };
    const qty = Math.floor(Number(body.qty));
    if (!(qty >= 1 && qty <= feasible)) return { ok: false, error: `Можно произвести от 1 до ${feasible} ед.` };
    t.produced = qty;
    t.productionLocked = true;
    log(`Команда ${sess} произвела ${qty} ед. товара «${t.goods}»`);
    return { ok: true };
  },

  'POST /api/team/sell': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t || state.phase !== 'market4' || !state.market) return { ok: false, error: 'Рынок сейчас неактивен' };
    if (t.price == null) return { ok: false, error: 'Сначала установите цену' };
    const have = t.productionLocked ? t.produced
      : Math.min(MAX_OUTPUT, ...RESOURCES.map(r => t.recipe[r] ? Math.floor((t.bought[r] || 0) / t.recipe[r]) : Infinity));
    if (have <= 0) return { ok: false, error: 'Нечего продавать — нет произведённого товара' };
    const existing = state.market.orders.find(o => o.team === sess);
    const qty = Math.floor(Number(body.qty));
    if (!(qty >= 0 && qty <= have)) return { ok: false, error: `Доступно для продажи: ${have} ед.` };
    if (existing) existing.qty = qty;
    else state.market.orders.push({ team: sess, qty, price: t.price });
    return { ok: true };
  },

  'POST /api/team/elasticity': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    t.elasticity = {
      p1: Number(body.p1) || 0, p2: Number(body.p2) || 0,
      q1: Number(body.q1) || 0, q2: Number(body.q2) || 0,
      ed: Number(body.ed) || 0,
      type: String(body.type || '')
    };
    log(`Команда ${sess} отправила расчёт эластичности спроса: E = ${t.elasticity.ed}, тип — ${t.elasticity.type}`);
    return { ok: true };
  },

  'POST /api/team/elasticityS': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    t.elasticityS = {
      sp1: Number(body.sp1) || 0, sp2: Number(body.sp2) || 0,
      sq1: Number(body.sq1) || 0, sq2: Number(body.sq2) || 0,
      es: Number(body.es) || 0, concl: String(body.concl || '')
    };
    log(`Команда ${sess} отправила расчёт эластичности предложения: E = ${t.elasticityS.es}, вывод — ${t.elasticityS.concl}`);
    return { ok: true };
  },

  // Ставка от самой команды (дублирует ставку аукциониста)
  'POST /api/team/bid': (body, q, sess) => {
    const a = state.auction;
    if (!a || a.closed) return { ok: false, error: 'Нет активного лота' };
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    const price = Math.floor(Number(body.price) || 0);
    if (!(price > 0)) return { ok: false, error: 'Введите цену' };
    if (price <= a.price) return { ok: false, error: `Ставка должна быть выше ${a.price} д.е.` };
    if (price * a.qty > t.money) return { ok: false, error: `Недостаточно денег: нужно ${price * a.qty} д.е., у вас ${t.money} д.е.` };
    a.price = price;
    a.bids.push({ team: sess, price, t: Date.now() });
    log(`Ставка: команда ${sess} («${t.name}») — ${price} д.е./ед. за «${a.resource}»`);
    return { ok: true };
  },

  'POST /api/team/final': (body, q, sess) => {
    const t = state.teams[sess];
    if (!t) return { ok: false, error: 'Нет команды' };
    t.finalSubmitted = true;
    log(`Команда ${sess} отправила итоговый отчёт`);
    return { ok: true };
  }
};

// Таймеры фаз по умолчанию (сек)
const PHASE_TIMER = {
  lobby: 0, intro: 0, round1: 7 * 60, auction1: 10 * 60,
  round3: 5 * 60, market4: 7 * 60, round5: 7 * 60,
  round6: 5 * 60, final: 5 * 60, results: 0, auction2: 0
};
const PHASE_TITLES = {
  lobby: 'Ожидание', intro: 'Знакомство с игрой', round1: 'Раунд 1 — Анализ спроса',
  auction1: 'Раунд 2 — Аукцион ресурсов', auction2: 'Аукцион (торги идут)',
  round3: 'Раунд 3 — Производство', market4: 'Раунд 4 — Рынок и равновесие',
  round5: 'Раунд 5 — Эластичность спроса', round6: 'Раунд 6 — Эластичность предложения',
  final: 'Раунд 7 — Итоговый расчёт', results: 'Итоги'
};

// ---------- Сессии ----------
const sessions = {};
function getSession(req) {
  const cookies = req.headers.cookie || '';
  const m = cookies.match(/sid=([a-f0-9]+)/);
  if (m && sessions[m[1]]) return sessions[m[1]];
  return null;
}
function setSession(res, value) {
  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = value;
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

// ---------- HTTP ----------
function sendJSON(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return sendJSON(res, 400, { ok: false, error: 'Некорректный JSON' }); }
      const key = `${req.method} ${pathname}`;
      const handler = api[key];
      const sess = getSession(req);
      if (!handler) return sendJSON(res, 404, { ok: false, error: 'Нет такого API' });

      // защита: командные эндпоинты — только для команд, админские — только для админа
      const adminOnly = key.startsWith('POST /api/admin/');
      if (adminOnly && sess !== 'admin') return sendJSON(res, 403, { ok: false, error: 'Доступ только для организаторов' });
      if (!adminOnly && key.startsWith('POST /api/team/') && (!sess || sess === 'admin'))
        return sendJSON(res, 403, { ok: false, error: 'Доступ только для команд' });

      try {
        const result = handler(body, url.searchParams, sess, req, res);
        // логин устанавливает сессию
        if (key === 'POST /api/login' && result.ok) setSession(res, body.role === 'admin' ? 'admin' : String(body.id).toUpperCase());
        saveState();
        sendJSON(res, 200, result);
      } catch (e) {
        console.error(e);
        sendJSON(res, 500, { ok: false, error: 'Внутренняя ошибка сервера' });
      }
    });
    return;
  }

  // статика
  let file = pathname === '/' ? '/index.html' : pathname;
  file = file.split('?')[0];
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 — страница не найдена'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// Автосохранение каждые 10 секунд
setInterval(saveState, 10000);

server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║   Деловая игра «Рынок под давлением»                 ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log(`  Сервер запущен:  http://localhost:${PORT}`);
  console.log(`  Админ-пароль:    ${ADMIN_PASS}`);
  console.log('  Пароли команд:   A2026 B2026 C2026 D2026 E2026');
  console.log('');
});
