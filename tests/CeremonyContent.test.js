import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  default: { Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } } },
}));
import { loadGameData } from './testData.js';
import regions from '../data/regions.json';
import { ATMOSPHERE_GRADES } from '../src/art/AtmosphereFX.js';
import {
  ACT_GRADE_KEYS,
  CEREMONY_TIMING,
  GRADE_NAMES,
  WORDLESS_MARK,
  actCardContent,
  actGradeName,
  actLabel,
  bossBarView,
  bossCardContent,
  bossEpithet,
  bossPressureStatus,
  ceremonyTiming,
  createBossBarState,
  cutInContent,
  defeatContent,
  fallenContent,
  fateOfferContent,
  felledContent,
  findBossDefinition,
  isWordlessBoss,
  objectiveWord,
  phaseContent,
  portraitFraming,
  reduceBossBar,
  romanNumeral,
  runEndContent,
  shouldShowFelled,
  victoryContent,
} from '../src/ui/ceremonyContent.js';
import framing from '../src/ui/ceremonyPortraitFraming.json';
import portraitManifest from '../src/ui/RebuiltPortraitManifest.json';

const gameData = loadGameData();
const bosses = Object.values(gameData.enemies.bosses).flat();

describe('boss epithets (data)', () => {
  it('every named boss carries a short epithet; the Entity has none', () => {
    expect(bosses.length).toBe(11);
    for (const boss of bosses) {
      if (boss.isEntity) {
        expect(boss.epithet, boss.name).toBeUndefined();
        continue;
      }
      expect(typeof boss.epithet, boss.name).toBe('string');
      expect(boss.epithet.length, boss.name).toBeGreaterThan(8);
      // Fits the card at 667×375 once fitted (and never repeats the name).
      expect(boss.epithet.length, boss.name).toBeLessThanOrEqual(32);
      expect(boss.epithet.toLowerCase()).not.toContain(boss.name.toLowerCase());
    }
  });

  it('looks epithets up by name across acts', () => {
    expect(bossEpithet(gameData.enemies, 'Dark Rider')).toBe('Bearer of the Sealed Orders');
    expect(bossEpithet(gameData.enemies, 'The Lieutenant')).toBe('From the Far Side of the Glass');
    expect(bossEpithet(gameData.enemies, 'Nobody')).toBe('');
    expect(bossEpithet(null, 'Dark Rider')).toBe('');
    expect(findBossDefinition(gameData.enemies, 'Iron Wall').className).toBe('General');
  });

  it('the encounter card names the boss, its act and class; the Entity gets only "· · ·"', () => {
    const rider = bossCardContent({
      unit: { name: 'Dark Rider', className: 'Dark Knight', isBoss: true },
      enemiesData: gameData.enemies,
      actId: 'act2',
    });
    expect(rider).toEqual({
      kind: 'boss',
      kicker: 'Act II · Dark Knight',
      name: 'Dark Rider',
      epithet: 'Bearer of the Sealed Orders',
    });
    const entity = bossCardContent({
      unit: { name: 'The Entity', className: 'Entity', isBoss: true, isEntity: true },
      enemiesData: gameData.enemies,
      actId: 'finalBoss',
    });
    expect(entity).toEqual({ kind: 'entity', kicker: '', name: WORDLESS_MARK, epithet: '' });
    // Wordless by data even when the live unit lost its flag.
    expect(isWordlessBoss({ name: 'The Entity' }, gameData.enemies)).toBe(true);
    expect(bossCardContent({ unit: null })).toBeNull();
  });
});

describe('acts', () => {
  it('labels acts in roman numerals and names the late stages', () => {
    expect(romanNumeral(1)).toBe('I');
    expect(romanNumeral(4)).toBe('IV');
    expect(romanNumeral(9)).toBe('IX');
    expect(romanNumeral(0)).toBe('');
    expect(actLabel('act1')).toBe('Act I');
    expect(actLabel('act3')).toBe('Act III');
    expect(actLabel('finalBoss')).toBe('Final Act');
    expect(actLabel('secretAct')).toBe('Beyond the Acts');
    expect(actLabel('bogus')).toBe('');
  });

  it('act cards use the region names and the approved grade names', () => {
    expect(actCardContent('act1')).toEqual({
      kicker: 'Act I',
      title: 'Border Marches',
      grade: 'Ember Dusk',
    });
    expect(actCardContent('act2').grade).toBe('Iron Rain');
    expect(actCardContent('act3').grade).toBe('Bleached Rite');
    expect(actCardContent('act4')).toEqual({
      kicker: 'Act IV',
      title: 'Ashen Frontier',
      grade: 'Ashfall',
    });
    expect(actCardContent('finalBoss')).toEqual({
      kicker: 'Final Act',
      title: regions.finalBoss,
      grade: 'The Deep',
    });
    for (const actId of Object.keys(regions)) expect(actCardContent(actId).title).toBeTruthy();
  });

  it('grade names never drift from the atmosphere grades', () => {
    for (const [actId, key] of Object.entries(ACT_GRADE_KEYS)) {
      expect(ATMOSPHERE_GRADES[key], actId).toBeTruthy();
      expect(actGradeName(actId)).toBe(ATMOSPHERE_GRADES[key].label);
      expect(GRADE_NAMES[key]).toBe(ATMOSPHERE_GRADES[key].label);
    }
  });
});

