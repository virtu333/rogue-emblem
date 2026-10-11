// The Rite on the route map's surfaces (docs/specs/act-v-descent.md §4, §8): the chip beside the
// burden chips, its opened note, the pause list's entry, and the boss node's preview on the loom
// card. The numbers and the tier words are the engine's (Rite.js); these surfaces only arrange
// them. Ways this breaks, a test each:
//   1. a run outside the Descent shows a chip, an entry or a card block (the Rite is hidden there);
//   2. the chip says words or a tier the run does not hold, or the way up is off by one;
//   3. on the Entity's road the Lieutenant's effect is still listed after his gate fell, or the
//      boss is named twice in one sentence, or a line that does not name him loses him;
//   4. the pause list buries the Rite under the burdens, or drops the burden beside it;
//   5. a node that is not a boss the Rite reads (the Vigil, the Column) shows a Rite block, or a
//      won boss node still previews a tier;
//   6. a preview promises what the battle will not keep: once the map is locked the card must say
//      what the LOCKED config holds (not the tier the words stand at now), and "No change" when
//      the locked map holds nothing;
//   7. the chip opens, closes, and stays open through a redraw; a tap on the note closes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom } from './helpers/fakeDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { createRite } from '../src/engine/Rite.js';
import { addBurden } from '../src/engine/Burdens.js';
import { applyGenerationFields, generateSeededBattle } from '../src/engine/BattleScout.js';
import { NodeMapMenu } from '../src/ui/NodeMapMenu.js';
import { renderLoomCard } from '../src/ui/LoomPanels.js';
import { pauseBurdenList } from '../src/ui/MobilePauseMenu.js';
import { pauseBurdenEntries } from '../src/ui/eventMenuModel.js';
import {
  effectParts,
  lockedRiteLines,
  riteBurdenEntry,
  riteChipModel,
  riteNodeModel,
  riteSourceTotals,
} from '../src/ui/riteModel.js';
import { newRun } from './eventKit.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

/** A run standing in the Descent (`difficulty` picks the road) with the Rite at `words`. */
function descentRun(difficultyId, words, runSeed = 13) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed, difficultyId, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  rm.rite = createRite({ start: words });
  return rm;
}
const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);

/** The map `node` generates now, as BattleScene builds it at entry. */
function generated(rm, node) {
  const params = rm.getBattleParams(node);
  applyGenerationFields(params, { deployCount: 6, isBoss: node.type === 'boss' });
  return generateSeededBattle(params, rm.gameData, params.battleSeed);
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetInputFocus();
});

