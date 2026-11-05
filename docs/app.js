import * as C from './core.js';

const KEY = 'budget.v1';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'UAH', 'PLN', 'CZK', 'CHF', 'SEK', 'NOK', 'DKK', 'CAD', 'AUD', 'JPY'];
const BACKUP_REMINDER_DAYS = 30;
const SEARCH_LIMIT = 200;
const TREND_MONTHS = 6;

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
    return C.validateBackup(JSON.parse(raw));
  } catch {
    // Never overwrite data we could not read: park it under another key.
    localStorage.setItem(`${KEY}.unreadable`, raw);
    return C.defaultState(today());
  }
}

let state = load();
const ui = { tab: 'home', month: C.monthOf(today()), search: '', filterCat: '', sheet: null };

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

// ---------- Formatting ----------

const money = (cents) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).format(cents / 100);
const moneyCompact = (cents) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: state.currency,
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(cents / 100);
const monthDate = (key) => C.fromISO(`${key}-01`);
const monthLabel = (key) =>
  monthDate(key).toLocaleDateString('en', { month: 'long', year: 'numeric' });
const monthShort = (key) => monthDate(key).toLocaleDateString('en', { month: 'short' });
const shortDate = (iso) =>
  C.fromISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

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
};

// ---------- Shared pieces ----------

const monthNav = () => {
  const atCurrent = ui.month >= C.monthOf(today());
  return html`<div class="month-nav">
    <button class="icon-btn" data-a="monthPrev" aria-label="Previous month">${svg(ICONS.left)}</button>
    <h1>${monthLabel(ui.month)}</h1>
    <button class="icon-btn" data-a="monthNext" aria-label="Next month" ${atCurrent ? 'disabled' : ''}>${svg(ICONS.right)}</button>
  </div>`;
};

const txRow = (t) => {
  const c = category(t.categoryId);
  return html`<button class="tx" data-a="editTx" data-id="${t.id}">
    <span class="tx-icon" aria-hidden="true">${c.icon}</span>
    <span class="tx-main">
      <div class="tx-title">${t.note || c.name}</div>
      <div class="tx-sub">${t.note ? c.name : ''}${t.recurringId ? `${t.note ? ' · ' : ''}Recurring` : ''}</div>
    </span>
    <span class="tx-amount ${t.type}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span>
  </button>`;
};

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

