import { readFileSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');

function readJson(fileName) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, fileName), 'utf-8'));
}

function toStringArray(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === 'string' && entry.trim());
}

function toSetByName(entries) {
  return new Set(
    (Array.isArray(entries) ? entries : [])
      .map((entry) => entry?.name)
      .filter((name) => typeof name === 'string' && name),
  );
}

export function validateCrossReferences(datasets = null) {
  const errors = [];

  const classes = datasets?.classes ?? readJson('classes.json');
  const skills = datasets?.skills ?? readJson('skills.json');
  const weapons = datasets?.weapons ?? readJson('weapons.json');
  const weaponArtsData = datasets?.weaponArts ?? readJson('weaponArts.json');
  const lootTables = datasets?.lootTables ?? readJson('lootTables.json');
  const accessories = datasets?.accessories ?? readJson('accessories.json');
  const consumables = datasets?.consumables ?? readJson('consumables.json');
  const lords = datasets?.lords ?? readJson('lords.json');
  const recruits = datasets?.recruits ?? readJson('recruits.json');

  const classByName = new Map(
    (Array.isArray(classes) ? classes : [])
      .filter((entry) => typeof entry?.name === 'string')
      .map((entry) => [entry.name, entry]),
  );
  const classNames = new Set(classByName.keys());
  const skillIds = new Set(
    (Array.isArray(skills) ? skills : [])
      .map((entry) => entry?.id)
      .filter((id) => typeof id === 'string' && id),
  );
  const weaponNames = toSetByName(weapons);
  const accessoryNames = toSetByName(accessories);
  const consumableNames = toSetByName(consumables);
  const weaponArtIds = new Set(
    (Array.isArray(weaponArtsData?.arts) ? weaponArtsData.arts : [])
      .map((entry) => entry?.id)
      .filter((id) => typeof id === 'string' && id),
  );

  for (const cls of Array.isArray(classes) ? classes : []) {
    for (const learnable of Array.isArray(cls?.learnableSkills) ? cls.learnableSkills : []) {
      if (!skillIds.has(learnable?.skillId)) {
        errors.push(
          `classes.json:${cls.name}.learnableSkills references unknown skillId "${learnable?.skillId}"`,
        );
      }
    }

    const promotesTo = toStringArray(cls?.promotesTo);
    for (const targetName of promotesTo) {
      if (!classNames.has(targetName)) {
        errors.push(`classes.json:${cls.name}.promotesTo references unknown class "${targetName}"`);
      }
    }

    if (typeof cls?.promotesFrom === 'string' && cls.promotesFrom) {
      if (!classNames.has(cls.promotesFrom)) {
        errors.push(
          `classes.json:${cls.name}.promotesFrom references unknown class "${cls.promotesFrom}"`,
        );
      }
    }
  }

  for (const weapon of Array.isArray(weapons) ? weapons : []) {
    if (weapon?.skillId && !skillIds.has(weapon.skillId)) {
      errors.push(
        `weapons.json:${weapon.name}.skillId references unknown skill "${weapon.skillId}"`,
      );
    }
    for (const artId of Array.isArray(weapon?.weaponArtIds) ? weapon.weaponArtIds : []) {
      if (!weaponArtIds.has(artId)) {
        errors.push(`weapons.json:${weapon.name}.weaponArtIds references unknown art "${artId}"`);
      }
    }
  }

  for (const [actId, table] of Object.entries(lootTables || {})) {
    for (const weaponPoolKey of ['weapons', 'skillScroll', 'weaponArtScroll', 'legendaryWeapon']) {
      for (const itemName of Array.isArray(table?.[weaponPoolKey]) ? table[weaponPoolKey] : []) {
        if (!weaponNames.has(itemName)) {
          errors.push(
            `lootTables.json:${actId}.${weaponPoolKey} references unknown weapon "${itemName}"`,
          );
        }
      }
    }

    for (const consumablePoolKey of ['healing', 'statBooster', 'promotion']) {
      for (const itemName of Array.isArray(table?.[consumablePoolKey])
        ? table[consumablePoolKey]
        : []) {
        if (!consumableNames.has(itemName)) {
          errors.push(
            `lootTables.json:${actId}.${consumablePoolKey} references unknown consumable "${itemName}"`,
          );
        }
      }
    }

    for (const itemName of Array.isArray(table?.accessories) ? table.accessories : []) {
      if (!accessoryNames.has(itemName)) {
        errors.push(
          `lootTables.json:${actId}.accessories references unknown accessory "${itemName}"`,
        );
      }
    }
  }

  for (const lord of Array.isArray(lords) ? lords : []) {
    if (!classNames.has(lord?.class)) {
      errors.push(`lords.json:${lord?.name}.class references unknown class "${lord?.class}"`);
    }
    if (!classNames.has(lord?.promotedClass)) {
      errors.push(
        `lords.json:${lord?.name}.promotedClass references unknown class "${lord?.promotedClass}"`,
      );
    }
  }

  for (const actId of ['act1', 'act2', 'act3', 'act4']) {
    for (const className of Array.isArray(recruits?.[actId]?.classPool)
      ? recruits[actId].classPool
      : []) {
      if (!classNames.has(className)) {
        errors.push(`recruits.json:${actId}.classPool references unknown class "${className}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
