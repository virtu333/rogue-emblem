import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
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
  { schema: 'consumables.schema.json', data: 'consumables.json' },
  { schema: 'recruits.schema.json', data: 'recruits.json' },
  { schema: 'metaUpgrades.schema.json', data: 'metaUpgrades.json' },
  { schema: 'imbues.schema.json', data: 'imbues.json' },
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
const mtResult = validateMapTemplatesConfig(mapTemplatesData);
if (mtResult.valid) {
  console.log('  OK  mapTemplates.json (engine validator)');
} else {
  console.error('FAIL  mapTemplates.json (engine validator)');
  for (const err of mtResult.errors) {
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
