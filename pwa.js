(()=>{
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
      let reg=await navigator.serviceWorker.register(
        "/class-lunch/service-worker.js?v=20261003-19",
        {scope:"/class-lunch/",updateViaCache:"none"}
      );
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
})();
