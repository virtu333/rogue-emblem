// Deeds & Epithets across the game's seams: serialization and saves, the
// run's completed-battle boundary, records, promotions (Oaths on every player
// path, never on silent engine promotions), and the presentation content.
import { describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { mergeRunRecords } from '../src/engine/RunRecords.js';
import {
  createLordUnit,
  createUnit,
  promoteUnit,
  resolvePromotionTargets,
} from '../src/engine/UnitManager.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import {
  commitBattleDeeds,
  emptyBattleDeeds,
  recordKill,
  unitEpithet,
} from '../src/engine/DeedSystem.js';
import { deedCardContent, promotionPathContent, sealedBeats } from '../src/ui/growthContent.js';
import { cutInContent, fallenContent } from '../src/ui/ceremonyContent.js';
import { deedsOfTheMarchRows } from '../src/ui/deedDisplay.js';
import { DeedController } from '../src/ui/DeedController.js';
import { buildNarrativeContext, selectDialogueEntries } from '../src/engine/NarrativeDirector.js';
import dialogue from '../data/dialogue.json';

const data = loadGameData();
const cls = (name) => data.classes.find((c) => c.name === name);

let keySeq = 0;
function withDeed(unit, battle) {
  unit._battleDeeds = { ...emptyBattleDeeds(), ...battle };
  commitBattleDeeds([unit], data.deeds, { battleKey: `k:${++keySeq}` });
  return unit;
}
const fighter = (name = 'Garr') => createUnit(cls('Fighter'), 10, data.weapons, { name });
// Three enemy phases held on a bridge: "Who Held the Bridge", Oath → Pavise.
const bridge = { heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'] };

describe('serialization and saves', () => {
  it('serializeUnit strips battle scratch (and leaking fort streaks) and deep-copies deeds', () => {
    const unit = withDeed(fighter(), bridge);
    unit._battleDeeds = { ...emptyBattleDeeds(), kills: 2 };
    unit._fortHealStreak = 3;
    unit._slewAllies = ['x'];
    const saved = serializeUnit(unit);
    expect(saved._battleDeeds).toBeUndefined();
    expect(saved._fortHealStreak).toBeUndefined();
    expect(saved._slewAllies).toBeUndefined();
    expect(saved.deeds).toEqual(unit.deeds);
    expect(saved.deeds).not.toBe(unit.deeds);
    saved.deeds.earned[0].epithet = 'mutated';
    expect(unit.deeds.earned[0].epithet).toBe('Who Held the Bridge');
  });

  it('deeds round-trip through a run save; legacy units load without them', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 7 });
    withDeed(run.roster[0], bridge);
    const json = JSON.parse(JSON.stringify(run.toJSON()));
    delete json.roster[1].deeds;
    const loaded = RunManager.fromJSON(json, data);
    expect(unitEpithet(loaded.roster[0])).toEqual({ id: 'held_the_line', text: 'Who Held the Bridge', form: 'who' }); // prettier-ignore
    expect('deeds' in loaded.roster[1]).toBe(false);
    // Idempotent: a second save/load is identical.
    const again = RunManager.fromJSON(JSON.parse(JSON.stringify(loaded.toJSON())), data);
    expect(again.roster[0].deeds).toEqual(loaded.roster[0].deeds);
  });

  it('a won battle stores deeds in the roster; the fallen keep the deeds they had', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 11 });
    const node = run.getAvailableNodes().find((n) => n.type === 'battle' || n.type === 'recruit');
    const [lead, partner] = run.roster;
    withDeed(partner, { crits: 3 }); // an earlier victory
    const battleLead = structuredClone(lead);
    battleLead._battleDeeds = { ...emptyBattleDeeds(), ...bridge };
    commitBattleDeeds([battleLead], data.deeds, { battleKey: 'b1' }); // partner fell this battle
    run.completeBattle([battleLead], node.id, 0);
    expect(unitEpithet(run.roster[0]).text).toBe('Who Held the Bridge');
    expect(run.roster[0]._battleDeeds).toBeUndefined();
    const fallen = run.fallenUnits.find((u) => u.name === partner.name);
    expect(unitEpithet(fallen).text).toBe('the Keen Edge');
  });

  it('"Continue from Map" discards battle progress: the roster is still at entry', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 3 });
    const entry = structuredClone(run.roster);
    const battleUnit = structuredClone(run.roster[0]);
    recordKill({ faction: 'enemy', isBoss: true, name: 'Warchief', level: 9 }, battleUnit, {});
    run.battleInProgress = { nodeId: 'n', checkpoint: { playerUnits: [battleUnit] } };
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(run.roster).toEqual(entry);
    expect(run.roster.some((u) => u.deeds || u._battleDeeds)).toBe(false);
  });
});

