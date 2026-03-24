/* =============================================
   app.js  — マイ家計簿 ダッシュボード
   AsirLabo OS 統合版:
     - 新Supabase (qzxajtlisscwxwidicfh) 接続
     - requireAuth() → getSession() ベース
     - JST 日付ユーティリティ使用
     - location.replace() で認証リダイレクト統一
   ============================================= */
'use strict';
import { supabase, requireAuth, getJSTMonthString } from './supabase-client.js';

let currentUser = null;
const TX_TABLE     = 'transactions';
const BAL_TABLE    = 'balance_settings';
const BUDGET_TABLE = 'budgets';

const PM_LABEL = {
  qr_code:          'QRコード決済',
  credit_card:      'クレジットカード',
  cash:             '現金',
  bank_in:          '銀行口座',
  transfer_to_cash: 'ATM振替'
};

const CATEGORY_BOX = {
  '通信費（A箱）':'A','消耗品費（A箱）':'A','旅費交通費（A箱）':'A',
  '支払手数料（A箱）':'A','接待交際費（A箱）':'A','新聞図書費（A箱）':'A',

  '個人サブスク・通信費（B箱）':'B','飲食費（ランチ・カフェ）（B箱）':'B',
  '美容・被服費（B箱）':'B','趣味・娯楽費（B箱）':'B',
  '個人交際費・予備費（B箱）':'B','日用品（B箱）':'B',
  '自己研鑽（B箱）':'B','健康・医療（B箱）':'B',
  '交通費（B箱）':'B','保険（B箱）':'B','投資（B箱）':'B','その他（B箱）':'B',

  '家族生活費（C箱）':'C','租税公課（C箱）':'C','法定福利費（C箱）':'C'
};

const BOX_NAMES = { A:'A箱 事業経費', B:'B箱 個人消費', C:'C箱 固定費' };

let allTransactions = [];
let balanceSettings = [];
let budgets         = [];

// JST基準の現在月で初期化
const _jstNow = (() => {
  const d = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
})();
let currentYear  = _jstNow.year;
let currentMonth = _jstNow.month;

let barChartInst = null;
let pieChartInst = null;

const fmt  = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
function padZ(n) { return String(n).padStart(2, '0'); }
function showLoading() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoading()  { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

async function fetchAll(table, sortField = 'created_at') {
  if (!currentUser) return [];
  const { data, error } = await supabase
    .from(table).select('*')
    .eq('user_id', currentUser.id)
    .order(sortField, { ascending: true });
  if (error) {
    console.error(`[fetchAll] ${table}:`, error.message);
    return [];
  }
  return data || [];
}

function calcMonthBalances(year, month) {
  const key     = `${year}-${padZ(month)}`;
  const setting = balanceSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance) : 0;

  const txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
  for (const tx of txs) {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt; else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else if (tx.payment_method === 'credit_card') { /* クレカは残高スルー */ }
      else bank -= amt;
    } else if (tx.type === 'transfer') {
      bank -= amt; cash += amt;
    }
  }
  return { bankBalance: bank, cashBalance: cash };
}

