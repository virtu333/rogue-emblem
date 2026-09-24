// Phaser Text derives its canvas key from ambient Math.random. Battle resume
// and rewind intentionally reseed that generator while old text is still alive.
// Disambiguate only generated UUID canvas keys; named asset collisions must
// retain Phaser's normal error. No random calls are added or removed, preserving
// the gameplay stream. Text renders and destroys via its returned Texture object
// (including that object's actual key), so the renamed entry cleans up normally.
const GENERATED_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const installed = new WeakSet();

export function installSeedSafeCanvasTextures(textures) {
  if (!textures || installed.has(textures)) return;
  const addCanvas = textures.addCanvas;
  let sequence = 0;
  textures.addCanvas = function (key, source, skipCache) {
    if (!skipCache && GENERATED_UUID.test(key) && this.exists(key)) {
      const original = key;
      do {
        key = `${original}:text-${++sequence}`;
      } while (this.exists(key));
    }
    return addCanvas.call(this, key, source, skipCache);
  };
  installed.add(textures);
}