describe('victory records', () => {
  it('keep epithets through the whitelist, and older records stay unchanged', () => {
    const [record] = mergeRunRecords([
      {
        id: 'r1',
        endedAt: 5,
        roster: [
          { name: 'Edric', className: 'Great Lord', level: 9, isLord: true, epithet: 'Who Held the Bridge', epithetForm: 'who' }, // prettier-ignore
          { name: 'Kai', className: 'Hero', level: 4, epithet: '  ', epithetForm: 'who' },
          { name: 'Ann', className: 'Sage', level: 3, epithet: 'the Mender', epithetForm: '<b>' },
        ],
      },
    ]);
    expect(record.roster[0]).toMatchObject({ epithet: 'Who Held the Bridge', epithetForm: 'who' });
    expect('epithet' in record.roster[1]).toBe(false);
    expect(record.roster[2]).toMatchObject({ epithet: 'the Mender', epithetForm: 'the' });
  });

  it('a won run records each titled unit', () => {
    const run = new RunManager(data);
    run.startRun({ runSeed: 5 });
    withDeed(run.roster[0], bridge);
    const recordRunEnd = vi.fn();
    run.status = 'victory';
    const meta = {
      recordRunEnd,
      addValor() {},
      addSupply() {},
      incrementRunsCompleted() {},
      hasMilestone: () => false,
      recordMilestone() {},
    };
    run._applySettledRewardsToMeta(meta, { result: 'victory', valor: 0, supply: 0 });
    const record = recordRunEnd.mock.calls[0][0].victoryRecord;
    expect(record.roster[0]).toMatchObject({ epithet: 'Who Held the Bridge', epithetForm: 'who' }); // prettier-ignore
    expect('epithet' in record.roster[1]).toBe(false);
  });
});

