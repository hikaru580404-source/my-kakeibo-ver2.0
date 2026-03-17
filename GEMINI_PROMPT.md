# Gemini へのプロジェクト引き継ぎプロンプト

---

## あなたへの依頼

私はJavaScript初〜中級者の経営者です。
以下に説明する「マイ家計簿」Webアプリを、**Supabase + Vercel 構成にフルリプレイス**するサポートをしてください。

**進め方のルール：**
- 作業は必ず「1ステップずつ」進めてください
- 各ステップの完了確認を私に求めてから次へ進んでください
- コードは「どこに、何を、なぜ書くか」をセットで説明してください
- エラーが出たら画面キャプチャを共有するので、一緒に解決してください
- 専門用語は都度わかりやすく説明してください

---

## 現在のアプリ概要

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

## ページ構成（全4ページ）

| ファイル | 役割 |
|---|---|
| `index.html` | ダッシュボード（メイン画面） |
| `form.html` | 収支入力（3ステップウィザード） |
| `budget.html` | 予算管理 |
| `summary.html` | 月次サマリー・分析 |

---

## JSファイル構成

| ファイル | 役割 |
|---|---|
| `js/app.js` | ダッシュボードのメインロジック（約950行） |
| `js/form.js` | 収支入力フォームのロジック（約570行） |
| `js/budget.js` | 予算管理ロジック（約400行） |
| `js/summary.js` | 月次サマリーロジック（約550行） |
| `js/closing.js` | 月末棚卸しロジック（約280行） |

---

## 現在のデータモデル（全4テーブル）

### テーブル1: `transactions`（収支明細）
```
id            : UUID / 主キー
date          : text  / YYYY-MM-DD
type          : text  / "income" | "expense" | "transfer"
category      : text  / 勘定科目名
amount        : number / 金額（正の整数）
payment_method: text  / "rakuten"|"paypay"|"mercari"|"cash"|"bank_in"|"transfer_to_cash"
memo          : text  / 任意メモ
created_at    : datetime
```

### テーブル2: `balance_settings`（月初残高繰越）
```
id           : UUID / 主キー
month        : text   / YYYY-MM
bank_balance : number / 月初銀行口座残高
cash_balance : number / 月初現金残高
created_at   : datetime
```

### テーブル3: `budgets`（予算）
```
id       : UUID / 主キー
month    : text   / YYYY-MM
box      : text   / "A" | "B" | "C"
category : text   / 勘定科目名
amount   : number / 予算金額
created_at: datetime
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
created_at  : datetime
```

---

## 勘定科目・ボックス分類

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

## 現在のAPI呼び出しパターン（移行の核心部分）

現在の全JSファイルは以下のパターンでAPIを呼び出しています。
**Supabase移行後はこのパターンを Supabase クライアントで置き換えます。**

### 現在の apiFetch 関数（全JSファイル共通）
```javascript
async function apiFetch(path, opts = {}) {
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

async function fetchAll(table, sortField = 'created_at') {
  let page = 1, all = [];
  while (true) {
    const d = await apiFetch(`tables/${table}?page=${page}&limit=200&sort=${sortField}`);
    if (!d || !Array.isArray(d.data)) break;
    all = all.concat(d.data);
    if (all.length >= (d.total || 0)) break;
    page++;
  }
  return all;
}
```

### 現在のCRUD操作パターン
```javascript
// 一覧取得
const txs = await fetchAll('transactions', 'date');

// 単一作成
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

## 移行後に必要な機能

### 認証
- メールアドレス + パスワードでのサインアップ / ログイン
- ログイン状態でないと各ページにアクセスできない（未ログインは login.html にリダイレクト）
- ログアウトボタン（各ページのヘッダーに追加）

### データ分離
- 各テーブルに `user_id` カラムを追加
- Row Level Security（RLS）で自分のデータだけ読み書きできる
- 他のユーザーのデータは一切見えない

### 新規追加ページ
- `login.html`（ログイン + 新規登録画面）

---

## 移行作業のステップ案（参考）

```
STEP 1: Supabase プロジェクト作成・テーブルSQLを実行
STEP 2: GitHub リポジトリ作成・現在のファイルをアップロード
STEP 3: login.html を新規作成（Supabase Auth UI または自作フォーム）
STEP 4: supabase-client.js を作成（共通の初期化・認証チェック）
STEP 5: app.js の apiFetch + fetchAll を Supabase クライアントに置き換え
STEP 6: form.js の置き換え
STEP 7: budget.js の置き換え
STEP 8: summary.js の置き換え
STEP 9: closing.js の置き換え
STEP 10: Vercel にデプロイ・動作確認
```

---

## 重要な設計上の注意点

1. **残高計算はフロントエンドで行っている**
   - DB に残高は保存していない
   - `balance_settings`（月初繰越）＋`transactions`（当月全件）を取得して JS で積算する
   - この計算ロジックは移行後も変えない

2. **月末着地予測は「固定費分離モデル」を使用**
   - 固定費（予算設定済み科目）と変動費を分けて予測
   - 変動費は加重移動平均（今月70%・先月20%・先々月10%）

3. **closing.js は index.html と同じページで動作**
   - `js/app.js` と `js/closing.js` の両方が `index.html` に読み込まれている
   - closing.js は独自の `apiFetchCl` / `fetchAllCl` 関数を持つ（名前衝突回避のため）

4. **iOS Safari 対応済み**
   - `credentials: 'include'` を全fetchに付与
   - bodyは必ず文字列に変換してから送信

---

## まず最初にお願いしたいこと

**STEP 1から始めてください。**

Supabase のプロジェクト作成と、以下のSQLの実行をサポートしてください。
（SQLは上記のデータモデルをそのまま Supabase 用に変換したものをお願いします）

- `user_id` カラムの追加
- Row Level Security の設定
- 実行するSQLを1つのブロックで提示してください

よろしくお願いします。
