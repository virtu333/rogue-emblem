import { resolveWeaponArtIds } from './WeaponArtVisibility.js';
import { weaponArtDetailLines } from './weaponArtDisplay.js';

// Native disclosure works with a tap or keyboard; no hover/long-press knowledge required.
export function appendItemArtDetails(parent, item, catalog = []) {
  if (!item || item.teachesWeaponArtId) return;
  for (const id of resolveWeaponArtIds(item, catalog)) {
    const art = catalog.find((entry) => entry.id === id);
    if (!art) continue;
    const details = document.createElement('details');
    details.className = 'item-art-details';
    const summary = document.createElement('summary');
    summary.textContent = `Weapon art: ${art.name} · Details`;
    details.append(summary);
    for (const line of weaponArtDetailLines(art)) {
      const p = document.createElement('p');
      p.textContent = line;
      details.append(p);
    }
    parent.append(details);
  }
}
