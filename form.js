/* =============================================
   form.js — 収支入力画面ロジック (完全復旧版・3ステップ遷移対応)
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

let currentUser = null;
let balanceSettings = [];
let allTransactions = [];
let pendingData = null; // 確認画面へ渡すデータ

// 表示用ラベル
const PM_LABEL = {
  qr_code: '📱 QRコード決済',
  credit_card: '💳 クレジットカード',
  cash: '💵 現金',
  bank_in: '🏦 銀行口座',
  transfer_to_cash: '🏧 ATM振替'
};

function padZ2(n) { return String(n).padStart(2, '0'); }
function fmt(n) { return '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); }
function showLoading() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }

async function fetchAll(table, sortField = 'created_at') {
  if (!currentUser) return [];
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id).order(sortField, { ascending: true });
  return data || [];
}

// 1. 収支区分の切り替え制御（表示・非表示の論理分岐）
function onTypeChange() {
  const type = document.querySelector('input[name="txType"]:checked').value;
  const catGroup = document.getElementById('categoryGroup');
  const payGroup = document.getElementById('paymentGroup');
  const incGroup = document.getElementById('incomeMethodGroup');
  const trnNotice = document.getElementById('transferNotice');
  const catSelect = document.getElementById('inputCategory');

  // 勘定科目の選択肢を収支区分に応じて動的にフィルタリング
  Array.from(catSelect.options).forEach(opt => {
    if (opt.value === "") return;
    const isIncomeCat = opt.parentNode.label.includes('収入');
    if (type === 'income') {
      opt.style.display = isIncomeCat ? 'block' : 'none';
    } else {
      opt.style.display = !isIncomeCat ? 'block' : 'none';
    }
  });

  // 区分切り替え時はカテゴリ選択をリセット
  catSelect.value = "";

  // フォームの表示状態の切り替え
  if (type === 'income') {
    catGroup.style.display = 'block';
    incGroup.style.display = 'block';
    payGroup.style.display = 'none';
    trnNotice.style.display = 'none';
  } else if (type === 'expense') {
    catGroup.style.display = 'block';
    incGroup.style.display = 'none';
    payGroup.style.display = 'block';
    trnNotice.style.display = 'none';
  } else if (type === 'transfer') {
    catGroup.style.display = 'none';
    incGroup.style.display = 'none';
    payGroup.style.display = 'none';
    trnNotice.style.display = 'block';
  }
  
  updateAfterPreview();
}

// 2. 残高計算とプレビューロジック
function calcCurrentBalance() {
  const today = new Date();
  const key = `${today.getFullYear()}-${padZ2(today.getMonth() + 1)}`;
  const setting = balanceSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance) : 0;

  const txs = allTransactions.filter(t => t.date && t.date.startsWith(key));
  txs.forEach(tx => {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt; else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else if (tx.payment_method === 'credit_card') { /* クレカは引かない */ }
      else bank -= amt; // QR決済は銀行から引く
    } else if (tx.type === 'transfer') {
      bank -= amt; cash += amt;
    }
  });
  return { bank, cash };
}

function updateQuickBalance() {
  const bal = calcCurrentBalance();
  document.getElementById('qbBank').textContent = fmt(bal.bank);
  document.getElementById('qbCash').textContent = fmt(bal.cash);
  document.getElementById('qbTotal').textContent = fmt(bal.bank + bal.cash);
}

function updateAfterPreview() {
  let bal = calcCurrentBalance();
  const type = document.querySelector('input[name="txType"]:checked')?.value;
  const amtStr = document.getElementById('inputAmount').value;
  const amt = parseInt(amtStr, 10) || 0;

  if (type === 'income') {
    const method = document.querySelector('input[name="incomeMethod"]:checked')?.value;
    if (method === 'cash') bal.cash += amt;
    else bal.bank += amt;
  } else if (type === 'expense') {
    const method = document.querySelector('input[name="payMethod"]:checked')?.value;
    if (method === 'cash') bal.cash -= amt;
    else if (method !== 'credit_card') bal.bank -= amt;
  } else if (type === 'transfer') {
    bal.bank -= amt; bal.cash += amt;
  }

  document.getElementById('previewBank').textContent = fmt(bal.bank);
  document.getElementById('previewCash').textContent = fmt(bal.cash);
}

