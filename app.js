const{createClient}=supabase;
const db=createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'class-lunch-user-auth'}});
const $=id=>document.getElementById(id);
let student=null,sessions=[],orders=[],menuItems=[],orderItemsByOrder={},testSelections=[],editingSessionId=null,realtimeChannel=null,realtimeTimer=null,deferredInstallPrompt=null,notificationPermissionStatus=null,pushPermissionSyncing=false;
const money=n=>'$'+Number(n||0).toLocaleString('zh-TW');
const PUSH_VAPID_PUBLIC_KEY='BIfooHITgKhbwNm9ufy7fUdoyaU46cxxSFFoAOPQrKHJ4RPHzsqYQb9CEMWflB4PlXmpyptPHWl-fvgiWjeW_kE';
const PUSH_DEVICE_OPT_IN_KEY='class-lunch-push-device-opt-in-v1';
function devicePushOptedIn(){return localStorage.getItem(PUSH_DEVICE_OPT_IN_KEY)==='1'}
function setDevicePushOptIn(enabled){localStorage.setItem(PUSH_DEVICE_OPT_IN_KEY,enabled?'1':'0')}
async function initializeDevicePushPreference(){
  if(localStorage.getItem(PUSH_DEVICE_OPT_IN_KEY)!==null)return;
  const sub=await getCurrentPushSubscription();
  setDevicePushOptIn(!!sub);
}
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function compareAppVersions(a,b){
  const aa=String(a||'').split('.').map(n=>Number(n)||0),bb=String(b||'').split('.').map(n=>Number(n)||0);
  const len=Math.max(aa.length,bb.length);
  for(let i=0;i<len;i++){
    const diff=(aa[i]||0)-(bb[i]||0);
    if(diff)return diff;
  }
  return 0;
}
async function getLatestAppVersion(){
  const url='./version.json?_='+Date.now();
  const response=await fetch(url,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!response.ok)throw new Error('version_check_http_'+response.status);
  const data=await response.json();
  const version=String(data?.version||'').trim();
  if(!/^\d+(?:\.\d+)*$/.test(version))throw new Error('version_check_invalid');
  return version;
}
function showVersionOutdatedDialog(currentVersion,latestVersion){
  const current=$('versionCurrent'),latest=$('versionLatest'),dialog=$('versionOutdatedDialog');
  if(current)current.textContent=currentVersion||'—';
  if(latest)latest.textContent=latestVersion||'—';
  if(dialog&&!dialog.open)dialog.showModal();
}
async function ensureLatestVersionBeforeOrdering(){
  const currentVersion=String(window.CLASS_LUNCH_APP_VERSION||'').trim();
  if(!currentVersion)return true;
  try{
    const latestVersion=await getLatestAppVersion();
    if(compareAppVersions(currentVersion,latestVersion)>=0)return true;
    showVersionOutdatedDialog(currentVersion,latestVersion);
    return false;
  }catch(error){
    console.warn('class_lunch_version_check_failed',error);
    return true;
  }
}
$('updateNowBtn')?.addEventListener('click',()=>{
  const btn=$('updateNowBtn');
  if(typeof window.forceClassLunchUpdate==='function'){
    window.forceClassLunchUpdate(btn);
    return;
  }
  if(btn){btn.disabled=true;btn.textContent='更新中…';}
  const u=new URL(location.href);
  u.searchParams.set('_refresh',Date.now().toString());
  location.replace(u.href);
});
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
const HOME_EASTER_LINES=[
  '系統無法替你決定人生，但可以替你記便當。',
  '午餐不是人生全部，但餓的時候差不多。',
  '今天最大的決策：到底要吃什麼。',
  '你的胃沒有投票權，但它很有意見。',
  '請謹慎下單，便當會記得你的選擇。',
  '人生很難，午餐先處理。'
];
function renderHomeEasterSubtitle(){
  const el=$('lunchEasterSubtitle');
  if(!el)return;
  el.textContent=HOME_EASTER_LINES[Math.floor(Math.random()*HOME_EASTER_LINES.length)];
}
function paymentEaster(paid,amount){
  const value=money(amount);
  return paid?'錢包已成功瘦身 '+value:'便當宇宙仍記得這筆 '+value;
}
function loyaltyStreakBadges(rows){
  const badges=new Map();
  let i=0;
  while(i<rows.length){
    const shop=String(rows[i]?.menu_name||'').trim();
    let j=i+1;
    while(shop&&j<rows.length&&String(rows[j]?.menu_name||'').trim()===shop)j++;
    const streak=j-i;
    if(shop&&streak>=3)badges.set(i,streak);
    i=j;
  }
  return badges;
}
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
  const total=rows.reduce((sum,o)=>sum+Number(o.unit_price||0),0);
  const paid=rows.filter(o=>o.paid).length;
  const hasMarket=rows.some(o=>o.unresolved_market);
  const loyaltyBadges=loyaltyStreakBadges(rows);
  $('historyCount').textContent=rows.length;
  $('historyTotal').textContent=money(total)+(hasMarket?' ＋ 時價':'');
  $('historyPaid').textContent=paid;
  $('historyUnpaid').textContent=rows.length-paid;
  $('historyList').innerHTML=rows.length?rows.map((o,i)=>{
    const date=o.meal_date||o.order_date||'';
    const shop=o.menu_name||'歷史訂單';
    const streak=loyaltyBadges.get(i);
    return '<article class="history-row">'+
      '<div class="history-date">'+esc(date?fmtDate(date):'—')+'</div>'+
      '<div class="history-main"><div class="history-title"><b>'+esc(shop)+'</b><span class="'+(o.paid?'history-paid':'history-unpaid')+'">'+(o.paid?'已付款':'未付款')+'</span>'+(streak?'<span class="loyalty-badge">忠誠顧客 ×'+streak+'</span>':'')+'</div>'+
      '<div class="history-items">'+esc(o.item_name||'未記錄品項')+'</div>'+
      (o.note?'<small>備註：'+esc(o.note)+'</small>':'')+
      '<small class="easter-note">'+esc(paymentEaster(!!o.paid,o.unit_price))+'</small></div>'+
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
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const rawData=atob(base64);
  return Uint8Array.from([...rawData].map(ch=>ch.charCodeAt(0)));
}
async function getPushRegistration(){
  if(!('serviceWorker' in navigator))return null;
  const expectedScope=new URL('/class-lunch/',location.origin).href;
  let reg=window.CLASS_LUNCH_PWA_STATUS?.registration||null;
  if(!reg||reg.scope!==expectedScope){
    reg=await navigator.serviceWorker.getRegistration('/class-lunch/');
  }
  if(!reg){
    await navigator.serviceWorker.ready;
    reg=await navigator.serviceWorker.getRegistration('/class-lunch/');
  }
  return reg||null;
}
async function getCurrentPushSubscription(){
  try{
    const reg=await getPushRegistration();
    return reg?await reg.pushManager.getSubscription():null;
  }catch{return null}
}
function isStandalonePwa(){
  return window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
}
function isAppleMobile(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
}
function isSafariBrowser(){
  const ua=navigator.userAgent;
  return /Safari/i.test(ua)&&!/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
}
function refreshInstallStatus(){
  const box=$('installBox'),btn=$('installAppBtn'),text=$('installStatusText');
  if(!box||!btn||!text)return;
  if(isStandalonePwa()){
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  if(isAppleMobile()){
    text.textContent=isSafariBrowser()
      ?'iPhone / iPad 可安裝為主畫面 App。'
      :'Apple 系統可安裝 App；建議用 Safari 開啟後加入主畫面。';
    btn.disabled=false;
    btn.textContent='安裝 App';
    return;
  }
  const pwa=window.CLASS_LUNCH_PWA_STATUS;
  if(pwa&&pwa.supported===false){
    text.textContent='此瀏覽器不支援 Service Worker，無法安裝完整 App。';
    btn.disabled=true;
    return;
  }
  if(pwa&&pwa.error){
    text.textContent='PWA 服務啟動失敗：'+pwa.error;
    btn.disabled=true;
    return;
  }
  if(deferredInstallPrompt){
    text.textContent='已符合 App 安裝條件，可直接安裝。';
    btn.disabled=false;
    btn.textContent='安裝 App';
  }else if(pwa?.ready){
    text.textContent='PWA 服務已就緒，等待 Chrome 提供安裝資格。';
    btn.disabled=false;
    btn.textContent='檢查並安裝';
  }else{
    text.textContent='正在啟動 PWA 服務…';
    btn.disabled=true;
    btn.textContent='準備中';
  }
}
window.addEventListener('beforeinstallprompt',event=>{
  deferredInstallPrompt=event;
  refreshInstallStatus();
});
window.addEventListener('class-lunch-pwa-status',refreshInstallStatus);
window.addEventListener('appinstalled',()=>{
  deferredInstallPrompt=null;
  refreshInstallStatus();
  toast('班級訂飯已安裝');
});
async function upsertCurrentPushSubscription(subscription){
  if(!subscription)return;
  const json=subscription.toJSON();
  if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw new Error('subscription_keys_missing');
  const{data,error}=await db.functions.invoke('class-lunch-push',{body:{
    action:'subscribe',
    subscription:{
      endpoint:json.endpoint,
      keys:{p256dh:json.keys.p256dh,auth:json.keys.auth}
    }
  }});
  if(error)throw error;
  if(data?.error)throw new Error(data.error);
  if(student?.role==='system_admin'){
    const bind=await db.rpc('class_lunch_bind_system_admin_push',{p_endpoint:json.endpoint});
    if(bind.error)throw bind.error;
  }
}
async function syncPushAfterPermissionGranted(showToast=true){
  if(pushPermissionSyncing||Notification.permission!=='granted'||!devicePushOptedIn())return;
  pushPermissionSyncing=true;
  try{
    const reg=await getPushRegistration();
    if(!reg)throw new Error('service_worker_missing');
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
      });
    }
    await upsertCurrentPushSubscription(sub);
    await refreshPushStatus();
    if(showToast)toast('訂餐通知已開啟');
  }catch(error){
    console.error('push_permission_sync_failed',error);
    const status=$('pushStatusText');
    if(status)status.textContent='通知已允許，但推播訂閱建立失敗：'+String(error?.message||error);
  }finally{
    pushPermissionSyncing=false;
  }
}
async function watchNotificationPermission(){
  if(!('permissions' in navigator)||!('Notification' in window))return;
  try{
    await initializeDevicePushPreference();
    notificationPermissionStatus=await navigator.permissions.query({name:'notifications'});
    notificationPermissionStatus.onchange=async()=>{
      await refreshPushStatus();
      if(notificationPermissionStatus.state==='granted'&&devicePushOptedIn()){
        await syncPushAfterPermissionGranted(true);
      }
    };
    if(notificationPermissionStatus.state==='granted'&&devicePushOptedIn()){
      await syncPushAfterPermissionGranted(false);
    }
  }catch(error){
    console.warn('notification_permission_watch_failed',error);
  }
}
async function refreshPushStatus(){
  const status=$('pushStatusText'),enable=$('enablePushBtn'),disable=$('disablePushBtn'),rebuild=$('rebuildPushBtn');
  if(!status||!enable||!disable)return;
  if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator)){
    status.textContent='此瀏覽器不支援系統推播通知。';
    enable.disabled=true;disable.classList.add('hidden');return;
  }
  await initializeDevicePushPreference();
  const sub=await getCurrentPushSubscription();
  if(Notification.permission==='granted'&&sub&&devicePushOptedIn()){
    status.textContent='通知已開啟（僅此裝置）。';
    enable.classList.add('hidden');disable.classList.remove('hidden');rebuild?.classList.remove('hidden');
    try{await upsertCurrentPushSubscription(sub)}catch(error){console.warn('push_sync_failed',error)}
    return;
  }
  enable.classList.remove('hidden');disable.classList.add('hidden');rebuild?.classList.add('hidden');
  if(Notification.permission==='denied'){
    status.textContent='通知權限已被封鎖，請到瀏覽器或系統設定重新允許。';
    enable.disabled=true;
  }else{
    status.textContent='目前尚未開啟通知。';
    enable.disabled=false;
  }
}
async function enablePushNotifications(){
  if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator))return toast('此裝置不支援推播通知');
  const permission=await Notification.requestPermission();
  if(permission!=='granted'){
    await refreshPushStatus();
    if(permission==='default'){
      const status=$('pushStatusText');
      const msg='Chrome 尚未取得決定。請點網址列左邊的網站控制圖示 → 通知 → 允許，再回來按一次「開啟通知」。';
      if(status)status.textContent=msg;
      return toast('請允許通知後，再按一次開啟通知');
    }
    return toast('通知已被封鎖，請到網站權限重新允許');
  }
  try{
    const reg=await getPushRegistration();
    if(!reg)throw new Error('service_worker_missing');
    let sub=await reg.pushManager.getSubscription();
    if(!sub){
      sub=await reg.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
      });
    }
    await upsertCurrentPushSubscription(sub);
    setDevicePushOptIn(true);
    await refreshPushStatus();
    toast('此裝置的訂餐通知已開啟');
  }catch(error){
    console.error('push_enable_failed',error);
    const status=$('pushStatusText');
    const name=String(error?.name||'');
    const message=String(error?.message||error||'未知錯誤');
    let readable='開啟通知失敗：'+(name?name+' · ':'')+message;
    if(name==='NotAllowedError'||/permission|denied|not.?allowed/i.test(message)){
      readable='通知被瀏覽器或系統封鎖，請到通知權限設定允許後再試。';
    }else if(name==='AbortError'){
      readable='瀏覽器無法建立推播訂閱，請確認瀏覽器與系統通知功能可用後再試。';
    }else if(/service_worker_missing/i.test(message)){
      readable='通知服務尚未就緒，請完全關閉「班級訂飯」後重新開啟再試。';
    }
    if(status)status.textContent=readable;
    toast(readable);
  }
}
async function rebuildPushNotifications(){
  if(!('Notification' in window)||Notification.permission!=='granted')return toast('請先允許通知');
  const btn=$('rebuildPushBtn');
  if(btn){btn.disabled=true;btn.textContent='重建中…';}
  try{
    const reg=await getPushRegistration();
    if(!reg)throw new Error('service_worker_missing');
    const oldSub=await reg.pushManager.getSubscription();
    if(oldSub){
      try{
        await db.functions.invoke('class-lunch-push',{body:{action:'unsubscribe',endpoint:oldSub.endpoint}});
      }catch(error){console.warn('push_rebuild_server_cleanup_failed',error)}
      await oldSub.unsubscribe().catch(()=>false);
    }
    const newSub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY)
    });
    setDevicePushOptIn(true);
    await upsertCurrentPushSubscription(newSub);
    await refreshPushStatus();
    toast('已重新建立這支裝置的推播連線');
  }catch(error){
    console.error('push_rebuild_failed',error);
    toast('重建推播失敗：'+String(error?.message||error));
  }finally{
    if(btn){btn.disabled=false;btn.textContent='重建推播連線';}
  }
}

