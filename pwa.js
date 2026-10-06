(()=>{
  const DISPLAY_VERSION="1.92";
  window.CLASS_LUNCH_APP_VERSION=DISPLAY_VERSION;
  function compareVersions(a,b){
    const aa=String(a||'').split('.').map(n=>Number(n)||0);
    const bb=String(b||'').split('.').map(n=>Number(n)||0);
    const len=Math.max(aa.length,bb.length);
    for(let i=0;i<len;i++){
      const diff=(aa[i]||0)-(bb[i]||0);
      if(diff)return diff;
    }
    return 0;
  }

  async function checkForAppUpdate(){
    try{
      const response=await fetch('./version.json?_='+Date.now(),{
        cache:'no-store',
        headers:{'Cache-Control':'no-cache'}
      });
      if(!response.ok)return;
      const data=await response.json();
      const latest=String(data?.version||'').trim();
      if(!/^\d+(?:\.\d+)*$/.test(latest))return;
      if(compareVersions(DISPLAY_VERSION,latest)>=0){
        sessionStorage.removeItem('class-lunch-auto-update-target');
        return;
      }

      const key='class-lunch-auto-update-target';
      if(sessionStorage.getItem(key)===latest)return;
      sessionStorage.setItem(key,latest);

      if('caches' in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter(k=>k.startsWith('class-lunch-static-')).map(k=>caches.delete(k)));
      }
      if('serviceWorker' in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.filter(r=>r.scope.includes('/class-lunch/')).map(r=>r.update().catch(()=>null)));
      }

      const u=new URL(location.href);
      u.searchParams.set('_auto_update',latest+'-'+Date.now());
      location.replace(u.href);
    }catch(error){
      console.warn('class_lunch_auto_version_check_failed',error);
    }
  }
  async function forceClassLunchUpdate(triggerButton=null){
    if(triggerButton?.disabled)return;
    if(triggerButton){triggerButton.disabled=true;triggerButton.textContent="更新中…";}
    try{
      if("serviceWorker" in navigator){
        const regs=await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.filter(r=>r.scope.includes("/class-lunch/")).map(r=>r.update().catch(()=>null)));
      }
      if("caches" in window){
        const keys=await caches.keys();
        await Promise.all(keys.filter(k=>k.startsWith("class-lunch-static-")).map(k=>caches.delete(k)));
      }
    }catch(error){console.warn("class_lunch_force_refresh_failed",error)}
    const u=new URL(location.href);
    u.searchParams.set("_refresh",Date.now().toString());
    location.replace(u.href);
  }
  window.forceClassLunchUpdate=forceClassLunchUpdate;
  document.querySelectorAll("[data-app-version]").forEach(btn=>{
    btn.textContent=DISPLAY_VERSION;
    btn.addEventListener("click",()=>forceClassLunchUpdate(btn));
  });
  if(!("serviceWorker" in navigator)){
    window.CLASS_LUNCH_PWA_STATUS={supported:false,ready:false,error:"service_worker_unsupported"};
    return;
  }

  window.CLASS_LUNCH_PWA_STATUS={supported:true,ready:false,error:null,registration:null};

  async function cleanupOldRegistrations(){
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        regs
          .filter(reg=>{
            try{
              const u=new URL(reg.scope);
              return u.origin===location.origin && u.pathname.startsWith("/anonymous/class-lunch/");
            }catch{
              return false;
            }
          })
          .map(reg=>reg.unregister())
      );
    }catch(error){
      console.warn("old_class_lunch_sw_cleanup_failed",error);
    }
  }

  async function registerPwa(){
    try{
      await cleanupOldRegistrations();
      let reg=await navigator.serviceWorker.register("/class-lunch/service-worker.js?v=20261006-95",{scope:"/class-lunch/",updateViaCache:"none"});
      await navigator.serviceWorker.ready;
      try{await reg.update()}catch{}
      window.CLASS_LUNCH_PWA_STATUS={supported:true,ready:true,error:null,registration:reg};
      window.dispatchEvent(new Event("class-lunch-pwa-status"));
      return reg;
    }catch(error){
      console.error("class_lunch_service_worker_registration_failed",error);
      window.CLASS_LUNCH_PWA_STATUS={
        supported:true,
        ready:false,
        error:String(error?.name||"Error")+": "+String(error?.message||error),
        registration:null
      };
      window.dispatchEvent(new Event("class-lunch-pwa-status"));
      return null;
    }
  }

  registerPwa();
  checkForAppUpdate();
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkForAppUpdate()});
})();