// 3. ステップ遷移ロジック（入力→確認→完了）
function goToStep(step) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active', 'done'));
  document.querySelectorAll('.step-line').forEach(l => l.classList.remove('done'));

  if (step === 1) {
    document.getElementById('panelInput').classList.add('active');
    document.getElementById('step1Dot').classList.add('active');
  } else if (step === 2) {
    document.getElementById('panelConfirm').classList.add('active');
    document.getElementById('step1Dot').classList.add('done');
    document.getElementById('step2Dot').classList.add('active');
    document.querySelectorAll('.step-line')[0].classList.add('done');
  } else if (step === 3) {
    document.getElementById('panelDone').classList.add('active');
    document.getElementById('step1Dot').classList.add('done');
    document.getElementById('step2Dot').classList.add('done');
    document.getElementById('step3Dot').classList.add('active');
    document.querySelectorAll('.step-line').forEach(l => l.classList.add('done'));
  }
}

// 4. 確認画面へ進む処理
function handleGoToConfirm(e) {
  e.preventDefault();
  const date = document.getElementById('inputDate').value;
  const type = document.querySelector('input[name="txType"]:checked').value;
  let category = document.getElementById('inputCategory').value;
  let method = '';
  
  if (type === 'income') {
    method = document.querySelector('input[name="incomeMethod"]:checked').value;
  } else if (type === 'expense') {
    method = document.querySelector('input[name="payMethod"]:checked').value;
  } else if (type === 'transfer') {
    category = 'ATM振替';
    method = 'transfer_to_cash';
  }

  const amountStr = document.getElementById('inputAmount').value;
  const amount = parseInt(amountStr, 10);
  const memo = document.getElementById('inputMemo').value;

  // 実務的なバリデーション
  if (!date || !amountStr) { alert('日付と金額を入力してください。'); return; }
  if (isNaN(amount) || amount <= 0) { alert('金額は正の整数で入力してください。'); return; }
  if (type !== 'transfer' && !category) { alert('勘定科目を選択してください。'); return; }

  // データベース送信用の待機データ
  pendingData = { user_id: currentUser.id, date, type, amount, category, payment_method: method, memo };

  // 確認画面へのデータ受け渡し
  const badge = document.getElementById('confirmTypeBadge');
  const amtEl = document.getElementById('confirmAmount');
  
  if (type === 'income') {
    badge.className = 'confirm-type-badge income'; badge.innerHTML = '<i class="fas fa-arrow-down"></i> 収入';
    amtEl.className = 'confirm-amount income'; amtEl.textContent = '+' + fmt(amount);
  } else if (type === 'expense') {
    badge.className = 'confirm-type-badge expense'; badge.innerHTML = '<i class="fas fa-arrow-up"></i> 支出';
    amtEl.className = 'confirm-amount expense'; amtEl.textContent = '-' + fmt(amount);
  } else {
    badge.className = 'confirm-type-badge transfer'; badge.innerHTML = '<i class="fas fa-random"></i> ATM振替';
    amtEl.className = 'confirm-amount transfer'; amtEl.textContent = '±' + fmt(amount);
  }

  document.getElementById('confirmDate').textContent = date;
  document.getElementById('confirmCategory').textContent = category;
  document.getElementById('confirmPayment').textContent = PM_LABEL[method] || 'ATM';
  document.getElementById('confirmMemo').textContent = memo || 'なし';

  goToStep(2);
}

// 5. 確定保存処理
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

// --- システムの初期化とイベントバインディング ---
document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await requireAuth();
  if (!currentUser) return;

  showLoading();
  [allTransactions, balanceSettings] = await Promise.all([
    fetchAll('transactions', 'date'),
    fetchAll('balance_settings', 'month')
  ]);

  const t = new Date();
  document.getElementById('inputDate').value = `${t.getFullYear()}-${padZ2(t.getMonth()+1)}-${padZ2(t.getDate())}`;

  updateQuickBalance();
  onTypeChange(); 
  hideLoading();

  document.getElementById('inputForm').addEventListener('submit', handleGoToConfirm);
  document.getElementById('confirmSaveBtn').addEventListener('click', handleConfirmSave);
  document.getElementById('backToInputBtn').addEventListener('click', () => goToStep(1));
  
  document.getElementById('addMoreBtn').addEventListener('click', () => { 
    document.getElementById('inputForm').reset();
    document.getElementById('inputDate').value = `${t.getFullYear()}-${padZ2(t.getMonth()+1)}-${padZ2(t.getDate())}`;
    onTypeChange(); 
    goToStep(1); 
  });

  // ラジオボタン変更の検知
  document.querySelectorAll('input[name="txType"]').forEach(r => r.addEventListener('change', onTypeChange));
  document.querySelectorAll('input[name="payMethod"], input[name="incomeMethod"]').forEach(r => r.addEventListener('change', updateAfterPreview));
  document.getElementById('inputAmount').addEventListener('input', updateAfterPreview);
});