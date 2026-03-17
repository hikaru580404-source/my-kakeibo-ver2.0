/* =============================================
   form.js — 入力専用ページ ロジック
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';

const PM_LABEL = {
  rakuten: '💳 楽天ペイ', paypay: '💰 PayPay', mercari: '🛍 メルカリ',
  credit_card: '💳 クレジットカード', cash: '💵 現金', bank_in: '🏦 銀行口座', transfer_to_cash: '🏧 ATM振替',
};
const TYPE_LABEL = { income: '収入', expense: '支出', transfer: 'ATM振替' };

let allTransactions = [];
let balanceSettings = [];
let currentBankBalance = 0;
let currentCashBalance = 0;
let pendingData = null;

const fmt  = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
function padZ(n) { return String(n).padStart(2, '0'); }

async function fetchAll(table, sortField = 'created_at') {
  if (!currentUser) return [];
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id).order(sortField, { ascending: true });
  return data || [];
}

// 残高計算（クレジットカードは引かない）
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
      else bank -= amt;
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
      else previewBank -= amt;
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
  return document.querySelector('input[name="payMethod"]:checked')?.value || 'rakuten';
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
  document.getElementById({ 1:'panelInput', 2:'panelConfirm', 3:'panelDone' }[step]).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
  await supabase.from(TX_TABLE).insert([pendingData]);
  allTransactions = await fetchAll(TX_TABLE, 'date');
  updateQuickBalance();
  goToStep(3);
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  [allTransactions, balanceSettings] = await Promise.all([ fetchAll(TX_TABLE, 'date'), fetchAll(BAL_TABLE, 'month') ]);
  
  const t = new Date();
  document.getElementById('inputDate').value = `${t.getFullYear()}-${padZ(t.getMonth()+1)}-${padZ(t.getDate())}`;
  
  updateQuickBalance();
  onTypeChange();

  document.getElementById('inputForm').addEventListener('submit', handleGoToConfirm);
  document.getElementById('confirmSaveBtn').addEventListener('click', handleConfirmSave);
  document.getElementById('backToInputBtn').addEventListener('click', () => goToStep(1));
  document.getElementById('addMoreBtn').addEventListener('click', () => { document.getElementById('inputForm').reset(); goToStep(1); });
  document.querySelectorAll('input[name="txType"]').forEach(r => r.addEventListener('change', onTypeChange));
  document.querySelectorAll('input[name="payMethod"], input[name="incomeMethod"]').forEach(r => r.addEventListener('change', updateAfterPreview));
  document.getElementById('inputAmount').addEventListener('input', updateAfterPreview);
}

document.addEventListener('DOMContentLoaded', init);