describe('Oaths', () => {
  it('roster Master Seal swears the Oath and reports it', () => {
    const unit = withDeed(fighter(), bridge);
    const seal = { name: 'Master Seal', type: 'Consumable', effect: 'promote', uses: 1 };
    unit.consumables = [seal];
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const result = applyRosterClassChange({ roster: [unit] }, unit, seal, target, data);
    expect(result.ok).toBe(true);
    expect(unit.skills).toContain('pavise');
    expect(unit.deeds.oath).toMatchObject({ skillId: 'pavise', name: 'Oath of the Bridge' });
    expect(result.notices).toContain('Oath of the Bridge: learned Pavise.');
  });

  it('church promotion swears the Oath; the skill cap drops it visibly', () => {
    const run = new RunManager(data);
    run.gold = 99999;
    const unit = withDeed(fighter(), bridge);
    run.roster = [unit];
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const ok = promoteAtChurch(run, unit, 'c1', target, data);
    expect(ok.message).toContain('Oath of the Bridge: learned Pavise.');
    const full = withDeed(fighter('Bram'), bridge);
    full.skills = ['sol', 'luna', 'astra', 'vantage', 'wrath'];
    run.roster = [full];
    const capped = promoteAtChurch(run, full, 'c2', target, data);
    expect(capped.message).toContain('could not learn');
    expect(capped.message).toContain('Pavise');
    expect(full.deeds.oath).toBeUndefined();
  });

  it('the path chooser and the rite preview the Oath exactly as applied', () => {
    const unit = withDeed(fighter(), bridge);
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const content = promotionPathContent(unit, target, data);
    expect(content.oath).toMatchObject({ name: 'Oath of the Bridge', skillId: 'pavise', learned: true }); // prettier-ignore
    expect(unit.skills).not.toContain('pavise'); // projection only
    expect(unit.deeds.oath).toBeUndefined();
    expect(sealedBeats(content).at(-1)).toEqual({
      kind: 'oath',
      title: 'Pavise',
      detail: 'Oath of the Bridge',
      skillId: 'pavise',
    });
  });

  it('battle Master Seal: the PromotionController applies the Oath with the promotion', async () => {
    vi.resetModules();
    const { PromotionController } = await import('../src/ui/PromotionController.js');
    const edric = createLordUnit(data.lords.find((l) => l.name === 'Edric'), data.classes, data.weapons); // prettier-ignore
    edric.level = 10;
    withDeed(edric, bridge);
    const seal = structuredClone(data.consumables.find((i) => i.effect === 'promote'));
    edric.consumables = [seal];
    const scene = {
      gameData: data,
      registry: { get: () => null },
      sys: { isActive: () => true },
      add: { text: () => ({ setOrigin: () => ({ setDepth: () => ({}) }) }) },
      showActionMenu: vi.fn(),
      removeUnitGraphic: vi.fn(),
      addUnitGraphic: vi.fn(),
      updateHPBar: vi.fn(),
      finishUnitAction: vi.fn(),
      showBriefBanner: vi.fn(async () => {}),
      showPromotionBanner: vi.fn(async () => {}),
      _captureSuspendCheckpoint: vi.fn(),
    };
    const controller = new PromotionController(scene);
    vi.spyOn(controller, '_executePromotionFlow');
    const LevelUpPopup = await import('../src/ui/LevelUpPopup.js');
    vi.spyOn(LevelUpPopup.LevelUpPopup.prototype, 'show').mockResolvedValue(undefined);
    await controller.executePromotion(edric, seal);
    expect(edric.className).toBe('Great Lord');
    expect(edric.skills).toContain('pavise');
    expect(edric.deeds.oath.skillId).toBe('pavise');
  });

  it('silent engine promotions (promoteUnit alone) never swear an Oath', () => {
    const unit = withDeed(fighter(), bridge);
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    promoteUnit(unit, target, target.promotionBonuses, data.skills);
    expect(unit.skills).not.toContain('pavise');
    expect(unit.deeds.oath).toBeUndefined();
  });
});

