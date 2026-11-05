import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../docs/core.js';

// A state with EUR as the display currency and wallets in EUR, USD and IDR.
function multiCurrencyState() {
  const state = C.defaultState('2026-01-01');
  state.currency = 'EUR';
  state.rates = { USD: 0.9, IDR: 0.00005 };
  state.wallets = [
    { id: 'eur', name: 'Main', icon: '👛', currency: 'EUR', opening: 100000, archived: false },
    { id: 'usd', name: 'Car', icon: '🚗', currency: 'USD', opening: 50000, archived: false },
    { id: 'idr', name: 'Bali', icon: '🏝️', currency: 'IDR', opening: 200000000, archived: false },
  ];
  return state;
}

test('parseAmount handles the formats people type and banks export', () => {
  const cases = {
    12: 1200,
    '12.5': 1250,
    '12,50': 1250,
    '1,234.56': 123456,
    '1.234,56': 123456,
    '1 234,56': 123456,
    '1,234': 123400,
    '1,234,567': 123456700,
    '0.500': 50,
    '.5': 50,
    '$12.00': 1200,
    '-5': -500,
    '-$5.25': -525,
    '(5.00)': -500,
    '19.99': 1999,
    '0.07': 7,
  };
  for (const [input, cents] of Object.entries(cases)) {
    assert.equal(C.parseAmount(input), cents, input);
  }
  assert.equal(C.parseAmount(''), null);
  assert.equal(C.parseAmount('abc'), null);
});

