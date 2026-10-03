const{createClient}=supabase;
const db=createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
let student=null,sessions=[],orders=[],menuItems=[],orderItemsByOrder={},testSelections=[],editingSessionId=null,realtimeChannel=null,realtimeTimer=null;
const money=n=>'$'+Number(n||0).toLocaleString('zh-TW');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>new Date().toLocaleDateString('en-CA');
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
function fmtDate(v){const d=new Date(v+'T00:00:00');return d.toLocaleDateString('zh-TW',{month:'numeric',day:'numeric',weekday:'short'})}
function fmtCutoff(v){if(!v)return'';return new Date(v).toLocaleString('zh-TW',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
function expired(s){return !!s.cutoff_at&&new Date(s.cutoff_at).getTime()<=Date.now()}
function countdown(s){
  if(!s.cutoff_at)return '未設定截止時間';
  const ms=new Date(s.cutoff_at).getTime()-Date.now();
  if(ms<=0)return '已截止';
  const mins=Math.floor(ms/60000),days=Math.floor(mins/1440),hrs=Math.floor((mins%1440)/60),m=mins%60;
  if(days>0)return '剩餘 '+days+'天 '+hrs+'小時';
  if(hrs>0)return '剩餘 '+hrs+'小時 '+m+'分';
  return '即將截止 · 剩餘 '+Math.max(1,m)+'分';
}
function validSeat(seat){return Number.isInteger(seat)&&((seat>=1&&seat<=35)||seat===99)}
function internalEmail(seat){return 'seat'+String(Number(seat)).padStart(2,'0')+'@class-lunch.example'}
function authPassword(raw){return 'CLP:'+String(raw)+':2026'}

$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const seat=Number($('seatLogin').value),raw=$('passwordLogin').value;
  if(!validSeat(seat))return toast('座號不正確');
  if(raw===String(seat).padStart(3,'0')){
    const{data:initData,error:initError}=await db.functions.invoke('class-lunch-init-login',{body:{seat_number:seat,initial_code:raw}});
    if(initError||initData?.error)return toast('初始登入失敗：'+(initData?.detail||initData?.error||initError?.message||'未知錯誤'));
    if(initData?.access_token&&initData?.refresh_token){
      const{error:setError}=await db.auth.setSession({access_token:initData.access_token,refresh_token:initData.refresh_token});
      if(setError)return toast('登入失敗：'+setError.message);
      $('passwordLogin').value='';return refresh();
    }
  }
  const{error}=await db.auth.signInWithPassword({email:internalEmail(seat),password:authPassword(raw)});
  if(error)return toast('座號或密碼錯誤');
  $('passwordLogin').value='';await refresh();
});

$('setupForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const name=$('setupName').value.trim(),p1=$('setupPassword').value,p2=$('setupPassword2').value;
  if(!name)return toast('請輸入姓名');
  if(p1.length<4)return toast('新密碼至少 4 碼');
  if(p1!==p2)return toast('兩次密碼不一致');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;b.textContent='設定中…';
  const{data,error}=await db.functions.invoke('class-lunch-students',{body:{action:'self_setup',name,password:p1}});
  b.disabled=false;b.textContent='完成設定';
  if(error||data?.error)return toast('設定失敗：'+(data?.detail||data?.error||error.message));
  $('setupForm').reset();toast('設定完成');await refresh();
});

$('logoutBtn').addEventListener('click',async()=>{await db.auth.signOut();student=null;refresh()});
$('accountBtn').addEventListener('click',()=>{$('passwordForm').reset();$('accountDialog').showModal()});
$('historyBtn').addEventListener('click',openHistory);
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));

$('passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const p1=$('newPassword').value,p2=$('newPassword2').value;
  if(p1.length<4)return toast('密碼至少 4 碼');
  if(p1!==p2)return toast('兩次密碼不一致');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;
  const{data,error}=await db.functions.invoke('class-lunch-students',{body:{action:'change_password',password:p1}});
  b.disabled=false;
  if(error||data?.error)return toast('修改失敗：'+(data?.detail||data?.error||error.message));
  $('accountDialog').close();$('passwordForm').reset();toast('密碼已更新');
});

