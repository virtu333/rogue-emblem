import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';

const DATA_DIR = path.resolve('data');
const SCHEMA_DIR = path.resolve('schemas');

const AJV_SCHEMAS = [
  { schema: 'classes.schema.json', data: 'classes.json' },
  { schema: 'weapons.schema.json', data: 'weapons.json' },
  { schema: 'skills.schema.json', data: 'skills.json' },
  { schema: 'enemies.schema.json', data: 'enemies.json' },
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

if (failed) {
  process.exit(1);
}
