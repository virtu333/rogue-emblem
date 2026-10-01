import { safeBattlePresentation } from './safeBattlePresentation.js';

// Class changes keep their old drawable unit until a replacement is complete.
// Creation is synchronous; track partial objects so a failed build leaks none.
const fields = ['graphic', 'label', 'factionIndicator', 'hpBar', 'affixPips'];

export function replaceUnitGraphic(scene, unit) {
  const previous = Object.fromEntries(fields.map((field) => [field, unit[field]]));
  const created = [];
  const originalAdd = scene.add;
  if (originalAdd) {
    scene.add = new Proxy(originalAdd, {
      get(target, key) {
        const value = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(target, args);
          if (result?.destroy) created.push(result);
          return result;
        };
      },
    });
  }
  for (const field of fields) unit[field] = field === 'affixPips' ? [] : null;
  try {
    scene.addUnitGraphic(unit);
  } catch (error) {
    for (const object of created) {
      try {
        object.destroy();
      } catch {
        /* preserve the original build failure */
      }
    }
    Object.assign(unit, previous);
    throw error;
  } finally {
    scene.add = originalAdd;
  }
  // CombatFx tracks some resources by unit identity as well as sprite identity.
  // Release the old presentation against the real unit before its refs are gone.
  const replacement = Object.fromEntries(fields.map((field) => [field, unit[field]]));
  Object.assign(unit, previous);
  try {
    safeBattlePresentation('class change FX release', () => scene._combatFx?.releaseUnit?.(unit), {
      scene,
    });
  } finally {
    Object.assign(unit, replacement);
  }
  // Destroy only the previous references. The live unit already owns the new
  // sprite and bar; its condition icons remain attached to that live unit.
  scene.removeUnitGraphic({ ...unit, ...previous, _conditionIcons: {} }, { skipFxRelease: true });
}
