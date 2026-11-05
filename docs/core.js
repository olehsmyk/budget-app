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
  'blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'sky', 'lime', 'plum', 'brown', 'gray',
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
];

export function defaultState(nowISO) {
  return {
    app: 'budget',
    version: 2,
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
    categories: DEFAULT_CATEGORIES.map(([name, icon, color, kind], i) => ({
      id: `c${i}`,
      name,
      icon,
      color,
      kind,
      limit: null,
      archived: false,
    })),
    tx: [],
    recurring: [],
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
  const o = input.version >= 2 ? input : migrateV1(input);

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
  for (const t of o.tx) {
    if (!t.id || !isDate(t.date) || !isAmount(t.amount) || !walletIds.has(t.walletId)) fail('bad transaction');
    if (t.type === 'transfer') {
      if (!walletIds.has(t.toWalletId) || !isAmount(t.toAmount)) fail('bad transfer');
    } else if (!isType(t.type) || !ids.has(t.categoryId)) {
      fail('bad transaction');
    }
  }
  for (const r of o.recurring) {
    if (
      !r.id ||
      !isDate(r.start) ||
      !isAmount(r.amount) ||
      !isType(r.type) ||
      !ids.has(r.categoryId) ||
      !walletIds.has(r.walletId) ||
      !['weekly', 'monthly', 'yearly'].includes(r.freq)
    ) {
      fail('bad recurring item');
    }
  }
  return o;
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

// Accepts "12", "12.5", "12,50", "1,234.56", "1.234,56", "1 234,56", "$12", "-5", "(5.00)".
// Returns signed cents, or null when there is no number.
export function parseAmount(input) {
  const raw = String(input ?? '').trim();
  if (!/\d/.test(raw)) return null;
  const negative = /^\(.*\)$/.test(raw) || /^[^\d]*[-−]/.test(raw) || /[-−]\s*$/.test(raw);
  const s = raw.replace(/[^\d.,]/g, '');

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let sep = -1;
  if (lastDot >= 0 && lastComma >= 0) {
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

// The nth occurrence is always computed from the start date, so "monthly on the 31st"
// gives Jan 31, Feb 28, Mar 31 rather than drifting to the 28th forever.
export function occurrence(start, freq, n) {
  const s = fromISO(start);
  if (freq === 'weekly') {
    return toISO(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * n));
  }
  const months = (freq === 'yearly' ? 12 : 1) * n;
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

// Adds every transaction that has come due, and returns how many were added.
export function applyRecurring(state, today) {
  let added = 0;
  for (const rule of state.recurring) {
    for (let date = nextOccurrence(rule); date <= today; date = nextOccurrence(rule)) {
      state.tx.push({
        id: uid(),
        date,
        type: rule.type,
        amount: rule.amount,
        walletId: rule.walletId,
        categoryId: rule.categoryId,
        note: rule.note,
        recurringId: rule.id,
      });
      rule.lastRun = date;
      added++;
    }
  }
  return added;
}

// ---------- Aggregates ----------

export const sortTx = (list) =>
  [...list].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

export const txInMonth = (txs, key) => txs.filter((t) => monthOf(t.date) === key);

// Income and spending in the display currency. Transfers only move money, so they count as neither.
export function summarize(state, txs) {
  const currencies = new Map(state.wallets.map((w) => [w.id, w.currency]));
  const out = { income: 0, expense: 0, byCategory: new Map(), missing: new Set(), converted: false };
  for (const t of txs) {
    if (t.type === 'transfer') continue;
    const from = currencies.get(t.walletId);
    const value = convert(state, t.amount, from);
    if (value === null) {
      out.missing.add(from);
      continue;
    }
    if (from !== state.currency) out.converted = true;
    out[t.type] += value;
    if (t.type === 'expense') out.byCategory.set(t.categoryId, (out.byCategory.get(t.categoryId) || 0) + value);
  }
  return out;
}

export function trend(state, endKey, months) {
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = addMonths(endKey, -i);
    const { income, expense } = summarize(state, txInMonth(state.tx, key));
    rows.push({ key, income, expense });
  }
  return rows;
}

// Each wallet's balance in its own currency.
export function balances(state) {
  const out = new Map(state.wallets.map((w) => [w.id, w.opening]));
  const add = (id, cents) => out.set(id, out.get(id) + cents);
  for (const t of state.tx) {
    if (t.type === 'transfer') {
      add(t.walletId, -t.amount);
      add(t.toWalletId, t.toAmount);
    } else {
      add(t.walletId, t.type === 'income' ? t.amount : -t.amount);
    }
  }
  return out;
}

// The sum of all visible wallets in the display currency.
export function netWorth(state) {
  const bal = balances(state);
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

export function toCSV(state) {
  const names = new Map(state.categories.map((c) => [c.id, c.name]));
  const wallets = new Map(state.wallets.map((w) => [w.id, w]));
  const rows = [['date', 'type', 'wallet', 'amount', 'currency', 'category', 'note', 'to_wallet', 'to_amount', 'to_currency']];
  for (const t of sortTx(state.tx)) {
    const from = wallets.get(t.walletId);
    const to = wallets.get(t.toWalletId);
    rows.push([
      t.date,
      t.type,
      guardFormula(from.name),
      (t.amount / 100).toFixed(2),
      from.currency,
      guardFormula(names.get(t.categoryId) || ''),
      guardFormula(t.note || ''),
      to ? guardFormula(to.name) : '',
      to ? (t.toAmount / 100).toFixed(2) : '',
      to ? to.currency : '',
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

// Rows go to the wallet named in the file, or to `defaultWalletId` when the file names none.
// A row whose currency differs from its wallet is skipped: its amount would be silently wrong.
export function buildImport(rows, map, fmt, categories, wallets, defaultWalletId) {
  const known = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c.id]));
  const walletByName = new Map(wallets.map((w) => [w.name.toLowerCase(), w]));
  const defaultWallet = wallets.find((w) => w.id === defaultWalletId);
  const newCategories = [];
  const newWallets = [];
  const tx = [];
  let skipped = 0;
  let transfers = 0;
  let mismatched = 0;
  const cell = (row, field) => (map[field] >= 0 ? String(row[map[field]] ?? '').trim() : '');
  const hasNegatives = rows.some((r) => parseAmount(cell(r, 'amount')) < 0);

  for (const row of rows) {
    const date = parseDate(cell(row, 'date'), fmt);
    const amount = parseAmount(cell(row, 'amount'));
    if (!date || !amount) {
      skipped++;
      continue;
    }
    const typeCell = cell(row, 'type');
    // A transfer needs both sides to be correct, so it is reported rather than guessed at.
    if (TRANSFER_WORDS.test(typeCell)) {
      transfers++;
      continue;
    }

    const currencyCell = cell(row, 'currency').toUpperCase();
    const rowCurrency = /^[A-Z]{3}$/.test(currencyCell) ? currencyCell : null;
    const walletName = unguardFormula(cell(row, 'wallet'));
    let wallet = walletName ? walletByName.get(walletName.toLowerCase()) : defaultWallet;
    if (rowCurrency && wallet && wallet.currency !== rowCurrency) {
      mismatched++;
      continue;
    }
    if (!wallet) {
      wallet = {
        id: uid(),
        name: walletName,
        icon: 'wallet',
        color: nextColor([...wallets, ...newWallets]),
        currency: rowCurrency || defaultWallet.currency,
        opening: 0,
        archived: false,
      };
      walletByName.set(walletName.toLowerCase(), wallet);
      newWallets.push(wallet);
    }

    let type;
    if (INCOME_WORDS.test(typeCell)) type = 'income';
    else if (EXPENSE_WORDS.test(typeCell)) type = 'expense';
    else if (hasNegatives) type = amount < 0 ? 'expense' : 'income';
    else type = 'expense';

    const name =
      unguardFormula(cell(row, 'category')) || (type === 'income' ? 'Other income' : 'Other');
    const key = `${type}:${name.toLowerCase()}`;
    if (!known.has(key)) {
      const id = uid();
      known.set(key, id);
      const color = nextColor([...categories, ...newCategories]);
      newCategories.push({ id, name, icon: 'tag', color, kind: type, limit: null, archived: false });
    }
    tx.push({
      id: uid(),
      date,
      type,
      amount: Math.abs(amount),
      walletId: wallet.id,
      categoryId: known.get(key),
      note: unguardFormula(cell(row, 'note')),
    });
  }
  return { tx, newCategories, newWallets, skipped, transfers, mismatched };
}
