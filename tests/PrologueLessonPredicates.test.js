// A practised lesson is marked only when the skill was really shown (review, 2026-10-04;
// docs/specs/prologue-chapter.md §6, §9). P2's "chip then finish" counts Edric's kill
// only on a Soldier Gaspar had already damaged this battle (the attack or a counter);
// P3's "range two" counts Sera's strike only at a committed distance of 2; P4's
// "deploy" is practised by the deploy screen's confirmation, never by the battle
// merely starting (an auto-deploy or a resumed battle confirms nothing, nor does a
// later battle on the reused scene object inherit an earlier confirmation). The
// combatResolved event carries the committed distance and who damaged the target
// before now; the damage ledger rides the suspend snapshot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(),
}));

import { loadGameData } from './testData.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import {
  buildPrologueBattleConfig,
  buildPrologueRoster,
  prologueBeatsFor,
} from '../src/engine/Prologue.js';
import { PrologueController } from '../src/ui/PrologueController.js';
import { prologueBattleParams } from '../src/engine/ScriptedBattle.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { readFileSync } from 'fs';

const data = {
  ...loadGameData(),
  dialogue: JSON.parse(readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8')),
};
const chapterOf = (id) => data.prologue.chapters.find((c) => c.id === id);

/** A fake BattleScene around a chapter's headless board (standalone). */
function makeScene(chapterId, { deploy = null, confirmed = null } = {}) {
  installSeed(11);
  const chapter = chapterOf(chapterId);
  const config = buildPrologueBattleConfig(chapter, data.terrain);
  const roster = buildPrologueRoster(data.prologue, data, chapter);
  const fielded = deploy ? deploy.map((n) => roster.find((u) => u.name === n)) : roster;
  const battle = new HeadlessBattle(data, { act: 'act1', objective: chapter.objective }, fielded);
  battle.init({ battleConfig: config });
  const scene = {
    gameData: data,
    battleParams: prologueBattleParams(chapter, { seed: 1209 }),
    runManager: null,
    playerUnits: battle.playerUnits,
    enemyUnits: battle.enemyUnits,
    npcUnits: battle.npcUnits,
    grid: Object.assign(battle.grid, { gridToPixel: (c, r) => ({ x: c * 32, y: r * 32 }) }),
    threatContext: () => battle._playerThreatContext(),
    findAttackTargets: (u) => battle._findAttackTargets(u),
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    battleState: 'PLAYER_IDLE',
    events: { on: vi.fn(), off: vi.fn(), once: vi.fn() },
    sys: { isActive: () => true },
    registry: { get: () => null },
    add: { rectangle: vi.fn(() => ({ setStrokeStyle() { return this; }, setDepth() { return this; }, destroy: vi.fn() })) }, // prettier-ignore
    tweens: { add: vi.fn() },
    _reduceMotion: () => true,
    refreshEndTurnControl: vi.fn(),
    showBriefBanner: vi.fn(async () => {}),
    isStoryInputLocked: () => false,
    _getPortraitKey: () => null,
    dialogueOverlay: { showSequence: vi.fn(async () => true), visible: false },
    _deployConfirmation: confirmed,
  };
  return { scene, battle, chapter };
}

const unit = (scene, name) => scene.playerUnits.find((u) => u.name === name);
const enemy = (scene, id) => scene.enemyUnits.find((u) => u.authoredId === id);
const place = (u, col, row) => Object.assign(u, { col, row });

/**
 * One exchange as the scene reports it: HP applied first (the scene's combat did
 * that), then the hook with both sides' HP at the start. `damage.attacker` is what the
 * attacker took, `damage.defender` what the defender took.
 */
async function exchange(prologue, attacker, defender, { initiator, damage }) {
  const hpBefore = { attacker: attacker.currentHP, defender: defender.currentHP };
  attacker.currentHP = Math.max(0, attacker.currentHP - (damage.attacker || 0));
  defender.currentHP = Math.max(0, defender.currentHP - (damage.defender || 0));
  return prologue.onCombatResolved(attacker, defender, { initiator, hpBefore });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  restoreMathRandom();
  vi.unstubAllGlobals();
});

