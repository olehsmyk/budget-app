import * as C from './core.js';
import { CATEGORY_ICONS } from './category-icons.js';

const KEY = 'budget.v1';
const COMMON_CURRENCIES = ['USD', 'EUR', 'UAH', 'IDR', 'GBP', 'PLN', 'CZK', 'CHF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY'];
const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const RATES_MAX_AGE_MS = 24 * 3600 * 1000; // The service only publishes new rates once a day.
const BACKUP_REMINDER_DAYS = 30;
const SEARCH_LIMIT = 200;
const TREND_MONTHS = 6;
const CATEGORY_SHORTLIST = 12;
const ICON_KEYS = Object.keys(CATEGORY_ICONS);

const today = () => C.toISO(new Date());
const $ = (id) => document.getElementById(id);

// ---------- Auto-escaping templates: every interpolated value is escaped unless it is itself html`` ----------

class Raw {
  constructor(s) {
    this.s = s;
  }
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const part = (v) => {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  return v instanceof Raw ? v.s : esc(v);
};
const html = (strings, ...values) =>
  new Raw(strings.reduce((out, s, i) => out + s + (i < values.length ? part(values[i]) : ''), ''));

// ---------- State ----------

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return C.defaultState(today());
  try {
    const saved = JSON.parse(raw);
    const loaded = C.validateBackup(saved);
    // Keep an untouched copy of the first format, then store the upgraded data.
    if (saved.version < 2) localStorage.setItem(`${KEY}.before-wallets`, raw);
    if (saved.version !== loaded.version) localStorage.setItem(KEY, JSON.stringify(loaded));
    return loaded;
  } catch {
    // Never overwrite data we could not read: park it under another key.
    localStorage.setItem(`${KEY}.unreadable`, raw);
    return C.defaultState(today());
  }
}

let state = load();
const ui = { tab: 'home', month: C.monthOf(today()), search: '', filterCat: '', filterWallet: '', donutCat: null, showEmptyWallets: false, sheet: null };

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast('Could not save: storage is full. Export a backup now.');
  }
}

function runRecurring() {
  const added = C.applyRecurring(state, today());
  if (added) save();
  return added;
}

const category = (id) => state.categories.find((c) => c.id === id);
const activeCategories = (kind) => state.categories.filter((c) => c.kind === kind && !c.archived);
function categoriesByUse(kind) {
  const uses = new Map();
  for (const t of state.tx) uses.set(t.categoryId, (uses.get(t.categoryId) || 0) + 1);
  // sort keeps the list order for ties, so a new install shows the everyday categories first.
  return activeCategories(kind).sort((a, b) => (uses.get(b.id) || 0) - (uses.get(a.id) || 0));
}
const wallet = (id) => state.wallets.find((w) => w.id === id);
const activeWallets = () => state.wallets.filter((w) => !w.archived);
const otherWallet = (id) => activeWallets().find((w) => w.id !== id)?.id ?? null;
const defaultWalletId = () => (wallet(state.lastWalletId)?.archived === false ? state.lastWalletId : activeWallets()[0].id);
const walletInUse = (id) =>
  state.tx.some((t) => t.walletId === id || t.toWalletId === id) || state.recurring.some((r) => r.walletId === id);

// A wallet's currency, plus the one already chosen on a form even if that wallet is now hidden.
const walletChoices = (selectedId) => {
  const selected = wallet(selectedId);
  return selected?.archived ? [...activeWallets(), selected] : activeWallets();
};

// ---------- Formatting ----------

// Intl shows two decimals for these, but nobody uses fractions of them in practice.
const WHOLE_NUMBER_CURRENCIES = new Set(['IDR']);

const money = (cents, currency = state.currency) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    ...(WHOLE_NUMBER_CURRENCIES.has(currency) && { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  }).format(cents / 100);
const moneyCompact = (cents) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: state.currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(cents / 100);
const moneyRounded = (cents) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
const formatRate = (rate) => String(Number(rate.toPrecision(6)));
const monthDate = (key) => C.fromISO(`${key}-01`);
const monthLabel = (key) =>
  monthDate(key).toLocaleDateString('en', { month: 'long', year: 'numeric' });
const monthShort = (key) => monthDate(key).toLocaleDateString('en', { month: 'short' });
const shortDate = (iso) =>
  C.fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dayMonth = (iso) => C.fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
// For saved moments like "last backup": the date it was here, not the UTC date.
const shortMoment = (timestamp) => shortDate(C.toISO(new Date(timestamp)));

function dayLabel(iso) {
  const now = new Date();
  const yesterday = C.toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (iso === today()) return 'Today';
  if (iso === yesterday) return 'Yesterday';
  return C.fromISO(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------- Icons ----------

const svg = (d, extra = '') =>
  new Raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}><path d="${d}"/></svg>`,
  );
const ICONS = {
  home: 'M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6',
  activity: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  insights: 'M5 21V11M12 21V3M19 21v-6',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  swap: 'M7 4L3 8l4 4M3 8h14M17 12l4 4-4 4M21 16H7',
  scale: 'M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7M19 7l-3 7a3 3 0 0 0 6 0l-3-7',
};

// Icon and color names can come from an imported file, so both are looked up, never inserted as given.
const colorClass = (key) => `c-${C.COLOR_KEYS.includes(key) ? key : 'gray'}`;
const iconMarkup = (key) =>
  new Raw(
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
      CATEGORY_ICONS[ICON_KEYS.includes(key) ? key : 'tag']
    }</svg>`,
  );
const badge = (item, size = '') =>
  html`<span class="badge ${colorClass(item.color)} ${size}" aria-hidden="true">${iconMarkup(item.icon)}</span>`;

// ---------- Shared pieces ----------

const monthNav = () => {
  const atCurrent = ui.month >= C.monthOf(today());
  return html`<div class="month-nav">
    <button class="icon-btn" data-a="monthPrev" aria-label="Previous month">${svg(ICONS.left)}</button>
    <h1>${monthLabel(ui.month)}</h1>
    <button class="icon-btn" data-a="monthNext" aria-label="Next month" ${atCurrent ? 'disabled' : ''}>${svg(ICONS.right)}</button>
  </div>`;
};

const signedMoney = (cents, currency) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${money(Math.abs(cents), currency)}`;

function correctionRow(t) {
  const w = wallet(t.walletId);
  return html`<button class="tx" data-a="editCorrection" data-id="${t.id}">
    <span class="tx-icon" aria-hidden="true">${svg(ICONS.scale)}</span>
    <span class="tx-main">
      <div class="tx-title">${t.note || 'Balance correction'}</div>
      <div class="tx-sub">${t.note ? 'Balance correction · ' : ''}${w.name}</div>
    </span>
    <span class="tx-amount ${t.increase ? 'income' : ''}">${signedMoney(t.increase ? t.amount : -t.amount, w.currency)}</span>
  </button>`;
}

function txRow(t) {
  if (t.type === 'adjustment') return correctionRow(t);
  const w = wallet(t.walletId);
  if (t.type === 'transfer') {
    const to = wallet(t.toWalletId);
    return html`<button class="tx" data-a="editTx" data-id="${t.id}">
      <span class="tx-icon" aria-hidden="true">${svg(ICONS.swap)}</span>
      <span class="tx-main">
        <div class="tx-title">${t.note || 'Transfer'}</div>
        <div class="tx-sub">${w.name} → ${to.name}</div>
      </span>
      <span class="tx-amount">${money(t.amount, w.currency)}
        ${w.currency !== to.currency && html`<div class="tx-sub">→ ${money(t.toAmount, to.currency)}</div>`}
      </span>
    </button>`;
  }
  const c = category(t.categoryId);
  const details = [t.note && c.name, state.wallets.length > 1 && w.name, t.recurringId && 'Recurring'].filter(Boolean);
  return html`<button class="tx" data-a="editTx" data-id="${t.id}">
    ${badge(c)}
    <span class="tx-main">
      <div class="tx-title">${t.note || c.name}</div>
      <div class="tx-sub">${details.join(' · ')}</div>
    </span>
    <span class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '−'}${money(t.amount, w.currency)}</span>
  </button>`;
}

const txGroups = (list) => {
  const days = new Map();
  for (const t of list) {
    if (!days.has(t.date)) days.set(t.date, []);
    days.get(t.date).push(t);
  }
  return [...days].map(
    ([date, items]) => html`<div class="day-head"><span>${dayLabel(date)}</span></div>${items.map(txRow)}`,
  );
};

const budgetBar = (spent, limit) => {
  const pct = limit ? Math.min(100, (spent / limit) * 100) : 0;
  return html`<div class="bar ${spent > limit ? 'over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>`;
};

const leftText = (spent, limit) =>
  spent > limit
    ? html`<span class="over-text">${money(spent - limit)} over</span>`
    : html`${money(limit - spent)} left`;

const approx = (converted) => (converted ? '≈\u00a0' : '');

// Large totals, common in currencies like UAH and IDR, shrink to stay on one line.
const heroAmount = (text) => {
  const size = text.length <= 11 ? '' : text.length <= 15 ? 'hero-medium' : 'hero-small';
  return html`<div class="hero-amount ${size}">${text}</div>`;
};

