import { resolveWeaponArtIds } from './WeaponArtVisibility.js';
import { weaponArtSheet } from './weaponArtDisplay.js';
import { SCROLLS_HELP, WEAPON_ARTS_HELP } from './helpTopics.js';
import { button } from './MenuSurface.js';
import { helpPreviewContent } from './ContextHelp.js';
import { bindHoverPreview, FINE_HOVER_MEDIA } from './infoAffordance.js';

// A mouse hover previews what a click would show; touch and gamepad keep the click.
const HOVER = { media: FINE_HOVER_MEDIA, align: 'start' };

const helpButton = (label, blocks, open) => {
  const link = button(label, () => open(), 'item-art-help');
  bindHoverPreview(link, () => helpPreviewContent(blocks), HOVER);
  return link;
};

const sheetRow = (row) => {
  const p = document.createElement('p');
  if (row.label) {
    const label = document.createElement('strong');
    label.textContent = `${row.label} `;
    p.append(label, row.text);
  } else {
    p.className = 'item-art-flavour';
    p.textContent = row.text;
  }
  return p;
};

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
      parent.append(
        helpButton('How scrolls work', SCROLLS_HELP, () => openHelp('Scrolls', SCROLLS_HELP)),
      );
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
    for (const row of weaponArtSheet(art)) details.append(sheetRow(row));
    // Open, the sheet is already on screen: only a closed disclosure previews itself.
    bindHoverPreview(
      summary,
      () =>
        details.open
          ? null
          : { content: weaponArtSheet(art).map(sheetRow), footer: 'Click to expand' },
      HOVER,
    );
    if (openHelp)
      details.append(
        helpButton('How weapon arts work', WEAPON_ARTS_HELP, () =>
          openHelp('Weapon arts', WEAPON_ARTS_HELP),
        ),
      );
    parent.append(details);
  }
}
