// The shared "equipped" mark for every inventory view. Canvas menus prefix the
// equipped row with EQUIPPED_MARKER (two monospace cells, like the blank "  "
// prefix of other rows); DOM views append the badge element.
import './attackFlow.css';

export const EQUIPPED_MARKER = 'E ';
export const UNEQUIPPED_MARKER = '  ';

export function equippedMarker(unit, item) {
  return item && unit?.weapon === item ? EQUIPPED_MARKER : UNEQUIPPED_MARKER;
}

/**
 * Small "E" badge (screen readers hear "Equipped"). `make(tag)` lets a view
 * build it with its own element factory (e.g. MenuSurface's `element`).
 */
export function equippedBadgeElement(make = (tag) => document.createElement(tag)) {
  const badge = make('span');
  badge.className = 're-equipped-badge';
  badge.textContent = 'E';
  badge.title = 'Equipped';
  badge.setAttribute?.('aria-label', 'Equipped');
  badge.setAttribute?.('role', 'img');
  return badge;
}