describe('battle outcomes', () => {
  it('maps every objective to its word', () => {
    expect(objectiveWord('rout')).toBe('ROUTED');
    expect(objectiveWord('seize')).toBe('SEIZED');
    expect(objectiveWord('escape')).toBe('ESCAPED');
    expect(objectiveWord('defend')).toBe('DEFENDED');
    expect(objectiveWord(undefined)).toBe('VICTORY');
    // Every objective the map templates can produce has a word.
    for (const objective of Object.keys(gameData.mapTemplates))
      expect(objectiveWord(objective), objective).not.toBe('VICTORY');
  });

  it('victory band reads turn · par · rank and tolerates missing par', () => {
    expect(victoryContent({ objective: 'rout', turn: 7, par: 8, rating: 'S' })).toEqual({
      word: 'ROUTED',
      sub: 'Turn 7 · Par 8 · Rank S',
    });
    expect(victoryContent({ objective: 'seize', turn: 3, par: null, rating: null })).toEqual({
      word: 'SEIZED',
      sub: 'Turn 3',
    });
  });

  it('boss felled keeps the throne goal on seize maps and counts foes otherwise', () => {
    expect(felledContent({ objective: 'seize' })).toEqual({
      word: 'FOE VANQUISHED',
      sub: 'Seize the throne with a Lord',
    });
    expect(felledContent({ objective: 'rout', remaining: 1 }).sub).toBe('1 foe remains');
    expect(felledContent({ objective: 'rout', remaining: 3 }).sub).toBe('3 foes remain');
    expect(shouldShowFelled({ objective: 'seize', remaining: 0 })).toBe(true);
    expect(shouldShowFelled({ objective: 'rout', remaining: 0 })).toBe(false);
    expect(shouldShowFelled({ objective: 'rout', remaining: 0, reviving: 1 })).toBe(true);
    expect(shouldShowFelled({ objective: 'rout', remaining: 2 })).toBe(true);
  });

  it('fallen band and Sera offer', () => {
    expect(fallenContent({ name: 'Kira', className: 'Tactician' })).toEqual({
      word: 'FALLEN',
      sub: 'Kira · Tactician',
    });
    expect(fateOfferContent({ seraPresent: true, remaining: 1 })).toMatchObject({
      speaker: 'Sera',
      rewindLabel: 'Rewind · 1 left',
      acceptLabel: 'Accept fate',
    });
    expect(fateOfferContent({ seraPresent: true, remaining: 1 }).line).toContain('once more');
    expect(fateOfferContent({ seraPresent: true, remaining: 3 }).line).not.toContain('once more');
    expect(fateOfferContent({ seraPresent: false, remaining: 2 })).toMatchObject({
      speaker: '',
      rewindLabel: 'Rewind · 2 left',
    });
    expect(defeatContent({ commanderName: 'Edric' })).toEqual({
      word: 'DEFEAT',
      sub: 'Edric has fallen',
    });
  });

  it('phase and cut-in copy', () => {
    expect(phaseContent({ phase: 'player', turn: 3 })).toEqual({
      tone: 'player',
      kicker: 'Turn 3',
      word: 'PLAYER PHASE',
      sub: '',
    });
    expect(phaseContent({ phase: 'enemy', turn: 1, place: '' }).word).toBe('ENEMY PHASE');
    expect(
      cutInContent({ label: 'CRITICAL HIT', unitName: 'Edric', weaponName: 'Rapier' }),
    ).toEqual({ word: 'CRITICAL', small: 'EDRIC · RAPIER' });
    expect(cutInContent({ label: 'Galeforce Assault', unitName: 'Voss', isArt: true }).word).toBe(
      'GALEFORCE ASSAULT',
    );
  });
});

