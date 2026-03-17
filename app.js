/* =============================================
   app.js  — マイダッシュボード
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

// B箱を11項目に完全対応
const CATEGORY_BOX = {
  '通信費（A箱）':'A','消耗品費（A箱）':'A','旅費交通費（A箱）':'A','支払手数料（A箱）':'A','接待交際費（A箱）':'A','新聞図書費（A箱）':'A',
  '食費（B箱）':'B', '日用品（B箱）':'B', '趣味・娯楽（B箱）':'B', '自己研鑽（B箱）':'B', '衣服・美容（B箱）':'B', '健康・医療（B箱）':'B', '交際費（B箱）':'B', '交通費（B箱）':'B', '保険（B箱）':'B', '投資（B箱）':'B', 'その他（B箱）':'B',
  '家族生活費（C箱）':'C','租税公課（C箱）':'C','法定福利費（C箱）':'C'
};

let allTransactions  = [];
let balanceSettings  = [];
let currentYear      = new Date().getFullYear();
let currentMonth     = new Date().getMonth() + 1;

const fmt = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
function padZ(n) { return String(n).padStart(2,'0'); }

async function fetchAll(table) {
  if (!currentUser) return [];
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id);
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

function renderDashboard() {
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
}

async function handleBalanceSetupSubmit(e) {
  e.preventDefault();
  const rawMonth = document.getElementById('setupMonth').value;
  const month = rawMonth.slice(0, 7);
  const bank = Number(document.getElementById('setupBank').value) || 0;
  const cash = Number(document.getElementById('setupCash').value) || 0;

  const existing = balanceSettings.find(s => s.month === month);
  const payload = { user_id: currentUser.id, month, bank_balance: bank, cash_balance: cash };

  if (existing) {
    await supabase.from(BAL_TABLE).update(payload).eq('id', existing.id);
  } else {
    await supabase.from(BAL_TABLE).insert([payload]);
  }
  
  balanceSettings = await fetchAll(BAL_TABLE);
  document.getElementById('balanceSetupModal').style.display='none';
  renderDashboard();
}

async function init() {
  currentUser = await requireAuth();
  if (!currentUser) return;

  [allTransactions, balanceSettings] = await Promise.all([ fetchAll(TX_TABLE), fetchAll(BAL_TABLE) ]);
  renderDashboard();

  document.getElementById('openBalanceSetupBtn')?.addEventListener('click', () => {
    document.getElementById('balanceSetupModal').style.display='flex';
  });
  document.getElementById('balanceSetupCancelBtn')?.addEventListener('click', () => {
    document.getElementById('balanceSetupModal').style.display='none';
  });
  document.getElementById('balanceSetupForm')?.addEventListener('submit', handleBalanceSetupSubmit);
}

document.addEventListener('DOMContentLoaded', init);