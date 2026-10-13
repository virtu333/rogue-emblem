// Copy a string to the clipboard: the async Clipboard API first, then the old
// select-and-copy route (a WebView or browser that refuses the API). Resolves true when
// either reports success, false otherwise; never throws, so the caller can say
// "Select the text to copy it" instead.

export async function copyText(
  text,
  { nav = globalThis.navigator, doc = globalThis.document } = {},
) {
  const value = String(text ?? '');
  try {
    if (typeof nav?.clipboard?.writeText === 'function') {
      await nav.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Refused (no permission, not a secure context): try the fallback.
  }
  if (!doc?.body || typeof doc.execCommand !== 'function') return false;
  const area = doc.createElement('textarea');
  area.value = value;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  doc.body.append(area);
  try {
    area.select();
    return doc.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