async function disablePushNotifications(){
  setDevicePushOptIn(false);
  let cleanupFailed=false;
  try{
    const sub=await getCurrentPushSubscription();
    if(sub){
      try{
        const{data,error}=await db.functions.invoke('class-lunch-push',{body:{
          action:'unsubscribe',
          endpoint:sub.endpoint
        }});
        if(error)throw error;
        if(data?.error)throw new Error(data.error);
      }catch(error){
        cleanupFailed=true;
        console.warn('push_server_unsubscribe_failed',error);
      }
      try{await sub.unsubscribe()}catch(error){console.warn('push_local_unsubscribe_failed',error)}
    }
    await refreshPushStatus();
    toast(cleanupFailed?'此裝置通知已關閉；伺服器資料稍後會自動清理':'此裝置的訂餐通知已關閉');
  }catch(error){
    console.error(error);
    await refreshPushStatus();
    toast('此裝置已設為不接收通知');
  }
}
async function detachCurrentPushBinding(){
  try{
    const sub=await getCurrentPushSubscription();
    if(!sub)return;
    const{data,error}=await db.functions.invoke('class-lunch-push',{body:{
      action:'detach',
      endpoint:sub.endpoint
    }});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
  }catch(error){
    console.warn('push_binding_detach_failed',error);
  }
}
async function detachPushBeforeLogout(){
  // 保留瀏覽器通知權限與本機開關，只解除「目前登入 99」的後端收件綁定。
  await detachCurrentPushBinding();
}
async function openAccountDialog(){
  stopStudentRealtime();
  $('passwordForm').reset();
  const locked=student?.role==='system_admin';
  const section=$('passwordChangeSection');
  if(section)section.classList.toggle('hidden',locked);
  const note=$('passwordLockedNote');
  if(note)note.classList.toggle('hidden',!locked);
  $('accountDialog').showModal();
  await refreshPushStatus();
}