const missingRateNote = (missing) =>
  missing.size > 0 &&
  html`<button class="missing-rate" data-a="openRates">
    No exchange rate for ${[...missing].join(', ')}, so it isn't counted here. <b>Set a rate</b>
  </button>`;

function currencyOptions(selected) {
  const all = Intl.supportedValuesOf?.('currency') ?? [];
  return [...new Set([selected, ...COMMON_CURRENCIES, ...all])].map(
    (code) => html`<option ${code === selected ? 'selected' : ''}>${code}</option>`,
  );
}

// ---------- Home ----------

function banners() {
  const out = [];
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (iOS && !navigator.standalone) {
    out.push(html`<div class="banner"><strong>Install this app</strong>
      <span>Tap the Share button, then Add to Home Screen. Open it from there: Safari can clear data for sites it treats as unused.</span></div>`);
  }
  const since = state.lastBackup || state.createdAt;
  const days = (Date.now() - C.fromISO(since.slice(0, 10)).getTime()) / 86400000;
  if (state.tx.length && days > BACKUP_REMINDER_DAYS) {
    out.push(html`<div class="banner"><strong>Time for a backup</strong>
      <span>Your data lives only on this phone.</span>
      <button class="link" data-a="backup">Back up now</button></div>`);
  }
  return out;
}

function walletsCard() {
  const worth = C.netWorth(state);
  const bal = C.balances(state);
  const withMoney = activeWallets().filter((w) => bal.get(w.id) !== 0);
  const shown = ui.showEmptyWallets || !withMoney.length ? activeWallets() : withMoney;
  const emptyCount = activeWallets().length - withMoney.length;
  return html`<section class="card">
    <div class="row-between">
      <h2 class="section-title">All my money</h2>
      <button class="link" data-a="openWallets">Edit</button>
    </div>
    <div>
      <label class="total-label">Total in
        <select class="total-select" data-change="currency" aria-label="Total currency">${currencyOptions(state.currency)}</select>
      </label>
      ${heroAmount(approx(worth.converted) + money(worth.total))}
    </div>
    ${missingRateNote(worth.missing)}
    <div class="wallet-list">${shown.map((w) => {
      const value = C.convert(state, bal.get(w.id), w.currency);
      return html`<button class="tx" data-a="openWallet" data-id="${w.id}">
        ${badge(w)}
        <span class="tx-main">
          <div class="tx-title">${w.name}</div>
          ${w.currency !== state.currency &&
          html`<div class="tx-sub">${value === null ? 'No rate yet' : `≈ ${money(value)}`}</div>`}
        </span>
        <span class="tx-amount">${money(bal.get(w.id), w.currency)}</span>
      </button>`;
    })}</div>
    ${withMoney.length > 0 && emptyCount > 0 && html`<button class="link" data-a="toggleEmptyWallets">
      ${ui.showEmptyWallets ? 'Hide empty wallets' : `Show ${emptyCount} empty ${emptyCount === 1 ? 'wallet' : 'wallets'}`}</button>`}
    <div class="btn-row">
      <button class="btn" data-a="newTransfer">Move money</button>
      <button class="btn" data-a="openReconcile">Correct balances</button>
    </div>
  </section>`;
}

function viewHome() {
  const list = C.sortTx(C.txInMonth(state.tx, ui.month));
  const { income, expense, byCategory, missing, converted } = C.summarize(state, list);
  const limited = state.categories
    .filter((c) => c.kind === 'expense' && c.limit && !c.archived)
    .map((c) => ({ c, spent: byCategory.get(c.id) || 0 }))
    .sort((a, b) => b.spent / b.c.limit - a.spent / a.c.limit);
  const totalLimit = limited.reduce((sum, x) => sum + x.c.limit, 0);
  const limitedSpent = limited.reduce((sum, x) => sum + x.spent, 0);
  const net = income - expense;

  return html`${banners()}${walletsCard()}${monthNav()}
    <section class="card">
      <div>
        <div class="hero-label">Spent</div>
        ${heroAmount(approx(converted) + money(expense))}
      </div>
      ${totalLimit > 0 && html`${budgetBar(limitedSpent, totalLimit)}
        <div class="small">${leftText(limitedSpent, totalLimit)} of ${money(totalLimit)} budgeted</div>`}
      <div class="stats">
        <div><div class="small">Income</div><div class="stat-value">${approx(converted)}${money(income)}</div></div>
        <div><div class="small">Net</div><div class="stat-value">${approx(converted)}${net < 0 ? '−' : ''}${money(Math.abs(net))}</div></div>
      </div>
      ${missingRateNote(missing)}
    </section>

    <section class="card">
      <div class="row-between">
        <h2 class="section-title">Budgets</h2>
        <button class="link" data-a="openCategories">Edit</button>
      </div>
      ${limited.length
        ? limited.map(
            (x) => html`<div class="budget-row">
              <div class="row-between">
                <span class="budget-name">${badge(x.c, 'badge-small')} ${x.c.name}</span>
                <span class="small">${leftText(x.spent, x.c.limit)}</span>
              </div>
              ${budgetBar(x.spent, x.c.limit)}
              <div class="small">${money(x.spent)} of ${money(x.c.limit)}</div>
            </div>`,
          )
        : html`<p class="small">No limits yet. Tap Edit to set a monthly limit for a category.</p>`}
    </section>

    <section>
      <div class="row-between" style="padding-bottom:8px">
        <h2 class="section-title">Recent</h2>
        ${list.length > 5 && html`<button class="link" data-a="tab" data-tab="activity">See all</button>`}
      </div>
      <div class="card card-flush">
        ${list.length
          ? list.slice(0, 5).map(txRow)
          : html`<p class="empty">Nothing this month. Tap + to add your first entry.</p>`}
      </div>
    </section>`;
}

// ---------- Activity ----------

function activityResults() {
  const q = ui.search.trim().toLowerCase();
  let list = q ? state.tx : C.txInMonth(state.tx, ui.month);
  if (ui.filterCat) list = list.filter((t) => t.categoryId === ui.filterCat);
  if (ui.filterWallet) list = list.filter((t) => t.walletId === ui.filterWallet || t.toWalletId === ui.filterWallet);
  if (q) {
    list = list.filter((t) => {
      const label = t.type === 'transfer' ? 'transfer' : t.type === 'adjustment' ? 'balance correction' : category(t.categoryId).name;
      return `${t.note || ''} ${label} ${wallet(t.walletId).name}`.toLowerCase().includes(q);
    });
  }
  const sorted = C.sortTx(list);
  const shown = sorted.slice(0, q ? SEARCH_LIMIT : undefined);
  if (!shown.length) return html`<div class="card card-flush"><p class="empty">No matching entries.</p></div>`;
  return html`<div class="card card-flush">${txGroups(shown)}</div>
    ${sorted.length > shown.length && html`<p class="small">Showing the latest ${shown.length} of ${sorted.length}.</p>`}`;
}

function viewActivity() {
  const w = wallet(ui.filterWallet);
  return html`${w && html`<section class="card">
      <div class="row-between">
        <span class="budget-name">${badge(w, 'badge-small')} ${w.name}</span>
        <button class="link" data-a="editWallet" data-id="${w.id}">Edit</button>
      </div>
      ${heroAmount(money(C.balances(state).get(w.id), w.currency))}
      <button class="btn" data-a="openReconcile" data-wallet="${w.id}">Correct balance</button>
    </section>`}
    ${!ui.search.trim() && monthNav()}
    <div class="filters">
      <input id="search" class="input" type="search" placeholder="Search all months" aria-label="Search all months" value="${ui.search}">
      <select class="input" data-change="filterWallet" aria-label="Filter by wallet">
        <option value="">All wallets</option>
        ${state.wallets.map(
          (x) => html`<option value="${x.id}" ${x.id === ui.filterWallet ? 'selected' : ''}>${x.name}</option>`,
        )}
      </select>
      <select class="input" data-change="filterCat" aria-label="Filter by category">
        <option value="">All categories</option>
        ${state.categories.map(
          (c) => html`<option value="${c.id}" ${c.id === ui.filterCat ? 'selected' : ''}>${c.name}</option>`,
        )}
      </select>
    </div>
    <div id="activity-results" style="display:grid;gap:8px">${activityResults()}</div>`;
}

// ---------- Insights ----------

function trendEnd() {
  const current = C.monthOf(today());
  return ui.month > C.addMonths(current, -TREND_MONTHS) ? current : ui.month;
}

function barPath(x, y, w, h, r) {
  const radius = Math.min(r, h, w / 2);
  return `M${x} ${y + h}V${y + radius}Q${x} ${y} ${x + radius} ${y}H${x + w - radius}Q${x + w} ${y} ${x + w} ${y + radius}V${y + h}Z`;
}

