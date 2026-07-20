/* Retrieve GCSE — service worker
   ---------------------------------------------------------------------------
   The manifest already made the site installable. Without this, installing it
   got you an icon and a page that failed the moment the wifi did, which is
   most of what school wifi does.

   What it buys: the two pages and their icons load offline. Question banks are
   already cached in localStorage by the engine, so a topic opened once works
   with no connection at all. Progress made offline is written to localStorage
   and syncs the next time Supabase is reachable.

   Two rules it does not break:

   1. Supabase is never cached. Not the auth calls, not the data. A cached
      session or a cached copy of somebody's progress is a correctness bug and
      a privacy one at the same time.

   2. Navigation is network-first. There is no build step stamping versions
      into filenames here, so a cache-first page could pin somebody to an old
      version of the site indefinitely with no way to tell.

   To force every client onto a fresh copy, change CACHE_VERSION below.
*/

const CACHE_VERSION = 'v1';
const CACHE = 'retrieve-' + CACHE_VERSION;

/* Without these two there is no offline site, so a failure to cache them
   should fail the install and leave the previous worker in place. */
const ESSENTIAL = [
  './',
  './index.html',
  './quiz.html'
];

/* These improve things but none of them is worth losing offline support over.
   cache.addAll() is all-or-nothing, so a single renamed icon would abort the
   install and the worker would silently never take effect - a failure mode
   that looks exactly like having no worker at all. */
const NICE_TO_HAVE = [
  './404.html',
  './manifest.json',
  './icon.svg',
  './favicon.ico',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ESSENTIAL)
        .then(() => Promise.all(NICE_TO_HAVE.map(u => c.add(u).catch(() => {})))))
      /* Safe here because navigation is network-first: a client that takes the
         new worker immediately still fetches fresh HTML, so there is no
         old-page/new-asset mismatch to guard against. */
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n.startsWith('retrieve-') && n !== CACHE)
             .map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function isSupabase(url){
  return url.hostname.endsWith('.supabase.co');
}

self.addEventListener('fetch', event => {
  const req = event.request;

  /* Anything that changes state on the server has no business in a cache. */
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  if(isSupabase(url)) return;               // straight to the network, always

  /* Pages: network first, cache as a fallback. Online you always get the
     current version; offline you get the last one that loaded. */
  if(req.mode === 'navigate'){
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  /* Everything else — icons, the manifest, the Supabase client from the CDN —
     is effectively immutable, so the cache wins and the network only fills
     gaps. Opaque cross-origin responses are cached as they come; they cannot
     be inspected, but serving one beats failing. */
  event.respondWith(
    caches.match(req).then(hit => {
      if(hit) return hit;
      return fetch(req).then(res => {
        if(res && (res.ok || res.type === 'opaque')){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
