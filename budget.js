/* =============================================
   budget.js  — 予算管理ページ ロジック 完全版（新12項目対応）
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
const TX_TABLE     = 'transactions';
const BUDGET_TABLE = 'budgets';

// バッジ・集計用の定義（新12項目対応）
const CATEGORY_BOX = {
  '通信費（A箱）':'A','消耗品費（A箱）':'A','旅費交通費（A箱）':'A','支払手数料（A箱）':'A','接待交際費（A箱）':'A','新聞図書費（A箱）':'A',
  
  '個人サブスク・通信費（B箱）':'B', '飲食費（ランチ・カフェ）（B箱）':'B', '美容・被服費（B箱）':'B', '趣味・娯楽費（B箱）':'B', '個人交際費・予備費（B箱）':'B',
  '日用品（B箱）':'B', '自己研鑽（B箱）':'B', '健康・医療（B箱）':'B', '交通費（B箱）':'B', '保険（B箱）':'B', '投資（B箱）':'B', 'その他（B箱）':'B',
  
  '家族生活費（C箱）':'C','租税公課（C箱）':'C','法定福利費（C箱）':'C'
};

// 一覧表示順の定義
const BOX_CATEGORIES = {
  A: ['通信費（A箱）','消耗品費（A箱）','旅費交通費（A箱）','支払手数料（A箱）','接待交際費（A箱）','新聞図書費（A箱）'],
  B: [
    '個人サブスク・通信費（B箱）', '飲食費（ランチ・カフェ）（B箱）', '美容・被服費（B箱）', '趣味・娯楽費（B箱）', '個人交際費・予備費（B箱）',
    '日用品（B箱）', '自己研鑽（B箱）', '健康・医療（B箱）', '交通費（B箱）', '保険（B箱）', '投資（B箱）', 'その他（B箱）'
  ],
  C: ['家族生活費（C箱）','租税公課（C箱）','法定福利費（C箱）']
};

let allTx = [];
let budgets = [];
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth() + 1;

const fmt = n => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
function padZ(n) { return String(n).padStart(2,'0'); }
function monthKey(y,m) { return `${y}-${padZ(m)}`; }
function showLoading() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }
function showToast(msg) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2500); }

async function fetchAll(table) {
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id);
  return data || [];
}

function updateMonthLabel() { document.getElementById('budgetMonthLabel').textContent = `${viewYear}年${padZ(viewMonth)}月`; }
function populateMonthJump() {
  const sel = document.getElementById('monthJump');
  const cur = monthKey(viewYear, viewMonth);
  sel.innerHTML = '';
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    let m = now.getMonth() + 1 - i, y = now.getFullYear();
    while (m <= 0) { m += 12; y--; }
    const key = monthKey(y, m);
    const opt = document.createElement('option'); opt.value = key; opt.textContent = `${y}年${padZ(m)}月`;
    if (key === cur) opt.selected = true;
    sel.appendChild(opt);
  }
}
function changeMonth(d) {
  viewMonth += d;
  if (viewMonth > 12) { viewMonth = 1; viewYear++; }
  if (viewMonth < 1)  { viewMonth = 12; viewYear--; }
  renderAll();
}

function getActuals(year, month) {
  const key = monthKey(year, month);
  const txs = allTx.filter(t => t.date && t.date.startsWith(key) && t.type==='expense');
  const map = {};
  txs.forEach(t => map[t.category] = (map[t.category] || 0) + Number(t.amount));
  return map;
}

function renderBoxOverview() {
  const key = monthKey(viewYear, viewMonth);
  const actuals = getActuals(viewYear, viewMonth);
  const el = document.getElementById('budgetBoxOverview');
  el.innerHTML = '';

  ['A','B','C'].forEach(box => {
    const actual = BOX_CATEGORIES[box].reduce((s,c) => s + (actuals[c]||0), 0);
    const budget = budgets.filter(b => b.month === key && b.box === box).reduce((s,b) => s + Number(b.amount||0), 0);
    const hasBud = budget > 0;
    const pct = hasBud ? Math.min((actual/budget)*100, 150) : 0;
    const status = !hasBud ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
    el.innerHTML += `<div class="bov-card ${box.toLowerCase()}box"><div class="bov-label">${box}箱</div><div class="bov-budget">${hasBud ? fmt(budget) : '予算未設定'}</div><div class="bov-actual">${fmt(actual)}</div><div class="bov-pct ${status}">${hasBud ? pct.toFixed(0)+'%' : '─'}</div></div>`;
  });
}

function renderBudgetList(box) {
  const key = monthKey(viewYear, viewMonth);
  const actuals = getActuals(viewYear, viewMonth);
  const listEl = document.getElementById(`budgetList${box}`);
  listEl.innerHTML = '';
  let boxTotal = 0, boxBudget = 0;

  BOX_CATEGORIES[box].forEach(cat => {
    const actual = actuals[cat] || 0;
    const budRow = budgets.find(b => b.month === key && b.box === box && b.category === cat);
    const budAmt = budRow ? Number(budRow.amount) : 0;

    const hasBud = budAmt > 0;
    const pct = hasBud ? Math.min((actual/budAmt)*100, 150) : 0;
    const status = !hasBud ? 'na' : pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
    boxTotal += actual; boxBudget += budAmt;

    listEl.innerHTML += `<div class="budget-cat-row"><span class="budget-cat-name">${cat.replace(/（[ABC]箱）$/,'')}</span><span class="budget-cat-actual">${actual>0?'実績:'+fmt(actual):''}</span><div class="budget-input-wrap"><span class="budget-yen">¥</span><input type="number" class="budget-input" data-box="${box}" data-cat="${cat}" value="${budAmt > 0 ? budAmt : ''}" placeholder="予算額" min="0" /></div><div class="budget-bar-col"><div class="budget-bar-wrap"><div class="budget-bar ${status}" style="width:${hasBud?pct.toFixed(1):0}%;"></div></div><div class="budget-pct ${status}">${hasBud ? pct.toFixed(0)+'%' : '─'}</div></div></div>`;
  });

  const totalEl = document.getElementById(`boxTotal${box}`);
  if (totalEl) totalEl.textContent = boxBudget > 0 ? `${fmt(boxTotal)} / ${fmt(boxBudget)}` : `実績: ${fmt(boxTotal)}`;
}

function renderAll() { updateMonthLabel(); populateMonthJump(); renderBoxOverview(); ['A','B','C'].forEach(renderBudgetList); }

async function saveAllBudgets() {
  const key = monthKey(viewYear, viewMonth);
  const inputs = document.querySelectorAll('.budget-input');
  showLoading();
  
  for (const inp of inputs) {
    const box = inp.dataset.box, cat = inp.dataset.cat, amt = Number(inp.value) || 0;
    const existing = budgets.find(b => b.month === key && b.box === box && b.category === cat);
    if (existing) {
      if (amt === 0) await supabase.from(BUDGET_TABLE).delete().eq('id', existing.id);
      else await supabase.from(BUDGET_TABLE).update({ amount: amt }).eq('id', existing.id);
    } else if (amt > 0) {
      await supabase.from(BUDGET_TABLE).insert([{ user_id: currentUser.id, month: key, box, category: cat, amount: amt }]);
    }
  }
  budgets = await fetchAll(BUDGET_TABLE);
  hideLoading(); renderAll(); showToast('✅ 予算を保存しました');
}

async function copyFromPrev() { document.getElementById('copyConfirmModal').style.display = 'flex'; }
function closeCopyModal() { document.getElementById('copyConfirmModal').style.display = 'none'; }
async function executeCopy() {
  let prevM = viewMonth - 1, prevY = viewYear;
  if (prevM <= 0) { prevM = 12; prevY--; }
  const prevKey = monthKey(prevY, prevM), curKey = monthKey(viewYear, viewMonth);
  const actuals = getActuals(prevY, prevM);
  
  showLoading(); closeCopyModal();
  for (const cat of Object.keys(CATEGORY_BOX)) {
    const amt = Math.round(actuals[cat] || 0);
    if (amt === 0) continue;
    const existing = budgets.find(b => b.month === curKey && b.category === cat);
    if (existing) await supabase.from(BUDGET_TABLE).update({ amount: amt }).eq('id', existing.id);
    else await supabase.from(BUDGET_TABLE).insert([{ user_id: currentUser.id, month: curKey, box: CATEGORY_BOX[cat], category: cat, amount: amt }]);
  }
  budgets = await fetchAll(BUDGET_TABLE);
  hideLoading(); renderAll(); showToast('✅ 前月実績をコピーしました');
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;
  showLoading();
  [allTx, budgets] = await Promise.all([fetchAll(TX_TABLE), fetchAll(BUDGET_TABLE)]);
  document.getElementById('prevMonthBtn').addEventListener('click', () => changeMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => changeMonth(+1));
  document.getElementById('monthJump').addEventListener('change', e => { const [y,m] = e.target.value.split('-').map(Number); viewYear=y; viewMonth=m; renderAll(); });
  document.getElementById('saveAllBudgetsBtn').addEventListener('click', saveAllBudgets);
  document.getElementById('copyFromPrevBtn').addEventListener('click', copyFromPrev);
  document.getElementById('copyModalCancelBtn').addEventListener('click', closeCopyModal);
  document.getElementById('copyModalConfirmBtn').addEventListener('click', executeCopy);
  hideLoading(); renderAll();
}

document.addEventListener('DOMContentLoaded', init);