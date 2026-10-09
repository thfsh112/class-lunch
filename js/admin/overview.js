async function loadOverview(){
  const id=Number($('overviewSession').value);if(!id)return;
  const s=sessions.find(x=>x.id===id),legacy=s?.legacy_menu_id||-1;
  const{data:os,error}=await db.from('orders').select('id,student_id,student_name,item_name,unit_price,note,paid,quantity,payment_method,onsite_received,onsite_balance_due,paid_at,order_status,backup_checkout_ready').or('meal_session_id.eq.'+id+',menu_id.eq.'+legacy);
  if(error)return toast(error.message);
  const rawList=os||[];
  const list=rawList.filter(o=>o.order_status==='active'||(o.order_status==='pending_choice'&&o.backup_checkout_ready));
  const paid=list.filter(o=>o.paid).length,total=list.reduce((a,o)=>a+Number(o.unit_price||0)*Number(o.quantity||1),0);
  const isBackup=!!s?.backup_group_id;
  const paidLabel=$('statPaid')?.parentElement?.querySelector('small');
  const unpaidLabel=$('statUnpaidCount')?.parentElement?.querySelector('small');
  const totalLabel=$('statTotal')?.parentElement?.querySelector('small');
  if(paidLabel)paidLabel.textContent=isBackup?'已結算':'已付款';
  if(unpaidLabel)unpaidLabel.textContent=isBackup?'待確認':'未付款';
  if(totalLabel)totalLabel.textContent=isBackup?'預估金額':'總金額';
  $('statOrders').textContent=list.length;$('statPaid').textContent=paid;$('statUnpaidCount').textContent=list.length-paid;

  const itemCounts=new Map(),variantCounts=new Map(),optionCounts=new Map(),normalizedOrders=new Set(),marketByOrder=new Map(),unresolvedOrders=new Set(),orderIds=list.map(o=>o.id);
  if(orderIds.length){
    const{data:oi,error:oie}=await db.from('order_items').select('id,order_id,quantity,unit_price,is_market_price,market_price_amount,variant_name,option_summary,configuration,item_name_snapshot,menu_items(name,is_market_price)').in('order_id',orderIds);
    if(oie)return toast('讀取品項統計失敗：'+oie.message);
    for(const row of (oi||[])){
      const name=row.menu_items?.name;
      if(!name)continue;
      const isMarket=!!(row.is_market_price||row.menu_items?.is_market_price);
      const displayName=name+(isMarket?'（時價）':'');
      normalizedOrders.add(row.order_id);
      if(isMarket){
        if(!marketByOrder.has(row.order_id))marketByOrder.set(row.order_id,[]);
        marketByOrder.get(row.order_id).push(row);
        if(row.market_price_amount==null)unresolvedOrders.add(row.order_id);
      }
      const qty=Number(row.quantity||1);
      itemCounts.set(displayName,(itemCounts.get(displayName)||0)+qty);

      if(row.variant_name){
        const key=name+'｜'+row.variant_name;
        variantCounts.set(key,(variantCounts.get(key)||0)+qty);
      }
      const configOptions=Array.isArray(row.configuration?.options)?row.configuration.options:[];
      for(const opt of configOptions){
        const groupName=String(opt?.group_name||'加購').trim()||'加購';
        const optionName=String(opt?.option_name||'').trim();
        if(!optionName)continue;
        if(!optionCounts.has(groupName))optionCounts.set(groupName,new Map());
        const gm=optionCounts.get(groupName);
        gm.set(optionName,(gm.get(optionName)||0)+qty);
      }
    }
  }
  for(const o of list){
    if(!normalizedOrders.has(o.id)){
      if(String(o.item_name||'').includes('（時價）'))unresolvedOrders.add(o.id);
      const parts=String(o.item_name||'').split(/[、,，]/).map(x=>x.trim()).filter(Boolean);
      for(const raw of parts){
        const m=raw.match(/^(.*?)(?:\s*[×xX]\s*(\d+))?$/);
        const name=(m?.[1]||raw).trim(),qty=Number(m?.[2]||1);
        if(name)itemCounts.set(name,(itemCounts.get(name)||0)+qty);
      }
    }
  }
  $('statTotal').textContent=money(total)+(unresolvedOrders.size?' ＋ 時價':'');
  const itemRows=[...itemCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'));
  const variantRows=[...variantCounts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'));
  const optionSections=[...optionCounts.entries()]
    .map(([group,counts])=>[group,[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'zh-Hant'))])
    .sort((a,b)=>a[0].localeCompare(b[0],'zh-Hant'));
  const totalQty=itemRows.reduce((a,x)=>a+x[1],0);
  const comboCopyLines=[
    ...(variantRows.length?['────────','【點餐方式】',...variantRows.map(([name,qty])=>name+'：'+qty+'份')]:[]),
    ...optionSections.flatMap(([group,rows])=>rows.length?['────────','【'+group+'】',...rows.map(([name,qty])=>name+'：'+qty+'份')]:[])
  ];
  const noteRows=list
    .map(o=>{
      const note=String(o.note||'').trim();
      if(!note)return null;
      const st=students.find(x=>x.id===o.student_id);
      const seat=st?.seat_number||Number(o.student_name)||'？';
      const name=st?.name||'';
      return {seat,name,item:o.item_name||'未記錄品項',note};
    })
    .filter(Boolean)
    .sort((a,b)=>Number(a.seat||999)-Number(b.seat||999));
  const sessionLabel=[s?.meal_date,s?.menu_templates?.name||'菜單'].filter(Boolean).join(' ');
  const unpaidRows=list.filter(o=>!o.paid).map(o=>{
    const st=students.find(x=>x.id===o.student_id);
    const seat=st?.seat_number||Number(o.student_name)||'？';
    return {seat,name:st?.name||'',item:o.item_name||'未記錄品項',amount:Number(o.unit_price||0),market:unresolvedOrders.has(o.id)};
  }).sort((a,b)=>Number(a.seat||999)-Number(b.seat||999));
  latestUnpaidCopyText=unpaidRows.length?[
    '【'+sessionLabel+' 未付款名單】',
    ...unpaidRows.map(x=>x.seat+'號'+(x.name?' '+x.name:'')+'｜'+x.item+'｜'+money(x.amount)+(x.market?' ＋ 時價':'')),
    '────────',
    '共 '+unpaidRows.length+' 人未付款'
  ].join('\n'):'';
  $('unpaidSummary').innerHTML='<div class="item-stats-head"><h3>未付款名單</h3><div class="btnrow"><span>'+unpaidRows.length+' 人</span>'+(unpaidRows.length?'<button class="small-btn" type="button" onclick="copyUnpaidList()">一鍵複製 LINE</button>':'')+'</div></div>'+
    (unpaidRows.length?'<div class="unpaid-list">'+unpaidRows.map(x=>'<div class="item-stat-row"><span><b>'+esc(x.seat+'號'+(x.name?' '+x.name:''))+'</b><br><small>'+esc(x.item)+'</small></span><strong>'+money(x.amount)+(x.market?' ＋ 時價':'')+'</strong></div>').join('')+'</div>':'<div class="all-paid">✓ 目前全部已付款</div>');
  latestOverviewCopyText=[
    '【'+sessionLabel+' 訂餐統計】',
    ...(itemRows.length?itemRows.map(([name,qty])=>name+'：'+qty+'份'):['目前沒有品項']),
    ...comboCopyLines,
    ...(noteRows.length?[
      '────────',
      '【備註】',
      ...noteRows.map(x=>x.seat+'號'+(x.name?' '+x.name:'')+'｜'+x.item+'｜'+x.note)
    ]:[]),
    '────────',
    '總份數：'+totalQty+'份',
    '已訂：'+list.length+'人',
    '已付款：'+paid+'人｜未付款：'+(list.length-paid)+'人',
    '總金額：'+money(total)+(unresolvedOrders.size?' ＋ 時價':'')
  ].join('\n');
  const comboStatsHtml=
    (variantRows.length?'<div class="combo-stats-section"><h3>點餐方式</h3><div class="item-stats-table">'+variantRows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+'</span><b>'+qty+' 份</b></div>').join('')+'</div></div>':'')+
    optionSections.map(([group,rows])=>'<div class="combo-stats-section"><h3>'+esc(group)+'</h3><div class="item-stats-table">'+rows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+'</span><b>'+qty+' 份</b></div>').join('')+'</div></div>').join('');
  $('itemStats').innerHTML='<div class="item-stats-head"><h3>品項統計</h3><div class="btnrow"><span>'+totalQty+' 份</span><button class="small-btn" type="button" onclick="copyOverviewStats()">一鍵複製 LINE</button></div></div>'+
    (itemRows.length?'<div class="item-stats-table">'+itemRows.map(([name,qty])=>'<div class="item-stat-row"><span>'+esc(name)+(name.includes('（時價）')?' <em class="market-badge">時價</em>':'')+'</span><b>'+qty+' 份</b></div>').join('')+'</div>':'<div class="loading">目前沒有品項</div>')+
    comboStatsHtml+
    (noteRows.length?'<div class="order-notes-summary"><h3>備註</h3>'+noteRows.map(x=>'<div class="item-stat-row"><span><b>'+esc(x.seat+'號'+(x.name?' '+x.name:''))+'</b><br><small>'+esc(x.item)+'</small></span><strong>'+esc(x.note)+'</strong></div>').join('')+'</div>':'');

  const bySeat=new Map();for(const o of list){const st=students.find(s=>s.id===o.student_id),seat=st?.seat_number??Number(o.student_name);if(Number.isInteger(Number(seat)))bySeat.set(Number(seat),{...o,name:st?.name||''})}
  const rosterSeats=students
    .filter(s=>s.active&&['teacher','student'].includes(String(s.role||'')))
    .map(s=>Number(s.seat_number))
    .filter(Number.isInteger);
  const orderedExtraSeats=[...bySeat.keys()].filter(n=>!rosterSeats.includes(n));
  const seats=[...new Set([...rosterSeats,...orderedExtraSeats])].sort((a,b)=>{
    if(a===0)return -1;if(b===0)return 1;return a-b;
  });
  $('seatPayments').innerHTML='<div class="seat-grid">'+seats.map(n=>{
    const o=bySeat.get(n),st=students.find(s=>s.seat_number===n),hasMarket=o&&marketByOrder.has(o.id),unresolved=o&&unresolvedOrders.has(o.id);
    const refundDue=o&&o.payment_method==='onsite'&&Number(o.onsite_balance_due||0)<0?Math.abs(Number(o.onsite_balance_due||0)):0;
    const collectDue=o&&o.payment_method==='onsite'&&Number(o.onsite_balance_due||0)>0?Number(o.onsite_balance_due||0):0;
    return '<div class="seat-card '+(!o?'seat-empty':o.paid?'seat-paid':'seat-unpaid')+'"><b>'+n+'號'+(st?.name?' '+esc(st.name):'')+'</b><span>'+(!o?'未訂':refundDue?'應退款 '+money(refundDue):o.paid?'✓ 已付款':collectDue?'待收 '+money(collectDue):'未付款')+'</span>'+
      (o?'<strong>'+esc(o.item_name)+' · '+money(o.unit_price)+(unresolved?' ＋ 時價':'')+'</strong><small>'+esc(o.note||'')+'</small>'+(o.paid_at?'<small>實收時間 '+esc(fmtAdminTime(o.paid_at))+'</small>':'')+'<small class="easter-note">'+esc(adminPaymentEaster(!!o.paid,o.unit_price))+'</small><div>'+
      (hasMarket?'<button class="small-btn market-btn" onclick="openMarketPriceDialog('+o.id+','+n+')">設定時價</button> ':'')+
      (refundDue?'<button class="small-btn" onclick="refundOnsiteDifference('+o.id+')">退還差額</button> ':'<button class="small-btn" onclick="togglePaid('+o.id+','+(!o.paid)+')">'+(o.paid?'改未付':'標記付款')+'</button> ')+
      '<button class="small-btn danger" onclick="deleteOrder('+o.id+')">刪除</button></div>':'')+'</div>';
  }).join('')+'</div>';
}
async function copyOverviewStats(){
  if(!latestOverviewCopyText)return toast('目前沒有可複製的統計');
  try{
    await navigator.clipboard.writeText(latestOverviewCopyText);
    toast('統計已複製，可直接貼到 LINE');
  }catch{
    const ta=document.createElement('textarea');
    ta.value=latestOverviewCopyText;
    ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
    document.body.appendChild(ta);ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    toast(ok?'統計已複製，可直接貼到 LINE':'複製失敗，請再試一次');
  }
}
async function copyUnpaidList(){
  if(!latestUnpaidCopyText)return toast('目前沒有未付款名單');
  try{
    await navigator.clipboard.writeText(latestUnpaidCopyText);
    toast('未付款名單已複製，可直接貼到 LINE');
  }catch{
    const ta=document.createElement('textarea');
    ta.value=latestUnpaidCopyText;
    ta.setAttribute('readonly','');
    ta.style.position='fixed';ta.style.opacity='0';ta.style.pointerEvents='none';
    document.body.appendChild(ta);ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    toast(ok?'未付款名單已複製，可直接貼到 LINE':'複製失敗，請再試一次');
  }
}