async function refresh(){
  const{data:{user}}=await db.auth.getUser();
  if(!user){
    stopStudentRealtime();
    $('loginBox').classList.remove('hidden');$('setupBox').classList.add('hidden');$('studentApp').classList.add('hidden');
    $('heroAccount').classList.add('hidden');$('logoutBtn').classList.add('hidden');$('accountBtn').classList.add('hidden');$('historyBtn').classList.add('hidden');$('adminLink').classList.add('hidden');
    $('welcomeText').textContent='登入後查看開放中的訂餐。';return;
  }
  const{data:s,error}=await db.from('students').select('id,seat_number,name,active,must_setup').eq('auth_user_id',user.id).maybeSingle();
  if(error||!s||!s.active){await db.auth.signOut();toast('此學生帳號目前無法使用');return refresh()}
  student=s;startStudentRealtime();$('loginBox').classList.add('hidden');$('heroAccount').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');$('historyBtn').classList.remove('hidden');
  $('adminLink').classList.toggle('hidden',s.seat_number!==99);
  $('heroIdentity').textContent=s.seat_number+'號 '+(s.name||'');

  if(s.must_setup&&s.seat_number!==99){
    $('accountBtn').classList.add('hidden');$('historyBtn').classList.add('hidden');$('adminLink').classList.add('hidden');$('studentApp').classList.add('hidden');$('setupBox').classList.remove('hidden');$('welcomeText').textContent=s.seat_number+'號第一次登入設定';return;
  }
  $('accountBtn').classList.remove('hidden');$('setupBox').classList.add('hidden');$('studentApp').classList.remove('hidden');
  $('welcomeText').textContent='歡迎回來，'+(s.name||s.seat_number+'號')+'。看看今天想吃什麼。';
  await loadSessions();
}

