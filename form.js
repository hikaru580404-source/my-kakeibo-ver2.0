/* =============================================
   form.js — 入力専用ページ ロジック 完全版（支払い方法カスタム化対応）
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';

// 決済方法のラベル定義を「3パターン」に集約
const PM_LABEL = {
  qr_code: '📱 QRコード決済',
  credit_card: '💳 クレジットカード', 
  cash: '💵 現金', 
  bank_in: '🏦 銀行口座', 
  transfer_to_cash: '🏧 ATM振替'
};
const TYPE_LABEL = { income: '収入', expense: '支出', transfer: 'ATM振替' };

let allTransactions = [];
let balanceSettings = [];
let currentBankBalance = 0;
let currentCashBalance = 0;
let pendingData = null;

const fmt  = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
function padZ(n) { return String(n).padStart(2, '0'); }
function showLoading() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

async function fetchAll(table, sortField = 'created_at') {
  if (!currentUser) return [];
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id).order(sortField, { ascending: true });
  return data || [];
}

function calcCurrentBalances() {
  const now = new Date();
  const key = `${now.getFullYear()}-${padZ(now.getMonth() + 1)}`;
  const setting = balanceSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance) : 0;

  const txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
  for (const tx of txs) {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt;
      else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else if (tx.payment_method === 'credit_card') { /* クレカは残高スルー */ }
      else bank -= amt; // QRコード決済はここに入り、銀行から引かれます
    } else if (tx.type === 'transfer') {
      bank -= amt; cash += amt;
    }
  }
  return { bank, cash };
}

function updateQuickBalance() {
  const { bank, cash } = calcCurrentBalances();
  currentBankBalance = bank; currentCashBalance = cash;
  document.getElementById('qbBank').textContent  = fmt(bank);
  document.getElementById('qbCash').textContent  = fmt(cash);
  document.getElementById('qbTotal').textContent = fmt(bank + cash);
}

function updateAfterPreview() {
  const type   = document.querySelector('input[name="txType"]:checked')?.value;
  const amt    = Number(document.getElementById('inputAmount').value) || 0;
  const method = getPaymentMethod(type);

  let previewBank = currentBankBalance;
  let previewCash = currentCashBalance;

  if (amt > 0) {
    if (type === 'income') {
      if (method === 'cash') previewCash += amt;
      else previewBank += amt;
    } else if (type === 'expense') {
      if (method === 'cash') previewCash -= amt;
      else if (method === 'credit_card') { /* クレカはスルー */ }
      else previewBank -= amt; // QRコード決済はここに入り、銀行から引かれます
    } else if (type === 'transfer') {
      previewBank -= amt; previewCash += amt;
    }
  }
  document.getElementById('previewBank').textContent = fmt(previewBank);
  document.getElementById('previewCash').textContent = fmt(previewCash);
}

function getPaymentMethod(type) {
  if (type === 'transfer') return 'transfer_to_cash';
  if (type === 'income') return document.querySelector('input[name="incomeMethod"]:checked')?.value || 'bank_in';
  return document.querySelector('input[name="payMethod"]:checked')?.value || 'qr_code';
}

function onTypeChange() {
  const type = document.querySelector('input[name="txType"]:checked')?.value;
  document.getElementById('categoryGroup').style.display     = type === 'transfer' ? 'none' : 'block';
  document.getElementById('paymentGroup').style.display      = type === 'expense'  ? 'block' : 'none';
  document.getElementById('incomeMethodGroup').style.display = type === 'income'   ? 'block' : 'none';
  document.getElementById('transferNotice').style.display    = type === 'transfer' ? 'block' : 'none';
  updateAfterPreview();
}