describe('P2: veteran_kills is practised only by a kill on a foe Gaspar damaged first', () => {
  it("Edric's kill on an untouched Soldier is not the lesson", async () => {
    const { scene } = makeScene('p2_old_hands');
    const prologue = new PrologueController(scene).create();
    const edric = unit(scene, 'Edric');
    const foe = enemy(scene, 'd');
    place(edric, foe.col - 1, foe.row);
    await exchange(prologue, edric, foe, { initiator: 'player', damage: { defender: foe.currentHP } }); // prettier-ignore
    expect(prologue.lessons.practised.has('veteran_kills')).toBe(false);
    // The beat is still unspent: a later chip-then-finish on another foe can earn it.
    expect(prologue.beatState.fired).not.toContain('p2_chip_then_finish');
  });

  it("Gaspar chips with his attack, Edric finishes the same Soldier: practised, with the event's facts", async () => {
    const { scene } = makeScene('p2_old_hands');
    const prologue = new PrologueController(scene).create();
    const seen = [];
    const original = prologue.emit.bind(prologue);
    prologue.emit = (event, ...rest) => {
      if (event.type === 'combatResolved') seen.push(event);
      return original(event, ...rest);
    };
    const edric = unit(scene, 'Edric');
    const gaspar = unit(scene, 'Gaspar');
    const foe = enemy(scene, 'd');
    place(gaspar, foe.col, foe.row + 1);
    await exchange(prologue, gaspar, foe, { initiator: 'player', damage: { defender: 5 } });
    expect(seen.at(-1)).toMatchObject({ unit: 'Gaspar', target: 'd', kill: false, distance: 1, damagedBy: [] }); // prettier-ignore
    expect(prologue.lessons.practised.has('veteran_kills')).toBe(false);
    place(edric, foe.col - 1, foe.row);
    await exchange(prologue, edric, foe, { initiator: 'player', damage: { defender: foe.currentHP } }); // prettier-ignore
    expect(seen.at(-1)).toMatchObject({ unit: 'Edric', target: 'd', kill: true, distance: 1, damagedBy: ['Gaspar'] }); // prettier-ignore
    expect(prologue.lessons.practised.has('veteran_kills')).toBe(true);
  });

  it("Gaspar's counter on the enemy phase is a chip too; a chip on another foe is not", async () => {
    const { scene } = makeScene('p2_old_hands');
    const prologue = new PrologueController(scene).create();
    const edric = unit(scene, 'Edric');
    const gaspar = unit(scene, 'Gaspar');
    const fighter = enemy(scene, 'b');
    const soldier = enemy(scene, 'd');
    // The Fighter strikes Gaspar, who counters for 4.
    place(gaspar, fighter.col - 1, fighter.row);
    await exchange(prologue, fighter, gaspar, { initiator: 'enemy', damage: { attacker: 4, defender: 6 } }); // prettier-ignore
    // Edric kills the Soldier Gaspar never touched: nothing.
    place(edric, soldier.col - 1, soldier.row);
    await exchange(prologue, edric, soldier, { initiator: 'player', damage: { defender: soldier.currentHP } }); // prettier-ignore
    expect(prologue.lessons.practised.has('veteran_kills')).toBe(false);
    // Edric finishes the Fighter: that one Gaspar chipped.
    place(edric, fighter.col, fighter.row - 1);
    await exchange(prologue, edric, fighter, { initiator: 'player', damage: { defender: fighter.currentHP } }); // prettier-ignore
    expect(prologue.lessons.practised.has('veteran_kills')).toBe(true);
  });

  it('an exchange that dealt the foe no damage (a miss, a counter out of reach) is not a chip', async () => {
    const { scene } = makeScene('p2_old_hands');
    const prologue = new PrologueController(scene).create();
    const edric = unit(scene, 'Edric');
    const gaspar = unit(scene, 'Gaspar');
    const foe = enemy(scene, 'd');
    place(gaspar, foe.col, foe.row + 1);
    await exchange(prologue, gaspar, foe, { initiator: 'player', damage: { defender: 0, attacker: 3 } }); // prettier-ignore
    expect(prologue.snapshot().damaged).toEqual([]);
    place(edric, foe.col - 1, foe.row);
    await exchange(prologue, edric, foe, { initiator: 'player', damage: { defender: foe.currentHP } }); // prettier-ignore
    expect(prologue.lessons.practised.has('veteran_kills')).toBe(false);
  });

  it('the damage ledger rides the suspend checkpoint', async () => {
    const { scene } = makeScene('p2_old_hands');
    const first = new PrologueController(scene).create();
    const gaspar = unit(scene, 'Gaspar');
    const foe = enemy(scene, 'd');
    place(gaspar, foe.col, foe.row + 1);
    await exchange(first, gaspar, foe, { initiator: 'player', damage: { defender: 5 } });
    const state = structuredClone(first.snapshot());
    expect(state.damaged).toEqual([['d', ['Gaspar']]]);
    first.destroy();
    // Resume Battle: the same board, a fresh controller.
    const resumed = new PrologueController(scene).create();
    resumed.onResume(state, { turn: 1, phase: 'player' });
    const edric = unit(scene, 'Edric');
    place(edric, foe.col - 1, foe.row);
    await exchange(resumed, edric, foe, { initiator: 'player', damage: { defender: foe.currentHP } }); // prettier-ignore
    expect(resumed.lessons.practised.has('veteran_kills')).toBe(true);
    // A version-1 checkpoint (no ledger) resumes with nobody damaged.
    const old = new PrologueController(scene).create();
    old.onResume({ version: 1, started: true, fired: [] }, { turn: 1, phase: 'player' });
    expect(old.snapshot().damaged).toEqual([]);
  });

  it('without hpBefore (an older caller) the HP last seen here stands in', async () => {
    const { scene } = makeScene('p2_old_hands');
    const prologue = new PrologueController(scene).create();
    const gaspar = unit(scene, 'Gaspar');
    const foe = enemy(scene, 'd');
    place(gaspar, foe.col, foe.row + 1);
    foe.currentHP -= 5;
    await prologue.onCombatResolved(gaspar, foe, { initiator: 'player' });
    expect(prologue.snapshot().damaged).toEqual([['d', ['Gaspar']]]);
  });
});

