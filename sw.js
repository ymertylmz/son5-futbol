const CACHE_NAME = "son5-radar-v1";

const STATIC_FILES = [
  "/",
  "/index.html",
  "/manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_FILES))
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  if (request.url.includes("/api/")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        const clone = response.clone();

        caches.open(CACHE_NAME)
          .then(cache => cache.put(request, clone));

        return response;
      })
      .catch(() => caches.match(request))
  );
});
