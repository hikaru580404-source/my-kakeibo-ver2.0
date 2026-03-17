/* =============================================
   summary.js  — 月次サマリーページ ロジック
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
const TX_TABLE = 'transactions';
const BUDGET_TABLE = 'budgets';

const CATEGORY_BOX = {
  '通信費（A箱）':'A','消耗品費（A箱）':'A','旅費交通費（A箱）':'A','支払手数料（A箱）':'A','接待交際費（A箱）':'A','新聞図書費（A箱）':'A',
  '食費（B箱）':'B', '日用品（B箱）':'B', '趣味・娯楽（B箱）':'B', '自己研鑽（B箱）':'B', '衣服・美容（B箱）':'B', '健康・医療（B箱）':'B', '交際費（B箱）':'B', '交通費（B箱）':'B', '保険（B箱）':'B', '投資（B箱）':'B', 'その他（B箱）':'B',
  '家族生活費（C箱）':'C','租税公課（C箱）':'C','法定福利費（C箱）':'C'
};

const BOX_CATEGORIES = {
  A: ['通信費（A箱）','消耗品費（A箱）','旅費交通費（A箱）','支払手数料（A箱）','接待交際費（A箱）','新聞図書費（A箱）'],
  B: ['食費（B箱）', '日用品（B箱）', '趣味・娯楽（B箱）', '自己研鑽（B箱）', '衣服・美容（B箱）', '健康・医療（B箱）', '交際費（B箱）', '交通費（B箱）', '保険（B箱）', '投資（B箱）', 'その他（B箱）'],
  C: ['家族生活費（C箱）','租税公課（C箱）','法定福利費（C箱）']
};
const BOX_NAMES = { A:'A箱 事業経費', B:'B箱 個人消費', C:'C箱 固定費' };
const BOX_COLORS = { A:'var(--clr-abox)', B:'var(--clr-bbox)', C:'var(--clr-cbox)' };

let allTx = [];
let budgets = [];
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;
let trendChartInst = null;

const fmt = n => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
const fmtS = n => (n >= 0 ? '+' : '−') + fmt(n);
function padZ(n) { return String(n).padStart(2,'0'); }
function monthKey(y,m) { return `${y}-${padZ(m)}`; }
function showLoading() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }

async function fetchAll(table) {
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id);
  return data || [];
}

function updateMonthLabel() { document.getElementById('summaryMonthLabel').textContent = `${viewYear}年${padZ(viewMonth)}月`; }
function populateMonthJump() {
  const sel = document.getElementById('monthJump'); sel.innerHTML = '';
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    let m = now.getMonth() + 1 - i, y = now.getFullYear();
    while (m <= 0) { m += 12; y--; }
    const key = monthKey(y, m);
    const opt = document.createElement('option'); opt.value = key; opt.textContent = `${y}年${padZ(m)}月`;
    if (y === viewYear && m === viewMonth) opt.selected = true;
    sel.appendChild(opt);
  }
}
function changeMonth(d) {
  viewMonth += d;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  if (viewMonth < 1)  { viewMonth = 12; viewYear--; }
  renderAll();
}

function renderKPI() {
  const key = monthKey(viewYear, viewMonth);
  const txs = allTx.filter(t => t.date && t.date.startsWith(key));
  const income = txs.filter(t => t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const expense = txs.filter(t => t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);
  const balance = income - expense;
  
  document.getElementById('skIncome').textContent = fmt(income);
  document.getElementById('skExpense').textContent = fmt(expense);
  const balEl = document.getElementById('skBalance');
  balEl.textContent = fmtS(balance);
  balEl.style.color = balance >= 0 ? 'var(--clr-income-dark)' : 'var(--clr-expense-dark)';
}

function renderBoxSummary() {
  const key = monthKey(viewYear, viewMonth);
  const txs = allTx.filter(t => t.date && t.date.startsWith(key) && t.type === 'expense');
  const bList = document.getElementById('boxSummaryList');
  bList.innerHTML = '';

  ['A','B','C'].forEach(box => {
    const actual = txs.filter(t => CATEGORY_BOX[t.category] === box).reduce((s,t)=>s+Number(t.amount),0);
    const budget = budgets.filter(b => b.month === key && b.box === box).reduce((s,b) => s + Number(b.amount||0), 0);
    const hasBudget = budget > 0;
    const pct = hasBudget ? Math.min((actual / budget) * 100, 150) : 0;
    const status = !hasBudget ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';

    bList.innerHTML += `<div class="box-summary-item"><div class="box-summary-top"><span class="box-badge ${box.toLowerCase()}box">${box}</span><span class="box-summary-name">${BOX_NAMES[box]}</span><div class="box-summary-amounts"><span class="box-actual">${fmt(actual)}</span>${hasBudget ? `<span class="box-budget">/ ${fmt(budget)}</span>` : '<span class="box-budget">予算未設定</span>'}</div></div><div class="box-bar-wrap"><div class="box-bar ${status}" style="width:${pct.toFixed(1)}%;background:${BOX_COLORS[box]};"></div></div><div class="box-pct-label">${hasBudget ? `${pct.toFixed(1)}%消化` : '─'}</div></div>`;
  });
}

function renderCatDetail() {
  const key = monthKey(viewYear, viewMonth);
  const txs = allTx.filter(t => t.date && t.date.startsWith(key) && t.type === 'expense');
  const el = document.getElementById('catDetailList');
  el.innerHTML = '';

  ['A','B','C'].forEach(box => {
    let html = `<div class="cat-detail-box"><div class="cat-detail-box-title ${box.toLowerCase()}box"><span>${box}箱</span></div>`;
    BOX_CATEGORIES[box].forEach(cat => {
      const actual = txs.filter(t => t.category === cat).reduce((s,t)=>s+Number(t.amount),0);
      const budRow = budgets.find(b => b.month === key && b.box === box && b.category === cat);
      const budget = budRow ? Number(budRow.amount) : 0;
      const hasBudget = budget > 0;
      const pct = hasBudget ? Math.min((actual/budget)*100, 150) : 0;
      const status = !hasBudget ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
      html += `<div class="cat-detail-row"><span class="cat-detail-name">${cat.replace(/（[ABC]箱）$/,'')}</span><div class="cat-detail-bar-wrap"><div class="cat-detail-bar" style="width:${hasBudget?pct.toFixed(1):0}%;background:${BOX_COLORS[box]};"></div></div><span class="cat-detail-budget">${hasBudget ? fmt(budget) : '─'}</span><span class="cat-detail-actual ${status==='over'?'over':'ok'}">${actual>0?fmt(actual):'─'}</span></div>`;
    });
    html += '</div>';
    el.innerHTML += html;
  });
}

function renderTrendChart() {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    let m = viewMonth - i, y = viewYear;
    while (m <= 0) { m += 12; y--; }
    months.push({ y, m });
  }
  const labels = months.map(d => `${d.y === viewYear ? '' : d.y+'年'}${d.m}月`);
  const incomes = months.map(d => allTx.filter(t => t.date && t.date.startsWith(monthKey(d.y,d.m)) && t.type==='income').reduce((s,t)=>s+Number(t.amount),0));
  const expenses = months.map(d => allTx.filter(t => t.date && t.date.startsWith(monthKey(d.y,d.m)) && t.type==='expense').reduce((s,t)=>s+Number(t.amount),0));

  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChartInst) trendChartInst.destroy();
  trendChartInst = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[ { label:'収入', data:incomes, backgroundColor:'rgba(16,185,129,.75)' }, { label:'支出', data:expenses, backgroundColor:'rgba(239,68,68,.75)' } ] },
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

function renderAll() { updateMonthLabel(); populateMonthJump(); renderKPI(); renderBoxSummary(); renderCatDetail(); renderTrendChart(); }

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  showLoading();
  [allTx, budgets] = await Promise.all([fetchAll(TX_TABLE), fetchAll(BUDGET_TABLE)]);
  document.getElementById('prevMonthBtn').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => changeMonth(+1));
  document.getElementById('monthJump').addEventListener('change', e => { const [y,m] = e.target.value.split('-').map(Number); viewYear=y; viewMonth=m; renderAll(); });
  hideLoading(); renderAll();
}

document.addEventListener('DOMContentLoaded', init);