function viewHome() {
  const list = C.sortTx(C.txInMonth(state.tx, ui.month));
  const { income, expense } = C.totals(list);
  const spent = C.spentByCategory(list);
  const limited = state.categories
    .filter((c) => c.kind === 'expense' && c.limit && !c.archived)
    .map((c) => ({ c, spent: spent.get(c.id) || 0 }))
    .sort((a, b) => b.spent / b.c.limit - a.spent / a.c.limit);
  const totalLimit = limited.reduce((sum, x) => sum + x.c.limit, 0);
  const limitedSpent = limited.reduce((sum, x) => sum + x.spent, 0);
  const net = income - expense;

  return html`${banners()}${monthNav()}
    <section class="card">
      <div>
        <div class="hero-label">Spent</div>
        <div class="hero-amount">${money(expense)}</div>
      </div>
      ${totalLimit > 0 && html`${budgetBar(limitedSpent, totalLimit)}
        <div class="small">${leftText(limitedSpent, totalLimit)} of ${money(totalLimit)} budgeted</div>`}
      <div class="stats">
        <div><div class="small">Income</div><div class="stat-value">${money(income)}</div></div>
        <div><div class="small">Net</div><div class="stat-value">${net < 0 ? '−' : ''}${money(Math.abs(net))}</div></div>
      </div>
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
                <span class="budget-name">${x.c.icon} ${x.c.name}</span>
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
  if (q) {
    list = list.filter((t) => `${t.note || ''} ${category(t.categoryId).name}`.toLowerCase().includes(q));
  }
  const sorted = C.sortTx(list);
  const shown = sorted.slice(0, q ? SEARCH_LIMIT : undefined);
  if (!shown.length) return html`<div class="card card-flush"><p class="empty">No matching entries.</p></div>`;
  return html`<div class="card card-flush">${txGroups(shown)}</div>
    ${sorted.length > shown.length && html`<p class="small">Showing the latest ${shown.length} of ${sorted.length}.</p>`}`;
}

function viewActivity() {
  return html`${!ui.search.trim() && monthNav()}
    <div class="filters">
      <input id="search" class="input" type="search" placeholder="Search all months" aria-label="Search all months" value="${ui.search}">
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

function viewInsights() {
  const list = C.txInMonth(state.tx, ui.month);
  const spent = [...C.spentByCategory(list)]
    .map(([id, amount]) => ({ c: category(id), amount }))
    .sort((a, b) => b.amount - a.amount);
  const total = spent.reduce((sum, x) => sum + x.amount, 0);
  const top = spent[0]?.amount || 1;
  const rows = C.trend(state.tx, trendEnd(), TREND_MONTHS);
  const chosen = rows.find((r) => r.key === ui.month);

  return html`${monthNav()}
    <section class="card">
      <div class="row-between">
        <h2 class="section-title">Spending</h2>
        <span class="small">${money(total)}</span>
      </div>
      ${spent.length
        ? spent.map(
            (x) => html`<button class="cat-bar" data-a="openCat" data-id="${x.c.id}">
              <div class="row-between">
                <span class="budget-name">${x.c.icon} ${x.c.name}</span>
                <span class="small">${money(x.amount)} · ${x.amount / total < 0.01 ? '<1' : Math.round((x.amount / total) * 100)}%</span>
              </div>
              <div class="bar"><i style="width:${((x.amount / top) * 100).toFixed(1)}%"></i></div>
            </button>`,
          )
        : html`<p class="small">No spending this month.</p>`}
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

function viewSettings() {
  const currencies = CURRENCIES.includes(state.currency) ? CURRENCIES : [state.currency, ...CURRENCIES];
  return html`<h1 class="section-title" style="font-size:28px">Settings</h1>
    <section class="card card-flush">
      <label class="set-row"><span>Currency</span>
        <select class="input" data-change="currency" aria-label="Currency">
          ${currencies.map((c) => html`<option ${c === state.currency ? 'selected' : ''}>${c}</option>`)}
        </select>
      </label>
      <button class="set-row" data-a="openCategories"><span>Categories and limits</span><span class="chev">›</span></button>
      <button class="set-row" data-a="openRecurring"><span>Recurring</span>
        <span class="value">${state.recurring.length} ›</span></button>
    </section>

    <section class="card card-flush">
      <button class="set-row" data-a="exportCsv"><span>Export to CSV</span><span class="value">For spreadsheets</span></button>
      <button class="set-row" data-a="backup"><span>Back up everything</span>
        <span class="value">${state.lastBackup ? `Last: ${shortDate(state.lastBackup.slice(0, 10))}` : 'Never'}</span></button>
      <label class="set-row" for="restore-json"><span>Restore from backup</span><span class="chev">›</span></label>
      <label class="set-row" for="import-csv"><span>Import from another app (CSV)</span><span class="chev">›</span></label>
    </section>
    <p class="small">${state.tx.length} ${state.tx.length === 1 ? 'entry' : 'entries'}, stored only on this device. Nothing is sent anywhere. Deleting the app deletes this data, so keep a backup in Files or iCloud Drive.</p>`;
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

function sheetTx(s) {
  const f = s.form;
  const cats = activeCategories(f.type);
  const current = category(f.categoryId);
  // An archived category stays selectable when editing an old entry that uses it.
  const choices = current && current.kind === f.type && current.archived ? [...cats, current] : cats;
  return html`${sheetHead(s.id ? 'Edit entry' : 'New entry', 'closeSheet', 'Cancel', 'saveTx')}
    <div class="sheet-body">
      ${seg('txType', f.type, TYPE_OPTIONS)}
      <input id="f-amount" class="amount-input" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Amount" value="${f.amount}">
      ${s.error && html`<p class="error">${s.error}</p>`}
      <div class="cat-grid">${choices.map(
        (c) => html`<button type="button" class="cat" data-a="txCat" data-id="${c.id}" aria-pressed="${c.id === f.categoryId}">
          <b aria-hidden="true">${c.icon}</b>${c.name}</button>`,
      )}</div>
      <label class="field"><span>Date</span><input id="f-date" class="input" type="date" value="${f.date}"></label>
      <label class="field"><span>Note (optional)</span><input id="f-note" class="input" maxlength="120" value="${f.note}"></label>
      ${s.id && html`<button class="btn btn-danger" data-a="deleteTx">Delete entry</button>`}
    </div>`;
}

function sheetCategories(s) {
  const list = state.categories.filter((c) => c.kind === s.kind);
  const sorted = [...list.filter((c) => !c.archived), ...list.filter((c) => c.archived)];
  return html`${sheetHead('Categories', 'closeSheet', 'Done')}
    <div class="sheet-body">
      ${seg('catKind', s.kind, TYPE_OPTIONS)}
      <div class="card card-flush">${sorted.map(
        (c) => html`<button class="set-row" data-a="editCategory" data-id="${c.id}">
          <span>${c.icon} ${c.name}</span>
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
      <div style="display:grid;grid-template-columns:80px 1fr;gap:12px">
        <label class="field"><span>Icon</span><input id="f-icon" class="input" style="text-align:center" maxlength="8" value="${f.icon}"></label>
        <label class="field"><span>Name</span><input id="f-name" class="input" maxlength="40" value="${f.name}"></label>
      </div>
      ${s.kind === 'expense' && html`<label class="field"><span>Monthly limit (optional)</span>
        <input id="f-limit" class="input" inputmode="decimal" autocomplete="off" placeholder="No limit" value="${f.limit}"></label>`}
      ${s.id && html`<button class="btn" data-a="toggleArchive">${f.archived ? 'Show category again' : 'Hide category'}</button>
        <p class="small">Hiding removes it from the picker. Past entries keep it.</p>`}
    </div>`;
}

const FREQ_LABEL = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

function sheetRecurring() {
  return html`${sheetHead('Recurring', 'closeSheet', 'Done')}
    <div class="sheet-body">
      ${state.recurring.length
        ? html`<div class="card card-flush">${state.recurring.map((r) => {
            const c = category(r.categoryId);
            return html`<button class="tx" data-a="editRule" data-id="${r.id}">
              <span class="tx-icon" aria-hidden="true">${c.icon}</span>
              <span class="tx-main">
                <div class="tx-title">${r.note || c.name}</div>
                <div class="tx-sub">${FREQ_LABEL[r.freq]} · next ${shortDate(C.nextOccurrence(r))}</div>
              </span>
              <span class="tx-amount ${r.type}">${r.type === 'income' ? '+' : '−'}${money(r.amount)}</span>
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
      <label class="field"><span>Amount</span><input id="f-amount" class="input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${f.amount}"></label>
      <label class="field"><span>Category</span>
        <select id="f-cat" class="input">${activeCategories(f.type).map(
          (c) => html`<option value="${c.id}" ${c.id === f.categoryId ? 'selected' : ''}>${c.icon} ${c.name}</option>`,
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
  const fields = [['date', 'Date'], ['amount', 'Amount'], ['category', 'Category'], ['type', 'Income or expense'], ['note', 'Note']];
  const result = C.buildImport(s.rows, s.map, s.fmt, state.categories);
  const fits = C.detectDateFormats(s.map.date >= 0 ? s.rows.map((r) => r[s.map.date]) : []);
  const ready = s.map.date >= 0 && s.map.amount >= 0 && result.tx.length > 0;
  return html`${sheetHead('Import CSV', 'closeSheet', 'Cancel', ready && 'confirmImport', 'Import')}
    <div class="sheet-body">
      <p class="small">Match your file's columns. ${s.rows.length} rows found.</p>
      <div class="card">
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
        <strong>${result.tx.length} entries ready${result.skipped ? `, ${result.skipped} rows skipped (no valid date or amount)` : ''}</strong>
        ${result.newCategories.length > 0 && html`<p class="small">New categories: ${result.newCategories.map((c) => c.name).join(', ')}</p>`}
        <div class="preview">${result.tx.slice(0, 4).map((t) => {
          const name = result.newCategories.find((c) => c.id === t.categoryId)?.name || category(t.categoryId).name;
          return html`<div><span>${shortDate(t.date)} · ${name}${t.note ? ` · ${t.note}` : ''}</span>
            <span>${t.type === 'income' ? '+' : '−'}${money(t.amount)}</span></div>`;
        })}</div>
      </div>
    </div>`;
}

const SHEETS = {
  tx: sheetTx,
  categories: sheetCategories,
  category: sheetCategory,
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
  openSheet({ type: 'import', headers, rows, map, fmt: fits[0] || 'ymd' });
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
  render();
  toast(`Restored ${next.tx.length} entries.`, before);
}

// ---------- Actions ----------

function readTxForm() {
  const f = ui.sheet.form;
  f.amount = $('f-amount').value;
  f.date = $('f-date').value;
  f.note = $('f-note').value;
}

function readRuleForm() {
  const f = ui.sheet.form;
  f.amount = $('f-amount').value;
  f.categoryId = $('f-cat').value;
  f.note = $('f-note').value;
  f.freq = $('f-freq').value;
  f.start = $('f-date').value;
}

const openCategoryList = (kind = 'expense') => openSheet({ type: 'categories', kind });

const actions = {
  tab({ tab }) {
    ui.tab = tab;
    ui.sheet = null;
    render();
    scrollTo(0, 0);
  },
  monthPrev() {
    ui.month = C.addMonths(ui.month, -1);
    render();
  },
  monthNext() {
    ui.month = C.addMonths(ui.month, 1);
    render();
  },
  pickMonth({ key }) {
    ui.month = key;
    render();
  },
  openCat({ id }) {
    ui.filterCat = id;
    ui.search = '';
    actions.tab({ tab: 'activity' });
  },
  closeSheet() {
    ui.sheet = null;
    render();
  },

  // Entries
  newTx() {
    openSheet({
      type: 'tx',
      form: { type: 'expense', amount: '', categoryId: null, date: today(), note: '' },
    });
    $('f-amount').focus();
  },
  editTx({ id }) {
    const t = state.tx.find((x) => x.id === id);
    openSheet({
      type: 'tx',
      id,
      form: { type: t.type, amount: C.centsToInput(t.amount), categoryId: t.categoryId, date: t.date, note: t.note || '' },
    });
  },
  txType({ v }) {
    readTxForm();
    const f = ui.sheet.form;
    if (f.type !== v) f.categoryId = null;
    f.type = v;
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
    if (!amount) s.error = 'Enter an amount.';
    else if (!f.categoryId) s.error = 'Pick a category.';
    else if (!f.date) s.error = 'Pick a date.';
    else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = { date: f.date, type: f.type, amount, categoryId: f.categoryId, note: f.note.trim() };
    if (s.id) Object.assign(state.tx.find((t) => t.id === s.id), data);
    else state.tx.push({ id: C.uid(), ...data });
    save();
    ui.month = C.monthOf(f.date);
    ui.sheet = null;
    render();
    toast(s.id ? 'Entry updated.' : `Added ${money(amount)}.`);
  },
  deleteTx() {
    const before = snapshot();
    state.tx = state.tx.filter((t) => t.id !== ui.sheet.id);
    save();
    ui.sheet = null;
    render();
    toast('Entry deleted.', before);
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
      form: { icon: '🏷️', name: '', limit: '', archived: false },
    });
  },
  editCategory({ id }) {
    const c = category(id);
    openSheet({
      type: 'category',
      id,
      kind: c.kind,
      form: { icon: c.icon, name: c.name, limit: c.limit ? C.centsToInput(c.limit) : '', archived: c.archived },
    });
  },
  saveCategory() {
    const s = ui.sheet;
    const name = $('f-name').value.trim();
    const icon = $('f-icon').value.trim() || '🏷️';
    const limitText = s.kind === 'expense' ? $('f-limit').value.trim() : '';
    const limit = limitText ? Math.abs(C.parseAmount(limitText) ?? 0) : null;
    s.form = { ...s.form, name, icon, limit: limitText };
    if (!name) s.error = 'Enter a name.';
    else if (limitText && !limit) s.error = 'Enter a valid limit, or leave it empty.';
    else if (state.categories.some((c) => c.kind === s.kind && c.id !== s.id && c.name.toLowerCase() === name.toLowerCase())) {
      s.error = 'A category with this name already exists.';
    } else s.error = null;
    if (s.error) {
      render();
      return;
    }
    const data = { name, icon, limit, archived: s.form.archived };
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

  // Recurring
  openRecurring() {
    openSheet({ type: 'recurring' });
  },
  newRule() {
    openSheet({
      type: 'rule',
      form: {
        type: 'expense',
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
      form: { type: r.type, amount: C.centsToInput(r.amount), categoryId: r.categoryId, note: r.note, freq: r.freq, start: r.start },
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
    const data = { type: f.type, amount, categoryId: f.categoryId, note: f.note.trim(), freq: f.freq, start: f.start };
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
    const { tx, newCategories } = C.buildImport(s.rows, s.map, s.fmt, state.categories);
    state.categories.push(...newCategories);
    state.tx.push(...tx);
    save();
    ui.sheet = null;
    ui.tab = 'home';
    ui.month = C.monthOf(C.sortTx(tx)[0].date);
    render();
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
  currency(el) {
    state.currency = el.value;
    save();
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
  if (document.visibilityState === 'visible' && !ui.sheet && runRecurring()) render();
});

const added = runRecurring();
render();
if (added) toast(`Added ${added} recurring ${added === 1 ? 'entry' : 'entries'}.`);

navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
