/* =============================================
   app.js  — マイダッシュボード 完全版
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';

const PM_LABEL = {
  rakuten: '楽天ペイ', paypay: 'PayPay', mercari: 'メルカリ',
  credit_card: 'クレジットカード', cash: '現金', bank_in: '銀行口座', transfer_to_cash: 'ATM振替'
};

const CATEGORY_BOX = {
  '通信費（A箱）':'A','消耗品費（A箱）':'A','旅費交通費（A箱）':'A','支払手数料（A箱）':'A','接待交際費（A箱）':'A','新聞図書費（A箱）':'A',
  '食費（B箱）':'B', '日用品（B箱）':'B', '趣味・娯楽（B箱）':'B', '自己研鑽（B箱）':'B', '衣服・美容（B箱）':'B', '健康・医療（B箱）':'B', '交際費（B箱）':'B', '交通費（B箱）':'B', '保険（B箱）':'B', '投資（B箱）':'B', 'その他（B箱）':'B',
  '家族生活費（C箱）':'C','租税公課（C箱）':'C','法定福利費（C箱）':'C'
};

let allTransactions  = [];
let balanceSettings  = [];
let currentYear      = new Date().getFullYear();
let currentMonth     = new Date().getMonth() + 1;

let barChartInst = null;
let pieChartInst = null;

const fmt = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
function padZ(n) { return String(n).padStart(2,'0'); }
function showLoading() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

async function fetchAll(table, sortField = 'created_at') {
  if (!currentUser) return [];
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id).order(sortField, { ascending: true });
  return data || [];
}

function calcMonthBalances(year, month) {
  const key = `${year}-${padZ(month)}`;
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
  const key = `${currentYear}-${padZ(currentMonth)}`;
  const txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
  
  const income  = txs.filter(t => t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const expense = txs.filter(t => t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);

  document.getElementById('kpiIncome').textContent = fmt(income);
  document.getElementById('kpiExpense').textContent = fmt(expense);
  document.getElementById('kpiBalance').textContent = fmt(bankBalance + cashBalance);
  document.getElementById('bankBalance').textContent = fmt(bankBalance);
  document.getElementById('cashBalance').textContent = fmt(cashBalance);
  document.getElementById('totalBalance').textContent = fmt(bankBalance + cashBalance);

  // 着地予測 (簡易モデル：現在の支出 + C箱の残り)
  const fcEl = document.getElementById('kpiForecast');
  const fcBan = document.getElementById('forecastBannerAmount');
  const fcSub = document.getElementById('forecastBannerSub');
  const bal = bankBalance + cashBalance;
  if (fcEl) fcEl.textContent = fmt(bal);
  if (fcBan) fcBan.textContent = fmt(bal);
  if (fcSub) {
    fcSub.textContent = bal >= 0 ? '黒字着地見込み' : '赤字着地見込み';
    fcSub.style.color = bal >= 0 ? 'var(--clr-income-dark)' : 'var(--clr-expense-dark)';
  }
}

function renderCharts() {
  const months = [];
  for (let i=5; i>=0; i--) {
    let m = currentMonth - i, y = currentYear;
    while(m<=0){ m+=12; y--; }
    months.push({y, m});
  }
  const barLabels = months.map(d => `${d.m}月`);
  const barIncomes = months.map(d => allTransactions.filter(t => t.date && t.date.startsWith(`${d.y}-${padZ(d.m)}`) && t.type==='income').reduce((s,t)=>s+Number(t.amount),0));
  const barExpenses = months.map(d => allTransactions.filter(t => t.date && t.date.startsWith(`${d.y}-${padZ(d.m)}`) && t.type==='expense').reduce((s,t)=>s+Number(t.amount),0));

  const ctxBar = document.getElementById('barChart')?.getContext('2d');
  if (ctxBar) {
    if (barChartInst) barChartInst.destroy();
    barChartInst = new Chart(ctxBar, {
      type: 'bar',
      data: { labels: barLabels, datasets: [
        { label:'収入', data:barIncomes, backgroundColor:'rgba(16,185,129,0.7)' },
        { label:'支出', data:barExpenses, backgroundColor:'rgba(239,68,68,0.7)' }
      ]},
      options: { responsive:true, maintainAspectRatio:false }
    });
  }

  const key = `${currentYear}-${padZ(currentMonth)}`;
  const exps = allTransactions.filter(t => t.date && t.date.startsWith(key) && t.type==='expense');
  const mapC = {};
  exps.forEach(t => mapC[t.category] = (mapC[t.category]||0) + Number(t.amount));
  const sorted = Object.entries(mapC).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const pieLabels = sorted.map(d=>d[0].replace(/（[ABC]箱）$/,''));
  const pieData = sorted.map(d=>d[1]);

  const ctxPie = document.getElementById('pieChart')?.getContext('2d');
  if (ctxPie) {
    if (pieChartInst) pieChartInst.destroy();
    pieChartInst = new Chart(ctxPie, {
      type: 'doughnut',
      data: { labels: pieLabels, datasets: [{ data: pieData, backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'] }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{boxWidth:12, font:{size:10}} } } }
    });
  }
}

function renderSummaries() {
  const key = `${currentYear}-${padZ(currentMonth)}`;
  const exps = allTransactions.filter(t => t.date && t.date.startsWith(key) && t.type==='expense');

  // 支払い方法別
  const mapP = {};
  exps.forEach(t => mapP[t.payment_method] = (mapP[t.payment_method]||0) + Number(t.amount));
  const pList = document.getElementById('paymentSummary');
  if (pList) {
    pList.innerHTML = '';
    const totalExp = exps.reduce((s,t)=>s+Number(t.amount),0) || 1;
    Object.entries(mapP).sort((a,b)=>b[1]-a[1]).forEach(([pm, amt]) => {
      const pct = (amt / totalExp * 100).toFixed(1);
      pList.innerHTML += `<div class="summary-row"><span class="summary-name">${PM_LABEL[pm]||pm}</span><span class="summary-bar-wrap"><span class="summary-bar" style="width:${pct}%;"></span></span><span class="summary-val">${fmt(amt)}</span></div>`;
    });
  }

  // カテゴリ別
  const mapC = {};
  exps.forEach(t => mapC[t.category] = (mapC[t.category]||0) + Number(t.amount));
  const cList = document.getElementById('categorySummary');
  if (cList) {
    cList.innerHTML = '';
    Object.entries(mapC).sort((a,b)=>b[1]-a[1]).forEach(([cat, amt]) => {
      const box = CATEGORY_BOX[cat] ? `<span class="box-badge ${CATEGORY_BOX[cat].toLowerCase()}box">${CATEGORY_BOX[cat]}</span>` : '';
      cList.innerHTML += `<div class="summary-row"><span class="summary-name">${box} ${cat.replace(/（[ABC]箱）$/,'')}</span><span class="summary-val">${fmt(amt)}</span></div>`;
    });
  }

  // ボックス別消化 (予算連携なしの簡易版)
  const mapB = { A:0, B:0, C:0 };
  exps.forEach(t => { if(CATEGORY_BOX[t.category]) mapB[CATEGORY_BOX[t.category]] += Number(t.amount); });
  const bList = document.getElementById('boxBudgetOverview');
  if (bList) {
    bList.innerHTML = '';
    ['A','B','C'].forEach(b => {
      bList.innerHTML += `<div class="bov-card ${b.toLowerCase()}box"><div class="bov-label">${b}箱</div><div class="bov-actual">${fmt(mapB[b])}</div></div>`;
    });
  }
}

function renderList() {
  const key = `${currentYear}-${padZ(currentMonth)}`;
  const listEl = document.getElementById('transactionCards');
  const emptyEl = document.getElementById('emptyState');
  const totalsEl = document.getElementById('listTotals');
  const filterVal = document.getElementById('filterCategory')?.value;

  let txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
  if (filterVal) txs = txs.filter(t => t.category === filterVal);
  txs.sort((a,b) => new Date(b.date) - new Date(a.date));

  if (txs.length === 0) {
    if (listEl) listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (totalsEl) totalsEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (totalsEl) totalsEl.style.display = 'block';

  let html = '';
  let inc=0, expB=0, expC=0;
  txs.forEach(t => {
    const amt = Number(t.amount);
    if (t.type==='income') inc+=amt;
    else if (t.type==='expense') { if(t.payment_method==='cash') expC+=amt; else if(t.payment_method!=='credit_card') expB+=amt; }
    
    const icon = t.type==='income'?'fa-arrow-down':t.type==='expense'?'fa-arrow-up':'fa-random';
    const color = t.type==='income'?'plus':t.type==='expense'?'minus':'transfer';
    html += `
      <div class="tx-card">
        <div class="tx-icon ${color}"><i class="fas ${icon}"></i></div>
        <div class="tx-main">
          <div class="tx-cat">${t.category.replace(/（[ABC]箱）$/,'')} <span class="tx-pm">${PM_LABEL[t.payment_method]||t.payment_method}</span></div>
          <div class="tx-date">${t.date} ${t.memo?`| ${t.memo}`:''}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${color}">${t.type==='expense'?'-':''}${fmt(amt)}</div>
          <button class="btn-delete" data-id="${t.id}"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
  });
  if (listEl) listEl.innerHTML = html;

  document.getElementById('totalsIncome').textContent = fmt(inc);
  document.getElementById('totalsBankExp').textContent = fmt(expB);
  document.getElementById('totalsCashExp').textContent = fmt(expC);
  document.getElementById('totalsBalance').textContent = fmt(inc - expB - expC);

  // 削除イベント登録
  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if (confirm('この明細を削除しますか？')) {
        showLoading();
        await supabase.from(TX_TABLE).delete().eq('id', id);
        allTransactions = await fetchAll(TX_TABLE, 'date');
        renderDashboard();
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
  
  // フィルター用カテゴリ一覧更新
  const filter = document.getElementById('filterCategory');
  if (filter) {
    const key = `${currentYear}-${padZ(currentMonth)}`;
    const cats = [...new Set(allTransactions.filter(t=>t.date&&t.date.startsWith(key)).map(t=>t.category))].sort();
    filter.innerHTML = '<option value="">全科目</option>' + cats.map(c=>`<option value="${c}">${c}</option>`).join('');
  }
}

async function handleBalanceSetupSubmit(e) {
  e.preventDefault();
  const rawMonth = document.getElementById('setupMonth').value;
  const month = rawMonth.slice(0, 7);
  const bank = Number(document.getElementById('setupBank').value) || 0;
  const cash = Number(document.getElementById('setupCash').value) || 0;

  const existing = balanceSettings.find(s => s.month === month);
  const payload = { user_id: currentUser.id, month, bank_balance: bank, cash_balance: cash };

  showLoading();
  if (existing) await supabase.from(BAL_TABLE).update(payload).eq('id', existing.id);
  else await supabase.from(BAL_TABLE).insert([payload]);
  
  balanceSettings = await fetchAll(BAL_TABLE);
  document.getElementById('balanceSetupModal').style.display='none';
  renderDashboard();
  hideLoading();
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  showLoading();
  [allTransactions, balanceSettings] = await Promise.all([ fetchAll(TX_TABLE, 'date'), fetchAll(BAL_TABLE, 'month') ]);
  renderDashboard();
  hideLoading();

  document.getElementById('openBalanceSetupBtn')?.addEventListener('click', () => { document.getElementById('balanceSetupModal').style.display='flex'; });
  document.getElementById('balanceSetupCancelBtn')?.addEventListener('click', () => { document.getElementById('balanceSetupModal').style.display='none'; });
  document.getElementById('balanceSetupForm')?.addEventListener('submit', handleBalanceSetupSubmit);
  
  document.getElementById('prevMonthBtn')?.addEventListener('click', () => { currentMonth--; if(currentMonth<1){currentMonth=12; currentYear--;} renderDashboard(); });
  document.getElementById('nextMonthBtn')?.addEventListener('click', () => { currentMonth++; if(currentMonth>12){currentMonth=1; currentYear++;} renderDashboard(); });
  
  document.getElementById('filterCategory')?.addEventListener('change', renderList);

  // タブ切替
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
      e.currentTarget.classList.add('active');
      document.getElementById('tab-' + e.currentTarget.dataset.tab).classList.add('active');
    });
  });
}

document.addEventListener('DOMContentLoaded', init);