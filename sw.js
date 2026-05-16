// Service worker minimo: serve solo a soddisfare i requisiti PWA per il bottone "Installa".
// Strategia: network-first per tutto (così l'app mostra sempre i dati Firestore freschi),
// con fallback alla cache solo se sei offline.

const CACHE_NAME = "mappa-ristoranti-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Solo richieste GET dello stesso origin: gestisce la cache.
  // Firestore / Google Maps / Firebase passano sempre alla rete (no cache).
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        // aggiorna la cache solo per asset dell'app
        const respClone = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, respClone)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
