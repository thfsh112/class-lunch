const STATIC_CACHE="class-lunch-static-v20261003-11";
const IMAGE_CACHE="class-lunch-menu-images-v1";

const APP_SHELL=[
  "./index.html",
  "./admin.html",
  "./style.css?v=20261003-11",
  "./app.js?v=20261003-11",
  "./admin.js?v=20261003-11",
  "./pwa.js?v=20261003-11",
  "./manifest.webmanifest?v=20261003-11",
  "./install-icon-192.png?v=20261003-11",
  "./icon-512.svg?v=20261003-11"
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
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(key=>key.startsWith("class-lunch-")&&key!==STATIC_CACHE&&key!==IMAGE_CACHE)
          .map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
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

  if(event.request.mode==="navigate"){
    event.respondWith(
      fetch(event.request).then(response=>{
        if(response&&response.ok){
          caches.open(STATIC_CACHE).then(cache=>cache.put(event.request,response.clone())).catch(()=>null);
        }
        return response;
      }).catch(async()=>{
        return (await caches.match(event.request)) ||
          (await caches.match("./index.html")) ||
          Response.error();
      })
    );
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
