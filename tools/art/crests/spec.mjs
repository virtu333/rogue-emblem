// Crest language shared by the generated study and the code-built crests.
//
// One crest per class. A crest is composed from the class *line* (its base
// class family), read straight from data/classes.json:
//   primary charge   the line's weapon (sword, lance, axe, bow, tome, staff,
//                    light, breath, fan)
//   secondary charge weapon types the class adds over its base (promotion's
//                    new proficiencies), crossed behind the primary
//   supporter        the mount: horse (cavalry), pegasus wing, wyvern wing,
//                    tower (armoured)
//   mark             a small chief mark for the school (crown for lords, star
//                    for the holy orders, eye for the tome schools...)
//   frame            the tier: base = steel rim, promoted = gilt double rim
//                    with a notched crown, boss = cracked unlight rim
import {
  CLASS_CREST_SPECS,
  crestSpecForClass,
  CREST_LINE_IDS,
} from '../../../src/ui/classCrests.js';

export const CREST_LINES = CREST_LINE_IDS;

const WEAPON_WORDS = {
  sword: 'an upright straight longsword, point up',
  curved: 'an upright slender curved single-edged sword (katana-like), point up',
  dagger: 'an upright short dagger',
  lance: 'an upright long lance with a leaf-shaped head',
  axe: 'an upright single-bladed battle axe',
  greataxe: 'an upright double-bitted great axe',
  bow: 'a strung longbow drawn vertically with one arrow nocked',
  tome: 'a closed spellbook with a clasp, seen from the front',
  staff: 'a tall healer staff topped with an open ring',
  light: 'a small radiant eight-pointed star of light',
  breath: 'a curved dragon fang wreathed in a small flame',
  fan: 'an open folding dancer fan',
  eclipse: 'a black eclipsed sun with a thin cracked violet corona',
};
const MOUNT_WORDS = {
  horse: 'a horse head in profile behind the charge',
  wing: 'a pair of feathered white wings spread behind the charge',
  wyvern: 'a pair of bat-like leathery wyvern wings spread behind the charge',
  tower: 'a squat castle tower behind the charge',
};
const MARK_WORDS = {
  crown: 'a small plain crown',
  star: 'a small four-pointed star',
  eye: 'a small open eye',
  coin: 'a small round coin',
  key: 'a small key',
  quill: 'a small quill',
  flame: 'a small flame',
  chalice: 'a small chalice',
  moon: 'a small crescent moon',
  arrow: 'a small arrowhead',
  crack: 'a thin crack through the shield',
  ring: 'a small broken ring',
};

export function crestSpecFor(className) {
  const spec = crestSpecForClass(className);
  if (!spec) throw new Error(`no crest spec for ${className}`);
  const primary = spec.twin
    ? `two of ${WEAPON_WORDS[spec.primary].replace(/^an? /, '').replace(/^upright /, '')} crossed in saltire`
    : WEAPON_WORDS[spec.primary];
  const parts = [primary];
  for (const s of spec.secondary) parts.push(`crossed behind it ${WEAPON_WORDS[s]}`);
  if (spec.mount) parts.push(MOUNT_WORDS[spec.mount]);
  if (spec.mark) parts.push(`and above it ${MARK_WORDS[spec.mark]}`);
  return { ...spec, charge: parts.join(', ') };
}

export function crestIds() {
  return Object.keys(CLASS_CREST_SPECS);
}
