import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('turn bonus data sync guard', () => {
  it('data and public/data turnBonus JSON are identical', () => {
    const source = JSON.parse(readFileSync('data/turnBonus.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/turnBonus.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });
});
