import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('data/public parity guards', () => {
  it('keeps weapons JSON in sync', () => {
    const source = readJson('data/weapons.json');
    const publicCopy = readJson('public/data/weapons.json');
    expect(publicCopy).toEqual(source);
  });

  it('keeps loot tables JSON in sync', () => {
    const source = readJson('data/lootTables.json');
    const publicCopy = readJson('public/data/lootTables.json');
    expect(publicCopy).toEqual(source);
  });
});
