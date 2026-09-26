import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { visionLabel, fitHintSegments } from '../src/ui/visionLabel.js';

describe('shared Vision labels and shortcut fitting', () => {
  it('names the resource and action distinctly in both layouts', () => {
    expect(visionLabel(2)).toBe('Vision · 2 left');
    expect(visionLabel(0, { desktop: true })).toBe('Vision · 0 left · [R] Rewind');
  });
  it('fits the longest priority prefix and never emits a clipped shortcut', () => {
    const parts = ['[R] Rewind', '[N] next ready', '[V] details'];
    expect(fitHintSegments(parts, 150, (s) => s.length * 6)).toBe('[R] Rewind');
    expect(fitHintSegments(parts, 162, (s) => s.length * 6)).toBe('[R] Rewind · [N] next ready');
    expect(fitHintSegments(parts, 30, (s) => s.length * 6)).toBe('');
  });
});

it('retires the old Eye resource label from UI/help strings', () => {
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );
  for (const file of [...walk('src/ui'), ...walk('src/data')].filter((f) => f.endsWith('.js')))
    expect(readFileSync(file, 'utf8'), file).not.toContain('Eye:');
});
