import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('affixes data sync guard', () => {
  it('data and public/data affixes JSON are identical', () => {
    const source = JSON.parse(readFileSync('data/affixes.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/affixes.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });
});

