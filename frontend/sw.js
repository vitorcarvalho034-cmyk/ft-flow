const CACHE_NAME = "ft-flow-v26";
const ASSETS = ["/", "/index.html", "/style.css?v=26", "/app.js?v=26", "/logo.png", "/manifest.json"];
self.addEventListener("install", event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(()=>{}))); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", event => { if(event.request.url.includes("/api/")) return; event.respondWith(fetch(event.request).then(resp=>{const copy=resp.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy)); return resp;}).catch(()=>caches.match(event.request))); });
