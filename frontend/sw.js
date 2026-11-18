const CACHE_VERSION = "v43";
const CACHE_NAME = `ft-flow-${CACHE_VERSION}`;
const ASSETS = [
  "/",
  "/index.html",
  "/style.css?v=48",
  "/app.js?v=72",
  "/assistente.css?v=2",
  "/assistente.js?v=2",
  "/epis.css?v=1",
  "/epis.js?v=1",
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

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
