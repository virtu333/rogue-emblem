import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

describe('enemies data sync guard', () => {
  it('data and public/data enemies JSON are identical', () => {
    const source = JSON.parse(readFileSync('data/enemies.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/enemies.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });
});
