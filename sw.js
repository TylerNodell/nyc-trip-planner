/* Offline support. Online: always the network first, so updates show up right away.
   Offline: the last copy we saw — pages, your trip data, and map tiles you've already looked at. */
const VERSION = "202610030629";
const SHELL = "shell-" + VERSION, DATA = "data-v1", TILES = "tiles-v1";
const SHELL_URLS = [
  "./", "./index.html", "./itinerary.html",
  "./shared.css?v=" + VERSION, "./shared.js?v=" + VERSION, "./maps.js?v=" + VERSION,
  "./manifest.webmanifest", "./icon-192.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }

// Network first; fall back to the cache when offline or very slow (e.g. one bar in a subway station).
async function networkFirst(req, cacheName, ms) {
  const cache = await caches.open(cacheName);
  const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; });
  try {
    return await Promise.race([net, timeout(ms)]);
  } catch {
    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;
    return net;   // nothing saved: keep waiting on the network
  }
}

// Map tiles rarely change: use a saved tile if we have one; keep at most ~600.
async function tileCache(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    cache.put(req, res.clone());
    cache.keys().then((keys) => { if (keys.length > 600) keys.slice(0, keys.length - 600).forEach((k) => cache.delete(k)); });
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith(".supabase.co")) {
    if (url.pathname.startsWith("/rest/v1/")) e.respondWith(networkFirst(req, DATA, 5000));
    return;   // functions, realtime: always live
  }
  if (url.hostname === "tile.openstreetmap.org") { e.respondWith(tileCache(req)); return; }
  if (url.origin === location.origin || url.hostname === "cdn.jsdelivr.net" ||
      url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(networkFirst(req, SHELL, req.mode === "navigate" ? 4000 : 6000));
  }
});
