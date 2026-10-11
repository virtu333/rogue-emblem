// disclosure — the fold that keeps a long list of choices out of the way until the
// player opens it (a unit's other deeds, the Oaths open to it). A plain button with
// aria-expanded, so touch, mouse, keyboard and pad all reach it as they reach any
// button; the caller renders the list only while it is open, so a closed fold holds
// no hidden controls for arrow keys or the pad to land on. Presentation only.

/**
 * Turn `button` into a fold toggle: a chevron, the label, an optional count and an
 * optional one-line preview of what is folded (clamped by CSS, never needed: the
 * open list says it in full).
 * @param {HTMLButtonElement} button
 * @param {{label: string, count?: number|null, preview?: string, expanded?: boolean}} o
 */
export function decorateDisclosure(
  button,
  { label, count = null, preview = '', expanded = false },
) {
  const doc = button.ownerDocument || globalThis.document;
  const span = (cls, text) => {
    const node = doc.createElement('span');
    node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  button.classList.add('re-disclosure');
  button.setAttribute('aria-expanded', String(Boolean(expanded)));
  const chevron = span('re-disclosure-chevron', '▸');
  chevron.setAttribute('aria-hidden', 'true');
  const head = span('re-disclosure-head');
  head.append(chevron, span('re-disclosure-label', label));
  if (Number.isFinite(count)) head.append(span('re-disclosure-count', String(count)));
  button.replaceChildren(head);
  if (preview && !expanded) button.append(span('re-disclosure-preview', preview));
  return button;
}
