const STATIC_CACHE="class-lunch-static-v20261006-109";
const IMAGE_CACHE="class-lunch-menu-images-v1";

const APP_SHELL=[
  "./",
  "./index.html",
  "./admin.html",
  "./style.css?v=20261006-109",
  "./app.js?v=20261006-109",
  "./wallet.js?v=20261006-109",
  "./admin.js?v=20261006-109",
  "./wallet-admin.js?v=20261006-109",
  "./pwa.js?v=20261006-109",
  "./manifest.webmanifest?v=20261006-109",
  "./icon-192.png?v=20261006-109",
  "./icon-512.png?v=20261006-109",
  "./notification-icon.png?v=20261006-109",
  "./notification-badge.png?v=20261006-109"
];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache=>cache.addAll(APP_SHELL))
      .catch(()=>null)
  );
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(
      keys
        .filter(key=>key.startsWith("class-lunch-")&&key!==STATIC_CACHE&&key!==IMAGE_CACHE)
        .map(key=>caches.delete(key))
    );
    await self.clients.claim();

    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    await Promise.all(windows.map(client=>{
      try{
        const u=new URL(client.url);
        if(u.origin!==self.location.origin||!u.pathname.startsWith("/class-lunch/"))return null;
        u.searchParams.set("_sw_refresh",Date.now().toString());
        return client.navigate(u.href).catch(()=>null);
      }catch{
        return null;
      }
    }));
  })());
});

function isMenuImage(request){
  try{
    const url=new URL(request.url);
    return request.destination==="image" &&
      url.hostname.endsWith(".supabase.co") &&
      url.pathname.includes("/storage/v1/") &&
      url.pathname.includes("/menu-images/");
  }catch{
    return false;
  }
}

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;

  if(isMenuImage(event.request)){
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async cache=>{
        const cached=await cache.match(event.request);
        if(cached)return cached;

        const response=await fetch(event.request);
        if(response && (response.ok || response.type==="opaque")){
          cache.put(event.request,response.clone()).catch(()=>null);
        }
        return response;
      })
    );
    return;
  }

  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;

  if(url.pathname.endsWith("/version.json")){
    event.respondWith(fetch(event.request,{cache:"no-store"}));
    return;
  }

  if(event.request.mode==="navigate"){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:"no-store"});
        return response;
      }catch{
        return (await caches.match(event.request)) ||
          (await caches.match("./index.html")) ||
          Response.error();
      }
    })());
    return;
  }

  event.respondWith(
    fetch(event.request).then(response=>{
      if(response&&response.ok){
        caches.open(STATIC_CACHE).then(cache=>cache.put(event.request,response.clone())).catch(()=>null);
      }
      return response;
    }).catch(()=>caches.match(event.request))
  );
});


self.addEventListener("push",event=>{
  let payload={
    title:"班級訂飯",
    body:"訂餐有新通知",
    tag:"class-lunch-notice",
    data:{url:"https://thfsh112.github.io/class-lunch/"}
  };
  if(event.data){
    try{payload={...payload,...event.data.json()}}
    catch{try{payload.body=event.data.text()||payload.body}catch{}}
  }
  event.waitUntil(
    self.registration.showNotification(payload.title||"班級訂飯",{
      body:payload.body||"訂餐有新通知",
      icon:"./notification-icon.png?v=20261006-109",
      badge:"./notification-badge.png?v=20261006-109",
      tag:payload.tag||"class-lunch-notice",
      renotify:true,
      data:payload.data||{url:"https://thfsh112.github.io/class-lunch/"}
    })
  );
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification.data?.url||"https://thfsh112.github.io/class-lunch/";
  event.waitUntil(
    clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
      for(const client of list){
        if("focus" in client){
          client.navigate(target).catch(()=>null);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
