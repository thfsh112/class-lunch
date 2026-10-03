(()=>{
  if(!("serviceWorker" in navigator))return;

  let refreshing=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(refreshing)return;
    refreshing=true;
    const controller=navigator.serviceWorker.controller;
    if(controller?.scriptURL?.includes("/class-lunch/service-worker.js")){
      location.reload();
    }
  });

  window.addEventListener("load",async()=>{
    try{
      const reg=await navigator.serviceWorker.register("/class-lunch/service-worker.js?v=20261003-14",{scope:"/class-lunch/",updateViaCache:"none"});
      await reg.update().catch(()=>null);
    }catch(err){
      console.warn("Class Lunch service worker registration failed",err);
    }
  });
})();
