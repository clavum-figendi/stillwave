// Bump the cache version whenever any bundled asset changes.
const SCOPE_PREFIX=`stillwave-shell-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const VERSION=`${SCOPE_PREFIX}v1.0.2`;
const ASSETS=['./','./index.html','./app.bundle.js','./sw.js','./styles.css','./manifest.webmanifest','./js/app.js','./js/settings.js','./js/audio.js','./js/native.js','./js/offline.js','./assets/icon.svg','./assets/icon-192.png','./assets/icon-512.png'];
const urls=ASSETS.map(path=>new URL(path,self.registration.scope).href);
async function check(){
  const cache=await caches.open(VERSION);
  const missing=[];
  for(const url of urls){const response=await cache.match(url);if(!response||!response.ok)missing.push(url);}
  return {ready:missing.length===0,missing,total:urls.length,version:VERSION};
}
async function save(){
  const cache=await caches.open(VERSION),report=await check();
  if(report.missing.length)await cache.addAll(report.missing.map(url=>new Request(url,{cache:'reload'})));
  return check();
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const report=await save();if(!report.ready)throw Error('Incomplete offline cache');await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  if((await check()).ready){
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(SCOPE_PREFIX)&&name!==VERSION).map(name=>caches.delete(name)));
  }
  // Only old app-shell caches are removed, never preferences or unrelated data.
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(!event.data||!['CHECK_OFFLINE','SAVE_OFFLINE'].includes(event.data.type))return;
  event.waitUntil((async()=>{
    let report;
    try{report=await (event.data.type==='SAVE_OFFLINE'?save():check());}
    catch(error){report=Object.assign({},await check(),{error:String(error.message||error)});}
    if(event.ports[0])event.ports[0].postMessage(report);
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      const cache=await caches.open(VERSION);
      return (await cache.match(new URL('./index.html',self.registration.scope).href))||fetch(request);
    })());return;
  }
  // Never cache cross-origin or arbitrary requests. Only the versioned app shell.
  if(urls.includes(url.href))event.respondWith((async()=>{
    const cache=await caches.open(VERSION);return (await cache.match(request))||fetch(request);
  })());
});
