import manifest from './RebuiltPortraitManifest.json';

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/ /g, '_');

export function preloadRebuiltPortraits(scene) {
  for (const [id, entry] of Object.entries(manifest)) {
    const key = `rebuilt-portrait-${id}`;
    if (!scene.textures.exists(key))
      scene.load.image(key, `${import.meta.env.BASE_URL}assets/portraits/rebuilt/${entry.file}`);
  }
}

export function rebuiltPortraitKey(scene, unit) {
  if (!unit) return null;
  const name = normalize(unit.name);
  const candidates = [];
  if (unit.isBoss) candidates.push(`boss_${name}`);
  if (unit.isLord || manifest[`lord_${name}`]) {
    if (unit.tier === 'promoted') candidates.push(`lord_${name}_promoted`);
    candidates.push(`lord_${name}`);
  }
  if (unit.faction !== 'enemy') candidates.push(`generic_${normalize(unit.className)}`);
  for (const id of candidates) {
    const key = `rebuilt-portrait-${id}`;
    if (manifest[id] && scene.textures.exists(key)) return key;
  }
  return null;
}

// Story keys remain stable in data; presentation resolves approved art at runtime.
export function dialoguePortraitKey(scene, name, legacyKey) {
  if (!legacyKey) return null;
  const roster = scene.runManager?.roster || [];
  const units = [...roster, ...(scene.playerUnits || []), ...(scene.enemyUnits || [])];
  const unit = units.find((unit) => normalize(unit.name) === normalize(name));
  const rebuilt = unit && rebuiltPortraitKey(scene, unit);
  if (rebuilt) return rebuilt;
  const id = String(legacyKey).replace(/^portrait_/, '');
  const candidates = [id, `boss_${normalize(name)}`, `lord_${normalize(name)}`];
  for (const candidate of candidates) {
    const key = `rebuilt-portrait-${candidate}`;
    if (manifest[candidate] && scene.textures?.exists?.(key)) return key;
  }
  return legacyKey;
}
