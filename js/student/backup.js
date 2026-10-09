function classLunchBackupFlowActive(){return !!backupOrderFlow}
window.classLunchBackupFlowActive=classLunchBackupFlowActive;
async function startBackupOrderFlow(groupId){
  if(!(await ensureLatestVersionBeforeOrdering()))return;
  const steps=sessions.filter(s=>Number(s.backup_group_id)===Number(groupId)&&s.restaurant_status!=='failed')
    .sort((a,b)=>String(a.backup_slot||'').localeCompare(String(b.backup_slot||''))||Number(a.id)-Number(b.id));
  if(!steps.length)return toast('目前沒有可用的備用菜單');
  const group=steps[0].meal_session_groups||{};
  if(group.status!=='collecting')return toast('管理員已開始跟餐廳確認，現在不能修改');
  backupOrderFlow={groupId:Number(groupId),steps,index:0};
  await openOrderEditor(steps[0].id);
}
window.startBackupOrderFlow=startBackupOrderFlow;
async function advanceBackupOrderFlow(){
  if(!backupOrderFlow)return;
  backupOrderFlow.index++;
  if(backupOrderFlow.index<backupOrderFlow.steps.length){
    const next=backupOrderFlow.steps[backupOrderFlow.index];
    toast('A 已完成，接著點 '+(next.backup_slot||'B')+' 菜單');
    await openOrderEditor(next.id);
    return;
  }
  const groupId=backupOrderFlow.groupId;
  backupOrderFlow=null;
  await showBackupPaymentDialog(groupId);
}
function ensureBackupPaymentDialog(){
  let dialog=$('backupPaymentDialog');
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.id='backupPaymentDialog';dialog.className='form-dialog';
  dialog.innerHTML='<form id="backupPaymentForm"><div class="dialog-head"><div><small>最後一步</small><h2>A / B 付款方式</h2></div><button type="button" class="close-dialog" data-close="backupPaymentDialog">×</button></div><p class="hint">現在只記錄付款方式，不會扣款。管理員確認餐廳接單後，只會按最後採用的菜單金額結算。</p><div id="backupWalletHint" class="hint"></div><label class="check-row"><input type="radio" name="backupPaymentMethod" value="wallet"> 錢包</label><label class="check-row"><input type="radio" name="backupPaymentMethod" value="onsite" checked> 現場付款</label><div class="dialog-actions"><button type="button" class="ghost" data-close="backupPaymentDialog">取消</button><button class="primary" type="submit">完成訂餐</button></div></form>';
  document.body.appendChild(dialog);
  dialog.querySelectorAll('[data-close="backupPaymentDialog"]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  $('backupPaymentForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const groupId=Number(dialog.dataset.groupId),method=e.currentTarget.querySelector('input[name="backupPaymentMethod"]:checked')?.value||'onsite';
    const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;btn.textContent='儲存中…';
    try{
      const{error}=await db.rpc('class_lunch_set_backup_payment_method',{p_group_id:groupId,p_payment_method:method});
      if(error)throw error;
      dialog.close();toast('A / B 都完成了，等待管理員確認採用菜單');
      await refreshOwnOrders();
      window.refreshWalletVisibility?.().catch?.(()=>{});
    }catch(error){toast('付款方式儲存失敗：'+error.message)}
    finally{btn.disabled=false;btn.textContent='完成訂餐'}
  });
  return dialog;
}
async function showBackupPaymentDialog(groupId){
  await refreshOwnOrders();
  const dialog=ensureBackupPaymentDialog();
  dialog.dataset.groupId=String(groupId);
  const walletRadio=dialog.querySelector('input[value="wallet"]'),onsite=dialog.querySelector('input[value="onsite"]');
  walletRadio.disabled=true;onsite.checked=true;
  $('backupWalletHint').textContent='正在讀取錢包狀態…';
  try{
    const{data,error}=await db.rpc('class_lunch_wallet_me');
    if(error||!data)throw error||new Error('wallet unavailable');
    const usable=data.status==='active'&&Number(data.balance)>0;
    walletRadio.disabled=!usable;
    $('backupWalletHint').textContent=usable?'目前錢包餘額：'+money(data.balance)+'；實際扣款會等管理員確認餐廳接單後才發生。':'目前錢包不可使用，請選現場付款。';
  }catch{
    $('backupWalletHint').textContent='目前沒有可用錢包，請選現場付款。';
  }
  dialog.showModal();
}
