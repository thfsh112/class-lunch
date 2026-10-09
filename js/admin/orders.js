function localDatetime(v){if(!v)return'';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(v));const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return m.year+'-'+m.month+'-'+m.day+'T'+m.hour+':'+m.minute}
function openSessionDialog(id){const s=sessions.find(x=>x.id===id);if(!s)return;editingSessionId=id;editingSessionOriginalDate=s.meal_date;$('editSessionTemplate').value=String(s.menu_template_id);$('editSessionDate').value=s.meal_date;$('editSessionCutoff').value=localDatetime(s.cutoff_at)||defaultCutoffForDate(s.meal_date);$('editSessionActive').checked=s.is_active;$('sessionDialog').showModal()}
$('sessionEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const cutoff=$('editSessionCutoff').value;
  const{error}=await db.from('meal_sessions').update({menu_template_id:Number($('editSessionTemplate').value),meal_date:$('editSessionDate').value,cutoff_at:cutoff?new Date(cutoff+':00+08:00').toISOString():null,is_active:$('editSessionActive').checked,updated_at:new Date().toISOString()}).eq('id',editingSessionId);
  if(error)return toast(error.message);$('sessionDialog').close();toast('訂餐日期已更新');await loadSessions();
});
$('archiveSessionBtn').addEventListener('click',async()=>{
  const s=sessions.find(x=>x.id===editingSessionId);if(!s)return;
  if(!confirm('確定封存 '+s.meal_date+'？封存後不再開放訂餐，但訂單與歷史資料都會保留。'))return;
  const{error}=await db.from('meal_sessions').update({is_active:false,updated_at:new Date().toISOString()}).eq('id',editingSessionId);
  if(error)return toast(error.message);
  $('sessionDialog').close();toast('訂餐日期已封存');await loadSessions();
});
$('deleteSessionBtn').addEventListener('click',async()=>{
  const s=sessions.find(x=>x.id===editingSessionId);if(!s)return;
  const{count,error:countError}=await db.from('orders').select('id',{count:'exact',head:true}).eq('meal_session_id',editingSessionId);
  if(countError)return toast('檢查訂單失敗：'+countError.message);
  if((count||0)>0)return toast('這個日期已有訂單，為避免資料遺失只能封存，不能永久刪除');
  if(!confirm('永久刪除 '+s.meal_date+'？此動作無法復原。'))return;
  const{error}=await db.from('meal_sessions').delete().eq('id',editingSessionId);
  if(error)return toast('刪除失敗：'+error.message);
  $('sessionDialog').close();toast('空白訂餐日期已永久刪除');await loadSessions();
});

function openStudentDialog(id){
  const s=students.find(x=>x.id===id);if(!s)return;
  const canEdit=s.role!=='system_admin'&&(currentAdminRole==='system_admin'||s.role!=='class_admin');
  if(!canEdit)return toast('此管理帳號不能修改這個帳號');
  editingStudentId=id;$('editStudentSeat').textContent=s.seat_number+'號';$('editStudentName').value=s.name||'';$('editStudentActive').checked=s.active;$('editStudentPassword').value='';$('studentDialog').showModal()
}
$('studentEditForm').addEventListener('submit',async e=>{
  e.preventDefault();const s=students.find(x=>x.id===editingStudentId);if(!s)return;
  const rawName=$('editStudentName').value.trim(),active=$('editStudentActive').checked,pw=$('editStudentPassword').value;
  const name=s.role==='teacher'?'老師':rawName;
  const u=await db.functions.invoke('class-lunch-students',{body:{action:'update',student_id:s.id,name,active}});
  if(u.error||u.data?.error)return toast('更新失敗：'+(u.data?.detail||u.data?.error||u.error?.message||'未知錯誤'));
  if(pw){
    if(!(s.role==='teacher'&&pw==='tch')&&pw.length<4)return toast('密碼至少 4 碼');
    const r=await db.functions.invoke('class-lunch-students',{body:{action:'reset_password',student_id:s.id,password:pw}});
    if(r.error||r.data?.error)return toast('資料已更新，但密碼重設失敗：'+(r.data?.detail||r.data?.error||r.error?.message||'未知錯誤'));
  }
  $('studentDialog').close();toast('學生資料已更新');await loadStudents();
});