describe('P3: range_two is practised only by a strike from 2 tiles', () => {
  it('Sera adjacent: not practised; Sera at 2 tiles: practised', async () => {
    const { scene } = makeScene('p3_seer_on_the_road');
    const prologue = new PrologueController(scene).create();
    const sera = scene.npcUnits.find((u) => u.name === 'Sera');
    // Joined (as the Talk settles her), then she fights.
    sera.faction = 'player';
    scene.npcUnits.splice(scene.npcUnits.indexOf(sera), 1);
    scene.playerUnits.push(sera);
    const foe = enemy(scene, 's');
    place(sera, foe.col, foe.row + 1);
    await exchange(prologue, sera, foe, { initiator: 'player', damage: { defender: 9 } });
    expect(prologue.lessons.practised.has('range_two')).toBe(false);
    expect(prologue.beatState.fired).not.toContain('p3_glimmer');
    place(sera, foe.col, foe.row + 2);
    await exchange(prologue, sera, foe, { initiator: 'player', damage: { defender: 9 } });
    expect(prologue.lessons.practised.has('range_two')).toBe(true);
  });

  it('the beat reads the committed distance, nothing else (pure)', () => {
    const chapter = chapterOf('p3_seer_on_the_road');
    const base = { type: 'combatResolved', unit: 'Sera', target: 's', turn: 1, kill: false, damagedBy: [] }; // prettier-ignore
    expect(prologueBeatsFor(chapter, { ...base, distance: 2 }).fired).toContain('p3_glimmer');
    expect(prologueBeatsFor(chapter, { ...base, distance: 1 }).fired).not.toContain('p3_glimmer');
    expect(prologueBeatsFor(chapter, { ...base }).fired).not.toContain('p3_glimmer');
    const p2 = chapterOf('p2_old_hands');
    const kill = { type: 'combatResolved', unit: 'Edric', target: 'd', turn: 2, kill: true, distance: 1 }; // prettier-ignore
    expect(prologueBeatsFor(p2, { ...kill, damagedBy: ['Gaspar'] }).fired).toContain('p2_chip_then_finish'); // prettier-ignore
    expect(prologueBeatsFor(p2, { ...kill, damagedBy: ['Edric'] }).fired).not.toContain('p2_chip_then_finish'); // prettier-ignore
    expect(prologueBeatsFor(p2, { ...kill, damagedBy: [] }).fired).not.toContain('p2_chip_then_finish'); // prettier-ignore
    expect(prologueBeatsFor(p2, { ...kill }).fired).not.toContain('p2_chip_then_finish');
  });
});

