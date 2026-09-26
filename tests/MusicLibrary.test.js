import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ENTITY_FINALE,
  MUSIC,
  MUSIC_LAYERS,
  getBossEnrageLayer,
  getBossMusicKey,
  getMusicLoop,
} from '../src/utils/musicConfig.js';
import { MUSIC_LOOPS } from '../src/utils/musicLoops.js';
import { MUSIC_STINGERS } from '../src/utils/musicStingers.js';

const ROOT = join(import.meta.dirname, '..');
const MUSIC_DIR = join(ROOT, 'assets', 'audio', 'music');
const PUBLIC_DIR = join(ROOT, 'public', 'assets', 'audio', 'music');
const STINGER_DIR = join(ROOT, 'assets', 'audio', 'stingers');
const PUBLIC_STINGER_DIR = join(ROOT, 'public', 'assets', 'audio', 'stingers');
const enemies = JSON.parse(readFileSync(join(ROOT, 'data', 'enemies.json'), 'utf8'));

// Every boss, with the act it is fought in, and the enrage layer of its theme.
const bossEnrage = Object.entries(enemies.bosses).flatMap(([act, list]) =>
  list.map((boss) => {
    const theme = getBossMusicKey(boss.name, act);
    return { name: boss.name, act, theme, layer: getBossEnrageLayer(theme, boss.name) };
  }),
);

function collectKeys(value, out = new Set()) {
  if (typeof value === 'string') out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => collectKeys(v, out));
  return out;
}

const referenced = collectKeys(MUSIC);
for (const layers of Object.values(MUSIC_LAYERS)) collectKeys(layers, referenced);
for (const { layer } of bossEnrage) if (layer) referenced.add(layer);
// the Entity's finale and its hum stem (BattleMusicController)
referenced.add(ENTITY_FINALE.track);
referenced.add(ENTITY_FINALE.hum);
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

  it('every boss has its own enrage layer on the theme it is fought to', () => {
    for (const { name, act, theme, layer } of bossEnrage) {
      // the Entity has no enrage layer: turn pressure starts its finale instead
      if (theme === ENTITY_FINALE.theme) {
        expect(layer, name).toBeNull();
        continue;
      }
      expect(layer, `${name} (${act}) has an enrage layer on ${theme}`).toBeTruthy();
      const base = getMusicLoop(theme);
      const loop = getMusicLoop(layer);
      expect(loop.loopStart).toBe(base.loopStart);
      expect(loop.loopEnd).toBe(base.loopEnd);
      expect(loop.duration).toBe(base.duration);
    }
  });

  it("the Entity's finale: hum stem on its timeline, a hinge cue that hands over to it", () => {
    expect(MUSIC.bossByName['The Entity']).toBe(ENTITY_FINALE.theme);
    const finale = getMusicLoop(ENTITY_FINALE.track);
    const hum = getMusicLoop(ENTITY_FINALE.hum);
    expect(finale.tonic).toBe(getMusicLoop(ENTITY_FINALE.theme).tonic);
    expect(hum.loopStart).toBe(finale.loopStart);
    expect(hum.loopEnd).toBe(finale.loopEnd);
    expect(hum.duration).toBe(finale.duration);
    const hinge = MUSIC_STINGERS[ENTITY_FINALE.hinge];
    expect(hinge?.keyed).toBe(false);
    // the finale's downbeat falls as the violin's last note ends, before the tail
    expect(hinge.handoff).toBeGreaterThan(1);
    expect(Math.abs(hinge.handoff - hinge.notesEnd)).toBeLessThan(0.01);
    expect(hinge.handoff).toBeLessThan(hinge.duration);
    expect(ENTITY_FINALE.silenceMs).toBeGreaterThanOrEqual(1000);
  });

  it('every field battle theme is adaptive: act pools, places and situations', () => {
    const battleThemes = new Set([
      ...Object.values(MUSIC.battle).flat(),
      MUSIC.escape,
      ...collectKeys(MUSIC.battleBiome),
      ...collectKeys(MUSIC.battleSituation),
    ]);
    for (const key of battleThemes) {
      expect(MUSIC_LAYERS[key]?.calm, `${key} has a calm mix`).toBeTruthy();
    }
    // no act pool plays another act's theme twice over, and none repeats within itself
    for (const [act, pool] of Object.entries(MUSIC.battle)) {
      expect(new Set(pool).size, act).toBe(pool.length);
    }
  });

  it("place themes name biomes the map templates use; situations are the selector's", () => {
    const templates = JSON.parse(readFileSync(join(ROOT, 'data', 'mapTemplates.json'), 'utf8'));
    const biomes = new Set(
      Object.values(templates)
        .flat()
        .filter((t) => t && typeof t === 'object')
        .map((t) => t.biome || 'grassland'),
    );
    for (const biome of Object.keys(MUSIC.battleBiome)) {
      expect(biomes.has(biome), `${biome} is a template biome`).toBe(true);
    }
    const situations = ['eclipsed', 'village', 'rescue', 'elite', 'caravan', 'fog'];
    for (const [situation, entry] of Object.entries(MUSIC.battleSituation)) {
      expect(situations).toContain(situation);
      // a table by act names only real acts
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        for (const act of Object.keys(entry)) expect(MUSIC.battle, act).toHaveProperty(act);
      }
    }
    // every act that fights an elite company has its own
    const elite = MUSIC.battleSituation.elite;
    const eliteKeys = ['act1', 'act2', 'act3', 'act4'].map((act) => elite[act]);
    expect(new Set(eliteKeys).size).toBe(4);
  });

  it('the story antagonists get their own themes, wherever they are fought', () => {
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

const stingerFiles = (name, entry) =>
  entry.keyed ? entry.tonics.map((t) => `stinger_${name}_${t}`) : [`stinger_${name}`];

describe('stinger library', () => {
  const expected = new Set(
    Object.entries(MUSIC_STINGERS).flatMap(([name, entry]) => stingerFiles(name, entry)),
  );

  it('every stinger file exists in assets/ and public/', () => {
    for (const key of expected) {
      expect(existsSync(join(STINGER_DIR, `${key}.mp3`)), `${key} in assets`).toBe(true);
      expect(existsSync(join(PUBLIC_STINGER_DIR, `${key}.mp3`)), `${key} in public`).toBe(true);
    }
  });

  it('ships no orphaned stinger files', () => {
    for (const dir of [STINGER_DIR, PUBLIC_STINGER_DIR]) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.mp3'))) {
        expect(expected.has(f.replace(/\.mp3$/, '')), `${f} is in the manifest`).toBe(true);
      }
    }
  });

  it('keyed stingers exist in every key the music is in', () => {
    const tonics = new Set(Object.values(MUSIC_LOOPS).map((e) => e.tonic));
    for (const [name, entry] of Object.entries(MUSIC_STINGERS)) {
      if (!entry.keyed) continue;
      for (const t of tonics) expect(entry.tonics, `${name} in ${t}`).toContain(t);
    }
  });

  it('records when the notes of each stinger end, within its length', () => {
    for (const [name, entry] of Object.entries(MUSIC_STINGERS)) {
      expect(entry.notesEnd, name).toBeGreaterThan(0);
      expect(entry.notesEnd, name).toBeLessThanOrEqual(entry.duration);
    }
  });
});
