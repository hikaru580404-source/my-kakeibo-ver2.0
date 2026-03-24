/* =============================================
   closing.js — 月末棚卸しロジック
   AsirLabo OS 統合版:
     - 新Supabase (qzxajtlisscwxwidicfh) 接続
     - requireAuth() → getSession() ベース
     - JST 基準の日付チェック
     - Phase 5: 棚卸し確定時に universal_logs へ
       finance_summary を自動書き込み
   ============================================= */
'use strict';
import { supabase, requireAuth } from './supabase-client.js';

const CL_TABLE  = 'monthly_closings';
const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';
// Phase 5: クロス分析用テーブル
const UL_TABLE  = 'universal_logs';

let currentUser = null;

function padZ2(n)  { return String(n).padStart(2, '0'); }
function fmtCl(n)  { return '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP'); }
function fmtDiff(n) {
  if (n === 0) return '±¥0';
  return (n > 0 ? '+¥' : '▲¥') + Math.abs(Math.round(n)).toLocaleString('ja-JP');
}

async function fetchAllCl(table) {
  if (!currentUser) return [];
  const { data, error } = await supabase.from(table).select('*').eq('user_id', currentUser.id);
  if (error) { console.error(`[closing fetchAll] ${table}:`, error.message); return []; }
  return data || [];
}

function setMsgCl(id, msg, type = '') {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = 'form-message ' + type; }
}
function showLoadingCl() { document.getElementById('loadingOverlay')?.classList.remove('hidden'); }
function hideLoadingCl() { document.getElementById('loadingOverlay')?.classList.add('hidden'); }
function showToastCl(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ── 帳簿残高の計算 ──
async function calcBookBalance(year, month) {
  const key        = `${year}-${padZ2(month)}`;
  const balSettings = await fetchAllCl(BAL_TABLE);
  const setting    = balSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance) : 0;

  const txAll = await fetchAllCl(TX_TABLE);
  txAll.filter(t => t.date && t.date.startsWith(key)).forEach(tx => {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt; else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else if (tx.payment_method === 'credit_card') { /* クレカはスルー */ }
      else bank -= amt;
    } else if (tx.type === 'transfer') { bank -= amt; cash += amt; }
  });
  return { bank, cash };
}

// ── Phase 5: universal_logs へ finance_summary を書き込む ──
async function syncToUniversalLogs(year, month, payload) {
  try {
    const loggedAt = `${year}-${padZ2(month)}-01T00:00:00+09:00`;
    // 既存レコードを確認
    const { data: existing } = await supabase
      .from(UL_TABLE)
      .select('id')
      .eq('user_id', currentUser.id)
      .eq('project_id', 'indep')
      .eq('log_type', 'finance_summary')
      .gte('logged_at', `${year}-${padZ2(month)}-01`)
      .lt('logged_at', month < 12
          ? `${year}-${padZ2(month + 1)}-01`
          : `${year + 1}-01-01`)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from(UL_TABLE).update({ payload }).eq('id', existing.id);
    } else {
      await supabase.from(UL_TABLE).insert([{
        user_id:    currentUser.id,
        project_id: 'indep',
        log_type:   'finance_summary',
        logged_at:  loggedAt,
        payload
      }]);
    }
    console.log('[Phase5] finance_summary synced to universal_logs');
  } catch (e) {
    // universal_logs への書き込み失敗は棚卸し本体に影響させない（サイレント）
    console.warn('[Phase5] universal_logs sync failed (non-fatal):', e);
  }
}

