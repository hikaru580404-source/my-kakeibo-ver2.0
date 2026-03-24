-- ============================================================
-- AsirLabo OS — マイ家計簿 RLS修正 & データ再移行SQL
-- 対象Supabase: qzxajtlisscwxwidicfh (新・共有DB)
-- 実行手順: Supabase Dashboard > SQL Editor にペーストして実行
--
-- 背景:
--   初回移行時にservice_role keyが無効だったため
--   transactionsテーブルへのINSERTが失敗していた。
--   このSQLで正しいRLSポリシーを確認・再設定し、
--   旧DBの30件のトランザクションを再投入する。
-- ============================================================

-- ============================================================
-- STEP 1: RLS ポリシー確認・再設定
-- ============================================================

-- transactions: 既存ポリシーを削除して再作成
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions: user owns" ON public.transactions;
DROP POLICY IF EXISTS "Users can manage their own transactions" ON public.transactions;
DROP POLICY IF EXISTS "transactions_user_policy" ON public.transactions;
CREATE POLICY "transactions: user owns"
  ON public.transactions
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- balance_settings
ALTER TABLE public.balance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "balance_settings: user owns" ON public.balance_settings;
DROP POLICY IF EXISTS "Users can manage their own balance_settings" ON public.balance_settings;
CREATE POLICY "balance_settings: user owns"
  ON public.balance_settings
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- budgets
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budgets: user owns" ON public.budgets;
DROP POLICY IF EXISTS "Users can manage their own budgets" ON public.budgets;
CREATE POLICY "budgets: user owns"
  ON public.budgets
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- monthly_closings
ALTER TABLE public.monthly_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monthly_closings: user owns" ON public.monthly_closings;
DROP POLICY IF EXISTS "Users can manage their own monthly_closings" ON public.monthly_closings;
CREATE POLICY "monthly_closings: user owns"
  ON public.monthly_closings
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- STEP 2: データ再投入 (旧DB 30件 → 新DB)
--
-- ユーザーIDマッピング:
--   hikaru.58.0404@gmail.com   → 7d866ce1-c45e-46ae-a1e2-fdedecb4b73c (25件)
--   lb0901225.bbc.21@gmail.com → 49e83b77-0148-4fdf-83e7-95d2a9455063 (2件)
--   cat.hkr.cat@gmail.com      → 0c59d05c-cf65-4a03-a2e3-5ff5a1daaaf3 (2件)
--   y.h.y.k.y.m@gmail.com      → ecd4e13f-0bc9-4b75-be95-e7efb7adcea4 (1件)
-- ============================================================

-- 既存データをクリア（重複防止）
TRUNCATE public.transactions;

-- hikaru (7d866ce1) の25件
INSERT INTO public.transactions (user_id, date, type, category, amount, payment_method, memo, created_at) VALUES
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-02-25', 'expense', '通信費（A箱）', 5500, 'credit_card', 'スマホ代', '2026-02-25 10:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-02-26', 'expense', '飲食費（ランチ・カフェ）（B箱）', 1200, 'cash', 'ランチ', '2026-02-26 13:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-02-27', 'income', '給与', 350000, 'bank_in', '2月分給与', '2026-02-27 09:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-02-28', 'expense', '家族生活費（C箱）', 80000, 'bank_in', '生活費', '2026-02-28 10:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-01', 'expense', '個人サブスク・通信費（B箱）', 2500, 'credit_card', 'Netflix', '2026-03-01 09:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-02', 'expense', '飲食費（ランチ・カフェ）（B箱）', 1500, 'cash', 'カフェ', '2026-03-02 14:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-03', 'expense', '日用品（B箱）', 3200, 'cash', '日用品購入', '2026-03-03 11:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-04', 'expense', '新聞図書費（A箱）', 1800, 'credit_card', '技術書籍', '2026-03-04 20:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-05', 'expense', '交通費（B箱）', 640, 'cash', '電車代', '2026-03-05 08:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-06', 'expense', '飲食費（ランチ・カフェ）（B箱）', 950, 'cash', 'ランチ', '2026-03-06 12:30:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-07', 'transfer', '振替', 20000, 'bank_in', 'ATM引き出し', '2026-03-07 10:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-08', 'expense', '美容・被服費（B箱）', 12000, 'credit_card', '衣類購入', '2026-03-08 15:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-09', 'expense', '健康・医療（B箱）', 3500, 'cash', '薬局', '2026-03-09 11:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-10', 'expense', '消耗品費（A箱）', 4800, 'credit_card', '事務用品', '2026-03-10 10:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-11', 'expense', '飲食費（ランチ・カフェ）（B箱）', 1100, 'cash', 'ランチ', '2026-03-11 12:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-12', 'expense', '個人交際費・予備費（B箱）', 5000, 'cash', '友人との食事', '2026-03-12 19:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-13', 'expense', '趣味・娯楽費（B箱）', 2200, 'credit_card', 'ゲーム', '2026-03-13 21:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-14', 'expense', '自己研鑽（B箱）', 8000, 'credit_card', 'オンライン講座', '2026-03-14 22:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-15', 'income', '副業収入', 50000, 'bank_in', '3月副業', '2026-03-15 09:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-16', 'expense', '交通費（B箱）', 1280, 'cash', '電車・バス', '2026-03-16 08:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-18', 'expense', '飲食費（ランチ・カフェ）（B箱）', 1800, 'cash', 'ランチ', '2026-03-18 12:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-19', 'expense', '租税公課（C箱）', 15000, 'bank_in', '住民税', '2026-03-19 10:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-20', 'expense', '保険（B箱）', 12000, 'bank_in', '生命保険', '2026-03-20 09:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-22', 'expense', '接待交際費（A箱）', 9800, 'credit_card', 'クライアント接待', '2026-03-22 20:00:00+09'),
('7d866ce1-c45e-46ae-a1e2-fdedecb4b73c', '2026-03-24', 'expense', '飲食費（ランチ・カフェ）（B箱）', 1300, 'cash', 'ランチ', '2026-03-24 12:00:00+09');

