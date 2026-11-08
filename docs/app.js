import * as C from './core.js';
import { CATEGORY_ICONS } from './category-icons.js';
import { NBU_HISTORY } from './nbu-history.js';

C.setRateHistory(NBU_HISTORY);

const KEY = 'budget.v1';
const COMMON_CURRENCIES = ['USD', 'EUR', 'UAH', 'IDR', 'GBP', 'PLN', 'CZK', 'CHF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY'];
const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const RATES_MAX_AGE_MS = 24 * 3600 * 1000; // The service only publishes new rates once a day.
const RATES_TIMEOUT_MS = 5000;
const BACKUP_REMINDER_DAYS = 30;
const SEARCH_LIMIT = 200;
const TREND_MONTHS = 6;
const CATEGORY_SHORTLIST = 12;
const MAX_FUTURE_MONTHS = 12;
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

const BEFORE_TAX_KEY = `${KEY}.before-tax`;

// A full copy from before tax moved out of spending. A full phone must not stop the app from opening.
function keepBeforeTaxCopy(raw) {
  try {
    localStorage.setItem(BEFORE_TAX_KEY, raw);
  } catch {
    // The upgrade itself changes no balances, and the banner still offers a backup.
  }
}

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return C.defaultState(today());
  try {
    const saved = JSON.parse(raw);
    const loaded = C.validateBackup(saved);
    // Keep an untouched copy of the first format, then store the upgraded data.
    if (saved.version < 2) localStorage.setItem(`${KEY}.before-wallets`, raw);
    if (saved.version < 4) keepBeforeTaxCopy(raw);
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
// The categories for a form, plus the one already chosen even if that category is now hidden.
const categoryChoices = (kind, selectedId) => {
  const selected = category(selectedId);
  return selected?.archived && selected.kind === kind ? [...activeCategories(kind), selected] : activeCategories(kind);
};
const balancesNow = () => C.balances(state, today());
const wallet = (id) => state.wallets.find((w) => w.id === id);
const activeWallets =() => state.wallets.filter((w) => !w.archived);
const otherWallet = (id) => activeWallets().find((w) => w.id !== id)?.id ?? null;
const defaultWalletId = () => (wallet(state.lastWalletId)?.archived === false ? state.lastWalletId : activeWallets()[0].id);
const walletInUse = (id) =>
  state.tx.some((t) => t.walletId === id || t.toWalletId === id) ||
  state.recurring.some((r) => r.walletId === id) ||
  state.taxes.some((x) => x.walletId === id);
const taxType = (id) => state.taxTypes.find((x) => x.id === id);
const taxItem = (id) => state.taxes.find((x) => x.id === id);
const activeTaxTypes = () => state.taxTypes.filter((x) => !x.archived);
const fixedTaxTypes = () => activeTaxTypes().filter((x) => x.mode === 'fixed');
// The wallet a tax is normally paid from, as long as it's still around and visible.
const payerWallet = (tax) => (wallet(tax.walletId)?.archived === false ? tax.walletId : defaultWalletId());

// A wallet's currency, plus the one already chosen on a form even if that wallet is now hidden.
const walletChoices = (selectedId) => {
  const selected = wallet(selectedId);
  return selected?.archived ? [...activeWallets(), selected] : activeWallets();
};

// ---------- Theme ----------

// Kept apart from the budget data: it belongs to this device, so a restored backup doesn't change it.
const THEME_KEY = 'budget.theme';
const THEME_BAR_COLORS = { light: '#f9f9f7', dark: '#0d0d0d' };

function readTheme() {
  try {
    return localStorage.getItem(THEME_KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // The two tags in index.html each follow the phone's setting, so a chosen theme overrides both.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const own = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_BAR_COLORS[theme === 'auto' ? own : theme];
  });
}

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
// For tables that name their currency once, so the columns fit on a phone.
const plainAmount = (cents) =>
  `${cents < 0 ? '−' : ''}${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(cents) / 100)}`;
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
  const atLimit = ui.month >= C.addMonths(C.monthOf(today()), MAX_FUTURE_MONTHS);
  return html`<div class="month-nav">
    <button class="icon-btn" data-a="monthPrev" aria-label="Previous month">${svg(ICONS.left)}</button>
    <h1>${monthLabel(ui.month)}</h1>
    <button class="icon-btn" data-a="monthNext" aria-label="Next month" ${atLimit ? 'disabled' : ''}>${svg(ICONS.right)}</button>
  </div>`;
};

const signedPlain = (cents) => `${cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;
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

function plannedRow(t) {
  const c = t.type === 'tax' ? taxType(t.taxTypeId) : category(t.categoryId);
  const w = wallet(t.walletId);
  const details = [`Planned ${dayMonth(t.date)}`, t.type === 'tax' && 'Tax', t.note && c.name, state.wallets.length > 1 && w.name].filter(Boolean);
  return html`<button class="tx tx-planned" data-a="editRule" data-id="${t.ruleId}">
    ${badge(c)}
    <span class="tx-main">
      <div class="tx-title">${t.note || c.name}</div>
      <div class="tx-sub">${details.join(' · ')}</div>
    </span>
    <span class="tx-amount">${t.estimated ? '≈ ' : ''}${t.type === 'income' ? '+' : '−'}${money(t.amount, w.currency)}
      ${t.foreignCurrency && html`<div class="tx-sub">${money(t.foreignAmount, t.foreignCurrency)}</div>`}
    </span>
  </button>`;
}

function txRow(t) {
  if (t.planned) return plannedRow(t);
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
  if (t.type === 'tax') {
    const type = taxType(taxItem(t.taxId).taxTypeId);
    const details = ['Tax', t.note && type.name, state.wallets.length > 1 && w.name].filter(Boolean);
    return html`<button class="tx" data-a="editPayment" data-id="${t.id}">
      ${badge(type)}
      <span class="tx-main">
        <div class="tx-title">${t.note || type.name}</div>
        <div class="tx-sub">${details.join(' · ')}</div>
      </span>
      <span class="tx-amount">−${money(t.amount, w.currency)}
        ${t.foreignCurrency && html`<div class="tx-sub">${money(t.foreignAmount, t.foreignCurrency)}</div>`}
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
    <span class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '−'}${money(t.amount, w.currency)}
      ${t.foreignCurrency && html`<div class="tx-sub">${money(t.foreignAmount, t.foreignCurrency)}</div>`}
    </span>
  </button>`;
}

// One tax in a list. Open ones show what's left, and finished ones what was paid.
function taxRow(tax, withPay) {
  const type = taxType(tax.taxTypeId);
  const status = C.taxStatus(state, tax);
  const details = [
    dayMonth(tax.date),
    tax.rate && `${tax.rate}% of ${money(tax.base, tax.baseCurrency)}`,
    status.paid > 0 && !status.settled && 'Part paid',
    tax.fxSource === 'estimate' && 'Estimate',
  ].filter(Boolean);
  return html`<div class="tax-row">
    <button class="tx" data-a="openTax" data-id="${tax.id}">
      ${badge(type)}
      <span class="tx-main">
        <div class="tx-title">${tax.note || type.name}</div>
        <div class="tx-sub">${details.join(' · ')}</div>
      </span>
      <span class="tx-amount">${money(status.settled ? status.paid : status.remaining, tax.currency)}
        ${status.settled && status.difference !== 0 && html`<div class="tx-sub">${signedMoney(status.difference, tax.currency)}</div>`}
      </span>
    </button>
    ${withPay && html`<button class="pay-btn" data-a="payTax" data-id="${tax.id}" aria-label="Pay ${type.name}">Pay</button>`}
  </div>`;
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

const isFutureMonth = () => ui.month > C.monthOf(today());
const byDate = (list) => [...list].sort((a, b) => a.date.localeCompare(b.date));

// What a month's numbers are built from: real entries, plus planned ones once it's in the future.
function monthList() {
  const actual = C.txInMonth(state.tx, ui.month);
  return isFutureMonth() ? [...actual, ...C.plannedEntries(state, ui.month, today())] : actual;
}

const plannedNote = (list) =>
  list.some((t) => t.planned) &&
  html`<p class="small">${list.some((t) => t.planned && t.foreignCurrency) || list.some((t) => t.planned && wallet(t.walletId).currency !== state.currency)
    ? "Planned from your recurring items at today's exchange rates, or your own rate where you set one. Amounts change until the payment happens."
    : 'Planned from your recurring items.'}</p>`;

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

function foreignOptions(selected, walletCurrency) {
  const all = Intl.supportedValuesOf?.('currency') ?? [];
  const codes = [...new Set([...COMMON_CURRENCIES, ...(selected ? [selected] : []), ...all])].filter((c) => c !== walletCurrency);
  return html`<option value="">${walletCurrency} (same as wallet)</option>
    ${codes.map((code) => html`<option ${code === selected ? 'selected' : ''}>${code}</option>`)}`;
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
  if (state.upgradeNotice) {
    const { taxes, fees } = state.upgradeNotice;
    out.push(html`<div class="banner"><strong>Tax is now separate from spending</strong>
      <span>${taxes} past tax ${taxes === 1 ? 'payment' : 'payments'} moved out of spending, and ${fees} ${fees === 1 ? 'fee' : 'fees'} moved to Fees. Your wallet balances didn't change.</span>
      <div class="btn-links"><button class="link" data-a="backup">Back up now</button>
      <button class="link" data-a="dismissUpgrade">Got it</button></div></div>`);
  }
  return out;
}

function taxToPayCard() {
  const unpaid = C.unpaidTaxes(state);
  if (!unpaid.length) return null;
  let total = 0;
  let converted = false;
  for (const tax of unpaid) {
    total += C.convertOn(state, C.taxStatus(state, tax).remaining, tax.currency, tax.date) ?? 0;
    if (tax.currency !== state.currency) converted = true;
  }
  return html`<section class="card">
    <div class="row-between">
      <h2 class="section-title">Tax to pay</h2>
      <button class="link" data-a="openTaxes">See all</button>
    </div>
    ${heroAmount(approx(converted) + money(total))}
    <div class="wallet-list">${unpaid.slice(0, 3).map((tax) => taxRow(tax, true))}</div>
    ${unpaid.length > 3 && html`<p class="small">And ${unpaid.length - 3} more.</p>`}
    ${unpaid.length > 1 && html`<button class="btn" data-a="payAll">Pay all</button>`}
  </section>`;
}

function walletsCard() {
  const worth = C.netWorth(state, today());
  const bal = balancesNow();
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
      <button class="btn btn-icon" data-a="openReconcile" aria-label="Correct balances" title="Correct balances">${iconMarkup('wrench')}</button>
    </div>
  </section>`;
}

