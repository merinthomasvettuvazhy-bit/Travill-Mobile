/* =========================================
   TRAVILLOX SERVICE WORKER
   Caches the app shell (HTML/CSS/JS/icons) so
   the installed mobile web app opens instantly
   and still loads if the network is briefly
   unavailable. Map tiles, weather, and traffic
   data are intentionally NOT cached here since
   they need to stay live.

   NOTE ON CACHE_NAME: bump this string any time
   app.js / style.css / index.html change. The
   browser only re-runs install() (which refills
   the cache) when sw.js's own bytes change, so a
   stale CACHE_NAME here would otherwise keep
   serving old app files forever, even after
   you've deployed new ones.
========================================= */

const CACHE_NAME = "travillox-shell-v2";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );

  self.skipWaiting();

});

self.addEventListener("activate", (event) => {

  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();

});

self.addEventListener("fetch", (event) => {

  const url = new URL(event.request.url);

  /* ---------- ONLY HANDLE APP-SHELL (SAME-ORIGIN) REQUESTS ----------
     Everything else (map tiles, OSRM, TomTom, Open-Meteo, Photon,
     Leaflet/MapLibre CDN files) should always go to the network so
     the map, routing, weather and traffic stay live. */

  if (url.origin !== self.location.origin) return;

  /* ---------- NETWORK-FIRST FOR THE APP SHELL ----------
     Cache-first felt "instant" but meant a code change never showed
     up until the cache was manually busted (exactly what happened
     here). Network-first always tries to fetch the latest file first
     — so edits show immediately whenever you're online — and only
     falls back to the cached copy if the network request fails
     (e.g. offline), which is when the cache is actually useful. */

  event.respondWith(
    fetch(event.request)
      .then((response) => {

        const clone = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });

        return response;

      })
      .catch(() => caches.match(event.request))
  );

});
