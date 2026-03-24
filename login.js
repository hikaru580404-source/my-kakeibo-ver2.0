/* =============================================
   login.js -- マイ家計簿 認証処理
   HealthLog で実証済みの修正を全て適用:
     - getSession() ベースのログインガード
     - location.replace() + 300ms 待機
     - autocomplete / iOS ズーム対策 (HTML側)
     - 詳細エラーハンドリング
   ============================================= */
'use strict';
import { supabase, getSessionUser } from './supabase-client.js';

let isSignUpMode = false;

document.addEventListener('DOMContentLoaded', async () => {
  // ── ログインガード: 既にセッションがあればダッシュボードへ ──
  // getSession() を使用 (iOS Chrome で getUser() が失敗する問題を回避)
  try {
    const user = await getSessionUser();
    if (user) {
      window.location.replace('index.html');
      return;
    }
  } catch (e) {
    console.warn('[login] session check error (ignored):', e);
  }

  // ── DOM 要素 ──
  const form          = document.getElementById('authForm');
  const authTitle     = document.getElementById('authTitle');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const toggleAuthMode = document.getElementById('toggleAuthMode');
  const msgEl         = document.getElementById('authMsg');

  // ── モード切り替え（ログイン ⇔ 新規登録）──
  toggleAuthMode.addEventListener('click', (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    msgEl.textContent = '';
    msgEl.className = 'login-msg';

    if (isSignUpMode) {
      authTitle.textContent      = 'マイ家計簿 新規登録';
      authSubmitBtn.textContent  = '新規登録（承認メールを送信）';
      authSubmitBtn.innerHTML    = '<i class="fas fa-user-plus"></i> 新規登録（承認メールを送信）';
      toggleAuthMode.textContent = '既にアカウントをお持ちの方はこちら（ログイン）';
      // 新規登録時はパスワードマネージャーへの提案を変更
      document.getElementById('password').setAttribute('autocomplete', 'new-password');
    } else {
      authTitle.textContent      = 'マイ家計簿 ログイン';
      authSubmitBtn.innerHTML    = '<i class="fas fa-sign-in-alt"></i> ログイン';
      toggleAuthMode.textContent = 'アカウントをお持ちでない方はこちら（新規登録）';
      document.getElementById('password').setAttribute('autocomplete', 'current-password');
    }
  });

  // ── フォーム送信 ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showMsg('メールアドレスとパスワードを入力してください。', 'error');
      return;
    }

    authSubmitBtn.disabled = true;
    showMsg(isSignUpMode ? '登録処理中...' : 'ログイン処理中...', '');

    if (isSignUpMode) {
      // 【新規登録】
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        showMsg('登録エラー: ' + error.message, 'error');
        authSubmitBtn.disabled = false;
      } else {
        showMsg('✅ 承認メールを送信しました。メール内のリンクをクリックして認証を完了し、ログインしてください。', 'success');
        form.reset();
        authSubmitBtn.disabled = false;
        // 1.5秒後にログインモードへ戻す
        setTimeout(() => toggleAuthMode.click(), 1500);
      }
    } else {
      // 【ログイン】
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data?.session) {
          showMsg('ログインに失敗しました。メールアドレスまたはパスワードを確認してください。', 'error');
          authSubmitBtn.disabled = false;
          return;
        }
        showMsg('ログイン成功！ダッシュボードへ移動中...', 'success');
        // セッションが LocalStorage に書き込まれるまで 300ms 待機してから遷移
        // (iOS Chrome でセッション未確立のままリダイレクトするバグを防ぐ)
        setTimeout(() => {
          window.location.replace('index.html');
        }, 300);
      } catch (err) {
        console.error('[login] signIn error:', err);
        showMsg('予期しないエラーが発生しました: ' + err.message, 'error');
        authSubmitBtn.disabled = false;
      }
    }
  });

  function showMsg(text, type) {
    msgEl.textContent = text;
    msgEl.className   = 'login-msg' + (type ? ' ' + type : '');
  }
});