function trendChart(rows) {
  const W = 340;
  const H = 190;
  const left = 46;
  const top = 8;
  const bottom = 24;
  const plotH = H - top - bottom;
  const max = C.niceMax(Math.max(...rows.map((r) => Math.max(r.income, r.expense))));
  const groupW = (W - left) / rows.length;
  const barW = Math.min(14, (groupW - 10) / 2);
  const yOf = (v) => top + plotH - (v / max) * plotH;

  const grid = [0, 0.5, 1].map((f) => {
    const y = yOf(max * f);
    return html`<line class="grid" x1="${left}" x2="${W}" y1="${y}" y2="${y}"></line>
      <text x="${left - 6}" y="${y + 4}" text-anchor="end">${moneyCompact(max * f)}</text>`;
  });

  const hits = rows.map((r, i) => {
    const gx = left + i * groupW;
    return html`<rect class="hit ${r.key === ui.month ? 'selected' : ''}" x="${gx + 2}" y="0" width="${groupW - 4}" height="${H}" rx="8"
      data-a="pickMonth" data-key="${r.key}" role="button"
      aria-label="${monthLabel(r.key)}: income ${money(r.income)}, expenses ${money(r.expense)}"></rect>`;
  });

  const bars = rows.map((r, i) => {
    const cx = left + i * groupW + groupW / 2;
    const bar = (value, x, cls) => {
      if (!value) return '';
      const h = Math.max(2, (value / max) * plotH);
      return html`<path class="${cls}" d="${barPath(x, top + plotH - h, barW, h, 4)}"></path>`;
    };
    return html`${bar(r.income, cx - barW - 1, 'income')}
      ${bar(r.expense, cx + 1, 'expense')}
      <text class="${r.key === ui.month ? 'selected' : ''}" x="${cx}" y="${H - 7}" text-anchor="middle">${monthShort(r.key)}</text>`;
  });

  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Income and expenses by month">
    ${hits}<g pointer-events="none">${grid}${bars}</g>
  </svg>`;
}

function donut(spent, total, converted) {
  const R = 80;
  const CIRCUMFERENCE = 2 * Math.PI * R;
  const GAP = spent.length > 1 ? 2 : 0;
  const chosen = spent.find((x) => x.c.id === ui.donutCat);
  const shown = chosen ? chosen.amount : total;
  const rounded = approx(converted) + moneyRounded(shown);
  const center = rounded.length <= 14 ? rounded : approx(converted) + moneyCompact(shown);
  let offset = 0;
  const slices = spent.map((x) => {
    const length = (x.amount / total) * CIRCUMFERENCE;
    const dash = Math.max(length - GAP, 1);
    const slice = html`<circle class="slice ${colorClass(x.c.color)} ${chosen && chosen !== x ? 'dim' : ''}"
      cx="100" cy="100" r="${R}" stroke-dasharray="${dash} ${CIRCUMFERENCE - dash}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 100 100)" data-a="pickSlice" data-id="${x.c.id}" role="button"
      aria-label="${x.c.name}: ${money(x.amount)}"></circle>`;
    offset += length;
    return slice;
  });
  return html`<div class="donut">
    <svg viewBox="0 0 200 200" role="group" aria-label="Spending by category">${slices}</svg>
    <div class="donut-center">
      <div class="small">${chosen ? chosen.c.name : 'Spent'}</div>
      <div class="donut-amount ${center.length > 10 ? 'donut-amount-long' : ''}">${center}</div>
      ${chosen && html`<div class="small">${percent(chosen.amount, total)}</div>`}
    </div>
  </div>`;
}

const percent = (part, whole) => (part / whole < 0.01 ? '<1%' : `${Math.round((part / whole) * 100)}%`);

function viewInsights() {
  const s = C.summarize(state, C.txInMonth(state.tx, ui.month));
  const spent = [...s.byCategory]
    .map(([id, amount]) => ({ c: category(id), amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = spent.reduce((sum, x) => sum + x.amount, 0);
  const top = spent[0]?.amount || 1;
  const rows = C.trend(state, trendEnd(), TREND_MONTHS);
  const chosen = rows.find((r) => r.key === ui.month);

  return html`${monthNav()}
    <section class="card">
      <h2 class="section-title">Spending</h2>
      ${spent.length
        ? html`${donut(spent, total, s.converted)}
          ${spent.map(
            (x) => html`<button class="cat-bar ${colorClass(x.c.color)}" data-a="openCat" data-id="${x.c.id}">
              <div class="row-between">
                <span class="budget-name">${badge(x.c, 'badge-small')} ${x.c.name}</span>
                <span class="small">${money(x.amount)} · ${percent(x.amount, total)}</span>
              </div>
              <div class="bar"><i style="width:${((x.amount / top) * 100).toFixed(1)}%"></i></div>
            </button>`,
          )}`
        : html`<p class="small">No spending this month.</p>`}
      ${s.converted && html`<p class="small">Converted to ${state.currency} at your current exchange rates.</p>`}
      ${missingRateNote(s.missing)}
    </section>

    <section class="card">
      <h2 class="section-title">Income and expenses</h2>
      <div class="legend">
        <span><i style="background:var(--income)"></i>Income</span>
        <span><i style="background:var(--expense)"></i>Expenses</span>
      </div>
      ${trendChart(rows)}
      ${chosen && html`<p class="small">${monthLabel(chosen.key)}: income ${money(chosen.income)}, expenses ${money(chosen.expense)}</p>`}
      <details>
        <summary>Show as table</summary>
        <table class="table">
          <thead><tr><th>Month</th><th>Income</th><th>Expenses</th></tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr><td>${monthShort(r.key)}</td><td>${money(r.income)}</td><td>${money(r.expense)}</td></tr>`,
          )}</tbody>
        </table>
      </details>
    </section>`;
}

// ---------- Settings ----------

function ratesStatus() {
  if (!state.autoRates) return 'Set by you';
  return state.ratesUpdated ? `Updated ${shortMoment(state.ratesUpdated)}` : 'Not updated yet';
}

function viewSettings() {
  return html`<h1 class="section-title" style="font-size:28px">Settings</h1>
    <section class="card card-flush">
      <label class="set-row"><span>Total currency</span>
        <select class="input" data-change="currency" aria-label="Total currency">${currencyOptions(state.currency)}</select>
      </label>
      <button class="set-row" data-a="openRates"><span>Exchange rates</span><span class="value">${ratesStatus()} ›</span></button>
      <button class="set-row" data-a="openWallets"><span>Wallets</span><span class="value">${activeWallets().length} ›</span></button>
      <button class="set-row" data-a="openCategories"><span>Categories and limits</span><span class="chev">›</span></button>
      <button class="set-row" data-a="openRecurring"><span>Recurring</span>
        <span class="value">${state.recurring.length} ›</span></button>
      <button class="set-row" data-a="openCorrections"><span>Balance corrections</span>
        <span class="value">${state.tx.filter((t) => t.type === 'adjustment').length} ›</span></button>
    </section>

    <section class="card card-flush">
      <button class="set-row" data-a="exportCsv"><span>Export to CSV</span><span class="value">For spreadsheets</span></button>
      <button class="set-row" data-a="backup"><span>Back up everything</span>
        <span class="value">${state.lastBackup ? `Last: ${shortMoment(state.lastBackup)}` : 'Never'}</span></button>
      <label class="set-row" for="restore-json"><span>Restore from backup</span><span class="chev">›</span></label>
      <label class="set-row" for="import-csv"><span>Import from another app (CSV)</span><span class="chev">›</span></label>
    </section>
    <p class="small">${state.tx.length} ${state.tx.length === 1 ? 'entry' : 'entries'}, stored only on this device. The only thing the app downloads is exchange rates, and that sends none of your data. Deleting the app deletes this data, so keep a backup in Files or iCloud Drive.</p>`;
}

// ---------- Sheets ----------

const sheetHead = (title, leftAction, leftLabel, saveAction, saveLabel = 'Save') =>
  html`<header class="sheet-head">
    <button data-a="${leftAction}">${leftLabel}</button>
    <h2>${title}</h2>
    ${saveAction ? html`<button class="save" data-a="${saveAction}">${saveLabel}</button>` : html`<span></span>`}
  </header>`;

const seg = (action, value, options) =>
  html`<div class="seg">${options.map(
    ([v, label]) => html`<button type="button" data-a="${action}" data-v="${v}" aria-pressed="${v === value}">${label}</button>`,
  )}</div>`;

const TYPE_OPTIONS = [['expense', 'Expense'], ['income', 'Income']];
const TX_TYPE_OPTIONS = [...TYPE_OPTIONS, ['transfer', 'Transfer']];

const walletSelect = (id, label, selectedId, change) =>
  html`<label class="field"><span>${label}</span>
    <select id="${id}" class="input" data-change="${change}">${walletChoices(selectedId).map(
      (w) => html`<option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>${w.name} (${w.currency})</option>`,
    )}</select>
  </label>`;

