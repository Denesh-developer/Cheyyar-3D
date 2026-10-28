/* Minimal service worker: PWA/TWA-ku venum. Edhaiyum cache pannaadhu,
   so Firebase-la file maathina udane ellarukkum pudhu version varum. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
