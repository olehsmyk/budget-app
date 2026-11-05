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
    ['2026-11-03', '-3', 'Reptiles', ''],
    ['bad date', '-3', 'Reptiles', ''],
    ['2026-11-04', 'n/a', 'Reptiles', ''],
  ];
  const out = C.buildImport(rows, map, 'ymd', state.categories, state.wallets, 'w0');
  assert.equal(out.skipped, 2);
  assert.deepEqual(out.tx.map((t) => [t.type, t.amount, t.walletId]), [
    ['expense', 1250, 'w0'],
    ['income', 100000, 'w0'],
    ['expense', 300, 'w0'],
  ]);
  assert.equal(out.tx[0].categoryId, 'c0', 'category match ignores case');
  assert.deepEqual(out.newCategories.map((c) => c.name), ['Reptiles']);
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
  assert.equal(out.version, 3);
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
  assert.deepEqual(out.categories.slice(0, 2).map((c) => [c.icon, c.color]), [
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
  assert.deepEqual(out.categories.slice(0, 2).map((c) => c.icon), ['tag', 'tag']);
  assert.notEqual(out.categories[0].color, out.categories[1].color);
});

test('every default category has a color from the palette, and they use the whole palette', () => {
  const { categories } = C.defaultState('2026-01-01');
  for (const c of categories) assert.ok(C.COLOR_KEYS.includes(c.color), c.name);
  const expense = categories.filter((c) => c.kind === 'expense').map((c) => c.color);
  assert.equal(new Set(expense).size, C.COLOR_KEYS.length);
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
    [['2026-11-01', '-1', 'Reptiles', 'A'], ['2026-11-02', '-2', 'Toys', 'B']],
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

test('version 2 data gains the new default categories without touching what is there', () => {
  const v2 = C.defaultState('2026-01-01');
  v2.version = 2;
  v2.categories = v2.categories.slice(0, 13);
  v2.categories[0].name = 'Food shop'; // renamed by the user
  v2.categories[0].limit = 1234;
  v2.categories.push({ id: 'mine', name: 'taxi', icon: 'car', color: 'red', kind: 'expense', limit: null, archived: true });
  v2.tx.push({ id: '1', date: '2026-11-01', type: 'expense', amount: 100, walletId: 'w0', categoryId: 'c0', note: '' });

  const out = C.validateBackup(JSON.parse(JSON.stringify(v2)));
  assert.equal(out.version, 3);
  assert.equal(out.categories[0].name, 'Food shop');
  assert.equal(out.categories[0].limit, 1234);
  assert.equal(out.categories.filter((c) => c.name.toLowerCase() === 'taxi').length, 1, 'no duplicate, even of a hidden one');
  assert.ok(out.categories.some((c) => c.name === 'Donations'));
  assert.ok(out.categories.some((c) => c.name === 'Gifts' && c.kind === 'income'));
  assert.equal(new Set(out.categories.map((c) => c.id)).size, out.categories.length);
  assert.equal(C.validateBackup(JSON.parse(JSON.stringify(out))).categories.length, out.categories.length, 'running it twice adds nothing');
});

test('new repeat intervals land on the right dates', () => {
  assert.deepEqual([0, 1, 2].map((n) => C.occurrence('2026-01-01', 'fourWeeks', n)), ['2026-01-01', '2026-01-29', '2026-02-26']);
  assert.equal(C.occurrence('2026-01-01', 'biweekly', 2), '2026-01-29');
  assert.equal(C.occurrence('2026-01-31', 'quarterly', 1), '2026-04-30');
  assert.equal(C.occurrence('2026-08-31', 'semiannual', 1), '2027-02-28');
});

test('a column of amounts decides what a dot means', () => {
  assert.equal(C.detectDecimalMark(['-4000', '-1.6', '96.025']), '.');
  assert.equal(C.detectDecimalMark(['12,5', '1.234,56']), ',');
  assert.equal(C.detectDecimalMark(['1,234.50']), '.');
  assert.equal(C.detectDecimalMark(['100', '200']), null);
  assert.equal(C.detectDecimalMark(['96.025']), null, 'alone, it could be either');

  assert.equal(C.parseAmount('96.025', '.'), 9603);
  assert.equal(C.parseAmount('96.025'), 9602500, 'with no context, three digits read as thousands');
  assert.equal(C.parseAmount('1.234,56', ','), 123456);
  assert.equal(C.parseAmount('-4000', '.'), -400000);
});

// Made-up rows in the same layout as a Monefy export.
const MONEFY_HEADER = ['date', 'account', 'category', 'amount', 'currency', 'converted amount', 'currency', 'description'];
function importMonefy(rows, state = C.defaultState('2026-01-01')) {
  const map = C.guessMapping(MONEFY_HEADER);
  const out = C.buildImport(rows, map, 'dmy', state.categories, state.wallets, 'w0');
  return { map, out, state };
}

test('Monefy columns are recognised, including the repeated currency header', () => {
  const map = C.guessMapping(MONEFY_HEADER);
  assert.deepEqual(
    [map.date, map.wallet, map.category, map.amount, map.currency, map.converted, map.note],
    [0, 1, 2, 3, 4, 5, 7],
  );
});

test('Monefy transfer rows become one real transfer each and never count as spending', () => {
  const { out, state } = importMonefy([
    ['01.03.2026', 'Готівка', 'ExpenseTransfer', '-4500', 'UAH', '-4500', 'UAH', 'to euro'],
    ['01.03.2026', 'Euro', 'IncomeTransfer', '100', 'EUR', '4510', 'UAH', 'to euro'],
    ['02.03.2026', 'Готівка', 'Донати', '-500', 'UAH', '-500', 'UAH', ''],
  ]);
  assert.equal(out.transfersMatched, 1);
  const t = out.tx.find((x) => x.type === 'transfer');
  const cash = out.newWallets.find((w) => w.name === 'Cash');
  const euro = out.newWallets.find((w) => w.name === 'Euro');
  assert.deepEqual([t.walletId, t.amount, t.toWalletId, t.toAmount, t.note], [cash.id, 450000, euro.id, 10000, 'to euro']);

  const merged = { ...state, wallets: [...state.wallets, ...out.newWallets], categories: [...state.categories, ...out.newCategories], tx: out.tx, currency: 'UAH', rates: {} };
  assert.equal(C.summarize(merged, merged.tx.filter((x) => x.walletId === cash.id)).expense, 50000);
});

test('when two transfers share a day, rows pair by value rather than by order', () => {
  // Reading top to bottom would wrongly pair the USD row with the first arrival.
  const { out } = importMonefy([
    ['15.08.2026', 'Доларова', 'ExpenseTransfer', '-200', 'USD', '-9100', 'UAH', ''],
    ['15.08.2026', 'Єврова', 'ExpenseTransfer', '-100', 'EUR', '-5100', 'UAH', ''],
    ['15.08.2026', 'Платіжна картка', 'IncomeTransfer', '5100', 'UAH', '5100', 'UAH', ''],
    ['15.08.2026', 'Єврова', 'IncomeTransfer', '178.43', 'EUR', '9100', 'UAH', ''],
  ]);
  assert.equal(out.transfersMatched, 2);
  assert.equal(out.transfersToClosed, 0);
  const names = new Map(out.newWallets.map((w) => [w.id, w.name]));
  const seen = out.tx.map((t) => `${names.get(t.walletId)}>${names.get(t.toWalletId)}:${t.toAmount}`).sort();
  assert.deepEqual(seen, ['EUR card>Card:510000', 'USD card>EUR card:17843']);
});

test('money moved through a wallet in one day stays two transfers, not one', () => {
  const { out } = importMonefy([
    ['15.08.2026', 'Готівка', 'ExpenseTransfer', '-5000', 'UAH', '-5000', 'UAH', ''],
    ['15.08.2026', 'Єврова', 'IncomeTransfer', '100', 'EUR', '5100', 'UAH', ''],
    ['15.08.2026', 'Єврова', 'ExpenseTransfer', '-100', 'EUR', '-5100', 'UAH', ''],
    ['15.08.2026', 'Revolut', 'IncomeTransfer', '96.025', 'EUR', '4990', 'UAH', ''],
  ]);
  assert.equal(out.transfersMatched, 2);
  assert.equal(out.transfersToClosed, 0);
  const names = new Map(out.newWallets.map((w) => [w.id, w.name]));
  const seen = out.tx.map((t) => `${names.get(t.walletId)}>${names.get(t.toWalletId)}`).sort();
  assert.deepEqual(seen, ['Cash>EUR card', 'EUR card>Revolut']);
});

test('a transfer whose other account no longer exists keeps the balance using a hidden wallet', () => {
  const { out } = importMonefy([
    ['05.05.2026', 'Готівка', 'ExpenseTransfer', '-1000', 'UAH', '-1000', 'UAH', ''],
    ['06.05.2026', 'Доларова', 'IncomeTransfer', '500', 'USD', '22000', 'UAH', ''],
  ]);
  assert.equal(out.transfersMatched, 0);
  assert.equal(out.transfersToClosed, 2);
  const hidden = out.newWallets.filter((w) => w.archived);
  assert.deepEqual(hidden.map((w) => [w.name, w.currency]).sort(), [['Closed wallets (UAH)', 'UAH'], ['Closed wallets (USD)', 'USD']]);
  const state = { wallets: out.newWallets, tx: out.tx };
  const b = C.balances(state);
  assert.equal(b.get(out.newWallets.find((w) => w.name === 'Cash').id), -100000);
  assert.equal(b.get(out.newWallets.find((w) => w.name === 'USD card').id), 50000);
});

test('Monefy opening balances set the wallet balance instead of counting as income', () => {
  const { out } = importMonefy([
    ['26.10.2022', 'Euro', 'InitialBalance', '50', 'EUR', '2000', 'UAH', ''],
    ['27.10.2022', 'Euro', 'Food', '-1.6', 'EUR', '-65', 'UAH', ''],
  ]);
  const euro = out.newWallets[0];
  assert.equal(out.openings.get(euro.id), 5000);
  assert.equal(out.tx.length, 1);
  assert.equal(out.tx[0].amount, 160, 'the dot is read as a decimal from the whole column');
});

test('Ukrainian and Monefy names become English and join the matching defaults', () => {
  const state = C.defaultState('2026-01-01');
  const { out } = importMonefy([
    ['01.01.2026', 'Готівка', 'Донати', '-1', 'UAH', '-1', 'UAH', ''],
    ['01.01.2026', 'Депозит 2', "Зв'язок", '-1', 'UAH', '-1', 'UAH', ''],
    ['01.01.2026', 'Готівка', 'Зв’язок', '-1', 'UAH', '-1', 'UAH', ''],
    ['01.01.2026', 'Готівка', 'Food', '-1', 'UAH', '-1', 'UAH', ''],
    ['01.01.2026', 'Готівка', 'Подарунки', '5', 'UAH', '5', 'UAH', ''],
    ['01.01.2026', 'Готівка', 'Partner', '-1', 'UAH', '-1', 'UAH', ''],
    ['01.01.2026', 'Готівка', 'Щось нове', '-1', 'UAH', '-1', 'UAH', ''],
  ], state);
  const name = (id) => [...state.categories, ...out.newCategories].find((c) => c.id === id);
  assert.deepEqual(out.tx.map((t) => name(t.categoryId).name), ['Donations', 'Phone & internet', 'Phone & internet', 'Groceries', 'Gifts', 'Partner', 'Щось нове']);
  assert.equal(name(out.tx[4].categoryId).kind, 'income', 'a name used for both kinds stays separate');
  assert.deepEqual(out.newCategories.map((c) => [c.name, c.icon]), [['Partner', 'heart'], ['Щось нове', 'tag']]);
  assert.deepEqual(out.newWallets.map((w) => [w.name, w.icon]), [['Cash', 'banknote'], ['Deposit 2', 'landmark']]);
});

test('imported wallets list the busiest first and hidden ones last', () => {
  const { out } = importMonefy([
    ['01.01.2026', 'Quiet', 'Food', '-1', 'USD', '-1', 'UAH', ''],
    ['01.01.2026', 'Quiet', 'ExpenseTransfer', '-1', 'USD', '-40', 'UAH', 'gone'],
    ['01.01.2026', 'Busy', 'Food', '-1', 'USD', '-1', 'UAH', ''],
    ['02.01.2026', 'Busy', 'Food', '-1', 'USD', '-1', 'UAH', ''],
    ['03.01.2026', 'Busy', 'Food', '-1', 'USD', '-1', 'UAH', ''],
  ]);
  assert.deepEqual(out.newWallets.map((w) => w.name), ['Busy', 'Quiet', 'Closed wallets (USD)']);
});

test('wallet presets use real icons and colors', () => {
  for (const [name, , color] of C.WALLET_PRESETS) assert.ok(C.COLOR_KEYS.includes(color), name);
});

test('a correction brings a wallet to the real balance and keeps every old entry', () => {
  const state = multiCurrencyState();
  state.tx.push({ id: 't', date: '2020-01-01', type: 'expense', amount: 2500, walletId: 'eur', categoryId: 'c0', note: 'old' });
  const old = JSON.stringify(state.tx);

  const added = C.correctBalances(state, { eur: 90000, usd: 60000 }, '2026-11-06', 'Counted my cash');

  assert.equal(JSON.stringify(state.tx.slice(0, 1)), JSON.stringify(JSON.parse(old)));
  assert.equal(C.balances(state).get('eur'), 90000);
  assert.equal(C.balances(state).get('usd'), 60000);
  assert.deepEqual(added.map((t) => [t.walletId, t.increase, t.amount, t.before, C.balanceAfter(t), t.date, t.note]), [
    ['eur', false, 7500, 97500, 90000, '2026-11-06', 'Counted my cash'],
    ['usd', true, 10000, 50000, 60000, '2026-11-06', 'Counted my cash'],
  ]);
});

test('a wallet already at the right balance gets no correction', () => {
  const state = multiCurrencyState();
  assert.deepEqual(C.correctBalances(state, { eur: 100000 }, '2026-11-06', ''), []);
  assert.equal(state.tx.length, 0);
});

test('a wallet can be corrected to zero or below', () => {
  const state = multiCurrencyState();
  C.correctBalances(state, { eur: 0, usd: -500 }, '2026-11-06', '');
  assert.equal(C.balances(state).get('eur'), 0);
  assert.equal(C.balances(state).get('usd'), -500);
});

test('corrections change totals but never count as income or spending', () => {
  const state = multiCurrencyState();
  const before = C.netWorth(state).total;
  C.correctBalances(state, { eur: 110000, usd: 40000 }, '2026-11-06', '');
  const s = C.summarize(state, state.tx);
  assert.deepEqual([s.income, s.expense, s.byCategory.size], [0, 0, 0]);
  assert.equal(C.trend(state, '2026-11', 1)[0].expense, 0);
  assert.equal(C.netWorth(state).total, before + 10000 - 9000);
});

test('deleting a correction puts the balance back', () => {
  const state = multiCurrencyState();
  const [added] = C.correctBalances(state, { eur: 1 }, '2026-11-06', '');
  state.tx = state.tx.filter((t) => t.id !== added.id);
  assert.equal(C.balances(state).get('eur'), 100000);
});

test('a correction keeps the balance seen at the time, even if older entries are added later', () => {
  const state = multiCurrencyState();
  const [added] = C.correctBalances(state, { eur: 90000 }, '2026-11-06', '');
  state.tx.push({ id: 'late', date: '2026-01-01', type: 'expense', amount: 1000, walletId: 'eur', categoryId: 'c0', note: '' });
  assert.equal(added.before, 100000);
  assert.equal(C.balanceAfter(added), 90000);
  assert.equal(C.balances(state).get('eur'), 89000);
});

test('corrections survive a backup and bad ones are rejected', () => {
  const state = multiCurrencyState();
  const [added] = C.correctBalances(state, { eur: 90000 }, '2026-11-06', 'n');
  const copy = C.validateBackup(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(copy.tx.at(-1), added);
  assert.equal(C.balances(copy).get('eur'), 90000);
  assert.throws(() => C.validateBackup({ ...state, tx: [{ ...added, increase: 'yes' }] }));
  assert.throws(() => C.validateBackup({ ...state, tx: [{ id: 'x', date: '2026-11-06', type: 'adjustment', amount: 5, increase: true, walletId: 'eur' }] }));
});

test('CSV export shows corrections signed, and importing that file skips and reports them', () => {
  const state = multiCurrencyState();
  C.correctBalances(state, { eur: 90000, usd: 60000 }, '2026-11-06', 'n');
  const csv = C.toCSV(state);
  assert.match(csv, /2026-11-06,adjustment,Main,-100\.00,EUR/);
  assert.match(csv, /2026-11-06,adjustment,Car,100\.00,USD/);

  const [headers, ...rows] = C.parseCSV(csv);
  const out = C.buildImport(rows, C.guessMapping(headers), 'ymd', state.categories, state.wallets, 'eur');
  assert.equal(out.tx.length, 0);
  assert.equal(out.corrections, 2);
});

function foreignRule(extra = {}) {
  return { id: 'r', start: '2026-10-15', freq: 'monthly', lastRun: null, type: 'expense', amount: 1, foreignAmount: 2000, foreignCurrency: 'USD', walletId: 'eur', categoryId: 'c0', note: 'Spotify', ...extra };
}

test('a foreign-priced rule takes the current rate on each due date, and the charge changes with it', () => {
  const state = multiCurrencyState(); // the EUR wallet, with 1 USD = 0.9 EUR
  state.recurring.push(foreignRule());

  assert.equal(C.applyRecurring(state, '2026-10-20'), 1);
  assert.deepEqual([state.tx[0].amount, state.tx[0].foreignAmount, state.tx[0].foreignCurrency], [1800, 2000, 'USD']);

  state.rates.USD = 1; // the dollar got stronger
  assert.equal(C.applyRecurring(state, '2026-11-20'), 1);
  assert.equal(state.tx[1].amount, 2000);
  assert.equal(state.tx[0].amount, 1800, 'past payments keep what they really took');
});

test('a rule with its own rate ignores market rates', () => {
  const state = multiCurrencyState();
  state.recurring.push(foreignRule({ fixedRate: 1.5 }));
  C.applyRecurring(state, '2026-10-20');
  assert.equal(state.tx[0].amount, 3000);
  state.rates.USD = 100;
  assert.equal(C.ruleCharge(state, state.recurring[0]), 3000);
});

test('with no rate anywhere, a rule repeats its last charge instead of failing', () => {
  const state = multiCurrencyState();
  delete state.rates.USD;
  state.recurring.push(foreignRule({ amount: 1234 }));
  assert.equal(C.applyRecurring(state, '2026-10-20'), 1);
  assert.equal(state.tx[0].amount, 1234);
  assert.equal(state.tx[0].foreignAmount, 2000);
});

test('rates work when the wallet currency differs from the display currency', () => {
  const state = multiCurrencyState();
  state.recurring.push(foreignRule({ walletId: 'idr' }));
  assert.equal(C.ruleCharge(state, state.recurring[0]), 36000000); // $20 at 18,000 IDR per USD
});

test('plain rules are untouched and have no foreign fields', () => {
  const state = multiCurrencyState();
  state.recurring.push({ id: 'p', start: '2026-10-15', freq: 'monthly', lastRun: null, type: 'expense', amount: 500, walletId: 'eur', categoryId: 'c0', note: '' });
  C.applyRecurring(state, '2026-10-20');
  assert.equal(state.tx[0].amount, 500);
  assert.equal('foreignAmount' in state.tx[0], false);
});

test('a foreign price only affects the money taken: balances and spending use the wallet amount', () => {
  const state = multiCurrencyState();
  state.tx.push({ id: 't', date: '2026-11-01', type: 'expense', amount: 1800, foreignAmount: 2000, foreignCurrency: 'USD', walletId: 'eur', categoryId: 'c0', note: '' });
  assert.equal(C.balances(state).get('eur'), 100000 - 1800);
  assert.equal(C.summarize(state, state.tx).expense, 1800);
});

test('foreign prices survive a backup, and bad ones are rejected', () => {
  const state = multiCurrencyState();
  state.recurring.push(foreignRule({ fixedRate: 1.5 }));
  C.applyRecurring(state, '2026-10-20');
  const copy = C.validateBackup(JSON.parse(JSON.stringify(state)));
  assert.equal(copy.tx[0].foreignAmount, 2000);
  assert.equal(copy.recurring[0].fixedRate, 1.5);

  const bad = (change) => JSON.parse(JSON.stringify({ ...state, ...change }));
  assert.throws(() => C.validateBackup(bad({ tx: [{ ...state.tx[0], foreignCurrency: 'dollars' }] })));
  assert.throws(() => C.validateBackup(bad({ tx: [{ ...state.tx[0], foreignAmount: -5 }] })));
  assert.throws(() => C.validateBackup(bad({ recurring: [foreignRule({ fixedRate: -1 })] })));
});

test('CSV export includes the foreign price, and the extra columns still import correctly', () => {
  const state = multiCurrencyState();
  state.tx.push({ id: 't', date: '2026-11-01', type: 'expense', amount: 1800, foreignAmount: 2000, foreignCurrency: 'USD', walletId: 'eur', categoryId: 'c0', note: 'Spotify' });
  const csv = C.toCSV(state);
  assert.match(csv, /2026-11-01,expense,Main,18\.00,EUR,Groceries,Spotify,,,,20\.00,USD/);

  const [headers, ...rows] = C.parseCSV(csv);
  const out = C.buildImport(rows, C.guessMapping(headers), 'ymd', state.categories, state.wallets, 'eur');
  assert.deepEqual([out.tx[0].amount, out.tx[0].walletId, out.mismatched], [1800, 'eur', 0]);
});

function plannedState() {
  const state = multiCurrencyState(); // the EUR wallet, with 1 USD = 0.9 EUR
  state.recurring.push(foreignRule({ start: '2026-10-15', lastRun: '2026-10-15' }));
  state.recurring.push({ id: 'phone', start: '2026-10-24', freq: 'fourWeeks', lastRun: '2026-10-24', type: 'expense', amount: 500, walletId: 'eur', categoryId: 'c0', note: 'Phone' });
  return state;
}

test('next month shows every recurring payment, using today\'s rate', () => {
  const list = C.plannedEntries(plannedState(), '2026-12', '2026-11-06');
  assert.deepEqual(list.map((t) => [t.date, t.amount, t.note, t.estimated, t.planned]), [
    ['2026-12-15', 1800, 'Spotify', true, true],
    ['2026-12-19', 500, 'Phone', false, true],
  ]);
  assert.deepEqual([list[0].foreignAmount, list[0].foreignCurrency], [2000, 'USD']);
});

test('a planned amount follows today\'s rate until the payment really happens', () => {
  const state = plannedState();
  state.rates.USD = 1;
  assert.equal(C.plannedEntries(state, '2026-12', '2026-11-06')[0].amount, 2000);
});

test('a rule with its own rate plans at that rate and is not marked as an estimate', () => {
  const state = multiCurrencyState();
  state.recurring.push(foreignRule({ fixedRate: 1.5, lastRun: '2026-10-15' }));
  const [t] = C.plannedEntries(state, '2026-12', '2026-11-06');
  assert.deepEqual([t.amount, t.estimated], [3000, false]);
});

test('this month shows only payments still to come, and past months show none', () => {
  const state = plannedState();
  assert.deepEqual(C.plannedEntries(state, '2026-11', '2026-11-16').map((t) => t.date), ['2026-11-21']);
  assert.deepEqual(C.plannedEntries(state, '2026-11', '2026-11-06').map((t) => t.date), ['2026-11-15', '2026-11-21']);
  assert.deepEqual(C.plannedEntries(state, '2026-10', '2026-11-06'), []);
});

test('a payment that already happened is never also planned, and today counts as happened', () => {
  const state = plannedState();
  C.applyRecurring(state, '2026-11-15');
  assert.deepEqual(C.plannedEntries(state, '2026-11', '2026-11-15').map((t) => t.note), ['Phone']);
});

test('planning changes nothing: no stored entries, and balances stay the same', () => {
  const state = plannedState();
  const before = JSON.stringify(state);
  C.plannedEntries(state, '2027-06', '2026-11-06');
  C.trend(state, '2027-06', 6, '2026-11-06');
  assert.equal(JSON.stringify(state), before);
});

test('rules starting later appear only from their first date', () => {
  const state = multiCurrencyState();
  state.recurring.push({ id: 'y', start: '2027-02-10', freq: 'yearly', lastRun: null, type: 'income', amount: 700, walletId: 'eur', categoryId: 'c10', note: '' });
  assert.deepEqual(C.plannedEntries(state, '2027-01', '2026-11-06'), []);
  assert.equal(C.plannedEntries(state, '2027-02', '2026-11-06')[0].date, '2027-02-10');
  assert.deepEqual(C.plannedEntries(state, '2027-03', '2026-11-06'), []);
});

test('planned entries total up, and only future months count them in the trend', () => {
  const state = plannedState();
  const s = C.summarize(state, C.plannedEntries(state, '2026-12', '2026-11-06'));
  assert.equal(s.expense, 2300);
  assert.equal(s.byCategory.get('c0'), 2300);

  const rows = C.trend(state, '2026-12', 3, '2026-11-06');
  assert.deepEqual(rows.map((r) => [r.key, r.expense, r.planned]), [
    ['2026-10', 0, false],
    ['2026-11', 0, false],
    ['2026-12', 2300, true],
  ]);
});