function sheetTx(s) {
  const f = s.form;
  const from = wallet(f.walletId);
  const footer = html`<label class="field"><span>Date</span><input id="f-date" class="input" type="date" value="${f.date}"></label>
    <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" value="${f.note}"></label>
    ${s.id && html`<button class="btn btn-danger" data-a="deleteTx">Delete entry</button>`}`;
  const amount = html`<div>
    <input id="f-amount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Amount in ${from.currency}" value="${f.amount}">
    <p class="amount-currency">${from.currency}</p>
  </div>`;

  if (f.type === 'transfer') {
    const to = wallet(f.toWalletId);
    const rate = to && C.crossRate(state, from.currency, to.currency);
    return html`${sheetHead(s.id ? 'Edit transfer' : 'Move money', 'closeSheet', 'Cancel', 'saveTx')}
      <div class="sheet-body">
        ${seg('txType', f.type, TX_TYPE_OPTIONS)}
        ${amount}
        ${s.error && html`<p class="error">${s.error}</p>`}
        ${walletSelect('f-wallet', 'From', f.walletId, 'txForm')}
        ${to
          ? walletSelect('f-to', 'To', f.toWalletId, 'txForm')
          : html`<p class="small">You need a second wallet to move money.</p>
            <button class="btn" data-a="openWallets">Add a wallet</button>`}
        ${to && to.currency !== from.currency && html`<label class="field"><span>Amount received (${to.currency})</span>
            <input id="f-to-amount" class="input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${f.toAmount}"></label>
          <p class="small">${rate
            ? `Filled in using 1 ${from.currency} = ${formatRate(rate)} ${to.currency}. Change it to match what you actually received.`
            : 'No exchange rate saved, so enter what you received.'}</p>`}
        ${footer}
      </div>`;
  }

  const cats = categoriesByUse(f.type);
  const current = category(f.categoryId);
  // An archived category stays selectable when editing an old entry that uses it.
  const all = current && current.kind === f.type && current.archived ? [...cats, current] : cats;
  // The most used come first, so the usual tap is near the top and the rest are one tap away.
  const top = all.slice(0, CATEGORY_SHORTLIST);
  const choices = s.allCategories || all.length <= CATEGORY_SHORTLIST
    ? all
    : current && !top.includes(current) && current.kind === f.type ? [...top.slice(0, -1), current] : top;
  return html`${sheetHead(s.id ? 'Edit entry' : 'New entry', 'closeSheet', 'Cancel', 'saveTx')}
    <div class="sheet-body">
      ${seg('txType', f.type, TX_TYPE_OPTIONS)}
      ${amount}
      ${s.error && html`<p class="error">${s.error}</p>`}
      ${walletSelect('f-wallet', 'Wallet', f.walletId, 'txForm')}
      <div class="cat-grid">${choices.map(
        (c) => html`<button type="button" class="cat" data-a="txCat" data-id="${c.id}" aria-pressed="${c.id === f.categoryId}">
          ${badge(c)}${c.name}</button>`,
      )}</div>
      ${choices.length < all.length && html`<button type="button" class="btn" data-a="showAllCategories">All categories (${all.length})</button>`}
      ${footer}
    </div>`;
}

const stylePicker = (f) =>
  html`<div class="field"><span>Color</span>
      <div class="swatches">${C.COLOR_KEYS.map(
        (key) => html`<button type="button" class="swatch ${colorClass(key)}" data-a="pickColor" data-v="${key}" aria-label="${key}" aria-pressed="${key === f.color}"></button>`,
      )}</div>
    </div>
    <div class="field"><span>Icon</span>
      <div class="icon-grid ${colorClass(f.color)}">${ICON_KEYS.map(
        (key) => html`<button type="button" class="icon-choice" data-a="pickIcon" data-v="${key}" aria-label="${key}" aria-pressed="${key === f.icon}">${iconMarkup(key)}</button>`,
      )}</div>
    </div>`;

function sheetCategories(s) {
  const list = state.categories.filter((c) => c.kind === s.kind);
  const sorted = [...list.filter((c) => !c.archived), ...list.filter((c) => c.archived)];
  return html`${sheetHead('Categories', 'closeSheet', 'Done')}
    <div class="sheet-body">
      ${seg('catKind', s.kind, TYPE_OPTIONS)}
      <div class="card card-flush">${sorted.map(
        (c) => html`<button class="set-row" data-a="editCategory" data-id="${c.id}">
          <span class="budget-name">${badge(c, 'badge-small')} ${c.name}</span>
          <span class="value">${c.archived ? 'Hidden' : c.limit ? `${money(c.limit)} / month` : ''} ›</span>
        </button>`,
      )}</div>
      <button class="btn" data-a="newCategory">Add category</button>
    </div>`;
}

function sheetCategory(s) {
  const f = s.form;
  return html`${sheetHead(s.id ? 'Edit category' : 'New category', 'openCategories', 'Back', 'saveCategory')}
    <div class="sheet-body">
      ${s.error && html`<p class="error">${s.error}</p>`}
      <div class="name-row">
        ${badge(f, 'badge-large')}
        <label class="field"><span>Name</span><input id="f-name" class="input" maxlength="40" value="${f.name}"></label>
      </div>
      ${s.kind === 'expense' && html`<label class="field"><span>Monthly limit in ${state.currency} (optional)</span>
        <input id="f-limit" class="input" inputmode="decimal" autocomplete="off" placeholder="No limit" value="${f.limit}"></label>`}
      ${stylePicker(f)}
      ${s.id && html`<button class="btn" data-a="toggleArchive">${f.archived ? 'Show category again' : 'Hide category'}</button>
        <p class="small">Hiding removes it from the picker. Past entries keep it.</p>`}
    </div>`;
}

function sheetWallets() {
  const bal = C.balances(state);
  const sorted = [...activeWallets(), ...state.wallets.filter((w) => w.archived)];
  return html`${sheetHead('Wallets', 'closeSheet', 'Done')}
    <div class="sheet-body">
      <div class="card card-flush">${sorted.map(
        (w) => html`<button class="set-row" data-a="editWallet" data-id="${w.id}">
          <span class="budget-name">${badge(w, 'badge-small')} ${w.name}</span>
          <span class="value">${w.archived ? 'Hidden' : money(bal.get(w.id), w.currency)} ›</span>
        </button>`,
      )}</div>
      <button class="btn" data-a="newWallet">Add wallet</button>
    </div>`;
}

