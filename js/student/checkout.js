async function openOrderEditor(sessionId){
  if(!(await ensureLatestVersionBeforeOrdering()))return;
  const s=sessions.find(x=>x.id===sessionId),o=orders.find(x=>x.meal_session_id===sessionId);
  if(!s||expired(s)||o?.paid)return;
  editingSessionId=sessionId;$('orderDialogTitle').textContent=s.menu_templates?.name||'訂餐';$('orderDialogDate').textContent=fmtDate(s.meal_date);$('orderNote').value=o?.note||'';
  const items=getTestItemsForSession(),hasStructuredItems=items.length>0;
  $('freeOrderFields').classList.toggle('hidden',hasStructuredItems);$('testOrderFields').classList.toggle('hidden',!hasStructuredItems);
  if(hasStructuredItems){
    const existing=o?(orderItemsByOrder[o.id]||[]):[];
    testSelections=[];
    if(existing.length){
      for(const row of existing){
        const cfg=row.configuration||{};
        const base={
          menu_item_id:Number(row.menu_item_id),
          variant_id:row.variant_id??cfg.variant_id??null,
          option_ids:Array.isArray(cfg.option_ids)?cfg.option_ids.map(Number):[]
        };
        for(let q=0;q<Number(row.quantity||1);q++)testSelections.push({...base,option_ids:[...base.option_ids]});
      }
    }else if(o?.menu_item_id){
      testSelections=[newConfiguredSelection(o.menu_item_id)];
    }
    testSelections.push(newConfiguredSelection());
    renderTestOrderRows();
  }else{
    $('orderItem').value=o?.item_name||'';$('orderAmount').value=o?.unit_price??'';
  }
  $('orderDialog').showModal();
}
$('orderDialogForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!editingSessionId)return;
  const note=$('orderNote').value.trim(),b=e.currentTarget.querySelector('button[type="submit"]');
  b.disabled=true;b.textContent='儲存中…';
  let error=null;
  const hasStructuredItems=getTestItemsForSession().length>0;
  if(hasStructuredItems){
    let items;
    try{items=buildStructuredOrderPayload(true)}
    catch(err){b.disabled=false;b.textContent='儲存訂單';return toast(err.message)}
    const r=await db.rpc('place_class_lunch_order_v7',{p_session_id:editingSessionId,p_items:items,p_note:note,p_payment_method:'onsite'});error=r.error;
  }else{
    const item=$('orderItem').value.trim(),amountRaw=$('orderAmount').value.trim(),amount=Number(amountRaw);
    if(!item){b.disabled=false;b.textContent='儲存訂單';return toast('請輸入品項')}
    if(amountRaw===''||!Number.isInteger(amount)||amount<0||amount>10000){b.disabled=false;b.textContent='儲存訂單';return toast('請輸入 0～10000 的整數金額')}
    const r=await db.rpc('place_class_lunch_order_free_v6',{p_session_id:editingSessionId,p_item_name:item,p_unit_price:amount,p_note:note,p_payment_method:'onsite'});error=r.error;
  }
  b.disabled=false;b.textContent='儲存訂單';
  if(error)return toast('送出失敗：'+error.message);
  $('orderDialog').close();
  if(backupOrderFlow){
    await refreshOwnOrders();
    await advanceBackupOrderFlow();
  }else{
    toast('訂單已儲存');await refreshOwnOrders();
  }
});
async function cancelOrder(sessionId){
  if(!confirm('確定取消這筆訂單？'))return;
  const{error}=await db.rpc('cancel_class_lunch_order_v3',{p_session_id:sessionId});
  if(error)return toast('取消失敗：'+error.message);
  toast('訂單已取消');await refreshOwnOrders();
}
async function openHistory(){
  if(!student)return;
  stopStudentRealtime();
  $('historyDialog').showModal();
  $('historyList').innerHTML='<div class="loading">載入手機快取…</div>';

  let cached=[];
  try{
    cached=await getCachedHistory(student.id);
    if(cached.length)renderHistoryList(cached);
    else $('historyList').innerHTML='<div class="loading">同步歷史訂單…</div>';
  }catch(error){
    console.warn('history_cache_read_failed',error);
  }

  try{
    const fresh=await syncHistoryDelta();
    renderHistoryList(fresh);
  }catch(error){
    console.error('history_delta_sync_failed',error);
    if(cached.length){
      toast('歷史同步失敗，先顯示手機上的快取');
    }else{
      $('historyList').innerHTML='<div class="loading">歷史訂單暫時無法同步</div>';
      toast('歷史訂單同步失敗');
    }
  }
}
function openImage(u){$('largeImage').src=u;$('imageModal').classList.remove('hidden');document.body.style.overflow='hidden'}
function closeImage(e){if(e&&e.target!==$('imageModal')&&!e.target.classList.contains('close'))return;$('imageModal').classList.add('hidden');$('largeImage').src='';document.body.style.overflow=''}
document.addEventListener('click',e=>{const p=e.target.closest('.photo-button');if(p)openImage(p.dataset.imageUrl)});
