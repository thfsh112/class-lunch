async function openMarketPriceDialog(orderId,seat){
  editingMarketOrderId=orderId;
  $('marketPriceSeat').textContent=seat+'號訂單';
  const{data,error}=await db.from('order_items')
    .select('id,quantity,unit_price,is_market_price,market_price_amount,item_name_snapshot,menu_items(name)')
    .eq('order_id',orderId)
    .order('id');
  if(error)return toast('讀取時價品項失敗：'+error.message);
  const rows=data||[];
  marketOrderItems=rows.filter(x=>x.is_market_price);
  marketFixedTotal=rows.reduce((s,x)=>s+Number(x.unit_price||0)*Number(x.quantity||1),0);
  if(!marketOrderItems.length)return toast('這張訂單沒有時價品項');
  $('marketPriceRows').innerHTML=marketOrderItems.map(x=>
    '<label class="market-price-row"><span><b>'+esc(x.item_name_snapshot||x.menu_items?.name||'時價品項')+'</b><small>數量 '+Number(x.quantity||1)+' · 固定加價 '+money(x.unit_price||0)+'</small></span>'+
    '<input type="number" min="0" max="10000" step="1" data-market-id="'+x.id+'" value="'+(x.market_price_amount==null?'':Number(x.market_price_amount))+'" placeholder="每份實際金額"></label>'
  ).join('');
  $('marketPriceRows').querySelectorAll('input').forEach(el=>el.addEventListener('input',updateMarketPricePreview));
  updateMarketPricePreview();
  $('marketPriceDialog').showModal();
}
function updateMarketPricePreview(){
  let total=marketFixedTotal,hasBlank=false;
  for(const row of marketOrderItems){
    const input=$('marketPriceRows').querySelector('[data-market-id="'+row.id+'"]');
    const raw=input?.value?.trim()||'';
    if(!raw){hasBlank=true;continue}
    total+=Number(raw||0)*Number(row.quantity||1);
  }
  $('marketPricePreview').textContent=money(total)+(hasBlank?' ＋ 尚未設定時價':'');
}
$('marketPriceForm').addEventListener('submit',async e=>{
  e.preventDefault();if(!editingMarketOrderId)return;
  const prices=marketOrderItems.map(row=>{
    const input=$('marketPriceRows').querySelector('[data-market-id="'+row.id+'"]');
    const raw=input?.value?.trim()||'';
    return {order_item_id:row.id,amount:raw===''?null:Number(raw)};
  });
  if(prices.some(x=>x.amount!=null&&(!Number.isInteger(x.amount)||x.amount<0||x.amount>10000)))return toast('時價金額格式不正確');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;b.textContent='儲存中…';
  const{error}=await db.rpc('set_class_lunch_market_prices',{p_order_id:editingMarketOrderId,p_prices:prices});
  b.disabled=false;b.textContent='儲存時價';
  if(error)return toast('時價更新失敗：'+error.message);
  $('marketPriceDialog').close();toast('時價已更新');await loadOverview();
});

async function togglePaid(id,n){
  const fn=n?'class_lunch_wallet_admin_mark_onsite_paid':'class_lunch_wallet_admin_mark_unpaid';
  const {error}=await db.rpc(fn,{p_order_id:id});
  if(error)return toast((n?'付款失敗：':'改未付款失敗：')+error.message);
  toast(n?'已付款':'已改未付款');
  await loadOverview();
  if(!$('tab-unpaid')?.classList.contains('hidden'))await loadUnpaidOrders();
}
async function deleteOrder(id){
  if(!confirm('確定刪除這筆訂單？\n若有付款紀錄會先建立沖銷紀錄。'))return;
  const{error}=await db.rpc('class_lunch_wallet_admin_delete_order',{p_order_id:id});
  if(error)return toast('刪除失敗：'+error.message);
  toast('已刪除');
  await loadOverview();
  if(!$('tab-unpaid')?.classList.contains('hidden'))await loadUnpaidOrders();
}

