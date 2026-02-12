import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('meta upgrades data guards', () => {
  it('keeps data and public meta-upgrades JSON in sync', () => {
    const source = JSON.parse(readFileSync('data/metaUpgrades.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/metaUpgrades.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });
});
