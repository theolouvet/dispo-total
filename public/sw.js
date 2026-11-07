// Service worker : met en cache l'appli elle-même (HTML, JS, CSS, icônes) pour une ouverture instantanée.
// Les données (stocks, prix, carte) ne sont jamais mises en cache : elles doivent être fraîches.
const CACHE = 'dispo-total-v2';
const SOCLE = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SOCLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Supprime les anciens fichiers /assets/ que la nouvelle page n'utilise plus.
async function nettoyerAssets(html) {
  const utilises = new Set([...html.matchAll(/assets\/[^"')\s]+/g)].map((m) => m[0]));
  const cache = await caches.open(CACHE);
  for (const req of await cache.keys()) {
    const chemin = new URL(req.url).pathname;
    const i = chemin.indexOf('assets/');
    if (i >= 0 && !utilises.has(chemin.slice(i))) await cache.delete(req);
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API et tuiles : réseau direct

  // Page : réseau d'abord (pour récupérer les nouvelles versions), cache si hors ligne.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(async (rep) => {
          if (rep.ok) {
            const cache = await caches.open(CACHE);
            await cache.put('./', rep.clone());
            e.waitUntil(rep.clone().text().then(nettoyerAssets));
          }
          return rep;
        })
        .catch(async () => (await caches.match('./')) ?? Response.error()),
    );
    return;
  }

  // Fichiers statiques (noms versionnés par Vite) : cache d'abord.
  e.respondWith(
    caches.match(req).then(
      (enCache) =>
        enCache ??
        fetch(req).then(async (rep) => {
          if (rep.ok) (await caches.open(CACHE)).put(req, rep.clone());
          return rep;
        }),
    ),
  );
});
