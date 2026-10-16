'use strict';

// Bump when the data shape changes, and add a step to migrate() so existing
// users' saved data is upgraded instead of reset.
const SCHEMA_VERSION = 1;

const PALETTE = [
  '#60a5fa', '#f472b6', '#facc15', '#34d399', '#a78bfa', '#fb923c',
  '#2dd4bf', '#f87171', '#a3e635', '#e879f9', '#38bdf8', '#fbbf24',
];

let state = null;
let selectedMonth = monthKey(todayISO());
let txType = 'expense';
let editingTxId = null;
let budgetChart = null;
let trendChart = null;

// ---------- Helpers ----------

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthKey(iso) { return iso.slice(0, 7); }
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key, short = false) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: short ? 'short' : 'long', year: short ? '2-digit' : 'numeric' });
}
function uid() { return crypto.randomUUID(); }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function round2(n) { return Math.round(n * 100) / 100; }
function money(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency }).format(n || 0);
}
function moneyShort(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 0 }).format(n || 0);
}
function pct(n, digits = 0) { return `${n.toFixed(digits)}%`; }
function $(id) { return document.getElementById(id); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- Data ----------

function defaultData() {
  const expense = [
    ['Housing', 30], ['Food & Groceries', 12], ['Transportation', 10], ['Utilities', 7],
    ['Insurance', 5], ['Health', 4], ['Entertainment', 5], ['Personal & Shopping', 5],
    ['Savings', 15], ['Debt Payments', 5], ['Other', 2],
  ];
  const categories = [
    ...expense.map(([name, percent], i) => ({ id: uid(), name, type: 'expense', percent, color: PALETTE[i % PALETTE.length] })),
    { id: uid(), name: 'Salary', type: 'income', percent: 0, color: '#22c55e' },
    { id: uid(), name: 'Other Income', type: 'income', percent: 0, color: '#86efac' },
  ];
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { currency: 'USD', budgetBase: 'actual', fixedIncome: 0 },
    categories,
    transactions: [],
  };
}

function migrate(data) {
  if (!data || typeof data !== 'object') return defaultData();
  data.schemaVersion = data.schemaVersion || 1;
  data.settings = { currency: 'USD', budgetBase: 'actual', fixedIncome: 0, ...(data.settings || {}) };
  data.categories = Array.isArray(data.categories) ? data.categories : [];
  data.transactions = Array.isArray(data.transactions) ? data.transactions : [];
  // Future migrations go here, e.g.:
  // if (data.schemaVersion < 2) { ...; data.schemaVersion = 2; }
  return data;
}

function isValidData(data) {
  return data && Array.isArray(data.categories) && Array.isArray(data.transactions);
}

async function save() {
  try {
    await window.api.saveData(state);
  } catch (err) {
    toast('Could not save: ' + err.message);
  }
}

function cat(id) { return state.categories.find((c) => c.id === id); }
function catsOf(type) { return state.categories.filter((c) => c.type === type); }

// ---------- Calculations ----------

function txInMonth(key) { return state.transactions.filter((t) => monthKey(t.date) === key); }

function totalsByCategory(key) {
  const totals = {};
  for (const t of txInMonth(key)) totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
  return totals;
}

function monthSummary(key) {
  const byCat = totalsByCategory(key);
  let income = 0, expenses = 0;
  for (const c of state.categories) {
    const v = byCat[c.id] || 0;
    if (c.type === 'income') income += v; else expenses += v;
  }
  return { byCat, income: round2(income), expenses: round2(expenses), net: round2(income - expenses) };
}

function budgetBase(key) {
  return state.settings.budgetBase === 'fixed' ? Number(state.settings.fixedIncome) || 0 : monthSummary(key).income;
}

function allocatedPercent() {
  return catsOf('expense').reduce((s, c) => s + (Number(c.percent) || 0), 0);
}