// ── 棚卸しバナー表示チェック（JST基準） ──
async function checkClosingBanner() {
  // JST の今日
  const jstNow  = new Date(new Date().getTime() + 9 * 60 * 60 * 1000);
  const day     = jstNow.getUTCDate();
  if (day !== 1) return; // 毎月1日のみ

  let prevYear  = jstNow.getUTCFullYear();
  let prevMonth = jstNow.getUTCMonth(); // getUTCMonth() は 0-based なので先月 = そのまま
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

// ── 棚卸しモーダルを開く ──
async function openClosingModal(year, month) {
  const key   = `${year}-${padZ2(month)}`;
  const subEl = document.getElementById('closingModalSub');
  if (subEl) subEl.textContent = `${year}年${month}月の実際の残高を入力してください`;

  showLoadingCl();
  try {
    const { bank, cash } = await calcBookBalance(year, month);
    const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    safeSet('closingCalcBank', fmtCl(bank));
    safeSet('closingCalcCash', fmtCl(cash));

    const closings = await fetchAllCl(CL_TABLE);
    const existing = closings.find(c => c.month === key);
    if (existing) {
      const safeVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
      safeVal('closingActualBank', existing.bank_actual);
      safeVal('closingActualCash', existing.cash_actual);
      safeVal('closingMemo',       existing.note);
      updateDiffPreview(bank, cash);
    }

    const modal = document.getElementById('closingModal');
    modal.dataset.year     = year;
    modal.dataset.month    = month;
    modal.dataset.calcBank = bank;
    modal.dataset.calcCash = cash;
    modal.style.display    = 'flex';
    setMsgCl('closingMessage', '');
  } catch (err) {
    showToastCl('データ取得に失敗しました');
    console.error('[closing openModal]:', err);
  } finally {
    hideLoadingCl();
  }
}

// ── 差異プレビュー更新 ──
function updateDiffPreview(calcBank, calcCash) {
  const bankVal = document.getElementById('closingActualBank')?.value;
  const cashVal = document.getElementById('closingActualCash')?.value;
  const preview = document.getElementById('closingDiffPreview');
  if (!preview) return;

  if (bankVal === '' && cashVal === '') { preview.style.display = 'none'; return; }
  preview.style.display = 'block';

  const actualBank = Number(bankVal) || 0;
  const actualCash = Number(cashVal) || 0;
  const diffBank   = actualBank - calcBank;
  const diffCash   = actualCash - calcCash;

  const classFor = v => v === 0
    ? 'closing-diff-val ok'
    : Math.abs(v) < 1000 ? 'closing-diff-val warning' : 'closing-diff-val danger';

  const dbEl = document.getElementById('diffBank');
  const dcEl = document.getElementById('diffCash');
  if (dbEl) { dbEl.textContent = fmtDiff(diffBank); dbEl.className = classFor(diffBank); }
  if (dcEl) { dcEl.textContent = fmtDiff(diffCash); dcEl.className = classFor(diffCash); }
}

// ── 棚卸し確定 ──
async function handleClosingSubmit(e) {
  e.preventDefault();
  const modal     = document.getElementById('closingModal');
  const year      = Number(modal.dataset.year);
  const month     = Number(modal.dataset.month);
  const calcBank  = Number(modal.dataset.calcBank);
  const calcCash  = Number(modal.dataset.calcCash);
  const key       = `${year}-${padZ2(month)}`;

  const actualBank = Number(document.getElementById('closingActualBank').value);
  const actualCash = Number(document.getElementById('closingActualCash').value);
  const memo       = document.getElementById('closingMemo').value.trim();

  if (isNaN(actualBank) || actualBank < 0) return setMsgCl('closingMessage', '銀行残高を正しく入力してください', 'error');
  if (isNaN(actualCash) || actualCash < 0) return setMsgCl('closingMessage', '現金残高を正しく入力してください', 'error');

  // 月の収支集計
  const txAll    = await fetchAllCl(TX_TABLE);
  const monthTxs = txAll.filter(t => t.date && t.date.startsWith(key));
  const incomeTotal  = monthTxs.filter(t => t.type === 'income') .reduce((s, t) => s + Number(t.amount), 0);
  const expenseTotal = monthTxs.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  const payload = {
    user_id:     currentUser.id,
    month:       key,
    bank_actual: actualBank,
    cash_actual: actualCash,
    bank_system: calcBank,
    cash_system: calcCash,
    bank_diff:   actualBank - calcBank,
    cash_diff:   actualCash - calcCash,
    note:        memo,
    is_closed:   true,
  };

  showLoadingCl();
  try {
    const closings = await fetchAllCl(CL_TABLE);
    const existing = closings.find(c => c.month === key);
    if (existing) await supabase.from(CL_TABLE).update(payload).eq('id', existing.id);
    else          await supabase.from(CL_TABLE).insert([payload]);

    // ── Phase 5: universal_logs へ finance_summary を自動連携 ──
    await syncToUniversalLogs(year, month, {
      project_id:    'indep',
      measured_month: key,
      income_total:  incomeTotal,
      expense_total: expenseTotal,
      net_balance:   incomeTotal - expenseTotal,
      bank_actual:   actualBank,
      cash_actual:   actualCash,
      bank_diff:     actualBank - calcBank,
      cash_diff:     actualCash - calcCash,
      is_closed:     true
    });

    document.getElementById('closingBanner').style.display = 'none';
    modal.style.display = 'none';
    showToastCl(`✅ ${year}年${month}月の棚卸しを確定しました`);
    document.getElementById('closingForm')?.reset();
    document.getElementById('closingDiffPreview')?.style && (document.getElementById('closingDiffPreview').style.display = 'none');
  } catch (err) {
    setMsgCl('closingMessage', '保存に失敗しました', 'error');
    console.error('[closing submit]:', err);
  } finally {
    hideLoadingCl();
  }
}

// ── イベントバインド ──
function bindClosingEvents() {
  document.getElementById('closingForm')?.addEventListener('submit', handleClosingSubmit);
  document.getElementById('closingCancelBtn')?.addEventListener('click', () => {
    document.getElementById('closingModal').style.display = 'none';
  });
  document.getElementById('closingModal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('closingModal').style.display = 'none';
  });
  ['closingActualBank','closingActualCash'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      const modal    = document.getElementById('closingModal');
      const calcBank = Number(modal?.dataset.calcBank) || 0;
      const calcCash = Number(modal?.dataset.calcCash) || 0;
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
