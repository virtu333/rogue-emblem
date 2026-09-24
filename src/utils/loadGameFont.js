// Canvas text is rasterized once. Load the local face before scenes create text
// so a first offline launch does not permanently capture a fallback font.
export async function loadGameFont(fonts = globalThis.document?.fonts, timeoutMs = 2000) {
  if (!fonts?.load) return false;
  let timer;
  try {
    return await Promise.race([
      fonts.load('12px "Press Start 2P"').then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
