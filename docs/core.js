// Pure logic with no DOM access, so it can be unit tested in Node.
// Amounts are always integer minor units (cents) to avoid float rounding.

export const uid = () =>
  Date.now().toString(36).padStart(9, '0') + Math.random().toString(36).slice(2, 8);

export const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const monthOf = (iso) => iso.slice(0, 7);
export const addMonths = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// ---------- Default data ----------

// Colors are stored by name so each can have its own light and dark shade (see styles.css).
export const COLOR_KEYS = [
  'blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'sky', 'lime', 'plum', 'brown',
  'navy', 'peach', 'teal', 'rose', 'gray',
];

// The color used least so far, so new items look different from existing ones.
// Gray is left out because it reads as "other", not as a color of its own.
export function nextColor(items) {
  const uses = (key) => items.filter((item) => item.color === key).length;
  return COLOR_KEYS.filter((key) => key !== 'gray').reduce((best, key) => (uses(key) < uses(best) ? key : best));
}

const DEFAULT_CATEGORIES = [
  ['Groceries', 'shopping-cart', 'green', 'expense', '🛒'],
  ['Eating out', 'utensils', 'orange', 'expense', '🍽️'],
  ['Transport', 'bus', 'blue', 'expense', '🚌'],
  ['Housing', 'house', 'violet', 'expense', '🏠'],
  ['Utilities', 'lightbulb', 'yellow', 'expense', '💡'],
  ['Health', 'pill', 'red', 'expense', '💊'],
  ['Shopping', 'shopping-bag', 'magenta', 'expense', '🛍️'],
  ['Entertainment', 'clapperboard', 'sky', 'expense', '🎬'],
  ['Subscriptions', 'repeat', 'plum', 'expense', '🔁'],
  ['Other', 'package', 'gray', 'expense', '📦'],
  ['Salary', 'briefcase', 'green', 'income', '💼'],
  ['Freelance', 'receipt', 'blue', 'income', '🧾'],
  ['Other income', 'coins', 'yellow', 'income', '💰'],
  // Added in version 3. Appended so the ids of the categories above never change.
  ['Taxi', 'car-taxi-front', 'yellow', 'expense'],
  ['Phone & internet', 'smartphone', 'teal', 'expense'],
  ['Clothes', 'shirt', 'lime', 'expense'],
  ['Personal care', 'spray-can', 'peach', 'expense'],
  ['Electronics', 'laptop', 'navy', 'expense'],
  ['Games', 'gamepad-2', 'lime', 'expense'],
  ['Books', 'book-open', 'brown', 'expense'],
  ['Sports', 'dumbbell', 'aqua', 'expense'],
  ['Education', 'graduation-cap', 'navy', 'expense'],
  ['Travel', 'plane', 'aqua', 'expense'],
  ['Gifts', 'gift', 'red', 'expense'],
  ['Donations', 'hand-heart', 'rose', 'expense'],
  ['Pets', 'paw-print', 'brown', 'expense'],
  ['Car', 'car', 'blue', 'expense'],
  ['Taxes', 'badge-percent', 'gray', 'expense'],
  ['Business', 'briefcase', 'violet', 'expense'],
  ['Loans', 'hand-coins', 'orange', 'expense'],
  ['Business', 'store', 'violet', 'income'],
  ['Deposits', 'landmark', 'aqua', 'income'],
  ['Savings', 'piggy-bank', 'magenta', 'income'],
  ['Gifts', 'gift', 'red', 'income'],
  ['Loans', 'hand-coins', 'orange', 'income'],
  // Added in version 4.
  ['Fees', 'receipt', 'brown', 'expense'],
  ['Tax refund', 'badge-percent', 'teal', 'income'],
];

const defaultCategory = ([name, icon, color, kind], i) => ({
  id: `c${i}`,
  name,
  icon,
  color,
  kind,
  limit: null,
  // Tax has its own type of entry now. The category stays so older files can still be read.
  archived: name === 'Taxes',
});

// Ready-made starting points on the new wallet form.
export const WALLET_PRESETS = [
  ['Cash', 'banknote', 'green'],
  ['Card', 'credit-card', 'blue'],
  ['Savings', 'piggy-bank', 'magenta'],
  ['Deposit', 'landmark', 'teal'],
  ['Bonds', 'file-text', 'lime'],
  ['Investments', 'trending-up', 'violet'],
  ['Business', 'briefcase', 'navy'],
  ['Lent out', 'hand-coins', 'orange'],
];

export function defaultState(nowISO) {
  return {
    app: 'budget',
    version: 4,
    // The currency totals, charts and budget limits are shown in.
    currency: 'USD',
    // How much 1 unit of each other currency is worth in `currency`.
    rates: {},
    ratesUpdated: null,
    autoRates: true,
    createdAt: nowISO,
    lastBackup: null,
    lastWalletId: 'w0',
    wallets: [{ id: 'w0', name: 'Main', icon: 'wallet', color: 'blue', currency: 'USD', opening: 0, archived: false }],
    categories: DEFAULT_CATEGORIES.map(defaultCategory),
    tx: [],
    recurring: [],
    taxTypes: [],
    // What should be paid. The money paid is in `tx`, as entries of type `tax` that point to one of these.
    taxes: [],
    // Official NBU rates by date: units of UAH for 1 unit of each currency.
    nbu: {},
    // Dates that still need an NBU rate, because the app was offline or the date hasn't come yet.
    pendingRates: [],
  };
}

// Version 1 had a single currency, no wallets, and emoji for icons. Everything moves into one wallet
// in that currency. Default categories get their matching icon, and any others a generic one.
function migrateV1(o) {
  const wallet = { id: 'w0', name: 'Main', icon: 'wallet', color: 'blue', currency: o.currency, opening: 0, archived: false };
  const categories = [];
  for (const c of o.categories) {
    const match = DEFAULT_CATEGORIES.find((d) => d[4] === c.icon);
    categories.push({
      ...c,
      icon: match ? match[1] : 'tag',
      color: match ? match[2] : nextColor(categories),
    });
  }
  return {
    ...o,
    version: 2,
    rates: {},
    ratesUpdated: null,
    autoRates: true,
    lastWalletId: wallet.id,
    wallets: [wallet],
    categories,
    tx: o.tx.map((t) => ({ ...t, walletId: wallet.id })),
    recurring: o.recurring.map((r) => ({ ...r, walletId: wallet.id })),
  };
}

// Version 3 added more default categories. A category with the same name is left alone, including
// a hidden one, so nothing the user renamed or hid comes back.
function migrateV2(o) {
  const taken = new Set(o.categories.map((c) => `${c.kind}:${c.name.toLowerCase()}`));
  const ids = new Set(o.categories.map((c) => c.id));
  const added = DEFAULT_CATEGORIES.map(defaultCategory).filter(
    (c) => !taken.has(`${c.kind}:${c.name.toLowerCase()}`) && !ids.has(c.id),
  );
  return { ...o, version: 3, categories: [...o.categories, ...added] };
}

