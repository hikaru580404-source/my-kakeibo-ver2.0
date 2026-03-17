# 【完全版】マイ家計簿 → Supabase + Vercel 移行プロンプト

---

> **使い方**：このファイルの内容を **全文コピー** して Gemini 2.0 Pro の新規チャットに貼り付け、送信してください。

---

## ▼ あなたへの依頼

私はJavaScript初〜中級者の経営者です。
以下に説明する「マイ家計簿」Webアプリを、**Supabase + Vercel 構成にフルリプレイス**するサポートをお願いします。

**進め方のルール：**
- 作業は必ず「1ステップずつ」進めてください
- 各ステップの完了確認を私に求めてから次へ進んでください
- コードは「どこに、何を、なぜ書くか」をセットで説明してください
- エラーが出たら画面キャプチャを共有するので、一緒に解決してください
- 専門用語は都度わかりやすく説明してください

まず最初に **STEP 1から始めてください**。

---

## ▼ 現在のアプリ概要

### アプリ名
**マイ家計簿**

### 目的
個人・法人兼用の家計簿アプリ。現在は GenSpark のプラットフォーム上で動作しているが、**複数ユーザーが各自の独立したデータを持てるよう Supabase + Vercel に移行する**。

### 現在の技術スタック
- **フロントエンド**: 純粋な HTML / CSS / JavaScript（フレームワークなし）
- **バックエンド**: GenSpark の独自 RESTful API（`tables/{tableName}` 形式）
- **ホスティング**: GenSpark

### 移行後の目標スタック
- **フロントエンド**: 現在の HTML / CSS / JS をそのまま流用
- **バックエンド**: Supabase（認証 + PostgreSQL + Row Level Security）
- **ホスティング**: Vercel

---

## ▼ ページ構成（全4ページ）

| ファイル | 役割 |
|---|---|
| `index.html` | ダッシュボード（メイン画面）|
| `form.html` | 収支入力（3ステップウィザード）|
| `budget.html` | 予算管理 |
| `summary.html` | 月次サマリー・分析 |

---

## ▼ JSファイル構成

| ファイル | 役割 |
|---|---|
| `js/app.js` | ダッシュボードのメインロジック（約1140行）|
| `js/form.js` | 収支入力フォームのロジック（約580行）|
| `js/budget.js` | 予算管理ロジック（約400行）|
| `js/summary.js` | 月次サマリーロジック（約560行）|
| `js/closing.js` | 月末棚卸しロジック（約320行）|

**重要**: `index.html` には `js/app.js` と `js/closing.js` の **両方** が読み込まれています。
`closing.js` は名前衝突を避けるため `apiFetchCl` / `fetchAllCl` という独自関数名を使用しています。

---

## ▼ 現在のデータモデル（全4テーブル）

### テーブル1: `transactions`（収支明細）
```
id            : UUID / 主キー（自動生成）
date          : text  / YYYY-MM-DD
type          : text  / "income" | "expense" | "transfer"
category      : text  / 勘定科目名
amount        : number / 金額（正の整数）
payment_method: text  / "rakuten"|"paypay"|"mercari"|"cash"|"bank_in"|"transfer_to_cash"
memo          : text  / 任意メモ
created_at    : datetime（自動）
```

### テーブル2: `balance_settings`（月初残高繰越）
```
id           : UUID / 主キー
month        : text   / YYYY-MM
bank_balance : number / 月初銀行口座残高
cash_balance : number / 月初現金残高
created_at   : datetime（自動）
```

### テーブル3: `budgets`（予算）
```
id        : UUID / 主キー
month     : text   / YYYY-MM
box       : text   / "A" | "B" | "C"
category  : text   / 勘定科目名
amount    : number / 予算金額
note      : text   / 任意メモ
created_at: datetime（自動）
```

### テーブル4: `monthly_closings`（月末棚卸し）
```
id          : UUID / 主キー
month       : text    / YYYY-MM
bank_system : number  / システム計算銀行残高
cash_system : number  / システム計算現金残高
bank_actual : number  / 実際の銀行残高
cash_actual : number  / 実際の現金残高
bank_diff   : number  / 銀行差異（actual - system）
cash_diff   : number  / 現金差異（actual - system）
note        : text    / 棚卸しメモ
is_closed   : boolean / 締め確定フラグ
created_at  : datetime（自動）
```