function sheetWallet(s) {
  const f = s.form;
  const used = s.id && walletInUse(s.id);
  return html`${sheetHead(s.id ? 'Edit wallet' : 'New wallet', 'openWallets', 'Back', 'saveWallet')}
    <div class="sheet-body">
      ${s.error && html`<p class="error">${s.error}</p>`}
      ${!s.id && html`<div class="presets">${C.WALLET_PRESETS.map(
        ([name, icon, color]) => html`<button type="button" class="preset" data-a="pickPreset" data-name="${name}" data-icon="${icon}" data-color="${color}">
          ${badge({ icon, color }, 'badge-small')}${name}</button>`,
      )}</div>`}
      <div class="name-row">
        ${badge(f, 'badge-large')}
        <label class="field"><span>Name</span><input id="f-name" class="input" maxlength="40" placeholder="Savings for car" value="${f.name}"></label>
      </div>
      <div class="two-col">
        <label class="field"><span>Currency</span>
          <select id="f-currency" class="input" ${used ? 'disabled' : ''}>${currencyOptions(f.currency)}</select>
        </label>
        <label class="field"><span>Starting balance</span>
          <input id="f-opening" class="input" inputmode="text" autocomplete="off" placeholder="0.00" value="${f.opening}">
        </label>
      </div>
      ${used && html`<p class="small">The currency can't change once a wallet has entries, because they'd no longer be correct.</p>`}
      ${stylePicker(f)}
      ${s.id && (used
        ? html`<button class="btn" data-a="toggleWalletHidden">${f.archived ? 'Show wallet again' : 'Hide wallet'}</button>
          <p class="small">A hidden wallet isn't counted in your total. Its history stays.</p>`
        : html`<button class="btn btn-danger" data-a="deleteWallet">Delete wallet</button>`)}
    </div>`;
}

function sheetRates() {
  const codes = [...new Set(activeWallets().map((w) => w.currency))].filter((c) => c !== state.currency).sort();
  return html`${sheetHead('Exchange rates', 'closeSheet', 'Done')}
    <div class="sheet-body">
      ${seg('rateMode', state.autoRates ? 'auto' : 'manual', [['auto', 'Automatic'], ['manual', 'Set by me']])}
      ${state.autoRates
        ? html`<p class="small">${state.ratesUpdated ? `Updated ${shortMoment(state.ratesUpdated)}. ` : ''}New rates download once a day when you're online. Offline, the last rates keep working.</p>
          <button class="btn" data-a="updateRates">Update now</button>`
        : html`<p class="small">Only the rates below are used. Nothing changes until you edit them.</p>`}
      ${codes.length
        ? html`<div class="card card-flush">${codes.map((code) => {
            const rate = state.rates[code];
            return html`<label class="set-row rate-row"><span>1 ${code} =</span>
              <input class="input" inputmode="decimal" autocomplete="off" placeholder="Enter rate" data-change="rate" data-code="${code}" aria-label="Value of 1 ${code} in ${state.currency}" value="${rate ? formatRate(rate) : ''}">
              <span>${state.currency}</span></label>`;
          })}</div>
          <p class="small">Editing a rate switches to Set by me, so your number stays as you typed it.</p>`
        : html`<p class="small">All your wallets use ${state.currency}, so no rates are needed yet.</p>`}
      <p class="small"><a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Rates By Exchange Rate API</a></p>
    </div>`;
}

// Text under a wallet's input while correcting: what would change.
function reconcileDifference(w, balance, text) {
  if (!text.trim()) return '';
  const actual = C.parseAmount(text);
  if (actual === null) return "That doesn't look like an amount.";
  return actual === balance ? 'Already correct' : `Difference: ${signedMoney(actual - balance, w.currency)}`;
}

function reconcileSummary(s) {
  const bal = C.balances(state);
  let count = 0;
  let total = 0;
  let converted = false;
  for (const [id, text] of Object.entries(s.values)) {
    const actual = text.trim() ? C.parseAmount(text) : null;
    if (actual === null || actual === bal.get(id)) continue;
    count++;
    const value = C.convert(state, actual - bal.get(id), wallet(id).currency);
    if (value !== null) total += value;
    if (wallet(id).currency !== state.currency) converted = true;
  }
  if (!count) return 'Nothing to correct yet.';
  return `${count} ${count === 1 ? 'wallet' : 'wallets'} will change. Your total moves by ${approx(converted)}${signedMoney(total)}.`;
}

function sheetReconcile(s) {
  const bal = C.balances(state);
  const wallets = s.walletId ? [wallet(s.walletId)] : activeWallets();
  return html`${sheetHead(s.walletId ? 'Correct balance' : 'Correct balances', 'closeSheet', 'Cancel', 'saveReconcile')}
    <div class="sheet-body">
      <p class="small">Type what's really in ${s.walletId ? 'this wallet' : 'each wallet'} now${s.walletId ? '' : ', and leave the rest empty'}. Your old entries don't change. The difference is saved as a correction you can see or undo later, and it doesn't count as income or spending.</p>
      ${s.error && html`<p class="error">${s.error}</p>`}
      <div class="card card-flush">${wallets.map(
        (w) => html`<label class="reconcile-row">
          ${badge(w)}
          <span class="reconcile-main">
            <span class="tx-title">${w.name}</span>
            <span class="tx-sub">In the app: ${money(bal.get(w.id), w.currency)}</span>
            <span class="reconcile-diff" data-diff="${w.id}">${reconcileDifference(w, bal.get(w.id), s.values[w.id] || '')}</span>
          </span>
          <span class="reconcile-input">
            <input class="input" inputmode="decimal" autocomplete="off" placeholder="Real ${w.currency}" aria-label="Real balance of ${w.name} in ${w.currency}" data-reconcile="${w.id}" value="${s.values[w.id] || ''}">
          </span>
        </label>`,
      )}</div>
      <p class="reconcile-summary" id="reconcile-summary">${reconcileSummary(s)}</p>
      <div class="two-col">
        <label class="field"><span>Date</span><input id="f-date" class="input" type="date" value="${s.date}"></label>
        <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" placeholder="Counted my cash" value="${s.note}"></label>
      </div>
    </div>`;
}

function sheetCorrections() {
  const list = C.sortTx(state.tx.filter((t) => t.type === 'adjustment'));
  return html`${sheetHead('Balance corrections', 'closeSheet', 'Done')}
    <div class="sheet-body">
      <p class="small">Every time a wallet's balance was corrected. Tap one to change its note or undo it.</p>
      ${list.length
        ? html`<div class="card card-flush">${list.map((t) => {
            const w = wallet(t.walletId);
            return html`<button class="tx tx-wrap" data-a="editCorrection" data-id="${t.id}" data-history="1">
              ${badge(w)}
              <span class="tx-main">
                <div class="tx-title">${w.name}</div>
                <div class="tx-sub">${shortDate(t.date)}${t.note ? ` · ${t.note}` : ''}</div>
                <div class="tx-sub">${money(t.before, w.currency)} → ${money(C.balanceAfter(t), w.currency)}</div>
              </span>
              <span class="tx-amount ${t.increase ? 'income' : ''}">${signedMoney(t.increase ? t.amount : -t.amount, w.currency)}</span>
            </button>`;
          })}</div>`
        : html`<p class="empty">No corrections yet.</p>`}
      <button class="btn" data-a="openReconcile">Correct balances</button>
    </div>`;
}

function sheetCorrection(s) {
  const t = state.tx.find((x) => x.id === s.id);
  const w = wallet(t.walletId);
  return html`${sheetHead('Balance correction', s.fromHistory ? 'openCorrections' : 'closeSheet', s.fromHistory ? 'Back' : 'Cancel', 'saveCorrection')}
    <div class="sheet-body">
      <div class="card">
        <span class="budget-name">${badge(w, 'badge-small')} ${w.name}</span>
        ${heroAmount(signedMoney(t.increase ? t.amount : -t.amount, w.currency))}
        <p class="small">The app showed ${money(t.before, w.currency)}, corrected to ${money(C.balanceAfter(t), w.currency)}.</p>
      </div>
      ${s.error && html`<p class="error">${s.error}</p>`}
      <label class="field"><span>Date</span><input id="f-date" class="input" type="date" value="${s.date}"></label>
      <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" value="${s.note}"></label>
      <button class="btn btn-danger" data-a="deleteCorrection">Undo this correction</button>
      <p class="small">Undoing removes it from the history and changes the balance of ${w.name} back by this amount.</p>
    </div>`;
}

const FREQ_LABEL = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  fourWeeks: 'Every 4 weeks',
  monthly: 'Monthly',
  quarterly: 'Every 3 months',
  semiannual: 'Every 6 months',
  yearly: 'Yearly',
};

function sheetRecurring() {
  return html`${sheetHead('Recurring', 'closeSheet', 'Done')}
    <div class="sheet-body">
      ${state.recurring.length
        ? html`<div class="card card-flush">${state.recurring.map((r) => {
            const c = category(r.categoryId);
            const w = wallet(r.walletId);
            return html`<button class="tx" data-a="editRule" data-id="${r.id}">
              ${badge(c)}
              <span class="tx-main">
                <div class="tx-title">${r.note || c.name}</div>
                <div class="tx-sub">Next ${dayMonth(C.nextOccurrence(r))} · ${FREQ_LABEL[r.freq]} · ${w.name}</div>
              </span>
              <span class="tx-amount ${r.type}">${r.type === 'income' ? '+' : '−'}${money(r.amount, w.currency)}</span>
            </button>`;
          })}</div>`
        : html`<p class="small">Rent, subscriptions and salary can be added automatically each time they come due.</p>`}
      <button class="btn" data-a="newRule">Add recurring item</button>
    </div>`;
}

function sheetRule(s) {
  const f = s.form;
  return html`${sheetHead(s.id ? 'Edit recurring' : 'New recurring', 'openRecurring', 'Back', 'saveRule')}
    <div class="sheet-body">
      ${seg('ruleType', f.type, TYPE_OPTIONS)}
      ${s.error && html`<p class="error">${s.error}</p>`}
      ${walletSelect('f-wallet', 'Wallet', f.walletId, 'ruleForm')}
      <label class="field"><span>Amount (${wallet(f.walletId).currency})</span><input id="f-amount" class="input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${f.amount}"></label>
      <label class="field"><span>Category</span>
        <select id="f-cat" class="input">${activeCategories(f.type).map(
          (c) => html`<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${c.name}</option>`,
        )}</select>
      </label>
      <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" placeholder="Rent" value="${f.note}"></label>
      <div class="two-col">
        <label class="field"><span>Repeats</span>
          <select id="f-freq" class="input">${Object.entries(FREQ_LABEL).map(
            ([v, label]) => html`<option value="${v}" ${v === f.freq ? 'selected' : ''}>${label}</option>`,
          )}</select>
        </label>
        <label class="field"><span>First date</span><input id="f-date" class="input" type="date" value="${f.start}"></label>
      </div>
      <p class="small">A first date in the past adds all the entries since then.</p>
      ${s.id && html`<button class="btn btn-danger" data-a="deleteRule">Stop repeating</button>
        <p class="small">Entries already added stay in your history.</p>`}
    </div>`;
}

const DATE_FORMATS = { ymd: 'Year-Month-Day', dmy: 'Day-Month-Year', mdy: 'Month-Day-Year' };

function sheetImport(s) {
  const fields = [
    ['date', 'Date'],
    ['amount', 'Amount'],
    ['category', 'Category'],
    ['type', 'Income or expense'],
    ['wallet', 'Wallet'],
    ['currency', 'Currency'],
    ['note', 'Note'],
  ];
  const result = C.buildImport(s.rows, s.map, s.fmt, state.categories, state.wallets, s.walletId);
  const fits = C.detectDateFormats(s.map.date >= 0 ? s.rows.map((r) => r[s.map.date]) : []);
  const ready = s.map.date >= 0 && s.map.amount >= 0 && (result.tx.length > 0 || result.openings.size > 0);
  const allWallets = [...state.wallets, ...result.newWallets];
  const visibleNewWallets = result.newWallets.filter((w) => !w.archived);
  const allCategories = [...state.categories, ...result.newCategories];
  const transferNotes = [
    result.transfersMatched > 0 && `${result.transfersMatched} matched between wallets`,
    result.transfersToClosed > 0 && `${result.transfersToClosed} with an account that no longer exists, kept in a hidden wallet so balances stay right`,
  ].filter(Boolean);
  const skips = [
    result.skipped && `${result.skipped} with no valid date or amount`,
    result.mismatched && `${result.mismatched} in a different currency from their wallet`,
    result.transfers && `${result.transfers} ${result.transfers === 1 ? 'transfer' : 'transfers'}`,
    result.corrections && `${result.corrections} balance ${result.corrections === 1 ? 'correction' : 'corrections'}`,
  ].filter(Boolean);
  return html`${sheetHead('Import CSV', 'closeSheet', 'Cancel', ready && 'confirmImport', 'Import')}
    <div class="sheet-body">
      <p class="small">Match your file's columns. ${s.rows.length} rows found.</p>
      <div class="card">
        ${walletSelect('f-import-wallet', 'Rows with no wallet go into', s.walletId, 'importWallet')}
        ${fields.map(
          ([field, label]) => html`<label class="field"><span>${label}${field === 'date' || field === 'amount' ? '' : ' (optional)'}</span>
            <select class="input" data-change="importMap" data-field="${field}">
              <option value="-1">Not in this file</option>
              ${s.headers.map(
                (h, i) => html`<option value="${i}" ${i === s.map[field] ? 'selected' : ''}>${h || `Column ${i + 1}`}</option>`,
              )}
            </select></label>`,
        )}
        <label class="field"><span>Date format</span>
          <select class="input" data-change="importFmt">${Object.entries(DATE_FORMATS).map(
            ([v, label]) => html`<option value="${v}" ${v === s.fmt ? 'selected' : ''}>${label}</option>`,
          )}</select></label>
        ${fits.length > 1 && html`<p class="small">These dates fit more than one format. Check the preview below.</p>`}
      </div>
      <div class="card">
        <strong>${result.tx.length} entries ready</strong>
        ${skips.length > 0 && html`<p class="small">Skipped: ${skips.join(', ')}.</p>`}
        ${transferNotes.length > 0 && html`<p class="small">Transfers: ${transferNotes.join(', ')}.</p>`}
        ${result.openings.size > 0 && html`<p class="small">Starting balances set for ${result.openings.size} ${result.openings.size === 1 ? 'wallet' : 'wallets'}.</p>`}
        ${visibleNewWallets.length > 0 && html`<p class="small">New wallets: ${visibleNewWallets.map((w) => `${w.name} (${w.currency})`).join(', ')}</p>`}
        ${result.newCategories.length > 0 && html`<p class="small">New categories: ${result.newCategories.map((c) => c.name).join(', ')}</p>`}
        <div class="preview">${result.tx.filter((t) => t.type !== 'transfer').slice(0, 4).map((t) => {
          const name = allCategories.find((c) => c.id === t.categoryId).name;
          const w = allWallets.find((x) => x.id === t.walletId);
          return html`<div><span>${shortDate(t.date)} · ${name}${t.note ? ` · ${t.note}` : ''}</span>
            <span>${t.type === 'income' ? '+' : '−'}${money(t.amount, w.currency)}</span></div>`;
        })}</div>
      </div>
    </div>`;
}

const SHEETS = {
  tx: sheetTx,
  categories: sheetCategories,
  category: sheetCategory,
  wallets: sheetWallets,
  wallet: sheetWallet,
  rates: sheetRates,
  reconcile: sheetReconcile,
  corrections: sheetCorrections,
  correction: sheetCorrection,
  recurring: sheetRecurring,
  rule: sheetRule,
  import: sheetImport,
};

// ---------- Rendering ----------

const VIEWS = { home: viewHome, activity: viewActivity, insights: viewInsights, settings: viewSettings };

function renderTabs() {
  const tab = (id, label) =>
    html`<button class="tab" data-a="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${svg(ICONS[id])}${label}</button>`;
  $('tabs').innerHTML = part(html`${tab('home', 'Home')}${tab('activity', 'Activity')}
    <button class="tab tab-add" data-a="newTx" aria-label="Add entry"><span>${svg(ICONS.plus)}</span></button>
    ${tab('insights', 'Insights')}${tab('settings', 'Settings')}`);
}