const isTaxesCategory = (c) => c.kind === 'expense' && c.name.toLowerCase() === 'taxes';
const FEE_NOTE = /\bfees?\b|комісі/i;

// Taxes these notes usually mean, so an upgrade or import starts with sensible settings.
const KNOWN_TAX_TYPES = new Map([
  ['єсв', { icon: 'landmark', mode: 'fixed', rate: null }],
  ['єп', { icon: 'badge-percent', mode: 'percent', rate: 5 }],
  ['військовий збір', { icon: 'hand-coins', mode: 'percent', rate: 1 }],
]);

function taxTypeNamed(data, name, walletId) {
  const found = data.taxTypes.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (found) return found;
  const known = KNOWN_TAX_TYPES.get(name.toLowerCase());
  const walletCurrency = data.wallets.find((w) => w.id === walletId)?.currency;
  const type = {
    id: uid(),
    name,
    icon: known?.icon ?? 'badge-percent',
    color: nextColor(data.taxTypes),
    mode: known?.mode ?? 'fixed',
    rate: known?.rate ?? null,
    currency: known ? 'UAH' : walletCurrency,
    walletIds: known?.mode === 'percent' ? [walletId] : [],
    archived: false,
  };
  data.taxTypes.push(type);
  return type;
}

function feesCategory(data) {
  let fees = data.categories.find((c) => c.kind === 'expense' && c.name.toLowerCase() === 'fees');
  if (!fees) {
    fees = { id: uid(), name: 'Fees', icon: 'receipt', color: 'brown', kind: 'expense', limit: null, archived: false };
    data.categories.push(fees);
  }
  return fees;
}

// Turns entries in the old Taxes category into paid taxes, and fees into Fees. An entry with no note
// counts as a fee in a wallet that has other fees: real taxes there would be named like the rest.
// A second payment of one tax on one day was paying a month that got missed, so it counts for that month.
function liftTaxEntries(data, list) {
  const old = data.categories.find(isTaxesCategory);
  const counts = { taxes: 0, fees: 0 };
  if (!old) return counts;
  old.archived = true;
  const entries = list.filter((t) => t.categoryId === old.id).sort((a, b) => a.date.localeCompare(b.date));
  const feeWallets = new Set(entries.filter((t) => FEE_NOTE.test(t.note || '')).map((t) => t.walletId));
  const used = new Set();
  for (const t of entries) {
    if (!t.taxName && (FEE_NOTE.test(t.note || '') || (!t.note && feeWallets.has(t.walletId)))) {
      t.categoryId = feesCategory(data).id;
      counts.fees++;
      continue;
    }
    const type = taxTypeNamed(data, t.taxName || t.note || 'Other tax', t.walletId);
    delete t.taxName;
    let date = t.date;
    while (used.has(`${type.id}|${date}`)) date = occurrence(date, 'monthly', -1);
    used.add(`${type.id}|${date}`);
    const currency = data.wallets.find((w) => w.id === t.walletId).currency;
    const tax = { id: uid(), taxTypeId: type.id, date, dueAmount: t.amount, currency, walletId: t.walletId, note: '' };
    data.taxes.push(tax);
    t.type = 'tax';
    t.taxId = tax.id;
    delete t.categoryId;
    counts.taxes++;
  }
  return counts;
}

// Version 4 gave tax its own entries, separate from spending. Nothing moves between wallets, so every
// balance stays exactly as it was.
function migrateV3(o) {
  const taken = new Set(o.categories.map((c) => `${c.kind}:${c.name.toLowerCase()}`));
  const ids = new Set(o.categories.map((c) => c.id));
  const added = DEFAULT_CATEGORIES.map(defaultCategory).filter(
    (c) => ['Fees', 'Tax refund'].includes(c.name) && !taken.has(`${c.kind}:${c.name.toLowerCase()}`) && !ids.has(c.id),
  );
  const data = {
    ...o,
    version: 4,
    categories: [...o.categories.map((c) => ({ ...c })), ...added],
    tx: o.tx.map((t) => ({ ...t })),
    recurring: o.recurring.map((r) => ({ ...r })),
    taxTypes: [],
    taxes: [],
    nbu: {},
    pendingRates: [],
  };
  const counts = liftTaxEntries(data, data.tx);
  const old = data.categories.find(isTaxesCategory);
  for (const r of data.recurring) {
    if (!old || r.categoryId !== old.id) continue;
    if (FEE_NOTE.test(r.note || '')) {
      r.categoryId = feesCategory(data).id;
    } else {
      r.type = 'tax';
      r.taxTypeId = taxTypeNamed(data, r.note || 'Other tax', r.walletId).id;
      delete r.categoryId;
    }
  }
  if (counts.taxes || counts.fees) data.upgradeNotice = counts;
  return data;
}

