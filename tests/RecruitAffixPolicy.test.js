import { afterEach, describe, expect, it } from 'vitest';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { RunManager } from '../src/engine/RunManager.js';
import { recruitAffixesAllowed, validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
const eclipseAffix = {
  gatingDifficultyId: 'hard',
  extraMaxAffixes: 1,
  guaranteedCount: 2,
  guaranteedTier: 1,
};
afterEach(restoreMathRandom);
function battle(seed, extra = {}, gameData = data) {
  installSeed(seed);
  return generateBattle(
    {
      act: 'act1',
      objective: 'rout',
      isRecruitBattle: true,
      difficultyId: 'normal',
      deployCount: 4,
      recruitEnemyCountBonus: 1,
      eclipseAffix,
      ...extra,
    },
    gameData,
  );
}
const affixed = (config) => config.enemySpawns.filter((u) => u.affixes?.length);
describe('First Light Act 1 recruit policy', () => {
  it('removes rolled and guaranteed affixes even under Eclipse, retaining the extra hunter', () => {
    for (const seed of [1, 42, 103, 333]) {
      const safe = battle(seed);
      expect(affixed(safe), `seed ${seed}`).toEqual([]);
      const oldData = structuredClone(data);
      oldData.difficulty.modes.normal.recruitAffixExcludedActs = [];
      const before = battle(seed, {}, oldData);
      expect(affixed(before).length).toBeGreaterThanOrEqual(2);
      expect(safe.enemySpawns.length).toBe(before.enemySpawns.length);
      expect(safe.npcSpawn).toBeTruthy();
    }
  });
  it('preserves ordinary/lost-recruit battles, later acts, and higher difficulties', () => {
    for (const extra of [
      { isRecruitBattle: false },
      { act: 'act2' },
      { difficultyId: 'dusk' },
      { difficultyId: 'hard' },
      { difficultyId: 'lunatic' },
    ]) {
      expect(affixed(battle(42, extra)).length, JSON.stringify(extra)).toBeGreaterThanOrEqual(2);
    }
  });
  it('uses the encounter act rather than the run act and falls back for legacy difficulty data', () => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false });
    const node = rm.nodeMap.nodes.find((n) => n.type === 'recruit');
    expect(rm.getRecruitNodeBattleMods(node).affixCount).toBe(0);
    const later = { ...node, battleParams: { ...node.battleParams, act: 'act2' } };
    expect(rm.currentAct).toBe('act1');
    expect(rm.getRecruitNodeBattleMods(later).affixCount).toBe(1);
    expect(
      recruitAffixesAllowed({ isRecruitBattle: true, difficultyId: 'normal', act: 'act1' }),
    ).toBe(false);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.difficultyModifiers.recruitAffixExcludedActs;
    const locked = {
      enemySpawns: [{ affixes: ['venomous'] }],
      npcSpawn: { name: 'Ari', className: 'Soldier' },
    };
    saved.battleConfigsByNodeId = { [node.id]: locked };
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.battleConfigsByNodeId[node.id]).toEqual(locked);
    expect(
      loaded.getBattleParams(loaded.nodeMap.nodes.find((n) => n.id === node.id)).allowEnemyAffixes,
    ).toBe(false);
  });
  it('strips scripted reinforcement affixes from the clone, without changing its template', () => {
    const clone = structuredClone(data);
    const template = clone.mapTemplates.rout.find((t) => t.id === 'chokepoint');
    template.reinforcements = {
      waves: [],
      scriptedWaves: [
        {
          turn: 2,
          spawns: [{ col: 0, row: 0, className: 'Soldier', level: 1, affixes: ['venomous'] }],
        },
      ],
    };
    const safe = battle(42, { templateId: template.id }, clone);
    expect(safe.reinforcements.scriptedWaves[0].spawns[0].affixes).toBeUndefined();
    const higher = battle(42, { templateId: template.id, difficultyId: 'hard' }, clone);
    expect(higher.reinforcements.scriptedWaves[0].spawns[0].affixes).toEqual(['venomous']);
    expect(template.reinforcements.scriptedWaves[0].spawns[0].affixes).toEqual(['venomous']);
  });
  it('rejects invalid policy configuration', () => {
    const config = structuredClone(data.difficulty);
    config.modes.normal.recruitAffixExcludedActs = ['typo'];
    expect(validateDifficultyConfig(config).errors).toContain(
      'modes.normal.recruitAffixExcludedActs must be an array of act ids',
    );
  });
});
