const{createClient}=supabase;
const db=createClient(APP_CONFIG.supabaseUrl,APP_CONFIG.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storage:window.localStorage,storageKey:'class-lunch-user-auth'}});
const $=id=>document.getElementById(id);
let student=null,sessions=[],orders=[],menuItems=[],menuVariants=[],menuOptionGroups=[],menuOptionChoices=[],orderItemsByOrder={},testSelections=[],editingSessionId=null,backupOrderFlow=null,realtimeChannel=null,realtimeTimer=null,realtimeRefreshMode='',studentViewClassId=null,loadedMenuTemplateKey='',deferredInstallPrompt=null,notificationPermissionStatus=null,pushPermissionSyncing=false,lastStudentRefreshStartedAt=0;
const money=n=>'$'+Number(n||0).toLocaleString('zh-TW');
const PUSH_VAPID_PUBLIC_KEY='BIfooHITgKhbwNm9ufy7fUdoyaU46cxxSFFoAOPQrKHJ4RPHzsqYQb9CEMWflB4PlXmpyptPHWl-fvgiWjeW_kE';
const PUSH_DEVICE_OPT_IN_KEY='class-lunch-push-device-opt-in-v1';
const PUSH_LAST_SYNC_KEY='class-lunch-push-last-sync-v1';
const PUSH_SYNC_TTL_MS=12*60*60*1000;
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
