/* =============================================
   login.js — 認証処理ロジック (トグル機能実装版)
   ============================================= */
'use strict';
import { supabase } from './supabase-client.js';

// 1. 状態管理フラグ（初期値はログインモード=false）
let isSignUpMode = false;

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    window.location.href = 'index.html';
    return;
  }

  // DOM要素の取得
  const form = document.getElementById('authForm');
  const authTitle = document.getElementById('authTitle');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const toggleAuthMode = document.getElementById('toggleAuthMode');
  const msgEl = document.getElementById('authMsg');

  // 2. モード切り替え（トグル）処理
  toggleAuthMode.addEventListener('click', (e) => {
    e.preventDefault();
    isSignUpMode = !isSignUpMode;
    msgEl.textContent = ''; // メッセージをクリア
    msgEl.className = 'login-msg';

    if (isSignUpMode) {
      // 新規登録モードへのUI変更
      authTitle.textContent = 'マイ家計簿 新規登録';
      authSubmitBtn.textContent = '新規登録（承認メールを送信）';
      toggleAuthMode.textContent = '既にアカウントをお持ちの方はこちら（ログイン）';
    } else {
      // ログインモードへのUI変更
      authTitle.textContent = 'マイ家計簿 ログイン';
      authSubmitBtn.textContent = 'ログイン';
      toggleAuthMode.textContent = 'アカウントをお持ちでない方はこちら（新規登録）';
    }
  });

  // 3. フォーム送信時の処理（APIリクエストの分岐）
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      msgEl.textContent = 'メールアドレスとパスワードを入力してください。';
      msgEl.className = 'login-msg error';
      return;
    }

    msgEl.textContent = isSignUpMode ? '登録処理中...' : 'ログイン処理中...';
    msgEl.className = 'login-msg';

    if (isSignUpMode) {
      // 【新規登録処理】
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        msgEl.textContent = '登録エラー: ' + error.message;
        msgEl.className = 'login-msg error';
      } else {
        msgEl.textContent = '✅ 承認メールを送信しました。メール内のリンクをクリックして認証を完了し、ログインしてください。';
        msgEl.className = 'login-msg success';
        form.reset();
        
        // 1.5秒後に自動的にログインモードへ戻す
        setTimeout(() => {
          toggleAuthMode.click();
        }, 1500);
      }
    } else {
      // 【ログイン処理】
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        msgEl.textContent = 'ログインに失敗しました。メールアドレスとパスワードを確認してください。';
        msgEl.className = 'login-msg error';
      } else {
        window.location.href = 'index.html';
      }
    }
  });
});