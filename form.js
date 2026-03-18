/* =============================================
   form.js — 収支入力画面ロジック (ラジオボタン対応・完全版)
   ============================================= */
'use strict';
import { supabase } from './supabase-client.js';

document.addEventListener('DOMContentLoaded', async () => {
  // ログインチェック
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  // DOM要素の取得
  const form = document.getElementById('inputForm'); // form.htmlのIDに合わせる
  const msgEl = document.getElementById('toast'); // form.htmlのIDに合わせる
  const loadingOverlay = document.getElementById('loadingOverlay');

  function showLoading() { loadingOverlay.classList.remove('hidden'); }
  function hideLoading() { loadingOverlay.classList.add('hidden'); }
  function showToast(msg) { 
    msgEl.textContent = msg; 
    msgEl.classList.add('show');
    setTimeout(() => msgEl.classList.remove('show'), 3000);
  }

  // --- フォーム送信処理 ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // 入力値の取得
    const date = document.getElementById('inputDate').value;
    const type = document.querySelector('input[name="txType"]:checked')?.value;
    const category = document.getElementById('inputCategory').value;
    const amountStr = document.getElementById('inputAmount').value;
    const method = document.querySelector('input[name="payMethod"]:checked')?.value;
    const memo = document.getElementById('inputMemo').value;

    // バリデーション
    if (!date || !amountStr || !category || !method || !type) {
      alert('必須項目（日付、金額、科目、支払い方法）を入力してください。');
      return;
    }

    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
      alert('金額は正の整数で入力してください。');
      return;
    }

    showLoading();

    // SupabaseへのINSERT
    const { data, error } = await supabase
      .from('transactions')
      .insert([
        { 
          user_id: user.id, 
          date: date,
          type: type, 
          amount: amount,
          category: category,
          payment_method: method, 
          memo: memo
        }
      ]);

    hideLoading();

    if (error) {
      console.error('Insert Error:', error);
      alert('データの保存に失敗しました: ' + error.message);
    } else {
      showToast('✅ 収支データを保存しました！');
      form.reset(); 
    }
  });
});