// Throws if the object is not a usable backup, so a bad file can never replace good data.
// Returns the data in the current format.
export function validateBackup(input) {
  const fail = (why) => {
    throw new Error(`Not a valid backup: ${why}`);
  };
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isAmount = (n) => Number.isSafeInteger(n) && n > 0;
  const isType = (t) => t === 'income' || t === 'expense';
  const isCurrency = (c) => /^[A-Z]{3}$/.test(c);

  if (!input || input.app !== 'budget') fail('this file was not made by this app');
  if (!Array.isArray(input.categories) || !Array.isArray(input.tx) || !Array.isArray(input.recurring)) {
    fail('missing data lists');
  }
  if (!isCurrency(input.currency)) fail('bad currency');
  const o2 = input.version >= 2 ? input : migrateV1(input);
  const o = o2.version >= 3 ? o2 : migrateV2(o2);

  if (!Array.isArray(o.wallets) || !o.wallets.length) fail('no wallets');
  if (!o.rates || typeof o.rates !== 'object') fail('bad exchange rates');
  for (const r of Object.values(o.rates)) {
    if (!(Number.isFinite(r) && r > 0)) fail('bad exchange rate');
  }

  const walletIds = new Set();
  for (const w of o.wallets) {
    if (!w.id || typeof w.name !== 'string' || !isCurrency(w.currency) || !Number.isSafeInteger(w.opening)) {
      fail('bad wallet');
    }
    walletIds.add(w.id);
  }
  const ids = new Set();
  for (const c of o.categories) {
    if (!c.id || typeof c.name !== 'string' || !isType(c.kind)) fail('bad category');
    if (c.limit !== null && c.limit !== undefined && !isAmount(c.limit)) fail('bad budget limit');
    ids.add(c.id);
  }
  const taxTypeIds = new Set((o.taxTypes || []).map((x) => x.id));
  const taxIds = new Set();
  for (const x of o.taxes || []) {
    if (!x.id || !isDate(x.date) || !isAmount(x.dueAmount) || !isCurrency(x.currency) || !taxTypeIds.has(x.taxTypeId)) {
      fail('bad tax');
    }
    taxIds.add(x.id);
  }
  const validForeign = (x) =>
    x.foreignCurrency === undefined || x.foreignCurrency === null || (isCurrency(x.foreignCurrency) && isAmount(x.foreignAmount));
  for (const t of o.tx) {
    if (!validForeign(t)) fail('bad foreign price');
    if (!t.id || !isDate(t.date) || !isAmount(t.amount) || !walletIds.has(t.walletId)) fail('bad transaction');
    if (t.type === 'transfer') {
      if (!walletIds.has(t.toWalletId) || !isAmount(t.toAmount)) fail('bad transfer');
    } else if (t.type === 'adjustment') {
      if (typeof t.increase !== 'boolean' || !Number.isSafeInteger(t.before)) fail('bad balance correction');
    } else if (t.type === 'tax') {
      if (!taxIds.has(t.taxId)) fail('bad tax payment');
    } else if (!isType(t.type) || !ids.has(t.categoryId)) {
      fail('bad transaction');
    }
  }
  for (const r of o.recurring) {
    if (!validForeign(r)) fail('bad foreign price');
    if (r.fixedRate !== undefined && r.fixedRate !== null && !(Number.isFinite(r.fixedRate) && r.fixedRate > 0)) {
      fail('bad exchange rate');
    }
    if (
      !r.id ||
      !isDate(r.start) ||
      !isAmount(r.amount) ||
      !(r.type === 'tax' ? taxTypeIds.has(r.taxTypeId) : isType(r.type) && ids.has(r.categoryId)) ||
      !walletIds.has(r.walletId) ||
      !(r.freq in FREQ_DAYS || r.freq in FREQ_MONTHS)
    ) {
      fail('bad recurring item');
    }
  }
  return o.version >= 4 ? o : migrateV3(o);
}

// ---------- Exchange rates ----------

// Converts minor units into the display currency. Returns null when there is no rate for it.
export function convert(state, cents, from) {
  if (from === state.currency) return cents;
  const rate = state.rates[from];
  return rate ? Math.round(cents * rate) : null;
}

// How many units of `to` one unit of `from` buys, or null when a rate is missing.
export function crossRate(state, from, to) {
  const inDisplay = (code) => (code === state.currency ? 1 : state.rates[code]);
  const a = inDisplay(from);
  const b = inDisplay(to);
  return a && b ? a / b : null;
}

export function parseRate(input) {
  const s = String(input ?? '').replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return s && Number.isFinite(n) && n > 0 ? n : null;
}

// The official NBU rate on a date when there is one, otherwise today's rate as an estimate.
// `source` says which, so anything estimated can be corrected once the real rate is known.
export function rateOn(state, from, to, date) {
  if (from === to) return { rate: 1, source: 'nbu' };
  const table = state.nbu?.[date];
  const inUah = (code) => (code === 'UAH' ? 1 : table?.[code]);
  if (table && inUah(from) && inUah(to)) return { rate: inUah(from) / inUah(to), source: 'nbu' };
  const rate = crossRate(state, from, to);
  return rate ? { rate, source: 'estimate' } : null;
}

// Into the display currency, at the saved rate for that date when there is one.
export function convertOn(state, cents, from, date) {
  const found = rateOn(state, from, state.currency, date);
  return found ? Math.round(cents * found.rate) : null;
}

export const nbuUrl = (date) =>
  `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json&date=${date.replaceAll('-', '')}`;

// Saves the rates for one date and corrects taxes that were estimated. Paid amounts never change.
// `rows` is the NBU response. It's empty for a date the NBU hasn't published yet, which stays pending.
export function applyNbuRates(state, date, rows, codes) {
  const table = {};
  for (const row of rows) {
    if (codes.includes(row.cc) && row.rate > 0) table[row.cc] = row.rate;
  }
  if (!rows.length) return false;
  state.nbu[date] = table;
  state.pendingRates = state.pendingRates.filter((d) => d !== date);
  for (const tax of state.taxes) {
    if (tax.date === date && tax.base && tax.fxSource === 'estimate') setIncomeTaxDue(state, tax);
  }
  return true;
}

export function needRate(state, date) {
  if (!state.nbu[date] && !state.pendingRates.includes(date)) state.pendingRates.push(date);
}

// `usdRates` is units of each currency per 1 USD, as the rates service returns them.
// Currencies the service does not cover keep the rate the user set.
export function applyLiveRates(state, usdRates, nowISO) {
  const base = usdRates[state.currency];
  if (!base) return false;
  for (const [code, perUsd] of Object.entries(usdRates)) {
    if (code !== state.currency && perUsd > 0) state.rates[code] = base / perUsd;
  }
  state.ratesUpdated = nowISO;
  return true;
}

// `rate` is what 1 unit of `next` is worth in the current display currency.
// Budget limits are amounts of money, so they convert too rather than keeping the same number.
export function changeDisplayCurrency(state, next, rate) {
  const rates = { [state.currency]: 1 / rate };
  for (const [code, value] of Object.entries(state.rates)) {
    if (code !== next) rates[code] = value / rate;
  }
  state.rates = rates;
  state.currency = next;
  for (const c of state.categories) {
    if (c.limit) c.limit = Math.max(1, Math.round(c.limit / rate));
  }
}

// ---------- Money ----------

// Finds which mark a whole column uses for decimals, because one value alone can't say:
// "96.025" is 96 in a file where others read "1.6", but 96 thousand in one using "1.234,56".
export function detectDecimalMark(values) {
  const clearlyDecimal = (s, mark) => {
    const parts = s.split(mark);
    return parts.length === 2 && parts[1].length !== 3 && parts[1].length > 0;
  };
  let dot = false;
  let comma = false;
  for (const value of values) {
    const s = String(value ?? '').replace(/[^\d.,]/g, '');
    if (s.includes('.') && s.includes(',')) return s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    dot = dot || clearlyDecimal(s, '.');
    comma = comma || clearlyDecimal(s, ',');
  }
  if (dot === comma) return null;
  return dot ? '.' : ',';
}