describe('the chip’s words', () => {
  it('no Rite, no chip, no entry: an ordinary run and an old save', () => {
    const run = newRun();
    expect(run.rite).toBeNull();
    expect(riteChipModel(run)).toBeNull();
    expect(riteBurdenEntry(run)).toBeNull();
    expect(riteChipModel({ rite: { v: 2, words: 4 } })).toBeNull();
    // The pause list of a run with no Rite and no burden is what it always was.
    expect(pauseBurdenEntries(run, run.gameData.events)).toEqual([]);
  });

  it('says the words and the tier the run holds, and the words to the next tier', () => {
    const spoken = riteChipModel(descentRun('normal', 7));
    expect(spoken).toMatchObject({
      id: 'rite',
      label: 'The Rite',
      short: '7 words · Spoken',
      chip: 'The Rite: 7 words · Spoken',
      band: 'spoken',
      // Derived from the spec's table: Answered opens at 12, so 5 more.
      progress: '5 more words to Answered (12).',
    });
    expect(riteChipModel(descentRun('normal', 11)).progress).toBe('1 more word to Answered (12).');
    expect(riteChipModel(descentRun('normal', 12))).toMatchObject({
      short: '12 words · Answered',
      progress: 'The highest tier.',
    });
    expect(riteChipModel(descentRun('normal', 0))).toMatchObject({
      short: '0 words · Broken',
      progress: '5 more words to Spoken (5).',
    });
    expect(riteChipModel(descentRun('normal', 1)).short).toBe('1 word · Broken');
  });

  it('names what the tier does to each boss still ahead, the boss said once', () => {
    const broken = riteChipModel(descentRun('hard', 2));
    expect(broken.effects.map((e) => [e.target, e.name, e.rest])).toEqual([
      ['lieutenant', 'The Lieutenant', "'s escort loses its 2 strongest members"],
      ['entity', 'The Entity', "'s splash strikes 1 tile fewer"],
    ]);
    const answered = riteChipModel(descentRun('hard', 14));
    expect(answered.effects[0].rest).toBe(
      ' carries 1 more Revival Stone. 2 Hollowed join him on turn 4',
    );
    expect(answered.effects[1].rest).toBe(
      "'s splash strikes 1 tile more. Each of its waves brings 2 Hollowed",
    );
    // Spoken changes nothing: a line that never names the boss gets him and a colon.
    const spoken = riteChipModel(descentRun('hard', 6));
    expect(spoken.effects.map((e) => `${e.name}${e.rest}`)).toEqual([
      'The Lieutenant: No change',
      'The Entity: No change',
    ]);
    expect(effectParts('entity', ['No change'])).toMatchObject({
      name: 'The Entity',
      rest: ': No change',
    });
    expect(spoken.terms).toBe(
      'Spoken. 6 more words to Answered (12). The Lieutenant: No change. The Entity: No change. From: The Eclipse +6.',
    );
  });

  it('a Lieutenant road lists the Lieutenant only; the Entity road drops him once his gate fell', () => {
    expect(riteChipModel(descentRun('normal', 14)).effects.map((e) => e.target)).toEqual([
      'lieutenant',
    ]);
    const rm = descentRun('hard', 14);
    expect(riteChipModel(rm).effects.map((e) => e.target)).toEqual(['lieutenant', 'entity']);
    nodeOf(rm, 'gate').completed = true;
    expect(riteChipModel(rm).effects.map((e) => e.target)).toEqual(['entity']);
    // Both bosses done: nothing left to read, and the chip still shows the words.
    nodeOf(rm, 'entity').completed = true;
    const done = riteChipModel(rm);
    expect(done.effects).toEqual([]);
    expect(done.terms).toBe('Answered. The highest tier. From: The Eclipse +14.');
  });

  it('says where the words came from, net by source, in the log’s order, never a zero', () => {
    expect(
      riteSourceTotals([
        { source: 'eclipse', delta: 2 },
        { source: 'vigil', delta: 4, nodeId: 'finalBoss_2_2' },
        { source: 'event', delta: -3, eventId: 'came_this_far' },
        { source: 'event', delta: 3, eventId: 'last_lantern' },
        { source: 'battle', delta: -1, nodeId: 'finalBoss_1_1' },
        { source: 'nonsense', delta: 9 },
      ]),
    ).toEqual([
      { source: 'eclipse', name: 'The Eclipse', delta: 2 },
      { source: 'vigil', name: 'The Vigil', delta: 4 },
      { source: 'battle', name: 'Par', delta: -1 },
    ]);
    const rm = descentRun('normal', 5);
    rm.rite = {
      ...rm.rite,
      log: [
        { source: 'eclipse', delta: 2 },
        { source: 'vigil', delta: 4 },
        { source: 'battle', delta: -1, nodeId: 'x' },
      ],
    };
    expect(riteChipModel(rm).fromLine).toBe('From: The Eclipse +2 · The Vigil +4 · Par −1');
  });
});

