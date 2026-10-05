(()=>{
  const byId=id=>document.getElementById(id);

  function txLabel(type){
    return ({
      topup:'儲值',
      order_payment:'餐費扣款',
      onsite_payment:'現場付款入帳',
      refund:'退款',
      adjustment:'人工調整',
      settlement_refund:'結清退款',
      settlement_clearing:'結清'
    })[type]||type;
  }

  function walletStatusLabel(status){
    return ({active:'使用中',settlement_pending:'結清處理中',settled:'已結清'})[status]||status;
  }

  function topupStatusLabel(status){
    return ({pending:'待確認',approved:'已入帳',cancelled:'已取消',rejected:'已拒絕'})[status]||status;
  }

  function settlementStatusLabel(status){
    return ({
      student_requested:'學生已申請，等待管理端確認',
      admin_started:'管理端已發起',
      admin_confirmed:'等待學生最終確認',
      student_final_confirmed:'學生已確認，等待正式結清',
      completed:'已結清',
      rejected:'已拒絕',
      cancelled:'已取消'
    })[status]||status;
  }

  async function loadWalletBalances(){
    const box=byId('walletBalancesList');
    if(!box||!adminGatePassed)return;
    box.innerHTML='<div class="loading">載入中…</div>';
    const {data,error}=await db.rpc('class_lunch_wallet_admin_overview');
    if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取錢包餘額失敗：'+error.message)}
    const rows=data||[];
    box.innerHTML=rows.length?'<div class="seat-grid">'+rows.map(x=>{
      const enabled=!!x.enabled;
      const label=Number(x.seat_number)===0?'老師':x.seat_number+'號';
      return '<div class="seat-card '+(Number(x.balance)<0?'seat-unpaid':'seat-paid')+'">'+
        '<b>'+label+' '+esc(x.name||'')+'</b>'+
        '<span>'+walletStatusLabel(x.status)+(enabled?' · 已開放':' · 尚未開放')+'</span>'+
        '<strong>'+money(x.balance)+'</strong>'+
        (enabled&&x.status==='active'
          ?'<div><button class="small-btn danger" type="button" data-wallet-settle-start="'+x.student_id+'" data-wallet-seat="'+label+'">發起結清</button></div>'
          :enabled&&x.status==='settled'
            ?'<div><button class="small-btn" type="button" data-wallet-rebuild="'+x.student_id+'">重建錢包</button></div>'
            :'')+
      '</div>';
    }).join('')+'</div>':'<div class="loading">目前沒有錢包資料</div>';

    box.querySelectorAll('[data-wallet-settle-start]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('確定由管理端對 '+(btn.dataset.walletSeat||'此帳號')+' 發起結清？'))return;
      const {error}=await db.rpc('class_lunch_wallet_admin_start_settlement',{p_student_id:btn.dataset.walletSettleStart});
      if(error)return toast('發起結清失敗：'+error.message);
      toast('已發起結清，等待帳號端第一次確認');
      await Promise.all([loadWalletBalances(),loadWalletSettlements(),loadWalletDebts()]);
    }));

    box.querySelectorAll('[data-wallet-rebuild]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('確定重建這個已結清錢包？\n重建後餘額從 $0 開始，舊流水與舊結清紀錄會保留。'))return;
      const {error}=await db.rpc('class_lunch_wallet_admin_rebuild',{p_student_id:btn.dataset.walletRebuild});
      if(error)return toast('重建錢包失敗：'+error.message);
      toast('錢包已重建，餘額從 $0 開始');
      await Promise.all([loadWalletBalances(),loadWalletSettlements(),loadWalletLedger(),loadWalletDebts()]);
    }));
  }

  async function loadWalletDebts(){
    const box=byId('walletDebtsList'),summary=byId('walletDebtSummary');
    if(!box||!summary||!adminGatePassed)return;
    box.innerHTML='<div class="loading">載入中…</div>';
    const {data,error}=await db.rpc('class_lunch_wallet_admin_debts');
    if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取欠款金額失敗：'+error.message)}
    const rows=data||[];
    const total=rows.reduce((sum,x)=>sum+Number(x.total_debt||0),0);
    summary.innerHTML=
      '<div class="stat"><small>欠款人數</small><b>'+rows.length+'</b></div>'+
      '<div class="stat"><small>欠款總額</small><b>'+money(total)+'</b></div>';

    box.innerHTML=rows.length?'<div class="seat-grid">'+rows.map(x=>{
      const label=Number(x.seat_number)===0?'老師':x.seat_number+'號';
      const parts=[];
      if(Number(x.wallet_debt)>0)parts.push('錢包欠款 '+money(x.wallet_debt));
      if(Number(x.onsite_debt)>0)parts.push('現場未付 '+money(x.onsite_debt));
      return '<div class="seat-card seat-unpaid">'+
        '<b>'+label+' '+esc(x.name||'')+'</b>'+
        '<span>'+parts.join(' · ')+'</span>'+
        '<strong>欠 '+money(x.total_debt)+'</strong>'+
      '</div>';
    }).join('')+'</div>':'<div class="all-paid">✓ 目前沒有欠款</div>';
  }

  async function loadWalletPendingCounts(){
    if(!adminGatePassed)return;
    const {data,error}=await db.rpc('class_lunch_wallet_admin_pending_counts');
    if(error)return;
    const count=Number(data?.topups||0);
    for(const id of ['moneyPendingBadge','topupPendingBadge']){
      const badge=byId(id);
      if(!badge)continue;
      badge.textContent=count>99?'99+':String(count);
      badge.classList.toggle('hidden',count<=0);
    }
  }

  async function loadWalletTopups(){
    const box=byId('walletTopupsList');
    if(!box||!adminGatePassed)return;
    box.innerHTML='<div class="loading">載入中…</div>';
    const {data,error}=await db.rpc('class_lunch_wallet_admin_topup_requests',{p_limit:200});
    if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取加值申請失敗：'+error.message)}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>
      '<article class="history-row">'+
        '<div class="history-main"><div class="history-title"><b>'+x.seat_number+'號 '+esc(x.name||'')+'</b><span class="'+(x.status==='approved'?'history-paid':'history-unpaid')+'">'+topupStatusLabel(x.status)+'</span></div>'+
        '<div class="history-items">申請 '+money(x.requested_amount)+(x.actual_amount!=null?' · 實收 '+money(x.actual_amount):'')+'</div>'+
        '<small>'+new Date(x.requested_at).toLocaleString('zh-TW')+'</small></div>'+
        (x.status==='pending'?'<div><button class="small-btn" type="button" data-wallet-topup-approve="'+x.id+'" data-requested="'+x.requested_amount+'">確認／修改實收</button> <button class="small-btn danger" type="button" data-wallet-topup-reject="'+x.id+'">拒絕</button></div>':'')+
      '</article>'
    ).join(''):'<div class="loading">目前沒有加值申請</div>';

    box.querySelectorAll('[data-wallet-topup-reject]').forEach(btn=>btn.addEventListener('click',async()=>{
      const note=prompt('拒絕原因（可留空）：','');
      if(note===null)return;
      const {error}=await db.rpc('class_lunch_wallet_admin_reject_topup',{p_request_id:Number(btn.dataset.walletTopupReject),p_note:note});
      if(error)return toast('拒絕失敗：'+error.message);
      toast('加值申請已拒絕');
      await Promise.all([loadWalletTopups(),loadWalletPendingCounts()]);
    }));

    box.querySelectorAll('[data-wallet-topup-approve]').forEach(btn=>btn.addEventListener('click',async()=>{
      const requested=Number(btn.dataset.requested);
      const raw=prompt('申請金額 '+money(requested)+'\n請輸入實際收到的金額：',String(requested));
      if(raw===null)return;
      const actual=Number(raw);
      if(!Number.isInteger(actual)||actual<=0)return toast('實收金額不正確');
      const {error}=await db.rpc('class_lunch_wallet_admin_approve_topup',{
        p_request_id:Number(btn.dataset.walletTopupApprove),
        p_actual_amount:actual
      });
      if(error)return toast('加值確認失敗：'+error.message);
      toast('實收金額已確認並入帳');
      await Promise.all([loadWalletTopups(),loadWalletBalances(),loadWalletLedger(),loadWalletPendingCounts(),loadWalletDebts()]);
    }));
  }

  async function loadWalletSettlements(){
    const box=byId('walletSettlementsList');
    if(!box||!adminGatePassed)return;
    box.innerHTML='<div class="loading">載入中…</div>';
    const {data,error}=await db.rpc('class_lunch_wallet_admin_settlement_requests',{p_limit:200});
    if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取結清資料失敗：'+error.message)}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>
      '<article class="history-row">'+
        '<div class="history-main"><div class="history-title"><b>'+x.seat_number+'號 '+esc(x.name||'')+'</b><span class="'+(x.status==='completed'?'history-paid':'history-unpaid')+'">'+esc(settlementStatusLabel(x.status))+'</span></div>'+
        '<div class="history-items">申請時餘額 '+money(x.balance_at_request)+' · '+(x.initiated_by==='admin'?'管理端發起':'學生端發起')+'</div>'+
        '<small>'+new Date(x.requested_at).toLocaleString('zh-TW')+'</small></div>'+
        '<div>'+
          (x.status==='student_requested'?'<button class="small-btn" type="button" data-wallet-settle-confirm="'+x.id+'">管理端確認</button> ':'')+
          (x.status==='student_final_confirmed'?'<button class="small-btn danger" type="button" data-wallet-settle-complete="'+x.id+'">正式同意結清</button> ':'')+
          (!['completed','rejected','cancelled'].includes(x.status)?'<button class="small-btn ghost danger" type="button" data-wallet-settle-reject="'+x.id+'">拒絕／取消</button>':'')+
        '</div>'+
      '</article>'
    ).join(''):'<div class="loading">目前沒有結清紀錄</div>';

    box.querySelectorAll('[data-wallet-settle-reject]').forEach(btn=>btn.addEventListener('click',async()=>{
      const note=prompt('拒絕／取消原因（可留空）：','');
      if(note===null)return;
      const {error}=await db.rpc('class_lunch_wallet_admin_reject_settlement',{p_request_id:Number(btn.dataset.walletSettleReject),p_note:note});
      if(error)return toast('處理失敗：'+error.message);
      toast('結清流程已結束');
      await Promise.all([loadWalletSettlements(),loadWalletBalances(),loadWalletDebts()]);
    }));

    box.querySelectorAll('[data-wallet-settle-confirm]').forEach(btn=>btn.addEventListener('click',async()=>{
      const {error}=await db.rpc('class_lunch_wallet_admin_confirm_settlement',{p_request_id:Number(btn.dataset.walletSettleConfirm)});
      if(error)return toast('確認失敗：'+error.message);
      toast('管理端已確認，等待學生最終確認');
      await loadWalletSettlements();
    }));

    box.querySelectorAll('[data-wallet-settle-complete]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('學生已完成最終確認。確定正式啟動結清程序？\n若有正餘額，請先確認已實際退還。'))return;
      const {error}=await db.rpc('class_lunch_wallet_admin_complete_settlement',{p_request_id:Number(btn.dataset.walletSettleComplete)});
      if(error)return toast('結清失敗：'+error.message);
      toast('結清完成');
      await Promise.all([loadWalletSettlements(),loadWalletBalances(),loadWalletLedger(),loadWalletDebts()]);
    }));
  }

  async function loadWalletLedger(){
    const box=byId('walletLedgerList');
    if(!box||!adminGatePassed)return;
    box.innerHTML='<div class="loading">載入中…</div>';
    const {data,error}=await db.rpc('class_lunch_wallet_admin_transactions',{p_limit:300});
    if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取金錢流水失敗：'+error.message)}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>
      '<article class="history-row">'+
        '<div class="history-main"><div class="history-title"><b>'+x.seat_number+'號 '+esc(x.name||'')+' · '+esc(txLabel(x.tx_type))+'</b></div>'+
        '<div class="history-items">'+esc(x.note||'')+(x.order_id?' · 訂單 #'+x.order_id:'')+'</div>'+
        '<small>'+new Date(x.created_at).toLocaleString('zh-TW')+' · 第 '+Number(x.generation||1)+' 期 · 交易後餘額 '+money(x.balance_after)+(x.reversal_of_transaction_id?' · 沖銷 #'+x.reversal_of_transaction_id:'')+'</small></div>'+
        '<strong class="history-price">'+(Number(x.amount)>0?'+':'')+money(x.amount).replace('$-','-$')+'</strong>'+
      '</article>'
    ).join(''):'<div class="loading">目前沒有金錢流水</div>';
  }

  const originalDeleteOrder=window.deleteOrder;
  window.deleteOrder=async function(id){
    if(!confirm('確定刪除這筆訂單？\n已付款訂單會先建立沖銷紀錄，再刪除訂單。'))return;
    try{
      const {error}=await db.rpc('class_lunch_wallet_admin_delete_order',{p_order_id:id});
      if(error){
        if(originalDeleteOrder&&/沒有綁定學生帳號/.test(error.message||''))return originalDeleteOrder(id);
        throw error;
      }
      toast('訂單已刪除');
      await loadOverview();
      window.loadUnpaidOrders?.().catch(()=>{});
      loadWalletLedger().catch(()=>{});
      loadWalletBalances().catch(()=>{});
      loadWalletDebts().catch(()=>{});
    }catch(error){
      toast('刪除失敗：'+error.message);
    }
  };

  window.refundOnsiteDifference=async function(id){
    if(!confirm('確定已實際把差額退還給學生？'))return;
    try{
      const {data,error}=await db.rpc('class_lunch_admin_refund_onsite_difference',{p_order_id:id});
      if(error)throw error;
      toast('已記錄退款 '+money(data?.refunded||0));
      await loadOverview();
      window.loadUnpaidOrders?.().catch(()=>{});
    }catch(error){
      toast('退款失敗：'+error.message);
    }
  };

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
      loadWalletLedger().catch(()=>{});
      loadWalletBalances().catch(()=>{});
    }catch(error){
      toast((n?'付款失敗：':'改未付款失敗：')+error.message);
    }
  };

  byId('walletBalancesRefreshBtn')?.addEventListener('click',loadWalletBalances);
  byId('walletDebtsRefreshBtn')?.addEventListener('click',loadWalletDebts);
  byId('walletTopupsRefreshBtn')?.addEventListener('click',async()=>{await loadWalletTopups();await loadWalletPendingCounts();});
  byId('walletSettlementsRefreshBtn')?.addEventListener('click',loadWalletSettlements);
  byId('walletLedgerRefreshBtn')?.addEventListener('click',loadWalletLedger);

  document.querySelector('[data-tab="wallet-balances"]')?.addEventListener('click',()=>setTimeout(loadWalletBalances,0));
  document.querySelector('[data-tab="wallet-debts"]')?.addEventListener('click',()=>setTimeout(loadWalletDebts,0));
  document.querySelector('[data-tab="wallet-topups"]')?.addEventListener('click',()=>setTimeout(()=>{loadWalletTopups();loadWalletPendingCounts();},0));
  document.querySelector('[data-tab="wallet-settlements"]')?.addEventListener('click',()=>setTimeout(loadWalletSettlements,0));
  document.querySelector('[data-tab="wallet-ledger"]')?.addEventListener('click',()=>setTimeout(loadWalletLedger,0));
  document.querySelector('[data-admin-group="money"]')?.addEventListener('click',()=>setTimeout(loadWalletPendingCounts,0));

  window.loadWalletPendingCounts=loadWalletPendingCounts;
  window.loadWalletDebts=loadWalletDebts;

  setTimeout(()=>{
    if(adminGatePassed){
      loadWalletBalances().catch(()=>{});
      loadWalletDebts().catch(()=>{});
      loadWalletTopups().catch(()=>{});
      loadWalletPendingCounts().catch(()=>{});
      loadWalletSettlements().catch(()=>{});
      loadWalletLedger().catch(()=>{});
    }
  },900);

  // Tiny count-only refresh while admin is open; avoids pulling the full topup list.
  setInterval(()=>{
    if(adminGatePassed)loadWalletPendingCounts().catch(()=>{});
  },60000);
})();