// Accepts "12", "12.5", "12,50", "1,234.56", "1.234,56", "1 234,56", "$12", "-5", "(5.00)".
// `decimalMark` comes from detectDecimalMark when reading a file; without it the mark is inferred.
// Returns signed cents, or null when there is no number.
export function parseAmount(input, decimalMark = null) {
  const raw = String(input ?? '').trim();
  if (!/\d/.test(raw)) return null;
  const negative = /^\(.*\)$/.test(raw) || /^[^\d]*[-−]/.test(raw) || /[-−]\s*$/.test(raw);
  const s = raw.replace(/[^\d.,]/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let sep = -1;
  if (decimalMark) {
    sep = s.lastIndexOf(decimalMark);
  } else if (lastDot >= 0 && lastComma >= 0) {
    sep = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const idx = Math.max(lastDot, lastComma);
    const ch = s[idx];
    const single = s.indexOf(ch) === idx;
    const after = s.length - idx - 1;
    const intPart = s.slice(0, idx);
    // A lone separator before exactly 3 digits is a thousands separator ("1,234"),
    // unless the integer part is zero ("0.500").
    if (single && (after !== 3 || intPart === '' || intPart === '0')) sep = idx;
  }

  const int = (sep >= 0 ? s.slice(0, sep) : s).replace(/\D/g, '') || '0';
  const frac = (sep >= 0 ? s.slice(sep + 1) : '').replace(/\D/g, '');
  const cents = Number(int) * 100 + Math.round(Number(frac.padEnd(3, '0').slice(0, 3)) / 10);
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export const centsToInput = (cents) => (cents / 100).toFixed(2);

// ---------- Recurring ----------

const FREQ_DAYS = { weekly: 7, biweekly: 14, fourWeeks: 28 };
const FREQ_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };

// The nth occurrence is always computed from the start date, so "monthly on the 31st"
// gives Jan 31, Feb 28, Mar 31 rather than drifting to the 28th forever.
export function occurrence(start, freq, n) {
  const s = fromISO(start);
  if (freq in FREQ_DAYS) {
    return toISO(new Date(s.getFullYear(), s.getMonth(), s.getDate() + FREQ_DAYS[freq] * n));
  }
  const months = FREQ_MONTHS[freq] * n;
  const d = new Date(s.getFullYear(), s.getMonth() + months, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(s.getDate(), lastDay));
  return toISO(d);
}

export function nextOccurrence(rule) {
  for (let n = 0; ; n++) {
    const date = occurrence(rule.start, rule.freq, n);
    if (!rule.lastRun || date > rule.lastRun) return date;
  }
}

// What a rule takes from its wallet, in the wallet's currency. A foreign price uses the rule's own
// rate if it has one, then the current rate. With neither, the last charge is the best estimate left.
export function ruleCharge(state, rule) {
  if (!rule.foreignCurrency) return rule.amount;
  const currency = state.wallets.find((w) => w.id === rule.walletId).currency;
  const rate = rule.fixedRate || crossRate(state, rule.foreignCurrency, currency);
  return rate ? Math.max(1, Math.round(rule.foreignAmount * rate)) : rule.amount;
}

// Recurring payments still to come in a month, at today's rates. These are a forecast only: they
// are built fresh each time and never stored, so balances change only when a payment really comes due.
export function plannedEntries(state, monthKey, today) {
  const out = [];
  for (const rule of state.recurring) {
    for (let n = 0; ; n++) {
      const date = occurrence(rule.start, rule.freq, n);
      const month = monthOf(date);
      if (month > monthKey) break;
      if (month !== monthKey || date <= today || (rule.lastRun && date <= rule.lastRun)) continue;
      const amount = ruleCharge(state, rule);
      out.push({
        id: `planned:${rule.id}:${date}`,
        planned: true,
        ruleId: rule.id,
        estimated: Boolean(rule.foreignCurrency && !rule.fixedRate),
        date,
        type: rule.type,
        amount,
        ...(rule.foreignCurrency && { foreignAmount: rule.foreignAmount, foreignCurrency: rule.foreignCurrency }),
        walletId: rule.walletId,
        ...(rule.type === 'tax' ? { taxTypeId: rule.taxTypeId } : { categoryId: rule.categoryId }),
        note: rule.note,
      });
      if (rule.type !== 'income') continue;
      for (const type of linkedTaxTypes(state, rule.walletId)) {
        out.push({
          id: `planned:${rule.id}:${date}:${type.id}`,
          planned: true,
          ruleId: rule.id,
          estimated: true,
          date,
          type: 'tax',
          amount: Math.max(1, Math.round((amount * type.rate) / 100)),
          walletId: rule.walletId,
          taxTypeId: type.id,
          note: '',
        });
      }
    }
  }
  return out;
}

// Adds every transaction that has come due, and returns how many were added.
export function applyRecurring(state, today) {
  let added = 0;
  for (const rule of state.recurring) {
    for (let date = nextOccurrence(rule); date <= today; date = nextOccurrence(rule)) {
      rule.amount = ruleCharge(state, rule);
      if (rule.type === 'tax') {
        // A tax waits in Tax to pay. The wallet only changes when it's paid.
        state.taxes.push({
          id: uid(),
          taxTypeId: rule.taxTypeId,
          date,
          dueAmount: rule.foreignCurrency ? rule.foreignAmount : rule.amount,
          currency: rule.foreignCurrency || state.wallets.find((w) => w.id === rule.walletId).currency,
          walletId: rule.walletId,
          ruleId: rule.id,
          ...(rule.fixedRate && { payRate: rule.fixedRate }),
          note: rule.note,
        });
      } else {
        const entry = {
          id: uid(),
          date,
          type: rule.type,
          amount: rule.amount,
          ...(rule.foreignCurrency && { foreignAmount: rule.foreignAmount, foreignCurrency: rule.foreignCurrency }),
          walletId: rule.walletId,
          categoryId: rule.categoryId,
          note: rule.note,
          recurringId: rule.id,
        };
        state.tx.push(entry);
        if (rule.type === 'income') {
          for (const type of linkedTaxTypes(state, rule.walletId)) addIncomeTax(state, entry, type.id, type.rate);
        }
      }
      rule.lastRun = date;
      added++;
    }
  }
  return added;
}

// ---------- Tax ----------

// Percentage taxes suggested for income in a wallet.
export const linkedTaxTypes = (state, walletId) =>
  state.taxTypes.filter((x) => x.mode === 'percent' && !x.archived && x.rate > 0 && x.walletIds.includes(walletId));

const walletCurrencyOf = (state, id) => state.wallets.find((w) => w.id === id).currency;

// Works out a percentage tax. The tax is calculated in the tax type's currency at the rate on the
// income date. Once money has been paid, the currency stays so the payments still compare.
export function setIncomeTaxDue(state, tax) {
  if (tax.fxSource !== 'manual') {
    const type = state.taxTypes.find((x) => x.id === tax.taxTypeId);
    const hasPayments = state.tx.some((t) => t.type === 'tax' && t.taxId === tax.id);
    const target = hasPayments ? tax.currency : type.currency;
    const found = rateOn(state, tax.baseCurrency, target, tax.date);
    tax.currency = found ? target : tax.baseCurrency;
    tax.fx = found ? found.rate : 1;
    tax.fxSource = found ? found.source : 'estimate';
  }
  tax.dueAmount = Math.max(1, Math.round((tax.base * tax.fx * tax.rate) / 100));
}

export function addIncomeTax(state, income, taxTypeId, rate) {
  const tax = {
    id: uid(),
    taxTypeId,
    date: income.date,
    incomeId: income.id,
    rate,
    base: income.amount,
    baseCurrency: walletCurrencyOf(state, income.walletId),
    walletId: income.walletId,
    currency: walletCurrencyOf(state, income.walletId),
    dueAmount: 1,
    note: '',
  };
  setIncomeTaxDue(state, tax);
  state.taxes.push(tax);
  if (tax.fxSource === 'estimate') needRate(state, income.date);
  return tax;
}

export const taxPayments = (state, taxId) => state.tx.filter((t) => t.type === 'tax' && t.taxId === taxId);

// A payment's value in the tax's own currency. A wallet in another currency saves it when paying.
export function paymentInTaxCurrency(state, payment, tax) {
  if (walletCurrencyOf(state, payment.walletId) === tax.currency) return payment.amount;
  if (payment.foreignCurrency === tax.currency) return payment.foreignAmount;
  const found = rateOn(state, walletCurrencyOf(state, payment.walletId), tax.currency, payment.date);
  return found ? Math.round(payment.amount * found.rate) : 0;
}

// What should be paid against what was. A difference is only recorded: it doesn't carry to another tax.
export function taxStatus(state, tax) {
  const payments = taxPayments(state, tax.id);
  const paid = payments.reduce((sum, p) => sum + paymentInTaxCurrency(state, p, tax), 0);
  const baseInTax = tax.base ? tax.base * tax.fx : null;
  return {
    payments,
    paid,
    remaining: Math.max(0, tax.dueAmount - paid),
    difference: paid - tax.dueAmount,
    settled: paid >= tax.dueAmount,
    paidPercent: baseInTax && paid ? (paid / baseInTax) * 100 : null,
  };
}

export const unpaidTaxes = (state) =>
  state.taxes.filter((x) => !taxStatus(state, x).settled).sort((a, b) => a.date.localeCompare(b.date));

// Taxes belong to the month of their income or due date, whenever they get paid.
export function monthTaxes(state, key) {
  const out = { paid: 0, unpaid: 0, missing: new Set(), converted: false, byType: new Map() };
  const count = (field, cents, currency, date, typeId) => {
    const value = convertOn(state, cents, currency, date);
    if (value === null) {
      out.missing.add(currency);
      return;
    }
    if (currency !== state.currency) out.converted = true;
    out[field] += value;
    out.byType.set(typeId, (out.byType.get(typeId) || 0) + value);
  };
  for (const tax of state.taxes) {
    if (monthOf(tax.date) !== key) continue;
    const status = taxStatus(state, tax);
    for (const p of status.payments) count('paid', p.amount, walletCurrencyOf(state, p.walletId), p.date, tax.taxTypeId);
    if (status.remaining) count('unpaid', status.remaining, tax.currency, tax.date, tax.taxTypeId);
  }
  return out;
}

// Keeps an income's taxes in step after saving it. `choices` maps a tax type to its percentage, or
// to null when unticked. Unpaid taxes follow the income. Paid ones keep their payments and show the
// new difference, and one that has been paid isn't removed.
export function syncIncomeTaxes(state, income, choices) {
  for (const tax of state.taxes.filter((x) => x.incomeId === income.id)) {
    const paid = taxPayments(state, tax.id).length > 0;
    const rate = choices[tax.taxTypeId];
    if (rate === null && !paid) {
      state.taxes = state.taxes.filter((x) => x !== tax);
      continue;
    }
    if (rate) tax.rate = rate;
    tax.date = income.date;
    tax.base = income.amount;
    if (!paid) {
      tax.baseCurrency = walletCurrencyOf(state, income.walletId);
      tax.walletId = income.walletId;
    }
    setIncomeTaxDue(state, tax);
    if (tax.fxSource === 'estimate') needRate(state, tax.date);
  }
  for (const [taxTypeId, rate] of Object.entries(choices)) {
    if (rate && !state.taxes.some((x) => x.incomeId === income.id && x.taxTypeId === taxTypeId)) {
      addIncomeTax(state, income, taxTypeId, rate);
    }
  }
}

// When an income goes away. Unpaid taxes can go with it. Money already paid really left the wallet,
// so those stay, and so does everything when `keep` is true: they just stop following an income.
export function detachIncomeTaxes(state, incomeId, keep) {
  for (const tax of state.taxes.filter((x) => x.incomeId === incomeId)) {
    if (!keep && !taxPayments(state, tax.id).length) {
      state.taxes = state.taxes.filter((x) => x !== tax);
      continue;
    }
    delete tax.incomeId;
  }
}

export function addTaxPayment(state, tax, { walletId, amount, taxAmount, date, note }) {
  const payment = { id: uid(), date, type: 'tax', amount, walletId, taxId: tax.id, note: note || '' };
  if (walletCurrencyOf(state, walletId) !== tax.currency) {
    payment.foreignAmount = taxAmount;
    payment.foreignCurrency = tax.currency;
  }
  state.tx.push(payment);
  return payment;
}

// Pays what's left at the rate for that date. Returns how many it paid. A tax with no rate is left alone.
export function payAllTaxes(state, date, walletFor) {
  let paid = 0;
  for (const tax of unpaidTaxes(state)) {
    const walletId = walletFor(tax);
    const taxAmount = taxStatus(state, tax).remaining;
    const currency = walletCurrencyOf(state, walletId);
    const rate = tax.payRate && currency !== tax.currency ? { rate: tax.payRate } : rateOn(state, tax.currency, currency, date);
    if (!rate) continue;
    addTaxPayment(state, tax, { walletId, amount: Math.max(1, Math.round(taxAmount * rate.rate)), taxAmount, date });
    paid++;
  }
  return paid;
}

// ---------- Aggregates ----------

export const sortTx = (list) =>
  [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

export const txInMonth = (txs, key) => txs.filter((t) => monthOf(t.date) === key);

// Income and spending in the display currency. Transfers only move money and corrections only fix
// the record, so neither counts as income or spending.
export function summarize(state, txs) {
  const currencies = new Map(state.wallets.map((w) => [w.id, w.currency]));
  const out = { income: 0, expense: 0, plannedTax: 0, byCategory: new Map(), missing: new Set(), converted: false };
  for (const t of txs) {
    if (t.type === 'transfer' || t.type === 'adjustment') continue;
    // Tax payments count for the tax's own month (see monthTaxes). Planned ones have no such record yet.
    if (t.type === 'tax' && !t.planned) continue;
    const from = currencies.get(t.walletId);
    const value = convertOn(state, t.amount, from, t.date);
    if (value === null) {
      out.missing.add(from);
      continue;
    }
    if (from !== state.currency) out.converted = true;
    if (t.type === 'tax') {
      out.plannedTax += value;
      continue;
    }
    out[t.type] += value;
    if (t.type === 'expense') out.byCategory.set(t.categoryId, (out.byCategory.get(t.categoryId) || 0) + value);
  }
  return out;
}

// With `today`, months after it also include their planned payments.
export function trend(state, endKey, months, today = null) {
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = addMonths(endKey, -i);
    const planned = Boolean(today) && key > monthOf(today);
    const list = txInMonth(state.tx, key);
    if (planned) list.push(...plannedEntries(state, key, today));
    const { income, expense, plannedTax } = summarize(state, list);
    const taxes = monthTaxes(state, key);
    rows.push({ key, income, expense, planned, taxPaid: taxes.paid, taxUnpaid: taxes.unpaid, taxPlanned: plannedTax, tax: taxes.paid + taxes.unpaid + plannedTax });
  }
  return rows;
}

// Each wallet's balance in its own currency. With `today`, an entry dated later doesn't count until
// its date arrives.
export function balances(state, today = null) {
  const out = new Map(state.wallets.map((w) => [w.id, w.opening]));
  const add = (id, cents) => out.set(id, out.get(id) + cents);
  for (const t of state.tx) {
    if (today && t.date > today) continue;
    if (t.type === 'transfer') {
      add(t.walletId, -t.amount);
      add(t.toWalletId, t.toAmount);
    } else if (t.type === 'adjustment') {
      add(t.walletId, t.increase ? t.amount : -t.amount);
    } else {
      add(t.walletId, t.type === 'income' ? t.amount : -t.amount);
    }
  }
  return out;
}

// Records the difference between each wallet's calculated balance and what's really there.
// `actuals` maps wallet id to real balance. Past entries are never changed, and `before` keeps what
// the app showed at that moment, so the history stays readable even if older entries change later.
export function correctBalances(state, actuals, date, note, today = null) {
  const bal = balances(state, today);
  const added = [];
  for (const [walletId, actual] of Object.entries(actuals)) {
    const before = bal.get(walletId);
    if (actual === before) continue;
    added.push({
      id: uid(),
      date,
      type: 'adjustment',
      amount: Math.abs(actual - before),
      increase: actual > before,
      before,
      walletId,
      note,
    });
  }
  state.tx.push(...added);
  return added;
}

export const balanceAfter = (t) => t.before + (t.increase ? t.amount : -t.amount);

// The sum of all visible wallets in the display currency.
export function netWorth(state, today = null) {
  const bal = balances(state, today);
  const out = { total: 0, missing: new Set(), converted: false };
  for (const w of state.wallets) {
    if (w.archived) continue;
    const value = convert(state, bal.get(w.id), w.currency);
    if (value === null) out.missing.add(w.currency);
    else {
      out.total += value;
      if (w.currency !== state.currency) out.converted = true;
    }
  }
  return out;
}

export function niceMax(value) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

// ---------- CSV ----------

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Spreadsheets execute text cells that start with these characters as formulas.
const guardFormula = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const unguardFormula = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);

