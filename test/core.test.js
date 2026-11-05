import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../docs/core.js';

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

test('applyRecurring backfills once and never duplicates', () => {
  const state = C.defaultState('2026-01-01');
  state.recurring.push({
    id: 'r1',
    start: '2026-09-15',
    freq: 'monthly',
    lastRun: null,
    type: 'expense',
    amount: 5000,
    categoryId: 'c3',
    note: 'Rent',
  });
  assert.equal(C.applyRecurring(state, '2026-11-14'), 2);
  assert.deepEqual(state.tx.map((t) => t.date), ['2026-09-15', '2026-10-15']);
  assert.equal(C.applyRecurring(state, '2026-11-14'), 0);
  assert.equal(C.applyRecurring(state, '2026-11-15'), 1);
  assert.equal(state.tx.length, 3);
  assert.equal(state.tx[2].recurringId, 'r1');
});

test('totals, category spend and trend', () => {
  const tx = [
    { date: '2026-11-01', type: 'expense', amount: 100, categoryId: 'a' },
    { date: '2026-11-02', type: 'expense', amount: 50, categoryId: 'a' },
    { date: '2026-11-03', type: 'income', amount: 900, categoryId: 'b' },
    { date: '2026-10-31', type: 'expense', amount: 7, categoryId: 'a' },
  ];
  const nov = C.txInMonth(tx, '2026-11');
  assert.deepEqual(C.totals(nov), { income: 900, expense: 150 });
  assert.equal(C.spentByCategory(nov).get('a'), 150);
  assert.deepEqual(C.trend(tx, '2027-01', 4).map((r) => [r.key, r.expense]), [
    ['2026-10', 7],
    ['2026-11', 150],
    ['2026-12', 0],
    ['2027-01', 0],
  ]);
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

test('exported CSV re-imports to the same data, including tricky notes', () => {
  const state = C.defaultState('2026-01-01');
  state.tx.push(
    { id: '1', date: '2026-11-02', type: 'expense', amount: 1999, categoryId: 'c0', note: 'Milk, "organic"' },
    { id: '2', date: '2026-11-01', type: 'income', amount: 500000, categoryId: 'c10', note: '=HYPERLINK("x")' },
  );
  const csv = C.toCSV(state);
  assert.match(csv, /'=HYPERLINK/, 'formula is neutralised for spreadsheets');

  const [headers, ...rows] = C.parseCSV(csv);
  const map = C.guessMapping(headers);
  assert.deepEqual(C.detectDateFormats(rows.map((r) => r[map.date])), ['ymd']);
  const out = C.buildImport(rows, map, 'ymd', state.categories);
  assert.equal(out.skipped, 0);
  assert.deepEqual(out.newCategories, []);
  assert.deepEqual(
    out.tx.map((t) => [t.date, t.type, t.amount, t.categoryId, t.note]),
    [
      ['2026-11-02', 'expense', 1999, 'c0', 'Milk, "organic"'],
      ['2026-11-01', 'income', 500000, 'c10', '=HYPERLINK("x")'],
    ],
  );
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
  const cats = C.defaultState('2026-01-01').categories;
  const map = { date: 0, amount: 1, category: 2, note: 3, type: -1 };
  const rows = [
    ['2026-11-01', '-12.50', 'groceries', 'Shop'],
    ['2026-11-02', '1000', 'Salary', ''],
    ['2026-11-03', '-3', 'Pets', ''],
    ['bad date', '-3', 'Pets', ''],
    ['2026-11-04', 'n/a', 'Pets', ''],
  ];
  const out = C.buildImport(rows, map, 'ymd', cats);
  assert.equal(out.skipped, 2);
  assert.deepEqual(out.tx.map((t) => [t.type, t.amount]), [
    ['expense', 1250],
    ['income', 100000],
    ['expense', 300],
  ]);
  assert.equal(out.tx[0].categoryId, 'c0', 'category match ignores case');
  assert.deepEqual(out.newCategories.map((c) => c.name), ['Pets']);
});

test('positive-only file with a type column uses the column', () => {
  const cats = C.defaultState('2026-01-01').categories;
  const map = { date: 0, amount: 1, category: -1, note: -1, type: 2 };
  const out = C.buildImport(
    [['2026-11-01', '10', 'Expense'], ['2026-11-02', '20', 'Income'], ['2026-11-03', '30', '']],
    map,
    'ymd',
    cats,
  );
  assert.deepEqual(out.tx.map((t) => t.type), ['expense', 'income', 'expense']);
});

test('validateBackup accepts real state and rejects bad files', () => {
  const good = C.defaultState('2026-01-01');
  good.tx.push({ id: '1', date: '2026-11-02', type: 'expense', amount: 100, categoryId: 'c0', note: '' });
  assert.ok(C.validateBackup(JSON.parse(JSON.stringify(good))));

  assert.throws(() => C.validateBackup({ hello: 1 }));
  assert.throws(() => C.validateBackup(null));
  assert.throws(() => C.validateBackup({ ...good, tx: [{ ...good.tx[0], amount: 1.5 }] }));
  assert.throws(() => C.validateBackup({ ...good, tx: [{ ...good.tx[0], categoryId: 'nope' }] }));
});
