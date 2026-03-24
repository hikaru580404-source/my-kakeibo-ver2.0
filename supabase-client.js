/* =============================================
   supabase-client.js -- AsirLabo OS / マイ家計簿
   新Supabase (qzxajtlisscwxwidicfh) 接続設定
   HealthLogで実証済みのセキュリティ対応を適用:
     - getSession() ベース (iOS Chrome対応)
     - persistSession: true + storageKey固定
     - autoRefreshToken: true
     - 不可視文字ゼロ (ASCII only)
   ============================================= */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://qzxajtlisscwxwidicfh.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6eGFqdGxpc3Njd3h3aWRpY2ZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODMyODcsImV4cCI6MjA4OTQ1OTI4N30.a_p0H8IA9G2GzCQXirIDmHCsw38SDGGxIBwRFvbJtf0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'indep-kakeibo-auth',
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

/* --------------------------------------------------
   checkAuth()
   - セッションを確認し、未ログインなら login.html へ
   - 全ページ共通で使用 (login.html 以外)
   -------------------------------------------------- */
export async function checkAuth() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session || !session.user) {
      window.location.replace('login.html');
      return null;
    }
    return session.user;
  } catch (e) {
    console.error('[checkAuth] error:', e);
    window.location.replace('login.html');
    return null;
  }
}

/* --------------------------------------------------
   requireAuth() -- checkAuth() の別名 (後方互換)
   -------------------------------------------------- */
export async function requireAuth() {
  return checkAuth();
}

/* --------------------------------------------------
   getSessionUser()
   - セッションを確認するだけでリダイレクトしない
   - login.html のログインガード専用
   -------------------------------------------------- */
export async function getSessionUser() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user ?? null;
  } catch (e) {
    console.error('[getSessionUser] error:', e);
    return null;
  }
}

/* --------------------------------------------------
   JST ユーティリティ関数群
   - サーバーレス環境 (UTC) でのズレを防ぐ
   - HealthLog と同一実装で統一
   -------------------------------------------------- */

/**
 * 現在のJST日時を ISO 8601 形式で返す
 * 例: "2026-03-24 14:30:00+09"
 */
export function getNowJSTTimestamp() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm   = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(jst.getUTCDate()).padStart(2, '0');
  const hh   = String(jst.getUTCHours()).padStart(2, '0');
  const min  = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:00+09`;
}

/**
 * 現在のJST年月日を返す
 * 例: "2026-03-24"
 */
export function getJSTDateString() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm   = String(jst.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(jst.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 現在のJST年月を返す
 * 例: "2026-03"
 */
export function getJSTMonthString() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = jst.getUTCFullYear();
  const mm   = String(jst.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}