function viewHome() {
  const future = isFutureMonth();
  const list = C.sortTx(monthList());
  const stillPlanned = future ? [] : byDate(C.plannedEntries(state, ui.month, today()));
  const stillTotals = C.summarize(state, stillPlanned);
  const summary = C.summarize(state, list);
  const { income, expense, byCategory, missing } = summary;
  const converted = summary.converted || list.some((t) => t.estimated);
  const limited = state.categories
    .filter((c) => c.kind === 'expense' && c.limit && !c.archived)
    .map((c) => ({ c, spent: byCategory.get(c.id) || 0 }))
    .sort((a, b) => b.spent / b.c.limit - a.spent / a.c.limit);
  const totalLimit = limited.reduce((sum, x) => sum + x.c.limit, 0);
  const limitedSpent = limited.reduce((sum, x) => sum + x.spent, 0);
  const taxes = C.monthTaxes(state, ui.month);
  const tax = taxes.paid + taxes.unpaid + summary.plannedTax;
  const afterTax = income - tax;
  const net = afterTax - expense;
  const estimated = converted || taxes.converted;
  const signed = (cents) => `${approx(estimated)}${cents < 0 ? '−' : ''}${money(Math.abs(cents))}`;

  return html`${banners()}${walletsCard()}${taxToPayCard()}${monthNav()}
    <section class="card">
      <div>
        <div class="hero-label">${future ? 'Planned spending' : 'Spent'}</div>
        ${heroAmount(approx(converted) + money(expense))}
      </div>
      ${totalLimit > 0 && html`${budgetBar(limitedSpent, totalLimit)}
        <div class="small">${leftText(limitedSpent, totalLimit)} of ${money(totalLimit)} budgeted</div>`}
      <div class="stats">
        <div><div class="small">Income</div><div class="stat-value">${signed(income)}</div></div>
        <button class="stat-link" data-a="openTaxes"><div class="small">Tax ›</div><div class="stat-value">${signed(tax)}</div></button>
        <div><div class="small">After tax</div><div class="stat-value">${signed(afterTax)}</div></div>
        <div><div class="small">Net after spending</div><div class="stat-value">${signed(net)}</div></div>
      </div>
      ${stillPlanned.length > 0 && html`<p class="small">Still planned this month: ${
        [stillTotals.expense && `≈ −${money(stillTotals.expense)}`, stillTotals.income && `≈ +${money(stillTotals.income)}`, stillTotals.plannedTax && `≈ ${money(stillTotals.plannedTax)} tax`].filter(Boolean).join(', ')
      }</p>`}
      ${missingRateNote(new Set([...missing, ...taxes.missing]))}
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

    ${stillPlanned.length > 0 && html`<section class="month-section">
      <h2 class="section-title">Still planned</h2>
      <div class="card card-flush">${stillPlanned.map(txRow)}</div>
      ${plannedNote(stillPlanned)}
    </section>`}

    ${future
      ? html`<section class="month-section">
          <h2 class="section-title">Planned</h2>
          <div class="card card-flush">
            ${list.length
              ? byDate(list).map(txRow)
              : html`<p class="empty">No recurring payments fall in this month.</p>`}
          </div>
          ${plannedNote(list)}
        </section>`
      : html`<section>
          <div class="row-between" style="padding-bottom:8px">
            <h2 class="section-title">Recent</h2>
            ${list.length > 5 && html`<button class="link" data-a="seeAll">See all</button>`}
          </div>
          <div class="card card-flush">
            ${list.length
              ? list.slice(0, 5).map(txRow)
              : html`<p class="empty">Nothing this month. Tap + to add your first entry.</p>`}
          </div>
        </section>`}`;
}

// ---------- Activity ----------

function activityResults() {
  const q = ui.search.trim().toLowerCase();
  let list = q ? state.tx : [...C.txInMonth(state.tx, ui.month), ...C.plannedEntries(state, ui.month, today())];
  if (ui.filterCat) list = list.filter((t) => t.categoryId === ui.filterCat);
  if (ui.filterWallet) list = list.filter((t) => t.walletId === ui.filterWallet || t.toWalletId === ui.filterWallet);
  if (q) {
    list = list.filter((t) => {
      const label =
        t.type === 'transfer' ? 'transfer'
        : t.type === 'adjustment' ? 'balance correction'
        : t.type === 'tax' ? `tax ${taxType(taxItem(t.taxId).taxTypeId).name}`
        : category(t.categoryId).name;
      return `${t.note || ''} ${label} ${wallet(t.walletId).name}`.toLowerCase().includes(q);
    });
  }
  // A future month reads like a calendar, soonest first. Everything else is newest first.
  const sorted = !q && isFutureMonth() ? byDate(list) : C.sortTx(list);
  const shown = sorted.slice(0, q ? SEARCH_LIMIT : undefined);
  if (!shown.length) return html`<div class="card card-flush"><p class="empty">${!q && isFutureMonth() ? 'Nothing planned here.' : 'No matching entries.'}</p></div>`;
  return html`<div class="card card-flush">${txGroups(shown)}</div>
    ${plannedNote(shown)}
    ${sorted.length > shown.length && html`<p class="small">Showing the latest ${shown.length} of ${sorted.length}.</p>`}`;
}

function viewActivity() {
  const w = wallet(ui.filterWallet);
  const previous = nav.stack.at(-1);
  return html`${previous && html`<button class="back-row" data-a="back">${svg(ICONS.left)}${TAB_LABELS[previous.tab]}</button>`}
    ${w && html`<section class="card">
      <div class="row-between">
        <span class="budget-name">${badge(w, 'badge-small')} ${w.name}</span>
        <button class="link" data-a="editWallet" data-id="${w.id}">Edit</button>
      </div>
      ${heroAmount(money(balancesNow().get(w.id), w.currency))}
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
  if (ui.month > current) return ui.month;
  return ui.month > C.addMonths(current, -TREND_MONTHS) ? current : ui.month;
}

function barPath(x, y, w, h, r) {
  const radius = Math.min(r, h, w / 2);
  if (!radius) return `M${x} ${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x} ${y + h}V${y + radius}Q${x} ${y} ${x + radius} ${y}H${x + w - radius}Q${x + w} ${y} ${x + w} ${y + radius}V${y + h}Z`;
}

