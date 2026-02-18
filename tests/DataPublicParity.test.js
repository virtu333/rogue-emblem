import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';

function listJsonFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map((entry) => normalizeJson(entry));
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
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return normalizeJson(parsed);
}

describe('data/public parity guards', () => {
  it('keeps JSON mirror file coverage in sync', () => {
    const sourceFiles = listJsonFiles('data');
    const publicFiles = listJsonFiles('public/data');
    expect(publicFiles).toEqual(sourceFiles);
  });

  it('keeps every mirrored JSON file content-equal after normalization', () => {
    const sourceFiles = listJsonFiles('data');
    for (const file of sourceFiles) {
      const source = readAndNormalizeJson(`data/${file}`);
      const publicCopy = readAndNormalizeJson(`public/data/${file}`);
      expect(publicCopy).toEqual(source);
    }
  });
});
