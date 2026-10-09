function scheduleStudentRealtimeRefresh(mode='orders'){
  if(mode==='full')realtimeRefreshMode='full';
  else if(!realtimeRefreshMode)realtimeRefreshMode='orders';
  clearTimeout(realtimeTimer);
  realtimeTimer=setTimeout(async()=>{
    if(!student)return;
    const modeNow=realtimeRefreshMode||'orders';
    realtimeRefreshMode='';
    if(modeNow==='full')await loadSessions({forceMenus:true});
    else await refreshOwnOrders();
  },350);
}
function startStudentRealtime(){
  if(realtimeChannel||!student||!studentViewClassId||document.hidden||$('studentApp')?.classList.contains('hidden'))return;
  realtimeChannel=db.channel('class-lunch-student-realtime-'+String(student.id))
    .on('postgres_changes',{
      event:'*',schema:'public',table:'orders',
      filter:'student_id=eq.'+String(student.id)
    },()=>scheduleStudentRealtimeRefresh('orders'))
    .on('postgres_changes',{
      event:'*',schema:'public',table:'meal_sessions',
      filter:'class_id=eq.'+String(studentViewClassId)
    },()=>scheduleStudentRealtimeRefresh('full'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_items'},()=>scheduleStudentRealtimeRefresh('full'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_templates'},()=>scheduleStudentRealtimeRefresh('full'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_item_variants'},()=>scheduleStudentRealtimeRefresh('full'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_option_groups'},()=>scheduleStudentRealtimeRefresh('full'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_option_choices'},()=>scheduleStudentRealtimeRefresh('full'))
    .subscribe();
}
function stopStudentRealtime(){
  clearTimeout(realtimeTimer);
  if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null}
}
setInterval(()=>{if(student&&sessions.length)renderSessions()},30000);
db.auth.onAuthStateChange(()=>setTimeout(()=>{if(Date.now()-lastStudentRefreshStartedAt>1500)refresh()},150));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopStudentRealtime();return}
  if(student&&!$('studentApp')?.classList.contains('hidden')){
    startStudentRealtime();
    loadSessions({forceMenus:true}).catch(()=>{});
  }
});
$('historyDialog')?.addEventListener('close',()=>startStudentRealtime());
$('accountDialog')?.addEventListener('close',()=>startStudentRealtime());
if($('classLogin')){
  $('classLogin').placeholder='';
  $('classLogin').value=localStorage.getItem('class-lunch-last-class')||'112';
}
$('seatLogin')?.addEventListener('input',()=>{
  const account=String($('seatLogin').value||'').trim().toLowerCase();
  if(account==='99'){
    $('classLogin').value='';
    return;
  }
  if(!$('classLogin').value)$('classLogin').value=localStorage.getItem('class-lunch-last-class')||'112';
});
renderHomeEasterSubtitle();
refreshInstallStatus();
setTimeout(refreshInstallStatus,32000);
watchNotificationPermission();
refresh();
$('rebuildPushBtn')?.addEventListener('click',rebuildPushNotifications);
