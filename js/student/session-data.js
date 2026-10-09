async function refresh(){
  lastStudentRefreshStartedAt=Date.now();
  const{data:{session}}=await db.auth.getSession();
  if(!session){
    stopStudentRealtime();
    student=null;
    studentViewClassId=null;
    loadedMenuTemplateKey='';
    window.dispatchEvent(new Event('class-lunch-student-ready'));
    detachCurrentPushBinding();
    $('loginBox').classList.remove('hidden');$('setupBox').classList.add('hidden');$('studentApp').classList.add('hidden');
    $('heroAccount').classList.add('hidden');$('logoutBtn').classList.add('hidden');$('notifyBtn').classList.add('hidden');$('accountBtn').classList.add('hidden');$('historyBtn').classList.add('hidden');$('adminLink').classList.add('hidden');
    $('welcomeText').textContent='登入後查看開放中的訂餐。';return;
  }

  const user=session.user;
  const{data:s,error}=await db.from('students').select('id,seat_number,name,active,must_setup,role,class_id,classes(code,name)').eq('auth_user_id',user.id).maybeSingle();
  if(error){
    $('welcomeText').textContent='登入狀態仍保留，學生資料暫時讀取失敗。';
    return;
  }
  if(!s||!s.active){await db.auth.signOut();student=null;toast('此學生帳號目前無法使用');return refresh()}
  student=s;
  studentViewClassId=s.class_id||null;
  if(s.role==='system_admin'){
    const classCode=String(localStorage.getItem('class-lunch-last-class')||'99').trim()||'99';
    const{data:activeClass,error:classError}=await db.from('classes')
      .select('id,code').eq('code',classCode).eq('active',true).maybeSingle();
    if(classError||!activeClass){
      studentViewClassId=null;
      $('welcomeText').textContent='目前登入班級不存在或已停用';
      return;
    }
    studentViewClassId=activeClass.id;
  }
  window.dispatchEvent(new Event('class-lunch-student-ready'));
  watchNotificationPermission();$('loginBox').classList.add('hidden');$('heroAccount').classList.remove('hidden');$('logoutBtn').classList.remove('hidden');$('historyBtn').classList.remove('hidden');
  const isManager=['system_admin','class_admin'].includes(String(s.role||''));
  $('adminLink').classList.toggle('hidden',!isManager);
  const classLabel=s.role==='system_admin'?'系統管理員 ':(s.classes?.code?s.classes.code+'班 ':'');
  $('heroIdentity').textContent=classLabel+s.seat_number+'號 '+(s.name||'');

  if(s.must_setup&&!isManager){
    const isTeacher=s.seat_number===0;
    $('setupTitle').textContent=isTeacher?'老師第一次登入':'第一次登入設定';
    $('setupHint').textContent=isTeacher?'初始密碼必須更換後才能使用訂餐；老師名稱固定，不需要設定姓名。':'請先設定姓名並更換密碼。姓名完成設定後只能由管理員修改。';
    $('setupNameField').classList.toggle('hidden',isTeacher);
    $('setupName').required=!isTeacher;
    if(isTeacher)$('setupName').value='老師';
    $('notifyBtn').classList.add('hidden');$('accountBtn').classList.add('hidden');$('historyBtn').classList.add('hidden');$('adminLink').classList.add('hidden');$('studentApp').classList.add('hidden');$('setupBox').classList.remove('hidden');$('welcomeText').textContent=isTeacher?'0號 老師 · 請先更換初始密碼':s.seat_number+'號第一次登入設定';return;
  }
  $('notifyBtn').classList.remove('hidden');$('accountBtn').classList.remove('hidden');$('setupBox').classList.add('hidden');$('studentApp').classList.remove('hidden');
  startStudentRealtime();
  $('setupNameField').classList.remove('hidden');$('setupName').required=true;
  $('welcomeText').textContent='歡迎回來，'+(s.name||s.seat_number+'號')+'。看看今天想吃什麼。';
  setTimeout(()=>refreshPushStatus(),0);
  await loadSessions();
}

