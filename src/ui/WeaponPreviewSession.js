import { canEquip, equipWeapon } from '../engine/UnitManager.js';

// Forecast equipment is provisional until the player confirms combat.
export function beginWeaponPreview(scene, unit) {
  if (scene._weaponPreviewSession?.unit === unit) return;
  restoreWeaponPreview(scene);
  scene._weaponPreviewSession = { unit, weapon: unit.weapon || null };
}
export function restoreWeaponPreview(scene) {
  const session = scene._weaponPreviewSession;
  if (!session) return;
  scene._weaponPreviewSession = null;
  scene._clearSelectedWeaponArt?.();
  const { unit, weapon } = session;
  if (!weapon) unit.weapon = null;
  else {
    const carried = unit.inventory?.find(
      (w) => w === weapon || (weapon.uid && w.uid === weapon.uid),
    );
    if (carried && canEquip(unit, carried)) equipWeapon(unit, carried);
  }
}
export function commitWeaponPreview(scene) {
  scene._weaponPreviewSession = null;
}
