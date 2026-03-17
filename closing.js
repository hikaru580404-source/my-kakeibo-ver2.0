/* =============================================
   closing.js — 月末棚卸しロジック (Supabase完全対応版)
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

const CL_TABLE  = 'monthly_closings';
const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';

let currentUser = null;

function padZ2(n) { return String(n).padStart(2, '0'); }
function fmtCl(n) { return '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); }
function fmtDiff(n) {
  if (n === 0) return '±¥0';
  return (n > 0 ? '+¥' : '▲¥') + Math.abs(Math.round(n)).toLocaleString('ja-JP');
}

async function fetchAllCl(table) {
  if (!currentUser) return [];
  const { data } = await supabase.from(table).select('*').eq('user_id', currentUser.id);
  return data || [];
}

function setMsgCl(id, msg, type = '') {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = 'form-message ' + type; }
}
function showLoadingCl()  { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoadingCl()  { document.getElementById('loadingOverlay')?.classList.add('hidden'); }
function showToastCl(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// 帳簿残高の計算（クレジットカードは引かない）
async function calcBookBalance(year, month) {
  const key = `${year}-${padZ2(month)}`;
  const balSettings = await fetchAllCl(BAL_TABLE);
  const setting = balSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance) : 0;

  const txAll = await fetchAllCl(TX_TABLE);
  const txs = txAll.filter(t => t.date && t.date.startsWith(key));

  for (const tx of txs) {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt;
      else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else if (tx.payment_method === 'credit_card') { /* クレカはスルー */ }
      else bank -= amt;
    } else if (tx.type === 'transfer') {
      bank -= amt; cash += amt;
    }
  }
  return { bank, cash };
}

async function checkClosingBanner() {
  const today = new Date();
  const day   = today.getDate();
  if (day !== 1) return; // 1日のみ表示

  let prevYear  = today.getFullYear();
  let prevMonth = today.getMonth();
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }
  const prevKey = `${prevYear}-${padZ2(prevMonth)}`;

  const closings = await fetchAllCl(CL_TABLE);
  const existing = closings.find(c => c.month === prevKey);
  if (existing && existing.is_closed) return;

  const banner = document.getElementById('closingBanner');
  const sub    = document.getElementById('closingBannerSub');
  if (banner) {
    banner.style.display = 'flex';
    if (sub) sub.textContent = `${prevYear}年${prevMonth}月の棚卸しが未完了です`;
  }

  document.getElementById('openClosingBtn')?.addEventListener('click', () => {
    openClosingModal(prevYear, prevMonth);
  });
}

async function openClosingModal(year, month) {
  const key = `${year}-${padZ2(month)}`;
  const subEl = document.getElementById('closingModalSub');
  if (subEl) subEl.textContent = `${year}年${month}月の実際の残高を入力してください`;

  showLoadingCl();
  try {
    const { bank, cash } = await calcBookBalance(year, month);
    document.getElementById('closingCalcBank').textContent = fmtCl(bank);
    document.getElementById('closingCalcCash').textContent = fmtCl(cash);

    const closings = await fetchAllCl(CL_TABLE);
    const existing = closings.find(c => c.month === key);
    if (existing) {
      document.getElementById('closingActualBank').value = existing.bank_actual ?? '';
      document.getElementById('closingActualCash').value = existing.cash_actual ?? '';
      document.getElementById('closingMemo').value       = existing.note ?? '';
      updateDiffPreview(bank, cash);
    }

    const modal = document.getElementById('closingModal');
    modal.dataset.year  = year;
    modal.dataset.month = month;
    modal.dataset.calcBank = bank;
    modal.dataset.calcCash = cash;
    modal.style.display = 'flex';
    setMsgCl('closingMessage', '');
  } catch(err) {
    showToastCl('データ取得に失敗しました');
    console.error(err);
  } finally {
    hideLoadingCl();
  }
}

function updateDiffPreview(calcBank, calcCash) {
  const actualBankVal = document.getElementById('closingActualBank').value;
  const actualCashVal = document.getElementById('closingActualCash').value;
  if (actualBankVal === '' && actualCashVal === '') {
    document.getElementById('closingDiffPreview').style.display = 'none';
    return;
  }
  document.getElementById('closingDiffPreview').style.display = 'block';

  const actualBank = Number(actualBankVal) || 0;
  const actualCash = Number(actualCashVal) || 0;
  const diffBank   = actualBank - calcBank;
  const diffCash   = actualCash - calcCash;

  const diffBankEl = document.getElementById('diffBank');
  const diffCashEl = document.getElementById('diffCash');

  diffBankEl.textContent = fmtDiff(diffBank);
  diffCashEl.textContent = fmtDiff(diffCash);

  const classFor = (v) => v === 0 ? 'closing-diff-val ok' :
                          Math.abs(v) < 1000 ? 'closing-diff-val warning' :
                          'closing-diff-val danger';
  diffBankEl.className = classFor(diffBank);
  diffCashEl.className = classFor(diffCash);
}

async function handleClosingSubmit(e) {
  e.preventDefault();

  const modal      = document.getElementById('closingModal');
  const year       = Number(modal.dataset.year);
  const month      = Number(modal.dataset.month);
  const calcBank   = Number(modal.dataset.calcBank);
  const calcCash   = Number(modal.dataset.calcCash);
  const key        = `${year}-${padZ2(month)}`;

  const actualBank = Number(document.getElementById('closingActualBank').value);
  const actualCash = Number(document.getElementById('closingActualCash').value);
  const memo       = document.getElementById('closingMemo').value.trim();

  if (isNaN(actualBank) || actualBank < 0) return setMsgCl('closingMessage', '銀行残高を正しく入力してください', 'error');
  if (isNaN(actualCash) || actualCash < 0) return setMsgCl('closingMessage', '現金残高を正しく入力してください', 'error');

  const payload = {
    user_id: currentUser.id,
    month: key,
    bank_actual:  actualBank,
    cash_actual:  actualCash,
    bank_system:  calcBank,
    cash_system:  calcCash,
    bank_diff:    actualBank - calcBank,
    cash_diff:    actualCash - calcCash,
    note: memo,
    is_closed: true,
  };

  showLoadingCl();
  try {
    const closings = await fetchAllCl(CL_TABLE);
    const existing = closings.find(c => c.month === key);
    if (existing) {
      await supabase.from(CL_TABLE).update(payload).eq('id', existing.id);
    } else {
      await supabase.from(CL_TABLE).insert([payload]);
    }

    document.getElementById('closingBanner').style.display = 'none';
    modal.style.display = 'none';
    showToastCl(`✅ ${year}年${month}月の棚卸しを確定しました`);
    document.getElementById('closingForm').reset();
    document.getElementById('closingDiffPreview').style.display = 'none';
  } catch(err) {
    setMsgCl('closingMessage', '保存に失敗しました', 'error');
    console.error(err);
  } finally {
    hideLoadingCl();
  }
}

function bindClosingEvents() {
  document.getElementById('closingForm')?.addEventListener('submit', handleClosingSubmit);
  document.getElementById('closingCancelBtn')?.addEventListener('click', () => { document.getElementById('closingModal').style.display = 'none'; });
  document.getElementById('closingModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('closingModal').style.display = 'none'; });
  ['closingActualBank', 'closingActualCash'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const modal    = document.getElementById('closingModal');
      const calcBank = Number(modal.dataset.calcBank) || 0;
      const calcCash = Number(modal.dataset.calcCash) || 0;
      updateDiffPreview(calcBank, calcCash);
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  currentUser = await requireAuth();
  if (!currentUser) return;
  bindClosingEvents();
  await checkClosingBanner();
});