function changeCell(cur, prev, isIncome = false) {
  const diff = cur - prev;
  if (prev === 0 && cur === 0) return '<span class="muted">—</span>';
  if (prev === 0) return `<span class="${isIncome ? 'inc-up' : 'up'}">new</span>`;
  const p = (diff / Math.abs(prev)) * 100;
  const cls = diff === 0 ? 'muted' : (diff > 0) !== isIncome ? 'up' : 'down';
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '';
  return `<span class="${cls}">${arrow} ${money(Math.abs(diff))} (${diff >= 0 ? '+' : '−'}${Math.abs(p).toFixed(0)}%)</span>`;
}

// ---------- Rendering ----------

function render() {
  $('month-input').value = selectedMonth;
  const active = document.querySelector('.nav-btn.active').dataset.view;
  if (active === 'dashboard') renderDashboard();
  if (active === 'transactions') renderTransactions();
  if (active === 'categories') renderCategories();
  if (active === 'trends') renderTrends();
  if (active === 'settings') renderSettings();
}

function renderDashboard() {
  const cur = monthSummary(selectedMonth);
  const prevKey = shiftMonth(selectedMonth, -1);
  const prev = monthSummary(prevKey);
  const base = budgetBase(selectedMonth);
  const alloc = allocatedPercent();
  const savingsRate = cur.income > 0 ? (cur.net / cur.income) * 100 : 0;

  $('summary-cards').innerHTML = [
    card('Income', money(cur.income), changeCell(cur.income, prev.income, true)),
    card('Expenses', money(cur.expenses), changeCell(cur.expenses, prev.expenses)),
    card('Net', `<span class="${cur.net >= 0 ? 'pos' : 'neg'}">${money(cur.net)}</span>`, `Savings rate ${pct(savingsRate)}`),
    card('Budget base', money(base), state.settings.budgetBase === 'fixed' ? 'Fixed monthly income' : 'Actual income this month'),
    card('Allocated', pct(alloc, alloc % 1 ? 1 : 0), alloc === 100 ? 'All income assigned' : alloc < 100 ? `${pct(100 - alloc, 1)} unassigned` : `${pct(alloc - 100, 1)} over-assigned`),
  ].join('');

  // Expense table
  const rows = catsOf('expense').map((c) => {
    const budget = round2((base * (Number(c.percent) || 0)) / 100);
    const spent = cur.byCat[c.id] || 0;
    const remaining = budget - spent;
    const used = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 100 : 0;
    const barColor = used > 100 ? 'var(--danger)' : used > 85 ? 'var(--warn)' : c.color;
    return { c, budget, spent, remaining, used, barColor, prevSpent: prev.byCat[c.id] || 0 };
  });
  const tot = rows.reduce((a, r) => ({ budget: a.budget + r.budget, spent: a.spent + r.spent, prev: a.prev + r.prevSpent }), { budget: 0, spent: 0, prev: 0 });

  $('category-table').innerHTML = rows.length ? `
    <table>
      <thead><tr>
        <th>Category</th><th class="num">Budget %</th><th class="num">Budget</th><th class="num">Spent</th>
        <th class="num">Remaining</th><th>Used</th><th class="num">vs ${esc(monthLabel(prevKey, true))}</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td><span class="dot" style="background:${esc(r.c.color)}"></span>${esc(r.c.name)}</td>
          <td class="num">${pct(Number(r.c.percent) || 0, 1)}</td>
          <td class="num">${money(r.budget)}</td>
          <td class="num">${money(r.spent)}</td>
          <td class="num ${r.remaining < 0 ? 'neg' : ''}">${money(r.remaining)}</td>
          <td><div class="bar"><div style="width:${Math.min(r.used, 100)}%;background:${r.barColor}"></div></div>
              <span class="small muted">${pct(r.used)}</span></td>
          <td class="num">${changeCell(r.spent, r.prevSpent)}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td>Total</td><td class="num">${pct(alloc, 1)}</td><td class="num">${money(tot.budget)}</td>
        <td class="num">${money(tot.spent)}</td><td class="num ${tot.budget - tot.spent < 0 ? 'neg' : ''}">${money(tot.budget - tot.spent)}</td>
        <td></td><td class="num">${changeCell(tot.spent, tot.prev)}</td>
      </tr></tfoot>
    </table>` : '<div class="empty">No expense categories yet.</div>';

  // Income breakdown
  const incRows = catsOf('income').map((c) => ({ c, v: cur.byCat[c.id] || 0, p: prev.byCat[c.id] || 0 }));
  $('income-breakdown').innerHTML = `
    <table>
      <thead><tr><th>Source</th><th class="num">Amount</th><th class="num">vs last month</th></tr></thead>
      <tbody>${incRows.map((r) => `
        <tr><td><span class="dot" style="background:${esc(r.c.color)}"></span>${esc(r.c.name)}</td>
        <td class="num">${money(r.v)}</td><td class="num">${changeCell(r.v, r.p, true)}</td></tr>`).join('')}
      </tbody>
      <tfoot><tr><td>Total</td><td class="num">${money(cur.income)}</td><td class="num">${changeCell(cur.income, prev.income, true)}</td></tr></tfoot>
    </table>
    ${cur.income === 0 && state.settings.budgetBase === 'actual' ? '<p class="muted small">No income recorded this month, so budgets are $0. Add income on the Transactions tab, or switch to a fixed monthly income in Settings.</p>' : ''}`;

  // Chart
  const labels = rows.map((r) => r.c.name);
  const data = {
    labels,
    datasets: [
      { label: 'Budget', data: rows.map((r) => r.budget), backgroundColor: 'rgba(148,163,184,.35)', borderRadius: 4 },
      { label: 'Spent', data: rows.map((r) => r.spent), backgroundColor: rows.map((r) => (r.used > 100 ? '#f87171' : r.c.color)), borderRadius: 4 },
    ],
  };
  if (budgetChart) { budgetChart.data = data; budgetChart.update(); }
  else budgetChart = new Chart($('budget-chart'), { type: 'bar', data, options: chartOptions() });
}

