/* Guardora service worker: makes the app installable and quick to open, and receives CVs shared from the phone.
   Candidate data is never cached here: every /api request goes to the server. */

const VERSION = 'guardora-v1';
const SHELL = ['/', '/assets/app.css', '/assets/js/theme.js', '/assets/js/app.js', '/assets/js/ui.js', '/assets/js/api.js',
  '/assets/js/pdfview.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon-32.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Files shared to Guardora from another app (Android share sheet): keep them until the app uploads them.
async function receiveShare(request) {
  const form = await request.formData();
  const files = form.getAll('files').filter((f) => f && f.size);
  const cache = await caches.open('guardora-share');
  await Promise.all(files.map((f, i) => cache.put('/shared/' + i, new Response(f, { headers: { 'X-Name': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' } }))));
  return Response.redirect('/candidates?shared=' + files.length, 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // App files: network first (always the latest version), cached copy when offline.
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/vendor/'))) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => caches.match(event.request).then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('/') : Response.error())))
  );
});