function renderKPI() {
  const { bankBalance, cashBalance } = calcMonthBalances(currentYear, currentMonth);
  const key  = `${currentYear}-${padZ(currentMonth)}`;
  const txs  = allTransactions.filter(t => t.date && t.date.startsWith(key));

  const income  = txs.filter(t => t.type === 'income') .reduce((s, t) => s + Number(t.amount), 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  const safeSetKPI = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  safeSetKPI('kpiIncome',    fmt(income));
  safeSetKPI('kpiExpense',   fmt(expense));
  safeSetKPI('kpiBalance',   fmt(bankBalance + cashBalance));
  safeSetKPI('bankBalance',  fmt(bankBalance));
  safeSetKPI('cashBalance',  fmt(cashBalance));
  safeSetKPI('totalBalance', fmt(bankBalance + cashBalance));

  const bal    = bankBalance + cashBalance;
  const fcEl   = document.getElementById('kpiForecast');
  const fcBan  = document.getElementById('forecastBannerAmount');
  const fcSub  = document.getElementById('forecastBannerSub');
  if (fcEl)  fcEl.textContent  = fmt(bal);
  if (fcBan) fcBan.textContent = fmt(bal);
  if (fcSub) {
    fcSub.textContent  = bal >= 0 ? '黒字着地見込み' : '赤字着地見込み';
    fcSub.style.color  = bal >= 0 ? 'var(--clr-income-dark)' : 'var(--clr-expense-dark)';
  }
}

function renderCharts() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let m = currentMonth - i, y = currentYear;
    while (m <= 0) { m += 12; y--; }
    months.push({ y, m });
  }

  const barLabels   = months.map(d => `${d.m}月`);
  const barIncomes  = months.map(d =>
    allTransactions.filter(t => t.date && t.date.startsWith(`${d.y}-${padZ(d.m)}`) && t.type === 'income')
      .reduce((s, t) => s + Number(t.amount), 0));
  const barExpenses = months.map(d =>
    allTransactions.filter(t => t.date && t.date.startsWith(`${d.y}-${padZ(d.m)}`) && t.type === 'expense')
      .reduce((s, t) => s + Number(t.amount), 0));

  const ctxBar = document.getElementById('barChart')?.getContext('2d');
  if (ctxBar) {
    if (barChartInst) barChartInst.destroy();
    barChartInst = new Chart(ctxBar, {
      type: 'bar',
      data: { labels: barLabels, datasets: [
        { label: '収入', data: barIncomes,  backgroundColor: 'rgba(16,185,129,0.7)' },
        { label: '支出', data: barExpenses, backgroundColor: 'rgba(239,68,68,0.7)'  }
      ]},
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  const key    = `${currentYear}-${padZ(currentMonth)}`;
  const exps   = allTransactions.filter(t => t.date && t.date.startsWith(key) && t.type === 'expense');
  const mapC   = {};
  exps.forEach(t => { mapC[t.category] = (mapC[t.category] || 0) + Number(t.amount); });
  const sorted   = Object.entries(mapC).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const pieLabels = sorted.map(d => d[0].replace(/（[ABC]箱）$/, ''));
  const pieData   = sorted.map(d => d[1]);

  const ctxPie = document.getElementById('pieChart')?.getContext('2d');
  if (ctxPie) {
    if (pieChartInst) pieChartInst.destroy();
    pieChartInst = new Chart(ctxPie, {
      type: 'doughnut',
      data: {
        labels: pieLabels,
        datasets: [{ data: pieData, backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'] }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } }
      }
    });
  }
}

function renderSummaries() {
  const key  = `${currentYear}-${padZ(currentMonth)}`;
  const exps = allTransactions.filter(t => t.date && t.date.startsWith(key) && t.type === 'expense');

  // 支払い方法サマリー
  const mapP   = {};
  exps.forEach(t => { mapP[t.payment_method] = (mapP[t.payment_method] || 0) + Number(t.amount); });
  const pList  = document.getElementById('paymentSummary');
  if (pList) {
    pList.innerHTML = '';
    const totalExp  = exps.reduce((s, t) => s + Number(t.amount), 0) || 1;
    const pmStyle   = {
      qr_code:     { bg: '#e0f2fe', text: '#0284c7' },
      credit_card: { bg: '#ede9fe', text: '#8b5cf6' },
      cash:        { bg: 'var(--clr-cash-light)',  text: 'var(--clr-cash-dark)'  },
      bank_in:     { bg: 'var(--clr-bank-light)',  text: 'var(--clr-bank-dark)'  }
    };
    Object.entries(mapP).sort((a, b) => b[1] - a[1]).forEach(([pm, amt]) => {
      const pct   = (amt / totalExp * 100).toFixed(1);
      const style = pmStyle[pm] || { bg: '#f3f4f6', text: '#4b5563' };
      pList.innerHTML += `
        <div class="payment-summary-item">
          <span class="pm-badge" style="background:${style.bg};color:${style.text};">${PM_LABEL[pm] || pm}</span>
          <div class="pm-bar-wrap"><div class="pm-bar" style="width:${pct}%;background:${style.text};"></div></div>
          <span class="pm-amount">${fmt(amt)}</span>
        </div>`;
    });
  }

  // ボックス別予算消化
  const mapB = { A: 0, B: 0, C: 0 };
  exps.forEach(t => { if (CATEGORY_BOX[t.category]) mapB[CATEGORY_BOX[t.category]] += Number(t.amount); });
  const bList = document.getElementById('boxBudgetOverview');
  if (bList) {
    bList.innerHTML = '';
    ['A', 'B', 'C'].forEach(b => {
      const actual   = mapB[b];
      const budget   = budgets.filter(r => r.month === key && r.box === b).reduce((s, r) => s + Number(r.amount || 0), 0);
      const hasBudget = budget > 0;
      const pct      = hasBudget ? Math.min((actual / budget) * 100, 150) : 0;
      const status   = !hasBudget ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
      let barColor = b === 'A' ? 'var(--clr-abox)' : b === 'B' ? 'var(--clr-bbox)' : 'var(--clr-cbox)';
      if (status === 'over') barColor = 'var(--clr-expense)';
      if (status === 'warn') barColor = 'var(--clr-forecast)';
      if (!hasBudget)        barColor = 'var(--clr-text-muted)';
      bList.innerHTML += `
        <div class="box-bud-card">
          <div class="box-bud-top">
            <span class="box-badge ${b.toLowerCase()}box">${b}</span>
            <span class="box-bud-name">${BOX_NAMES[b]}</span>
            <span class="box-bud-pct" style="color:${barColor}">${hasBudget ? pct.toFixed(1) + '%' : '─'}</span>
          </div>
          <div class="box-bud-bar-wrap"><div class="box-bud-bar" style="width:${hasBudget ? pct : 0}%;background:${barColor};"></div></div>
          <div class="box-bud-amounts">
            <span class="box-bud-actual">${fmt(actual)}</span>
            <span class="box-bud-remain" style="color:var(--clr-text-muted)">/</span>
            <span class="box-bud-budget">${hasBudget ? fmt(budget) : '予算未設定'}</span>
          </div>
        </div>`;
    });
  }

  // カテゴリ別支出サマリー
  const mapCat = {};
  exps.forEach(t => { mapCat[t.category] = (mapCat[t.category] || 0) + Number(t.amount); });
  const cList = document.getElementById('categorySummary');
  if (cList) {
    cList.innerHTML = '';
    Object.entries(mapCat).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
      const box      = CATEGORY_BOX[cat];
      const boxClass = box ? box.toLowerCase() + 'box' : '';
      const budRow   = budgets.find(r => r.month === key && r.category === cat);
      const budget   = budRow ? Number(budRow.amount) : 0;
      const hasBudget = budget > 0;
      const pct      = hasBudget ? Math.min((amt / budget) * 100, 150) : 0;
      const status   = !hasBudget ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
      let barColor = box === 'A' ? 'var(--clr-abox)' : box === 'B' ? 'var(--clr-bbox)' : box === 'C' ? 'var(--clr-cbox)' : 'var(--clr-balance)';
      if (status === 'over') barColor = 'var(--clr-expense)';
      if (status === 'warn') barColor = 'var(--clr-forecast)';
      if (!hasBudget)        barColor = 'var(--clr-text-muted)';
      cList.innerHTML += `
        <div class="category-summary-item">
          ${box ? `<span class="cat-badge ${boxClass}">${box}</span>` : ''}
          <div class="cat-info">
            <div class="cat-name-row">
              <span class="cat-name">${cat.replace(/（[ABC]箱）$/, '')}</span>
              <span class="cat-pct-badge ${status}">${hasBudget ? pct.toFixed(0) + '%' : ''}</span>
            </div>
            <div class="cat-bar-wrap"><div class="cat-bar" style="width:${hasBudget ? pct : 0}%;background:${barColor};"></div></div>
            <div class="cat-budget-row">
              <span class="cat-actual-amt">${fmt(amt)}</span>
              <span class="cat-budget-amt">${hasBudget ? `/ ${fmt(budget)}` : ''}</span>
            </div>
          </div>
        </div>`;
    });
  }
}

function renderList() {
  const key      = `${currentYear}-${padZ(currentMonth)}`;
  const listEl   = document.getElementById('transactionCards');
  const emptyEl  = document.getElementById('emptyState');
  const totalsEl = document.getElementById('listTotals');
  const filterVal = document.getElementById('filterCategory')?.value;

  let txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
  if (filterVal) txs = txs.filter(t => t.category === filterVal);
  txs.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (txs.length === 0) {
    if (listEl)   listEl.innerHTML = '';
    if (emptyEl)  emptyEl.style.display = 'block';
    if (totalsEl) totalsEl.style.display = 'none';
    return;
  }
  if (emptyEl)  emptyEl.style.display = 'none';
  if (totalsEl) totalsEl.style.display = 'block';

  let html = '', inc = 0, expB = 0, expC = 0;
  txs.forEach(t => {
    const amt = Number(t.amount);
    if (t.type === 'income') inc += amt;
    else if (t.type === 'expense') {
      if (t.payment_method === 'cash') expC += amt;
      else if (t.payment_method !== 'credit_card') expB += amt;
    }
    const icon  = t.type === 'income' ? 'fa-arrow-down' : t.type === 'expense' ? 'fa-arrow-up' : 'fa-random';
    const color = t.type === 'income' ? 'plus' : t.type === 'expense' ? 'minus' : 'transfer';
    html += `
      <div class="tx-card">
        <div class="tx-icon ${color}"><i class="fas ${icon}"></i></div>
        <div class="tx-main">
          <div class="tx-cat">${t.category.replace(/（[ABC]箱）$/, '')} <span class="tx-pm">${PM_LABEL[t.payment_method] || t.payment_method}</span></div>
          <div class="tx-date">${t.date}${t.memo ? ` | ${t.memo}` : ''}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${color}">${t.type === 'expense' ? '-' : ''}${fmt(amt)}</div>
          <button class="btn-delete" data-id="${t.id}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  });
  if (listEl) listEl.innerHTML = html;

  const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  safeSet('totalsIncome',   fmt(inc));
  safeSet('totalsBankExp',  fmt(expB));
  safeSet('totalsCashExp',  fmt(expC));
  safeSet('totalsBalance',  fmt(inc - expB - expC));

  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (confirm('この明細を削除しますか？')) {
        showLoading();
        const { error } = await supabase.from(TX_TABLE).delete().eq('id', id);
        if (error) { alert('削除エラー: ' + error.message); }
        else {
          allTransactions = await fetchAll(TX_TABLE, 'date');
          renderDashboard();
        }
        hideLoading();
      }
    });
  });
}

function updateMonthLabel() {
  const el = document.getElementById('currentMonthLabel');
  if (el) el.textContent = `${currentYear}年 ${currentMonth}月`;
}

function renderDashboard() {
  updateMonthLabel();
  renderKPI();
  renderCharts();
  renderSummaries();
  renderList();

  const filter = document.getElementById('filterCategory');
  if (filter) {
    const key  = `${currentYear}-${padZ(currentMonth)}`;
    const cats = [...new Set(allTransactions.filter(t => t.date && t.date.startsWith(key)).map(t => t.category))].sort();
    filter.innerHTML = '<option value="">全科目</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  }
}

async function handleBalanceSetupSubmit(e) {
  e.preventDefault();
  const rawMonth = document.getElementById('setupMonth').value;
  const month    = rawMonth.slice(0, 7);
  const bank     = Number(document.getElementById('setupBank').value) || 0;
  const cash     = Number(document.getElementById('setupCash').value) || 0;

  const existing = balanceSettings.find(s => s.month === month);
  const payload  = { user_id: currentUser.id, month, bank_balance: bank, cash_balance: cash };

  showLoading();
  if (existing) await supabase.from(BAL_TABLE).update(payload).eq('id', existing.id);
  else          await supabase.from(BAL_TABLE).insert([payload]);

  balanceSettings = await fetchAll(BAL_TABLE);
  document.getElementById('balanceSetupModal').style.display = 'none';
  renderDashboard();
  hideLoading();
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  // ログアウトボタン
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    if (confirm('ログアウトしますか？')) {
      await supabase.auth.signOut();
      localStorage.clear();
      sessionStorage.clear();
      window.location.replace('login.html');
    }
  });

  showLoading();
  try {
    [allTransactions, balanceSettings, budgets] = await Promise.all([
      fetchAll(TX_TABLE, 'date'),
      fetchAll(BAL_TABLE, 'month'),
      fetchAll(BUDGET_TABLE, 'month')
    ]);
  } catch (err) {
    console.error('[init] fetch error:', err);
  }
  hideLoading();

  // 利用規約同意チェック
  // 注意: AdminAPIで作成されたユーザーはuser_metadataが空なので、
  // termsModal要素がない場合や、既存ユーザーの場合はスキップしてダッシュボードを表示
  const hasAgreed = currentUser.user_metadata?.agreed_to_terms;
  const termsModal = document.getElementById('termsModal');
  const termsCheck = document.getElementById('termsCheck');
  const agreeBtn   = document.getElementById('agreeBtn');

  // termsModalが存在しない場合は即ダッシュボード表示（安全フォールバック）
  if (!termsModal) {
    renderDashboard();
  } else if (!hasAgreed) {
    termsModal.style.display = 'flex';
    if (termsCheck) {
      termsCheck.addEventListener('change', (e) => {
        if (agreeBtn) {
          agreeBtn.style.opacity       = e.target.checked ? '1'    : '0.5';
          agreeBtn.style.pointerEvents = e.target.checked ? 'auto' : 'none';
        }
      });
    }
    if (agreeBtn) {
      agreeBtn.addEventListener('click', async () => {
        showLoading();
        const { error } = await supabase.auth.updateUser({ data: { agreed_to_terms: true } });
        hideLoading();
        if (error) { alert('エラー: ' + error.message); }
        else { termsModal.style.display = 'none'; renderDashboard(); }
      });
    } else {
      // agreeBtn が見つからない場合は即表示（フェイルセーフ）
      termsModal.style.display = 'none';
      renderDashboard();
    }
  } else {
    renderDashboard();
  }

  // イベントバインド
  document.getElementById('openBalanceSetupBtn')?.addEventListener('click', () => {
    document.getElementById('balanceSetupModal').style.display = 'flex';
  });
  document.getElementById('balanceSetupCancelBtn')?.addEventListener('click', () => {
    document.getElementById('balanceSetupModal').style.display = 'none';
  });
  document.getElementById('balanceSetupForm')?.addEventListener('submit', handleBalanceSetupSubmit);

  document.getElementById('prevMonthBtn')?.addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 1) { currentMonth = 12; currentYear--; }
    renderDashboard();
  });
  document.getElementById('nextMonthBtn')?.addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 12) { currentMonth = 1; currentYear++; }
    renderDashboard();
  });

  document.getElementById('filterCategory')?.addEventListener('change', renderList);

  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const tab = document.getElementById('tab-' + e.currentTarget.dataset.tab);
      if (tab) tab.classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
