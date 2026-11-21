// De versie wordt bij het uitrollen ingevuld (zie deploy.yml). Elke publicatie
// levert dus een nieuwe cachenaam op, waarna de activate-stap de oude opruimt.
const CACHE_NAME = 'joga-bonito-dev';
// Relatief aan sw.js, niet aan de root: de app staat op een project-site
// (irvingliesdek.github.io/joga-bonito/). Een pad vanaf de root wees naar de
// hoofdpagina van het account, gaf een 404 en liet de hele installatie van de
// service worker mislukken.
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Een navigatie die geen geldige pagina oplevert (404 na een verhuizing,
// storing bij GitHub Pages) of helemaal niet lukt, krijgt de bewaarde app.
// Anders vervangt een foutpagina de app terwijl de cache prima is.
function bewaardePagina(request) {
  return caches.match(request, { ignoreSearch: true })
    .then(cached => cached || caches.match('./index.html'))
    .then(cached => cached || caches.match('./'));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('fonts.googleapis.com') || e.request.url.includes('fonts.gstatic.com') || e.request.url.includes('www.gstatic.com/firebasejs')) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
      )
    );
    return;
  }

  if (e.request.url.includes('srza.json')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  const navigatie = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        }
        if (navigatie) return bewaardePagina(e.request).then(cached => cached || res);
        return res;
      })
      .catch(err => (navigatie ? bewaardePagina(e.request) : caches.match(e.request))
        .then(cached => cached || Promise.reject(err)))
  );
});
