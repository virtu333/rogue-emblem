import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { syncDataDirs } from '../tools/syncData.js';

const tempRoots = [];

function makeTempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'emblem-syncdata-'));
  tempRoots.push(root);
  const source = join(root, 'data');
  const target = join(root, 'public-data');
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });
  return { source, target };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('syncData tool', () => {
  it('copies source JSON files and prunes stale JSON files in mirror target', () => {
    const { source, target } = makeTempWorkspace();
    writeFileSync(join(source, 'a.json'), JSON.stringify({ value: 1 }));
    writeFileSync(join(source, 'b.json'), JSON.stringify({ value: 2 }));
    writeFileSync(join(source, 'notes.txt'), 'ignored');

    writeFileSync(join(target, 'a.json'), JSON.stringify({ value: 0 }));
    writeFileSync(join(target, 'stale.json'), JSON.stringify({ stale: true }));
    writeFileSync(join(target, 'keep.txt'), 'keep');

    const lines = [];
    const result = syncDataDirs(source, target, { logger: (line) => lines.push(String(line)) });

    expect(result.syncedCount).toBe(2);
    expect(result.prunedCount).toBe(1);
    expect(result.syncedFiles).toEqual(['a.json', 'b.json']);
    expect(result.prunedFiles).toEqual(['stale.json']);

    expect(JSON.parse(readFileSync(join(target, 'a.json'), 'utf8'))).toEqual({ value: 1 });
    expect(JSON.parse(readFileSync(join(target, 'b.json'), 'utf8'))).toEqual({ value: 2 });
    expect(existsSync(join(target, 'stale.json'))).toBe(false);
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('keep');

    const targetJsonFiles = readdirSync(target)
      .filter((file) => file.endsWith('.json'))
      .sort();
    expect(targetJsonFiles).toEqual(['a.json', 'b.json']);
    expect(lines.some((line) => line.includes('Pruned 1 stale files'))).toBe(true);
  });
});
