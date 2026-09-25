import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { MUSIC, MUSIC_LAYERS, getBossMusicKey, getMusicLoop } from '../src/utils/musicConfig.js';
import { MUSIC_LOOPS } from '../src/utils/musicLoops.js';

const ROOT = join(import.meta.dirname, '..');
const MUSIC_DIR = join(ROOT, 'assets', 'audio', 'music');
const PUBLIC_DIR = join(ROOT, 'public', 'assets', 'audio', 'music');

function collectKeys(value, out = new Set()) {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => collectKeys(v, out));
  return out;
}

const referenced = collectKeys(MUSIC);
for (const layers of Object.values(MUSIC_LAYERS)) collectKeys(layers, referenced);
// the HTML login screen plays this one directly (index.html)
referenced.add('music_login');

describe('music library', () => {
  it('every referenced track exists in assets/ and public/', () => {
    for (const key of referenced) {
      expect(existsSync(join(MUSIC_DIR, `${key}.mp3`)), `${key} in assets`).toBe(true);
      expect(existsSync(join(PUBLIC_DIR, `${key}.mp3`)), `${key} in public`).toBe(true);
    }
  });

  it('ships no orphaned tracks', () => {
    for (const dir of [MUSIC_DIR, PUBLIC_DIR]) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.mp3'));
      for (const f of files) {
        expect(referenced.has(f.replace(/\.mp3$/, '')), `${f} is referenced`).toBe(true);
      }
    }
  });

  it('every track has sane loop points', () => {
    for (const key of referenced) {
      const loop = getMusicLoop(key);
      expect(loop, `${key} has loop points`).toBeTruthy();
      expect(loop.loopStart).toBeGreaterThanOrEqual(0);
      expect(loop.loopEnd).toBeGreaterThan(loop.loopStart + 5);
      expect(loop.loopEnd).toBeLessThanOrEqual(loop.duration);
    }
    expect(Object.keys(MUSIC_LOOPS).length).toBeGreaterThanOrEqual(referenced.size);
  });

  it('adaptive layers share their track timeline exactly', () => {
    for (const [key, layers] of Object.entries(MUSIC_LAYERS)) {
      const base = getMusicLoop(key);
      for (const layerKey of Object.values(layers)) {
        const loop = getMusicLoop(layerKey);
        expect(loop.loopStart, layerKey).toBe(base.loopStart);
        expect(loop.loopEnd, layerKey).toBe(base.loopEnd);
        expect(loop.duration, layerKey).toBe(base.duration);
      }
    }
  });

  it('the login screen track is a whole-file loop (HTML audio loops the file)', () => {
    const loop = getMusicLoop('music_login');
    expect(loop.loopStart).toBe(0);
    expect(Math.abs(loop.loopEnd - loop.duration)).toBeLessThan(0.01);
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('assets/audio/music/music_login.mp3');
  });

  it('the story antagonists get their own themes, wherever they are fought', () => {
    const enemies = JSON.parse(readFileSync(join(ROOT, 'data', 'enemies.json'), 'utf8'));
    const bossNames = new Set(
      Object.values(enemies.bosses)
        .flat()
        .map((b) => b.name),
    );
    for (const name of Object.keys(MUSIC.bossByName)) {
      expect(bossNames.has(name), `${name} is a boss in enemies.json`).toBe(true);
      expect(getBossMusicKey(name, 'act1')).toBe(MUSIC.bossByName[name]);
    }
    expect(getBossMusicKey('Iron Captain', 'act1')).toBe(MUSIC.boss.act1);
    expect(getBossMusicKey(null, 'act2')).toBe(MUSIC.boss.act2);
  });
});
