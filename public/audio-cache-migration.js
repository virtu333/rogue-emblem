// Prompted activation has committed the new build. Delete only the unreachable
// legacy audio cache; preserve exact-version audio, images, precache and saves.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('er-audio-assets'));
});