describe('the pause list', () => {
  it('leads with the Rite and keeps every burden after it', () => {
    const rm = descentRun('hard', 7);
    expect(addBurden(rm, 'debt', { owed: 450 }).ok).toBe(true);
    const entries = pauseBurdenEntries(rm, rm.gameData.events);
    expect(entries.map((e) => e.id)).toEqual(['rite', 'debt']);
    expect(entries[0]).toMatchObject({ label: 'The Rite', short: '7 words · Spoken' });
    expect(entries[0].text).toContain('5 more words to Answered (12).');
    const list = pauseBurdenList(entries);
    expect(list.getAttribute('aria-label')).toBe('The Rite, burdens');
    const items = list.querySelectorAll('li');
    expect(items[0].className).toBe('is-rite');
    expect(items[0].textContent).toContain('The Rite · 7 words · Spoken');
    expect(items[1].textContent).toContain('Debt');
    // Alone it is the whole list, named so.
    expect(pauseBurdenList([entries[0]]).getAttribute('aria-label')).toBe('The Rite');
  });
});

describe('the chip on the route map', () => {
  const rowFor = (run, menu = { _burdenOpen: null }) =>
    NodeMapMenu.prototype._burdenRow.call(
      Object.assign(menu, { scene: { runManager: run, gameData: run.gameData } }),
    );

  it('an ordinary run has no row; a Descent run has the Rite chip, first, before a burden', () => {
    expect(rowFor(newRun())).toBeNull();
    const rm = descentRun('hard', 9);
    const alone = rowFor(rm);
    expect(alone.getAttribute('aria-label')).toBe('The Rite');
    expect(alone.querySelectorAll('.re-burden').map((c) => c.dataset.burden)).toEqual(['rite']);
    expect(alone.querySelector('.re-burden').textContent).toBe('The Rite9 words · Spoken');
    expect(addBurden(rm, 'debt', { owed: 450 }).ok).toBe(true);
    const row = rowFor(rm);
    expect(row.getAttribute('aria-label')).toBe('The Rite, burdens and contract');
    expect(row.querySelectorAll('.re-burden').map((c) => c.dataset.burden)).toEqual([
      'rite',
      'debt',
    ]);
  });

  it('a tap opens the note (the tier, the way up, each boss, the sources), a second closes it', () => {
    const rm = descentRun('hard', 14);
    const row = rowFor(rm);
    const chip = row.querySelector('.re-rite');
    const note = row.querySelector('.re-burden-note');
    expect(note.hidden).toBe(true);
    chip.onclick();
    expect(note.hidden).toBe(false);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(note.classList.contains('is-rite')).toBe(true);
    expect(note.querySelector('.re-rite-progress').textContent).toBe(
      'Answered · The highest tier.',
    );
    const lines = note.querySelector('.re-rite-effects').children;
    expect(lines.map((li) => li.dataset.riteTarget)).toEqual(['lieutenant', 'entity']);
    expect(lines[0].querySelector('strong').textContent).toBe('The Lieutenant');
    expect(lines[0].textContent).toBe(
      'The Lieutenant carries 1 more Revival Stone. 2 Hollowed join him on turn 4',
    );
    expect(note.querySelector('.re-rite-from').textContent).toBe('From: The Eclipse +14');
    // The title (hover, long press) holds the whole of it.
    expect(chip.title).toContain('The Rite: Answered. The highest tier.');
    chip.onclick();
    expect(note.hidden).toBe(true);
    expect(chip.getAttribute('aria-expanded')).toBe('false');
  });

  it('it stays open through a redraw; a tap on the note closes it; it goes with its Rite', () => {
    const rm = descentRun('normal', 3);
    const menu = { _burdenOpen: null };
    const first = rowFor(rm, menu);
    first.querySelector('.re-rite').onclick();
    const again = rowFor(rm, menu);
    expect(again.querySelector('.re-burden-note').hidden).toBe(false);
    expect(again.querySelector('.re-rite').getAttribute('aria-expanded')).toBe('true');
    // A tap on the note itself is a close (it lies over the loom).
    again.querySelector('.re-burden-note').click();
    expect(again.querySelector('.re-burden-note').hidden).toBe(true);
    expect(again.querySelector('.re-rite').getAttribute('aria-expanded')).toBe('false');
    // The run's Rite goes (a save read as none): the open line goes with it.
    rm.rite = null;
    expect(rowFor(rm, menu)).toBeNull();
    expect(menu._burdenOpen).toBeNull();
  });
});

