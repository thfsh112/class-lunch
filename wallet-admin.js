(()=>{
  const byId=id=>document.getElementById(id);

  function inject(){
    if(byId('walletAdminPanel'))return;
    const tab=byId('tab-students');
    if(!tab)return;
    const panel=document.createElement('div');
    panel.id='walletAdminPanel';
    panel.className='panel';
    panel.innerHTML=`
      <div class="section-head">
        <div><h2>錢包測試（99）</h2><p class="hint">目前只開放 99 號測試；其他學生端不會看到錢包功能。</p></div>
        <button id="walletAdminRefreshBtn" class="small-btn" type="button">重新整理</button>
      </div>
      <div id="walletAdminOverview"></div>
      <div class="account-divider"></div>
      <h3>待確認儲值</h3>
      <div id="walletAdminTopups" class="history-list"></div>
      <div class="account-divider"></div>
      <h3>結清流程</h3>
      <div id="walletAdminSettlements" class="history-list"></div>`;
    tab.insertBefore(panel,tab.firstChild);
    byId('walletAdminRefreshBtn').addEventListener('click',refreshWalletAdmin);
  }

  async function refreshWalletAdmin(){
    if(!adminGatePassed)return;
    try{
      const [overview,topups,settlements]=await Promise.all([
        db.rpc('class_lunch_wallet_admin_overview'),
        db.rpc('class_lunch_wallet_admin_pending_topups'),
        db.rpc('class_lunch_wallet_admin_pending_settlements')
      ]);
      const err=overview.error||topups.error||settlements.error;
      if(err)throw err;

      const wallet99=(overview.data||[]).find(x=>Number(x.seat_number)===99);
      byId('walletAdminOverview').innerHTML=wallet99
        ?'<div class="student-row"><span class="seat-badge">99號</span><div><b>'+esc(wallet99.name||'管理員')+'</b><br><span class="hint">餘額 '+money(wallet99.balance)+' · '+esc(wallet99.status)+'</span></div><div class="actions"><button class="small-btn danger" type="button" data-start-settlement="'+wallet99.student_id+'">發起結清</button></div></div>'
        :'<div class="loading">找不到 99 錢包</div>';
      byId('walletAdminOverview').querySelector('[data-start-settlement]')?.addEventListener('click',async e=>{
        if(!confirm('確定由管理端對 99 號發起結清？'))return;
        const {error}=await db.rpc('class_lunch_wallet_admin_start_settlement',{p_student_id:e.currentTarget.dataset.startSettlement});
        if(error)return toast('發起結清失敗：'+error.message);
        toast('已送出結清流程，等待學生最終確認');
        refreshWalletAdmin();
      });

      const pending=topups.data||[];
      byId('walletAdminTopups').innerHTML=pending.length?pending.map(x=>`
        <article class="history-row">
          <div class="history-main"><b>${x.seat_number}號 ${esc(x.name||'')} · 申請 ${money(x.requested_amount)}</b><small>${new Date(x.requested_at).toLocaleString('zh-TW')}</small></div>
          <div><button class="small-btn" type="button" data-approve-topup="${x.id}" data-requested="${x.requested_amount}">確認收款</button></div>
        </article>`).join(''):'<div class="loading">目前沒有待確認儲值</div>';
      byId('walletAdminTopups').querySelectorAll('[data-approve-topup]').forEach(btn=>btn.addEventListener('click',async()=>{
        const requested=Number(btn.dataset.requested);
        const raw=prompt('申請金額 '+money(requested)+'\n請輸入實際收到的金額：',String(requested));
        if(raw===null)return;
        const actual=Number(raw);
        if(!Number.isInteger(actual)||actual<=0)return toast('實收金額不正確');
        const {error}=await db.rpc('class_lunch_wallet_admin_approve_topup',{p_request_id:Number(btn.dataset.approveTopup),p_actual_amount:actual});
        if(error)return toast('儲值確認失敗：'+error.message);
        toast('儲值已入帳');
        refreshWalletAdmin();
      }));

      const rows=(settlements.data||[]).filter(x=>Number(x.seat_number)===99);
      byId('walletAdminSettlements').innerHTML=rows.length?rows.map(x=>`
        <article class="history-row">
          <div class="history-main"><b>99號結清 · ${esc(x.status)}</b><small>申請時餘額 ${money(x.balance_at_request)}</small></div>
          <div>
            ${x.status==='student_requested'?'<button class="small-btn" type="button" data-confirm-settlement="'+x.id+'">管理端確認</button>':''}
            ${x.status==='student_final_confirmed'?'<button class="small-btn danger" type="button" data-complete-settlement="'+x.id+'">正式完成結清</button>':''}
          </div>
        </article>`).join(''):'<div class="loading">目前沒有進行中的結清</div>';

      byId('walletAdminSettlements').querySelectorAll('[data-confirm-settlement]').forEach(btn=>btn.addEventListener('click',async()=>{
        const {error}=await db.rpc('class_lunch_wallet_admin_confirm_settlement',{p_request_id:Number(btn.dataset.confirmSettlement)});
        if(error)return toast('確認失敗：'+error.message);
        toast('管理端已確認，等待學生最終確認');
        refreshWalletAdmin();
      }));
      byId('walletAdminSettlements').querySelectorAll('[data-complete-settlement]').forEach(btn=>btn.addEventListener('click',async()=>{
        if(!confirm('學生已完成最終確認。確定正式執行結清？\n正餘額會視為已實際退還並歸零。'))return;
        const {error}=await db.rpc('class_lunch_wallet_admin_complete_settlement',{p_request_id:Number(btn.dataset.completeSettlement)});
        if(error)return toast('結清失敗：'+error.message);
        toast('結清完成');
        refreshWalletAdmin();
      }));
    }catch(error){
      if(byId('walletAdminOverview'))byId('walletAdminOverview').innerHTML='<div class="loading">錢包資料讀取失敗</div>';
      console.error('wallet_admin_refresh_failed',error);
    }
  }

  const originalToggle=window.togglePaid;
  window.togglePaid=async function(id,n){
    try{
      if(n){
        const {error}=await db.rpc('class_lunch_wallet_admin_mark_onsite_paid',{p_order_id:id});
        if(error){
          if(originalToggle&&/沒有綁定學生帳號/.test(error.message||''))return originalToggle(id,n);
          throw error;
        }
        toast('已付款');
      }else{
        const {error}=await db.rpc('class_lunch_wallet_admin_mark_unpaid',{p_order_id:id});
        if(error)throw error;
        toast('已改未付款');
      }
      await loadOverview();
      refreshWalletAdmin().catch(()=>{});
    }catch(error){
      toast((n?'付款失敗：':'改未付款失敗：')+error.message);
    }
  };

  inject();
  document.querySelector('[data-tab="students"]')?.addEventListener('click',()=>setTimeout(refreshWalletAdmin,0));
  setTimeout(()=>{if(adminGatePassed)refreshWalletAdmin()},900);
})();