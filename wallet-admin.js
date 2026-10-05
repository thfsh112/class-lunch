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
      const enabled=Number(x.seat_number)===99;
      return '<div class="seat-card '+(Number(x.balance)<0?'seat-unpaid':'seat-paid')+'">'+
        '<b>'+x.seat_number+'號 '+esc(x.name||'')+'</b>'+
        '<span>'+walletStatusLabel(x.status)+(enabled?' · 測試開放':' · 尚未開放')+'</span>'+
        '<strong>'+money(x.balance)+'</strong>'+
        (enabled&&x.status==='active'?'<div><button class="small-btn danger" type="button" data-wallet-settle-start="'+x.student_id+'">發起結清</button></div>':'')+
      '</div>';
    }).join('')+'</div>':'<div class="loading">目前沒有錢包資料</div>';

    box.querySelectorAll('[data-wallet-settle-start]').forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('確定由管理端對 99 號發起結清？'))return;
      const {error}=await db.rpc('class_lunch_wallet_admin_start_settlement',{p_student_id:btn.dataset.walletSettleStart});
      if(error)return toast('發起結清失敗：'+error.message);
      toast('已發起結清，等待學生最終確認');
      await Promise.all([loadWalletBalances(),loadWalletSettlements()]);
    }));
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
        (x.status==='pending'?'<div><button class="small-btn" type="button" data-wallet-topup-approve="'+x.id+'" data-requested="'+x.requested_amount+'">確認／修改實收</button></div>':'')+
      '</article>'
    ).join(''):'<div class="loading">目前沒有加值申請</div>';

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
      await Promise.all([loadWalletTopups(),loadWalletBalances(),loadWalletLedger()]);
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
          (x.status==='student_final_confirmed'?'<button class="small-btn danger" type="button" data-wallet-settle-complete="'+x.id+'">正式同意結清</button>':'')+
        '</div>'+
      '</article>'
    ).join(''):'<div class="loading">目前沒有結清紀錄</div>';

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
      await Promise.all([loadWalletSettlements(),loadWalletBalances(),loadWalletLedger()]);
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
        '<small>'+new Date(x.created_at).toLocaleString('zh-TW')+' · 交易後餘額 '+money(x.balance_after)+'</small></div>'+
        '<strong class="history-price">'+(Number(x.amount)>0?'+':'')+money(x.amount).replace('$-','-$')+'</strong>'+
      '</article>'
    ).join(''):'<div class="loading">目前沒有金錢流水</div>';
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
      loadWalletLedger().catch(()=>{});
      loadWalletBalances().catch(()=>{});
    }catch(error){
      toast((n?'付款失敗：':'改未付款失敗：')+error.message);
    }
  };

  byId('walletBalancesRefreshBtn')?.addEventListener('click',loadWalletBalances);
  byId('walletTopupsRefreshBtn')?.addEventListener('click',loadWalletTopups);
  byId('walletSettlementsRefreshBtn')?.addEventListener('click',loadWalletSettlements);
  byId('walletLedgerRefreshBtn')?.addEventListener('click',loadWalletLedger);

  document.querySelector('[data-tab="wallet-balances"]')?.addEventListener('click',()=>setTimeout(loadWalletBalances,0));
  document.querySelector('[data-tab="wallet-topups"]')?.addEventListener('click',()=>setTimeout(loadWalletTopups,0));
  document.querySelector('[data-tab="wallet-settlements"]')?.addEventListener('click',()=>setTimeout(loadWalletSettlements,0));
  document.querySelector('[data-tab="wallet-ledger"]')?.addEventListener('click',()=>setTimeout(loadWalletLedger,0));

  setTimeout(()=>{
    if(adminGatePassed){
      loadWalletBalances().catch(()=>{});
      loadWalletTopups().catch(()=>{});
      loadWalletSettlements().catch(()=>{});
      loadWalletLedger().catch(()=>{});
    }
  },900);
})();