describe('the boss node’s preview', () => {
  it('only the bosses the Rite reads, never a Vigil, a Column or an ordinary run', () => {
    const rm = descentRun('hard', 1);
    expect(riteNodeModel(rm, nodeOf(rm, 'vigil'))).toBeNull();
    expect(riteNodeModel(rm, nodeOf(rm, 'column'))).toBeNull();
    expect(riteNodeModel(rm, nodeOf(rm, 'gate'))).not.toBeNull();
    expect(riteNodeModel(rm, nodeOf(rm, 'entity'))).not.toBeNull();
    const plain = newRun();
    for (const node of plain.nodeMap.nodes) expect(riteNodeModel(plain, node)).toBeNull();
    // A boss already won has no fight left to preview.
    nodeOf(rm, 'gate').completed = true;
    expect(riteNodeModel(rm, nodeOf(rm, 'gate'))).toBeNull();
  });

  it('before the map is locked it says the tier the words stand at, for that boss only', () => {
    const rm = descentRun('hard', 2);
    expect(riteNodeModel(rm, nodeOf(rm, 'gate'))).toMatchObject({
      target: 'lieutenant',
      state: 'open',
      bandLabel: 'Broken',
      wordsText: '2 words',
      note: 'Read when the battle begins.',
      lines: ["The Lieutenant's escort loses its 2 strongest members"],
    });
    expect(riteNodeModel(rm, nodeOf(rm, 'entity'))).toMatchObject({
      target: 'entity',
      lines: ["The Entity's splash strikes 1 tile fewer"],
    });
  });

  it('once locked it says what the locked config holds, not the tier the words stand at now', () => {
    const rm = descentRun('normal', 20);
    const node = nodeOf(rm, 'lieutenant');
    // The map was locked at Answered ...
    const config = generated(rm, node);
    rm.lockBattleConfig(node.id, config);
    const [wave] = config.reinforcements.scriptedWaves.filter((w) => w.rite);
    const boss = config.enemySpawns.find((s) => s.isBoss);
    const locked = riteNodeModel(rm, node);
    expect(locked).toMatchObject({
      state: 'locked',
      bandLabel: 'Answered',
      note: 'Set for this battle.',
    });
    // ... and says exactly the stone and wave that map holds (derived from the config, not the data).
    const own = (run) => run.gameData.difficulty.modes.normal.revivalStones.lieutenant || 0;
    expect(boss.revivalStones).toBe(own(rm) + 1);
    expect(locked.lines).toEqual([
      'The Lieutenant carries 1 more Revival Stone',
      `${wave.spawns.length} Hollowed join him on turn ${wave.turn}`,
    ]);
    // The words fall to Broken afterwards: the locked battle is still the one that is previewed.
    rm.rite = { ...rm.rite, words: 0 };
    expect(riteNodeModel(rm, node).lines).toEqual(locked.lines);
    expect(riteNodeModel(rm, node).bandLabel).toBe('Answered');
  });

  it('a Broken lock previews the escort the map really lost; an untouched lock says no change', () => {
    const rm = descentRun('hard', 1);
    const node = nodeOf(rm, 'gate');
    const config = generated(rm, node);
    // Derived from the same seed with no Rite: how many escort the tier took.
    const none = descentRun('hard', 1);
    none.rite = null;
    const bare = generated(none, nodeOf(none, 'gate'));
    const lost = bare.enemySpawns.length - config.enemySpawns.length;
    expect(lost).toBeGreaterThan(0);
    rm.lockBattleConfig(node.id, config);
    expect(riteNodeModel(rm, node).lines).toEqual([
      `The Lieutenant's escort loses its ${lost} strongest members`,
    ]);
    // A map locked with no record of the Rite (nothing could be placed) is no change.
    const rm2 = descentRun('hard', 1);
    const gate = nodeOf(rm2, 'gate');
    rm2.lockBattleConfig(gate.id, bare);
    expect(riteNodeModel(rm2, gate).lines).toEqual(['No change']);
  });

  it('words a record the way the engine words a tier, one count for equal waves, all for unequal', () => {
    expect(lockedRiteLines(null)).toEqual(['No change']);
    expect(lockedRiteLines({ target: 'lieutenant' })).toEqual(['No change']);
    expect(
      lockedRiteLines({
        target: 'lieutenant',
        escortDropped: 1,
        revivalStones: 2,
        waves: [{ turn: 3, count: 1 }],
      }),
    ).toEqual([
      "The Lieutenant's escort loses its 1 strongest member",
      'The Lieutenant carries 2 more Revival Stones',
      '1 Hollowed join him on turn 3',
    ]);
    expect(
      lockedRiteLines({
        target: 'entity',
        splashDelta: -1,
        waves: [
          { turn: 3, count: 2 },
          { turn: 6, count: 2 },
        ],
      }),
    ).toEqual(["The Entity's splash strikes 1 tile fewer", 'Each of its waves brings 2 Hollowed']);
    expect(
      lockedRiteLines({
        target: 'entity',
        waves: [
          { turn: 3, count: 2 },
          { turn: 6, count: 1 },
        ],
      }),
    ).toEqual(['Its waves bring 2, 1 Hollowed']);
    // A wave that placed none is not a wave.
    expect(lockedRiteLines({ target: 'entity', waves: [{ turn: 3, count: 0 }] })).toEqual([
      'No change',
    ]);
  });
});

