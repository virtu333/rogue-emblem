import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('blessings data sync guard', () => {
  it('data and public/data blessings JSON are identical', () => {
    const source = JSON.parse(readFileSync('data/blessings.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/blessings.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });
});