---

## ▼ 勘定科目・ボックス分類

```javascript
// A箱（事業経費）
'通信費（A箱）', '消耗品費（A箱）', '旅費交通費（A箱）',
'支払手数料（A箱）', '接待交際費（A箱）', '新聞図書費（A箱）'

// B箱（個人消費）
'個人サブスク・通信費（B箱）', '飲食費（ランチ・カフェ）（B箱）',
'美容・被服費（B箱）', '趣味・娯楽費（B箱）', '個人交際費・予備費（B箱）'

// C箱（固定費）
'家族生活費（C箱）', '租税公課（C箱）', '法定福利費（C箱）'

// 収入科目
'給与・役員報酬', '事業売上', 'その他収入'
```

---

## ▼ 現在のAPI呼び出しパターン（移行の核心部分）

### app.js / budget.js / summary.js 共通パターン

```javascript
// ─── apiFetch ───────────────────────────────────
async function apiFetch(path, opts={}) {
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal,
      ...opts
    });
    if (res.status === 401) {
      showToast('⚠ セッション切れ。再読み込みします…', 3000);
      setTimeout(() => location.reload(), 2500);
      throw new Error('401');
    }
    if (res.status === 204 || (res.status === 200 && opts.method === 'DELETE')) return null;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  } finally {
    clearTimeout(timer);
  }
}

// ─── fetchAll ───────────────────────────────────
async function fetchAll(table, sortField='created_at') {
  let page=1, all=[];
  while(true) {
    const d = await apiFetch(`tables/${table}?page=${page}&limit=200&sort=${sortField}`);
    if (!d || !Array.isArray(d.data)) break;
    all = all.concat(d.data);
    if (all.length >= (d.total || 0)) break;
    page++;
  }
  return all;
}
```

### closing.js のみ独自名（app.js と同一ページで衝突回避）

```javascript
// closing.js は apiFetchCl / fetchAllCl という名前を使用（ロジックは同じ）
async function apiFetchCl(path, opts={}) { /* 上と同じ内容 */ }
async function fetchAllCl(table, sort='created_at') { /* 上と同じ内容 */ }
```

### CRUD操作パターン

```javascript
// 一覧取得
const txs = await fetchAll('transactions', 'date');

// 作成
await apiFetch('tables/transactions', {
  method: 'POST',
  body: { date, type, category, amount, payment_method, memo }
});

// 更新
await apiFetch(`tables/transactions/${id}`, {
  method: 'PUT',
  body: { date, type, category, amount, payment_method, memo }
});

// 削除
await apiFetch(`tables/transactions/${id}`, { method: 'DELETE' });
```

---

## ▼ 残高計算ロジック（変更不要）

**重要**: 残高はDBに保存されていません。フロントエンドで毎回計算します。

```javascript
// balance_settings（月初繰越）＋ 当月の全 transactions を積算する
function calcMonthBalances(year, month) {
  const key  = `${year}-${String(month).padStart(2,'0')}`;
  const setting = balanceSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance)  : 0;

  const txs = allTransactions
    .filter(t => t.date && t.date.startsWith(key))
    .sort((a,b) => a.date.localeCompare(b.date));

  txs.forEach(tx => {
    const amt = Number(tx.amount);
    if (tx.type === 'income') {
      if (tx.payment_method === 'cash') cash += amt;
      else bank += amt;
    } else if (tx.type === 'expense') {
      if (tx.payment_method === 'cash') cash -= amt;
      else bank -= amt;
    } else if (tx.type === 'transfer') {
      bank -= amt; cash += amt;  // ATM出金：銀行→現金
    }
  });
  return { bank, cash };
}
```

---

## ▼ 月末着地予測ロジック（固定費分離モデル）

