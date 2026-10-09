function scheduleAdminRealtimeRefresh(kind){
  clearTimeout(realtimeTimer);
  realtimeTimer=setTimeout(async()=>{
    if(kind==='sessions'){
      await loadSessions();
    }else{
      await loadOverview();
      if(!$('tab-unpaid')?.classList.contains('hidden'))await loadUnpaidOrders();
    }
  },350);
}
function startAdminRealtime(){
  if(realtimeChannel||!selectedAdminClassId||document.hidden||$('adminApp')?.classList.contains('hidden'))return;
  realtimeChannel=db.channel('class-lunch-admin-realtime-'+selectedAdminClassId)
    .on('postgres_changes',{
      event:'*',schema:'public',table:'orders',
      filter:'class_id=eq.'+selectedAdminClassId
    },()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{
      event:'*',schema:'public',table:'meal_sessions',
      filter:'class_id=eq.'+selectedAdminClassId
    },()=>scheduleAdminRealtimeRefresh('sessions'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_items'},()=>scheduleAdminRealtimeRefresh('orders'))
    .on('postgres_changes',{event:'*',schema:'public',table:'menu_templates'},()=>scheduleAdminRealtimeRefresh('sessions'))
    .subscribe();
}
function stopAdminRealtime(){
  clearTimeout(realtimeTimer);
  if(realtimeChannel){db.removeChannel(realtimeChannel);realtimeChannel=null}
}
db.auth.onAuthStateChange(()=>setTimeout(()=>{if(Date.now()-lastAdminRefreshStartedAt>1500)refresh()},150));
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopAdminRealtime();return}
  if(!$('adminApp')?.classList.contains('hidden')){
    startAdminRealtime();
    Promise.all([loadSessions(),loadStudents()]).catch(()=>{});
  }
});
renderAdminNightEgg();setInterval(renderAdminNightEgg,60000);refresh();