describe('P4: deploy is practised by the deploy confirmation', () => {
  const deploy = ['Edric', 'Gaspar', 'Sera'];

  it('the confirmation made before the battle began marks it; battleStart alone never does', async () => {
    const chosen = makeScene('p4_quarry_gate', { deploy, confirmed: { count: 3 } });
    const prologue = new PrologueController(chosen.scene).create();
    expect(prologue.lessons.practised.has('deploy')).toBe(true);
    expect(prologue.beatState.fired).toContain('p4_deployed');

    const auto = makeScene('p4_quarry_gate', { deploy, confirmed: null });
    const none = new PrologueController(auto.scene).create();
    none.onPhaseStart('player', 1);
    await Promise.resolve();
    expect(none.beatState.fired).toContain('p4_start');
    expect(none.lessons.practised.has('deploy')).toBe(false);
    expect(none.beatState.fired).not.toContain('p4_deployed');
  });

  it('a resumed battle (no deploy screen) keeps what its checkpoint says', () => {
    const chosen = makeScene('p4_quarry_gate', { deploy, confirmed: { count: 3 } });
    const state = structuredClone(new PrologueController(chosen.scene).create().snapshot());
    expect(state.practised).toContain('deploy');
    const resumed = makeScene('p4_quarry_gate', { deploy, confirmed: null });
    const prologue = new PrologueController(resumed.scene).create();
    prologue.onResume(state, { turn: 1, phase: 'player' });
    expect(prologue.lessons.practised.has('deploy')).toBe(true);
  });

  it('a later battle on the reused scene object inherits no confirmation', () => {
    // Phaser reuses one BattleScene: battle 1 confirmed its deploy screen (create), then
    // battle 2 (an auto-deploy, a resume, a replay) inits the same object with none.
    const reused = new BattleScene();
    reused.init({ gameData: data });
    reused._deployConfirmation = { count: 3 };
    reused.init({ gameData: data });
    expect(reused._deployConfirmation).toBeNull();
    const second = makeScene('p4_quarry_gate', {
      deploy,
      confirmed: reused._deployConfirmation,
    });
    const prologue = new PrologueController(second.scene).create();
    expect(prologue.lessons.practised.has('deploy')).toBe(false);
    expect(prologue.beatState.fired).not.toContain('p4_deployed');
  });

  it('the controller reads the confirmation once', () => {
    const chosen = makeScene('p4_quarry_gate', { deploy, confirmed: { count: 3 } });
    expect(new PrologueController(chosen.scene).create().lessons.practised.has('deploy')).toBe(
      true,
    );
    expect(chosen.scene._deployConfirmation).toBeNull();
    // A controller made again on the same scene object confirms nothing new.
    const again = new PrologueController(chosen.scene).create();
    expect(again.lessons.practised.has('deploy')).toBe(false);
    expect(again.beatState.fired).not.toContain('p4_deployed');
  });

  it('the beat is a deployed trigger, which only a chapter with a deploy rule may use', () => {
    const p4 = chapterOf('p4_quarry_gate');
    expect(p4.beats.find((b) => b.id === 'p4_deployed')).toMatchObject({ on: 'deployed' });
    expect(prologueBeatsFor(p4, { type: 'deployed', count: 3 }).fired).toEqual(['p4_deployed']);
    expect(prologueBeatsFor(p4, { type: 'battleStart' }).fired).not.toContain('p4_deployed');
  });
});