describe('the loom card', () => {
  const render = (rm, node, state = 'live') => {
    const card = document.createElement('section');
    renderLoomCard(card, node, {
      model: { nodeState: () => state, steps: new Map() },
      actId: rm.currentAct,
      gameData: rm.gameData,
      runManager: rm,
      isFirstBattle: () => false,
    });
    return card;
  };

  it('a boss node carries the Rite block beside its boss line; nothing else does', () => {
    const rm = descentRun('hard', 14);
    const card = render(rm, nodeOf(rm, 'gate'));
    const block = card.querySelector('.re-loom-rite');
    expect(block).not.toBeNull();
    expect(block.dataset.rite).toBe('open');
    expect(block.dataset.riteTarget).toBe('lieutenant');
    expect(block.querySelector('.re-loom-rite-head').textContent).toBe(
      'The Rite · Answered · 14 words',
    );
    expect(block.querySelector('.re-loom-rite-lines').children.map((li) => li.textContent)).toEqual(
      ['The Lieutenant carries 1 more Revival Stone', '2 Hollowed join him on turn 4'],
    );
    expect(block.querySelector('.re-loom-rite-note').textContent).toBe(
      'Read when the battle begins.',
    );
    // It follows the boss line, so the two read together.
    const order = card.children.map((c) => c.className);
    expect(order.findIndex((c) => c.includes('re-loom-rite'))).toBe(
      order.findIndex((c) => c.includes('re-loom-boss')) + 1,
    );
    expect(render(rm, nodeOf(rm, 'vigil')).querySelector('.re-loom-rite')).toBeNull();
    expect(render(rm, nodeOf(rm, 'stair')).querySelector('.re-loom-rite')).toBeNull();
    const plain = newRun();
    const boss = plain.nodeMap.nodes.find((n) => n.type === 'boss');
    expect(render(plain, boss).querySelector('.re-loom-rite')).toBeNull();
  });

  it('a locked boss node says so', () => {
    const rm = descentRun('hard', 14);
    const node = nodeOf(rm, 'entity');
    rm.lockBattleConfig(node.id, generated(rm, node));
    const block = render(rm, node).querySelector('.re-loom-rite');
    expect(block.dataset.rite).toBe('locked');
    expect(block.querySelector('.re-loom-rite-note').textContent).toBe('Set for this battle.');
    // The Entity's tier is its splash and its waves, nothing of its HP or its stones.
    const text = block.textContent;
    expect(text).toContain('splash strikes 1 tile more');
    expect(text).not.toMatch(/HP|Stone|hinge|rally/i);
  });
});
