import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import {
  reinforcementTurnOffsetsFrom,
  validateMapTemplatesConfig,
} from '../src/engine/MapTemplateEngine.js';
import { validatePrologueConfig } from '../src/engine/Prologue.js';
import { validateBlessingsConfig } from '../src/engine/BlessingEngine.js';
import { validateEventsConfig } from '../src/engine/EventValidation.js';
import { validateCrossReferences } from './validateCrossReferences.js';

const DATA_DIR = path.resolve('data');
const SCHEMA_DIR = path.resolve('schemas');

const AJV_SCHEMAS = [
  { schema: 'classes.schema.json', data: 'classes.json' },
  { schema: 'weapons.schema.json', data: 'weapons.json' },
  { schema: 'skills.schema.json', data: 'skills.json' },
  { schema: 'enemies.schema.json', data: 'enemies.json' },
  { schema: 'affixes.schema.json', data: 'affixes.json' },
  { schema: 'blessings.schema.json', data: 'blessings.json' },
  { schema: 'weaponArts.schema.json', data: 'weaponArts.json' },
  { schema: 'accessories.schema.json', data: 'accessories.json' },
  { schema: 'lootTables.schema.json', data: 'lootTables.json' },
  { schema: 'terrain.schema.json', data: 'terrain.json' },
  { schema: 'lords.schema.json', data: 'lords.json' },
  { schema: 'specialChars.schema.json', data: 'specialChars.json' },
  { schema: 'consumables.schema.json', data: 'consumables.json' },
  { schema: 'recruits.schema.json', data: 'recruits.json' },
  { schema: 'metaUpgrades.schema.json', data: 'metaUpgrades.json' },
  { schema: 'imbues.schema.json', data: 'imbues.json' },
  { schema: 'deeds.schema.json', data: 'deeds.json' },
  { schema: 'traits.schema.json', data: 'traits.json' },
  { schema: 'eclipse.schema.json', data: 'eclipse.json' },
  { schema: 'events.schema.json', data: 'events.json' },
  { schema: 'marks.schema.json', data: 'marks.json' },
];

const ajv = new Ajv({ allErrors: true });
let failed = false;

// Validate AJV schemas
for (const { schema, data } of AJV_SCHEMAS) {
  const schemaJson = JSON.parse(readFileSync(path.join(SCHEMA_DIR, schema), 'utf-8'));
  const dataJson = JSON.parse(readFileSync(path.join(DATA_DIR, data), 'utf-8'));
  const validate = ajv.compile(schemaJson);
  const valid = validate(dataJson);
  if (valid) {
    console.log(`  OK  ${data}`);
  } else {
    console.error(`FAIL  ${data}`);
    for (const err of validate.errors) {
      console.error(`      ${err.instancePath || '/'} ${err.message}`);
    }
    failed = true;
  }
}

// Validate mapTemplates using existing engine validator
const mapTemplatesData = JSON.parse(
  readFileSync(path.join(DATA_DIR, 'mapTemplates.json'), 'utf-8'),
);
const mtResult = validateMapTemplatesConfig(mapTemplatesData, {
  reinforcementTurnOffsets: reinforcementTurnOffsetsFrom(
    JSON.parse(readFileSync(path.join(DATA_DIR, 'difficulty.json'), 'utf-8')),
  ),
});
if (mtResult.valid) {
  console.log('  OK  mapTemplates.json (engine validator)');
} else {
  console.error('FAIL  mapTemplates.json (engine validator)');
  for (const err of mtResult.errors) {
    console.error(`      ${err}`);
  }
  failed = true;
}

// Validate the prologue's authored chapters against the game data (engine validator)
const readData = (name) => JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf-8'));
const prologueResult = validatePrologueConfig(readData('prologue.json'), {
  terrain: readData('terrain.json'),
  lords: readData('lords.json'),
  classes: readData('classes.json'),
  weapons: readData('weapons.json'),
  consumables: readData('consumables.json'),
  skills: readData('skills.json'),
  traits: readData('traits.json'),
  enemies: readData('enemies.json'),
  specialChars: readData('specialChars.json'),
  dialogue: readData('dialogue.json'),
});
if (prologueResult.valid) {
  console.log('  OK  prologue.json (engine validator)');
} else {
  console.error('FAIL  prologue.json (engine validator)');
  for (const err of prologueResult.errors) {
    console.error(`      ${err}`);
  }
  failed = true;
}

// Validate the blessings catalog (engine validator: shape, v3 pricing, and the params of the
// boons whose handler would otherwise skip a malformed set and ship a card that does nothing)
const blessingsResult = validateBlessingsConfig(readData('blessings.json'));
if (blessingsResult.valid) {
  console.log('  OK  blessings.json (engine validator)');
} else {
  console.error('FAIL  blessings.json (engine validator)');
  for (const err of blessingsResult.errors) {
    console.error(`      ${err}`);
  }
  failed = true;
}

// Validate the story events' semantics against the game data (engine validator)
const eventsResult = validateEventsConfig(readData('events.json'), {
  skills: readData('skills.json'),
  weapons: readData('weapons.json'),
  consumables: readData('consumables.json'),
  classes: readData('classes.json'),
  blessings: readData('blessings.json'),
  eclipse: readData('eclipse.json'),
  lootTables: readData('lootTables.json'),
  traits: readData('traits.json'),
  recruits: readData('recruits.json'),
  accessories: readData('accessories.json'),
});
if (eventsResult.valid) {
  console.log('  OK  events.json (engine validator)');
} else {
  console.error('FAIL  events.json (engine validator)');
  for (const err of eventsResult.errors) {
    console.error(`      ${err}`);
  }
  failed = true;
}

// Validate cross-file references
const crossRef = validateCrossReferences();
if (crossRef.valid) {
  console.log('  OK  cross-file references');
} else {
  console.error('FAIL  cross-file references');
  for (const err of crossRef.errors) {
    console.error(`      ${err}`);
  }
  failed = true;
}

if (failed) {
  process.exit(1);
}
