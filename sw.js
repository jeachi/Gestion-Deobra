// Service Worker de "Gestión de Obra". Su único trabajo es guardar una copia de la app en el
// celular para que abra rápido y funcione aunque no haya señal en ese momento — los datos en sí
// (Firebase, Gemini) siguen necesitando conexión real, esto no los reemplaza.
const CACHE_NAME = "gdo-cache-v2";
const ARCHIVOS_CACHE = ["./", "./index.html", "./icon-192.png?v=2", "./icon-512.png?v=2"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_CACHE))
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
  const url = new URL(event.request.url);
  // Solo interceptamos pedidos a nuestro propio sitio (el archivo principal e íconos). Todo lo
  // demás (Firebase, Gemini, librerías de CDN externas) va directo a la red, sin tocar — no
  // queremos "cachear por error" nada de eso.
  if (url.origin !== self.location.origin) return;

  // Red primero, cache como plan B -- así, cada vez que hay señal, se ve la version MAS
  // RECIENTE de una sola vez (no la guardada de la vez pasada). La copia guardada solo entra
  // en juego si no hay conexión en ese momento, que es exactamente para lo que sirve.
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse.clone()));
        return networkResponse;
      })
      .catch(() => caches.match(event.request))
  );
});
