// The Rite's wiring outside the engine's own state (docs/specs/act-v-descent.md §8, §9.5, §9.7):
// the Descent's battle themes, the narrative `when` keys and the shipped Vigil. Ways this breaks:
//   - a Descent battle plays an act pool theme, the Vigil plays the Descent's (or a boss's) theme,
//     or an ordinary act's battle starts picking the Descent's music
//   - `riteBand` / `bossRole` lines never match, or match off the Descent
//   - the shipped Vigil seats its Voices in another class, loses the Waking's double word, or
//     stops validating
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyGenerationFields, generateSeededBattle } from '../src/engine/BattleScout.js';
import { battleMusicContext, selectBattleMusic } from '../src/engine/BattleMusicSelection.js';
import { MUSIC } from '../src/utils/musicConfig.js';
import { buildNarrativeContext, evaluateWhen } from '../src/engine/NarrativeDirector.js';
import { findSetPiece, validateSetPiecesConfig } from '../src/engine/SetPieces.js';
import { createRite } from '../src/engine/Rite.js';
import { wordsSpoken } from '../src/engine/Vigil.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

function descentRun(difficultyId = 'hard', runSeed = 13) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed, difficultyId, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}
const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);

/** The track BattleScene picks for `node`'s battle (non-boss: the controller's own rule). */
function trackFor(rm, node) {
  const params = rm.getBattleParams(node);
  applyGenerationFields(params, { deployCount: 6, isBoss: node.type === 'boss' });
  const config = generateSeededBattle(params, rm.gameData, params.battleSeed);
  const context = battleMusicContext({
    battleParams: params,
    battleConfig: config,
    runSeed: rm.runSeed,
    isElite: params.isElite,
  });
  return selectBattleMusic({ ...context, act: params.act, objective: config.objective }, MUSIC);
}

describe('the Descent’s battle music', () => {
  it('the Vigil plays its own theme; the stair and the Column play the Descent’s', () => {
    const rm = descentRun();
    expect(trackFor(rm, nodeOf(rm, 'vigil'))).toEqual({
      key: MUSIC.descent.vigil,
      reason: 'vigil',
    });
    expect(trackFor(rm, nodeOf(rm, 'stair'))).toEqual({
      key: MUSIC.descent.battle,
      reason: 'descent',
    });
    // The Column, even when the Eclipse has taken it (an eclipsed elite): still the Descent's.
    const column = nodeOf(rm, 'column');
    column.battleParams = { ...column.battleParams, isEclipsed: true, isElite: true };
    expect(trackFor(rm, column).key).toBe(MUSIC.descent.battle);
  });

  it('an ordinary act’s battle never picks them', () => {
    const rm = new RunManager(descentData());
    rm.startRun({ runSeed: 21, difficultyId: 'hard', applyBlessingsAtStart: false });
    for (let act = 0; act < 4; act++) {
      for (const node of rm.nodeMap.nodes.filter((n) => n.type === 'battle').slice(0, 3)) {
        const { key } = trackFor(rm, node);
        expect(Object.values(MUSIC.descent), `${rm.currentAct} ${node.id}`).not.toContain(key);
      }
      rm.advanceAct();
    }
  });

  it('a Vigil map plays the Vigil’s theme wherever it is fought (the review route’s act too)', () => {
    const ctx = battleMusicContext({
      battleParams: { act: 'act4', row: 2 },
      battleConfig: { vigil: { sigils: [], circles: [] } },
      runSeed: 1,
    });
    expect(selectBattleMusic(ctx, MUSIC).key).toBe(MUSIC.descent.vigil);
  });
});

describe('narrative `when`: riteBand and bossRole', () => {
  it('reads the battle’s tier first, else the run’s, else none', () => {
    const rm = descentRun();
    rm.rite = { ...createRite({ start: 0 }), words: 13 };
    expect(buildNarrativeContext({ runManager: rm }).riteBand).toBe('answered');
    // The battle's own (its entry) wins over a run that has moved on.
    expect(
      buildNarrativeContext({ runManager: rm, battleParams: { riteBand: 'broken' } }).riteBand,
    ).toBe('broken');
    rm.rite = null;
    expect(buildNarrativeContext({ runManager: rm }).riteBand).toBe('none');
  });

  it('bossRole comes from the battle’s params; a boss off the route has none', () => {
    const rm = descentRun();
    const gate = rm.getBattleParams(nodeOf(rm, 'gate'));
    expect(buildNarrativeContext({ runManager: rm, battleParams: gate }).bossRole).toBe('gate');
    const finale = rm.getBattleParams(nodeOf(rm, 'entity'));
    expect(buildNarrativeContext({ runManager: rm, battleParams: finale }).bossRole).toBe('finale');
    expect(buildNarrativeContext({ battleParams: { act: 'act3', isBoss: true } }).bossRole).toBe(
      'none',
    );
  });

  it('a variant gated on them matches one value or a list, and nothing off the Descent', () => {
    const ctx = { riteBand: 'spoken', bossRole: 'gate' };
    expect(evaluateWhen({ riteBand: 'spoken' }, ctx)).toBe(true);
    expect(evaluateWhen({ riteBand: ['broken', 'spoken'] }, ctx)).toBe(true);
    expect(evaluateWhen({ riteBand: 'answered' }, ctx)).toBe(false);
    expect(evaluateWhen({ bossRole: 'gate', riteBand: 'spoken' }, ctx)).toBe(true);
    expect(evaluateWhen({ bossRole: 'finale' }, ctx)).toBe(false);
    const plain = buildNarrativeContext({});
    expect(evaluateWhen({ riteBand: 'broken' }, plain)).toBe(false);
    expect(evaluateWhen({ bossRole: 'gate' }, plain)).toBe(false);
  });
});

describe('the shipped Vigil', () => {
  const vigil = findSetPiece(baseData.setPieces, 'the_vigil');
  const targets = vigil.objectives.primary[0].targets;

  it('its four Voices are Circle Adepts on their sigils, the Waking’s sigil marked', () => {
    for (const variant of vigil.variants) {
      const voices = variant.enemies.filter((e) => targets.includes(e.id));
      expect(voices).toHaveLength(4);
      for (const voice of voices) {
        expect(voice.classes).toEqual(['Circle Adept']);
        expect(voice).toMatchObject({ target: true, aiMode: 'post' });
      }
      const waking = variant.vigil.sigils.filter((s) => s.waking === true);
      expect(waking.map((s) => s.target)).toEqual(['voice_waking']);
    }
    expect(validateSetPiecesConfig(baseData.setPieces, baseData).errors).toEqual([]);
  });

  it('its generated map seats them so, and the Waking speaks two while the others live', () => {
    const rm = descentRun();
    const params = rm.getBattleParams(nodeOf(rm, 'vigil'));
    applyGenerationFields(params, { deployCount: 6 });
    const config = generateSeededBattle(params, rm.gameData, params.battleSeed);
    const voices = config.enemySpawns.filter((s) => targets.includes(s.authoredId));
    expect(voices.map((s) => s.className)).toEqual(Array(4).fill('Circle Adept'));
    const onSigils = voices.map((s) => ({ ...s, currentHP: 1 }));
    const words = wordsSpoken(config.vigil, onSigils);
    expect(words.find((w) => w.voiceId === 'voice_waking').count).toBe(2);
    expect(words.reduce((n, w) => n + w.count, 0)).toBe(5);
  });
});