function render() {
  $('view').innerHTML = part(VIEWS[ui.tab]());
  renderTabs();
  const el = $('sheet');
  const wasOpen = !el.hidden;
  el.hidden = !ui.sheet;
  document.body.classList.toggle('sheet-open', Boolean(ui.sheet));
  if (ui.sheet) {
    el.innerHTML = part(SHEETS[ui.sheet.type](ui.sheet));
    el.classList.toggle('enter', !wasOpen);
  } else {
    el.innerHTML = '';
  }
}

function openSheet(sheet) {
  ui.sheet = sheet;
  render();
  $('sheet').scrollTop = 0;
}

function toast(message, undoSnapshot) {
  const el = $('toast');
  el.innerHTML = part(html`<span>${message}</span>${undoSnapshot && html`<button data-a="undo">Undo</button>`}`);
  el.hidden = false;
  toast.snapshot = undoSnapshot;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
    toast.snapshot = null;
  }, undoSnapshot ? 8000 : 4000);
}

const snapshot = () => JSON.stringify(state);

// ---------- Exchange rates ----------

async function refreshRates({ force = false } = {}) {
  if (!force) {
    const age = state.ratesUpdated ? Date.now() - Date.parse(state.ratesUpdated) : Infinity;
    if (!state.autoRates || age < RATES_MAX_AGE_MS) return false;
  }
  try {
    const response = await fetch(RATES_URL);
    const data = await response.json();
    if (data.result !== 'success' || !C.applyLiveRates(state, data.rates, new Date().toISOString())) return false;
  } catch {
    return false; // Offline: the last saved rates keep working.
  }
  save();
  // Redrawing an open form would throw away what is being typed.
  if (!ui.sheet) render();
  return true;
}

function setDisplayCurrency(next) {
  if (next === state.currency) return;
  const rate = state.rates[next] ?? C.parseRate(prompt(`No rate saved yet. 1 ${next} is worth how many ${state.currency}?`));
  if (rate) {
    C.changeDisplayCurrency(state, next, rate);
    save();
  } else {
    toast(`${next} needs an exchange rate first.`);
  }
  render();
}

// ---------- Files ----------

