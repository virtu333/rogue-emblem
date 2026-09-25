import { canEquip, equipWeapon, normalizeEquippedFirst } from '../engine/UnitManager.js';

// Forecast equipment is provisional until the player confirms combat.
//
// The session remembers the weapon that was equipped when the attack flow began
// (the "baseline") and the exact bag order. Previewing another weapon in the
// forecast holds it without reordering the inventory, so the forecast's weapon
// list stays stable while cycling. Cancel restores the baseline weapon and the
// exact order; confirming commits the previewed weapon, which then moves to the
// top of the inventory (equipped-first, like Fire Emblem).
export function beginWeaponPreview(scene, unit) {
  if (scene._weaponPreviewSession?.unit === unit) return;
  restoreWeaponPreview(scene);
  scene._weaponPreviewSession = {
    unit,
    weapon: unit.weapon || null,
    order: Array.isArray(unit.inventory) ? [...unit.inventory] : null,
  };
}

/** The weapon that was equipped before any preview (or the live one). */
export function baselineWeapon(scene, unit) {
  const session = scene._weaponPreviewSession;
  return session?.unit === unit ? session.weapon : unit?.weapon || null;
}

/** Hold `weapon` for the forecast without reordering the bag. */
export function previewEquipWeapon(scene, unit, weapon) {
  beginWeaponPreview(scene, unit);
  equipWeapon(unit, weapon, { reorder: false });
}

function restoreOrder(unit, order) {
  const inventory = unit.inventory;
  if (!Array.isArray(inventory) || !Array.isArray(order)) return false;
  if (inventory.length !== order.length || !order.every((item) => inventory.includes(item)))
    return false;
  inventory.splice(0, inventory.length, ...order);
  return true;
}

function restoreBaseline(session) {
  const { unit, weapon, order } = session;
  if (!weapon) unit.weapon = null;
  else {
    const carried = unit.inventory?.find(
      (w) => w === weapon || (weapon.uid && w.uid === weapon.uid),
    );
    if (carried && canEquip(unit, carried)) equipWeapon(unit, carried, { reorder: false });
  }
  // Same items: put the bag back exactly. Otherwise the bag changed under the
  // preview (never expected mid-attack) — keep the equipped-first invariant.
  if (!restoreOrder(unit, order)) normalizeEquippedFirst(unit);
}

/** Put the baseline weapon back but keep the session (forecast → targets). */
export function resetWeaponPreview(scene) {
  const session = scene._weaponPreviewSession;
  if (!session) return;
  restoreBaseline(session);
}

export function restoreWeaponPreview(scene) {
  const session = scene._weaponPreviewSession;
  if (!session) return;
  scene._weaponPreviewSession = null;
  scene._clearSelectedWeaponArt?.();
  restoreBaseline(session);
}

export function commitWeaponPreview(scene) {
  const session = scene._weaponPreviewSession;
  scene._weaponPreviewSession = null;
  // The confirmed weapon is now the equipped weapon: move it to the top.
  if (session?.unit) normalizeEquippedFirst(session.unit);
}

/**
 * Equip for attack planning (weapon-art pick, forecast): provisional while a
 * preview session for this unit is open, a real equip (moves to top) otherwise
 * — e.g. when a confirmed/resumed attack re-resolves its weapon art.
 */
export function equipForAttackPlanning(scene, unit, weapon) {
  const previewing = scene?._weaponPreviewSession?.unit === unit;
  equipWeapon(unit, weapon, { reorder: !previewing });
}