describe('run end', () => {
  it('names where and when the thread was cut, and the foe when known', () => {
    expect(
      runEndContent({
        result: 'defeat',
        commander: 'Edric',
        actId: 'act1',
        turn: 9,
        defeatContext: { defeatedBy: 'Iron Captain', wasBoss: true },
      }),
    ).toEqual({
      tone: 'cut',
      word: 'THE THREAD IS CUT',
      sub: 'Edric fell to the Iron Captain',
      meta: 'Border Marches · Act I · Turn 9',
    });
    expect(
      runEndContent({
        result: 'defeat',
        commander: 'Kira',
        actId: 'act4',
        defeatContext: { defeatedBy: 'The Emperor', wasBoss: true },
      }).sub,
    ).toBe('Kira fell to the Emperor');
    expect(
      runEndContent({
        result: 'defeat',
        commander: 'Edric',
        actId: 'act2',
        turn: 4,
        defeatContext: { defeatedBy: 'Archer', wasBoss: false },
      }).sub,
    ).toBe('Edric fell to an Archer');
    expect(
      runEndContent({
        result: 'defeat',
        commander: 'Edric',
        actId: 'act2',
        defeatContext: { defeatedBy: null, wasBoss: false },
      }).sub,
    ).toBe('Edric fell');
    // Abandoned: no defeat context.
    expect(runEndContent({ result: 'defeat', commander: 'Edric', actId: 'act1' })).toMatchObject({
      sub: 'The march was abandoned',
      meta: 'Border Marches · Act I',
    });
  });

  it('victory is the gold counterpart', () => {
    expect(
      runEndContent({ result: 'victory', commander: 'Edric', actId: 'finalBoss', battlesWon: 14 }),
    ).toEqual({
      tone: 'holds',
      word: 'THE THREAD HOLDS',
      sub: 'Edric walked it to the end',
      meta: `${regions.finalBoss} · Final Act · 14 battles won`,
    });
  });
});

describe('ceremony timing policy', () => {
  it('normal speed animates with the full reading window', () => {
    const t = ceremonyTiming('bossIntro');
    expect(t.animate).toBe(true);
    expect(t.enterMs).toBe(CEREMONY_TIMING.bossIntro.enterMs);
    expect(t.holdMs).toBe(CEREMONY_TIMING.bossIntro.holdMs);
  });

  it('reduced motion shows the end state at once and keeps the reading window', () => {
    const t = ceremonyTiming('victory', { reducedMotion: true });
    expect(t).toMatchObject({ animate: false, enterMs: 0, exitMs: 0 });
    expect(t.holdMs).toBe(CEREMONY_TIMING.victory.holdMs);
  });

  it('Instant speed shows the end state briefly', () => {
    const t = ceremonyTiming('act', { speed: 'instant' });
    expect(t).toMatchObject({ animate: false, enterMs: 0, exitMs: 0 });
    expect(t.holdMs).toBe(Math.round(CEREMONY_TIMING.act.holdMs / 2));
    expect(ceremonyTiming('phase', { speed: 'instant' }).placeHoldMs).toBe(
      Math.round(CEREMONY_TIMING.phase.placeHoldMs / 2),
    );
    // Fast is combat tempo only; story staging keeps its reading window.
    expect(ceremonyTiming('act', { speed: 'fast' }).holdMs).toBe(CEREMONY_TIMING.act.holdMs);
  });
});

describe('boss pressure status', () => {
  it('announces enrage the turn before, during and after', () => {
    expect(bossPressureStatus({ turn: 5, threshold: 12, enraged: false })).toBe('');
    expect(bossPressureStatus({ turn: 11, threshold: 12, enraged: false })).toBe(
      'Enrages on turn 12',
    );
    expect(bossPressureStatus({ turn: 12, threshold: 12, enraged: false })).toBe(
      'Enrages this enemy phase',
    );
    expect(bossPressureStatus({ turn: 13, threshold: 12, enraged: true })).toBe(
      'Enraged · Turn 12',
    );
    expect(bossPressureStatus({ turn: 3, threshold: null, enraged: true })).toBe('Enraged');
  });
});

