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
function currentPushBindingKey(endpoint){
  if(!student)return '';
  const classContext=student.role==='system_admin'
    ?String(localStorage.getItem('class-lunch-last-class')||'99').trim()
    :String(student.class_id||'');
  return [String(endpoint||''),String(student.id||''),classContext].join('|');
}
function pushSyncIsFresh(endpoint){
  try{
    const saved=JSON.parse(localStorage.getItem(PUSH_LAST_SYNC_KEY)||'null');
    return !!saved
      && saved.key===currentPushBindingKey(endpoint)
      && Date.now()-Number(saved.at||0)<PUSH_SYNC_TTL_MS;
  }catch{return false}
}
async function upsertCurrentPushSubscription(subscription,force=false){
  if(!subscription||!student)return;
  const json=subscription.toJSON();
  if(!json.endpoint||!json.keys?.p256dh||!json.keys?.auth)throw new Error('subscription_keys_missing');
  if(!force&&pushSyncIsFresh(json.endpoint))return;
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
  localStorage.setItem(PUSH_LAST_SYNC_KEY,JSON.stringify({
    key:currentPushBindingKey(json.endpoint),
    at:Date.now()
  }));
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
    await upsertCurrentPushSubscription(sub,true);
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
    await upsertCurrentPushSubscription(newSub,true);
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
  localStorage.removeItem(PUSH_LAST_SYNC_KEY);
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
  localStorage.removeItem(PUSH_LAST_SYNC_KEY);
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
