(()=>{
  const byId=id=>document.getElementById(id);
  let walletEnabled=false;
  const isWalletEnabled=()=>walletEnabled&&typeof student!=='undefined'&&student?.seat_number!==undefined&&student?.seat_number!==null;
  let walletSnapshot=null;

  function injectUi(){
    if(!byId('walletBtn')){
      const btn=document.createElement('button');
      btn.id='walletBtn';
      btn.className='hero-action hidden';
      btn.type='button';
      btn.textContent='錢包';
      const history=byId('historyBtn');
      if(history?.parentNode)history.parentNode.insertBefore(btn,history.nextSibling);
      btn.addEventListener('click',openWallet);
    }

    if(!byId('walletDialog')){
      const dialog=document.createElement('dialog');
      dialog.id='walletDialog';
      dialog.className='form-dialog';
      dialog.innerHTML=`
        <div class="history-shell">
          <div class="dialog-head"><div><small>WALLET</small><h2>餐費錢包</h2></div><button type="button" class="close-dialog" id="walletCloseBtn">×</button></div>
          <div class="admin-tabs wallet-student-tabs">
            <button class="tab active" type="button" data-wallet-tab="overview">餘額／儲值</button>
            <button class="tab" type="button" data-wallet-tab="ledger">交易紀錄</button>
            <button class="tab" type="button" data-wallet-tab="settlement">結清帳號</button>
          </div>

          <section id="walletTab-overview" class="wallet-tab-page">
            <div class="stats">
              <div class="stat"><small>目前餘額</small><b id="walletBalance">$0</b></div>
              <div class="stat"><small>狀態</small><b id="walletStatus">—</b></div>
            </div>
            <div id="walletNegativeHint" class="hint hidden">目前餘額為負數，暫時不能使用錢包結帳；現場結帳仍可使用。</div>
            <div class="wallet-payall-grid">
              <div class="wallet-payall-card">
                <small>尚未付款</small>
                <b id="walletUnpaidTotal">$0</b>
                <span id="walletUnpaidCount">0 筆</span>
              </div>
              <button id="walletPayAllBtn" class="wallet-payall-card wallet-payall-action" type="button" disabled>
                <small>一次付清</small>
                <b id="walletPayAllText">沒有待付款</b>
                <span id="walletPayAllAfter">—</span>
              </button>
            </div>
            <div id="walletPayAllHint" class="hint hidden"></div>
            <div class="account-divider"></div>
            <h3>申請儲值</h3>
            <form id="walletTopupForm">
              <label>想儲值的金額<input id="walletTopupAmount" type="number" min="1" max="100000" step="1" inputmode="numeric" required></label>
              <div class="dialog-actions"><button class="primary" type="submit">送出儲值申請</button></div>
            </form>
            <div id="walletTopupList" class="history-list"></div>
          </section>

          <section id="walletTab-ledger" class="wallet-tab-page hidden">
            <div class="section-head"><h3>交易紀錄</h3><button id="walletRefreshBtn" class="small-btn" type="button">重新整理</button></div>
            <div id="walletTxList" class="history-list"></div>
          </section>

          <section id="walletTab-settlement" class="wallet-tab-page hidden">
            <h3>結清帳號</h3>
            <p class="hint">餘額為負數時不能結清。結清申請送出後，必須經過管理端確認、學生最終確認，再由管理端正式完成。</p>
            <div id="walletSettlementArea"></div>
          </section>
        </div>`;
      document.body.appendChild(dialog);
      byId('walletCloseBtn').addEventListener('click',()=>dialog.close());
      byId('walletRefreshBtn').addEventListener('click',refreshWallet);
      byId('walletTopupForm').addEventListener('submit',submitTopup);
      byId('walletPayAllBtn').addEventListener('click',payAllUnpaid);
      dialog.querySelectorAll('[data-wallet-tab]').forEach(btn=>btn.addEventListener('click',()=>switchWalletTab(btn.dataset.walletTab)));
    }

    if(!byId('walletPaymentBox')){
      const form=byId('orderDialogForm');
      const actions=form?.querySelector('.dialog-actions');
      if(form&&actions){
        const box=document.createElement('section');
        box.id='walletPaymentBox';
        box.className='notification-settings hidden';
        box.innerHTML=`
          <div>
            <b>付款方式</b>
            <p id="walletCheckoutBalance" class="hint">錢包餘額載入中…</p>
          </div>
          <label class="check-row"><input type="radio" name="walletPaymentMethod" value="wallet"> 錢包結帳</label>
          <label class="check-row"><input type="radio" name="walletPaymentMethod" value="onsite" checked> 現場結帳</label>`;
        form.insertBefore(box,actions);
      }
    }
  }

  function switchWalletTab(tab){
    document.querySelectorAll('[data-wallet-tab]').forEach(btn=>btn.classList.toggle('active',btn.dataset.walletTab===tab));
    document.querySelectorAll('.wallet-tab-page').forEach(page=>page.classList.add('hidden'));
    byId('walletTab-'+tab)?.classList.remove('hidden');
  }

  async function refreshVisibility(){
    injectUi();
    walletEnabled=false;
    if(typeof student!=='undefined'&&student?.seat_number!==undefined&&student?.seat_number!==null){
      const {data,error}=await db.rpc('class_lunch_wallet_me');
      if(!error&&data){
        walletEnabled=true;
        walletSnapshot=data;
      }
    }
    byId('walletBtn')?.classList.toggle('hidden',!walletEnabled);
    if(!walletEnabled){
      byId('walletPaymentBox')?.classList.add('hidden');
      if(byId('walletDialog')?.open)byId('walletDialog').close();
      return;
    }
    if(byId('orderDialog')?.open)await refreshCheckout();
  }

  async function fetchWallet(){
    const {data,error}=await db.rpc('class_lunch_wallet_me');
    if(error)throw error;
    walletSnapshot=data;
    return data;
  }

  async function refreshCheckout(){
    const box=byId('walletPaymentBox');
    if(!box||!isWalletEnabled())return;
    box.classList.remove('hidden');
    try{
      const w=await fetchWallet();
      const walletRadio=box.querySelector('input[value="wallet"]');
      const onsiteRadio=box.querySelector('input[value="onsite"]');
      const blocked=Number(w.balance)<0||w.status!=='active';
      walletRadio.disabled=blocked;
      if(blocked&&walletRadio.checked)onsiteRadio.checked=true;
      byId('walletCheckoutBalance').textContent='目前餘額：'+money(w.balance)+(blocked?' · 暫時不能使用錢包結帳':'');
    }catch(error){
      const walletRadio=box.querySelector('input[value="wallet"]');
      walletRadio.disabled=true;
      box.querySelector('input[value="onsite"]').checked=true;
      byId('walletCheckoutBalance').textContent='錢包狀態讀取失敗，請使用現場結帳';
    }
  }

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

  function topupStatus(status){
    return ({pending:'待管理員確認',approved:'已入帳',cancelled:'已取消',rejected:'已拒絕'})[status]||status;
  }

  function settlementStatus(status){
    return ({
      student_requested:'等待管理端確認',
      admin_started:'管理端已發起',
      admin_confirmed:'等待學生最終確認',
      student_final_confirmed:'等待管理端正式完成',
      completed:'已結清',
      rejected:'已拒絕',
      cancelled:'已取消'
    })[status]||status;
  }

  async function refreshWallet(){
    if(!isWalletEnabled())return;
    try{
      const [wRes,txRes,topupRes,settleRes,unpaidRes]=await Promise.all([
        db.rpc('class_lunch_wallet_me'),
        db.rpc('class_lunch_wallet_transactions_my',{p_limit:100}),
        db.rpc('class_lunch_wallet_topups_my'),
        db.rpc('class_lunch_wallet_settlement_my'),
        db.rpc('class_lunch_wallet_unpaid_summary')
      ]);
      const err=wRes.error||txRes.error||topupRes.error||settleRes.error||unpaidRes.error;
      if(err)throw err;
      walletSnapshot=wRes.data;
      byId('walletBalance').textContent=money(walletSnapshot.balance);
      byId('walletStatus').textContent=walletSnapshot.status==='active'?'使用中':walletSnapshot.status==='settlement_pending'?'結清處理中':'已結清';
      byId('walletNegativeHint').classList.toggle('hidden',Number(walletSnapshot.balance)>=0);

      const unpaid=unpaidRes.data||{};
      byId('walletUnpaidTotal').textContent=money(Number(unpaid.unpaid_total||0));
      byId('walletUnpaidCount').textContent=Number(unpaid.unpaid_count||0)+' 筆';
      const payAllBtn=byId('walletPayAllBtn');
      payAllBtn.disabled=!unpaid.can_pay_all;
      payAllBtn.dataset.total=String(Number(unpaid.unpaid_total||0));
      payAllBtn.dataset.count=String(Number(unpaid.unpaid_count||0));
      payAllBtn.dataset.after=String(Number(unpaid.balance_after||walletSnapshot.balance||0));
      byId('walletPayAllText').textContent=unpaid.can_pay_all?'立即付款':Number(unpaid.unpaid_count||0)?'暫時不能付款':'沒有待付款';
      byId('walletPayAllAfter').textContent=Number(unpaid.unpaid_count||0)
        ?'付款後 '+money(Number(unpaid.balance_after||0))
        :'目前已付清';
      const payAllHint=byId('walletPayAllHint');
      payAllHint.textContent=unpaid.blocked_reason||'';
      payAllHint.classList.toggle('hidden',!unpaid.blocked_reason);

      const txs=txRes.data||[];
      byId('walletTxList').innerHTML=txs.length?txs.map(x=>`
        <article class="history-row">
          <div class="history-main"><b>${txLabel(x.tx_type)}</b><small>${new Date(x.created_at).toLocaleString('zh-TW')}</small><small>${x.note||''}</small></div>
          <strong class="history-price">${Number(x.amount)>0?'+':''}${money(x.amount).replace('$-','-$')}</strong>
        </article>`).join(''):'<div class="history-empty"><b>目前沒有交易紀錄</b></div>';

      const topups=topupRes.data||[];
      byId('walletTopupList').innerHTML=topups.length?topups.map(x=>`
        <article class="history-row">
          <div class="history-main"><b>儲值申請 ${money(x.requested_amount)}</b><small>${topupStatus(x.status)}${x.actual_amount!=null?' · 實收 '+money(x.actual_amount):''}</small></div>
          ${x.status==='pending'?'<div><button class="small-btn danger" type="button" data-cancel-topup="'+x.id+'">取消申請</button></div>':''}
        </article>`).join(''):'';

      byId('walletTopupList')?.querySelectorAll('[data-cancel-topup]').forEach(btn=>btn.addEventListener('click',async()=>{
        if(!confirm('確定取消這筆儲值申請？'))return;
        const {error}=await db.rpc('class_lunch_wallet_cancel_topup',{p_request_id:Number(btn.dataset.cancelTopup)});
        if(error)return toast('取消儲值申請失敗：'+error.message);
        toast('儲值申請已取消');
        await refreshWallet();
      }));

      renderSettlement(settleRes.data);
      if(byId('orderDialog')?.open)refreshCheckout();
    }catch(error){
      toast('錢包讀取失敗：'+error.message);
    }
  }

  function renderSettlement(req){
    const area=byId('walletSettlementArea');
    if(!area)return;
    if(walletSnapshot?.status==='settled'){
      area.innerHTML='<div class="order-status paid"><b>此錢包已結清</b></div>';
      return;
    }
    if(!req||['completed','rejected','cancelled'].includes(req.status)){
      const disabled=Number(walletSnapshot?.balance)<0?'disabled':'';
      area.innerHTML=`
        <form id="walletSettlementStartForm">
          <label>座號<input id="walletSettleSeat" type="number" value="${student?.seat_number??''}" required></label>
          <label>密碼<input id="walletSettlePassword" type="password" required autocomplete="current-password"></label>
          <div class="dialog-actions"><button class="danger" type="submit" ${disabled}>申請結清</button></div>
        </form>`;
      byId('walletSettlementStartForm')?.addEventListener('submit',startSettlement);
      return;
    }
    area.innerHTML='<div class="order-status pending"><b>'+settlementStatus(req.status)+'</b><small>申請時餘額：'+money(req.balance_at_request)+'</small></div>';
    if(req.status==='admin_started'){
      area.insertAdjacentHTML('beforeend',`
        <form id="walletAdminStartedConfirmForm">
          <label>座號<input id="walletAdminStartedSeat" type="number" value="${student?.seat_number??''}" required></label>
          <label>密碼<input id="walletAdminStartedPassword" type="password" required autocomplete="current-password"></label>
          <div class="dialog-actions"><button class="primary" type="submit">確認管理端發起結清</button></div>
        </form>`);
      byId('walletAdminStartedConfirmForm')?.addEventListener('submit',confirmAdminStartedSettlement);
    }
    if(['student_requested','admin_started','admin_confirmed'].includes(req.status)){
      area.insertAdjacentHTML('beforeend','<div class="dialog-actions"><button id="walletSettlementCancelBtn" class="ghost danger" type="button">取消結清</button></div>');
      byId('walletSettlementCancelBtn')?.addEventListener('click',()=>cancelSettlement(req.id));
    }
    if(req.status==='admin_confirmed'){
      area.insertAdjacentHTML('beforeend',`
        <form id="walletSettlementFinalForm">
          <label>座號<input id="walletFinalSeat" type="number" value="${student?.seat_number??''}" required></label>
          <label>姓名<input id="walletFinalName" required></label>
          <label>密碼<input id="walletFinalPassword" type="password" required autocomplete="current-password"></label>
          <div class="dialog-actions"><button class="danger" type="submit">最終確認結清</button></div>
        </form>`);
      byId('walletFinalName').value=student?.name||'';
      byId('walletSettlementFinalForm')?.addEventListener('submit',finalSettlement);
    }
  }

  async function reauth(seat,password){
    const n=Number(seat);
    const currentSeat=Number(student?.seat_number);
    if(!Number.isInteger(currentSeat)||n!==currentSeat)throw new Error('座號不正確');

    if(currentSeat===0){
      const {data,error}=await db.functions.invoke('class-lunch-teacher-login',{body:{account:'tch',password}});
      if(error||data?.error||!data?.access_token||!data?.refresh_token)throw new Error('帳號或密碼錯誤');
      const {error:setError}=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
      if(setError)throw new Error('重新驗證失敗');
      return;
    }

    const {error}=await db.auth.signInWithPassword({email:internalEmail(n),password:authPassword(password)});
    if(error)throw new Error('座號或密碼錯誤');
  }

  async function startSettlement(e){
    e.preventDefault();
    const seat=Number(byId('walletSettleSeat').value),password=byId('walletSettlePassword').value;
    try{
      await reauth(seat,password);
      const {error}=await db.rpc('class_lunch_wallet_request_settlement');
      if(error)throw error;
      toast('結清申請已送出，等待管理端確認');
      await refreshWallet();
    }catch(error){toast('結清申請失敗：'+error.message)}
  }

  async function confirmAdminStartedSettlement(e){
    e.preventDefault();
    const seat=Number(byId('walletAdminStartedSeat').value),password=byId('walletAdminStartedPassword').value;
    try{
      await reauth(seat,password);
      const {data:req,error:reqError}=await db.rpc('class_lunch_wallet_settlement_my');
      if(reqError)throw reqError;
      if(!req?.id)throw new Error('找不到結清申請');
      const {error}=await db.rpc('class_lunch_wallet_student_confirm_admin_settlement',{p_request_id:req.id,p_seat:seat});
      if(error)throw error;
      toast('已確認管理端發起的結清，等待管理端再次確認');
      await refreshWallet();
    }catch(error){toast('確認失敗：'+error.message)}
  }

  async function cancelSettlement(id){
    if(!confirm('確定取消目前的結清流程？'))return;
    const {error}=await db.rpc('class_lunch_wallet_cancel_settlement',{p_request_id:Number(id)});
    if(error)return toast('取消結清失敗：'+error.message);
    toast('結清流程已取消');
    await refreshWallet();
  }

  async function finalSettlement(e){
    e.preventDefault();
    const seat=Number(byId('walletFinalSeat').value),name=byId('walletFinalName').value.trim(),password=byId('walletFinalPassword').value;
    try{
      await reauth(seat,password);
      const {data:req,error:reqError}=await db.rpc('class_lunch_wallet_settlement_my');
      if(reqError)throw reqError;
      if(!req?.id)throw new Error('找不到結清申請');
      const {error}=await db.rpc('class_lunch_wallet_student_final_confirm_settlement',{p_request_id:req.id,p_seat:seat,p_name:name});
      if(error)throw error;
      toast('已完成學生最終確認，等待管理端正式結清');
      await refreshWallet();
    }catch(error){toast('最終確認失敗：'+error.message)}
  }

  async function payAllUnpaid(){
    const btn=byId('walletPayAllBtn');
    if(!btn||btn.disabled)return;
    const count=Number(btn.dataset.count||0);
    const total=Number(btn.dataset.total||0);
    const after=Number(btn.dataset.after||0);
    if(!confirm('確定用錢包一次支付 '+count+' 筆未付款訂單，共 '+money(total)+'？\n付款後餘額：'+money(after)))return;
    btn.disabled=true;
    const original=byId('walletPayAllText').textContent;
    byId('walletPayAllText').textContent='付款中…';
    try{
      const {data,error}=await db.rpc('class_lunch_wallet_pay_all_unpaid');
      if(error)throw error;
      toast('已支付 '+Number(data?.paid_count||count)+' 筆訂單，共 '+money(Number(data?.paid_total||total)));
      await Promise.all([refreshWallet(),loadSessions()]);
    }catch(error){
      toast('一次付清失敗：'+error.message);
      await refreshWallet().catch(()=>{});
    }finally{
      if(byId('walletPayAllText')?.textContent==='付款中…')byId('walletPayAllText').textContent=original;
    }
  }

  async function submitTopup(e){
    e.preventDefault();
    const amount=Number(byId('walletTopupAmount').value);
    if(!Number.isInteger(amount)||amount<=0)return toast('請輸入正確儲值金額');
    const btn=e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled=true;
    try{
      const {error}=await db.rpc('class_lunch_wallet_request_topup',{p_amount:amount});
      if(error)throw error;
      byId('walletTopupAmount').value='';
      toast('儲值申請已送出');
      await refreshWallet();
    }catch(error){toast('儲值申請失敗：'+error.message)}
    finally{btn.disabled=false}
  }

  async function openWallet(){
    if(!isWalletEnabled())return;
    switchWalletTab('overview');
    byId('walletDialog').showModal();
    await refreshWallet();
  }

  async function handleWalletCheckout(e){
    if(!isWalletEnabled())return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if(!editingSessionId)return;

    const note=byId('orderNote').value.trim();
    const b=e.currentTarget.querySelector('button[type="submit"]');
    const method=e.currentTarget.querySelector('input[name="walletPaymentMethod"]:checked')?.value||'onsite';
    b.disabled=true;b.textContent='儲存中…';
    try{
      const structured=getTestItemsForSession().length>0;
      let result;
      if(structured){
        const counts=new Map();
        for(const raw of testSelections.filter(Boolean)){
          const id=Number(raw);counts.set(id,(counts.get(id)||0)+1);
        }
        if(!counts.size)throw new Error('至少選一個品項');
        const items=[...counts.entries()].map(([menu_item_id,qty])=>({menu_item_id,qty}));
        result=await db.rpc('place_class_lunch_order_v6',{
          p_session_id:editingSessionId,p_items:items,p_note:note,p_payment_method:method
        });
      }else{
        const item=byId('orderItem').value.trim(),amountRaw=byId('orderAmount').value.trim(),amount=Number(amountRaw);
        if(!item)throw new Error('請輸入品項');
        if(amountRaw===''||!Number.isInteger(amount)||amount<0||amount>10000)throw new Error('請輸入 0～10000 的整數金額');
        result=await db.rpc('place_class_lunch_order_free_v6',{
          p_session_id:editingSessionId,p_item_name:item,p_unit_price:amount,p_note:note,p_payment_method:method
        });
      }
      if(result.error)throw result.error;
      byId('orderDialog').close();
      toast(method==='wallet'?'訂單已儲存並由錢包結帳':'訂單已儲存，現場結帳');
      await loadSessions();
      await refreshWallet().catch(()=>{});
    }catch(error){
      toast('送出失敗：'+error.message);
      await refreshCheckout().catch(()=>{});
    }finally{
      b.disabled=false;b.textContent='儲存訂單';
    }
  }

  function observeOrderDialog(){
    const dialog=byId('orderDialog');
    if(!dialog)return;
    new MutationObserver(()=>{if(dialog.open&&isWalletEnabled())refreshCheckout()})
      .observe(dialog,{attributes:true,attributeFilter:['open']});
    byId('orderDialogForm')?.addEventListener('submit',handleWalletCheckout,true);
  }

  injectUi();
  observeOrderDialog();
  db.auth.onAuthStateChange(()=>setTimeout(refreshVisibility,500));
  setTimeout(refreshVisibility,700);
})();