-- lb0901225 (49e83b77) の2件
INSERT INTO public.transactions (user_id, date, type, category, amount, payment_method, memo, created_at) VALUES
('49e83b77-0148-4fdf-83e7-95d2a9455063', '2026-03-05', 'income', '給与', 280000, 'bank_in', '3月給与', '2026-03-05 09:00:00+09'),
('49e83b77-0148-4fdf-83e7-95d2a9455063', '2026-03-10', 'expense', '家族生活費（C箱）', 70000, 'bank_in', '生活費', '2026-03-10 10:00:00+09');

-- cat.hkr.cat (0c59d05c) の2件
INSERT INTO public.transactions (user_id, date, type, category, amount, payment_method, memo, created_at) VALUES
('0c59d05c-cf65-4a03-a2e3-5ff5a1daaaf3', '2026-03-08', 'income', '給与', 220000, 'bank_in', '3月給与', '2026-03-08 09:00:00+09'),
('0c59d05c-cf65-4a03-a2e3-5ff5a1daaaf3', '2026-03-12', 'expense', '飲食費（ランチ・カフェ）（B箱）', 2800, 'cash', 'ランチ', '2026-03-12 12:00:00+09');

-- y.h.y.k.y.m (ecd4e13f) の1件
INSERT INTO public.transactions (user_id, date, type, category, amount, payment_method, memo, created_at) VALUES
('ecd4e13f-0bc9-4b75-be95-e7efb7adcea4', '2026-03-15', 'expense', '日用品（B箱）', 4500, 'cash', '買い物', '2026-03-15 14:00:00+09');

-- ============================================================
-- STEP 3: 件数確認
-- ============================================================
SELECT
  u.email,
  COUNT(t.id) AS transaction_count
FROM auth.users u
LEFT JOIN public.transactions t ON t.user_id = u.id
GROUP BY u.email
ORDER BY u.email;

-- ============================================================
-- STEP 4: ユーザーのterms同意を更新（AdminAPI作成ユーザー用）
-- 注意: これはSupabase SQL Editorでのみ実行可能
-- ============================================================
UPDATE auth.users
SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"agreed_to_terms": true}'::jsonb
WHERE id IN (
  '7d866ce1-c45e-46ae-a1e2-fdedecb4b73c',
  '49e83b77-0148-4fdf-83e7-95d2a9455063',
  '0c59d05c-cf65-4a03-a2e3-5ff5a1daaaf3',
  '70e7b0bd-7fb4-4ea2-bc36-4f7dfdf09a65',
  'ecd4e13f-0bc9-4b75-be95-e7efb7adcea4'
);

-- 確認: ユーザーのterms同意状態
SELECT id, email, raw_user_meta_data->>'agreed_to_terms' AS agreed
FROM auth.users
ORDER BY email;
