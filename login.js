/* =============================================
   login.js — ログイン処理ロジック
   ============================================= */
'use strict';
import { supabase } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    window.location.href = 'index.html';
    return;
  }

  const form = document.getElementById('loginForm');
  const msgEl = document.getElementById('loginMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msgEl.textContent = 'ログイン処理中...';
    
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      msgEl.textContent = 'ログインに失敗しました。メールアドレスとパスワードを確認してください。';
    } else {
      window.location.href = 'index.html';
    }
  });
});