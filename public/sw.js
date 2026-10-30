const CACHE = 'kiosco-static-v12';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache=await caches.open(CACHE);
    await cache.addAll(['/offline.html','/icon.svg','/icon-192.png','/icon-512.png']);
    const shell=await fetch('/offline');
    if(!shell.ok)throw new Error('No se pudo preparar la Caja offline');
    const html=await shell.clone().text();await cache.put('/offline',shell);
    const assets=new Set([...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map(match=>match[1].replaceAll('&amp;','&')).filter(path=>path.startsWith('/_next/static/')));
    await Promise.all([...assets].map(async path=>{const response=await fetch(path);if(response.ok)await cache.put(path,response);}));
  })());
  self.skipWaiting();
});
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Nunca guardar API, documentos autenticados, RSC ni recursos de otros orígenes.
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg') {
    event.respondWith(caches.open(CACHE).then(async cache => { const hit = await cache.match(event.request); if (hit) return hit; const response = await fetch(event.request); if (response.ok) await cache.put(event.request, response.clone()); return response; }));
  } else if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(async () => await caches.match('/offline') || await caches.match('/offline.html')));
});
