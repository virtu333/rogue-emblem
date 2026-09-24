// Phaser may revoke a loader's blob URL after decoding. A new DOM <img> cannot
// reuse that URL, even though Phaser can still draw the decoded image.
const sources = new WeakMap();
export function textureImageSource(texture) {
  const source = texture?.getSourceImage?.();
  if (!source) return '';
  if (sources.has(source)) return sources.get(source);
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