async function deliverFile(name, type, text) {
  const file = new File([text], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      // Anything else falls through to a plain download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

function startImport(text) {
  const [headers, ...rows] = C.parseCSV(text);
  if (!headers || !rows.length) {
    toast('That file has no rows to import.');
    return;
  }
  const map = C.guessMapping(headers);
  const fits = map.date >= 0 ? C.detectDateFormats(rows.map((r) => r[map.date])) : [];
  openSheet({ type: 'import', headers, rows, map, fmt: fits[0] || 'ymd', walletId: defaultWalletId() });
}

function startRestore(text) {
  let next;
  try {
    next = C.validateBackup(JSON.parse(text));
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not a backup.' : err.message);
    return;
  }
  const message = `Replace everything on this phone with this backup (${next.tx.length} entries)? You now have ${state.tx.length} entries.`;
  if (!confirm(message)) return;
  const before = snapshot();
  state = next;
  runRecurring();
  save();
  ui.filterCat = '';
  ui.filterWallet = '';
  render();
  toast(`Restored ${next.tx.length} entries.`, before);
  refreshRates();
}

// ---------- Actions ----------

function readTxForm() {
  const f = ui.sheet.form;
  f.amount = $('f-amount').value;
  f.walletId = $('f-wallet').value;
  f.date = $('f-date').value;
  f.note = $('f-note').value;
  if ($('f-to')) f.toWalletId = $('f-to').value;
  if ($('f-to-amount')) f.toAmount = $('f-to-amount').value;
}

// Fills in "amount received" from the rate, until the user types their own number.
function fillReceived(f) {
  if (f.toEdited) return;
  const to = wallet(f.toWalletId);
  const rate = to && C.crossRate(state, wallet(f.walletId).currency, to.currency);
  const cents = Math.abs(C.parseAmount(f.amount) ?? 0);
  f.toAmount = rate && cents ? C.centsToInput(Math.round(cents * rate)) : '';
}

function readRuleForm() {
  const f = ui.sheet.form;
  f.walletId = $('f-wallet').value;
  f.amount = $('f-amount').value;
  f.categoryId = $('f-cat').value;
  f.note = $('f-note').value;
  f.freq = $('f-freq').value;
  f.start = $('f-date').value;
}

// Keeps what has been typed when a tap redraws the category or wallet form.
function readStyleForm() {
  const f = ui.sheet.form;
  f.name = $('f-name').value;
  if ($('f-limit')) f.limit = $('f-limit').value;
  if ($('f-currency')) f.currency = $('f-currency').value;
  if ($('f-opening')) f.opening = $('f-opening').value;
}

const openCategoryList = (kind = 'expense') => openSheet({ type: 'categories', kind });

function openTxForm(type) {
  const walletId = defaultWalletId();
  openSheet({
    type: 'tx',
    form: { type, amount: '', walletId, toWalletId: otherWallet(walletId), toAmount: '', toEdited: false, categoryId: null, date: today(), note: '' },
  });
  $('f-amount').focus();
}

const actions = {
  tab({ tab }) {
    ui.tab = tab;
    ui.sheet = null;
    render();
    scrollTo(0, 0);
  },
  monthPrev() {
    ui.month = C.addMonths(ui.month, -1);
    ui.donutCat = null;
    render();
  },
  monthNext() {
    ui.month = C.addMonths(ui.month, 1);
    ui.donutCat = null;
    render();
  },
  pickMonth({ key }) {
    ui.month = key;
    ui.donutCat = null;
    render();
  },
  pickSlice({ id }) {
    ui.donutCat = ui.donutCat === id ? null : id;
    render();
  },
  openCat({ id }) {
    ui.filterCat = id;
    ui.filterWallet = '';
    ui.search = '';
    actions.tab({ tab: 'activity' });
  },
  toggleEmptyWallets() {
    ui.showEmptyWallets = !ui.showEmptyWallets;
    render();
  },
  openWallet({ id }) {
    ui.filterWallet = id;
    ui.filterCat = '';
    ui.search = '';
    actions.tab({ tab: 'activity' });
  },
  closeSheet() {
    ui.sheet = null;
    render();
  },

  // Entries
  newTx() {
    openTxForm('expense');
  },
  newTransfer() {
    openTxForm('transfer');
  },
  editTx({ id }) {
    const t = state.tx.find((x) => x.id === id);
    openSheet({
      type: 'tx',
      id,
      form: {
        type: t.type,
        amount: C.centsToInput(t.amount),
        walletId: t.walletId,
        toWalletId: t.toWalletId ?? otherWallet(t.walletId),
        toAmount: t.toAmount ? C.centsToInput(t.toAmount) : '',
        toEdited: Boolean(t.toAmount),
        categoryId: t.categoryId ?? null,
        date: t.date,
        note: t.note || '',
      },
    });
  },
  txType({ v }) {
    readTxForm();
    const f = ui.sheet.form;
    if (f.type !== v) f.categoryId = null;
    f.type = v;
    if (v === 'transfer') fillReceived(f);
    render();
  },
  showAllCategories() {
    readTxForm();
    ui.sheet.allCategories = true;
    render();
  },
  txCat({ id }, el) {
    ui.sheet.form.categoryId = id;
    el.parentElement.querySelectorAll('.cat').forEach((c) => c.setAttribute('aria-pressed', String(c === el)));
  },
  saveTx() {
    readTxForm();
    const s = ui.sheet;
    const f = s.form;
    const amount = Math.abs(C.parseAmount(f.amount) ?? 0);
    const isTransfer = f.type === 'transfer';
    const to = isTransfer ? wallet(f.toWalletId) : null;
    const sameCurrency = to?.currency === wallet(f.walletId).currency;
    const toAmount = sameCurrency ? amount : Math.abs(C.parseAmount(f.toAmount) ?? 0);

    if (!amount) s.error = 'Enter an amount.';
    else if (isTransfer && !to) s.error = 'Add a second wallet first.';
    else if (isTransfer && f.toWalletId === f.walletId) s.error = 'Pick two different wallets.';
    else if (isTransfer && !toAmount) s.error = 'Enter the amount received.';
    else if (!isTransfer && !f.categoryId) s.error = 'Pick a category.';
    else if (!f.date) s.error = 'Pick a date.';
    else s.error = null;
    if (s.error) {
      render();
      return;
    }

    const existing = s.id ? state.tx.find((t) => t.id === s.id) : null;
    const entry = {
      id: s.id ?? C.uid(),
      date: f.date,
      type: f.type,
      amount,
      walletId: f.walletId,
      note: f.note.trim(),
      ...(isTransfer
        ? { toWalletId: f.toWalletId, toAmount }
        : { categoryId: f.categoryId, ...(existing?.recurringId && { recurringId: existing.recurringId }) }),
    };
    if (existing) state.tx[state.tx.indexOf(existing)] = entry;
    else state.tx.push(entry);
    state.lastWalletId = f.walletId;
    save();
    ui.month = C.monthOf(f.date);
    ui.sheet = null;
    render();
    const shown = money(amount, wallet(f.walletId).currency);
    if (s.id) toast('Entry updated.');
    else toast(isTransfer ? `Moved ${shown} to ${to.name}.` : `Added ${shown}.`);
  },
  deleteTx() {
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.id !== ui.sheet.id);
    save();
    ui.sheet = null;
    render();
    toast('Entry deleted.', before);
  },

  pickPreset({ name, icon, color }) {
    readStyleForm();
    Object.assign(ui.sheet.form, { name, icon, color });
    render();
  },

  // Colors and icons, shared by categories and wallets
  pickColor({ v }) {
    readStyleForm();
    ui.sheet.form.color = v;
    render();
  },
  pickIcon({ v }) {
    readStyleForm();
    ui.sheet.form.icon = v;
    render();
  },

  // Categories
  openCategories() {
    openCategoryList(ui.sheet?.kind);
  },
  catKind({ v }) {
    openCategoryList(v);
  },
  newCategory() {
    openSheet({
      type: 'category',
      kind: ui.sheet.kind,
      form: { icon: 'tag', color: C.nextColor(state.categories), name: '', limit: '', archived: false },
    });
  },
  editCategory({ id }) {
    const c = category(id);
    openSheet({
      type: 'category',
      id,
      kind: c.kind,
      form: { icon: c.icon, color: c.color, name: c.name, limit: c.limit ? C.centsToInput(c.limit) : '', archived: c.archived },
    });
  },
  saveCategory() {
    readStyleForm();
    const s = ui.sheet;
    const f = s.form;
    const name = f.name.trim();
    const limitText = s.kind === 'expense' ? f.limit.trim() : '';
    const limit = limitText ? Math.abs(C.parseAmount(limitText) ?? 0) : null;
    if (!name) s.error = 'Enter a name.';
    else if (limitText && !limit) s.error = 'Enter a valid limit, or leave it empty.';
    else if (state.categories.some((c) => c.kind === s.kind && c.id !== s.id && c.name.toLowerCase() === name.toLowerCase())) {
      s.error = 'A category with this name already exists.';
    } else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = { name, icon: f.icon, color: f.color, limit, archived: f.archived };
    if (s.id) Object.assign(category(s.id), data);
    else state.categories.push({ id: C.uid(), kind: s.kind, ...data });
    save();
    openCategoryList(s.kind);
  },
  toggleArchive() {
    const s = ui.sheet;
    const c = category(s.id);
    c.archived = !c.archived;
    save();
    openCategoryList(s.kind);
  },

  // Wallets
  openWallets() {
    openSheet({ type: 'wallets' });
  },
  newWallet() {
    openSheet({
      type: 'wallet',
      form: { icon: 'wallet', color: C.nextColor(state.wallets), name: '', currency: state.currency, opening: '', archived: false },
    });
  },
  editWallet({ id }) {
    const w = wallet(id);
    openSheet({
      type: 'wallet',
      id,
      form: { icon: w.icon, color: w.color, name: w.name, currency: w.currency, opening: w.opening ? C.centsToInput(w.opening) : '', archived: w.archived },
    });
  },
  saveWallet() {
    readStyleForm();
    const s = ui.sheet;
    const f = s.form;
    const name = f.name.trim();
    const openingText = f.opening.trim();
    const opening = openingText ? C.parseAmount(openingText) : 0;
    if (!name) s.error = 'Enter a name.';
    else if (opening === null) s.error = 'Enter a valid balance, or leave it empty.';
    else if (state.wallets.some((w) => w.id !== s.id && w.name.toLowerCase() === name.toLowerCase())) {
      s.error = 'A wallet with this name already exists.';
    } else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = { name, icon: f.icon, color: f.color, currency: f.currency, opening, archived: f.archived };
    if (s.id) Object.assign(wallet(s.id), data);
    else state.wallets.push({ id: C.uid(), ...data });
    save();
    openSheet({ type: 'wallets' });
  },
  toggleWalletHidden() {
    const s = ui.sheet;
    const w = wallet(s.id);
    if (!w.archived && activeWallets().length === 1) s.error = 'You need at least one visible wallet.';
    else if (!w.archived && state.recurring.some((r) => r.walletId === w.id)) s.error = 'Stop its recurring items first.';
    else s.error = null;
    if (s.error) {
      readStyleForm();
      render();
      return;
    }
    w.archived = !w.archived;
    if (ui.filterWallet === w.id) ui.filterWallet = '';
    save();
    openSheet({ type: 'wallets' });
  },
  deleteWallet() {
    const s = ui.sheet;
    if (activeWallets().length === 1) {
      readStyleForm();
      s.error = 'You need at least one wallet.';
      render();
      return;
    }
    const before = snapshot();
    state.wallets = state.wallets.filter((w) => w.id !== s.id);
    if (ui.filterWallet === s.id) ui.filterWallet = '';
    save();
    openSheet({ type: 'wallets' });
    toast('Wallet deleted.', before);
  },

  // Balance corrections
  openReconcile({ wallet: walletId }) {
    openSheet({ type: 'reconcile', walletId, values: {}, date: today(), note: '' });
    if (walletId) document.querySelector('[data-reconcile]').focus();
  },
  saveReconcile() {
    const s = ui.sheet;
    s.date = $('f-date').value;
    s.note = $('f-note').value;
    const actuals = {};
    s.error = null;
    for (const [id, text] of Object.entries(s.values)) {
      if (!text.trim()) continue;
      const actual = C.parseAmount(text);
      if (actual === null) s.error = `Check the amount for ${wallet(id).name}.`;
      else actuals[id] = actual;
    }
    if (!s.error && !s.date) s.error = 'Pick a date.';
    const before = snapshot();
    const added = s.error ? [] : C.correctBalances(state, actuals, s.date, s.note.trim());
    if (!s.error && !added.length) s.error = 'Type a real balance that differs from the app.';
    if (s.error) {
      render();
      return;
    }
    save();
    ui.sheet = null;
    render();
    toast(`Corrected ${added.length} ${added.length === 1 ? 'wallet' : 'wallets'}.`, before);
  },
  openCorrections() {
    openSheet({ type: 'corrections' });
  },
  editCorrection({ id, history }) {
    const t = state.tx.find((x) => x.id === id);
    openSheet({ type: 'correction', id, fromHistory: Boolean(history), date: t.date, note: t.note || '' });
  },
  saveCorrection() {
    const s = ui.sheet;
    const date = $('f-date').value;
    if (!date) {
      s.note = $('f-note').value;
      s.error = 'Pick a date.';
      render();
      return;
    }
    Object.assign(state.tx.find((t) => t.id === s.id), { date, note: $('f-note').value.trim() });
    save();
    if (s.fromHistory) openSheet({ type: 'corrections' });
    else actions.closeSheet();
  },
  deleteCorrection() {
    const s = ui.sheet;
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.id !== s.id);
    save();
    if (s.fromHistory) openSheet({ type: 'corrections' });
    else actions.closeSheet();
    toast('Correction undone.', before);
  },

  // Exchange rates
  openRates() {
    openSheet({ type: 'rates' });
  },
  async rateMode({ v }) {
    state.autoRates = v === 'auto';
    save();
    render();
    if (state.autoRates) await actions.updateRates();
  },
  async updateRates() {
    const updated = await refreshRates({ force: true });
    render();
    toast(updated ? 'Exchange rates updated.' : "Couldn't get new rates. Check your connection.");
  },

  // Recurring
  openRecurring() {
    openSheet({ type: 'recurring' });
  },
  newRule() {
    openSheet({
      type: 'rule',
      form: {
        type: 'expense',
        walletId: defaultWalletId(),
        amount: '',
        categoryId: activeCategories('expense')[0]?.id,
        note: '',
        freq: 'monthly',
        start: today(),
      },
    });
  },
  editRule({ id }) {
    const r = state.recurring.find((x) => x.id === id);
    openSheet({
      type: 'rule',
      id,
      form: { type: r.type, walletId: r.walletId, amount: C.centsToInput(r.amount), categoryId: r.categoryId, note: r.note, freq: r.freq, start: r.start },
    });
  },
  ruleType({ v }) {
    readRuleForm();
    const f = ui.sheet.form;
    if (f.type !== v) f.categoryId = activeCategories(v)[0]?.id;
    f.type = v;
    render();
  },
  saveRule() {
    readRuleForm();
    const s = ui.sheet;
    const f = s.form;
    const amount = Math.abs(C.parseAmount(f.amount) ?? 0);
    if (!amount) s.error = 'Enter an amount.';
    else if (!f.categoryId) s.error = 'Pick a category.';
    else if (!f.start) s.error = 'Pick a first date.';
    else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = { type: f.type, walletId: f.walletId, amount, categoryId: f.categoryId, note: f.note.trim(), freq: f.freq, start: f.start };
    if (s.id) Object.assign(state.recurring.find((r) => r.id === s.id), data);
    else state.recurring.push({ id: C.uid(), lastRun: null, ...data });
    const added = runRecurring();
    save();
    openSheet({ type: 'recurring' });
    if (added) toast(`Added ${added} ${added === 1 ? 'entry' : 'entries'} that came due.`);
  },
  deleteRule() {
    const before = snapshot();
    state.recurring = state.recurring.filter((r) => r.id !== ui.sheet.id);
    save();
    openSheet({ type: 'recurring' });
    toast('Stopped repeating.', before);
  },

  // Data
  async exportCsv() {
    await deliverFile(`budget-${today()}.csv`, 'text/csv', C.toCSV(state));
  },
  async backup() {
    const delivered = await deliverFile(`budget-backup-${today()}.json`, 'application/json', JSON.stringify(state, null, 1));
    if (!delivered) return;
    state.lastBackup = new Date().toISOString();
    save();
    render();
    toast('Backup created.');
  },
  confirmImport() {
    const s = ui.sheet;
    const before = snapshot();
    const { tx, newCategories, newWallets, openings } = C.buildImport(s.rows, s.map, s.fmt, state.categories, state.wallets, s.walletId);
    state.categories.push(...newCategories);
    state.wallets.push(...newWallets);
    state.tx.push(...tx);
    for (const [id, cents] of openings) wallet(id).opening += cents;
    // Entries most likely belong in the busiest imported wallet from now on.
    if (newWallets[0] && !newWallets[0].archived) state.lastWalletId = newWallets[0].id;
    save();
    ui.sheet = null;
    ui.tab = 'home';
    if (tx.length) ui.month = C.monthOf(C.sortTx(tx)[0].date);
    render();
    scrollTo(0, 0);
    toast(`Imported ${tx.length} entries.`, before);
  },
  undo() {
    state = JSON.parse(toast.snapshot);
    save();
    $('toast').hidden = true;
    render();
    toast('Undone.');
  },
};