function fmtAdminTime(v){
  return new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function orderActorLabel(l,row){
  if(l.actor_type==='admin')return '管理員';
  const st=students.find(s=>s.auth_user_id===l.actor_user_id);
  if(st)return st.seat_number+'號 '+(st.name||'');
  const seat=Number(row?.student_name);
  if(seat)return seat+'號';
  return l.actor_email||'系統';
}
function readableValue(v){
  if(v===null||v===undefined||v==='')return '空白';
  return String(v);
}
function describeOrderChange(l,itemNames){
  const old=l.detail?.old||{},now=l.detail?.new||{};
  if(l.entity_type==='orders'){
    const row=l.action==='delete'?old:now;
    if(l.action==='insert')return {row,title:'建立訂單',detail:(row.item_name||'未記錄品項')+' · '+money(row.unit_price)+(row.note?' · 備註：'+row.note:'')};
    if(l.action==='delete')return {row,title:'刪除訂單',detail:(row.item_name||'未記錄品項')+' · '+money(row.unit_price)+(row.note?' · 備註：'+row.note:'')};
    const diff=[];
    if(old.item_name!==now.item_name)diff.push('餐點：'+readableValue(old.item_name)+' → '+readableValue(now.item_name));
    if(Number(old.unit_price||0)!==Number(now.unit_price||0))diff.push('金額：'+money(old.unit_price)+' → '+money(now.unit_price));
    if(String(old.note||'')!==String(now.note||''))diff.push('備註：'+readableValue(old.note)+' → '+readableValue(now.note));
    if(Boolean(old.paid)!==Boolean(now.paid))diff.push('付款：'+(old.paid?'已付款':'未付款')+' → '+(now.paid?'已付款':'未付款'));
    if(Number(old.quantity||1)!==Number(now.quantity||1))diff.push('數量：'+Number(old.quantity||1)+' → '+Number(now.quantity||1));
    if(String(old.order_date||'')!==String(now.order_date||''))diff.push('日期：'+readableValue(old.order_date)+' → '+readableValue(now.order_date));
    if(!diff.length)return null;
    return {row:now,title:'修改訂單',detail:diff.join('；')};
  }
  const row=l.action==='delete'?old:now;
  const oldName=itemNames.get(Number(old.menu_item_id))||('品項 #'+readableValue(old.menu_item_id));
  const newName=itemNames.get(Number(now.menu_item_id))||('品項 #'+readableValue(now.menu_item_id));
  if(l.action==='insert')return {row,title:'新增訂單品項',detail:newName+' × '+Number(now.quantity||1)+' · '+money(now.unit_price)};
  if(l.action==='delete')return {row,title:'刪除訂單品項',detail:oldName+' × '+Number(old.quantity||1)+' · '+money(old.unit_price)};
  const diff=[];
  if(Number(old.menu_item_id)!==Number(now.menu_item_id))diff.push('品項：'+oldName+' → '+newName);
  if(Number(old.quantity||1)!==Number(now.quantity||1))diff.push('數量：'+Number(old.quantity||1)+' → '+Number(now.quantity||1));
  if(Number(old.unit_price||0)!==Number(now.unit_price||0))diff.push('單價：'+money(old.unit_price)+' → '+money(now.unit_price));
  if(old.market_price_amount!==now.market_price_amount)diff.push('時價：'+(old.market_price_amount==null?'未設定':money(old.market_price_amount))+' → '+(now.market_price_amount==null?'未設定':money(now.market_price_amount)));
  if(!diff.length)return null;
  return {row:now,title:'修改訂單品項',detail:diff.join('；')};
}
async function loadOrderChanges(){
  const box=$('orderChangeList');
  if(!box)return;
  box.innerHTML='<div class="loading">載入中…</div>';
  let q=db.from('class_lunch_audit_logs')
    .select('id,actor_user_id,actor_email,actor_type,action,entity_type,entity_id,detail,created_at')
    .in('entity_type',['orders','order_items']);
  q=scopeAdminClass(q);
  const{data,error}=await q.order('created_at',{ascending:false}).limit(300);
  if(error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast(error.message)}
  const rows=data||[];
  const menuIds=[...new Set(rows.flatMap(l=>[l.detail?.old?.menu_item_id,l.detail?.new?.menu_item_id]).filter(Boolean).map(Number))];
  const itemNames=new Map();
  if(menuIds.length){
    const r=await db.from('menu_items').select('id,name').in('id',menuIds);
    for(const x of (r.data||[]))itemNames.set(Number(x.id),x.name);
  }
  const rendered=rows.map(l=>{
    const d=describeOrderChange(l,itemNames);
    if(!d)return '';
    const actor=orderActorLabel(l,d.row);
    const seat=d.row?.student_name?String(d.row.student_name)+'號':actor;
    return '<div class="change-row"><div class="change-main"><div class="change-title"><b>'+esc(d.title)+'</b><span>'+esc(seat)+'</span></div><p>'+esc(d.detail)+'</p><small>'+esc(actor)+'</small></div><time>'+esc(fmtAdminTime(l.created_at))+'</time></div>';
  }).filter(Boolean);
  box.innerHTML=rendered.length?rendered.join(''):'<div class="loading">目前沒有訂單異動紀錄</div>';
}
$('refreshChangesBtn')?.addEventListener('click',loadOrderChanges);

