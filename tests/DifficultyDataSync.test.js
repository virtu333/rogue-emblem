import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('difficulty data sync guard', () => {
  it('data and public/data difficulty JSON are identical', () => {
    const source = JSON.parse(readFileSync('data/difficulty.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/difficulty.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });
});