function goToStep(step) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  
  document.getElementById({ 1:'panelInput', 2:'panelConfirm', 3:'panelDone' }[step]).classList.add('active');
  for(let i=1; i<=step; i++) {
    document.getElementById(`step${i}Dot`).classList.add('active');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderTodayHistory() {
  const todayStr = new Date().toISOString().split('T')[0];
  const listEl = document.getElementById('todayList');
  if (!listEl) return;

  const todayTxs = allTransactions.filter(t => t.created_at && t.created_at.startsWith(todayStr)).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));

  if (todayTxs.length === 0) {
    listEl.innerHTML = '<div class="today-empty">今日の入力履歴はありません</div>';
    return;
  }

  let html = '';
  todayTxs.forEach(t => {
    const color = t.type === 'income' ? 'plus' : t.type === 'expense' ? 'minus' : 'transfer';
    const sign  = t.type === 'expense' ? '-' : '';
    html += `
      <div class="today-item">
        <div class="today-item-main">
          <div class="today-item-cat">${t.category.replace(/（[ABC]箱）$/,'')} <span class="today-item-pm">${PM_LABEL[t.payment_method]||t.payment_method}</span></div>
          <div class="today-item-memo">${t.date} ${t.memo ? `| ${t.memo}` : ''}</div>
        </div>
        <div class="today-item-right">
          <div class="today-item-amount ${color}">${sign}${fmt(t.amount)}</div>
          <button class="today-delete-btn" data-id="${t.id}"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `;
  });
  listEl.innerHTML = html;

  document.querySelectorAll('.today-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      if(confirm('この明細を削除しますか？')) {
        showLoading();
        await supabase.from(TX_TABLE).delete().eq('id', id);
        allTransactions = await fetchAll(TX_TABLE, 'date');
        renderTodayHistory();
        updateQuickBalance();
        hideLoading();
      }
    });
  });
}

function handleGoToConfirm(e) {
  e.preventDefault();
  const type = document.querySelector('input[name="txType"]:checked')?.value;
  const date = document.getElementById('inputDate').value;
  const amt  = Number(document.getElementById('inputAmount').value);
  const memo = document.getElementById('inputMemo').value.trim();
  const method = getPaymentMethod(type);

  if (!date || !type || !amt) return;
  let category = type === 'transfer' ? 'ATM出金（銀行→現金）' : document.getElementById('inputCategory').value;
  if (!category) return;

  pendingData = { user_id: currentUser.id, type, date, category, amount: amt, payment_method: method, memo };

  document.getElementById('confirmAmount').textContent = fmt(amt);
  document.getElementById('confirmDate').textContent = date;
  document.getElementById('confirmCategory').textContent = category;
  document.getElementById('confirmPayment').textContent = PM_LABEL[method] || method;
  goToStep(2);
}

async function handleConfirmSave() {
  if (!pendingData) return;
  showLoading();
  await supabase.from(TX_TABLE).insert([pendingData]);
  allTransactions = await fetchAll(TX_TABLE, 'date');
  updateQuickBalance();
  renderTodayHistory();
  hideLoading();
  goToStep(3);
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  showLoading();
  [allTransactions, balanceSettings] = await Promise.all([ fetchAll(TX_TABLE, 'date'), fetchAll(BAL_TABLE, 'month') ]);
  
  const t = new Date();
  document.getElementById('inputDate').value = `${t.getFullYear()}-${padZ(t.getMonth()+1)}-${padZ(t.getDate())}`;
  
  updateQuickBalance();
  onTypeChange();
  hideLoading();

  document.getElementById('inputForm').addEventListener('submit', handleGoToConfirm);
  document.getElementById('confirmSaveBtn').addEventListener('click', handleConfirmSave);
  document.getElementById('backToInputBtn').addEventListener('click', () => goToStep(1));
  document.getElementById('addMoreBtn').addEventListener('click', () => { document.getElementById('inputForm').reset(); onTypeChange(); goToStep(1); });
  document.querySelectorAll('input[name="txType"]').forEach(r => r.addEventListener('change', onTypeChange));
  document.querySelectorAll('input[name="payMethod"], input[name="incomeMethod"]').forEach(r => r.addEventListener('change', updateAfterPreview));
  document.getElementById('inputAmount').addEventListener('input', updateAfterPreview);
}

document.addEventListener('DOMContentLoaded', init);