import { describe, it, expect } from 'vitest';
import {
  ATMOSPHERE_GRADES,
  LIGHT_PRESETS,
  resolveAtmosphere,
  resolveAtmosphereMode,
  defaultAtmosphereMode,
  lightOptionsForMode,
  gradeToUniforms,
  tuneGrade,
  BIOME_TUNES,
} from '../src/art/atmosphereConfig.js';

describe('resolveAtmosphere — act moods', () => {
  it.each([
    ['act1', 'act1', 'Ember Dusk', false],
    ['act2', 'act2', 'Iron Rain', false],
    ['act3', 'act3', 'Bleached Rite', false],
    ['act4', 'act4', 'Ashfall', true],
  ])('%s on grassland → %s', (act, gradeKey, label, night) => {
    const r = resolveAtmosphere({ act, biome: null });
    expect(r.gradeKey).toBe(gradeKey);
    expect(r.label).toBe(label);
    expect(r.night).toBe(night);
    expect(Boolean(r.lightOptions)).toBe(night);
  });

  it('unknown acts fall back to Ember Dusk; postAct keeps the Ashfall night', () => {
    expect(resolveAtmosphere({ act: 'mystery' }).gradeKey).toBe('act1');
    expect(resolveAtmosphere({}).gradeKey).toBe('act1');
    expect(resolveAtmosphere({ act: 'postAct' }).gradeKey).toBe('act4');
  });

  it('final boss gets the torchlit Throne with a night layer and pillar torches', () => {
    const r = resolveAtmosphere({ act: 'finalBoss', biome: 'void', isBoss: true });
    expect(r.gradeKey).toBe('throne');
    expect(r.label).toBe('The Throne');
    expect(r.night).toBe(true);
    expect(r.lightOptions.emitters.Pillar).toBeDefined();
    expect(resolveAtmosphere({ act: 'act3', isFinalBoss: true }).gradeKey).toBe('throne');
  });

  it('the Entity, the secret act and void maps sink into the Deep', () => {
    for (const ctx of [
      { act: 'finalBoss', biome: 'void', hasEntity: true },
      { act: 'secretAct' },
      { act: 'act4', isSecret: true },
      { act: 'act2', biome: 'void' },
    ]) {
      const r = resolveAtmosphere(ctx);
      expect(r.gradeKey, JSON.stringify(ctx)).toBe('deep');
      expect(r.night).toBe(true);
      expect(r.lightOptions.entityGlow).toBeTruthy();
    }
  });

  it('tundra turns the Act IV night cold (no warm pink on snow)', () => {
    for (const biome of ['tundra', 'snow', 'Tundra']) {
      const r = resolveAtmosphere({ act: 'act4', biome });
      expect(r.gradeKey).toBe('rime');
      expect(r.night).toBe(true);
    }
    const rime = ATMOSPHERE_GRADES.rime;
    // Highlights lean blue, and there is almost no warm key.
    const hl = parseInt(rime.highlight.slice(1), 16);
    expect(hl & 0xff).toBeGreaterThan((hl >> 16) & 0xff);
    expect(rime.key).toBeLessThan(ATMOSPHERE_GRADES.act4.key / 2);
    expect(LIGHT_PRESETS.rime.color).not.toBe(LIGHT_PRESETS.ashfall.color);
  });

  it('snow outside the night act keeps the act but cools it', () => {
    const r = resolveAtmosphere({ act: 'act2', biome: 'tundra' });
    expect(r.gradeKey).toBe('act2');
    expect(r.grade.key).toBeCloseTo(ATMOSPHERE_GRADES.act2.key * BIOME_TUNES.tundra.keyScale);
    expect(r.grade.highlight).toBe(BIOME_TUNES.tundra.highlight);
  });

  it('volcano keeps Ashfall; castle and swamp tune the grade slightly', () => {
    expect(resolveAtmosphere({ act: 'act4', biome: 'volcano' }).grade).toEqual({
      ...ATMOSPHERE_GRADES.act4,
    });
    const castle = resolveAtmosphere({ act: 'act2', biome: 'castle' }).grade;
    expect(castle.contrast).toBeCloseTo(ATMOSPHERE_GRADES.act2.contrast + 0.03);
    expect(castle.vignette).toBeGreaterThan(ATMOSPHERE_GRADES.act2.vignette);
    const swamp = resolveAtmosphere({ act: 'act3', biome: 'swamp' }).grade;
    expect(swamp.sat).toBeLessThan(ATMOSPHERE_GRADES.act3.sat);
    expect(swamp.shadow).toBe(BIOME_TUNES.swamp.shadow);
    // Tunes are small: nothing moves more than ~10%.
    expect(Math.abs(swamp.sat / ATMOSPHERE_GRADES.act3.sat - 1)).toBeLessThan(0.1);
    const castleNight = resolveAtmosphere({ act: 'act4', biome: 'castle' });
    expect(castleNight.gradeKey).toBe('act4');
    expect(castleNight.grade.contrast).toBeGreaterThan(ATMOSPHERE_GRADES.act4.contrast);
  });

  it('tutorial battles use the plain Act I grade, never night', () => {
    for (const act of ['act1', 'act4', 'finalBoss']) {
      const r = resolveAtmosphere({ act, isTutorial: true, biome: 'tundra' });
      expect(r.gradeKey).toBe('act1');
      expect(r.night).toBe(false);
      expect(r.grade).toEqual({ ...ATMOSPHERE_GRADES.act1 });
    }
  });

  it('dev override forces a grade and ignores unknown values', () => {
    expect(resolveAtmosphere({ act: 'act1', override: 'deep' }).gradeKey).toBe('deep');
    expect(resolveAtmosphere({ act: 'act1', override: 'rime' }).night).toBe(true);
    expect(resolveAtmosphere({ act: 'act2', override: 'nonsense' }).gradeKey).toBe('act2');
  });

  it('never mutates the shared grade/preset objects', () => {
    const before = JSON.stringify([ATMOSPHERE_GRADES, LIGHT_PRESETS]);
    const r = resolveAtmosphere({ act: 'act4', biome: 'castle' });
    r.grade.sat = 99;
    r.lightOptions.darkness = 99;
    expect(JSON.stringify([ATMOSPHERE_GRADES, LIGHT_PRESETS])).toBe(before);
  });

  it('every grade is complete', () => {
    for (const [key, g] of Object.entries(ATMOSPHERE_GRADES)) {
      for (const field of [
        'label',
        'shadow',
        'highlight',
        'split',
        'sat',
        'contrast',
        'exposure',
        'key',
        'vignette',
        'grain',
        'aberration',
      ])
        expect(g[field], `${key}.${field}`).toBeDefined();
    }
  });
});

