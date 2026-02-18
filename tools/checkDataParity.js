import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(__dirname, '..', 'data');
const publicDir = join(__dirname, '..', 'public', 'data');

function listJsonFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeJson(value[key]);
    }
    return out;
  }
  return value;
}

function readAndNormalizeJson(path) {
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw);
  return JSON.stringify(normalizeJson(parsed));
}

function failWithReport(reportLines) {
  console.error('[check:data-parity] Data mirror parity check failed.');
  for (const line of reportLines) {
    console.error(`  - ${line}`);
  }
  console.error('Run `npm run sync-data` to regenerate `public/data/*` from `data/*`.');
  process.exit(1);
}

const sourceFiles = listJsonFiles(sourceDir);
const publicFiles = listJsonFiles(publicDir);

const sourceSet = new Set(sourceFiles);
const publicSet = new Set(publicFiles);

const missingPublicFiles = sourceFiles.filter((file) => !publicSet.has(file));
const extraPublicFiles = publicFiles.filter((file) => !sourceSet.has(file));

const report = [];
if (missingPublicFiles.length > 0) {
  report.push(`Missing in public/data: ${missingPublicFiles.join(', ')}`);
}
if (extraPublicFiles.length > 0) {
  report.push(`Extra in public/data: ${extraPublicFiles.join(', ')}`);
}

const mismatchedFiles = [];
for (const file of sourceFiles) {
  if (!publicSet.has(file)) continue;
  const sourcePath = join(sourceDir, file);
  const publicPath = join(publicDir, file);
  const sourceJson = readAndNormalizeJson(sourcePath);
  const publicJson = readAndNormalizeJson(publicPath);
  if (sourceJson !== publicJson) {
    mismatchedFiles.push(file);
  }
}
if (mismatchedFiles.length > 0) {
  report.push(`Out-of-sync content: ${mismatchedFiles.join(', ')}`);
}

if (report.length > 0) {
  failWithReport(report);
}

console.log(`[check:data-parity] OK: ${sourceFiles.length} mirrored JSON files are in sync.`);