$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const classCode=String($('classLogin').value||'').trim();
  const account=String($('seatLogin').value||'').trim().toLowerCase();
  const raw=$('passwordLogin').value;
  if(!classCode)return toast('請輸入班級');

  if(account==='tch'){
    const{data,error}=await db.functions.invoke('class-lunch-teacher-login',{body:{class_code:classCode,account:'tch',password:raw}});
    if(error||data?.error)return toast('班級、帳號或密碼錯誤');
    if(!data?.access_token||!data?.refresh_token)return toast('老師登入失敗');
    const{error:setError}=await db.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token});
    if(setError)return toast('登入失敗：'+setError.message);
    localStorage.setItem('class-lunch-last-class',classCode);
    $('passwordLogin').value='';return refresh();
  }

  const seat=Number(account);
  if(!validSeat(seat))return toast('座號不正確');

  if(seat===99){
    if(raw!=='099')return toast('座號或密碼錯誤');
    const{data:initData,error:initError}=await db.functions.invoke('class-lunch-init-login',{body:{class_code:classCode,seat_number:seat,initial_code:raw}});
    if(initError||initData?.error)return toast('登入失敗：'+(initData?.detail||initData?.error||initError?.message||'未知錯誤'));
    if(!initData?.access_token||!initData?.refresh_token)return toast('登入失敗');
    const{error:setError}=await db.auth.setSession({access_token:initData.access_token,refresh_token:initData.refresh_token});
    if(setError)return toast('登入失敗：'+setError.message);
    localStorage.setItem('class-lunch-last-class',classCode);
    $('passwordLogin').value='';return refresh();
  }

  let loginError=null;
  const email=internalEmail(classCode,seat);
  const direct=await db.auth.signInWithPassword({email,password:authPassword(raw)});
  loginError=direct.error;

  if(loginError){
    const initial3=String(seat).padStart(3,'0');
    const initial4=String(seat).padStart(4,'0');
    if(raw===initial3||raw===initial4){
      const{data:initData,error:initError}=await db.functions.invoke('class-lunch-init-login',{body:{class_code:classCode,seat_number:seat,initial_code:raw}});
      if(!initError&&!initData?.error&&initData?.access_token&&initData?.refresh_token){
        const{error:setError}=await db.auth.setSession({access_token:initData.access_token,refresh_token:initData.refresh_token});
        if(setError)return toast('登入失敗：'+setError.message);
        loginError=null;
      }else{
        return toast('班級、座號或密碼錯誤');
      }
    }
  }

  if(loginError)return toast('班級、座號或密碼錯誤');
  localStorage.setItem('class-lunch-last-class',classCode);
  $('passwordLogin').value='';
  await refresh();
});