test('monthly recurrence clamps short months without drifting', () => {
  const dates = [0, 1, 2, 3].map((n) => C.occurrence('2026-01-31', 'monthly', n));
  assert.deepEqual(dates, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('weekly and yearly recurrence', () => {
  assert.equal(C.occurrence('2026-12-29', 'weekly', 1), '2027-01-05');
  assert.equal(C.occurrence('2028-02-29', 'yearly', 1), '2029-02-28');
});

test('applyRecurring backfills once, never duplicates, and uses the rule wallet', () => {
  const state = multiCurrencyState();
  state.recurring.push({
    id: 'r1',
    start: '2026-09-15',
    freq: 'monthly',
    lastRun: null,
    type: 'expense',
    amount: 5000,
    walletId: 'usd',
    categoryId: 'c3',
    note: 'Rent',
  });
  assert.equal(C.applyRecurring(state, '2026-11-14'), 2);
  assert.deepEqual(state.tx.map((t) => t.date), ['2026-09-15', '2026-10-15']);
  assert.equal(C.applyRecurring(state, '2026-11-14'), 0);
  assert.equal(C.applyRecurring(state, '2026-11-15'), 1);
  assert.equal(state.tx.length, 3);
  assert.equal(state.tx[2].recurringId, 'r1');
  assert.equal(state.tx[2].walletId, 'usd');
});

test('summarize converts to the display currency and ignores transfers', () => {
  const state = multiCurrencyState();
  const tx = [
    { date: '2026-11-01', type: 'expense', amount: 1000, walletId: 'eur', categoryId: 'a' },
    { date: '2026-11-02', type: 'expense', amount: 1000, walletId: 'usd', categoryId: 'a' },
    { date: '2026-11-03', type: 'income', amount: 2000, walletId: 'usd', categoryId: 'b' },
    { date: '2026-11-04', type: 'transfer', amount: 9999, toAmount: 9999, walletId: 'eur', toWalletId: 'usd' },
  ];
  const s = C.summarize(state, tx);
  assert.equal(s.expense, 1900);
  assert.equal(s.income, 1800);
  assert.equal(s.byCategory.get('a'), 1900);
  assert.equal(s.converted, true);
  assert.equal(s.missing.size, 0);
});

test('summarize reports currencies it could not convert instead of guessing', () => {
  const state = multiCurrencyState();
  delete state.rates.USD;
  const s = C.summarize(state, [
    { date: '2026-11-01', type: 'expense', amount: 1000, walletId: 'eur', categoryId: 'a' },
    { date: '2026-11-02', type: 'expense', amount: 500, walletId: 'usd', categoryId: 'a' },
  ]);
  assert.equal(s.expense, 1000);
  assert.deepEqual([...s.missing], ['USD']);
});

test('trend covers each month in the display currency', () => {
  const state = multiCurrencyState();
  state.tx = [
    { date: '2026-10-31', type: 'expense', amount: 700, walletId: 'eur', categoryId: 'a' },
    { date: '2026-11-01', type: 'expense', amount: 1000, walletId: 'usd', categoryId: 'a' },
  ];
  assert.deepEqual(C.trend(state, '2027-01', 4).map((r) => [r.key, r.expense]), [
    ['2026-10', 700],
    ['2026-11', 900],
    ['2026-12', 0],
    ['2027-01', 0],
  ]);
});

test('balances apply opening amounts, entries and both sides of a transfer', () => {
  const state = multiCurrencyState();
  state.tx = [
    { id: '1', date: '2026-11-01', type: 'expense', amount: 2500, walletId: 'eur', categoryId: 'c0' },
    { id: '2', date: '2026-11-02', type: 'income', amount: 1000, walletId: 'usd', categoryId: 'c10' },
    { id: '3', date: '2026-11-03', type: 'transfer', amount: 9000, walletId: 'eur', toWalletId: 'usd', toAmount: 10000 },
  ];
  const b = C.balances(state);
  assert.equal(b.get('eur'), 100000 - 2500 - 9000);
  assert.equal(b.get('usd'), 50000 + 1000 + 10000);
  assert.equal(b.get('idr'), 200000000);
});

test('netWorth sums visible wallets in the display currency', () => {
  const state = multiCurrencyState();
  const worth = C.netWorth(state);
  assert.equal(worth.total, 100000 + 45000 + 10000);
  assert.equal(worth.converted, true);

  state.wallets[2].archived = true;
  assert.equal(C.netWorth(state).total, 145000);
});

test('netWorth lists a wallet with no rate rather than counting it as zero silently', () => {
  const state = multiCurrencyState();
  delete state.rates.IDR;
  const worth = C.netWorth(state);
  assert.equal(worth.total, 145000);
  assert.deepEqual([...worth.missing], ['IDR']);
});

test('crossRate works between any two currencies', () => {
  const state = multiCurrencyState();
  assert.equal(C.crossRate(state, 'EUR', 'EUR'), 1);
  assert.equal(C.crossRate(state, 'USD', 'EUR'), 0.9);
  assert.ok(Math.abs(C.crossRate(state, 'USD', 'IDR') - 18000) < 1e-6);
  assert.equal(C.crossRate(state, 'USD', 'UAH'), null);
});

test('parseRate accepts a decimal comma and rejects nonsense', () => {
  assert.equal(C.parseRate('46,2'), 46.2);
  assert.equal(C.parseRate(' 0.0026 '), 0.0026);
  assert.equal(C.parseRate(''), null);
  assert.equal(C.parseRate('0'), null);
  assert.equal(C.parseRate('-3'), null);
  assert.equal(C.parseRate('abc'), null);
  assert.equal(C.parseRate(null), null);
});

test('applyLiveRates rebases USD quotes onto the display currency', () => {
  const state = C.defaultState('2026-01-01');
  state.currency = 'UAH';
  state.rates = { XXX: 7 };
  assert.equal(C.applyLiveRates(state, { USD: 1, EUR: 0.9, UAH: 45 }, 'now'), true);
  assert.equal(state.rates.USD, 45);
  assert.equal(state.rates.EUR, 50);
  assert.equal(state.rates.UAH, undefined);
  assert.equal(state.rates.XXX, 7, 'a currency the service lacks keeps its rate');
  assert.equal(state.ratesUpdated, 'now');

  state.currency = 'ZZZ';
  assert.equal(C.applyLiveRates(state, { USD: 1 }, 'later'), false);
  assert.equal(state.ratesUpdated, 'now');
});

test('changing the display currency keeps every wallet total and budget limit equal in value', () => {
  const state = multiCurrencyState();
  state.categories[0].limit = 9000; // 90.00 EUR
  const before = C.netWorth(state).total;

  C.changeDisplayCurrency(state, 'USD', 0.9);

  assert.equal(state.currency, 'USD');
  assert.equal(state.rates.USD, undefined);
  assert.ok(Math.abs(state.rates.EUR - 1 / 0.9) < 1e-9);
  assert.equal(state.categories[0].limit, 10000); // 100.00 USD
  assert.ok(Math.abs(C.netWorth(state).total - before / 0.9) <= 2);
});

test('addMonths crosses year boundaries', () => {
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
});

test('CSV parser handles quotes, delimiters, line endings and a BOM', () => {
  assert.deepEqual(C.parseCSV('﻿a,b\r\n"x, ""y""",2\n\n"line\nbreak",3'), [
    ['a', 'b'],
    ['x, "y"', '2'],
    ['line\nbreak', '3'],
  ]);
  assert.deepEqual(C.parseCSV('a;b\n1,5;2'), [['a', 'b'], ['1,5', '2']]);
});

test('exported CSV re-imports to the right wallets, including tricky notes', () => {
  const state = multiCurrencyState();
  state.tx.push(
    { id: '1', date: '2026-11-02', type: 'expense', amount: 1999, walletId: 'eur', categoryId: 'c0', note: 'Milk, "organic"' },
    { id: '2', date: '2026-11-01', type: 'income', amount: 500000, walletId: 'usd', categoryId: 'c10', note: '=HYPERLINK("x")' },
  );
  const csv = C.toCSV(state);
  assert.match(csv, /'=HYPERLINK/, 'formula is neutralised for spreadsheets');

  const [headers, ...rows] = C.parseCSV(csv);
  const map = C.guessMapping(headers);
  assert.deepEqual(C.detectDateFormats(rows.map((r) => r[map.date])), ['ymd']);
  const out = C.buildImport(rows, map, 'ymd', state.categories, state.wallets, 'eur');
  assert.equal(out.skipped, 0);
  assert.deepEqual(out.newCategories, []);
  assert.deepEqual(out.newWallets, []);
  assert.deepEqual(
    out.tx.map((t) => [t.date, t.type, t.amount, t.walletId, t.categoryId, t.note]),
    [
      ['2026-11-02', 'expense', 1999, 'eur', 'c0', 'Milk, "organic"'],
      ['2026-11-01', 'income', 500000, 'usd', 'c10', '=HYPERLINK("x")'],
    ],
  );
});

test('exported transfers show both sides and are reported, not imported as spending', () => {
  const state = multiCurrencyState();
  state.tx.push({ id: '1', date: '2026-11-02', type: 'transfer', amount: 9000, walletId: 'eur', toWalletId: 'usd', toAmount: 10000, note: '' });
  const csv = C.toCSV(state);
  assert.match(csv, /2026-11-02,transfer,Main,90\.00,EUR,,,Car,100\.00,USD/);

  const [headers, ...rows] = C.parseCSV(csv);
  const out = C.buildImport(rows, C.guessMapping(headers), 'ymd', state.categories, state.wallets, 'eur');
  assert.equal(out.tx.length, 0);
  assert.equal(out.transfers, 1);
});

test('import creates a named wallet in the file currency and skips mismatched rows', () => {
  const state = multiCurrencyState();
  const map = { date: 0, amount: 1, wallet: 2, currency: 3, category: -1, note: -1, type: -1 };
  const out = C.buildImport(
    [
      ['2026-11-01', '-10', 'Revolut', 'gbp'],
      ['2026-11-02', '-20', 'revolut', 'GBP'],
      ['2026-11-03', '-30', 'Car', 'EUR'],
      ['2026-11-04', '-40', '', ''],
    ],
    map,
    'ymd',
    state.categories,
    state.wallets,
    'idr',
  );
  assert.deepEqual(out.newWallets.map((w) => [w.name, w.currency]), [['Revolut', 'GBP']]);
  assert.equal(out.tx[0].walletId, out.newWallets[0].id);
  assert.equal(out.tx[1].walletId, out.newWallets[0].id, 'wallet match ignores case');
  assert.equal(out.mismatched, 1, 'Car is USD, so a EUR row is not added to it');
  assert.equal(out.tx.at(-1).walletId, 'idr', 'a row naming no wallet uses the default');
  assert.equal(out.tx.length, 3);
});

test('date detection separates unambiguous from ambiguous files', () => {
  assert.deepEqual(C.detectDateFormats(['31/12/2026']), ['dmy']);
  assert.deepEqual(C.detectDateFormats(['12/31/2026']), ['mdy']);
  assert.deepEqual(C.detectDateFormats(['03/04/2026']), ['dmy', 'mdy']);
  assert.deepEqual(C.detectDateFormats(['31.10.2026', '01.10.2026', 'Total', '99.99.2026']), ['dmy']);
  assert.deepEqual(C.detectDateFormats(['Total', '']), []);
  assert.equal(C.parseDate('31.02.2026', 'dmy'), null);
  assert.equal(C.parseDate('2026-11-05 14:30', 'ymd'), '2026-11-05');
});

test('import infers type from signs and creates only missing categories', () => {
  const state = C.defaultState('2026-01-01');
  const map = { date: 0, amount: 1, category: 2, note: 3, type: -1 };
  const rows = [
    ['2026-11-01', '-12.50', 'groceries', 'Shop'],
    ['2026-11-02', '1000', 'Salary', ''],
    ['2026-11-03', '-3', 'Pets', ''],
    ['bad date', '-3', 'Pets', ''],
    ['2026-11-04', 'n/a', 'Pets', ''],
  ];
  const out = C.buildImport(rows, map, 'ymd', state.categories, state.wallets, 'w0');
  assert.equal(out.skipped, 2);
  assert.deepEqual(out.tx.map((t) => [t.type, t.amount, t.walletId]), [
    ['expense', 1250, 'w0'],
    ['income', 100000, 'w0'],
    ['expense', 300, 'w0'],
  ]);
  assert.equal(out.tx[0].categoryId, 'c0', 'category match ignores case');
  assert.deepEqual(out.newCategories.map((c) => c.name), ['Pets']);
});

test('positive-only file with a type column uses the column', () => {
  const state = C.defaultState('2026-01-01');
  const map = { date: 0, amount: 1, category: -1, note: -1, type: 2 };
  const out = C.buildImport(
    [['2026-11-01', '10', 'Expense'], ['2026-11-02', '20', 'Income'], ['2026-11-03', '30', '']],
    map,
    'ymd',
    state.categories,
    state.wallets,
    'w0',
  );
  assert.deepEqual(out.tx.map((t) => t.type), ['expense', 'income', 'expense']);
});

test('validateBackup accepts real state and rejects bad files', () => {
  const good = C.defaultState('2026-01-01');
  good.tx.push({ id: '1', date: '2026-11-02', type: 'expense', amount: 100, walletId: 'w0', categoryId: 'c0', note: '' });
  assert.ok(C.validateBackup(JSON.parse(JSON.stringify(good))));

  assert.throws(() => C.validateBackup({ hello: 1 }));
  assert.throws(() => C.validateBackup(null));
  assert.throws(() => C.validateBackup({ ...good, tx: [{ ...good.tx[0], amount: 1.5 }] }));
  assert.throws(() => C.validateBackup({ ...good, tx: [{ ...good.tx[0], categoryId: 'nope' }] }));
  assert.throws(() => C.validateBackup({ ...good, tx: [{ ...good.tx[0], walletId: 'nope' }] }));
  assert.throws(() => C.validateBackup({ ...good, wallets: [] }));
  assert.throws(() => C.validateBackup({ ...good, rates: { EUR: -1 } }));
  assert.throws(() =>
    C.validateBackup({ ...good, tx: [{ id: '2', date: '2026-11-02', type: 'transfer', amount: 100, walletId: 'w0', toWalletId: 'nope', toAmount: 100 }] }),
  );
});

test('data saved by the first version upgrades with nothing lost', () => {
  // Exactly the shape the published version 1 writes.
  const v1 = {
    app: 'budget',
    version: 1,
    currency: 'UAH',
    createdAt: '2026-11-06',
    lastBackup: null,
    categories: [
      { id: 'c0', name: 'Groceries', icon: '🛒', kind: 'expense', limit: 500000, archived: false },
      { id: 'c10', name: 'Salary', icon: '💼', kind: 'income', limit: null, archived: false },
    ],
    tx: [
      { id: 't1', date: '2026-11-01', type: 'expense', amount: 12550, categoryId: 'c0', note: 'Shop' },
      { id: 't2', date: '2026-11-02', type: 'income', amount: 4500000, categoryId: 'c10', note: '' },
    ],
    recurring: [
      { id: 'r1', start: '2026-11-01', freq: 'monthly', lastRun: '2026-11-01', type: 'expense', amount: 800000, categoryId: 'c0', note: 'Rent' },
    ],
  };
  const original = JSON.stringify(v1);
  const out = C.validateBackup(JSON.parse(original));

  assert.equal(JSON.stringify(v1), original, 'the input is not modified');
  assert.equal(out.version, 2);
  assert.equal(out.currency, 'UAH');
  assert.deepEqual(out.wallets.map((w) => [w.name, w.currency, w.opening]), [['Main', 'UAH', 0]]);
  assert.deepEqual(out.tx.map((t) => [t.id, t.amount, t.note, t.walletId]), [
    ['t1', 12550, 'Shop', 'w0'],
    ['t2', 4500000, '', 'w0'],
  ]);
  assert.equal(out.recurring[0].walletId, 'w0');
  assert.equal(out.recurring[0].lastRun, '2026-11-01');
  assert.equal(out.categories[0].limit, 500000);
  assert.equal(C.summarize(out, out.tx).expense, 12550);
  assert.equal(C.balances(out).get('w0'), 4500000 - 12550);
  assert.deepEqual(out.categories.map((c) => [c.icon, c.color]), [
    ['shopping-cart', 'green'],
    ['briefcase', 'green'],
  ]);
});

test('a custom first-version category with an unknown emoji gets a generic icon and a color', () => {
  const v1 = C.defaultState('2026-01-01');
  v1.version = 1;
  v1.categories = [
    { id: 'a', name: 'Pets', icon: '🐕', kind: 'expense', limit: null, archived: false },
    { id: 'b', name: 'Bikes', icon: '🚲', kind: 'expense', limit: null, archived: false },
  ];
  const out = C.validateBackup(v1);
  assert.deepEqual(out.categories.map((c) => c.icon), ['tag', 'tag']);
  assert.notEqual(out.categories[0].color, out.categories[1].color);
});

test('every default category has a color from the palette, and expense colors are all different', () => {
  const { categories } = C.defaultState('2026-01-01');
  for (const c of categories) assert.ok(C.COLOR_KEYS.includes(c.color), c.name);
  const expense = categories.filter((c) => c.kind === 'expense').map((c) => c.color);
  assert.equal(new Set(expense).size, expense.length);
});

test('nextColor picks the least used color and avoids gray', () => {
  assert.equal(C.nextColor([]), 'blue');
  assert.equal(C.nextColor([{ color: 'blue' }]), 'orange');
  const allButLime = C.COLOR_KEYS.filter((k) => k !== 'lime').map((color) => ({ color }));
  assert.equal(C.nextColor(allButLime), 'lime');
});

test('imported new categories and wallets get different colors', () => {
  const state = C.defaultState('2026-01-01');
  const map = { date: 0, amount: 1, category: 2, wallet: 3, note: -1, type: -1 };
  const out = C.buildImport(
    [['2026-11-01', '-1', 'Pets', 'A'], ['2026-11-02', '-2', 'Toys', 'B']],
    map,
    'ymd',
    state.categories,
    state.wallets,
    'w0',
  );
  assert.notEqual(out.newCategories[0].color, out.newCategories[1].color);
  assert.notEqual(out.newWallets[0].color, out.newWallets[1].color);
  assert.equal(out.newCategories[0].icon, 'tag');
  assert.equal(out.newWallets[0].icon, 'wallet');
});
