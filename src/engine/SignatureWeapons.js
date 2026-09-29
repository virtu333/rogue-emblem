// Personal (signature) weapons: one per lord, marked in weapons.json by
// `signatureOf: "<lord name>"`. Deadly Arsenal I puts the commander's in place of
// their Steel weapon. They are never dropped, sold or rolled: no loot table lists
// them (tools/validateCrossReferences.js) and the loot-quality upgrade skips them.
// Pure.

/** True for a lord's personal weapon. */
export function isSignatureWeapon(weapon) {
  return typeof weapon?.signatureOf === 'string' && weapon.signatureOf.length > 0;
}

/** The catalog weapon that is this lord's personal weapon, or null. */
export function signatureWeaponFor(lordName, allWeapons) {
  if (!lordName || !Array.isArray(allWeapons)) return null;
  return allWeapons.find((weapon) => weapon?.signatureOf === lordName) || null;
}
