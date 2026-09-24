// Canvas text is rasterized once. Load the local face before scenes create text
// so a first offline launch does not permanently capture a fallback font.
// Cinzel (ceremony display face) is warmed in parallel but never blocks startup:
// ceremonies render as DOM text, which re-renders once the face arrives.
export const DISPLAY_FONT_PROBE = '700 16px "Cinzel"';

export async function loadGameFont(fonts = globalThis.document?.fonts, timeoutMs = 2000) {
  if (!fonts?.load) return false;
  try {
    Promise.resolve(fonts.load(DISPLAY_FONT_PROBE)).catch(() => {});
  } catch {
    // Display face is optional.
  }
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