function taxTypeNameOf(state, payment) {
  const tax = state.taxes.find((x) => x.id === payment.taxId);
  return state.taxTypes.find((x) => x.id === tax.taxTypeId).name;
}

export function toCSV(state) {
  const names = new Map(state.categories.map((c) => [c.id, c.name]));
  const wallets = new Map(state.wallets.map((w) => [w.id, w]));
  const rows = [['date', 'type', 'wallet', 'amount', 'currency', 'category', 'note', 'to_wallet', 'to_amount', 'to_currency', 'foreign_amount', 'foreign_currency']];
  for (const t of sortTx(state.tx)) {
    const from = wallets.get(t.walletId);
    const to = wallets.get(t.toWalletId);
    rows.push([
      t.date,
      t.type,
      guardFormula(from.name),
      ((t.type === 'adjustment' && !t.increase ? -t.amount : t.amount) / 100).toFixed(2),
      from.currency,
      guardFormula(t.type === 'tax' ? taxTypeNameOf(state, t) : names.get(t.categoryId) || ''),
      guardFormula(t.note || ''),
      to ? guardFormula(to.name) : '',
      to ? (t.toAmount / 100).toFixed(2) : '',
      to ? to.currency : '',
      t.foreignCurrency ? (t.foreignAmount / 100).toFixed(2) : '',
      t.foreignCurrency || '',
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  return Object.keys(counts).reduce((best, d) => (counts[d] > counts[best] ? d : best), ',');
}

export function parseCSV(input) {
  const text = input.replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

// ---------- Import ----------

export const IMPORT_FIELDS = {
  date: /date|day|time|дата/i,
  converted: /convert/i,
  amount: /amount|sum|value|price|total|сума/i,
  category: /categ|катег/i,
  type: /^type$|kind|transaction.?type|income.?expense|тип/i,
  wallet: /wallet|account|гаман|рахун/i,
  currency: /^curr|валют/i,
  note: /note|memo|desc|comment|title|payee|merchant|name|нотат|опис/i,
};

export function guessMapping(headers) {
  const map = {};
  const used = new Set();
  for (const [field, re] of Object.entries(IMPORT_FIELDS)) {
    map[field] = headers.findIndex((h, i) => !used.has(i) && re.test(h));
    if (map[field] >= 0) used.add(map[field]);
  }
  return map;
}

export function parseDate(value, fmt) {
  const m = String(value ?? '').trim().match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
  if (!m) return null;
  const parts = { ymd: [m[1], m[2], m[3]], dmy: [m[3], m[2], m[1]], mdy: [m[3], m[1], m[2]] }[fmt];
  let y = Number(parts[0]);
  const mo = Number(parts[1]);
  const d = Number(parts[2]);
  if (parts[0].length === 2) y += 2000;
  else if (parts[0].length !== 4) return null;
  const date = new Date(y, mo - 1, d);
  if (date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return toISO(date);
}

// The date formats that parse the most values. Counting rather than requiring every value
// means one junk row, such as a bank's footer line, cannot break detection for the whole file.
export function detectDateFormats(values) {
  const scores = ['ymd', 'dmy', 'mdy'].map((f) => [f, values.filter((v) => parseDate(v, f)).length]);
  const best = Math.max(...scores.map(([, n]) => n));
  return best ? scores.filter(([, n]) => n === best).map(([f]) => f) : [];
}

const INCOME_WORDS = /inc|credit|earn|revenue|salary|deposit|дох/i;
const EXPENSE_WORDS = /exp|debit|spend|cost|payment|витр/i;
const TRANSFER_WORDS = /transfer|переказ/i;
const CORRECTION_WORDS = /adjust|correction|reconcil/i;
const TAX_WORDS = /^tax$/i;

// Names from other apps, mapped onto this app's English categories. Keys are lower case.
const CATEGORY_NAMES = new Map(Object.entries({
  // Monefy's English defaults
  food: 'Groceries',
  house: 'Housing',
  bills: 'Utilities',
  communications: 'Phone & internet',
  toiletry: 'Personal care',
  misc: 'Other',
  // Ukrainian
  'їжа': 'Groceries',
  'продукти': 'Groceries',
  'кафе': 'Eating out',
  'ресторани': 'Eating out',
  'транспорт': 'Transport',
  'таксі': 'Taxi',
  'житло': 'Housing',
  'дім': 'Housing',
  'рахунки': 'Utilities',
  "зв'язок": 'Phone & internet',
  'підписки': 'Subscriptions',
  "здоров'я": 'Health',
  'гігієна': 'Personal care',
  'одяг': 'Clothes',
  'покупки': 'Shopping',
  'електроніка': 'Electronics',
  'розваги': 'Entertainment',
  'ігри': 'Games',
  'книги': 'Books',
  'спорт': 'Sports',
  'навчання': 'Education',
  'освіта': 'Education',
  'подорожі': 'Travel',
  'подарунки': 'Gifts',
  'донати': 'Donations',
  'улюбленці': 'Pets',
  'тварини': 'Pets',
  'машина': 'Car',
  'авто': 'Car',
  'податки': 'Taxes',
  'бізнес': 'Business',
  'позика': 'Loans',
  'різне': 'Other',
  'інше': 'Other',
  'зарплата': 'Salary',
  'заощадження': 'Savings',
  'депозити': 'Deposits',
}));

const WALLET_NAMES = new Map(Object.entries({
  'готівка': 'Cash',
  'платіжна картка': 'Card',
  'картка': 'Card',
  'доларова': 'USD card',
  'єврова': 'EUR card',
  'позичив': 'Lent out',
  'позичив дол': 'Lent out USD',
  'облігації': 'Bonds',
  'депозит': 'Deposit',
  'заощадження': 'Savings',
  'мама': 'Mom',
  'фоп': 'FOP',
  'фоп $': 'FOP $',
}));

// Translates a name, keeping a trailing number: "Депозит 2" becomes "Deposit 2".
function translated(name, table) {
  const [, base, suffix = ''] = name.trim().replace(/[’ʼ]/g, "'").match(/^(.*?)(\s+\d+)?$/);
  const english = table.get(base.toLowerCase());
  return english ? english + suffix : name.trim();
}

const CATEGORY_ICON_HINTS = [
  [/girlfriend|boyfriend|partner|wife|husband|love|date/i, 'heart'],
  [/special|bonus/i, 'star'],
  [/furniture/i, 'sofa'],
  [/photo|camera/i, 'camera'],
  [/art|hobby/i, 'palette'],
  [/music|concert/i, 'music'],
  [/coffee/i, 'coffee'],
  [/bar|beer|alcohol/i, 'beer'],
];
const WALLET_ICON_HINTS = [
  [/cash/i, 'banknote'],
  [/card/i, 'credit-card'],
  [/saving/i, 'piggy-bank'],
  [/deposit/i, 'landmark'],
  [/bond/i, 'file-text'],
  [/invest|stock|crypto/i, 'trending-up'],
  [/lent|loan|debt/i, 'hand-coins'],
  [/mom|dad|family|friend/i, 'users'],
  [/fop|business|company|work/i, 'briefcase'],
  [/travel|trip/i, 'plane'],
];
const iconFromHints = (name, hints, fallback) => hints.find(([re]) => re.test(name))?.[1] ?? fallback;

// Monefy writes each transfer as two rows and doesn't say which rows belong together. Within a day,
// the closest pair by note and converted value is taken first, so the rows can't pair up wrongly.
function pairTransfers(outs, ins) {
  // Different notes or values more than 5% apart mean these are two separate transfers.
  const compatible = (a, b) => {
    if (a.date !== b.date || a.wallet === b.wallet || a.note !== b.note) return false;
    if (!a.converted || !b.converted) return true;
    return Math.abs(a.converted - b.converted) / Math.max(a.converted, b.converted) <= 0.05;
  };
  const gap = (a, b) => (a.converted && b.converted ? Math.abs(a.converted - b.converted) : 0);

  const candidates = [];
  for (const a of outs) {
    for (const b of ins) {
      if (compatible(a, b)) candidates.push({ a, b, gap: gap(a, b) });
    }
  }
  candidates.sort((x, y) => x.gap - y.gap);
  const pairs = [];
  const used = new Set();
  for (const { a, b } of candidates) {
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    pairs.push([a, b]);
  }

  // Money moved A -> B -> C in one day can pair as A -> C, leaving B's two rows with nothing to match.
  // Splitting that pair uses every row, which is what actually happened.
  for (const a of outs.filter((r) => !used.has(r))) {
    for (const b of ins.filter((r) => !used.has(r))) {
      if (used.has(a) || used.has(b)) continue;
      const i = pairs.findIndex(([x, y]) => compatible(x, b) && compatible(a, y));
      if (i < 0) continue;
      const [x, y] = pairs[i];
      pairs.splice(i, 1, [x, b], [a, y]);
      used.add(a);
      used.add(b);
    }
  }
  return { pairs, unpairedOut: outs.filter((r) => !used.has(r)), unpairedIn: ins.filter((r) => !used.has(r)) };
}

// Rows go to the wallet named in the file, or to `defaultWalletId` when the file names none.
// A row whose currency differs from its wallet is skipped: its amount would be silently wrong.
export function buildImport(rows, map, fmt, categories, wallets, defaultWalletId) {
  const known = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c.id]));
  const walletByName = new Map(wallets.map((w) => [w.name.toLowerCase(), w]));
  const defaultWallet = wallets.find((w) => w.id === defaultWalletId);
  const newCategories = [];
  const newWallets = [];
  const tx = [];
  const openings = new Map();
  const transferOuts = [];
  const transferIns = [];
  let skipped = 0;
  let transfers = 0;
  let corrections = 0;
  let mismatched = 0;
  const cell = (row, field) => (map[field] >= 0 ? String(row[map[field]] ?? '').trim() : '');
  const decimalMark = detectDecimalMark(rows.map((r) => cell(r, 'amount')));
  const convertedMark = detectDecimalMark(rows.map((r) => cell(r, 'converted')));
  const hasNegatives = rows.some((r) => parseAmount(cell(r, 'amount'), decimalMark) < 0);

  const hiddenWallet = (currency) => {
    const name = `Closed wallets (${currency})`;
    let wallet = walletByName.get(name.toLowerCase());
    if (!wallet) {
      wallet = { id: uid(), name, icon: 'archive', color: 'gray', currency, opening: 0, archived: true };
      walletByName.set(name.toLowerCase(), wallet);
      newWallets.push(wallet);
    }
    return wallet;
  };

  for (const row of rows) {
    const date = parseDate(cell(row, 'date'), fmt);
    const amount = parseAmount(cell(row, 'amount'), decimalMark);
    if (!date || !amount) {
      skipped++;
      continue;
    }
    const categoryCell = unguardFormula(cell(row, 'category'));
    const typeCell = cell(row, 'type');
    const isPairedTransfer = /^(expense|income)transfer$/i.test(categoryCell);
    // A transfer row with no way to find its other half is reported rather than guessed at.
    if (!isPairedTransfer && TRANSFER_WORDS.test(typeCell)) {
      transfers++;
      continue;
    }
    // A correction is only right against the balance it was made for, so it isn't replayed.
    if (CORRECTION_WORDS.test(typeCell)) {
      corrections++;
      continue;
    }

    const currencyCell = cell(row, 'currency').toUpperCase();
    const rowCurrency = /^[A-Z]{3}$/.test(currencyCell) ? currencyCell : null;
    const walletName = translated(unguardFormula(cell(row, 'wallet')), WALLET_NAMES);
    let wallet = walletName ? walletByName.get(walletName.toLowerCase()) : defaultWallet;
    if (rowCurrency && wallet && wallet.currency !== rowCurrency) {
      mismatched++;
      continue;
    }
    if (!wallet) {
      wallet = {
        id: uid(),
        name: walletName,
        icon: iconFromHints(walletName, WALLET_ICON_HINTS, 'wallet'),
        color: nextColor([...wallets, ...newWallets]),
        currency: rowCurrency || defaultWallet.currency,
        opening: 0,
        archived: false,
      };
      walletByName.set(walletName.toLowerCase(), wallet);
      newWallets.push(wallet);
    }

    if (/^initialbalance$/i.test(categoryCell)) {
      openings.set(wallet.id, (openings.get(wallet.id) || 0) + amount);
      continue;
    }

    if (isPairedTransfer) {
      const converted = parseAmount(cell(row, 'converted'), convertedMark);
      const record = {
        date,
        wallet,
        amount: Math.abs(amount),
        converted: converted === null ? null : Math.abs(converted),
        note: unguardFormula(cell(row, 'note')),
      };
      (/^expense/i.test(categoryCell) ? transferOuts : transferIns).push(record);
      continue;
    }

    const isTax = TAX_WORDS.test(typeCell);
    let type;
    if (isTax) type = 'expense';
    else if (INCOME_WORDS.test(typeCell)) type = 'income';
    else if (EXPENSE_WORDS.test(typeCell)) type = 'expense';
    else if (hasNegatives) type = amount < 0 ? 'expense' : 'income';
    else type = 'expense';

    const name = isTax
      ? 'Taxes'
      : translated(categoryCell, CATEGORY_NAMES) || (type === 'income' ? 'Other income' : 'Other');
    const key = `${type}:${name.toLowerCase()}`;
    if (!known.has(key)) {
      const id = uid();
      known.set(key, id);
      const color = nextColor([...categories, ...newCategories]);
      const icon = iconFromHints(name, CATEGORY_ICON_HINTS, 'tag');
      newCategories.push({ id, name, icon, color, kind: type, limit: null, archived: false });
    }
    tx.push({
      id: uid(),
      date,
      type,
      amount: Math.abs(amount),
      walletId: wallet.id,
      categoryId: known.get(key),
      note: unguardFormula(cell(row, 'note')),
      // A tax exported by this app has its type in the category column.
      ...(isTax && { taxName: categoryCell }),
    });
  }

  const { pairs, unpairedOut, unpairedIn } = pairTransfers(transferOuts, transferIns);
  const transfer = (date, from, amount, to, toAmount, note) =>
    tx.push({ id: uid(), date, type: 'transfer', amount, walletId: from.id, toWalletId: to.id, toAmount, note });
  for (const [a, b] of pairs) transfer(a.date, a.wallet, a.amount, b.wallet, b.amount, a.note);
  // The other side was an account since deleted in the old app. A hidden wallet keeps this balance right.
  for (const r of unpairedOut) transfer(r.date, r.wallet, r.amount, hiddenWallet(r.wallet.currency), r.amount, r.note);
  for (const r of unpairedIn) transfer(r.date, hiddenWallet(r.wallet.currency), r.amount, r.wallet, r.amount, r.note);

  // The file's first row says nothing about which wallet matters, so the busiest come first.
  const uses = new Map();
  for (const t of tx) {
    for (const id of [t.walletId, t.toWalletId]) uses.set(id, (uses.get(id) || 0) + 1);
  }
  newWallets.sort((a, b) => a.archived - b.archived || (uses.get(b.id) || 0) - (uses.get(a.id) || 0));

  return {
    tx,
    newCategories,
    newWallets,
    openings,
    skipped,
    transfers,
    corrections,
    mismatched,
    transfersMatched: pairs.length,
    transfersToClosed: unpairedOut.length + unpairedIn.length,
  };
}

// Moves imported tax entries out of spending, the same way the upgrade to version 4 does.
export function liftImportedTaxes(state, built) {
  const data = {
    categories: [...state.categories, ...built.newCategories],
    wallets: [...state.wallets, ...built.newWallets],
    taxTypes: [...state.taxTypes],
    taxes: [],
  };
  liftTaxEntries(data, built.tx);
  built.newCategories = data.categories.filter((c) => !state.categories.includes(c));
  built.newTaxTypes = data.taxTypes.filter((x) => !state.taxTypes.includes(x));
  built.taxes = data.taxes;
  return built;
}

// What a built import would repeat. Each existing entry can only match one imported entry, so two
// real, identical coffees on one day aren't mistaken for a repeat of a single one in the app.
// A starting balance is a repeat when the wallet already has exactly that amount.
export function findRepeats(state, built) {
  const key = (t) => [t.date, t.type, t.amount, t.walletId, t.toWalletId, t.toAmount, t.categoryId, t.note].join('|');
  const counts = new Map();
  for (const t of state.tx) counts.set(key(t), (counts.get(key(t)) || 0) + 1);
  const entries = new Set();
  for (const t of built.tx) {
    const left = counts.get(key(t)) || 0;
    if (!left) continue;
    counts.set(key(t), left - 1);
    entries.add(t.id);
  }
  const openings = new Set();
  for (const [id, cents] of built.openings) {
    if (state.wallets.find((w) => w.id === id)?.opening === cents) openings.add(id);
  }
  return { entries, openings };
}