async function loadSessions(){
  const [{data:ss,error:se},{data:os,error:oe}]=await Promise.all([
    db.from('meal_sessions').select('id,meal_date,cutoff_at,is_active,menu_template_id,menu_templates(id,name,image_url,active)').eq('is_active',true).gte('meal_date',today()).order('meal_date'),
    db.from('orders').select('id,meal_session_id,item_name,unit_price,note,paid,created_at,menu_item_id').eq('student_id',student.id).order('created_at',{ascending:false})
  ]);
  if(se||oe)return toast((se||oe).message);
  sessions=(ss||[]).filter(x=>x.menu_templates?.active!==false);orders=os||[];$('menuCount').textContent=sessions.length+' 份';
  if(sessions.length){
    const ids=[...new Set(sessions.map(s=>s.menu_template_id))];
    const{data:mi,error:me}=await db.from('menu_items').select('id,menu_template_id,category,name,price,is_market_price,active,sort_order').in('menu_template_id',ids).eq('active',true).order('sort_order').order('id');
    if(me)return toast('讀取菜單品項失敗：'+me.message);
    menuItems=mi||[];
    orderItemsByOrder={};
    const orderIds=orders.map(o=>o.id);
    if(orderIds.length){
      const{data:oi,error:oie}=await db.from('order_items').select('order_id,menu_item_id,quantity,unit_price,is_market_price,market_price_amount').in('order_id',orderIds).order('id');
      if(oie)return toast('讀取訂單品項失敗：'+oie.message);
      for(const row of (oi||[])){
        if(!orderItemsByOrder[row.order_id])orderItemsByOrder[row.order_id]=[];
        orderItemsByOrder[row.order_id].push(row);
      }
    }
  }else{menuItems=[];orderItemsByOrder={};}
  renderSessionPicker();renderSessions();
}
function renderSessionPicker(){
  const sel=$('sessionPicker'),previous=Number(sel.value);
  sel.innerHTML=sessions.map(s=>'<option value="'+s.id+'">'+esc(fmtDate(s.meal_date)+'｜'+(s.menu_templates?.name||'菜單'))+'</option>').join('');
  if(previous&&sessions.some(s=>s.id===previous))sel.value=String(previous);else if(sessions.length)sel.value=String(sessions[0].id);
  sel.disabled=sessions.length===0;sel.onchange=renderSessions;
}
function renderSessions(){
  if(!sessions.length){$('menus').innerHTML='<div class="loading">目前沒有開放中的訂餐。</div>';return}
  const selectedId=Number($('sessionPicker')?.value)||sessions[0].id;
  const s=sessions.find(x=>x.id===selectedId)||sessions[0],o=orders.find(x=>x.meal_session_id===s.id),closed=expired(s);
  const img=s.menu_templates?.image_url?'<div class="photo-button" data-image-url="'+esc(s.menu_templates.image_url)+'"><img class="menu-photo" src="'+esc(s.menu_templates.image_url)+'" alt="菜單"></div>':'<div class="menu-photo placeholder">🍱</div>';
  let state='';
  if(o){
    const rows=orderItemsByOrder[o.id]||[];
    const knownMarket=rows.some(x=>x.is_market_price);
    const unresolvedMarket=rows.some(x=>x.is_market_price&&x.market_price_amount==null)||(!knownMarket&&String(o.item_name||'').includes('（時價）'));
    state='<div class="order-status '+(o.paid?'paid':'pending')+'"><b>'+(o.paid?'✓ 已付款':'已訂餐 · 未付款')+'</b><div>'+esc(o.item_name)+' · '+money(o.unit_price)+(unresolvedMarket?' ＋ 時價':'')+'</div><small>'+esc(o.note||'無備註')+'</small></div>';
    if(!closed&&!o.paid)state+='<div class="order-actions"><button class="primary" onclick="openOrderEditor('+s.id+')">修改訂單</button><button class="small-btn danger" onclick="cancelOrder('+s.id+')">取消訂單</button></div>';
  }else if(closed){
    state='<div class="closed-order">此訂餐已截止</div>';
  }else{
    state='<div class="order-status empty"><b>尚未訂餐</b><span>選好餐點後再送出即可。</span></div><button class="primary full-btn" onclick="openOrderEditor('+s.id+')">開始訂餐</button>';
  }
  const deadline='<div class="deadline '+(closed?'closed':'')+'"><span>截止：'+esc(fmtCutoff(s.cutoff_at)||'未設定')+'</span><b>'+esc(countdown(s))+'</b></div>';
  $('menus').innerHTML='<article class="menu-card">'+img+'<div class="menu-body"><h3>'+esc(s.menu_templates?.name||'菜單')+'</h3><div class="menu-meta">📅 '+esc(fmtDate(s.meal_date))+'</div>'+deadline+state+'</div></article>';
}
function getTestItemsForSession(){
  const s=sessions.find(x=>x.id===editingSessionId);
  return s?menuItems.filter(x=>x.menu_template_id===s.menu_template_id&&x.active!==false):[];
}
function renderTestOrderRows(){
  const items=getTestItemsForSession();
  if(!testSelections.length)testSelections=[''];
  while(testSelections.length>1&&testSelections.at(-1)===''&&testSelections.at(-2)==='')testSelections.pop();
  if(testSelections.at(-1)!==''&&testSelections.length<20)testSelections.push('');

  $('testOrderRows').innerHTML=testSelections.map((v,i)=>{
    const opts='<option value="">請選擇餐點</option>'+items.map(x=>'<option value="'+x.id+'" '+(String(x.id)===String(v)?'selected':'')+'>'+esc(x.name+'　'+(x.is_market_price?'時價':money(x.price)))+'</option>').join('');
    const removable=v!==''?'<button type="button" class="small-btn danger" onclick="removeTestOrderSelection('+i+')">移除</button>':'';
    return '<div class="test-order-row"><select onchange="updateTestOrderSelection('+i+',this.value)">'+opts+'</select>'+removable+'</div>';
  }).join('');

  const chosen=testSelections.filter(Boolean).map(id=>items.find(m=>String(m.id)===String(id))).filter(Boolean);
  const total=chosen.reduce((sum,x)=>sum+(x.is_market_price?0:Number(x.price||0)),0);
  const hasMarket=chosen.some(x=>x.is_market_price);
  $('selectedItemPrice').textContent=money(total)+(hasMarket?' ＋ 時價':'');
}
function updateTestOrderSelection(i,value){
  testSelections[i]=value;
  renderTestOrderRows();
}
function removeTestOrderSelection(i){
  testSelections.splice(i,1);
  renderTestOrderRows();
}
function openOrderEditor(sessionId){
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
        for(let q=0;q<Number(row.quantity||1);q++)testSelections.push(String(row.menu_item_id));
      }
    }else if(o?.menu_item_id){
      testSelections=[String(o.menu_item_id)];
    }
    testSelections.push('');
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
    const counts=new Map();
    for(const raw of testSelections.filter(Boolean)){
      const id=Number(raw);counts.set(id,(counts.get(id)||0)+1);
    }
    if(!counts.size){b.disabled=false;b.textContent='儲存訂單';return toast('至少選一個品項')}
    const items=[...counts.entries()].map(([menu_item_id,qty])=>({menu_item_id,qty}));
    const r=await db.rpc('place_class_lunch_order_v4',{p_session_id:editingSessionId,p_items:items,p_note:note});error=r.error;
  }else{
    const item=$('orderItem').value.trim(),amount=Number($('orderAmount').value);
    if(!item){b.disabled=false;b.textContent='儲存訂單';return toast('請輸入品項')}
    const r=await db.rpc('place_class_lunch_order_v2',{p_session_id:editingSessionId,p_item_name:item,p_unit_price:amount,p_note:note});error=r.error;
  }
  b.disabled=false;b.textContent='儲存訂單';
  if(error)return toast('送出失敗：'+error.message);
  $('orderDialog').close();toast('訂單已儲存');await loadSessions();
});
async function cancelOrder(sessionId){
  if(!confirm('確定取消這筆訂單？'))return;
  const{error}=await db.rpc('cancel_class_lunch_order_v2',{p_session_id:sessionId});
  if(error)return toast('取消失敗：'+error.message);
  toast('訂單已取消');await loadSessions();
}
async function openHistory(){
  if(!student)return;
  $('historyDialog').showModal();
  $('historyList').innerHTML='<div class="loading">載入中…</div>';

  const{data:history,error}=await db.from('orders')
    .select('id,item_name,unit_price,note,paid,order_date,created_at,meal_session_id,meal_sessions(meal_date,menu_templates(name))')
    .eq('student_id',student.id)
    .order('order_date',{ascending:false})
    .order('created_at',{ascending:false});
  if(error){$('historyList').innerHTML='<div class="loading">讀取失敗</div>';return toast('歷史訂單讀取失敗：'+error.message)}

  const list=history||[],ids=list.map(x=>x.id);
  let knownMarketOrders=new Set(),unresolvedMarketOrders=new Set();
  if(ids.length){
    const{data:oi}=await db.from('order_items').select('order_id,is_market_price,market_price_amount').in('order_id',ids).eq('is_market_price',true);
    knownMarketOrders=new Set((oi||[]).map(x=>x.order_id));
    unresolvedMarketOrders=new Set((oi||[]).filter(x=>x.market_price_amount==null).map(x=>x.order_id));
  }

  const total=list.reduce((sum,o)=>sum+Number(o.unit_price||0),0);
  const paid=list.filter(o=>o.paid).length;
  const hasMarket=list.some(o=>unresolvedMarketOrders.has(o.id)||(!knownMarketOrders.has(o.id)&&String(o.item_name||'').includes('（時價）')));
  $('historyCount').textContent=list.length;
  $('historyTotal').textContent=money(total)+(hasMarket?' ＋ 時價':'');
  $('historyPaid').textContent=paid;
  $('historyUnpaid').textContent=list.length-paid;

  $('historyList').innerHTML=list.length?list.map(o=>{
    const date=o.meal_sessions?.meal_date||o.order_date||'';
    const shop=o.meal_sessions?.menu_templates?.name||'歷史訂單';
    const market=unresolvedMarketOrders.has(o.id)||(!knownMarketOrders.has(o.id)&&String(o.item_name||'').includes('（時價）'));
    return '<article class="history-row">'+
      '<div class="history-date">'+esc(date?fmtDate(date):'—')+'</div>'+
      '<div class="history-main"><div class="history-title"><b>'+esc(shop)+'</b><span class="'+(o.paid?'history-paid':'history-unpaid')+'">'+(o.paid?'已付款':'未付款')+'</span></div>'+
      '<div class="history-items">'+esc(o.item_name||'未記錄品項')+'</div>'+
      (o.note?'<small>備註：'+esc(o.note)+'</small>':'')+'</div>'+
      '<strong class="history-price">'+money(o.unit_price)+(market?' ＋ 時價':'')+'</strong>'+
    '</article>';
  }).join(''):'<div class="history-empty"><b>還沒有歷史訂單</b><span>完成第一次訂餐後會出現在這裡。</span></div>';
}
function openImage(u){$('largeImage').src=u;$('imageModal').classList.remove('hidden');document.body.style.overflow='hidden'}
function closeImage(e){if(e&&e.target!==$('imageModal')&&!e.target.classList.contains('close'))return;$('imageModal').classList.add('hidden');$('largeImage').src='';document.body.style.overflow=''}
document.addEventListener('click',e=>{const p=e.target.closest('.photo-button');if(p)openImage(p.dataset.imageUrl)});
function scheduleStudentRealtimeRefresh(){
  clearTimeout(realtimeTimer);
  realtimeTimer=setTimeout(()=>{if(student)loadSessions()},350);
}
function startStudentRealtime(){
  if(realtimeChannel)return;
  realtimeChannel=db.channel('class-lunch-student-realtime')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},scheduleStudentRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},scheduleStudentRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'meal_sessions'},scheduleStudentRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_items'},scheduleStudentRealtimeRefresh)
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_templates'},scheduleStudentRealtimeRefresh)
    .subscribe();
}
function stopStudentRealtime(){
  clearTimeout(realtimeTimer);
  if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null}
}
setInterval(()=>{if(student&&sessions.length)renderSessions()},30000);
db.auth.onAuthStateChange(()=>setTimeout(refresh,0));refresh();