const changes = {
  filterCat(el) {
    ui.filterCat = el.value;
    render();
  },
  filterWallet(el) {
    ui.filterWallet = el.value;
    render();
  },
  currency(el) {
    setDisplayCurrency(el.value);
  },
  rate(el) {
    const rate = C.parseRate(el.value);
    if (rate) {
      state.rates[el.dataset.code] = rate;
      state.autoRates = false;
      save();
    } else {
      toast('Enter a number above zero.');
    }
    render();
  },
  txForm() {
    readTxForm();
    const f = ui.sheet.form;
    if (f.toWalletId === f.walletId) f.toWalletId = otherWallet(f.walletId);
    f.toEdited = false;
    fillReceived(f);
    render();
  },
  ruleForm() {
    readRuleForm();
    render();
  },
  importWallet(el) {
    ui.sheet.walletId = el.value;
    render();
  },
  importMap(el) {
    const s = ui.sheet;
    s.map[el.dataset.field] = Number(el.value);
    if (el.dataset.field === 'date' && s.map.date >= 0) {
      s.fmt = C.detectDateFormats(s.rows.map((r) => r[s.map.date]))[0] || s.fmt;
    }
    render();
  },
  importFmt(el) {
    ui.sheet.fmt = el.value;
    render();
  },
};

// ---------- Wiring ----------

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (el && !el.disabled) actions[el.dataset.a](el.dataset, el);
});

document.addEventListener('change', (e) => {
  const name = e.target.dataset?.change;
  if (name) changes[name](e.target);
});

document.addEventListener('input', (e) => {
  const reconcileId = e.target.dataset?.reconcile;
  if (reconcileId) {
    ui.sheet.values[reconcileId] = e.target.value;
    document.querySelector(`[data-diff="${reconcileId}"]`).textContent =
      reconcileDifference(wallet(reconcileId), C.balances(state).get(reconcileId), e.target.value);
    $('reconcile-summary').textContent = reconcileSummary(ui.sheet);
    return;
  }
  const form = ui.sheet?.form;
  if (form && e.target.id === 'f-to-amount') form.toEdited = true;
  if (form && e.target.id === 'f-amount' && $('f-to-amount')) {
    form.amount = e.target.value;
    fillReceived(form);
    if (!form.toEdited) $('f-to-amount').value = form.toAmount;
  }
  if (e.target.id !== 'search') return;
  const hadQuery = Boolean(ui.search.trim());
  ui.search = e.target.value;
  if (hadQuery !== Boolean(ui.search.trim())) {
    // The month navigator appears or disappears, so redraw and keep the keyboard up.
    render();
    const box = $('search');
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  } else {
    $('activity-results').innerHTML = part(activityResults());
  }
});

async function readPicked(input, handler) {
  const file = input.files[0];
  input.value = '';
  if (file) handler(await file.text());
}
$('import-csv').addEventListener('change', (e) => readPicked(e.target, startImport));
$('restore-json').addEventListener('change', (e) => readPicked(e.target, startRestore));

// The app may stay open in the background for days, so check for due items whenever it returns.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!ui.sheet && runRecurring()) render();
  refreshRates();
});

const added = runRecurring();
render();
if (added) toast(`Added ${added} recurring ${added === 1 ? 'entry' : 'entries'}.`);
refreshRates();

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