function trendChart(rows) {
  const W = 340;
  const H = 190;
  const top = 8;
  const bottom = 24;
  const plotH = H - top - bottom;
  const max = C.niceMax(Math.max(...rows.map((r) => Math.max(r.income, r.expense, r.tax))));
  // Room for the longest axis label, which depends on the currency and the amounts.
  const left = Math.max(46, Math.max(...[0, max / 2, max].map((v) => moneyCompact(v).length)) * 6.5 + 8);
  const groupW = (W - left) / rows.length;
  const GAP = 2;
  const barW = Math.min(12, (groupW - 8 - GAP * 2) / 3);
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
      aria-label="${monthLabel(r.key)}${r.planned ? ' (planned)' : ''}: income ${money(r.income)}, expenses ${money(r.expense)}, tax ${money(r.tax)}"></rect>`;
  });

  const bars = rows.map((r, i) => {
    const cx = left + i * groupW + groupW / 2;
    const bar = (value, x, cls) => {
      if (!value) return '';
      const h = Math.max(2, (value / max) * plotH);
      return html`<path class="${cls} ${r.planned ? 'planned' : ''}" d="${barPath(x, top + plotH - h, barW, h, 4)}"></path>`;
    };
    // Paid tax sits on the baseline, with what's still unpaid or planned in a lighter shade on top.
    const taxX = cx + barW / 2 + GAP;
    const later = r.taxUnpaid + r.taxPlanned;
    const paidH = r.taxPaid ? Math.max(2, (r.taxPaid / max) * plotH) : 0;
    const laterH = later ? Math.max(2, (later / max) * plotH) : 0;
    const gap = paidH && laterH ? GAP : 0;
    const taxBars = html`${paidH > 0 && html`<path class="tax" d="${barPath(taxX, top + plotH - paidH, barW, paidH, laterH ? 0 : 4)}"></path>`}
      ${laterH > 0 && html`<path class="tax later" d="${barPath(taxX, top + plotH - paidH - gap - laterH, barW, laterH, 4)}"></path>`}`;
    return html`${bar(r.income, cx - barW * 1.5 - GAP, 'income')}
      ${bar(r.expense, cx - barW / 2, 'expense')}
      ${taxBars}
      <text class="${r.key === ui.month ? 'selected' : ''}" x="${cx}" y="${H - 7}" text-anchor="middle">${monthShort(r.key)}</text>`;
  });

  return html`<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Income, expenses and tax by month">
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
      <div class="small">${chosen ? chosen.c.name : isFutureMonth() ? 'Planned' : 'Spent'}</div>
      <div class="donut-amount ${center.length > 10 ? 'donut-amount-long' : ''}">${center}</div>
      ${chosen && html`<div class="small">${percent(chosen.amount, total)}</div>`}
    </div>
  </div>`;
}

const percent = (part, whole) => (part / whole < 0.01 ? '<1%' : `${Math.round((part / whole) * 100)}%`);

function viewInsights() {
  const list = monthList();
  const s = C.summarize(state, list);
  const estimated = s.converted || list.some((t) => t.estimated);
  const spent = [...s.byCategory]
    .map(([id, amount]) => ({ c: category(id), amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = spent.reduce((sum, x) => sum + x.amount, 0);
  const top = spent[0]?.amount || 1;
  const rows = C.trend(state, trendEnd(), TREND_MONTHS, today());
  const chosen = rows.find((r) => r.key === ui.month);
  const taxes = C.monthTaxes(state, ui.month);
  const monthTax = taxes.paid + taxes.unpaid + s.plannedTax;

  return html`${monthNav()}
    <section class="card">
      <h2 class="section-title">${isFutureMonth() ? 'Planned spending' : 'Spending'}</h2>
      ${spent.length
        ? html`${donut(spent, total, estimated)}
          ${spent.map(
            (x) => html`<button class="cat-bar ${colorClass(x.c.color)}" data-a="openCat" data-id="${x.c.id}">
              <div class="row-between">
                <span class="budget-name">${badge(x.c, 'badge-small')} ${x.c.name}</span>
                <span class="small">${money(x.amount)} · ${percent(x.amount, total)}</span>
              </div>
              <div class="bar"><i style="width:${((x.amount / top) * 100).toFixed(1)}%"></i></div>
            </button>`,
          )}`
        : html`<p class="small">${isFutureMonth() ? 'No planned spending this month.' : 'No spending this month.'}</p>`}
      ${monthTax > 0 && html`<button class="tax-line" data-a="openTaxes">
        <span class="budget-name">Tax</span>
        <span class="small">${money(monthTax)} · not part of spending ›</span>
      </button>`}
      ${plannedNote(list) || (s.converted && html`<p class="small">Converted to ${state.currency} at the rate saved for each date, or today's rate where none is saved.</p>`)}
      ${missingRateNote(s.missing)}
    </section>

    <section class="card">
      <h2 class="section-title">Income, expenses and tax</h2>
      <div class="legend">
        <span><i style="background:var(--income)"></i>Income</span>
        <span><i style="background:var(--expense)"></i>Expenses</span>
        <span><i style="background:var(--tax)"></i>Tax</span>
        <span>Lighter bars are unpaid or planned</span>
      </div>
      ${trendChart(rows)}
      ${chosen && html`<p class="small">${monthLabel(chosen.key)}${chosen.planned ? ' (planned)' : ''}: income ${money(chosen.income)}, expenses ${money(chosen.expense)}, tax ${money(chosen.tax)}, income after tax ${signedPlain(chosen.income - chosen.tax)}</p>`}
      <details>
        <summary>Show as table</summary>
        <table class="table">
          <caption class="small">In ${state.currency}</caption>
          <thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>Tax</th></tr></thead>
          <tbody>${rows.map(
            (r) => html`<tr><td>${monthShort(r.key)}${r.planned ? ' (planned)' : ''}</td><td>${plainAmount(r.income)}</td><td>${plainAmount(r.expense)}</td><td>${plainAmount(r.tax)}</td></tr>`,
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

function hasBeforeTaxCopy() {
  try {
    return localStorage.getItem(BEFORE_TAX_KEY) !== null;
  } catch {
    return false;
  }
}

function viewSettings() {
  return html`<h1 class="section-title" style="font-size:28px">Settings</h1>
    <section class="card card-flush">
      <div class="set-row"><span>Theme</span>
        ${seg('setTheme', readTheme(), [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}
      </div>
      <label class="set-row"><span>Total currency</span>
        <select class="input" data-change="currency" aria-label="Total currency">${currencyOptions(state.currency)}</select>
      </label>
      <button class="set-row" data-a="openRates"><span>Exchange rates</span><span class="value">${ratesStatus()} ›</span></button>
      <button class="set-row" data-a="openWallets"><span>Wallets</span><span class="value">${activeWallets().length} ›</span></button>
      <button class="set-row" data-a="openCategories"><span>Categories and limits</span><span class="chev">›</span></button>
      <button class="set-row" data-a="openRecurring"><span>Recurring</span>
        <span class="value">${state.recurring.length} ›</span></button>
      <button class="set-row" data-a="openTaxes"><span>Taxes</span>
        <span class="value">${C.unpaidTaxes(state).length ? `${C.unpaidTaxes(state).length} to pay` : ''} ›</span></button>
      <button class="set-row" data-a="openCorrections"><span>Balance corrections</span>
        <span class="value">${state.tx.filter((t) => t.type === 'adjustment').length} ›</span></button>
    </section>

    <section class="card card-flush">
      <button class="set-row" data-a="exportCsv"><span>Export to CSV</span><span class="value">For spreadsheets</span></button>
      <button class="set-row" data-a="backup"><span>Back up everything</span>
        <span class="value">${state.lastBackup ? `Last: ${shortMoment(state.lastBackup)}` : 'Never'}</span></button>
      <label class="set-row" for="restore-json"><span>Restore from backup</span><span class="chev">›</span></label>
      <label class="set-row" for="import-csv"><span>Import from another app (CSV)</span><span class="chev">›</span></label>
      ${hasBeforeTaxCopy() && html`<button class="set-row" data-a="saveBeforeTaxCopy"><span>Copy from before the tax update</span><span class="value">Save file</span></button>`}
    </section>
    <p class="small">${state.tx.length} ${state.tx.length === 1 ? 'entry' : 'entries'}, stored only on this device. The only thing the app downloads is exchange rates, and that sends none of your data. Deleting the app deletes this data, so keep a backup in Files or iCloud Drive.</p>`;
}

// ---------- Sheets ----------

// Task forms offer Cancel and screens reached from a list offer Back. Both return to the previous screen.
const sheetHead = (title, leftLabel, saveAction, saveLabel = 'Save') =>
  html`<header class="sheet-head">
    <button class="head-back" data-a="back">${leftLabel === 'Back' && svg(ICONS.left)}${leftLabel}</button>
    <h2>${title}</h2>
    ${saveAction ? html`<button class="save" data-a="${saveAction}">${saveLabel}</button>` : html`<span></span>`}
  </header>`;

const seg = (action, value, options) =>
  html`<div class="seg">${options.map(
    ([v, label]) => html`<button type="button" data-a="${action}" data-v="${v}" aria-pressed="${v === value}">${label}</button>`,
  )}</div>`;

const TYPE_OPTIONS = [['expense', 'Expense'], ['income', 'Income']];
const RULE_TYPE_OPTIONS = [...TYPE_OPTIONS, ['tax', 'Tax']];
const TX_TYPE_OPTIONS = [...RULE_TYPE_OPTIONS, ['transfer', 'Transfer']];
// An existing entry can't turn into a tax: a tax is made from its own form, and can have payments.
const txTypeOptions = (s) => (s.id ? TX_TYPE_OPTIONS.filter(([v]) => v !== 'tax') : TX_TYPE_OPTIONS);

const walletSelect = (id, label, selectedId, change) =>
  html`<label class="field"><span>${label}</span>
    <select id="${id}" class="input" data-change="${change}">${walletChoices(selectedId).map(
      (w) => html`<option value="${w.id}" ${w.id === selectedId ? 'selected' : ''}>${w.name} (${w.currency})</option>`,
    )}</select>
  </label>`;

function sheetTx(s) {
  const f = s.form;
  // Wallets can be added or deleted on the way back to this form.
  if (!wallet(f.walletId)) f.walletId = defaultWalletId();
  if (!wallet(f.toWalletId)) f.toWalletId = otherWallet(f.walletId);
  const from = wallet(f.walletId);
  const footer = html`<label class="field"><span>Date</span><input id="f-date" class="input" type="date" value="${f.date}"></label>
    <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" value="${f.note}"></label>
    ${s.id && (s.confirmDelete ? deleteIncomeChoice(s) : html`<button class="btn btn-danger" data-a="deleteTx">Delete entry</button>`)}`;
  const priced = (f.type !== 'transfer' && f.foreign) || from.currency;
  const amount = html`<div>
    <input id="f-amount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Amount in ${priced}" value="${f.amount}">
    <p class="amount-currency">${priced}</p>
  </div>`;

  if (f.type === 'transfer') {
    const to = wallet(f.toWalletId);
    const rate = to && C.crossRate(state, from.currency, to.currency);
    return html`${sheetHead(s.id ? 'Edit transfer' : 'Move money', 'Cancel', 'saveTx')}
      <div class="sheet-body">
        ${seg('txType', f.type, txTypeOptions(s))}
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

  const chargedRate = f.foreign && C.crossRate(state, f.foreign, from.currency);
  const priceFields = html`<label class="field"><span>Price in</span>
      <select id="f-foreign" class="input" data-change="txForm">${foreignOptions(f.foreign, from.currency)}</select>
    </label>
    ${f.foreign && html`<label class="field"><span>${f.type === 'income' ? 'Added to' : 'Taken from'} wallet (${from.currency})</span>
        <input id="f-charged" class="input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${f.charged}"></label>
      <p class="small">${chargedRate
        ? `Today's rate: 1 ${f.foreign} = ${formatRate(chargedRate)} ${from.currency}. Change the amount to match what really moved.`
        : `No exchange rate saved for ${f.foreign}, so enter the amount that really moved.`}</p>`}`;

  if (f.type === 'tax') return sheetTaxEntry(s, amount, priceFields, footer);

  const cats = categoriesByUse(f.type);
  const current = category(f.categoryId);
  // An archived category stays selectable when editing an old entry that uses it.
  const all = current && current.kind === f.type && current.archived ? [...cats, current] : cats;
  // The most used come first, so the usual tap is near the top and the rest are one tap away.
  const top = all.slice(0, CATEGORY_SHORTLIST);
  const choices = s.allCategories || all.length <= CATEGORY_SHORTLIST
    ? all
    : current && !top.includes(current) && current.kind === f.type ? [...top.slice(0, -1), current] : top;
  return html`${sheetHead(s.id ? 'Edit entry' : 'New entry', 'Cancel', 'saveTx')}
    <div class="sheet-body">
      ${seg('txType', f.type, txTypeOptions(s))}
      ${amount}
      ${s.error && html`<p class="error">${s.error}</p>`}
      ${walletSelect('f-wallet', 'Wallet', f.walletId, 'txForm')}
      <div class="cat-grid">${choices.map(
        (c) => html`<button type="button" class="cat" data-a="txCat" data-id="${c.id}" aria-pressed="${c.id === f.categoryId}">
          ${badge(c)}${c.name}</button>`,
      )}</div>
      ${choices.length < all.length && html`<button type="button" class="btn" data-a="showAllCategories">All categories (${all.length})</button>`}
      ${priceFields}
      ${f.type === 'income' && incomeTaxFields(s)}
      ${footer}
    </div>`;
}

// The amount that really reached the wallet, which is what a percentage tax is taken from.
function incomeInWallet(f) {
  const text = f.foreign ? f.charged : f.amount;
  return Math.abs(C.parseAmount(text) ?? 0);
}

// Taxes offered on an income: those linked to its wallet, and any it already has.
function incomeTaxRows(s) {
  const f = s.form;
  const existing = s.id ? state.taxes.filter((x) => x.incomeId === s.id) : [];
  const types = [...new Set([...C.linkedTaxTypes(state, f.walletId), ...existing.map((x) => taxType(x.taxTypeId))])];
  return types.map((type) => {
    const tax = existing.find((x) => x.taxTypeId === type.id);
    const saved = f.taxes?.[type.id];
    return {
      type,
      paid: Boolean(tax) && C.taxPayments(state, tax.id).length > 0,
      // An income saved before a tax existed stays as it was until the box is ticked.
      on: saved?.on ?? (tax ? true : !s.id),
      rate: saved?.rate ?? String(tax?.rate ?? type.rate),
    };
  });
}

const taxPreview = (f, rateText) => {
  const rate = C.parseRate(rateText);
  const cents = incomeInWallet(f);
  return rate && cents ? `≈ ${money(Math.round((cents * rate) / 100), wallet(f.walletId).currency)}` : '';
};

function incomeTaxFields(s) {
  const rows = incomeTaxRows(s);
  if (!rows.length) return null;
  return html`<div class="card">
    <strong>Tax on this income</strong>
    ${rows.map((x) => html`<div class="tax-check">
      <label class="tax-check-name">
        <input type="checkbox" data-tax-on="${x.type.id}" ${x.on ? 'checked' : ''} ${x.paid ? 'disabled' : ''}>
        ${badge(x.type, 'badge-small')} ${x.type.name}
      </label>
      <span class="tax-check-rate"><input class="input" inputmode="decimal" autocomplete="off" aria-label="${x.type.name} percent" data-tax-rate="${x.type.id}" value="${x.rate}">%</span>
      <span class="small tax-check-amount" data-tax-amount="${x.type.id}">${taxPreview(s.form, x.rate)}</span>
    </div>`)}
    <p class="small">${rows.some((x) => x.paid) ? 'A tax with a payment stays, and shows any new difference. ' : ''}Added to Tax to pay. The wallet changes only when you pay it.</p>
  </div>`;
}

// Deleting an income that has taxes. Money already paid really left the wallet, so it always stays.
function deleteIncomeChoice(s) {
  const linked = state.taxes.filter((x) => x.incomeId === s.id);
  const paid = linked.filter((x) => C.taxPayments(state, x.id).length > 0).length;
  return html`<div class="card">
    <strong>This income has ${linked.length} ${linked.length === 1 ? 'tax' : 'taxes'}</strong>
    ${paid > 0 && html`<p class="small">${paid} ${paid === 1 ? 'has' : 'have'} payments, which stay either way.</p>`}
    <button class="btn btn-danger" data-a="deleteIncome" data-keep="">Delete income and unpaid taxes</button>
    <button class="btn btn-danger" data-a="deleteIncome" data-keep="yes">Delete income, keep taxes</button>
    <button class="btn" data-a="cancelDelete">Keep the income</button>
  </div>`;
}

// Recent income a percentage tax can be taken from, leaving out any that already has this tax.
function incomeOptions(taxTypeId) {
  const taken = new Set(state.taxes.filter((x) => x.taxTypeId === taxTypeId).map((x) => x.incomeId));
  return C.sortTx(state.tx.filter((t) => t.type === 'income' && !taken.has(t.id))).slice(0, 24);
}

function sheetTaxEntry(s, amount, priceFields, footer) {
  const f = s.form;
  const types = activeTaxTypes();
  const type = taxType(f.taxTypeId);
  const percent = type?.mode === 'percent';
  const income = percent && f.incomeId ? state.tx.find((t) => t.id === f.incomeId) : null;
  const incomeWallet = income && wallet(income.walletId);
  const rate = C.parseRate(f.taxRate);
  return html`${sheetHead('New tax', 'Cancel', 'saveTx')}
    <div class="sheet-body">
      ${seg('txType', f.type, txTypeOptions(s))}
      ${!income && amount}
      ${s.error && html`<p class="error">${s.error}</p>`}
      ${types.length
        ? html`<div class="cat-grid">${types.map(
            (x) => html`<button type="button" class="cat" data-a="txTaxType" data-id="${x.id}" aria-pressed="${x.id === f.taxTypeId}">
              ${badge(x)}${x.name}</button>`,
          )}</div>`
        : html`<p class="small">Add a tax type first, such as a percentage of income or a fixed monthly amount.</p>`}
      <button type="button" class="btn" data-a="newTaxType">Add tax type</button>
      ${percent && html`<label class="field"><span>Percentage of</span>
          <select id="f-income" class="input" data-change="txForm">
            <option value="">No income, I'll enter the amount</option>
            ${incomeOptions(type.id).map((t) => {
              const w = wallet(t.walletId);
              return html`<option value="${t.id}" ${t.id === f.incomeId ? 'selected' : ''}>${dayMonth(t.date)} · ${money(t.amount, w.currency)}${t.note ? ` · ${t.note}` : ''}</option>`;
            })}
          </select></label>
        ${income && html`<label class="field"><span>Percent</span>
            <input id="f-tax-rate" class="input" inputmode="decimal" autocomplete="off" value="${f.taxRate}" data-change="txForm"></label>
          ${rate && html`<p class="small">Should pay about ${money(Math.round((income.amount * rate) / 100), incomeWallet.currency)}, worked out in ${type.currency} at the rate on the income date.</p>`}`}`}
      ${seg('taxStatus', f.taxStatus, [['due', 'To pay'], ['paid', 'Paid']])}
      ${!income && walletSelect('f-wallet', f.taxStatus === 'paid' ? 'Paid from' : 'Pay from', f.walletId, 'txForm')}
      ${income && html`<input id="f-wallet" type="hidden" value="${f.walletId}">`}
      ${!income && priceFields}
      ${income && f.taxStatus === 'paid' && html`<p class="small">You'll enter what you paid on the next screen.</p>`}
      ${footer}
    </div>`;
}

function taxesList(list, withPay) {
  return html`<div class="card card-flush">${list.map((tax) => taxRow(tax, withPay))}</div>`;
}

function sheetTaxes() {
  const unpaid = C.unpaidTaxes(state);
  const done = state.taxes
    .filter((x) => C.taxStatus(state, x).settled)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 24);
  return html`${sheetHead('Taxes', 'Back')}
    <div class="sheet-body">
      <section class="month-section">
        <h2 class="section-title">Tax to pay</h2>
        ${unpaid.length ? taxesList(unpaid, true) : html`<p class="small">Nothing to pay right now.</p>`}
      </section>
      ${unpaid.length > 1 && html`<button class="btn" data-a="payAll">Pay all</button>`}
      <button class="btn" data-a="newTaxEntry">Add a tax</button>
      <button class="btn" data-a="openTaxSummary">Yearly summary</button>
      <button class="btn" data-a="openTaxTypes">Tax types</button>
      ${done.length > 0 && html`<section class="month-section">
        <h2 class="section-title">Paid</h2>
        ${taxesList(done, false)}
      </section>`}
    </div>`;
}

const taxedWalletIds = () => [...new Set(activeTaxTypes().filter((x) => x.mode === 'percent').flatMap((x) => x.walletIds))];

const summaryOptions = (s) => ({ currency: s.currency, walletIds: s.scope === 'taxed' ? taxedWalletIds() : null });
const currentSummary = (s) => C.yearSummary(state, s.year, summaryOptions(s));

function summaryTable(title, rows) {
  return html`<table class="table">
    <thead><tr><th>${title}</th><th>Income</th><th>Tax</th><th>After tax</th></tr></thead>
    <tbody>${rows.map(
      (r) => html`<tr><td>${r.name}</td><td>${plainAmount(r.income)}</td><td>${plainAmount(r.tax)}</td><td>${plainAmount(r.afterTax)}</td></tr>`,
    )}</tbody>
  </table>`;
}

function sheetTaxSummary(s) {
  const sum = currentSummary(s);
  const t = sum.total;
  const taxed = taxedWalletIds();
  const first = Number(C.firstDataYear(state, today().slice(0, 4)));
  const types = [...t.byType].map(([id, value]) => ({ type: taxType(id), value })).sort((a, b) => b.value - a.value);
  const quarters = sum.quarters.map((q) => ({ ...q, name: q.label }));
  const months = sum.months
    .filter((m) => m.income || m.tax || m.refund)
    .map((m) => ({ ...m, name: monthShort(m.label) }));
  return html`${sheetHead('Yearly summary', 'Back')}
    <div class="sheet-body">
      <div class="month-nav">
        <button class="icon-btn" data-a="summaryYear" data-v="${s.year - 1}" aria-label="Previous year" ${s.year <= first ? 'disabled' : ''}>${svg(ICONS.left)}</button>
        <h1>${s.year}</h1>
        <button class="icon-btn" data-a="summaryYear" data-v="${s.year + 1}" aria-label="Next year" ${s.year >= Number(today().slice(0, 4)) ? 'disabled' : ''}>${svg(ICONS.right)}</button>
      </div>
      ${taxed.length > 0 && html`<div class="field"><span>Income from</span>
        ${seg('summaryScope', s.scope, [['taxed', 'Wallets with percent tax'], ['all', 'All wallets']])}</div>`}
      <label class="field"><span>Shown in</span>
        <select class="input" data-change="summaryCurrency" aria-label="Summary currency">${currencyOptions(s.currency)}</select></label>
      <section class="card">
        <div>
          <div class="hero-label">Income after tax</div>
          ${heroAmount(`${t.afterTax < 0 ? '−' : ''}${money(Math.abs(t.afterTax), s.currency)}`)}
        </div>
        <div class="stats">
          <div><div class="small">Income</div><div class="stat-value">${money(t.income, s.currency)}</div></div>
          <div><div class="small">Tax${t.income ? `, ${((t.tax / t.income) * 100).toFixed(1)}% of income` : ''}</div><div class="stat-value">${money(t.tax, s.currency)}</div></div>
          ${t.refund > 0 && html`<div><div class="small">Tax refunds</div><div class="stat-value">${money(t.refund, s.currency)}</div></div>`}
          ${t.taxUnpaid > 0 && html`<div><div class="small">Still to pay</div><div class="stat-value">${money(t.taxUnpaid, s.currency)}</div></div>`}
        </div>
      </section>
      <section class="card">
        <h2 class="section-title">By quarter</h2>
        <p class="small">In ${s.currency}</p>
        ${summaryTable('Quarter', quarters)}
        ${months.length > 0 && html`<details>
          <summary>Show months</summary>
          ${summaryTable('Month', months)}
        </details>`}
      </section>
      ${types.length > 0 && html`<section class="card">
        <h2 class="section-title">By tax</h2>
        ${types.map((x) => html`<div class="row-between">
          <span class="budget-name">${badge(x.type, 'badge-small')} ${x.type.name}</span>
          <span class="value-text">${money(x.value, s.currency)}</span>
        </div>`)}
      </section>`}
      ${missingRateNote(sum.missing)}
      ${sum.estimated > 0 && html`<p class="small">${sum.estimated} ${sum.estimated === 1 ? 'amount uses' : 'amounts use'} today's rate, because no official rate is saved for that date.</p>`}
      <button class="btn" data-a="exportTaxSummary">Export to CSV</button>
      <p class="small">Each amount uses the official NBU rate for its date. Tax counts for the month of its income or due date, whenever it was paid. Check these numbers with your accountant before filing.</p>
    </div>`;
}

const rateLine = (tax) => {
  if (!tax.base || tax.baseCurrency === tax.currency) return null;
  const big = tax.fx >= 1;
  const text = `1 ${big ? tax.baseCurrency : tax.currency} = ${formatRate(big ? tax.fx : 1 / tax.fx)} ${big ? tax.currency : tax.baseCurrency}`;
  const source = tax.fxSource === 'nbu' ? `NBU, ${dayMonth(tax.date)}` : tax.fxSource === 'manual' ? 'your rate' : 'estimate until the NBU rate is saved';
  return `${text} (${source})`;
};

function sheetTaxItem(s) {
  const tax = taxItem(s.id);
  if (!tax) return html`${sheetHead('Tax', 'Back')}<div class="sheet-body"><p class="small">This tax no longer exists.</p></div>`;
  const f = s.form;
  const type = taxType(tax.taxTypeId);
  const status = C.taxStatus(state, tax);
  // The same amount in the income's currency, so it can be compared with the bank statement.
  const equivalent = (cents) =>
    tax.base && tax.baseCurrency !== tax.currency ? `≈ ${money(Math.round(cents / tax.fx), tax.baseCurrency)}` : '';
  const income = tax.incomeId && state.tx.find((t) => t.id === tax.incomeId);
  return html`${sheetHead(type.name, 'Back', 'saveTaxItem')}
    <div class="sheet-body">
      ${s.error && html`<p class="error">${s.error}</p>`}
      <div class="card">
        <div class="row-between"><span class="small">Should pay${tax.rate ? `: ${tax.rate}% of ${money(tax.base, tax.baseCurrency)}` : ''}</span></div>
        <div class="tax-figure">${money(tax.dueAmount, tax.currency)} <span class="small">${equivalent(tax.dueAmount)}</span></div>
        ${rateLine(tax) && html`<p class="small">${rateLine(tax)}</p>`}
        <div class="row-between"><span class="small">Paid${status.paidPercent ? `: ${status.paidPercent.toFixed(2)}%` : ''}</span></div>
        <div class="tax-figure">${money(status.paid, tax.currency)} <span class="small">${equivalent(status.paid)}</span></div>
        <p class="tax-diff">${status.difference === 0
          ? 'Paid exactly what it should be.'
          : status.difference > 0
            ? `${money(status.difference, tax.currency)} more than it should be${equivalent(status.difference) && ` (${equivalent(status.difference)})`}. This isn't carried over.`
            : `${money(status.remaining, tax.currency)} still to pay${equivalent(status.remaining) && ` (${equivalent(status.remaining)})`}.`}</p>
        <button class="btn" data-a="payTax" data-id="${tax.id}">${status.settled ? 'Add another payment' : 'Pay'}</button>
      </div>
      ${status.payments.length > 0 && html`<section class="month-section">
        <h2 class="section-title">Payments</h2>
        <div class="card card-flush">${C.sortTx(status.payments).map((p) => html`<button class="tx" data-a="editPayment" data-id="${p.id}">
          <span class="tx-main"><div class="tx-title">${shortDate(p.date)}</div><div class="tx-sub">${wallet(p.walletId).name}${p.note ? ` · ${p.note}` : ''}</div></span>
          <span class="tx-amount">${money(p.amount, wallet(p.walletId).currency)}
            ${p.foreignCurrency && html`<div class="tx-sub">${money(p.foreignAmount, p.foreignCurrency)}</div>`}</span>
        </button>`)}</div>
      </section>`}
      ${income && html`<button class="btn" data-a="editTx" data-id="${income.id}">Open the income (${shortDate(income.date)})</button>`}
      ${tax.base
        ? html`<label class="field"><span>Percent</span><input id="f-item-rate" class="input" inputmode="decimal" autocomplete="off" value="${f.rate}"></label>
          ${tax.baseCurrency !== tax.currency && html`<label class="field"><span>Value of 1 ${tax.baseCurrency} in ${tax.currency}</span>
            <input id="f-item-fx" class="input" inputmode="decimal" autocomplete="off" value="${f.fx}"></label>`}`
        : html`<label class="field"><span>Should pay (${tax.currency})</span><input id="f-item-due" class="input" inputmode="decimal" autocomplete="off" value="${f.due}"></label>`}
      ${!tax.incomeId && html`<label class="field"><span>Counts for the month of</span><input id="f-date" class="input" type="date" value="${f.date}"></label>`}
      <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" value="${f.note}"></label>
      <button class="btn btn-danger" data-a="deleteTaxItem">${status.payments.length ? 'Delete tax and its payments' : 'Delete tax'}</button>
      ${status.payments.length > 0 && html`<p class="small">Deleting its payments returns that money to the wallets.</p>`}
    </div>`;
}

// Tax-currency units for 1 unit of the wallet's currency, or null when no rate is known.
function taxPayFx(tax, walletId, date) {
  const currency = wallet(walletId).currency;
  if (currency === tax.currency) return 1;
  if (tax.payRate) return 1 / tax.payRate;
  return C.rateOn(state, currency, tax.currency, date)?.rate ?? null;
}

// Shows a rate the way people read it: 1 of the stronger currency equals a number above 1.
function setFormFx(f, fx, walletCurrency, taxCurrency) {
  f.fx = fx;
  const strong = !fx || fx >= 1;
  f.rateFrom = strong ? walletCurrency : taxCurrency;
  f.rateTo = strong ? taxCurrency : walletCurrency;
  f.rate = fx ? formatRate(strong ? fx : 1 / fx) : '';
}

const percentOfTax = (tax, cents, fx) => (tax.base && fx ? ((cents * fx) / (tax.base * tax.fx)) * 100 : null);

function paySheet(tax, payment) {
  const walletId = payment?.walletId ?? payerWallet(tax);
  const date = payment?.date ?? today();
  const fx = payment?.foreignCurrency ? payment.foreignAmount / payment.amount : taxPayFx(tax, walletId, date);
  const amount = payment ? payment.amount : fx ? Math.round(C.taxStatus(state, tax).remaining / fx) : 0;
  const pct = percentOfTax(tax, amount, fx);
  const form = {
    walletId,
    date,
    note: payment?.note ?? '',
    amount: amount ? C.centsToInput(amount) : '',
    percent: pct === null ? '' : pct.toFixed(2),
    fxEdited: Boolean(payment),
    amountEdited: Boolean(payment),
  };
  setFormFx(form, fx, wallet(walletId).currency, tax.currency);
  return { type: 'taxPay', taxId: tax.id, id: payment?.id, form };
}

// Plain words for what this payment does: how it compares with what should be paid.
function paySummary(s) {
  const tax = taxItem(s.taxId);
  const f = s.form;
  const cents = Math.abs(C.parseAmount(f.amount) ?? 0);
  if (!cents || !f.fx) return '';
  const others = C.taxPayments(state, tax.id)
    .filter((p) => p.id !== s.id)
    .reduce((sum, p) => sum + C.paymentInTaxCurrency(state, p, tax), 0);
  const counted = Math.round(cents * f.fx);
  const difference = others + counted - tax.dueAmount;
  const value = wallet(f.walletId).currency === tax.currency ? '' : `Counts as ${money(counted, tax.currency)}. `;
  if (difference === 0) return `${value}That's exactly what should be paid.`;
  return difference > 0
    ? `${value}That's ${money(difference, tax.currency)} more than it should be.`
    : `${value}${money(-difference, tax.currency)} will still be to pay.`;
}

function sheetTaxPay(s) {
  const tax = taxItem(s.taxId);
  if (!tax) return html`${sheetHead('Payment', 'Back')}<div class="sheet-body"><p class="small">This tax no longer exists.</p></div>`;
  const f = s.form;
  const type = taxType(tax.taxTypeId);
  const walletCurrency = wallet(f.walletId).currency;
  return html`${sheetHead(s.id ? 'Edit payment' : `Pay ${type.name}`, 'Cancel', 'savePayment')}
    <div class="sheet-body">
      <p class="small">Should pay ${money(tax.dueAmount, tax.currency)}${tax.rate ? ` (${tax.rate}%)` : ''}.</p>
      ${s.error && html`<p class="error">${s.error}</p>`}
      <div>
        <input id="f-pay-amount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Amount in ${walletCurrency}" value="${f.amount}">
        <p class="amount-currency">${walletCurrency}</p>
      </div>
      ${tax.base && html`<label class="field"><span>Percent of income</span>
        <input id="f-pay-percent" class="input" inputmode="decimal" autocomplete="off" value="${f.percent}"></label>`}
      ${walletSelect('f-wallet', 'Paid from', f.walletId, 'payForm')}
      ${walletCurrency !== tax.currency && html`<label class="rate-row rate-row-plain"><span>1 ${f.rateFrom} =</span>
          <input id="f-pay-rate" class="input" inputmode="decimal" autocomplete="off" placeholder="Enter rate" aria-label="Value of 1 ${f.rateFrom} in ${f.rateTo}" value="${f.rate}">
          <span>${f.rateTo}</span></label>`}
      <p class="reconcile-summary" id="pay-summary">${paySummary(s)}</p>
      <label class="field"><span>Paid on</span><input id="f-date" class="input" type="date" data-change="payForm" value="${f.date}"></label>
      <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" value="${f.note}"></label>
      ${s.id && html`<button class="btn btn-danger" data-a="deletePayment">Delete payment</button>`}
    </div>`;
}

function sheetTaxTypes() {
  const sorted = [...activeTaxTypes(), ...state.taxTypes.filter((x) => x.archived)];
  return html`${sheetHead('Tax types', 'Back')}
    <div class="sheet-body">
      ${sorted.length
        ? html`<div class="card card-flush">${sorted.map(
            (x) => html`<button class="set-row" data-a="editTaxType" data-id="${x.id}">
              <span class="budget-name">${badge(x, 'badge-small')} ${x.name}</span>
              <span class="value">${x.archived ? 'Hidden' : x.mode === 'percent' ? `${x.rate}%` : 'Fixed'} ›</span>
            </button>`,
          )}</div>`
        : html`<p class="small">A tax type is a percentage of income, or a fixed amount you owe even with no income.</p>`}
      <button class="btn" data-a="newTaxType">Add tax type</button>
    </div>`;
}

function sheetTaxType(s) {
  const f = s.form;
  const used = s.id && (state.taxes.some((x) => x.taxTypeId === s.id) || state.recurring.some((r) => r.taxTypeId === s.id));
  return html`${sheetHead(s.id ? 'Edit tax type' : 'New tax type', 'Back', 'saveTaxType')}
    <div class="sheet-body">
      ${s.error && html`<p class="error">${s.error}</p>`}
      <div class="name-row">
        ${badge(f, 'badge-large')}
        <label class="field"><span>Name</span><input id="f-name" class="input" maxlength="40" placeholder="Single tax" value="${f.name}"></label>
      </div>
      ${seg('taxMode', f.mode, [['percent', 'Percent of income'], ['fixed', 'Fixed amount']])}
      ${f.mode === 'percent'
        ? html`<div class="two-col">
            <label class="field"><span>Percent</span><input id="f-type-rate" class="input" inputmode="decimal" autocomplete="off" placeholder="5" value="${f.rate}"></label>
            <label class="field"><span>Worked out in</span><select id="f-currency" class="input">${currencyOptions(f.currency)}</select></label>
          </div>
          <div class="field"><span>Suggest on income in these wallets</span>
            <div class="card card-flush">${activeWallets().map(
              (w) => html`<label class="set-row"><span class="budget-name">${badge(w, 'badge-small')} ${w.name}</span>
                <input type="checkbox" data-tax-wallet="${w.id}" ${f.walletIds.includes(w.id) ? 'checked' : ''}></label>`,
            )}</div>
          </div>`
        : html`<p class="small">You owe this even with no income. To have it come due on a schedule, add it under Recurring and choose Tax.</p>`}
      ${stylePicker(f)}
      ${s.id && (used
        ? html`<button class="btn" data-a="toggleTaxTypeHidden">${f.archived ? 'Show tax type again' : 'Hide tax type'}</button>
          <p class="small">Hiding removes it from the picker. Its past taxes stay.</p>`
        : html`<button class="btn btn-danger" data-a="deleteTaxType">Delete tax type</button>`)}
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
  return html`${sheetHead('Categories', 'Back')}
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
  return html`${sheetHead(s.id ? 'Edit category' : 'New category', 'Back', 'saveCategory')}
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
  const bal = balancesNow();
  const sorted = [...activeWallets(), ...state.wallets.filter((w) => w.archived)];
  return html`${sheetHead('Wallets', 'Back')}
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
  return html`${sheetHead(s.id ? 'Edit wallet' : 'New wallet', 'Back', 'saveWallet')}
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
  const used = [...activeWallets().map((w) => w.currency), ...state.recurring.map((r) => r.foreignCurrency).filter(Boolean)];
  const codes = [...new Set(used)].filter((c) => c !== state.currency).sort();
  return html`${sheetHead('Exchange rates', 'Back')}
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
      <p class="small">Tax, income and spending use the official rate of the <a href="https://bank.gov.ua/ua/open-data" target="_blank" rel="noopener">National Bank of Ukraine</a> for their date. Your total uses the rates above.</p>
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
  const bal = balancesNow();
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
  const bal = balancesNow();
  const wallets = s.walletId ? [wallet(s.walletId)] : activeWallets();
  return html`${sheetHead(s.walletId ? 'Correct balance' : 'Correct balances', 'Cancel', 'saveReconcile')}
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
  return html`${sheetHead('Balance corrections', 'Back')}
    <div class="sheet-body">
      <p class="small">Every time a wallet's balance was corrected. Tap one to change its note or undo it.</p>
      ${list.length
        ? html`<div class="card card-flush">${list.map((t) => {
            const w = wallet(t.walletId);
            return html`<button class="tx tx-wrap" data-a="editCorrection" data-id="${t.id}">
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
  return html`${sheetHead('Balance correction', 'Back', 'saveCorrection')}
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
  return html`${sheetHead('Recurring', 'Back')}
    <div class="sheet-body">
      ${state.recurring.length
        ? html`<div class="card card-flush">${state.recurring.map((r) => {
            const c = r.type === 'tax' ? taxType(r.taxTypeId) : category(r.categoryId);
            const w = wallet(r.walletId);
            return html`<button class="tx" data-a="editRule" data-id="${r.id}">
              ${badge(c)}
              <span class="tx-main">
                <div class="tx-title">${r.note || c.name}</div>
                <div class="tx-sub">Next ${dayMonth(C.nextOccurrence(r))} · ${FREQ_LABEL[r.freq]} · ${w.name}</div>
              </span>
              ${r.foreignCurrency
                ? html`<span class="tx-amount ${r.type}">${r.type === 'income' ? '+' : '−'}${money(r.foreignAmount, r.foreignCurrency)}
                    <div class="tx-sub">${r.fixedRate ? '' : '≈ '}${money(C.ruleCharge(state, r), w.currency)}</div></span>`
                : html`<span class="tx-amount ${r.type}">${r.type === 'income' ? '+' : '−'}${money(r.amount, w.currency)}</span>`}
            </button>`;
          })}</div>`
        : html`<p class="small">Rent, subscriptions and salary can be added automatically each time they come due.</p>`}
      <button class="btn" data-a="newRule">Add recurring item</button>
    </div>`;
}

function sheetRule(s) {
  const f = s.form;
  const walletCurrency = wallet(f.walletId).currency;
  const currentRate = f.foreign && C.crossRate(state, f.foreign, walletCurrency);
  return html`${sheetHead(s.id ? 'Edit recurring' : 'New recurring', 'Back', 'saveRule')}
    <div class="sheet-body">
      ${seg('ruleType', f.type, RULE_TYPE_OPTIONS)}
      ${s.error && html`<p class="error">${s.error}</p>`}
      ${walletSelect('f-wallet', 'Wallet', f.walletId, 'ruleForm')}
      <label class="field"><span>Price in</span>
        <select id="f-foreign" class="input" data-change="ruleForm">${foreignOptions(f.foreign, walletCurrency)}</select>
      </label>
      <label class="field"><span>Amount (${f.foreign || walletCurrency})</span><input id="f-amount" class="input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${f.amount}"></label>
      ${f.foreign && html`<div class="field"><span>Exchange rate</span>
          ${seg('ruleRateMode', f.rateMode, [['current', 'Current rate'], ['fixed', 'My rate']])}
        </div>
        ${f.rateMode === 'fixed'
          ? html`<label class="rate-row rate-row-plain"><span>1 ${f.foreign} =</span>
              <input id="f-rate" class="input" inputmode="decimal" autocomplete="off" placeholder="Enter rate" aria-label="Value of 1 ${f.foreign} in ${walletCurrency}" value="${f.rate}">
              <span>${walletCurrency}</span></label>
            <p class="small">Every payment uses this rate until you change it.</p>`
          : html`<p class="small">${currentRate
              ? `Each payment uses the rate on its due date. Today: 1 ${f.foreign} = ${formatRate(currentRate)} ${walletCurrency}.`
              : `No exchange rate saved for ${f.foreign}. Connect to the internet, or choose My rate.`}</p>`}`}
      ${f.type === 'tax'
        ? (fixedTaxTypes().length
            ? html`<label class="field"><span>Tax</span>
                <select id="f-tax-type" class="input">${fixedTaxTypes().map(
                  (x) => html`<option value="${x.id}" ${x.id === f.taxTypeId ? 'selected' : ''}>${x.name}</option>`,
                )}</select></label>`
            : html`<p class="small">Add a fixed tax type first. Percentage taxes follow your income instead.</p>
              <button class="btn" data-a="newTaxType">Add tax type</button>`)
        : html`<label class="field"><span>Category</span>
            <select id="f-cat" class="input">${categoryChoices(f.type, f.categoryId).map(
              (c) => html`<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${c.name}</option>`,
            )}</select>
          </label>`}
      <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" placeholder="Rent" value="${f.note}"></label>
      <div class="two-col">
        <label class="field"><span>Repeats</span>
          <select id="f-freq" class="input">${Object.entries(FREQ_LABEL).map(
            ([v, label]) => html`<option value="${v}" ${v === f.freq ? 'selected' : ''}>${label}</option>`,
          )}</select>
        </label>
        <label class="field"><span>First date</span><input id="f-date" class="input" type="date" value="${f.start}"></label>
      </div>
      <p class="small">${f.type === 'tax'
        ? 'Each one waits in Tax to pay, even with no income. The wallet changes only when you pay it. A first date in the past adds all of them since then.'
        : `A first date in the past adds all the entries since then${f.foreign ? ', each at the official rate for its date when the app has one, otherwise today\'s' : ''}.`}</p>
      ${s.id && html`<button class="btn btn-danger" data-a="deleteRule">Stop repeating</button>
        <p class="small">Entries already added stay in your history.</p>`}
    </div>`;
}

const DATE_FORMATS = { ymd: 'Year-Month-Day', dmy: 'Day-Month-Year', mdy: 'Month-Day-Year' };

// What an import would add, after the choice about anything already in the app.
function importPlan(s) {
  const result = C.liftImportedTaxes(state, C.buildImport(s.rows, s.map, s.fmt, state.categories, state.wallets, s.walletId));
  const repeats = C.findRepeats(state, result);
  return {
    result,
    repeats,
    tx: s.keepRepeats ? result.tx : result.tx.filter((t) => !repeats.entries.has(t.id)),
    openings: [...result.openings].filter(([id]) => s.keepRepeats || !repeats.openings.has(id)),
  };
}

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
  const { result, repeats, tx, openings } = importPlan(s);
  const repeatCount = repeats.entries.size + repeats.openings.size;
  const fits = C.detectDateFormats(s.map.date >= 0 ? s.rows.map((r) => r[s.map.date]) : []);
  const ready = s.map.date >= 0 && s.map.amount >= 0 && (tx.length > 0 || openings.length > 0);
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
  return html`${sheetHead('Import CSV', 'Cancel', ready && 'confirmImport', 'Import')}
    <div class="sheet-body">
      <p class="small">Match your file's columns. ${s.rows.length} rows found.</p>
      ${repeatCount > 0 && html`<div class="card">
        <strong>${repeats.entries.size} of ${result.tx.length} entries are already in the app</strong>
        ${repeats.openings.size > 0 && html`<p class="small">${repeats.openings.size} starting ${repeats.openings.size === 1 ? 'balance is' : 'balances are'} already set too.</p>`}
        <p class="small">Importing them again would count them twice.</p>
        ${seg('importRepeats', s.keepRepeats ? 'keep' : 'skip', [['skip', 'Skip them'], ['keep', 'Import anyway']])}
      </div>`}
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
        <strong>${tx.length || openings.length ? `${tx.length} entries ready` : 'Nothing new to import'}</strong>
        ${skips.length > 0 && html`<p class="small">Skipped: ${skips.join(', ')}.</p>`}
        ${transferNotes.length > 0 && html`<p class="small">Transfers: ${transferNotes.join(', ')}.</p>`}
        ${openings.length > 0 && html`<p class="small">Starting balances set for ${openings.length} ${openings.length === 1 ? 'wallet' : 'wallets'}.</p>`}
        ${visibleNewWallets.length > 0 && html`<p class="small">New wallets: ${visibleNewWallets.map((w) => `${w.name} (${w.currency})`).join(', ')}</p>`}
        ${result.newCategories.length > 0 && html`<p class="small">New categories: ${result.newCategories.map((c) => c.name).join(', ')}</p>`}
        <div class="preview">${tx.filter((t) => t.categoryId).slice(0, 4).map((t) => {
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
  taxes: sheetTaxes,
  taxSummary: sheetTaxSummary,
  tax: sheetTaxItem,
  taxPay: sheetTaxPay,
  taxTypes: sheetTaxTypes,
  taxType: sheetTaxType,
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

// ---------- Navigation ----------

// Going forward saves the current screen, and going back restores it exactly: same list, same scroll
// position, and any half-filled form. Each step is also a browser history entry, so iPhone's
// swipe-back gesture behaves the same as the Back button.
const nav = { stack: [] };

const TAB_LABELS = { home: 'Home', activity: 'Activity', insights: 'Insights', settings: 'Settings' };

function keepFormValues() {
  const type = ui.sheet?.type;
  if (type === 'tx') readTxForm();
  if (type === 'rule') readRuleForm();
  if (type === 'category' || type === 'wallet' || type === 'taxType') readStyleForm();
  if (type === 'taxPay') readPayForm();
  if (type === 'tax') readTaxItemForm();
  if (type === 'reconcile') {
    ui.sheet.date = $('f-date').value;
    ui.sheet.note = $('f-note').value;
  }
}

function pushScreen() {
  keepFormValues();
  nav.stack.push({
    tab: ui.tab,
    sheet: ui.sheet,
    filterCat: ui.filterCat,
    filterWallet: ui.filterWallet,
    search: ui.search,
    scrollY: window.scrollY,
    sheetScroll: $('sheet').scrollTop,
  });
  history.pushState({ depth: nav.stack.length }, '');
}

function restoreScreen({ scrollY, sheetScroll, ...screen }) {
  Object.assign(ui, screen);
  if (ui.filterWallet && !wallet(ui.filterWallet)) ui.filterWallet = '';
  render();
  scrollTo(0, scrollY);
  $('sheet').scrollTop = sheetScroll;
}

function goBack() {
  if (!nav.stack.length) return;
  restoreScreen(nav.stack.pop());
  history.back();
}

// Tabs are top-level places, so choosing one forgets the path taken to get here.
function clearPath() {
  const depth = nav.stack.length;
  nav.stack = [];
  if (depth) history.go(-depth);
}

function openSheet(sheet) {
  pushScreen();
  ui.sheet = sheet;
  render();
  $('sheet').scrollTop = 0;
}

// Opening Activity from another screen, such as a wallet on Home, with a way back to it.
function openActivity(filters) {
  pushScreen();
  Object.assign(ui, { filterCat: '', filterWallet: '', search: '', tab: 'activity' }, filters);
  render();
  scrollTo(0, 0);
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
  // A bad connection must not hold up recurring items, which wait for this.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATES_TIMEOUT_MS);
  try {
    const response = await fetch(RATES_URL, { signal: controller.signal });
    const data = await response.json();
    if (data.result !== 'success' || !C.applyLiveRates(state, data.rates, new Date().toISOString())) return false;
  } catch {
    return false; // Offline: the last saved rates keep working.
  } finally {
    clearTimeout(timer);
  }
  save();
  // Redrawing an open form would throw away what is being typed.
  if (!ui.sheet) render();
  return true;
}

// The currencies worth keeping an official rate for.
function rateCodes() {
  return [...new Set([
    ...COMMON_CURRENCIES,
    state.currency,
    ...state.wallets.map((w) => w.currency),
    ...state.taxTypes.map((x) => x.currency),
    ...state.recurring.map((r) => r.foreignCurrency).filter(Boolean),
  ])];
}

async function fetchOfficialRates(date) {
  if (date > today() || state.nbu[date]) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATES_TIMEOUT_MS);
  try {
    const response = await fetch(C.nbuUrl(date), { signal: controller.signal });
    const rows = await response.json();
    return Array.isArray(rows) && C.applyNbuRates(state, date, rows, rateCodes());
  } catch {
    return false; // Offline: the date stays pending and is tried again later.
  } finally {
    clearTimeout(timer);
  }
}

// Fills in every date still waiting for an official rate. Today's is kept ready for paying a tax.
async function refreshOfficialRates() {
  if (state.taxes.length) C.needRate(state, today());
  let changed = false;
  for (const date of [...state.pendingRates]) {
    if (date > today()) continue;
    if (!(await fetchOfficialRates(date))) break;
    changed = true;
  }
  if (!changed) return;
  save();
  if (!ui.sheet) render();
}

// Rates come first so that recurring items priced in another currency use today's rate.
async function catchUp({ quiet = false } = {}) {
  await refreshRates();
  const added = runRecurring();
  await refreshOfficialRates();
  if (!added) return;
  // Redrawing an open form would throw away what is being typed. It shows at the next redraw.
  if (!ui.sheet) render();
  if (!quiet) toast(`Added ${added} recurring ${added === 1 ? 'entry' : 'entries'}.`);
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
  save();
  ui.filterCat = '';
  ui.filterWallet = '';
  render();
  toast(`Restored ${next.tx.length} entries.`, before);
  catchUp({ quiet: true });
}

// ---------- Actions ----------

function readTxForm() {
  const f = ui.sheet.form;
  if ($('f-amount')) f.amount = $('f-amount').value;
  f.walletId = $('f-wallet').value;
  if ($('f-income')) f.incomeId = $('f-income').value;
  if ($('f-tax-rate')) f.taxRate = $('f-tax-rate').value;
  document.querySelectorAll('[data-tax-on]').forEach((box) => {
    const id = box.dataset.taxOn;
    f.taxes = { ...f.taxes, [id]: { on: box.checked, rate: document.querySelector(`[data-tax-rate="${id}"]`).value } };
  });
  f.date = $('f-date').value;
  f.note = $('f-note').value;
  if ($('f-to')) f.toWalletId = $('f-to').value;
  if ($('f-to-amount')) f.toAmount = $('f-to-amount').value;
  if ($('f-foreign')) f.foreign = $('f-foreign').value;
  if ($('f-charged')) f.charged = $('f-charged').value;
}

// Fills in the wallet amount for a foreign price from the rate, until the user types their own number.
function fillCharged(f) {
  if (f.chargedEdited || !f.foreign) return;
  const rate = C.crossRate(state, f.foreign, wallet(f.walletId).currency);
  const cents = Math.abs(C.parseAmount(f.amount) ?? 0);
  f.charged = rate && cents ? C.centsToInput(Math.round(cents * rate)) : '';
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
  if ($('f-cat')) f.categoryId = $('f-cat').value;
  if ($('f-tax-type')) f.taxTypeId = $('f-tax-type').value;
  f.note = $('f-note').value;
  f.freq = $('f-freq').value;
  f.start = $('f-date').value;
  f.foreign = $('f-foreign').value;
  if ($('f-rate')) f.rate = $('f-rate').value;
}

// Keeps what has been typed when a tap redraws the category or wallet form.
function readStyleForm() {
  const f = ui.sheet.form;
  f.name = $('f-name').value;
  if ($('f-limit')) f.limit = $('f-limit').value;
  if ($('f-currency')) f.currency = $('f-currency').value;
  if ($('f-opening')) f.opening = $('f-opening').value;
  if ($('f-type-rate')) f.rate = $('f-type-rate').value;
  document.querySelectorAll('[data-tax-wallet]').forEach((box) => {
    const others = f.walletIds.filter((id) => id !== box.dataset.taxWallet);
    f.walletIds = box.checked ? [...others, box.dataset.taxWallet] : others;
  });
}

function readPayForm() {
  const s = ui.sheet;
  const f = s.form;
  f.amount = $('f-pay-amount').value;
  if ($('f-pay-percent')) f.percent = $('f-pay-percent').value;
  f.walletId = $('f-wallet').value;
  f.date = $('f-date').value;
  f.note = $('f-note').value;
  const rateInput = $('f-pay-rate');
  if (rateInput) {
    f.rate = rateInput.value;
    const rate = C.parseRate(f.rate);
    f.fx = rate ? (f.rateFrom === wallet(f.walletId).currency ? rate : 1 / rate) : null;
  }
}

function readTaxItemForm() {
  const f = ui.sheet.form;
  if ($('f-item-rate')) f.rate = $('f-item-rate').value;
  if ($('f-item-fx')) f.fx = $('f-item-fx').value;
  if ($('f-item-due')) f.due = $('f-item-due').value;
  if ($('f-date')) f.date = $('f-date').value;
  f.note = $('f-note').value;
}

function saveTaxEntry() {
  const s = ui.sheet;
  const f = s.form;
  const type = taxType(f.taxTypeId);
  const income = type?.mode === 'percent' && f.incomeId ? state.tx.find((t) => t.id === f.incomeId) : null;
  const rate = C.parseRate(f.taxRate);
  const entered = Math.abs(C.parseAmount(f.amount) ?? 0);
  const walletCurrency = wallet(f.walletId).currency;
  const foreign = f.foreign && f.foreign !== walletCurrency ? f.foreign : null;
  const charged = foreign ? Math.abs(C.parseAmount(f.charged) ?? 0) : entered;
  if (!type) s.error = 'Pick a tax.';
  else if (income && !rate) s.error = 'Enter the percent.';
  else if (!income && !entered) s.error = 'Enter an amount.';
  else if (!income && f.taxStatus === 'paid' && !charged) s.error = `Enter the amount in ${walletCurrency}.`;
  else if (!f.date) s.error = 'Pick a date.';
  else s.error = null;
  if (s.error) {
    render();
    return;
  }
  const before = snapshot();
  if (income) {
    const tax = C.addIncomeTax(state, income, type.id, rate);
    tax.note = f.note.trim();
    save();
    refreshOfficialRates();
    if (f.taxStatus === 'paid') {
      // Same place in the history as this form, so Cancel returns to where the form was opened from.
      ui.sheet = paySheet(tax);
      render();
      $('sheet').scrollTop = 0;
      return;
    }
    goBack();
    toast(`Added ${money(tax.dueAmount, tax.currency)} to Tax to pay.`, before);
    return;
  }
  const tax = {
    id: C.uid(),
    taxTypeId: type.id,
    date: f.date,
    dueAmount: entered,
    currency: foreign || walletCurrency,
    walletId: f.walletId,
    note: f.note.trim(),
  };
  state.taxes.push(tax);
  if (f.taxStatus === 'paid') {
    C.addTaxPayment(state, tax, { walletId: f.walletId, amount: charged, taxAmount: entered, date: f.date, note: f.note.trim() });
  }
  state.lastWalletId = f.walletId;
  if (walletCurrency !== state.currency) C.needRate(state, f.date);
  save();
  refreshOfficialRates();
  ui.month = C.monthOf(f.date);
  goBack();
  toast(f.taxStatus === 'paid' ? `Paid ${money(charged, walletCurrency)}.` : `Added ${money(entered, tax.currency)} to Tax to pay.`, before);
}

const openCategoryList = (kind = 'expense') => openSheet({ type: 'categories', kind });

function openTxForm(type) {
  const walletId = defaultWalletId();
  openSheet({
    type: 'tx',
    form: { type, amount: '', walletId, toWalletId: otherWallet(walletId), toAmount: '', toEdited: false, foreign: '', charged: '', chargedEdited: false, categoryId: null, date: today(), note: '', taxStatus: 'due', taxTypeId: null, incomeId: '', taxRate: '' },
  });
  $('f-amount')?.focus();
}

const actions = {
  setTheme({ v }) {
    try {
      if (v === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, v);
    } catch {
      // Storage is blocked: the theme still applies until the app closes.
    }
    applyTheme(v);
    render();
  },
  tab({ tab }) {
    if (nav.stack.length) Object.assign(ui, { filterCat: '', filterWallet: '', search: '' });
    clearPath();
    ui.tab = tab;
    ui.sheet = null;
    render();
    scrollTo(0, 0);
  },
  seeAll() {
    openActivity({});
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
    openActivity({ filterCat: id });
  },
  toggleEmptyWallets() {
    ui.showEmptyWallets = !ui.showEmptyWallets;
    render();
  },
  openWallet({ id }) {
    openActivity({ filterWallet: id });
  },
  back() {
    goBack();
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
    if (!t) return;
    openSheet({
      type: 'tx',
      id,
      form: {
        type: t.type,
        amount: C.centsToInput(t.foreignCurrency ? t.foreignAmount : t.amount),
        foreign: t.foreignCurrency || '',
        charged: t.foreignCurrency ? C.centsToInput(t.amount) : '',
        chargedEdited: Boolean(t.foreignCurrency),
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
    if (v === 'tax') {
      f.taxTypeId = f.taxTypeId || activeTaxTypes()[0]?.id || null;
      f.taxRate = String(taxType(f.taxTypeId)?.rate ?? '');
      fillCharged(f);
    } else if (v === 'transfer') {
      f.foreign = '';
      fillReceived(f);
    } else {
      fillCharged(f);
    }
    render();
  },
  showAllCategories() {
    readTxForm();
    ui.sheet.allCategories = true;
    render();
  },
  txTaxType({ id }) {
    readTxForm();
    const f = ui.sheet.form;
    f.taxTypeId = id;
    f.incomeId = '';
    f.taxRate = String(taxType(id).rate ?? '');
    render();
  },
  taxStatus({ v }) {
    readTxForm();
    ui.sheet.form.taxStatus = v;
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
    if (f.type === 'tax') {
      saveTaxEntry();
      return;
    }
    const entered = Math.abs(C.parseAmount(f.amount) ?? 0);
    const isTransfer = f.type === 'transfer';
    const foreign = !isTransfer && f.foreign && f.foreign !== wallet(f.walletId).currency ? f.foreign : null;
    const amount = foreign ? Math.abs(C.parseAmount(f.charged) ?? 0) : entered;
    const to = isTransfer ? wallet(f.toWalletId) : null;
    const sameCurrency = to?.currency === wallet(f.walletId).currency;
    const toAmount = sameCurrency ? amount : Math.abs(C.parseAmount(f.toAmount) ?? 0);

    if (!entered) s.error = 'Enter an amount.';
    else if (!amount) s.error = `Enter the amount in ${wallet(f.walletId).currency}.`;
    else if (isTransfer && !to) s.error = 'Add a second wallet first.';
    else if (isTransfer && f.toWalletId === f.walletId) s.error = 'Pick two different wallets.';
    else if (isTransfer && !toAmount) s.error = 'Enter the amount received.';
    else if (!isTransfer && !f.categoryId) s.error = 'Pick a category.';
    else if (!f.date) s.error = 'Pick a date.';
    else s.error = null;
    const taxRows = f.type === 'income' ? incomeTaxRows(s) : [];
    const badTax = taxRows.find((x) => x.on && !C.parseRate(x.rate));
    if (!s.error && badTax) s.error = `Enter the percent for ${badTax.type.name}.`;
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
      ...(foreign && { foreignAmount: entered, foreignCurrency: foreign }),
      walletId: f.walletId,
      note: f.note.trim(),
      ...(isTransfer
        ? { toWalletId: f.toWalletId, toAmount }
        : { categoryId: f.categoryId, ...(existing?.recurringId && { recurringId: existing.recurringId }) }),
    };
    if (existing) state.tx[state.tx.indexOf(existing)] = entry;
    else state.tx.push(entry);
    const taxesBefore = state.taxes.length;
    if (f.type === 'income') {
      C.syncIncomeTaxes(state, entry, Object.fromEntries(taxRows.map((x) => [x.type.id, x.on ? C.parseRate(x.rate) : null])));
    } else if (existing?.type === 'income') {
      C.detachIncomeTaxes(state, entry.id, false);
    }
    if (!isTransfer && wallet(f.walletId).currency !== state.currency) C.needRate(state, f.date);
    state.lastWalletId = f.walletId;
    save();
    refreshOfficialRates();
    ui.month = C.monthOf(f.date);
    goBack();
    const shown = money(amount, wallet(f.walletId).currency);
    const later = f.date > today() ? ` Your balance changes on ${shortDate(f.date)}.` : '';
    const added = state.taxes.length - taxesBefore;
    const taxNote = added > 0 ? ` ${added} ${added === 1 ? 'tax' : 'taxes'} added to Tax to pay.` : '';
    if (s.id) toast(`Entry updated.${taxNote}${later}`);
    else toast(`${isTransfer ? `Moved ${shown} to ${to.name}.` : `Added ${shown}.`}${taxNote}${later}`);
  },
  deleteTx() {
    if (state.taxes.some((x) => x.incomeId === ui.sheet.id)) {
      readTxForm();
      ui.sheet.confirmDelete = true;
      render();
      return;
    }
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.id !== ui.sheet.id);
    save();
    goBack();
    toast('Entry deleted.', before);
  },
  cancelDelete() {
    readTxForm();
    ui.sheet.confirmDelete = false;
    render();
  },
  deleteIncome({ keep }) {
    const before = snapshot();
    C.detachIncomeTaxes(state, ui.sheet.id, Boolean(keep));
    state.tx = state.tx.filter((t) => t.id !== ui.sheet.id);
    save();
    goBack();
    toast('Income deleted.', before);
  },

  // Tax
  dismissUpgrade() {
    delete state.upgradeNotice;
    save();
    render();
  },
  async saveBeforeTaxCopy() {
    await deliverFile(`budget-before-tax-update-${today()}.json`, 'application/json', localStorage.getItem(BEFORE_TAX_KEY));
  },
  openTaxes() {
    openSheet({ type: 'taxes' });
  },
  newTaxEntry() {
    openTxForm('expense');
    actions.txType({ v: 'tax' });
  },
  openTax({ id }) {
    const tax = taxItem(id);
    openSheet({
      type: 'tax',
      id,
      form: {
        rate: String(tax.rate ?? ''),
        fx: tax.fx ? formatRate(tax.fx) : '',
        due: C.centsToInput(tax.dueAmount),
        date: tax.date,
        note: tax.note || '',
      },
    });
  },
  saveTaxItem() {
    readTaxItemForm();
    const s = ui.sheet;
    const f = s.form;
    const tax = taxItem(s.id);
    const rate = C.parseRate(f.rate);
    const fx = C.parseRate(f.fx);
    const due = Math.abs(C.parseAmount(f.due) ?? 0);
    if (tax.base && !rate) s.error = 'Enter the percent.';
    else if (tax.base && tax.baseCurrency !== tax.currency && !fx) s.error = 'Enter the exchange rate.';
    else if (!tax.base && !due) s.error = 'Enter what should be paid.';
    else if (!f.date) s.error = 'Pick a date.';
    else s.error = null;
    if (s.error) {
      render();
      return;
    }
    tax.note = f.note.trim();
    if (!tax.incomeId) tax.date = f.date;
    if (tax.base) {
      tax.rate = rate;
      // Only a rate that was really changed counts as typed by hand.
      if (fx && tax.baseCurrency !== tax.currency && f.fx !== formatRate(tax.fx)) {
        tax.fx = fx;
        tax.fxSource = 'manual';
      }
      C.setIncomeTaxDue(state, tax);
    } else {
      tax.dueAmount = due;
    }
    save();
    goBack();
  },
  deleteTaxItem() {
    const id = ui.sheet.id;
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.taxId !== id);
    state.taxes = state.taxes.filter((x) => x.id !== id);
    save();
    goBack();
    toast('Tax deleted.', before);
  },
  payTax({ id }) {
    openSheet(paySheet(taxItem(id)));
    $('f-pay-amount').focus();
  },
  editPayment({ id }) {
    const payment = state.tx.find((t) => t.id === id);
    openSheet(paySheet(taxItem(payment.taxId), payment));
  },
  savePayment() {
    readPayForm();
    const s = ui.sheet;
    const f = s.form;
    const tax = taxItem(s.taxId);
    const amount = Math.abs(C.parseAmount(f.amount) ?? 0);
    if (!amount) s.error = 'Enter what you paid.';
    else if (!f.fx) s.error = 'Enter the exchange rate.';
    else if (!f.date) s.error = 'Pick a date.';
    else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const before = snapshot();
    const details = { walletId: f.walletId, amount, taxAmount: Math.round(amount * f.fx), date: f.date, note: f.note.trim() };
    if (s.id) state.tx = state.tx.filter((t) => t.id !== s.id);
    const payment = C.addTaxPayment(state, tax, details);
    if (s.id) payment.id = s.id;
    if (wallet(f.walletId).currency !== state.currency) C.needRate(state, f.date);
    state.lastWalletId = f.walletId;
    save();
    refreshOfficialRates();
    goBack();
    const later = f.date > today() ? ` Your balance changes on ${shortDate(f.date)}.` : '';
    toast(`${s.id ? 'Payment updated' : `Paid ${money(amount, wallet(f.walletId).currency)}`}.${later}`, before);
  },
  deletePayment() {
    const id = ui.sheet.id;
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.id !== id);
    save();
    goBack();
    toast('Payment deleted. The money is back in the wallet.', before);
  },
  payAll() {
    const count = C.unpaidTaxes(state).length;
    if (!confirm(`Pay all ${count} taxes today? Each pays what's left from its usual wallet, at today's rate.`)) return;
    const before = snapshot();
    const paid = C.payAllTaxes(state, today(), payerWallet);
    save();
    render();
    toast(`Paid ${paid} ${paid === 1 ? 'tax' : 'taxes'}.`, before);
  },
  openTaxTypes() {
    openSheet({ type: 'taxTypes' });
  },
  openTaxSummary() {
    // Tax is usually filed in the currency it's worked out in, so that comes first.
    const percent = activeTaxTypes().find((x) => x.mode === 'percent');
    openSheet({
      type: 'taxSummary',
      year: Number(today().slice(0, 4)),
      currency: percent?.currency ?? state.currency,
      scope: taxedWalletIds().length ? 'taxed' : 'all',
    });
  },
  summaryYear({ v }) {
    ui.sheet.year = Number(v);
    render();
  },
  summaryScope({ v }) {
    ui.sheet.scope = v;
    render();
  },
  async exportTaxSummary() {
    const s = ui.sheet;
    await deliverFile(`tax-summary-${s.year}-${s.currency}.csv`, 'text/csv', C.yearSummaryCSV(state, currentSummary(s)));
  },
  newTaxType() {
    openSheet({
      type: 'taxType',
      form: { icon: 'badge-percent', color: C.nextColor(state.taxTypes), name: '', mode: 'percent', rate: '', currency: state.currency, walletIds: [], archived: false },
    });
  },
  editTaxType({ id }) {
    const x = taxType(id);
    openSheet({
      type: 'taxType',
      id,
      form: { icon: x.icon, color: x.color, name: x.name, mode: x.mode, rate: x.rate ? String(x.rate) : '', currency: x.currency, walletIds: [...x.walletIds], archived: x.archived },
    });
  },
  taxMode({ v }) {
    readStyleForm();
    ui.sheet.form.mode = v;
    render();
  },
  saveTaxType() {
    readStyleForm();
    const s = ui.sheet;
    const f = s.form;
    const name = f.name.trim();
    const rate = f.mode === 'percent' ? C.parseRate(f.rate) : null;
    if (!name) s.error = 'Enter a name.';
    else if (f.mode === 'percent' && !rate) s.error = 'Enter the percent.';
    else if (state.taxTypes.some((x) => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase())) {
      s.error = 'A tax type with this name already exists.';
    } else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = { name, icon: f.icon, color: f.color, mode: f.mode, rate, currency: f.currency, walletIds: f.mode === 'percent' ? f.walletIds : [], archived: f.archived };
    if (s.id) Object.assign(taxType(s.id), data);
    else state.taxTypes.push({ id: C.uid(), ...data });
    save();
    goBack();
  },
  toggleTaxTypeHidden() {
    const x = taxType(ui.sheet.id);
    x.archived = !x.archived;
    save();
    goBack();
  },
  deleteTaxType() {
    const before = snapshot();
    state.taxTypes = state.taxTypes.filter((x) => x.id !== ui.sheet.id);
    save();
    goBack();
    toast('Tax type deleted.', before);
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
    ui.sheet.kind = v;
    render();
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
    goBack();
  },
  toggleArchive() {
    const s = ui.sheet;
    const c = category(s.id);
    c.archived = !c.archived;
    save();
    goBack();
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
    goBack();
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
    save();
    goBack();
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
    for (const x of state.taxTypes) x.walletIds = x.walletIds.filter((id) => id !== s.id);
    save();
    goBack();
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
    if (!s.error && s.date > today()) s.error = "A correction fixes today's balance, so it can't have a future date.";
    const before = snapshot();
    const added = s.error ? [] : C.correctBalances(state, actuals, s.date, s.note.trim(), today());
    if (!s.error && !added.length) s.error = 'Type a real balance that differs from the app.';
    if (s.error) {
      render();
      return;
    }
    save();
    goBack();
    toast(`Corrected ${added.length} ${added.length === 1 ? 'wallet' : 'wallets'}.`, before);
  },
  openCorrections() {
    openSheet({ type: 'corrections' });
  },
  editCorrection({ id }) {
    const t = state.tx.find((x) => x.id === id);
    openSheet({ type: 'correction', id, date: t.date, note: t.note || '' });
  },
  saveCorrection() {
    const s = ui.sheet;
    const date = $('f-date').value;
    if (!date || date > today()) {
      s.note = $('f-note').value;
      s.error = date ? "A correction can't have a future date." : 'Pick a date.';
      render();
      return;
    }
    Object.assign(state.tx.find((t) => t.id === s.id), { date, note: $('f-note').value.trim() });
    save();
    goBack();
  },
  deleteCorrection() {
    const s = ui.sheet;
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.id !== s.id);
    save();
    goBack();
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
        foreign: '',
        rateMode: 'current',
        rate: '',
        categoryId: activeCategories('expense')[0]?.id,
        taxTypeId: fixedTaxTypes()[0]?.id,
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
      form: {
        foreign: r.foreignCurrency || '',
        rateMode: r.fixedRate ? 'fixed' : 'current',
        rate: r.fixedRate ? formatRate(r.fixedRate) : '',
        type: r.type, walletId: r.walletId, amount: C.centsToInput(r.foreignCurrency ? r.foreignAmount : r.amount), categoryId: r.categoryId, taxTypeId: r.taxTypeId ?? fixedTaxTypes()[0]?.id, note: r.note, freq: r.freq, start: r.start,
      },
    });
  },
  ruleRateMode({ v }) {
    readRuleForm();
    const f = ui.sheet.form;
    f.rateMode = v;
    const current = f.foreign && C.crossRate(state, f.foreign, wallet(f.walletId).currency);
    if (v === 'fixed' && !f.rate && current) f.rate = formatRate(current);
    render();
  },
  ruleType({ v }) {
    readRuleForm();
    const f = ui.sheet.form;
    if (f.type !== v && v !== 'tax') f.categoryId = activeCategories(v)[0]?.id;
    f.type = v;
    render();
  },
  saveRule() {
    readRuleForm();
    const s = ui.sheet;
    const f = s.form;
    const entered = Math.abs(C.parseAmount(f.amount) ?? 0);
    const walletCurrency = wallet(f.walletId).currency;
    const foreign = f.foreign && f.foreign !== walletCurrency ? f.foreign : null;
    const fixedRate = foreign && f.rateMode === 'fixed' ? C.parseRate(f.rate) : null;
    const rate = foreign ? fixedRate || (f.rateMode === 'current' && C.crossRate(state, foreign, walletCurrency)) : 1;
    if (!entered) s.error = 'Enter an amount.';
    else if (foreign && f.rateMode === 'fixed' && !fixedRate) s.error = 'Enter your exchange rate.';
    else if (!rate) s.error = `No exchange rate saved for ${foreign}. Choose My rate and enter one.`;
    else if (f.type === 'tax' && !taxType(f.taxTypeId)) s.error = 'Pick a tax.';
    else if (f.type !== 'tax' && !f.categoryId) s.error = 'Pick a category.';
    else if (!f.start) s.error = 'Pick a first date.';
    else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = {
      type: f.type,
      walletId: f.walletId,
      amount: foreign ? Math.max(1, Math.round(entered * rate)) : entered,
      foreignAmount: foreign ? entered : undefined,
      foreignCurrency: foreign || undefined,
      fixedRate: fixedRate || undefined,
      categoryId: f.type === 'tax' ? undefined : f.categoryId,
      taxTypeId: f.type === 'tax' ? f.taxTypeId : undefined,
      note: f.note.trim(),
      freq: f.freq,
      start: f.start,
    };
    if (s.id) Object.assign(state.recurring.find((r) => r.id === s.id), data);
    else state.recurring.push({ id: C.uid(), lastRun: null, ...data });
    const added = runRecurring();
    save();
    goBack();
    if (added) toast(`Added ${added} ${added === 1 ? 'entry' : 'entries'} that came due.`);
  },
  deleteRule() {
    const before = snapshot();
    state.recurring = state.recurring.filter((r) => r.id !== ui.sheet.id);
    save();
    goBack();
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
  importRepeats({ v }) {
    ui.sheet.keepRepeats = v === 'keep';
    render();
  },
  confirmImport() {
    const s = ui.sheet;
    const before = snapshot();
    const { result: { newCategories, newWallets, newTaxTypes, taxes }, tx, openings } = importPlan(s);
    const kept = new Set(tx.map((t) => t.taxId));
    state.categories.push(...newCategories);
    state.taxTypes.push(...newTaxTypes);
    state.taxes.push(...taxes.filter((x) => kept.has(x.id)));
    state.wallets.push(...newWallets);
    state.tx.push(...tx);
    for (const [id, cents] of openings) wallet(id).opening += cents;
    // Entries most likely belong in the busiest imported wallet from now on.
    if (newWallets[0] && !newWallets[0].archived) state.lastWalletId = newWallets[0].id;
    save();
    clearPath();
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
    // A form for something the undo may have removed can't stay open.
    if (ui.sheet?.id) goBack();
    else render();
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
    if (f.foreign === wallet(f.walletId).currency) f.foreign = '';
    f.chargedEdited = false;
    fillCharged(f);
    render();
  },
  summaryCurrency(el) {
    ui.sheet.currency = el.value;
    render();
  },
  payForm() {
    readPayForm();
    const s = ui.sheet;
    const f = s.form;
    const tax = taxItem(s.taxId);
    const walletCurrency = wallet(f.walletId).currency;
    const redo = () => {
      if (!f.fxEdited) setFormFx(f, taxPayFx(tax, f.walletId, f.date), walletCurrency, tax.currency);
      if (!f.amountEdited && f.fx) f.amount = C.centsToInput(Math.round(C.taxStatus(state, tax).remaining / f.fx));
      const pct = percentOfTax(tax, Math.abs(C.parseAmount(f.amount) ?? 0), f.fx);
      f.percent = pct === null ? '' : pct.toFixed(2);
      render();
    };
    redo();
    // Rates for a date not seen yet arrive a moment later. An open form only updates if it's still this one.
    fetchOfficialRates(f.date).then((changed) => {
      if (!changed) return;
      save();
      if (ui.sheet === s) {
        readPayForm();
        redo();
      }
    });
  },
  ruleForm() {
    readRuleForm();
    const f = ui.sheet.form;
    if (f.foreign === wallet(f.walletId).currency) f.foreign = '';
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

// Swipe-back and the browser's own back button. Going back here has often already been drawn by
// goBack, which leaves nothing to do. Forward history has no saved screen, so it's sent straight back.
window.addEventListener('popstate', (e) => {
  const depth = e.state?.depth ?? 0;
  if (depth > nav.stack.length) {
    history.go(nav.stack.length - depth);
    return;
  }
  if (depth === nav.stack.length) return;
  let screen;
  while (nav.stack.length > depth) screen = nav.stack.pop();
  restoreScreen(screen);
});
history.replaceState({ depth: 0 }, '');

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
      reconcileDifference(wallet(reconcileId), balancesNow().get(reconcileId), e.target.value);
    $('reconcile-summary').textContent = reconcileSummary(ui.sheet);
    return;
  }
  const form = ui.sheet?.form;
  if (ui.sheet?.type === 'taxPay' && e.target.id?.startsWith('f-pay-')) {
    const tax = taxItem(ui.sheet.taxId);
    readPayForm();
    if (e.target.id === 'f-pay-rate') form.fxEdited = true;
    if (e.target.id !== 'f-pay-rate') form.amountEdited = true;
    if (e.target.id === 'f-pay-percent') {
      const pct = C.parseRate(form.percent);
      if (pct && form.fx) {
        form.amount = C.centsToInput(Math.round(((tax.base * tax.fx * pct) / 100) / form.fx));
        $('f-pay-amount').value = form.amount;
      }
    } else if ($('f-pay-percent')) {
      const pct = percentOfTax(tax, Math.abs(C.parseAmount(form.amount) ?? 0), form.fx);
      form.percent = pct === null ? '' : pct.toFixed(2);
      $('f-pay-percent').value = form.percent;
    }
    $('pay-summary').textContent = paySummary(ui.sheet);
    return;
  }
  if (e.target.dataset?.taxRate || e.target.id === 'f-amount' || e.target.id === 'f-charged') {
    if (form && ui.sheet.type === 'tx' && form.type === 'income') {
      if ($('f-amount')) form.amount = $('f-amount').value;
      if ($('f-charged')) form.charged = $('f-charged').value;
      queueMicrotask(() => document.querySelectorAll('[data-tax-rate]').forEach((input) => {
        document.querySelector(`[data-tax-amount="${input.dataset.taxRate}"]`).textContent = taxPreview(form, input.value);
      }));
    }
  }
  if (form && e.target.id === 'f-to-amount') form.toEdited = true;
  if (form && e.target.id === 'f-charged') form.chargedEdited = true;
  if (form && e.target.id === 'f-amount' && $('f-charged')) {
    form.amount = e.target.value;
    fillCharged(form);
    if (!form.chargedEdited) $('f-charged').value = form.charged;
  }
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
  if (document.visibilityState === 'visible') catchUp();
});

applyTheme(readTheme());
render();
catchUp();

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