```javascript
// 固定費カテゴリ（予算設定がある場合のみ残り固定費として計上）
const FIXED_CATEGORIES = new Set([
  '通信費（A箱）', '支払手数料（A箱）',
  '個人サブスク・通信費（B箱）',
  '家族生活費（C箱）', '租税公課（C箱）', '法定福利費（C箱）',
]);

// 予測 = 現在残高 − 残り固定費（予算−支払済み） − 変動費予測（加重移動平均×残り日数）
// 加重移動平均: 今月70% + 先月20% + 先々月10%
```

---

## ▼ 移行後に必要な機能

### 認証
- メールアドレス + パスワードでのサインアップ / ログイン
- ログイン状態でないと各ページにアクセスできない（未ログインは `login.html` にリダイレクト）
- ログアウトボタン（各ページのヘッダーに追加）

### データ分離
- 各テーブルに `user_id uuid` カラムを追加
- Row Level Security（RLS）で自分のデータだけ読み書きできる
- 他のユーザーのデータは一切見えない

### 新規追加ページ
- `login.html`（ログイン + 新規登録画面）

---

## ▼ 移行作業のステップ計画

```
STEP 1: Supabase プロジェクト作成・テーブルSQLを実行・RLS設定
STEP 2: GitHub リポジトリ作成・現在のファイルをアップロード
STEP 3: login.html を新規作成（Supabase Auth フォーム）
STEP 4: supabase-client.js を作成（共通初期化・認証チェック）
STEP 5: app.js の apiFetch + fetchAll を Supabase クライアントに置き換え
STEP 6: form.js の置き換え
STEP 7: budget.js の置き換え
STEP 8: summary.js の置き換え
STEP 9: closing.js の置き換え（apiFetchCl / fetchAllCl も同様）
STEP 10: Vercel にデプロイ・動作確認・知人へ招待
```

---

## ▼ 設計上の重要ポイント

1. **残高計算はフロントエンドのみ** — DBに残高カラムは不要。
2. **closing.js は app.js と同じ index.html に読み込まれる** — 関数名衝突に注意。Supabase移行後も `apiFetchCl` 等の命名を維持するか、共通モジュール化するかを相談したい。
3. **iOS Safari 対応が必要** — `credentials: 'include'` の代わりに Supabase の Cookie ベース認証を使う。
4. **chart.js を使用** — CDNから読み込み済み（変更不要）。
5. **コスト目標: 無料** — Supabase Free Tier + Vercel Hobby プランで運用する。

---

## ▼ 現在のJSファイル全文

以下は移行の参考として提供する現在の全JavaScriptコードです。

---

### 【js/app.js 全文】（ダッシュボード＋入力フォーム共通ロジック）