$('setupForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const isTeacher=student?.seat_number===0;
  const name=$('setupName').value.trim(),p1=$('setupPassword').value,p2=$('setupPassword2').value;
  if(!isTeacher&&!name)return toast('請輸入姓名');
  if(p1.length<4)return toast('新密碼至少 4 碼');
  if(isTeacher&&p1==='tch')return toast('新密碼不能繼續使用初始密碼 tch');
  if(p1!==p2)return toast('兩次密碼不一致');
  const b=e.currentTarget.querySelector('button[type="submit"]');b.disabled=true;b.textContent='設定中…';
  const result=isTeacher
    ?await db.functions.invoke('class-lunch-teacher-password',{body:{password:p1}})
    :await db.functions.invoke('class-lunch-students',{body:{action:'self_setup',name,password:p1}});
  b.disabled=false;b.textContent='完成設定';
  const{data,error}=result;
  if(error||data?.error)return toast('設定失敗：'+(data?.detail||data?.error||error.message));
  $('setupForm').reset();toast('設定完成');await refresh();
});

$('logoutBtn').addEventListener('click',async()=>{localStorage.removeItem('class-lunch-admin-gate');await detachPushBeforeLogout();await db.auth.signOut({scope:'local'});student=null;refresh()});
$('accountBtn').addEventListener('click',openAccountDialog);
$('notifyBtn').addEventListener('click',openAccountDialog);
$('enablePushBtn').addEventListener('click',enablePushNotifications);
$('disablePushBtn').addEventListener('click',disablePushNotifications);
$('historyBtn').addEventListener('click',openHistory);
$('installAppBtn').addEventListener('click',async()=>{
  if(isStandalonePwa())return toast('已經是 App 模式');
  if(isAppleMobile()){
    $('iosInstallDialog').showModal();
    return;
  }
  if(!deferredInstallPrompt){
    refreshInstallStatus();
    return toast('Chrome 尚未提供安裝；請在頁面停留約 30 秒後再按一次');
  }
  deferredInstallPrompt.prompt();
  const choice=await deferredInstallPrompt.userChoice.catch(()=>null);
  deferredInstallPrompt=null;
  refreshInstallStatus();
  if(choice?.outcome==='accepted')toast('正在安裝班級訂飯');
});
$('copyInstallUrlBtn')?.addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText(location.href);
    toast('網址已複製，可貼到 Safari 開啟');
  }catch{
    toast('複製失敗，請直接用 Safari 開啟目前網址');
  }
});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));

