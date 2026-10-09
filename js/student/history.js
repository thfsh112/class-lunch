function fmtDate(v){const d=new Date(v+'T00:00:00');return d.toLocaleDateString('zh-TW',{month:'numeric',day:'numeric',weekday:'short'})}
function fmtCutoff(v){if(!v)return'';return new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}
const HISTORY_DB_NAME='class-lunch-history-v1';
const HISTORY_DB_VERSION=1;
let historyDbPromise=null;
function getHistoryDb(){
  if(historyDbPromise)return historyDbPromise;
  historyDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(HISTORY_DB_NAME,HISTORY_DB_VERSION);
    req.onupgradeneeded=()=>{
      const idb=req.result;
      if(!idb.objectStoreNames.contains('orders')){
        const store=idb.createObjectStore('orders',{keyPath:'cache_key'});
        store.createIndex('student_id','student_id',{unique:false});
      }
      if(!idb.objectStoreNames.contains('meta'))idb.createObjectStore('meta',{keyPath:'key'});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('indexeddb_open_failed'));
  });
  return historyDbPromise;
}
const idbResult=req=>new Promise((resolve,reject)=>{
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||new Error('indexeddb_request_failed'));
});
async function getCachedHistory(studentId){
  const idb=await getHistoryDb();
  const tx=idb.transaction('orders','readonly');
  const rows=await idbResult(tx.objectStore('orders').index('student_id').getAll(IDBKeyRange.only(studentId)));
  return (rows||[]).sort((a,b)=>{
    const ad=String(a.order_date||a.meal_date||''),bd=String(b.order_date||b.meal_date||'');
    if(ad!==bd)return bd.localeCompare(ad);
    return String(b.created_at||'').localeCompare(String(a.created_at||''));
  });
}
async function getHistorySyncCursor(studentId){
  const idb=await getHistoryDb();
  const tx=idb.transaction('meta','readonly');
  const row=await idbResult(tx.objectStore('meta').get('history-sync:'+studentId));
  return row?.value||null;
}
async function applyHistoryDelta(studentId,delta){
  const idb=await getHistoryDb();
  await new Promise((resolve,reject)=>{
    const tx=idb.transaction(['orders','meta'],'readwrite');
    const ordersStore=tx.objectStore('orders');
    for(const row of (delta?.upserts||[])){
      ordersStore.put({...row,student_id:studentId,cache_key:studentId+':'+row.id});
    }
    for(const id of (delta?.deleted||[])){
      ordersStore.delete(studentId+':'+id);
    }
    if(delta?.sync_at){
      tx.objectStore('meta').put({key:'history-sync:'+studentId,value:delta.sync_at});
    }
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('indexeddb_write_failed'));
    tx.onabort=()=>reject(tx.error||new Error('indexeddb_write_aborted'));
  });
}
async function syncHistoryDelta(){
  if(!student)return [];
  const since=await getHistorySyncCursor(student.id);
  const{data,error}=await db.rpc('get_class_lunch_history_delta',{p_since:since||null});
  if(error)throw error;
  await applyHistoryDelta(student.id,data||{});
  return getCachedHistory(student.id);
}
function renderHistoryList(list){
  const rows=list||[];
  const financialRows=rows.filter(o=>!['cancelled_backup','cancelled_restaurant','pending_choice'].includes(o.order_status));
  const total=financialRows.reduce((sum,o)=>sum+Number(o.unit_price||0),0);
  const paid=financialRows.filter(o=>o.paid).length;
  const unpaid=financialRows.filter(o=>!o.paid).length;
  const hasMarket=financialRows.some(o=>o.unresolved_market);
  const loyaltyBadges=loyaltyStreakBadges(rows);
  $('historyCount').textContent=rows.length;
  $('historyTotal').textContent=money(total)+(hasMarket?' ＋ 時價':'');
  $('historyPaid').textContent=paid;
  $('historyUnpaid').textContent=unpaid;
  $('historyList').innerHTML=rows.length?rows.map((o,i)=>{
    const date=o.meal_date||o.order_date||'';
    const shop=o.menu_name||'歷史訂單';
    const streak=loyaltyBadges.get(i);
    return '<article class="history-row">'+
      '<div class="history-date">'+esc(date?fmtDate(date):'—')+'</div>'+
      '<div class="history-main"><div class="history-title"><b>'+esc(shop)+'</b><span class="'+(o.paid?'history-paid':'history-unpaid')+'">'+(o.order_status==='cancelled_restaurant'?'餐廳未接單・已取消':o.order_status==='cancelled_backup'?'備用未採用':o.order_status==='pending_choice'?'等待採用':o.paid?'已付款':'未付款')+'</span>'+(streak?'<span class="loyalty-badge">忠誠顧客 ×'+streak+'</span>':'')+'</div>'+
      '<div class="history-items">'+esc(o.item_name||'未記錄品項')+'</div>'+
      (o.note?'<small>備註：'+esc(o.note)+'</small>':'')+
      (!['cancelled_backup','cancelled_restaurant','pending_choice'].includes(o.order_status)?'<small class="easter-note">'+esc(paymentEaster(!!o.paid,o.unit_price))+'</small>':'')+'</div>'+
      '<strong class="history-price">'+money(o.unit_price)+(o.unresolved_market?' ＋ 時價':'')+'</strong>'+
    '</article>';
  }).join(''):'<div class="history-empty"><b>還沒有歷史訂單</b><span>完成第一次訂餐後會出現在這裡。</span></div>';
}
function expired(s){return !!s.cutoff_at&&new Date(s.cutoff_at).getTime()<=Date.now()}
function countdown(s){
  if(!s.cutoff_at)return '未設定截止時間';
  const ms=new Date(s.cutoff_at).getTime()-Date.now();
  if(ms<=0)return '已截止';
  const mins=Math.max(1,Math.ceil(ms/60000)),days=Math.floor(mins/1440),hrs=Math.floor((mins%1440)/60),m=mins%60;
  if(days>0)return '剩餘 '+days+'天 '+hrs+'小時';
  if(hrs>0)return '剩餘 '+hrs+'小時 '+m+'分';
  if(mins<=3)return '剩餘 '+mins+'分 · 詠丞小弟弟正在看著你';
  if(mins<=10)return '剩餘 '+mins+'分 · 現在才來？';
  if(mins<=30)return '剩餘 '+mins+'分 · 你還有機會';
  return '即將截止 · 剩餘 '+mins+'分';
}
function validSeat(seat){return Number.isInteger(seat)&&seat>=1&&seat<=9999}
function safeClassCode(v){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'')}
function internalEmail(classCode,seat){
  const n=Number(seat),code=String(classCode||'').trim();
  if(n===99)return 'seat99@class-lunch.example';
  if(code==='112'&&n>=1&&n<=35)return 'seat'+String(n).padStart(2,'0')+'@class-lunch.example';
  return 'class'+safeClassCode(code)+'-seat'+String(n)+'@class-lunch.example';
}
function authPassword(raw){return 'CLP:'+String(raw)+':2026'}
