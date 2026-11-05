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

const DEFAULT_CATEGORIES = [
  ['Groceries', '🛒', 'expense'],
  ['Eating out', '🍽️', 'expense'],
  ['Transport', '🚌', 'expense'],
  ['Housing', '🏠', 'expense'],
  ['Utilities', '💡', 'expense'],
  ['Health', '💊', 'expense'],
  ['Shopping', '🛍️', 'expense'],
  ['Entertainment', '🎬', 'expense'],
  ['Subscriptions', '🔁', 'expense'],
  ['Other', '📦', 'expense'],
  ['Salary', '💼', 'income'],
  ['Freelance', '🧾', 'income'],
  ['Other income', '💰', 'income'],
];

export function defaultState(nowISO) {
  return {
    app: 'budget',
    version: 1,
    currency: 'USD',
    createdAt: nowISO,
    lastBackup: null,
    categories: DEFAULT_CATEGORIES.map(([name, icon, kind], i) => ({
      id: `c${i}`,
      name,
      icon,
      kind,
      limit: null,
      archived: false,
    })),
    tx: [],
    recurring: [],
  };
}

// Throws if the object is not a usable backup, so a bad file can never replace good data.
export function validateBackup(o) {
  const fail = (why) => {
    throw new Error(`Not a valid backup: ${why}`);
  };
  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const isAmount = (n) => Number.isSafeInteger(n) && n > 0;
  const isType = (t) => t === 'income' || t === 'expense';

  if (!o || o.app !== 'budget') fail('this file was not made by this app');
  if (!Array.isArray(o.categories) || !Array.isArray(o.tx) || !Array.isArray(o.recurring)) {
    fail('missing data lists');
  }
  if (!/^[A-Z]{3}$/.test(o.currency)) fail('bad currency');

  const ids = new Set();
  for (const c of o.categories) {
    if (!c.id || typeof c.name !== 'string' || !isType(c.kind)) fail('bad category');
    if (c.limit !== null && c.limit !== undefined && !isAmount(c.limit)) fail('bad budget limit');
    ids.add(c.id);
  }
  for (const t of o.tx) {
    if (!t.id || !isDate(t.date) || !isAmount(t.amount) || !isType(t.type) || !ids.has(t.categoryId)) {
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
      !['weekly', 'monthly', 'yearly'].includes(r.freq)
    ) {
      fail('bad recurring item');
    }
  }
  return o;
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

export function totals(txs) {
  const out = { income: 0, expense: 0 };
  for (const t of txs) out[t.type] += t.amount;
  return out;
}

export function spentByCategory(txs) {
  const out = new Map();
  for (const t of txs) {
    if (t.type === 'expense') out.set(t.categoryId, (out.get(t.categoryId) || 0) + t.amount);
  }
  return out;
}

export function trend(txs, endKey, months) {
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = addMonths(endKey, -i);
    rows.push({ key, ...totals(txInMonth(txs, key)) });
  }
  return rows;
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
  const rows = [['date', 'type', 'amount', 'currency', 'category', 'note']];
  for (const t of sortTx(state.tx)) {
    rows.push([
      t.date,
      t.type,
      (t.amount / 100).toFixed(2),
      state.currency,
      guardFormula(names.get(t.categoryId) || ''),
      guardFormula(t.note || ''),
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

export function buildImport(rows, map, fmt, categories) {
  const known = new Map(categories.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c.id]));
  const newCategories = [];
  const tx = [];
  let skipped = 0;
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
      newCategories.push({ id, name, icon: '🏷️', kind: type, limit: null, archived: false });
    }
    tx.push({
      id: uid(),
      date,
      type,
      amount: Math.abs(amount),
      categoryId: known.get(key),
      note: unguardFormula(cell(row, 'note')),
    });
  }
  return { tx, newCategories, skipped };
}