$('passwordForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(student?.role==='system_admin')return toast('99 號密碼固定為 099，不能修改');
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
  const{data:{session}}=await db.auth.getSession();
  if(!session){
    stopStudentRealtime();
    student=null;
    window.dispatchEvent(new Event('class-lunch-student-ready'));
    detachCurrentPushBinding();
    $('loginBox').classList.remove('hidden');$('setupBox').classList.add('hidden');$('studentApp').classList.add('hidden');
    $('heroAccount').classList.add('hidden');$('logoutBtn').classList.add('hidden');$('notifyBtn').classList.add('hidden');$('accountBtn').classList.add('hidden');$('historyBtn').classList.add('hidden');$('adminLink').classList.add('hidden');
    $('welcomeText').textContent='登入後查看開放中的訂餐。';return;
  }

  const{data:{user},error:userError}=await db.auth.getUser();
  if(userError||!user){
    $('welcomeText').textContent='登入狀態仍保留，等待網路恢復後會自動重試。';
    return;
  }

  const{data:s,error}=await db.from('students').select('id,seat_number,name,active,must_setup,role,class_id,classes(code,name)').eq('auth_user_id',user.id).maybeSingle();
  if(error){
    $('welcomeText').textContent='登入狀態仍保留，學生資料暫時讀取失敗。';
    return;
  }
  if(!s||!s.active){await db.auth.signOut();student=null;toast('此學生帳號目前無法使用');return refresh()}
  student=s;
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

async function loadSessions(){
  const{data:ss,error:se}=await db.from('meal_sessions')
    .select('id,meal_date,cutoff_at,is_active,class_id,menu_template_id,menu_templates(id,name,image_url,active)')
    .eq('is_active',true)
    .gte('meal_date',today())
    .order('meal_date');
  if(se)return toast(se.message);

  let visibleSessions=ss||[];
  if(student?.role==='system_admin'){
    const classCode=String(localStorage.getItem('class-lunch-last-class')||'').trim();
    const{data:activeClass,error:classError}=await db.from('classes')
      .select('id,code').eq('code',classCode).eq('active',true).maybeSingle();
    if(classError||!activeClass){
      sessions=[];$('menuCount').textContent='0 份';renderSessionPicker();renderSessions();
      return toast('目前登入班級不存在或已停用');
    }
    visibleSessions=visibleSessions.filter(x=>x.class_id===activeClass.id);
  }

  sessions=visibleSessions.filter(x=>x.menu_templates?.active!==false);
  $('menuCount').textContent=sessions.length+' 份';

  orders=[];menuItems=[];orderItemsByOrder={};
  if(sessions.length){
    const sessionIds=sessions.map(s=>s.id);
    const templateIds=[...new Set(sessions.map(s=>s.menu_template_id))];

    const [{data:os,error:oe},{data:mi,error:me}]=await Promise.all([
      db.from('orders')
        .select('id,meal_session_id,item_name,unit_price,note,paid,payment_method,onsite_received,created_at,menu_item_id')
        .eq('student_id',student.id)
        .in('meal_session_id',sessionIds)
        .order('created_at',{ascending:false}),
      db.from('menu_items')
        .select('id,menu_template_id,category,name,price,is_market_price,active,sort_order')
        .in('menu_template_id',templateIds)
        .eq('active',true)
        .order('sort_order')
        .order('id')
    ]);
    if(oe||me)return toast((oe||me).message);

    orders=os||[];
    menuItems=mi||[];

    const orderIds=orders.map(o=>o.id);
    if(orderIds.length){
      const{data:oi,error:oie}=await db.from('order_items')
        .select('order_id,menu_item_id,quantity,unit_price,is_market_price,market_price_amount')
        .in('order_id',orderIds)
        .order('id');
      if(oie)return toast('讀取訂單品項失敗：'+oie.message);
      for(const row of (oi||[])){
        if(!orderItemsByOrder[row.order_id])orderItemsByOrder[row.order_id]=[];
        orderItemsByOrder[row.order_id].push(row);
      }
    }
  }

  renderSessionPicker();
  renderSessions();
}
function renderSessionPicker(){
  const sel=$('sessionPicker'),previous=Number(sel.value);
  sel.innerHTML=sessions.map(s=>'<option value="'+s.id+'">'+esc(fmtDate(s.meal_date)+'｜'+(s.menu_templates?.name||'菜單'))+'</option>').join('');
  if(previous&&sessions.some(s=>s.id===previous))sel.value=String(previous);else if(sessions.length)sel.value=String(sessions[0].id);
  sel.disabled=sessions.length===0;sel.onchange=renderSessions;
}
function renderSessions(){
  if(!sessions.length){$('menus').innerHTML='<div class="loading lunch-empty-egg"><b>今天暫時沒有便當可以支配你的人生。</b><span>有開放訂餐時會出現在這裡。</span></div>';return}
  const selectedId=Number($('sessionPicker')?.value)||sessions[0].id;
  const s=sessions.find(x=>x.id===selectedId)||sessions[0],o=orders.find(x=>x.meal_session_id===s.id),closed=expired(s);
  const img=s.menu_templates?.image_url?'<div class="photo-button" data-image-url="'+esc(s.menu_templates.image_url)+'"><img class="menu-photo" src="'+esc(s.menu_templates.image_url)+'" alt="菜單"></div>':'<div class="menu-photo placeholder">🍱</div>';
  let state='';
  if(o){
    const rows=orderItemsByOrder[o.id]||[];
    const knownMarket=rows.some(x=>x.is_market_price);
    const unresolvedMarket=rows.some(x=>x.is_market_price&&x.market_price_amount==null)||(!knownMarket&&String(o.item_name||'').includes('（時價）'));
    const hasOnsiteMoney=Number(o.onsite_received||0)!==0;
    state='<div class="order-status '+(o.paid?'paid':'pending')+'"><b>'+(o.paid?'✓ 已付款':'已訂餐 · 未付款')+'</b><div>'+esc(o.item_name)+' · '+money(o.unit_price)+(unresolvedMarket?' ＋ 時價':'')+'</div><small>'+esc(o.note||'無備註')+'</small>'+(hasOnsiteMoney&&!o.paid?'<small>此訂單已有現場收款紀錄，請由管理員處理後續。</small>':'')+'<small class="easter-note">'+esc(paymentEaster(!!o.paid,o.unit_price))+'</small></div>';
    if(!closed&&!o.paid&&!hasOnsiteMoney)state+='<div class="order-actions"><button class="primary" onclick="openOrderEditor('+s.id+')">修改訂單</button><button class="small-btn danger" onclick="cancelOrder('+s.id+')">取消訂單</button></div>';
    else if(!closed&&o.paid&&o.payment_method==='wallet')state+='<div class="order-actions"><button class="small-btn danger" onclick="cancelOrder('+s.id+')">取消訂單並退回錢包</button></div>';
  }else if(closed){
    state='<div class="closed-order">詠丞小弟弟告訴你：<br>便當不點，錢全花在她身上，<br>她說永遠，最後還不是散場。<br>愛情會跑，雞腿不會說謊，<br>與其餓著等她，不如先讓自己吃爽。<br>可惜這次訂餐已經收場，<br>下次早點來，別再對著空胃惆悵。</div>';
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
    const r=await db.rpc('place_class_lunch_order_v6',{p_session_id:editingSessionId,p_items:items,p_note:note,p_payment_method:'onsite'});error=r.error;
  }else{
    const item=$('orderItem').value.trim(),amountRaw=$('orderAmount').value.trim(),amount=Number(amountRaw);
    if(!item){b.disabled=false;b.textContent='儲存訂單';return toast('請輸入品項')}
    if(amountRaw===''||!Number.isInteger(amount)||amount<0||amount>10000){b.disabled=false;b.textContent='儲存訂單';return toast('請輸入 0～10000 的整數金額')}
    const r=await db.rpc('place_class_lunch_order_free_v6',{p_session_id:editingSessionId,p_item_name:item,p_unit_price:amount,p_note:note,p_payment_method:'onsite'});error=r.error;
  }
  b.disabled=false;b.textContent='儲存訂單';
  if(error)return toast('送出失敗：'+error.message);
  $('orderDialog').close();toast('訂單已儲存');await loadSessions();
});
async function cancelOrder(sessionId){
  if(!confirm('確定取消這筆訂單？'))return;
  const{error}=await db.rpc('cancel_class_lunch_order_v3',{p_session_id:sessionId});
  if(error)return toast('取消失敗：'+error.message);
  toast('訂單已取消');await loadSessions();
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
function scheduleStudentRealtimeRefresh(){
  clearTimeout(realtimeTimer);
  realtimeTimer=setTimeout(()=>{if(student)loadSessions()},350);
}
function startStudentRealtime(){
  if(realtimeChannel||!student||document.hidden||$('studentApp')?.classList.contains('hidden'))return;
  realtimeChannel=db.channel('class-lunch-student-realtime')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},scheduleStudentRealtimeRefresh)
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
db.auth.onAuthStateChange(()=>setTimeout(refresh,0));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopStudentRealtime();return}
  if(student&&!$('studentApp')?.classList.contains('hidden')){
    startStudentRealtime();
    loadSessions().catch(()=>{});
  }
});
$('historyDialog')?.addEventListener('close',()=>startStudentRealtime());
$('accountDialog')?.addEventListener('close',()=>startStudentRealtime());
if($('classLogin'))$('classLogin').value=localStorage.getItem('class-lunch-last-class')||'112';
renderHomeEasterSubtitle();
refreshInstallStatus();
setTimeout(refreshInstallStatus,32000);
watchNotificationPermission();
refresh();
$('rebuildPushBtn')?.addEventListener('click',rebuildPushNotifications);