describe('presentation content', () => {
  it('deed card content: name, epithet, count, oath teaser and the outranked note', () => {
    const unit = fighter('Elara');
    unit._battleDeeds = { ...emptyBattleDeeds(), ...bridge, crits: 3 };
    const entries = commitBattleDeeds([unit], data.deeds, {});
    const [held, keen] = entries.map((e, index) =>
      deedCardContent(e, { skills: data.skills, deeds: data.deeds, index, total: entries.length }),
    );
    expect(held).toMatchObject({
      kicker: 'Deed · Held the Line',
      name: 'Elara',
      epithet: 'Who Held the Bridge',
      appositive: true,
      titled: 'Elara, Who Held the Bridge',
      seal: 'H',
      ordinal: 'IV',
      note: '',
      oath: 'Oath at promotion · Pavise',
      count: '1 / 2',
    });
    expect(keen).toMatchObject({ appositive: false, count: '2 / 2' });
    expect(keen.note).toMatch(/greater title/);
    // Promoted units have sworn (or never will): no teaser.
    unit.tier = 'promoted';
    expect(deedCardContent(entries[0], { skills: data.skills, deeds: data.deeds }).oath).toBe('');
  });

  it('the fallen band and the crit cut-in carry the title', () => {
    const epithet = { text: 'Who Held the Bridge', form: 'who' };
    expect(fallenContent({ name: 'Edric', className: 'Lord', epithet }).sub).toBe(
      'Edric, Who Held the Bridge, has fallen',
    );
    expect(fallenContent({ name: 'Edric', className: 'Lord' }).sub).toBe('Edric · Lord');
    expect(cutInContent({ unitName: 'Edric', weaponName: 'Rapier', epithet: 'the Keen Edge' }))
      .toMatchObject({ word: 'CRITICAL', epithet: 'the Keen Edge' }); // prettier-ignore
    expect('epithet' in cutInContent({ unitName: 'Edric' })).toBe(false);
  });

  it('Deeds of the March lists titled units, living first, then the fallen', () => {
    const living = withDeed(fighter('Ann'), bridge);
    const fallen = withDeed(fighter('Bo'), { crits: 3 });
    const rows = deedsOfTheMarchRows({ roster: [fighter('Cy'), living], fallenUnits: [fallen] });
    expect(rows.map((r) => [r.name, r.epithet.text, r.fallen])).toEqual([
      ['Ann', 'Who Held the Bridge', false],
      ['Bo', 'the Keen Edge', true],
    ]);
    expect(deedsOfTheMarchRows({ roster: [], fallenUnits: [] })).toEqual([]);
  });

  it('the {epithet} token names a titled commander, gated by commanderHasEpithet', () => {
    const edric = withDeed({ ...fighter('Edric'), isCommander: true }, bridge);
    const runManager = { roster: [edric], getStartingLordNames: () => ['Edric', 'Sera'] };
    const ctx = buildNarrativeContext({ runManager });
    expect(ctx.commanderTitled).toBe('Edric, Who Held the Bridge');
    const lines = selectDialogueEntries(dialogue.actTransitions.act2_to_act3, ctx);
    expect(lines.at(-1).line).toContain('Edric, Who Held the Bridge');
    const plain = selectDialogueEntries(
      dialogue.actTransitions.act2_to_act3,
      buildNarrativeContext({ runManager: { ...runManager, roster: [fighter('Edric')] } }),
    );
    expect(plain.some((e) => e.line.includes('{epithet}'))).toBe(false);
    expect(plain.at(-1).line).toBe("Corrupted or not, it's still ground. We can cross it.");
  });
});

describe('DeedController', () => {
  function scene(over = {}) {
    return {
      gameData: data,
      runManager: { currentAct: 'act1', completedBattles: 2 },
      battleParams: { deployCount: 4 },
      nodeId: 'n7',
      turnManager: { currentPhase: 'player', turnNumber: 3 },
      grid: { getTerrainAt: () => ({ name: 'Forest' }) },
      playerUnits: [],
      ...over,
    };
  }

  it('records nothing without a run or in the tutorial', () => {
    const hero = fighter();
    new DeedController(scene({ runManager: null })).onRefresh(hero);
    new DeedController(scene({ battleParams: { tutorialMode: true } })).onRefresh(hero);
    expect(hero._battleDeeds).toBeUndefined();
  });

  it('kills use the killer’s terrain; commit keys the battle and flushes an open enemy phase', () => {
    const hero = { ...fighter(), isLord: true, col: 1, row: 1 };
    const s = scene({ playerUnits: [hero] });
    const deeds = new DeedController(s);
    deeds.onUnitRemoved({ faction: 'enemy', name: 'x', level: 1 }, hero);
    expect(hero._battleDeeds.killsByTerrain).toEqual({ Forest: 1 });
    hero._battleDeeds.phaseAttacks = 2;
    s.turnManager.currentPhase = 'enemy';
    deeds.commitVictory([hero]);
    expect(hero.deeds.lastBattle).toBe('act1:n7:2');
    expect(hero.deeds.earned).toEqual([]); // one held phase is not three
    expect(hero.deeds.stats).toMatchObject({ kills: 1, battles: 1 });
    expect(deeds.commitVictory([hero])).toEqual([]); // same battle: no-op
    expect(hero.deeds.stats.battles).toBe(1);
  });

  it('heals count only HP actually restored to someone else', () => {
    const cleric = fighter('Cleric');
    const ally = { ...fighter('Ally'), currentHP: 20 };
    const deeds = new DeedController(scene());
    deeds.onHeal(cleric, ally, 12);
    deeds.onHeal(cleric, cleric, 1);
    expect(cleric._battleDeeds.healed).toBe(8);
  });
});
