-- ============================================================
-- AsirLabo OS — マイ家計簿 専用テーブル作成SQL
-- 対象Supabase: qzxajtlisscwxwidicfh (新・共有DB)
-- 実行手順: Supabase Dashboard > SQL Editor にペーストして実行
-- ============================================================

-- ① transactions テーブル（収支明細）
CREATE TABLE IF NOT EXISTS public.transactions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date           date        NOT NULL,                        -- 取引日 (YYYY-MM-DD)
  type           text        NOT NULL CHECK (type IN ('income','expense','transfer')),
  category       text        NOT NULL DEFAULT '',
  amount         numeric(12,0) NOT NULL CHECK (amount >= 0), -- 金額（円）
  payment_method text        NOT NULL DEFAULT '',
  memo           text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ② balance_settings テーブル（月初残高設定）
CREATE TABLE IF NOT EXISTS public.balance_settings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month          text        NOT NULL,                        -- YYYY-MM
  bank_balance   numeric(12,0) NOT NULL DEFAULT 0,
  cash_balance   numeric(12,0) NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month)
);

-- ③ budgets テーブル（予算設定）
CREATE TABLE IF NOT EXISTS public.budgets (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month          text        NOT NULL,                        -- YYYY-MM
  box            text        NOT NULL CHECK (box IN ('A','B','C')),
  category       text        NOT NULL,
  amount         numeric(12,0) NOT NULL DEFAULT 0,
  note           text        NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month, category)
);

-- ④ monthly_closings テーブル（月末棚卸し）
CREATE TABLE IF NOT EXISTS public.monthly_closings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month          text        NOT NULL,                        -- YYYY-MM
  bank_system    numeric(12,0) NOT NULL DEFAULT 0,           -- 帳簿銀行残高
  cash_system    numeric(12,0) NOT NULL DEFAULT 0,           -- 帳簿現金残高
  bank_actual    numeric(12,0) NOT NULL DEFAULT 0,           -- 実際銀行残高
  cash_actual    numeric(12,0) NOT NULL DEFAULT 0,           -- 実際現金残高
  bank_diff      numeric(12,0) NOT NULL DEFAULT 0,           -- 銀行差異
  cash_diff      numeric(12,0) NOT NULL DEFAULT 0,           -- 現金差異
  note           text        NOT NULL DEFAULT '',
  is_closed      boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month)
);

-- ============================================================
-- インデックス（クエリ高速化）
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_transactions_user_date   ON public.transactions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type   ON public.transactions(user_id, type);
CREATE INDEX IF NOT EXISTS idx_balance_settings_user    ON public.balance_settings(user_id, month);
CREATE INDEX IF NOT EXISTS idx_budgets_user_month       ON public.budgets(user_id, month);
CREATE INDEX IF NOT EXISTS idx_monthly_closings_user    ON public.monthly_closings(user_id, month);

-- ============================================================
-- RLS (Row Level Security) — ユーザーが自分のデータのみ操作可能
-- ============================================================

-- transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions: user owns" ON public.transactions;
CREATE POLICY "transactions: user owns"
  ON public.transactions
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- balance_settings
ALTER TABLE public.balance_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "balance_settings: user owns" ON public.balance_settings;
CREATE POLICY "balance_settings: user owns"
  ON public.balance_settings
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- budgets
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budgets: user owns" ON public.budgets;
CREATE POLICY "budgets: user owns"
  ON public.budgets
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- monthly_closings
ALTER TABLE public.monthly_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monthly_closings: user owns" ON public.monthly_closings;
CREATE POLICY "monthly_closings: user owns"
  ON public.monthly_closings
  FOR ALL
  USING      (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Phase 5用: universal_logs への月次サマリー連携関数
-- 月末締め完了時に自動的に universal_logs へ finance_summary を書き込む
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_finance_summary_to_universal_logs()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_summary jsonb;
BEGIN
  -- 月次の収支集計
  SELECT jsonb_build_object(
    'project_id',    'indep',
    'measured_month', NEW.month,
    'bank_actual',   NEW.bank_actual,
    'cash_actual',   NEW.cash_actual,
    'bank_system',   NEW.bank_system,
    'cash_system',   NEW.cash_system,
    'bank_diff',     NEW.bank_diff,
    'cash_diff',     NEW.cash_diff,
    'income_total',  COALESCE((
      SELECT SUM(amount) FROM public.transactions
      WHERE user_id = NEW.user_id AND date::text LIKE NEW.month || '%' AND type = 'income'
    ), 0),
    'expense_total', COALESCE((
      SELECT SUM(amount) FROM public.transactions
      WHERE user_id = NEW.user_id AND date::text LIKE NEW.month || '%' AND type = 'expense'
    ), 0)
  ) INTO v_summary;

  -- universal_logs に upsert（月1件）
  INSERT INTO public.universal_logs (user_id, project_id, log_type, logged_at, payload)
  VALUES (
    NEW.user_id,
    'indep',
    'finance_summary',
    (NEW.month || '-01 00:00:00+09')::timestamptz,
    v_summary
  )
  ON CONFLICT (user_id, project_id, log_type, logged_at::date)
  DO UPDATE SET payload = EXCLUDED.payload, updated_at = now();

  RETURN NEW;
END;
$$;

-- 棚卸し確定時にトリガー起動
DROP TRIGGER IF EXISTS trg_finance_summary ON public.monthly_closings;
CREATE TRIGGER trg_finance_summary
  AFTER INSERT OR UPDATE ON public.monthly_closings
  FOR EACH ROW
  WHEN (NEW.is_closed = true)
  EXECUTE FUNCTION public.sync_finance_summary_to_universal_logs();

-- ============================================================
-- 旧DB (epnxlbhrivagtjwxhddt) からのデータ移行SQL（参考）
-- 旧DBのtransactionsデータをCSV export → 新DBにimportする手順:
-- 1. 旧Supabase Dashboard > Table Editor > transactions > Export CSV
-- 2. 新Supabase Dashboard > Table Editor > transactions > Import CSV
-- または以下のINSERT SELECTを旧DBで実行してCSV化:
--
-- SELECT id, user_id, date, type, category, amount, payment_method, memo, created_at
-- FROM transactions ORDER BY date;
-- ============================================================
