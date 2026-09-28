import { resolveWeaponArtIds } from './WeaponArtVisibility.js';
import { weaponArtSheet } from './weaponArtDisplay.js';
import { SCROLLS_HELP, WEAPON_ARTS_HELP } from './helpTopics.js';
import { button } from './MenuSurface.js';

const helpButton = (label, open) => button(label, () => open(), 'item-art-help');

/**
 * An item's weapon arts as disclosures: each opens to its sheet (Cost, Effect, On hit,
 * Needs, flavour). A scroll gets a "How scrolls work" line instead. With `openHelp`
 * ((title, blocks) => void) the shared rules sit one tap away, not on every art.
 * Native disclosure works with a tap or keyboard; no hover/long-press knowledge required.
 */
export function appendItemArtDetails(parent, item, catalog = [], { openHelp } = {}) {
  if (!item) return;
  if (item.type === 'Scroll') {
    if (openHelp)
      parent.append(helpButton('How scrolls work', () => openHelp('Scrolls', SCROLLS_HELP)));
    return;
  }
  for (const id of resolveWeaponArtIds(item, catalog)) {
    const art = catalog.find((entry) => entry.id === id);
    if (!art) continue;
    const details = document.createElement('details');
    details.className = 'item-art-details';
    const summary = document.createElement('summary');
    summary.textContent = `Weapon art: ${art.name}`;
    details.append(summary);
    for (const row of weaponArtSheet(art)) {
      const p = document.createElement('p');
      if (row.label) {
        const label = document.createElement('strong');
        label.textContent = `${row.label} `;
        p.append(label, row.text);
      } else {
        p.className = 'item-art-flavour';
        p.textContent = row.text;
      }
      details.append(p);
    }
    if (openHelp)
      details.append(
        helpButton('How weapon arts work', () => openHelp('Weapon arts', WEAPON_ARTS_HELP)),
      );
    parent.append(details);
  }
}
