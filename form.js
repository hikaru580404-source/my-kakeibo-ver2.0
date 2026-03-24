/* =============================================
   form.js — 収支入力画面ロジック
   AsirLabo OS 統合版:
     - 新Supabase (qzxajtlisscwxwidicfh) 接続
     - JST日付で日付フィールド初期化
     - requireAuth() → getSession() ベース
     - location.replace() で認証リダイレクト統一
   ============================================= */
'use strict';
import { supabase, requireAuth, getJSTDateString } from './supabase-client.js';

let currentUser    = null;
let balanceSettings = [];
let allTransactions = [];
let pendingData     = null;

const PM_LABEL = {
  qr_code:          '📱 QRコード決済',
  credit_card:      '💳 クレジットカード',
  cash:             '💵 現金',
  bank_in:          '🏦 銀行口座',
  transfer_to_cash: '🏧 ATM振替'
};

function padZ2(n)  { return String(n).padStart(2, '0'); }
function fmt(n)    { return '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); }
function showLoading() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoading()  { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

async function fetchAll(table, sortField = 'created_at') {
  if (!currentUser) return [];
  const { data, error } = await supabase
    .from(table).select('*')
    .eq('user_id', currentUser.id)
    .order(sortField, { ascending: true });
  if (error) { console.error(`[fetchAll] ${table}:`, error.message); return []; }
  return data || [];
}

// ── 収支区分の切り替え制御 ──
function onTypeChange() {
  const type     = document.querySelector('input[name="txType"]:checked').value;
  const catGroup = document.getElementById('categoryGroup');
  const payGroup = document.getElementById('paymentGroup');
  const incGroup = document.getElementById('incomeMethodGroup');
  const trnNotice = document.getElementById('transferNotice');
  const catSelect = document.getElementById('inputCategory');

  Array.from(catSelect.options).forEach(opt => {
    if (opt.value === '') return;
    const isIncomeCat = opt.parentNode.label.includes('収入');
    opt.style.display = (type === 'income') ? (isIncomeCat ? 'block' : 'none')
                                             : (!isIncomeCat ? 'block' : 'none');
  });
  catSelect.value = '';

  if (type === 'income') {
    catGroup.style.display  = 'block';
    incGroup.style.display  = 'block';
    payGroup.style.display  = 'none';
    trnNotice.style.display = 'none';
  } else if (type === 'expense') {
    catGroup.style.display  = 'block';
    incGroup.style.display  = 'none';
    payGroup.style.display  = 'block';
    trnNotice.style.display = 'none';
  } else {
    catGroup.style.display  = 'none';
    incGroup.style.display  = 'none';
    payGroup.style.display  = 'none';
    trnNotice.style.display = 'block';
  }
  updateAfterPreview();
}

// ── 残高計算 ──
function calcCurrentBalance() {
  const jstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const key    = `${jstNow.getUTCFullYear()}-${padZ2(jstNow.getUTCMonth() + 1)}`;
  const setting = balanceSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance) : 0;

  allTransactions.filter(t => t.date && t.date.startsWith(key)).forEach(tx => {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt; else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else if (tx.payment_method === 'credit_card') { /* クレカはスルー */ }
      else bank -= amt;
    } else if (tx.type === 'transfer') {
      bank -= amt; cash += amt;
    }
  });
  return { bank, cash };
}

function updateQuickBalance() {
  const bal = calcCurrentBalance();
  const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  safeSet('qbBank',  fmt(bal.bank));
  safeSet('qbCash',  fmt(bal.cash));
  safeSet('qbTotal', fmt(bal.bank + bal.cash));
}

function updateAfterPreview() {
  let bal  = calcCurrentBalance();
  const type   = document.querySelector('input[name="txType"]:checked')?.value;
  const amt    = parseInt(document.getElementById('inputAmount').value, 10) || 0;

  if (type === 'income') {
    const method = document.querySelector('input[name="incomeMethod"]:checked')?.value;
    if (method === 'cash') bal.cash += amt; else bal.bank += amt;
  } else if (type === 'expense') {
    const method = document.querySelector('input[name="payMethod"]:checked')?.value;
    if (method === 'cash') bal.cash -= amt;
    else if (method !== 'credit_card') bal.bank -= amt;
  } else if (type === 'transfer') {
    bal.bank -= amt; bal.cash += amt;
  }

  const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  safeSet('previewBank', fmt(bal.bank));
  safeSet('previewCash', fmt(bal.cash));
}