```javascript
/* =============================================
   app.js  — マイ家計簿  メインロジック v2
   ============================================= */
'use strict';

const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';

const PM_ACCOUNT = {
  rakuten:'bank', paypay:'bank', mercari:'bank',
  cash:'cash', bank_in:'bank', transfer_to_cash:'transfer',
};
const PM_LABEL = {
  rakuten:'楽天ペイ', paypay:'PayPay', mercari:'メルカリ',
  cash:'現金', bank_in:'銀行口座', transfer_to_cash:'ATM振替',
};
const CATEGORY_BOX = {
  '通信費（A箱）':'A','消耗品費（A箱）':'A','旅費交通費（A箱）':'A',
  '支払手数料（A箱）':'A','接待交際費（A箱）':'A','新聞図書費（A箱）':'A',
  '個人サブスク・通信費（B箱）':'B','飲食費（ランチ・カフェ）（B箱）':'B',
  '美容・被服費（B箱）':'B','趣味・娯楽費（B箱）':'B','個人交際費・予備費（B箱）':'B',
  '家族生活費（C箱）':'C','租税公課（C箱）':'C','法定福利費（C箱）':'C',
};
const PIE_COLORS = [
  '#6366f1','#10b981','#f59e0b','#ef4444','#3b82f6',
  '#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899',
  '#14b8a6','#a78bfa','#fb923c','#34d399','#fbbf24','#60a5fa',
];
const PM_COLORS = {
  rakuten:'#bf0000', paypay:'#ff0033', mercari:'#ff6600',
  cash:'#059669', bank_in:'#1d4ed8', transfer_to_cash:'#1d4ed8',
};

let allTransactions  = [];
let balanceSettings  = [];
let allBudgets       = [];
const BOX_CATEGORIES = {
  A: ['通信費（A箱）','消耗品費（A箱）','旅費交通費（A箱）','支払手数料（A箱）','接待交際費（A箱）','新聞図書費（A箱）'],
  B: ['個人サブスク・通信費（B箱）','飲食費（ランチ・カフェ）（B箱）','美容・被服費（B箱）','趣味・娯楽費（B箱）','個人交際費・予備費（B箱）'],
  C: ['家族生活費（C箱）','租税公課（C箱）','法定福利費（C箱）'],
};
const BOX_NAMES = { A:'A箱 事業経費', B:'B箱 個人消費', C:'C箱 固定費' };
let currentYear  = new Date().getFullYear();
let currentMonth = new Date().getMonth() + 1;
let editingId    = null;
let deleteTargetId = null;
let barChartInst   = null;
let pieChartInst   = null;

const fmt  = (n) => '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
const fmtS = (n) => (n >= 0 ? '+' : '−') + fmt(n);
function padZ(n)       { return String(n).padStart(2,'0'); }
function monthKey(y,m) { return `${y}-${padZ(m)}`; }
function showLoading() { document.getElementById('loadingOverlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loadingOverlay').classList.add('hidden'); }
function showToast(msg, ms=2200) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}
function setMsg(id, msg, type='') {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.className = 'form-message ' + type; }
}

async function apiFetch(path, opts={}) {
  if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal: controller.signal, ...opts
    });
    if (res.status === 401) {
      showToast('⚠ セッション切れ。再読み込みします…', 3000);
      setTimeout(() => location.reload(), 2500);
      throw new Error('401');
    }
    if (res.status === 204 || (res.status === 200 && opts.method === 'DELETE')) return null;
    if (!res.ok) { const txt = await res.text().catch(()=>''); throw new Error(`HTTP ${res.status}: ${txt}`); }
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
  } finally { clearTimeout(timer); }
}
async function fetchAll(table, sortField='created_at') {
  let page=1, all=[];
  while(true) {
    const d = await apiFetch(`tables/${table}?page=${page}&limit=200&sort=${sortField}`);
    if (!d || !Array.isArray(d.data)) break;
    all = all.concat(d.data);
    if (all.length >= (d.total || 0)) break;
    page++;
  }
  return all;
}

function getBalanceSetting(year, month) {
  return balanceSettings.find(s => s.month === monthKey(year, month)) || null;
}
function calcMonthBalances(year, month) {
  const setting = getBalanceSetting(year, month);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance)  : 0;
  const key  = monthKey(year, month);
  const txs  = allTransactions.filter(t => t.date && t.date.startsWith(key))
    .sort((a,b) => a.date.localeCompare(b.date));
  const rows = txs.map(tx => {
    const amt = Number(tx.amount);
    if (tx.type === 'income') { if (tx.payment_method==='cash') cash+=amt; else bank+=amt; }
    else if (tx.type === 'expense') { if (tx.payment_method==='cash') cash-=amt; else bank-=amt; }
    else if (tx.type === 'transfer') { bank-=amt; cash+=amt; }
    return { ...tx, bankSnap: bank, cashSnap: cash };
  });
  return { bankBalance: bank, cashBalance: cash, rows };
}

function updateMonthLabel() {
  document.getElementById('currentMonthLabel').textContent = `${currentYear}年${padZ(currentMonth)}月`;
}
function renderKPI(year, month) {
  const key  = monthKey(year, month);
  const txs  = allTransactions.filter(t => t.date && t.date.startsWith(key));
  const income  = txs.filter(t=>t.type==='income').reduce((s,t)=>s+Number(t.amount),0);
  const expense = txs.filter(t=>t.type==='expense').reduce((s,t)=>s+Number(t.amount),0);
  const { bankBalance, cashBalance } = calcMonthBalances(year, month);
  const total = bankBalance + cashBalance;
  document.getElementById('kpiIncome').textContent  = fmt(income);
  document.getElementById('kpiExpense').textContent = fmt(expense);
  document.getElementById('kpiBalance').textContent = fmt(total);
  document.getElementById('bankBalance').textContent  = fmt(bankBalance);
  document.getElementById('cashBalance').textContent  = fmt(cashBalance);
  document.getElementById('totalBalance').textContent = fmt(total);
  renderForecastKPI(year, month, expense, total);
}

// 固定費分離モデルの固定費カテゴリ
const FIXED_CATEGORIES = new Set([
  '通信費（A箱）','支払手数料（A箱）','個人サブスク・通信費（B箱）',
  '家族生活費（C箱）','租税公課（C箱）','法定福利費（C箱）',
]);

function calcForecastV2(year, month) {
  const today       = new Date();
  const key         = monthKey(year, month);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOfMonth  = today.getDate();
  const remainDays  = daysInMonth - dayOfMonth;

  const txsThisMonth = allTransactions.filter(t => t.date && t.date.startsWith(key) && t.type==='expense');
  const paidFixed = {};
  txsThisMonth.forEach(t => {
    if (FIXED_CATEGORIES.has(t.category)) paidFixed[t.category] = (paidFixed[t.category]||0) + Number(t.amount);
  });

  const budgets = Array.isArray(allBudgets) ? allBudgets : [];
  let remainingFixed = 0;
  const fixedBreakdown = [];
  FIXED_CATEGORIES.forEach(cat => {
    const budRow = budgets.find(b => b.month===key && b.category===cat);
    if (!budRow) return;
    const budAmt = Number(budRow.amount)||0;
    const paid   = paidFixed[cat]||0;
    const remain = Math.max(budAmt - paid, 0);
    if (budAmt > 0) {
      remainingFixed += remain;
      fixedBreakdown.push({ cat: cat.replace(/（[ABC]箱）$/,''), budget:budAmt, paid, remain });
    }
  });

  function getVarExpense(y,m) {
    const k = monthKey(y,m);
    const dim = new Date(y,m,0).getDate();
    const total = allTransactions.filter(t=>t.date&&t.date.startsWith(k)&&t.type==='expense'&&!FIXED_CATEGORIES.has(t.category)).reduce((s,t)=>s+Number(t.amount),0);
    return { total, days: dim };
  }
  let lm=month-1, ly=year; if(lm<1){lm=12;ly--;}
  let llm=month-2, lly=year; if(llm<1){llm+=12;lly--;}
  const last   = getVarExpense(ly,lm);
  const llast  = getVarExpense(lly,llm);
  const varThisMonth = txsThisMonth.filter(t=>!FIXED_CATEGORIES.has(t.category)).reduce((s,t)=>s+Number(t.amount),0);
  const avgThis  = dayOfMonth>0 ? varThisMonth/dayOfMonth : 0;
  const avgLast  = last.days>0  ? last.total/last.days    : avgThis;
  const avgLLast = llast.days>0 ? llast.total/llast.days  : avgThis;
  const hasLast  = last.total>0;
  const hasLLast = llast.total>0;
  let weightedAvg;
  if (hasLast && hasLLast) weightedAvg = avgThis*0.70 + avgLast*0.20 + avgLLast*0.10;
  else if (hasLast)        weightedAvg = avgThis*0.75 + avgLast*0.25;
  else                     weightedAvg = avgThis;
  const varForecast = weightedAvg * remainDays;
  const { bankBalance, cashBalance } = calcMonthBalances(year, month);
  const currentTotal = bankBalance + cashBalance;
  const predicted    = currentTotal - remainingFixed - varForecast;
  let confidence = hasLast && hasLLast ? '高' : hasLast ? '中' : '低（今月データのみ）';
  return { predicted, currentTotal, remainingFixed, varForecast, weightedAvg, remainDays, dayOfMonth, daysInMonth, fixedBreakdown, confidence, hasLast, hasLLast };
}

function renderForecastKPI(year, month, totalExpense, currentTotal) {
  const today  = new Date();
  const isSame = today.getFullYear()===year && today.getMonth()+1===month;
  const kpiEl       = document.getElementById('kpiForecast');
  const bannerAmtEl = document.getElementById('forecastBannerAmount');
  const bannerSubEl = document.getElementById('forecastBannerSub');
  const detailEl    = document.getElementById('forecastDetail');
  const fillEl      = document.getElementById('forecastBarFill');
  const midEl       = document.getElementById('forecastBarMid');
  const maxEl       = document.getElementById('forecastBarMax');
  const breakdownEl = document.getElementById('forecastBreakdown');

  if (!isSame) {
    kpiEl.textContent = fmtS(currentTotal);
    kpiEl.style.color = currentTotal>=0?'var(--clr-income-dark)':'var(--clr-expense-dark)';
    bannerAmtEl.textContent = fmt(currentTotal);
    bannerAmtEl.className   = 'forecast-banner-amount ' + (currentTotal>=0?'positive':'negative');
    bannerSubEl.textContent = '最終残高（確定）';
    detailEl.textContent    = '当月以外は確定した収支結果を表示しています';
    fillEl.style.width='0%'; midEl.textContent=''; maxEl.textContent='';
    if (breakdownEl) breakdownEl.style.display='none';
    return;
  }

  const fc = calcForecastV2(year, month);
  const { predicted, remainingFixed, varForecast, weightedAvg, remainDays, fixedBreakdown, confidence } = fc;
  kpiEl.textContent = fmt(predicted);
  kpiEl.style.color = predicted>=0?(predicted<currentTotal*0.15?'var(--clr-forecast-dark)':'var(--clr-income-dark)'):'var(--clr-expense-dark)';
  bannerAmtEl.textContent = (predicted>=0?'¥':'▲¥') + Math.abs(Math.round(predicted)).toLocaleString('ja-JP');
  if (predicted<0) { bannerAmtEl.className='forecast-banner-amount negative'; bannerSubEl.textContent='⚠ 月末に資金不足の見込み'; }
  else if (predicted<currentTotal*0.15) { bannerAmtEl.className='forecast-banner-amount warning'; bannerSubEl.textContent='△ 残高が少なくなる見込み'; }
  else { bannerAmtEl.className='forecast-banner-amount positive'; bannerSubEl.textContent='月末着地予測残高'; }
  detailEl.innerHTML = `変動費日均: <strong>¥${Math.round(weightedAvg).toLocaleString()}</strong>　残 <strong>${remainDays}日</strong>　信頼度: <strong>${confidence}</strong>`;
  const setting  = getBalanceSetting(year, month);
  const initTotal = setting ? Number(setting.bank_balance)+Number(setting.cash_balance) : currentTotal||1;
  const pct = Math.min(Math.max((predicted/(initTotal||1))*100,0),100);
  fillEl.style.width=pct+'%';
  fillEl.className='forecast-bar-fill'+(predicted<0?' danger':predicted<initTotal*0.15?' warn':'');
  midEl.textContent=fmt(initTotal/2); maxEl.textContent=fmt(initTotal);
  if (!breakdownEl) return;
  breakdownEl.style.display='block';
  breakdownEl.innerHTML = `
    <div class="fc-breakdown-grid">
      <div class="fc-breakdown-item var">
        <div class="fc-bd-icon"><i class="fas fa-chart-line"></i></div>
        <div class="fc-bd-body">
          <div class="fc-bd-label">変動費予測（残${remainDays}日分）</div>
          <div class="fc-bd-amount expense">▲${fmt(varForecast)}</div>
          <div class="fc-bd-note">日均 ¥${Math.round(weightedAvg).toLocaleString()} ${fc.hasLast&&fc.hasLLast?'（今月70%＋先月20%＋先々月10%）':fc.hasLast?'（今月75%＋先月25%）':'（今月データのみ）'}</div>
        </div>
      </div>
      <div class="fc-breakdown-item fixed">
        <div class="fc-bd-icon"><i class="fas fa-lock"></i></div>
        <div class="fc-bd-body">
          <div class="fc-bd-label">残り固定費（予算ベース）</div>
          <div class="fc-bd-amount expense">▲${fmt(remainingFixed)}</div>
          <div class="fc-bd-note">${fixedBreakdown.length>0?fixedBreakdown.filter(f=>f.remain>0).map(f=>`${f.cat} ¥${f.remain.toLocaleString()}`).join('　')||'全て支払い済み':'予算未設定（変動費扱い）'}</div>
        </div>
      </div>
    </div>
    <div class="fc-result-row">
      <span class="fc-result-label">現在残高</span><span class="fc-result-val">${fmt(currentTotal)}</span>
      <span class="fc-result-minus">−</span>
      <span class="fc-result-label">固定費</span><span class="fc-result-val expense">${fmt(remainingFixed)}</span>
      <span class="fc-result-minus">−</span>
      <span class="fc-result-label">変動費予測</span><span class="fc-result-val expense">${fmt(varForecast)}</span>
      <span class="fc-result-eq">=</span>
      <span class="fc-result-label">予測残高</span><span class="fc-result-val ${predicted>=0?'income':'expense'}">${fmt(predicted)}</span>
    </div>`;
}

// ※ renderBarChart, renderPieChart, renderPaymentSummary, renderBoxBudgetOverview,
//    renderCategorySummary, renderTransactionCards, populateFilter, renderAll,
//    updatePaymentPreview, onTypeChange, setTodayDate, resetForm,
//    handleFormSubmit, startEdit, openDeleteModal, closeDeleteModal, confirmDelete,
//    openBalanceSetup, closeBalanceSetup, handleBalanceSetupSubmit,
//    switchTab, changeMonth, bindEvents, init
//    については実際のコードを参照（同様のパターンで Supabase に置き換える）
```

