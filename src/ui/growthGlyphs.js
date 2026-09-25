// growthGlyphs — small marks used by the growth beats.
//
// Weapon seals reuse the crest charges (one heraldic language). Skill glyphs
// are a deliberate PLACEHOLDER HOOK: a separate study owns item, skill and
// blessing icons. Until it lands, a skill shows a neutral seal diamond
// carrying data-skill-id; the icon study can fill `.gr-glyph[data-skill-id]`
// (CSS background or a replacement element) without touching these flows.
import { chargeDataUrl } from './crestArt.js';
import { WEAPON_GLYPH } from './classCrests.js';

export function skillGlyph(skillId, className = 'gr-glyph') {
  const span = document.createElement('span');
  span.className = `${className} gr-glyph--skill`;
  span.dataset.skillId = String(skillId || '');
  span.dataset.glyphHook = 'skill-icon';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

export function weaponGlyph(weaponType, className = 'gr-glyph') {
  const key = WEAPON_GLYPH[weaponType];
  const src = key ? chargeDataUrl(key) : '';
  const span = document.createElement('span');
  span.className = `${className} gr-glyph--weapon`;
  span.dataset.weapon = String(weaponType || '');
  span.setAttribute('aria-hidden', 'true');
  if (src) span.style.setProperty('--gr-glyph', `url("${src}")`);
  return span;
}
