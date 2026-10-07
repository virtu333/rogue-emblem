import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';
import { getWeaponArtTier2Effects } from '../src/engine/WeaponArtSystem.js';

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
  const specialChars = datasets?.specialChars ?? (datasets ? [] : readJson('specialChars.json'));
  const recruits = datasets?.recruits ?? readJson('recruits.json');
  const deedsData = datasets?.deeds ?? readJson('deeds.json');
  const terrain = datasets?.terrain ?? readJson('terrain.json');
  const enemiesData = datasets?.enemies ?? readJson('enemies.json');

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

  const specialIds = new Set();
  for (const unit of specialChars) {
    if (specialIds.has(unit.id)) errors.push(`specialChars.json: duplicate id "${unit.id}"`);
    specialIds.add(unit.id);
    for (const name of [unit.class, unit.baseClass]) {
      if (!classNames.has(name))
        errors.push(`specialChars.json:${unit.id} references unknown class "${name}"`);
    }
    for (const id of unit.skills) {
      if (!skillIds.has(id))
        errors.push(`specialChars.json:${unit.id} references unknown skill "${id}"`);
    }
    for (const name of unit.weapons) {
      if (!weaponNames.has(name))
        errors.push(`specialChars.json:${unit.id} references unknown weapon "${name}"`);
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
    // One source per bound art, in the same order (WeaponArtSystem pairs them by index).
    if (weapon?.weaponArtSources !== undefined) {
      const ids = Array.isArray(weapon.weaponArtIds) ? weapon.weaponArtIds.length : 0;
      const sources = Array.isArray(weapon.weaponArtSources) ? weapon.weaponArtSources.length : -1;
      if (sources !== ids)
        errors.push(
          `weapons.json:${weapon.name}.weaponArtSources has ${Math.max(0, sources)} entries for ${ids} weaponArtIds`,
        );
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

  // Personal weapons (signatureOf): one per lord, a type the lord starts able to
  // wield, and never in a loot table (shops stock from the same tables).
  const lordByName = new Map(
    (Array.isArray(lords) ? lords : []).filter((l) => l?.name).map((l) => [l.name, l]),
  );
  const PROFICIENCY_WORD = {
    Sword: 'Swords',
    Lance: 'Lances',
    Axe: 'Axes',
    Bow: 'Bows',
    Tome: 'Tomes',
    Light: 'Light',
  };
  const signatureNames = new Set();
  const signatureOwners = new Set();
  for (const weapon of Array.isArray(weapons) ? weapons : []) {
    if (weapon?.signatureOf === undefined) continue;
    signatureNames.add(weapon.name);
    const lord = lordByName.get(weapon.signatureOf);
    if (!lord) {
      errors.push(
        `weapons.json:${weapon.name}.signatureOf references unknown lord "${weapon.signatureOf}"`,
      );
      continue;
    }
    if (signatureOwners.has(lord.name)) {
      errors.push(`weapons.json: lord "${lord.name}" has more than one signature weapon`);
    }
    signatureOwners.add(lord.name);
    const word = PROFICIENCY_WORD[weapon.type];
    if (!word || !String(lord.weapon || '').includes(word)) {
      errors.push(
        `weapons.json:${weapon.name} is ${lord.name}'s signature weapon but ${lord.name} cannot wield a ${weapon.type}`,
      );
    }
  }
  for (const [actId, table] of Object.entries(lootTables || {})) {
    for (const [poolKey, pool] of Object.entries(table || {})) {
      for (const entry of Array.isArray(pool) ? pool : []) {
        const itemName = typeof entry === 'string' ? entry : entry?.name;
        if (signatureNames.has(itemName)) {
          errors.push(
            `lootTables.json:${actId}.${poolKey} lists signature weapon "${itemName}" (personal weapons never drop or sell)`,
          );
        }
      }
    }
  }

  // Enemy-only gear (classes.json `enemyWeapon`: the Necromancer's Gravesong): a real
  // weapon the class can wield, priced 0 (shops skip it) and in no loot table.
  const enemyWeaponNames = new Set();
  for (const cls of Array.isArray(classes) ? classes : []) {
    if (cls?.enemyWeapon === undefined) continue;
    const weapon = (Array.isArray(weapons) ? weapons : []).find((w) => w?.name === cls.enemyWeapon);
    if (!weapon) {
      errors.push(
        `classes.json:${cls.name}.enemyWeapon references unknown weapon "${cls.enemyWeapon}"`,
      );
      continue;
    }
    enemyWeaponNames.add(weapon.name);
    if (weapon.price !== 0)
      errors.push(
        `weapons.json:${weapon.name} is ${cls.name}'s enemy-only weapon: its price must be 0`,
      );
    const word = PROFICIENCY_WORD[weapon.type];
    if (!word || !String(cls.weaponProficiencies || '').includes(word))
      errors.push(
        `classes.json:${cls.name}.enemyWeapon "${weapon.name}" is a ${weapon.type}, which ${cls.name} cannot wield`,
      );
  }
  for (const [actId, table] of Object.entries(lootTables || {})) {
    for (const [poolKey, pool] of Object.entries(table || {})) {
      for (const entry of Array.isArray(pool) ? pool : []) {
        const itemName = typeof entry === 'string' ? entry : entry?.name;
        if (enemyWeaponNames.has(itemName))
          errors.push(
            `lootTables.json:${actId}.${poolKey} lists enemy-only weapon "${itemName}" (it never drops or sells)`,
          );
      }
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

  // Deeds: Oath skills exist; place phrases name real terrain; weapon
  // phrases name real weapon types (Dark is reserved for a future tome line).
  const terrainNames = toSetByName(terrain);
  const weaponTypes = new Set(
    (Array.isArray(weapons) ? weapons : []).map((w) => w?.type).filter(Boolean),
  );
  const deedIds = new Set();
  for (const deed of Array.isArray(deedsData?.deeds) ? deedsData.deeds : []) {
    if (deedIds.has(deed?.id)) errors.push(`deeds.json: duplicate deed id "${deed?.id}"`);
    deedIds.add(deed?.id);
    if (deed?.oathSkill && !skillIds.has(deed.oathSkill)) {
      errors.push(`deeds.json:${deed.id}.oathSkill references unknown skill "${deed.oathSkill}"`);
    }
  }
  for (const place of Object.keys(deedsData?.places || {})) {
    if (place !== 'default' && !terrainNames.has(place)) {
      errors.push(`deeds.json:places references unknown terrain "${place}"`);
    }
  }
  for (const type of Object.keys(deedsData?.weapons || {})) {
    if (type !== 'Dark' && !weaponTypes.has(type)) {
      errors.push(`deeds.json:weapons references unknown weapon type "${type}"`);
    }
  }

  // Area weapon arts (docs/specs/aoe-weapon-arts.md §3): the retired splash/pierce keys
  // are gone, and each area matches how its art is aimed.
  for (const art of Array.isArray(weaponArtsData?.arts) ? weaponArtsData.arts : []) {
    const where = `weaponArts.json:${art?.id}`;
    if (art?.effects?.aoeSplash) errors.push(`${where} uses retired effects.aoeSplash (use area)`);
    if ((art?.effects?.afterCombat || []).some((e) => e?.type === 'pierce_through'))
      errors.push(`${where} uses retired pierce_through (use area)`);
    for (const id of toStringArray(art?.legendaryWeaponIds)) {
      if (!weaponNames.has(id))
        errors.push(`${where}.legendaryWeaponIds references unknown weapon "${id}"`);
    }
    // Galeforce (killMove): a refresh, player-only (the enemy turn has no refresh).
    if (art?.effects?.killMove !== undefined) {
      if (art.effects.killMove?.refresh !== true)
        errors.push(`${where}.effects.killMove must be { "refresh": true }`);
      const factions = toStringArray(art.allowedFactions);
      if (factions.length !== 1 || factions[0] !== 'player')
        errors.push(`${where} has a killMove: it must be player only`);
      // The turn limit is what stops a refreshed unit from refreshing again.
      if (!(Number.isInteger(art.perTurnLimit) && art.perTurnLimit >= 1))
        errors.push(`${where} has a killMove: it needs a perTurnLimit, or refreshes chain`);
    }
    // Override (docs/specs/phase3.md 3F): the push takes the foes a line hit, so it needs one.
    if (
      (art?.effects?.afterCombat || []).some(
        (e) => e?.type === 'move' && e?.mode === 'pushAreaVictims',
      ) &&
      (art?.area?.shape !== 'line' || art?.targeting === 'chosen_center')
    )
      errors.push(`${where} has a pushAreaVictims move: it needs a normal-attack line area`);
    const area = art?.area;
    const chosenCenter = art?.targeting === 'chosen_center';
    if (chosenCenter && !area) errors.push(`${where} is chosen_center but has no area`);
    if (!area) continue;
    if (area.shape === 'line' && !(area.length >= 1))
      errors.push(`${where}.area is a line without a length`);
    if (area.shape !== 'line' && !(area.radius >= 1)) errors.push(`${where}.area needs a radius`);
    if (chosenCenter) {
      if (area.shape !== 'radius')
        errors.push(`${where} is chosen_center: its area must be a radius`);
      if (area.centerRange === undefined)
        errors.push(`${where} is chosen_center without centerRange`);
      const factions = toStringArray(art.allowedFactions);
      if (factions.length !== 1 || factions[0] !== 'player')
        errors.push(`${where} is chosen_center: the enemy AI cannot aim it (player only)`);
    } else if (area.centerRange !== undefined) {
      errors.push(`${where}.area.centerRange only applies to chosen_center arts`);
    }
  }

  // Elite area arts (enemies.json eliteAreaArts, EnemyAreaArts.js): a real rung, a
  // sane count, and each art one the AI can swing with that weapon type. Never a
  // knockback: no enemy art moves a unit.
  const eliteArts = enemiesData?.eliteAreaArts;
  if (eliteArts) {
    const where = 'enemies.json:eliteAreaArts';
    if (!DIFFICULTY_IDS.includes(eliteArts.minDifficulty))
      errors.push(`${where}.minDifficulty is not a difficulty id ("${eliteArts.minDifficulty}")`);
    const [min, max] = Array.isArray(eliteArts.count) ? eliteArts.count : [];
    if (!(Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min))
      errors.push(`${where}.count must be [min, max] with 1 <= min <= max`);
    const artsById = new Map(
      (Array.isArray(weaponArtsData?.arts) ? weaponArtsData.arts : []).map((a) => [a?.id, a]),
    );
    for (const [type, artId] of Object.entries(eliteArts.byWeaponType || {})) {
      const art = artsById.get(artId);
      const at = `${where}.byWeaponType.${type}`;
      if (!art) {
        errors.push(`${at} references unknown art "${artId}"`);
        continue;
      }
      const types = toStringArray(art.allowedTypes);
      if (!(types.length ? types : [art.weaponType]).includes(type))
        errors.push(`${at}: "${artId}" cannot be used with a ${type}`);
      if (!art.area || (art.targeting ?? 'normal_attack') !== 'normal_attack')
        errors.push(`${at}: "${artId}" is not an area art the AI can swing`);
      const factions = toStringArray(art.allowedFactions);
      if (factions.length && !factions.includes('enemy'))
        errors.push(`${at}: "${artId}" is not open to enemies`);
      if (art.aiEnabled === false) errors.push(`${at}: "${artId}" is off for the AI`);
      if (toStringArray(art.legendaryWeaponIds).length > 0)
        errors.push(`${at}: "${artId}" belongs to a legendary weapon`);
      if (getWeaponArtTier2Effects(art).postCombatMove.length > 0)
        errors.push(`${at}: "${artId}" moves units (no enemy knockback)`);
    }
  }

  return { valid: errors.length === 0, errors };
}