---

### 【js/form.js 全文】（収支入力 3ステップウィザード）

```javascript
'use strict';

const TX_TABLE  = 'transactions';
const BAL_TABLE = 'balance_settings';
const PM_LABEL = {
  rakuten:'💳 楽天ペイ', paypay:'💰 PayPay', mercari:'🛍 メルカリ',
  cash:'💵 現金', bank_in:'🏦 銀行口座', transfer_to_cash:'🏧 ATM振替',
};
const TYPE_LABEL = { income:'収入', expense:'支出', transfer:'ATM振替' };

let allTransactions = [], balanceSettings = [];
let currentBankBalance = 0, currentCashBalance = 0;
let pendingData = null;

// ユーティリティ・apiFetch・fetchAll は app.js と同じパターン（省略）

function calcCurrentBalances() {
  const now  = new Date();
  const key  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const setting = balanceSettings.find(s => s.month === key);
  let bank = setting ? Number(setting.bank_balance) : 0;
  let cash = setting ? Number(setting.cash_balance)  : 0;
  allTransactions.filter(t => t.date && t.date.startsWith(key))
    .sort((a,b) => a.date.localeCompare(b.date))
    .forEach(tx => {
      const amt = Number(tx.amount);
      if (tx.type==='income')   { if(tx.payment_method==='cash') cash+=amt; else bank+=amt; }
      if (tx.type==='expense')  { if(tx.payment_method==='cash') cash-=amt; else bank-=amt; }
      if (tx.type==='transfer') { bank-=amt; cash+=amt; }
    });
  return { bank, cash };
}

// 3ステップウィザード: goToStep(1|2|3), handleGoToConfirm, buildConfirmView,
// handleConfirmSave（POST後にfetchAll→updateQuickBalance→buildDoneView）,
// buildTodayHistory（今日のデータ一覧＋削除ボタン）,
// openDeleteModal / confirmDelete（DELETE後にfetchAll→updateQuickBalance→buildTodayHistory）
```