async function loadOrderState(){
  orders=[];orderItemsByOrder={};
  if(!student||!sessions.length)return;
  const sessionIds=sessions.map(s=>s.id);
  const{data:os,error:oe}=await db.from('orders')
    .select('id,meal_session_id,item_name,unit_price,note,paid,payment_method,onsite_received,created_at,menu_item_id,order_status,backup_checkout_ready')
    .eq('student_id',student.id)
    .in('meal_session_id',sessionIds)
    .order('created_at',{ascending:false});
  if(oe)throw oe;
  orders=os||[];
  const orderIds=orders.map(o=>o.id);
  if(!orderIds.length)return;
  const{data:oi,error:oie}=await db.from('order_items')
    .select('id,order_id,menu_item_id,quantity,unit_price,is_market_price,market_price_amount,variant_id,variant_name,option_summary,configuration,item_name_snapshot')
    .in('order_id',orderIds)
    .order('id');
  if(oie)throw oie;
  for(const row of (oi||[])){
    if(!orderItemsByOrder[row.order_id])orderItemsByOrder[row.order_id]=[];
    orderItemsByOrder[row.order_id].push(row);
  }
}
async function loadMenuState(force=false){
  const templateIds=[...new Set(sessions.map(s=>s.menu_template_id))].sort((a,b)=>Number(a)-Number(b));
  const key=templateIds.join(',');
  if(!templateIds.length){
    menuItems=[];menuVariants=[];menuOptionGroups=[];menuOptionChoices=[];loadedMenuTemplateKey='';return;
  }
  if(!force&&key===loadedMenuTemplateKey&&menuItems.length)return;
  const{data:mi,error:me}=await db.from('menu_items')
    .select('id,menu_template_id,category,name,price,is_market_price,active,sort_order')
    .in('menu_template_id',templateIds)
    .eq('active',true)
    .order('sort_order')
    .order('id');
  if(me)throw me;
  menuItems=mi||[];
  const itemIds=menuItems.map(x=>x.id);
  if(!itemIds.length){
    menuVariants=[];menuOptionGroups=[];menuOptionChoices=[];loadedMenuTemplateKey=key;return;
  }
  const [vr,gr]=await Promise.all([
    db.from('menu_item_variants')
      .select('id,menu_item_id,name,price_delta,is_default,active,sort_order')
      .in('menu_item_id',itemIds).eq('active',true).order('sort_order').order('id'),
    db.from('menu_option_groups')
      .select('id,menu_item_id,variant_id,name,min_select,max_select,active,sort_order')
      .in('menu_item_id',itemIds).eq('active',true).order('sort_order').order('id')
  ]);
  if(vr.error)throw vr.error;
  if(gr.error)throw gr.error;
  menuVariants=vr.data||[];
  menuOptionGroups=gr.data||[];
  const groupIds=menuOptionGroups.map(x=>x.id);
  if(groupIds.length){
    const cr=await db.from('menu_option_choices')
      .select('id,group_id,name,price_delta,is_default,active,sort_order')
      .in('group_id',groupIds).eq('active',true).order('sort_order').order('id');
    if(cr.error)throw cr.error;
    menuOptionChoices=cr.data||[];
  }else menuOptionChoices=[];
  loadedMenuTemplateKey=key;
}
async function refreshOwnOrders(){
  clearTimeout(realtimeTimer);
  realtimeRefreshMode='';
  try{
    await loadOrderState();
    renderSessions();
  }catch(error){
    console.warn('student_order_refresh_failed',error);
  }
}
async function loadSessions(options={}){
  const forceMenus=options?.forceMenus===true;
  let q=db.from('meal_sessions')
    .select('id,meal_date,cutoff_at,is_active,class_id,menu_template_id,backup_group_id,backup_slot,restaurant_status,menu_templates(id,name,image_url,active),meal_session_groups!meal_sessions_backup_group_id_fkey(id,status,selected_session_id,meal_date)')
    .eq('is_active',true)
    .gte('meal_date',today());
  if(studentViewClassId)q=q.eq('class_id',studentViewClassId);
  const{data:ss,error:se}=await q.order('meal_date');
  if(se)return toast(se.message);

  sessions=(ss||[]).filter(x=>x.menu_templates?.active!==false);
  $('menuCount').textContent=sessions.length+' 份';

  try{
    await Promise.all([loadOrderState(),loadMenuState(forceMenus)]);
  }catch(error){
    return toast('讀取訂餐資料失敗：'+String(error?.message||error));
  }

  renderSessionPicker();
  renderSessions();
}
function pickerRootSessions(){
  const seen=new Set(),roots=[];
  for(const s of sessions.slice().sort((a,b)=>a.meal_date.localeCompare(b.meal_date)||String(a.backup_slot||'').localeCompare(String(b.backup_slot||''))||Number(a.id)-Number(b.id))){
    const key=s.backup_group_id?'g:'+s.backup_group_id:'s:'+s.id;
    if(seen.has(key))continue;
    seen.add(key);roots.push(s);
  }
  return roots;
}
function renderSessionPicker(){
  const sel=$('sessionPicker'),previous=Number(sel.value),roots=pickerRootSessions();
  sel.innerHTML=roots.map(s=>{
    const grouped=!!s.backup_group_id;
    const label=fmtDate(s.meal_date)+'｜'+(grouped?'A/B 備用訂餐':(s.menu_templates?.name||'菜單'));
    return '<option value="'+s.id+'">'+esc(label)+'</option>';
  }).join('');
  if(previous&&roots.some(s=>s.id===previous))sel.value=String(previous);else if(roots.length)sel.value=String(roots[0].id);
  sel.disabled=roots.length===0;sel.onchange=renderSessions;
}
function orderStateMarkup(o,label){
  if(!o)return '<div class="order-status empty"><b>'+esc(label)+' 尚未完成</b></div>';
  if(o.order_status==='cancelled_restaurant')return '<div class="order-status empty"><b>'+esc(label)+' 餐廳未接單・已取消</b><div>'+esc(o.item_name||'')+' · '+money(o.unit_price)+'</div></div>';
  if(o.order_status==='cancelled_backup')return '<div class="order-status empty"><b>'+esc(label)+' 備用未採用</b><div>'+esc(o.item_name||'')+' · '+money(o.unit_price)+'</div></div>';
  const pending=o.order_status==='pending_choice';
  return '<div class="order-status '+(o.paid?'paid':'pending')+'"><b>'+esc(label)+' '+(o.paid?'✓ 已付款':pending?'✓ 已完成選餐':'已訂餐 · 未付款')+'</b><div>'+esc(o.item_name||'')+' · '+money(o.unit_price)+'</div></div>';
}
function renderSessions(){
  if(!sessions.length){$('menus').innerHTML='<div class="loading lunch-empty-egg"><b>今天暫時沒有便當可以支配你的人生。</b><span>有開放訂餐時會出現在這裡。</span></div>';return}
  const roots=pickerRootSessions();
  const selectedId=Number($('sessionPicker')?.value)||roots[0]?.id||sessions[0].id;
  const s=sessions.find(x=>x.id===selectedId)||roots[0]||sessions[0];

  if(s.backup_group_id){
    const groupSessions=sessions.filter(x=>Number(x.backup_group_id)===Number(s.backup_group_id))
      .sort((a,b)=>String(a.backup_slot||'').localeCompare(String(b.backup_slot||''))||Number(a.id)-Number(b.id));
    const group=s.meal_session_groups||{};
    const closed=groupSessions.every(expired);
    const statusText=({collecting:'請依序完成兩份菜單，最後選付款方式；目前不會扣款。',awaiting_restaurant:'管理員已選擇菜單，正在等待餐廳確認。',confirmed:'餐廳已接單，正式訂單已成立。',cancelled:'本次餐廳皆未接單，訂餐已取消。'})[group.status]||'';
    const cards=groupSessions.map(x=>{
      const o=orders.find(v=>Number(v.meal_session_id)===Number(x.id));
      const img=x.menu_templates?.image_url?'<div class="photo-button" data-image-url="'+esc(x.menu_templates.image_url)+'"><img class="menu-photo" src="'+esc(x.menu_templates.image_url)+'" alt="菜單"></div>':'';
      return '<div class="history-pack-order"><span><b>'+esc((x.backup_slot||'?')+'｜'+(x.menu_templates?.name||'菜單'))+'</b><small>'+esc(x.restaurant_status==='failed'?'餐廳未接單':x.restaurant_status==='not_selected'?'備用未採用':x.restaurant_status==='confirmed'?'餐廳已接單':'備用候選')+'</small></span></div>'+img+orderStateMarkup(o,x.backup_slot||'');
    }).join('');
    const canOrder=group.status==='collecting'&&!closed;
    const readyOrder=groupSessions.map(x=>orders.find(o=>Number(o.meal_session_id)===Number(x.id)&&o.backup_checkout_ready)).find(Boolean);
    const payMethod=readyOrder?.payment_method;
    const action=canOrder?'<button class="primary full-btn" onclick="startBackupOrderFlow('+s.backup_group_id+')">'+(groupSessions.every(x=>orders.some(o=>Number(o.meal_session_id)===Number(x.id)&&o.order_status==='pending_choice'&&o.backup_checkout_ready))?'修改 A / B 選餐':'開始 A → B 點餐')+'</button>':'';
    $('menus').innerHTML='<article class="menu-card"><div class="menu-body"><h3>A / B 複選備用</h3><div class="menu-meta">📅 '+esc(fmtDate(s.meal_date))+'</div><div class="order-status pending"><b>'+esc(statusText)+'</b>'+(payMethod&&group.status==='collecting'?'<small>目前付款方式：'+(payMethod==='wallet'?'錢包':'現場付款')+'（採用菜單確認後才結算）</small>':'')+'</div>'+cards+action+'</div></article>';
    return;
  }

  const o=orders.find(x=>x.meal_session_id===s.id),closed=expired(s);
  const img=s.menu_templates?.image_url?'<div class="photo-button" data-image-url="'+esc(s.menu_templates.image_url)+'"><img class="menu-photo" src="'+esc(s.menu_templates.image_url)+'" alt="菜單"></div>':'<div class="menu-photo placeholder">🍱</div>';
  let state='';
  if(o){
    const rows=orderItemsByOrder[o.id]||[];
    const knownMarket=rows.some(x=>x.is_market_price);
    const unresolvedMarket=rows.some(x=>x.is_market_price&&x.market_price_amount==null)||(!knownMarket&&String(o.item_name||'').includes('（時價）'));
    const hasOnsiteMoney=Number(o.onsite_received||0)!==0;
    if(o.order_status==='cancelled_restaurant'){
      state='<div class="order-status empty"><b>餐廳未接單・本次已取消</b><div>'+esc(o.item_name||'')+' · '+money(o.unit_price)+'</div><small>這筆不會列入欠款；原錢包扣款如有發生會留下退款紀錄。</small></div>';
    }else{
      state='<div class="order-status '+(o.paid?'paid':'pending')+'"><b>'+(o.paid?'✓ 已付款':'已訂餐 · 未付款')+'</b><div>'+esc(o.item_name)+' · '+money(o.unit_price)+(unresolvedMarket?' ＋ 時價':'')+'</div><small>'+esc(o.note||'無備註')+'</small>'+(hasOnsiteMoney&&!o.paid?'<small>此訂單已有現場收款紀錄，請由管理員處理後續。</small>':'')+'<small class="easter-note">'+esc(paymentEaster(!!o.paid,o.unit_price))+'</small></div>';
      if(!closed&&!o.paid&&!hasOnsiteMoney)state+='<div class="order-actions"><button class="primary" onclick="openOrderEditor('+s.id+')">修改訂單</button><button class="small-btn danger" onclick="cancelOrder('+s.id+')">取消訂單</button></div>';
      else if(!closed&&o.paid&&o.payment_method==='wallet')state+='<div class="order-actions"><button class="small-btn danger" onclick="cancelOrder('+s.id+')">取消訂單並退回錢包</button></div>';
    }
  }else if(closed){
    state='<div class="closed-order">詠丞小弟弟告訴你：<br>便當不點，錢全花在她身上，<br>她說永遠，最後還不是散場。<br>愛情會跑，雞腿不會說謊，<br>與其餓著等她，不如先讓自己吃爽。<br>可惜這次訂餐已經收場，<br>下次早點來，別再對著空胃惆悵。</div>';
  }else{
    state='<div class="order-status empty"><b>尚未訂餐</b><span>選好餐點後再送出即可。</span></div><button class="primary full-btn" onclick="openOrderEditor('+s.id+')">開始訂餐</button>';
  }
  const deadline='<div class="deadline '+(closed?'closed':'')+'"><span>截止：'+esc(fmtCutoff(s.cutoff_at)||'未設定')+'</span><b>'+esc(countdown(s))+'</b></div>';
  $('menus').innerHTML='<article class="menu-card">'+img+'<div class="menu-body"><h3>'+esc(s.menu_templates?.name||'菜單')+'</h3><div class="menu-meta">📅 '+esc(fmtDate(s.meal_date))+'</div>'+deadline+state+'</div></article>';
}
