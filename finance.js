document.addEventListener('DOMContentLoaded', async () => {
    // 認証チェック (supabase-client.js側の関数)
    const user = await checkAuth();
    if (!user) return;

    // ログアウト処理
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        window.location.href = "login.html";
    });

    const recordDateInput = document.getElementById('recordDate');
    const incomeInput = document.getElementById('incomeVal');
    const expenseInput = document.getElementById('expenseVal');
    const actualBalanceInput = document.getElementById('actualBalance');
    const discrepancyArea = document.getElementById('discrepancyArea');
    const discrepancyVal = document.getElementById('discrepancyVal');
    
    let previousBalance = 0;

    // 本日の日付をセット
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;
    recordDateInput.value = todayStr;

    /**
     * 前日の実残高を取得する関数
     */
    async function fetchPreviousBalance(dateStr) {
        try {
            const { data, error } = await supabaseClient
                .from('daily_financial_logs')
                .select('actual_balance')
                .eq('user_id', user.id)
                .lt('record_date', dateStr)
                .order('record_date', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;

            previousBalance = data ? data.actual_balance : 0;
            document.getElementById('prevBalance').innerText = `¥ ${previousBalance.toLocaleString()}`;
            calculateDiscrepancy();
        } catch (err) {
            console.error('[FETCH_BALANCE_ERROR]:', err.message);
        }
    }

    /**
     * 誤差（Discrepancy）を計算しUIに反映する関数
     */
    function calculateDiscrepancy() {
        const income = parseInt(incomeInput.value) || 0;
        const expense = parseInt(expenseInput.value) || 0;
        const actual = parseInt(actualBalanceInput.value);

        if (isNaN(actual)) {
            discrepancyArea.style.display = 'none';
            return;
        }

        // 計算上残高 ＝ 前日残高 ＋ 収入 － 支出
        const calculatedBalance = previousBalance + income - expense;
        // 誤差 ＝ 実残高 － 計算上残高
        const discrepancy = actual - calculatedBalance;

        discrepancyArea.style.display = 'block';
        discrepancyVal.innerText = `¥ ${discrepancy.toLocaleString()}`;

        if (discrepancy === 0) {
            discrepancyArea.className = 'discrepancy-box discrepancy-ok';
            discrepancyArea.innerHTML = `誤差 (Discrepancy): <span id="discrepancyVal">¥ 0</span><br><span style="font-size:0.8rem;">[PERFECT] 財務規律は守られています</span>`;
        } else {
            discrepancyArea.className = 'discrepancy-box discrepancy-ng';
            discrepancyArea.innerHTML = `誤差 (Discrepancy): <span id="discrepancyVal">¥ ${discrepancy.toLocaleString()}</span><br><span style="font-size:0.8rem;">[FATAL] 1円の誤差は仕組みの欠陥です。原因を特定してください</span>`;
        }
    }

    // イベントリスナーの登録
    recordDateInput.addEventListener('change', (e) => fetchPreviousBalance(e.target.value));
    incomeInput.addEventListener('input', calculateDiscrepancy);
    expenseInput.addEventListener('input', calculateDiscrepancy);
    actualBalanceInput.addEventListener('input', calculateDiscrepancy);

    // 初期ロード時に前日残高を取得
    await fetchPreviousBalance(todayStr);

    /**
     * フォーム送信（データ保存）処理
     */
    document.getElementById('financeForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btnSave');
        btn.disabled = true;
        btn.innerText = "Saving...";

        const recordDate = recordDateInput.value;
        const income = parseInt(incomeInput.value) || 0;
        const expense = parseInt(expenseInput.value) || 0;
        const actualBalance = parseInt(actualBalanceInput.value) || 0;
        const calculatedBalance = previousBalance + income - expense;
        const discrepancy = actualBalance - calculatedBalance;
        const notes = document.getElementById('notes').value;

        const payload = {
            user_id: user.id,
            record_date: recordDate,
            income: income,
            expense: expense,
            actual_balance: actualBalance,
            calculated_balance: calculatedBalance,
            discrepancy: discrepancy,
            notes: notes
        };

        try {
            const { error } = await supabaseClient
                .from('daily_financial_logs')
                .upsert(payload, { onConflict: 'user_id, record_date' });

            if (error) throw error;

            alert('財務ログを厳格に記録しました。');
            // 次の日のための準備として再読み込み
            await fetchPreviousBalance(recordDate);
        } catch (err) {
            console.error('[SAVE_FINANCE_ERROR]:', err.message);
            alert('保存に失敗しました: ' + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "財務ログを記録する";
        }
    });
});