---

### 【js/budget.js 概要】（予算管理）

```javascript
// テーブル: budgets
// 主な処理: 月の予算入力（カテゴリ別）・一括保存・前月実績コピー
// CRUD: POST/PUT/DELETE budgets レコード + fetchAll('transactions') で実績取得
```

---

### 【js/summary.js 概要】（月次分析）

```javascript
// テーブル: transactions, balance_settings, monthly_closings, budgets
// 主な処理: 12ヶ月トレンドグラフ・支払い方法グラフ・残高推移・棚卸し差異一覧
// chart.js 使用（trendChart, pmTrendChart, balanceTrendChart の3グラフ）
```

---

### 【js/closing.js 概要】（月末棚卸し）

```javascript
// テーブル: monthly_closings, transactions, balance_settings
// 主な処理: 毎月1日に先月の棚卸しバナー表示・実際残高入力・差異計算・締め確定
// 関数名: apiFetchCl, fetchAllCl（app.jsとの名前衝突を避けるため）
```

---

## ▼ Supabase 移行後のコード例（参考）

### supabase-client.js（新規作成）

```javascript
// supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL  = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

// 未ログインなら login.html へリダイレクト
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.href = 'login.html'; return null; }
  return session.user;
}
```

### fetchAll の置き換え例（app.js）