// ── ステップ遷移 ──
function goToStep(step) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active', 'done'));
  document.querySelectorAll('.step-line').forEach(l => l.classList.remove('done'));

  if (step === 1) {
    document.getElementById('panelInput')?.classList.add('active');
    document.getElementById('step1Dot')?.classList.add('active');
  } else if (step === 2) {
    document.getElementById('panelConfirm')?.classList.add('active');
    document.getElementById('step1Dot')?.classList.add('done');
    document.getElementById('step2Dot')?.classList.add('active');
    document.querySelectorAll('.step-line')[0]?.classList.add('done');
  } else if (step === 3) {
    document.getElementById('panelDone')?.classList.add('active');
    document.getElementById('step1Dot')?.classList.add('done');
    document.getElementById('step2Dot')?.classList.add('done');
    document.getElementById('step3Dot')?.classList.add('active');
    document.querySelectorAll('.step-line').forEach(l => l.classList.add('done'));
  }
}

// ── 確認画面へ ──
function handleGoToConfirm(e) {
  e.preventDefault();
  const date     = document.getElementById('inputDate').value;
  const type     = document.querySelector('input[name="txType"]:checked').value;
  let category   = document.getElementById('inputCategory').value;
  let method     = '';

  if (type === 'income')   method = document.querySelector('input[name="incomeMethod"]:checked').value;
  else if (type === 'expense') method = document.querySelector('input[name="payMethod"]:checked').value;
  else { category = 'ATM振替'; method = 'transfer_to_cash'; }

  const amountStr = document.getElementById('inputAmount').value;
  const amount    = parseInt(amountStr, 10);
  const memo      = document.getElementById('inputMemo').value.trim();

  if (!date || !amountStr)         { alert('日付と金額を入力してください。'); return; }
  if (isNaN(amount) || amount <= 0) { alert('金額は正の整数で入力してください。'); return; }
  if (type !== 'transfer' && !category) { alert('勘定科目を選択してください。'); return; }

  pendingData = { user_id: currentUser.id, date, type, amount, category, payment_method: method, memo };

  const badge = document.getElementById('confirmTypeBadge');
  const amtEl = document.getElementById('confirmAmount');
  if (type === 'income') {
    badge.className = 'confirm-type-badge income'; badge.innerHTML = '<i class="fas fa-arrow-down"></i> 収入';
    amtEl.className = 'confirm-amount income';     amtEl.textContent = '+' + fmt(amount);
  } else if (type === 'expense') {
    badge.className = 'confirm-type-badge expense'; badge.innerHTML = '<i class="fas fa-arrow-up"></i> 支出';
    amtEl.className = 'confirm-amount expense';     amtEl.textContent = '-' + fmt(amount);
  } else {
    badge.className = 'confirm-type-badge transfer'; badge.innerHTML = '<i class="fas fa-random"></i> ATM振替';
    amtEl.className = 'confirm-amount transfer';     amtEl.textContent = '±' + fmt(amount);
  }

  const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  safeSet('confirmDate',     date);
  safeSet('confirmCategory', category);
  safeSet('confirmPayment',  PM_LABEL[method] || 'ATM');
  safeSet('confirmMemo',     memo || 'なし');

  goToStep(2);
}

// ── 確定保存 ──
async function handleConfirmSave() {
  if (!pendingData) return;
  showLoading();
  const { error } = await supabase.from('transactions').insert([pendingData]);
  if (error) {
    alert('保存エラー: ' + error.message);
    hideLoading();
    return;
  }
  allTransactions = await fetchAll('transactions', 'date');
  updateQuickBalance();
  hideLoading();
  goToStep(3);
}

// ── 初期化 ──
document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await requireAuth();
  if (!currentUser) return;

  showLoading();
  [allTransactions, balanceSettings] = await Promise.all([
    fetchAll('transactions', 'date'),
    fetchAll('balance_settings', 'month')
  ]);

  // JST 基準で今日の日付をセット
  document.getElementById('inputDate').value = getJSTDateString();

  // フォーム上部ヘッダーに日付表示
  const headerDate = document.getElementById('headerDate');
  if (headerDate) {
    const jstNow = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
    headerDate.textContent = `${jstNow.getUTCFullYear()}/${padZ2(jstNow.getUTCMonth()+1)}/${padZ2(jstNow.getUTCDate())}`;
  }

  updateQuickBalance();
  onTypeChange();
  hideLoading();

  document.getElementById('inputForm')?.addEventListener('submit', handleGoToConfirm);
  document.getElementById('confirmSaveBtn')?.addEventListener('click', handleConfirmSave);
  document.getElementById('backToInputBtn')?.addEventListener('click', () => goToStep(1));
  document.getElementById('addMoreBtn')?.addEventListener('click', () => {
    document.getElementById('inputForm').reset();
    document.getElementById('inputDate').value = getJSTDateString();
    onTypeChange();
    goToStep(1);
  });

  document.querySelectorAll('input[name="txType"]').forEach(r => r.addEventListener('change', onTypeChange));
  document.querySelectorAll('input[name="payMethod"], input[name="incomeMethod"]').forEach(r => r.addEventListener('change', updateAfterPreview));
  document.getElementById('inputAmount')?.addEventListener('input', updateAfterPreview);
});
