// Phaser may revoke a loader's blob URL after decoding. A new DOM <img> cannot
// reuse that URL, even though Phaser can still draw the decoded image.
const sources = new WeakMap();
// Downloaded bytes of textures the DOM shows (portraits), keyed by texture key.
// Re-encoding the decoded image with canvas.toDataURL took 128-462 ms per
// portrait on the main thread; an object URL of the original file is instant.
const retainedBlobs = new Map();
const hookedLoaders = new WeakSet();

export const isPortraitTextureKey = (key) =>
  typeof key === 'string' && (key.startsWith('portrait_') || key.startsWith('rebuilt-portrait-'));

/** Keep the downloaded file of every portrait this loader fetches. */
export function retainPortraitDownloads(loader) {
  if (!loader?.on || hookedLoaders.has(loader)) return;
  hookedLoaders.add(loader);
  loader.on('load', (file) => {
    const blob = file?.xhrLoader?.response;
    if (file?.type === 'image' && isPortraitTextureKey(file.key) && blob instanceof Blob)
      retainedBlobs.set(file.key, blob);
  });
}

export function textureImageSource(texture) {
  const source = texture?.getSourceImage?.();
  if (!source) return '';
  if (sources.has(source)) return sources.get(source);
  const blob = retainedBlobs.get(texture.key);
  if (blob && typeof URL?.createObjectURL === 'function') {
    const url = URL.createObjectURL(blob);
    sources.set(source, url);
    return url;
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    if (!canvas.width || !canvas.height) return '';
    canvas.getContext('2d').drawImage(source, 0, 0);
    const url = canvas.toDataURL('image/png');
    sources.set(source, url);
    return url;
  } catch {
    return source.src?.startsWith('blob:') ? '' : source.src || '';
  }
}