describe('resolveAtmosphereMode', () => {
  it('auto defaults to Reduced on phones and Full on desktop', () => {
    expect(resolveAtmosphereMode('auto', { mobile: true }).mode).toBe('reduced');
    expect(resolveAtmosphereMode('auto', { mobile: false }).mode).toBe('full');
    expect(resolveAtmosphereMode(undefined, {}).mode).toBe('full');
    expect(defaultAtmosphereMode({ mobile: true })).toBe('reduced');
    expect(defaultAtmosphereMode()).toBe('full');
  });

  it('explicit choices win over the device default', () => {
    expect(resolveAtmosphereMode('full', { mobile: true }).mode).toBe('full');
    expect(resolveAtmosphereMode('off', { mobile: false }).mode).toBe('off');
    expect(resolveAtmosphereMode('reduced', {}).mode).toBe('reduced');
    expect(resolveAtmosphereMode('ultra', { mobile: true }).mode).toBe('reduced');
  });

  it('no WebGL means Off', () => {
    expect(resolveAtmosphereMode('full', { webgl: false }).mode).toBe('off');
  });

  it('low effects quality caps Full at Reduced; reduced motion stops flicker and grain', () => {
    expect(resolveAtmosphereMode('full', { effectsQuality: 'low' }).mode).toBe('reduced');
    expect(resolveAtmosphereMode('off', { effectsQuality: 'low' }).mode).toBe('off');
    const full = resolveAtmosphereMode('full', {});
    expect(full).toMatchObject({ flicker: true, animatedGrain: true });
    const still = resolveAtmosphereMode('full', { reduceMotion: true });
    expect(still).toMatchObject({ mode: 'full', flicker: false, animatedGrain: false });
    expect(resolveAtmosphereMode('reduced', {}).flicker).toBe(false);
  });
});

describe('mode scaling', () => {
  it('Reduced drops grain and aberration and weakens the vignette', () => {
    const g = ATMOSPHERE_GRADES.deep;
    const full = gradeToUniforms(g);
    const reduced = gradeToUniforms(g, { reduced: true });
    expect(full.grain).toBeGreaterThan(0);
    expect(full.aberration).toBeGreaterThan(0);
    expect(reduced.grain).toBe(0);
    expect(reduced.aberration).toBe(0);
    expect(reduced.vignette).toBeLessThan(full.vignette);
    expect(reduced.animatedGrain).toBe(false);
    expect(gradeToUniforms(g, { animatedGrain: false }).animatedGrain).toBe(false);
  });

  it('normalizes split-tone hue directions', () => {
    const u = gradeToUniforms(ATMOSPHERE_GRADES.act1);
    expect(Math.hypot(...u.shadow)).toBeCloseTo(1);
    expect(Math.hypot(...u.highlight)).toBeCloseTo(1);
  });

  it('Reduced night is lighter and never flickers; Off has no night layer', () => {
    const base = LIGHT_PRESETS.ashfall;
    const full = lightOptionsForMode(base, 'full');
    const reduced = lightOptionsForMode(base, 'reduced');
    expect(full.flicker).toBe(true);
    expect(lightOptionsForMode(base, 'full', { flicker: false }).flicker).toBe(false);
    expect(reduced.flicker).toBe(false);
    expect(reduced.darkness).toBeLessThan(full.darkness);
    expect(lightOptionsForMode(base, 'off')).toBeNull();
    expect(lightOptionsForMode(null, 'full')).toBeNull();
  });

  it('tuneGrade is relative and clamps the vignette', () => {
    const g = { ...ATMOSPHERE_GRADES.act1, vignette: 0.98 };
    expect(tuneGrade(g, { vignette: 0.1 }).vignette).toBe(1);
    expect(tuneGrade(g, null)).toEqual(g);
  });
});
