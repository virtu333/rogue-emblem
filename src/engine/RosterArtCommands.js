import { getWeaponArtBindings, isWeaponArtCompatibleWithWeapon } from './WeaponArtSystem.js';
const ranks = { Prof: 0, Mast: 1 };
export function rosterArtBlock(run, unit, weapon, scroll, arts) {
  if (!run?.roster?.includes(unit)) return 'Unit is no longer in the roster.';
  if (!run.scrolls?.includes(scroll)) return 'Scroll is no longer available.';
  if (!unit.inventory?.includes(weapon)) return 'Weapon is no longer carried by this unit.';
  const art = arts.find((a) => a.id === scroll.teachesWeaponArtId?.trim());
  if (!art) return 'Weapon art is unavailable.';
  if (
    (scroll.allowedWeaponTypes?.length && !scroll.allowedWeaponTypes.includes(weapon.type)) ||
    !isWeaponArtCompatibleWithWeapon(art, weapon)
  )
    return 'Weapon type is incompatible.';
  const prof = unit.proficiencies?.find((p) => p.type === weapon.type);
  if (!prof) return 'Unit lacks proficiency for this art.';
  if ((ranks[prof.rank || 'Prof'] ?? -1) < (ranks[art.requiredRank || 'Prof'] ?? 0))
    return 'Weapon rank too low for this art.';
  if (getWeaponArtBindings(weapon).some((b) => b.id === art.id))
    return 'Weapon already has this art.';
  return '';
}
export function bindRosterArt(run, unit, weapon, scroll, arts, replacement = null) {
  const reason = rosterArtBlock(run, unit, weapon, scroll, arts);
  if (reason) return { ok: false, reason };
  const bindings = getWeaponArtBindings(weapon);
  const art = arts.find((a) => a.id === scroll.teachesWeaponArtId.trim());
  const next = { id: art.id, source: 'scroll' };
  if (bindings.length >= 3) {
    // Match both id and source seen in the confirmation; never overwrite a changed slot.
    if (
      !replacement ||
      !bindings[replacement.index] ||
      bindings[replacement.index].id !== replacement.id ||
      bindings[replacement.index].source !== replacement.source
    )
      return { ok: false, reason: 'Weapon arts changed. Choose a slot again.' };
    bindings[replacement.index] = next;
  } else {
    if (replacement) return { ok: false, reason: 'Weapon arts changed. Choose a slot again.' };
    bindings.push(next);
  }
  weapon.weaponArtIds = bindings.map((b) => b.id);
  weapon.weaponArtSources = bindings.map((b) => b.source);
  weapon.weaponArtId = weapon.weaponArtIds[0];
  weapon.weaponArtSource = weapon.weaponArtSources[0];
  run.scrolls.splice(run.scrolls.indexOf(scroll), 1);
  return { ok: true };
}
