const CACHE_VERSION = "v33";
const CACHE_NAME = `ft-flow-${CACHE_VERSION}`;
const ASSETS = [
  "/",
  "/index.html",
  `/style.css?v=${CACHE_VERSION}`,
  `/app.js?v=${CACHE_VERSION}`,
  "/logo.png",
  "/manifest.json"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