```javascript
// 現在
const txs = await fetchAll('transactions', 'date');

// 移行後
const { data: txs, error } = await supabase
  .from('transactions')
  .select('*')
  .order('date', { ascending: true });
// ※ RLS により user_id フィルタは自動適用
```

### レコード作成の置き換え例

```javascript
// 現在
await apiFetch('tables/transactions', { method:'POST', body: payload });

// 移行後（user_id を自動付与）
const { data: { user } } = await supabase.auth.getUser();
const { error } = await supabase.from('transactions').insert({
  ...payload,
  user_id: user.id
});
```

### レコード削除の置き換え例

```javascript
// 現在
await apiFetch(`tables/transactions/${id}`, { method:'DELETE' });

// 移行後
const { error } = await supabase.from('transactions').delete().eq('id', id);
```

---

## ▼ Supabase SQL（STEP 1 で実行する内容）

以下のSQLを Supabase の SQL Editor に貼り付けて実行してください。

```sql
-- UUID拡張の有効化
create extension if not exists "uuid-ossp";

-- transactions テーブル
create table if not exists transactions (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  date           text not null,
  type           text not null check (type in ('income','expense','transfer')),
  category       text,
  amount         numeric not null,
  payment_method text,
  memo           text,
  created_at     timestamptz default now()
);
alter table transactions enable row level security;
create policy "own transactions" on transactions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- balance_settings テーブル
create table if not exists balance_settings (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  month        text not null,
  bank_balance numeric default 0,
  cash_balance numeric default 0,
  created_at   timestamptz default now(),
  unique (user_id, month)
);
alter table balance_settings enable row level security;
create policy "own balance_settings" on balance_settings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- budgets テーブル
create table if not exists budgets (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  month      text not null,
  box        text not null check (box in ('A','B','C')),
  category   text not null,
  amount     numeric default 0,
  note       text,
  created_at timestamptz default now(),
  unique (user_id, month, box, category)
);
alter table budgets enable row level security;
create policy "own budgets" on budgets
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- monthly_closings テーブル
create table if not exists monthly_closings (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  month       text not null,
  bank_system numeric default 0,
  cash_system numeric default 0,
  bank_actual numeric default 0,
  cash_actual numeric default 0,
  bank_diff   numeric default 0,
  cash_diff   numeric default 0,
  note        text,
  is_closed   boolean default false,
  created_at  timestamptz default now(),
  unique (user_id, month)
);
alter table monthly_closings enable row level security;
create policy "own monthly_closings" on monthly_closings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

---

## ▼ コスト概算

| サービス | プラン | 月額 |
|---|---|---|
| Supabase | Free Tier | ¥0（500MB・50k MAU まで）|
| Vercel | Hobby | ¥0（個人利用）|
| GitHub | Free | ¥0 |
| カスタムドメイン | 任意 | ¥0〜約¥150/月 |
| **合計** | | **¥0〜約¥150** |

---

## ▼ まず最初にお願いしたいこと

**STEP 1を始めてください。**

1. Supabase のアカウント作成方法を教えてください（まだアカウントがない場合）
2. プロジェクト作成の手順を教えてください
3. 上記の SQL を SQL Editor で実行する手順を教えてください
4. 実行後に確認すべき内容（テーブルが正しく作成されているか）を教えてください

よろしくお願いします。