function card(label, value, sub) {
  return `<div class="card"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function chartOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: '#cbd5e1' } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money(ctx.parsed.y)}` } },
    },
    scales: {
      x: { ticks: { color: '#8b97b0' }, grid: { color: 'rgba(255,255,255,.04)' } },
      y: { ticks: { color: '#8b97b0', callback: (v) => moneyShort(v) }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
    },
    ...extra,
  };
}

// Transactions

function fillCategorySelect() {
  const sel = $('tx-category');
  const current = sel.value;
  sel.innerHTML = catsOf(txType).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  document.querySelectorAll('#tx-type button').forEach((b) => b.classList.toggle('active', b.dataset.type === txType));

  const f = $('filter-category');
  const fv = f.value;
  f.innerHTML = '<option value="">All categories</option>' +
    ['expense', 'income'].map((type) => `<optgroup label="${type === 'expense' ? 'Expenses' : 'Income'}">${catsOf(type).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
  f.value = fv;
}

function renderTransactions() {
  fillCategorySelect();
  if (!$('tx-date').value) $('tx-date').value = defaultTxDate();

  const scope = $('filter-scope').value;
  const catFilter = $('filter-category').value;
  const q = $('filter-search').value.trim().toLowerCase();
  const list = state.transactions
    .filter((t) => scope === 'all' || monthKey(t.date) === selectedMonth)
    .filter((t) => !catFilter || t.categoryId === catFilter)
    .filter((t) => !q || (t.note || '').toLowerCase().includes(q) || (cat(t.categoryId)?.name || '').toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  let inc = 0, exp = 0;
  for (const t of list) (cat(t.categoryId)?.type === 'income' ? (inc += t.amount) : (exp += t.amount));

  $('tx-table').innerHTML = list.length ? `
    <table>
      <thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="num">Amount</th><th></th></tr></thead>
      <tbody>${list.map((t) => {
        const c = cat(t.categoryId);
        const isInc = c?.type === 'income';
        return `<tr>
          <td>${esc(t.date)}</td>
          <td><span class="dot" style="background:${esc(c?.color || '#666')}"></span>${esc(c?.name || 'Unknown')}</td>
          <td>${esc(t.note)}</td>
          <td class="num ${isInc ? 'pos' : ''}">${isInc ? '+' : '−'}${money(t.amount)}</td>
          <td class="num">
            <button class="small" data-edit="${t.id}">Edit</button>
            <button class="small danger" data-del="${t.id}">Delete</button>
          </td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td colspan="3">${list.length} transaction${list.length === 1 ? '' : 's'} · Income ${money(inc)} · Expenses ${money(exp)}</td>
        <td class="num ${inc - exp >= 0 ? 'pos' : 'neg'}">${money(inc - exp)}</td><td></td></tr></tfoot>
    </table>` : '<div class="empty">No transactions match. Add one above.</div>';
}

function defaultTxDate() {
  const today = todayISO();
  return monthKey(today) === selectedMonth ? today : `${selectedMonth}-01`;
}

function resetTxForm() {
  editingTxId = null;
  $('tx-form').reset();
  $('tx-date').value = defaultTxDate();
  $('tx-form-title').textContent = 'Add transaction';
  $('tx-submit').textContent = 'Add';
  $('tx-cancel').classList.add('hidden');
}

async function submitTx(e) {
  e.preventDefault();
  const amount = round2(parseFloat($('tx-amount').value));
  const categoryId = $('tx-category').value;
  const date = $('tx-date').value;
  if (!(amount > 0) || !categoryId || !date) return toast('Enter a date, category and amount.');
  const note = $('tx-note').value.trim();

  if (editingTxId) {
    Object.assign(state.transactions.find((t) => t.id === editingTxId), { amount, categoryId, date, note });
    toast('Transaction updated');
  } else {
    state.transactions.push({ id: uid(), date, amount, categoryId, note, createdAt: Date.now() });
    toast(`${txType === 'income' ? 'Income' : 'Expense'} added`);
  }
  await save();
  const keepDate = date;
  resetTxForm();
  $('tx-date').value = keepDate;
  $('tx-category').value = categoryId;
  $('tx-amount').focus();
  render();
}

function startEditTx(id) {
  const t = state.transactions.find((x) => x.id === id);
  if (!t) return;
  editingTxId = id;
  txType = cat(t.categoryId)?.type || 'expense';
  fillCategorySelect();
  $('tx-date').value = t.date;
  $('tx-category').value = t.categoryId;
  $('tx-amount').value = t.amount;
  $('tx-note').value = t.note || '';
  $('tx-form-title').textContent = 'Edit transaction';
  $('tx-submit').textContent = 'Save changes';
  $('tx-cancel').classList.remove('hidden');
  $('tx-amount').focus();
}

async function deleteTx(id) {
  if (!confirm('Delete this transaction?')) return;
  state.transactions = state.transactions.filter((t) => t.id !== id);
  if (editingTxId === id) resetTxForm();
  await save();
  render();
}

function exportCsv() {
  const header = ['Date', 'Type', 'Category', 'Amount', 'Note'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [...state.transactions]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const c = cat(t.categoryId);
      return [t.date, c?.type || '', c?.name || '', t.amount.toFixed(2), t.note].map(q).join(',');
    });
  window.api.exportCsv([header.join(','), ...lines].join('\r\n')).then((ok) => ok && toast('CSV exported'));
}

// Categories

function renderCategories() {
  const base = budgetBase(selectedMonth);
  const alloc = allocatedPercent();
  const cls = Math.abs(alloc - 100) < 0.001 ? 'ok' : alloc < 100 ? 'under' : 'over';
  $('alloc-indicator').innerHTML = `<span class="alloc ${cls}">${pct(alloc, 1)} allocated${cls === 'under' ? ` · ${pct(100 - alloc, 1)} left` : cls === 'over' ? ` · ${pct(alloc - 100, 1)} over` : ''}</span>`;
  $('base-desc').textContent = state.settings.budgetBase === 'fixed'
    ? `your fixed monthly income (${money(base)})`
    : `the income you record each month (${monthLabel(selectedMonth)}: ${money(base)})`;

  const exp = catsOf('expense');
  $('expense-cats').innerHTML = exp.length ? `
    <table>
      <thead><tr><th>Color</th><th>Name</th><th class="num">Budget %</th><th class="num">Budget (${esc(monthLabel(selectedMonth, true))})</th><th class="num">Transactions</th><th></th></tr></thead>
      <tbody>${exp.map((c) => `
        <tr class="cat-row">
          <td><input type="color" value="${esc(c.color)}" data-cat-color="${c.id}" /></td>
          <td><input type="text" value="${esc(c.name)}" maxlength="40" data-cat-name="${c.id}" /></td>
          <td class="num"><input type="number" min="0" max="100" step="0.1" value="${Number(c.percent) || 0}" data-cat-pct="${c.id}" /> %</td>
          <td class="num" data-cat-budget="${c.id}">${money((base * (Number(c.percent) || 0)) / 100)}</td>
          <td class="num">${state.transactions.filter((t) => t.categoryId === c.id).length}</td>
          <td class="num"><button class="small danger" data-cat-del="${c.id}">Delete</button></td>
        </tr>`).join('')}</tbody>
    </table>` : '<div class="empty">No expense categories.</div>';

  const inc = catsOf('income');
  $('income-cats').innerHTML = inc.length ? `
    <table>
      <thead><tr><th>Color</th><th>Name</th><th class="num">Transactions</th><th></th></tr></thead>
      <tbody>${inc.map((c) => `
        <tr class="cat-row">
          <td><input type="color" value="${esc(c.color)}" data-cat-color="${c.id}" /></td>
          <td><input type="text" value="${esc(c.name)}" maxlength="40" data-cat-name="${c.id}" /></td>
          <td class="num">${state.transactions.filter((t) => t.categoryId === c.id).length}</td>
          <td class="num"><button class="small danger" data-cat-del="${c.id}">Delete</button></td>
        </tr>`).join('')}</tbody>
    </table>` : '<div class="empty">No income categories.</div>';
}

async function addCategory(e) {
  e.preventDefault();
  const name = $('cat-name').value.trim();
  const type = $('cat-type').value;
  if (!name) return;
  if (state.categories.some((c) => c.type === type && c.name.toLowerCase() === name.toLowerCase())) {
    return toast('A category with that name already exists.');
  }
  const percent = type === 'expense' ? Math.max(0, parseFloat($('cat-percent').value) || 0) : 0;
  state.categories.push({ id: uid(), name, type, percent, color: PALETTE[state.categories.length % PALETTE.length] });
  await save();
  $('cat-form').reset();
  toggleCatPercent();
  toast(`Added “${name}”`);
  render();
}

async function deleteCategory(id) {
  const c = cat(id);
  if (!c) return;
  const used = state.transactions.filter((t) => t.categoryId === id);
  const others = catsOf(c.type).filter((x) => x.id !== id);
  if (used.length) {
    if (!others.length) return toast(`Can't delete the only ${c.type} category while it has transactions.`);
    const target = others.find((x) => /^other/i.test(x.name)) || others[0];
    if (!confirm(`“${c.name}” has ${used.length} transaction(s). Delete it and move them to “${target.name}”?`)) return;
    used.forEach((t) => (t.categoryId = target.id));
  } else if (!confirm(`Delete category “${c.name}”?`)) return;
  state.categories = state.categories.filter((x) => x.id !== id);
  await save();
  render();
}

function toggleCatPercent() {
  $('cat-percent-wrap').classList.toggle('hidden', $('cat-type').value !== 'expense');
}

// Trends

function renderTrends() {
  const n = Number($('trend-range').value);
  const months = Array.from({ length: n }, (_, i) => shiftMonth(selectedMonth, i - n + 1));
  const prevOfFirst = shiftMonth(months[0], -1);
  const summaries = Object.fromEntries([prevOfFirst, ...months].map((m) => [m, monthSummary(m)]));
  const exp = catsOf('expense');

  const data = {
    labels: months.map((m) => monthLabel(m, true)),
    datasets: exp.map((c) => ({
      label: c.name,
      data: months.map((m) => summaries[m].byCat[c.id] || 0),
      borderColor: c.color,
      backgroundColor: c.color,
      tension: 0.25,
      pointRadius: 3,
    })),
  };
  if (trendChart) { trendChart.data = data; trendChart.update(); }
  else trendChart = new Chart($('trend-chart'), { type: 'line', data, options: chartOptions() });

  const row = (label, getter, isIncome = false, extraCls = '') => `
    <tr class="${extraCls}"><td><b>${label}</b></td>${months.map((m) => {
      const v = getter(m), p = getter(shiftMonth(m, -1));
      return `<td class="num">${money(v)}<span class="delta">${changeCell(v, p, isIncome)}</span></td>`;
    }).join('')}</tr>`;

  $('trend-table').innerHTML = `
    <table>
      <thead><tr><th>Category</th>${months.map((m) => `<th class="num">${esc(monthLabel(m, true))}</th>`).join('')}</tr></thead>
      <tbody>
        ${exp.map((c) => `<tr><td><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</td>${months.map((m) => {
          const v = summaries[m].byCat[c.id] || 0, p = summaries[shiftMonth(m, -1)].byCat[c.id] || 0;
          return `<td class="num">${money(v)}<span class="delta">${changeCell(v, p)}</span></td>`;
        }).join('')}</tr>`).join('')}
      </tbody>
      <tfoot>
        ${row('Total expenses', (m) => summaries[m].expenses)}
        ${row('Total income', (m) => summaries[m].income, true)}
        ${row('Net', (m) => summaries[m].net, true)}
      </tfoot>
    </table>`;
}

// Settings

async function renderSettings() {
  $('set-currency').value = state.settings.currency;
  $('set-base').value = state.settings.budgetBase;
  $('set-fixed').value = state.settings.fixedIncome || '';
  $('set-fixed-wrap').classList.toggle('hidden', state.settings.budgetBase !== 'fixed');
  const info = await window.api.appInfo();
  $('data-path').textContent = info.dataFile;
}

// ---------- Events ----------

function bindEvents() {
  document.querySelectorAll('.nav-btn').forEach((btn) =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${btn.dataset.view}`));
      $('view-title').textContent = btn.textContent;
      render();
    }));

  $('prev-month').addEventListener('click', () => { selectedMonth = shiftMonth(selectedMonth, -1); onMonthChange(); });
  $('next-month').addEventListener('click', () => { selectedMonth = shiftMonth(selectedMonth, 1); onMonthChange(); });
  $('month-input').addEventListener('change', (e) => { if (e.target.value) { selectedMonth = e.target.value; onMonthChange(); } });

  // Transactions
  $('tx-type').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    txType = b.dataset.type;
    fillCategorySelect();
  });
  $('tx-form').addEventListener('submit', submitTx);
  $('tx-cancel').addEventListener('click', resetTxForm);
  ['filter-scope', 'filter-category'].forEach((id) => $(id).addEventListener('change', renderTransactions));
  $('filter-search').addEventListener('input', renderTransactions);
  $('export-csv').addEventListener('click', exportCsv);
  $('tx-table').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.edit) startEditTx(b.dataset.edit);
    if (b?.dataset.del) deleteTx(b.dataset.del);
  });

  // Categories
  $('cat-form').addEventListener('submit', addCategory);
  $('cat-type').addEventListener('change', toggleCatPercent);
  const catsArea = $('view-categories');
  catsArea.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.catPct) {
      const c = cat(el.dataset.catPct);
      c.percent = Math.max(0, parseFloat(el.value) || 0);
      const cell = document.querySelector(`[data-cat-budget="${c.id}"]`);
      if (cell) cell.textContent = money((budgetBase(selectedMonth) * c.percent) / 100);
      const alloc = allocatedPercent();
      const cls = Math.abs(alloc - 100) < 0.001 ? 'ok' : alloc < 100 ? 'under' : 'over';
      $('alloc-indicator').innerHTML = `<span class="alloc ${cls}">${pct(alloc, 1)} allocated${cls === 'under' ? ` · ${pct(100 - alloc, 1)} left` : cls === 'over' ? ` · ${pct(alloc - 100, 1)} over` : ''}</span>`;
      debouncedSave();
    }
    if (el.dataset.catColor) { cat(el.dataset.catColor).color = el.value; debouncedSave(); }
  });
  catsArea.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.catName) {
      const name = el.value.trim();
      if (name) { cat(el.dataset.catName).name = name; save(); } else el.value = cat(el.dataset.catName).name;
    }
  });
  catsArea.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b?.dataset.catDel) deleteCategory(b.dataset.catDel);
  });

  // Trends
  $('trend-range').addEventListener('change', renderTrends);

  // Settings
  $('set-currency').addEventListener('change', (e) => { state.settings.currency = e.target.value; save(); toast('Currency updated'); });
  $('set-base').addEventListener('change', (e) => {
    state.settings.budgetBase = e.target.value;
    $('set-fixed-wrap').classList.toggle('hidden', e.target.value !== 'fixed');
    save();
  });
  $('set-fixed').addEventListener('input', (e) => { state.settings.fixedIncome = Math.max(0, parseFloat(e.target.value) || 0); debouncedSave(); });
  $('open-folder').addEventListener('click', () => window.api.openDataFolder());
  $('export-json').addEventListener('click', async () => { if (await window.api.exportJson(state)) toast('Backup exported'); });
  $('import-json').addEventListener('click', importBackup);
  $('check-updates').addEventListener('click', () => window.api.checkForUpdates());
}

function onMonthChange() {
  if (!editingTxId) $('tx-date').value = defaultTxDate();
  render();
}

let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

async function importBackup() {
  let data;
  try {
    data = await window.api.importJson();
  } catch {
    return toast('That file could not be read as a backup.');
  }
  if (!data) return;
  if (!isValidData(data)) return toast('That file is not a Budget Tracker backup.');
  if (!confirm(`Replace all current data with this backup (${data.transactions.length} transactions, ${data.categories.length} categories)?`)) return;
  state = migrate(data);
  await save();
  toast('Backup restored');
  render();
}

function showUpdateStatus({ status, detail }) {
  const text = {
    checking: 'Checking for updates…',
    current: 'Up to date',
    downloading: `Downloading update ${detail}…`,
    ready: `Update ${detail} ready — restart to apply`,
    error: 'Update check failed (offline?)',
    dev: 'Updates only run in the installed app',
  }[status] || '';
  $('update-status').textContent = text;
  if (status === 'error') console.warn('Update error:', detail);
}

// ---------- Boot ----------

(async function init() {
  const loaded = await window.api.loadData();
  state = loaded ? migrate(loaded) : defaultData();
  if (!loaded) await save();

  const info = await window.api.appInfo();
  $('version').textContent = `Version ${info.version}`;
  window.api.onUpdateStatus(showUpdateStatus);

  Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
  bindEvents();
  toggleCatPercent();
  $('tx-date').value = defaultTxDate();
  render();
})();