function renderOverviewSelect(){
  const sel=$('overviewSession'),cur=sel.value;
  const current=sessions.filter(s=>s.meal_date>=today()).sort((a,b)=>a.meal_date.localeCompare(b.meal_date)||Number(a.id)-Number(b.id));
  sel.innerHTML=current.map(s=>'<option value="'+s.id+'">'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</option>').join('');
  if(cur&&current.some(s=>String(s.id)===cur))sel.value=cur;
  else if(current.length)sel.value=String(current[0].id);
  sel.onchange=loadOverview;
  if(current.length)loadOverview();
  else{
    $('statOrders').textContent='0';$('statPaid').textContent='0';$('statUnpaidCount').textContent='0';$('statTotal').textContent='$0';
    $('itemStats').innerHTML='<div class="loading">今天起沒有訂餐日期</div>';
    $('unpaidSummary').innerHTML='';
    $('seatPayments').innerHTML='<div class="loading">今天起沒有訂餐日期</div>';
  }
}

async function loadHistoryOrders(){
  const box=$('historyOrderList'),count=$('historySessionCount');
  if(!box||!count)return;
  const past=sessions.filter(s=>s.meal_date<today()).sort((a,b)=>b.meal_date.localeCompare(a.meal_date)||Number(b.id)-Number(a.id));
  count.textContent=past.length+' 個日期';
  if(!past.length){box.innerHTML='<div class="loading">目前還沒有歷史訂單</div>';return}
  box.innerHTML='<div class="loading">整理歷史訂單…</div>';
  const packs=await Promise.all(past.map(async s=>{
    const legacy=s.legacy_menu_id||-1;
    const{data,error}=await db.from('orders')
      .select('id,student_id,student_name,item_name,unit_price,note,paid,quantity,order_status,backup_checkout_ready,payment_method')
      .or('meal_session_id.eq.'+s.id+',menu_id.eq.'+legacy);
    return {session:s,orders:data||[],error};
  }));
  box.innerHTML=packs.map(pack=>{
    const s=pack.session;
    if(pack.error)return '<details class="history-pack"><summary><span><b>'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</b><small>讀取失敗</small></span></summary><div class="loading">'+esc(pack.error.message||'讀取失敗')+'</div></details>';
    const rows=pack.orders;
    const financialRows=rows.filter(o=>o.order_status==='active');
    const paid=financialRows.filter(o=>o.paid).length;
    const total=financialRows.reduce((sum,o)=>sum+Number(o.unit_price||0)*Number(o.quantity||1),0);
    const body=rows.length?rows.slice().sort((a,b)=>{
      const aSeat=students.find(x=>x.id===a.student_id)?.seat_number;
      const bSeat=students.find(x=>x.id===b.student_id)?.seat_number;
      const sa=aSeat??(Number.isFinite(Number(a.student_name))?Number(a.student_name):999);
      const sb=bSeat??(Number.isFinite(Number(b.student_name))?Number(b.student_name):999);
      return Number(sa)-Number(sb);
    }).map(o=>{
      const st=students.find(x=>x.id===o.student_id);
      const seat=st?.seat_number??(Number.isFinite(Number(o.student_name))?Number(o.student_name):'？');
      const unresolved=String(o.item_name||'').includes('（時價）');
      const amount=Number(o.unit_price||0)*Number(o.quantity||1);
      const status=o.order_status==='cancelled_restaurant'?'餐廳未接單・已取消':o.order_status==='cancelled_backup'?'備用未採用':o.order_status==='pending_choice'?'未完成／待確認':o.paid?'已付款':'未付款';
      return '<div class="history-pack-order"><span><b>'+esc(seat+'號'+(st?.name?' '+st.name:''))+'</b><small>'+esc(o.item_name||'未記錄品項')+(o.note?' · 備註：'+esc(o.note):'')+'</small></span><strong>'+money(amount)+(unresolved?' ＋ 時價':'')+' · '+esc(status)+'</strong></div>';
    }).join(''):'<div class="loading">這個日期沒有訂單</div>';
    return '<details class="history-pack"><summary><span><b>'+esc(s.meal_date+' '+(s.menu_templates?.name||'菜單'))+'</b><small>'+rows.length+' 筆紀錄 · 有效 '+financialRows.length+' · 已付款 '+paid+' · 未付款 '+(financialRows.length-paid)+'</small></span><strong>'+money(total)+'</strong></summary><div class="history-pack-orders">'+body+'</div></details>';
  }).join('');
}
async function loadUnpaidOrders(){
  const box=$('allUnpaidList'),summary=$('allUnpaidSummary'),refundBox=$('allRefundList');
  if(!box||!summary||!refundBox||!adminGatePassed)return;
  box.innerHTML='<div class="loading">載入中…</div>';
  refundBox.innerHTML='<div class="loading">載入中…</div>';
  const [unpaidRes,refundRes]=await Promise.all([
    db.rpc('class_lunch_admin_unpaid_orders'),
    db.rpc('class_lunch_admin_refund_due_orders')
  ]);
  if(unpaidRes.error){box.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取未付款名單失敗：'+unpaidRes.error.message)}
  if(refundRes.error){refundBox.innerHTML='<div class="loading">讀取失敗</div>';return toast('讀取待退款失敗：'+refundRes.error.message)}
  const rows=(unpaidRes.data||[]).slice().sort((a,b)=>
    String(a.meal_date||'9999-12-31').localeCompare(String(b.meal_date||'9999-12-31'))||
    Number(a.seat_number||99999)-Number(b.seat_number||99999)||
    Number(a.order_id||0)-Number(b.order_id||0)
  ),refunds=refundRes.data||[];
  const totalDue=rows.reduce((a,x)=>a+Number(x.amount_due||0),0);
  const totalRefund=refunds.reduce((a,x)=>a+Number(x.refund_due||0),0);
  summary.innerHTML=
    '<div class="stat"><small>未付款筆數</small><b>'+rows.length+'</b></div>'+
    '<div class="stat"><small>待收金額</small><b>'+money(totalDue)+'</b></div>'+
    '<div class="stat"><small>今天待退款</small><b>'+money(totalRefund)+'</b></div>';

  if(!rows.length){
    box.innerHTML='<div class="all-paid">✓ 目前沒有未付款訂單</div>';
    return;
  }

  const todayStr=today();
  const addDay=(date,days)=>{
    const d=new Date(date+'T12:00:00+08:00');
    d.setUTCDate(d.getUTCDate()+days);
    return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  };
  const tomorrow=addDay(todayStr,1);
  const grouped=new Map();
  for(const row of rows){
    const key=row.meal_date||'未指定日期';
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(row);
  }

  box.innerHTML=[...grouped.entries()].map(([date,items])=>{
    const label=date===todayStr?'今天 · '+date:date===tomorrow?'明天 · '+date:(date<todayStr?'逾期 · '+date:date);
    const dayTotal=items.reduce((a,x)=>a+Number(x.amount_due||0),0);
    return '<section class="unpaid-day-group">'+
      '<div class="item-stats-head"><h3>'+esc(label)+'</h3><span>'+items.length+' 筆 · '+money(dayTotal)+'</span></div>'+
      '<div class="unpaid-list">'+items.map(x=>
        '<article class="history-row">'+
          '<div class="history-main">'+
            '<div class="history-title"><b>'+esc(x.seat_number+'號 '+(x.name||''))+'</b><span>'+esc(x.menu_name||'')+'</span></div>'+
            '<div class="history-items">'+esc(x.item_name||'未記錄品項')+(x.note?' · 備註：'+esc(x.note):'')+'</div>'+
            '<small>訂單 '+money(x.order_total)+(Number(x.onsite_received||0)>0?' · 已收 '+money(x.onsite_received):'')+(x.unresolved_market_price?' · 尚有時價未定':'')+'</small>'+
          '</div>'+
          '<div class="actions"><strong class="history-price">'+money(x.amount_due)+(x.unresolved_market_price?' ＋ 時價':'')+'</strong> '+
            '<button class="small-btn" type="button" data-unpaid-pay="'+x.order_id+'">標記付款</button></div>'+
        '</article>'
      ).join('')+'</div>'+
    '</section>';
  }).join('');

  box.querySelectorAll('[data-unpaid-pay]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;
    try{
      await window.togglePaid(Number(btn.dataset.unpaidPay),true);
      await loadUnpaidOrders();
    }finally{btn.disabled=false}
  }));

  refundBox.innerHTML=refunds.length?refunds.map(x=>
    '<article class="history-row">'+
      '<div class="history-main">'+
        '<div class="history-title"><b>'+esc(x.seat_number+'號 '+(x.name||''))+'</b><span>'+esc(x.order_date||'')+'</span></div>'+
        '<div class="history-items">'+esc(x.item_name||'未記錄品項')+(x.note?' · 備註：'+esc(x.note):'')+'</div>'+
        '<small>訂單 '+money(x.order_total)+' · 已收 '+money(x.onsite_received)+'</small>'+
      '</div>'+
      '<div class="actions"><strong class="history-price">應退 '+money(x.refund_due)+'</strong> '+
        '<button class="small-btn" type="button" data-refund-due="'+x.order_id+'">已退款</button></div>'+
    '</article>'
  ).join(''):'<div class="all-paid">✓ 今天沒有待退款差額</div>';

  refundBox.querySelectorAll('[data-refund-due]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!confirm('確定已實際把差額退還給學生？'))return;
    btn.disabled=true;
    try{
      const {error}=await db.rpc('class_lunch_admin_refund_onsite_difference',{p_order_id:Number(btn.dataset.refundDue)});
      if(error)throw error;
      toast('退款已記錄');
      await Promise.all([loadUnpaidOrders(),loadOverview()]);
    }catch(error){
      toast('退款失敗：'+error.message);
    }finally{btn.disabled=false}
  }));
}
window.loadUnpaidOrders=loadUnpaidOrders;
$('refreshUnpaidBtn')?.addEventListener('click',loadUnpaidOrders);