describe('boss bar state machine', () => {
  const boss = (hp, extra = {}) => ({ key: 'u7', name: 'Dark Rider', hp, max: 52, ...extra });
  const sync = (state, hp, extra = {}) =>
    reduceBossBar(state, { type: 'sync', boss: boss(hp), ...extra });

  it('first sync shows the bar with no chunk', () => {
    const s = sync(createBossBarState(), 52);
    expect(s).toMatchObject({ visible: true, hp: 52, max: 52, lostFrom: 52, felled: false });
    expect(bossBarView(s)).toMatchObject({ hpText: '52 / 52', fillPct: 100, lostPct: 100 });
  });

  it('damage leaves a gold chunk that drains onto the new value', () => {
    let s = sync(createBossBarState(), 52);
    s = sync(s, 31);
    expect(s).toMatchObject({ hp: 31, lostFrom: 52 });
    const view = bossBarView(s);
    expect(view.fillPct).toBeCloseTo((31 / 52) * 100);
    expect(view.lostPct).toBe(100);
    // A second hit before the drain extends the same chunk.
    s = sync(s, 20);
    expect(s).toMatchObject({ hp: 20, lostFrom: 52 });
    s = reduceBossBar(s, { type: 'drain' });
    expect(s).toMatchObject({ hp: 20, lostFrom: 20 });
    expect(reduceBossBar(s, { type: 'drain' })).toBe(s);
  });

  it('healing and silent restores (resume, rewind) never leave a chunk', () => {
    let s = sync(sync(createBossBarState(), 52), 31);
    s = sync(s, 40);
    expect(s).toMatchObject({ hp: 40, lostFrom: 40 });
    s = sync(s, 25, { silent: true });
    expect(s).toMatchObject({ hp: 25, lostFrom: 25 });
  });

  it('a boss hidden by fog keeps its last seen reading', () => {
    let s = sync(sync(createBossBarState(), 52), 40);
    s = sync(s, 52, { concealed: true });
    expect(s).toMatchObject({ hp: 40, lostFrom: 52 });
  });

  it('enrage turns the bar ember with its status line', () => {
    let s = sync(createBossBarState(), 52);
    s = sync(s, 52, { enraged: true, status: 'Enraged · Turn 12' });
    expect(bossBarView(s)).toMatchObject({ tone: 'ember', status: 'Enraged · Turn 12' });
    // Rewind to before the enrage restores crimson.
    s = sync(s, 52, { enraged: false, status: '', silent: true });
    expect(bossBarView(s).tone).toBe('crimson');
  });

  it('death drains to empty; a rewind that restores the boss brings the bar back', () => {
    let s = sync(sync(createBossBarState(), 52), 10);
    s = reduceBossBar(s, { type: 'defeated' });
    expect(s).toMatchObject({ felled: true, hp: 0, lostFrom: 52, visible: true });
    // A sync without a living boss does not hide a felled bar mid-drain.
    expect(reduceBossBar(s, { type: 'sync', boss: null })).toBe(s);
    const hidden = reduceBossBar(s, { type: 'hide' });
    expect(hidden.visible).toBe(false);
    const back = sync(hidden, 10, { silent: true });
    expect(back).toMatchObject({ visible: true, felled: false, hp: 10, lostFrom: 10 });
  });

  it('a different boss (new identity) starts clean; no boss hides the bar', () => {
    let s = sync(sync(createBossBarState(), 52), 30);
    s = reduceBossBar(s, {
      type: 'sync',
      boss: { key: 'u9', name: 'Iron Wall', hp: 60, max: 60 },
    });
    expect(s).toMatchObject({ name: 'Iron Wall', hp: 60, lostFrom: 60 });
    expect(reduceBossBar(s, { type: 'sync', boss: null }).visible).toBe(false);
  });

  it('identical syncs are no-ops (no re-render)', () => {
    const s = sync(createBossBarState(), 52);
    expect(sync(s, 52)).toBe(s);
  });

  it('the Entity bar carries no name or numbers', () => {
    const s = reduceBossBar(createBossBarState(), {
      type: 'sync',
      boss: { key: 'e', name: 'The Entity', hp: 90, max: 90, wordless: true },
    });
    expect(bossBarView(s)).toMatchObject({ name: WORDLESS_MARK, hpText: '', tone: 'unlight' });
  });
});

describe('portrait framing', () => {
  it('covers every rebuilt portrait with a sane eye line', () => {
    for (const id of Object.keys(portraitManifest)) {
      expect(framing[id], id).toBeTruthy();
      const { eye, cx } = portraitFraming(id);
      expect(eye).toBeGreaterThan(0.25);
      expect(eye).toBeLessThan(0.45);
      expect(cx).toBeGreaterThan(0.3);
      expect(cx).toBeLessThan(0.7);
    }
    expect(portraitFraming('unknown')).toEqual({ eye: 0.36, cx: 0.52 });
  });
});
