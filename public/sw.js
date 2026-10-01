/**
 * Trace'in servis çalışanı: kurulan uygulama ve kütüphanenin çevrimdışı açılması.
 *
 * Yalnızca okumak için: her şey önce ağdan isteniyor, ağ yoksa son başarılı
 * yanıt veriliyor. Böylece çevrimiçiyken hiçbir zaman eski veri görülmüyor,
 * çevrimdışıyken kütüphane son açıldığı hâliyle açılıyor. Yazmalar (POST, PUT,
 * DELETE) hiç dokunulmadan ağa gidiyor; çevrimdışıyken kaydedilemiyorlar.
 *
 * Neye dokunuyor:
 *   - `/` sayfası (stüdyonun tek sayfası; ekranlar sorgu dizesinde): ağ önce,
 *     yoksa saklanan sayfa. Yayınlanmış `/p/…` ve `/r/…` sayfalarına dokunmuyor.
 *   - `/_next/static/…`: adları içeriklerinin özeti, değişmiyorlar: önce saklanan.
 *   - Simgeler, yazı tipleri ve örnek proje: önce saklanan, arkada tazeleniyor.
 *   - Kütüphanenin okunduğu API'ler (makaleler, notlar, çalışma kaydı,
 *     etiketler, okuma listesi, kavram eşleri, profil, şablonlar): ağ önce.
 *     Yalnızca başarılı yanıtlar saklanıyor; bir 401 (parola) saklanmıyor ve
 *     ağ cevap verdiyse eski kopyaya düşülmüyor.
 *
 * Saklanan veri bu tarayıcıda; Profil'deki "Delete the offline copy" siliyor.
 */
const VERSION = "v1";
const SHELL = `trace-shell-${VERSION}`;
const ASSETS = `trace-assets-${VERSION}`;
const DATA = `trace-data-${VERSION}`;
const MAX_ASSETS = 300;

const DATA_PATHS = new Set([
  "/api/library",
  "/api/library/notes",
  "/api/library/study",
  "/api/library/tags",
  "/api/library/reading-list",
  "/api/library/aliases",
  "/api/profile",
  "/api/profile/sessions",
  "/api/templates",
]);

self.addEventListener("install", (event) => {
  // Sayfanın kendisi ilk ziyarette saklanıyor; kurulum hiçbir şeyi beklemiyor.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, DATA]);
      for (const name of await caches.keys()) if (name.startsWith("trace-") && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Ağ önce; ağ hiç cevap vermezse saklanan kopya. */
async function networkFirst(request, cacheName, key = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

/** Saklanan önce; yoksa ağ, ve saklanır. Eski girdiler sınırı aşınca atılıyor. */
async function cacheFirst(request, refresh) {
  const cache = await caches.open(ASSETS);
  const cached = await cache.match(request);
  const update = fetch(request).then(async (response) => {
    if (response.ok) {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
    }
    return response;
  });
  if (cached) {
    if (refresh) update.catch(() => undefined);
    return cached;
  }
  return update;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    // Stüdyonun sayfası tek; hangi ekran açılırsa açılsın aynı belge saklanıyor.
    if (url.pathname === "/") event.respondWith(networkFirst(request, SHELL, "/"));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, false));
    return;
  }
  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/examples/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.ico") {
    event.respondWith(cacheFirst(request, true));
    return;
  }
  if (DATA_PATHS.has(url.pathname)) event.respondWith(networkFirst(request, DATA));
});

// Profil "Delete the offline copy" dediğinde: saklanan kütüphane verisi siliniyor.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "trace:forget-offline-copy") return;
  event.waitUntil(
    (async () => {
      await caches.delete(DATA);
      await caches.delete(SHELL);
      event.source?.postMessage({ type: "trace:offline-copy-forgotten" });
    })(),
  );
});
