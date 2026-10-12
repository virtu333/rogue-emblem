// The Descent's words (docs/specs/act-v-descent.md §10): every pool the Act V content adds is
// read by real code on the road it is written for, and never on another. Ways this breaks:
//   - a `when` that can never hold where it should (the gate's glass never counts as broken, the
//     Descent never counts as the road), so a pool is dead data
//   - a Descent line plays on a road the Descent does not take (the Descent off, a save already
//     in its two-node final act, the prologue): it promises a stair, a door or a glass that
//     never comes
//   - the Entity's roads keep the old Act IV close ("It's here" at the top of the stair)
//   - a Voice of the Vigil, or a route node, has no words of its own (keys drift from the data)
//   - the Vigil's words are picked from anything but the counts the battle keeps (a resume or a
//     rewind would say different words)
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadGameData } from './testData.js';
import {
  RunManager,
  getActTransitionKey,
  getActTransitionFollowUps,
} from '../src/engine/RunManager.js';
import {
  buildNarrativeContext,
  descentRoadOf,
  finaleOf,
  glassBrokenOf,
  selectDialogueEntries,
} from '../src/engine/NarrativeDirector.js';
import {
  vigilCallLine,
  vigilSilencedLine,
  vigilSpokenWords,
  voiceVerse,
} from '../src/engine/VigilWords.js';
import { BattleBeatsController } from '../src/ui/BattleBeatsController.js';
import { describeLoomNode, descentFlavorLines } from '../src/ui/loomModel.js';
import { riteModLines } from '../src/engine/Rite.js';
import { withDevSetPiece } from '../src/utils/devSetPieceFixtures.js';

const dialogue = JSON.parse(
  readFileSync(new URL('../data/dialogue.json', import.meta.url), 'utf8'),
);
const baseData = { ...loadGameData(), dialogue };
const LORDS = ['Edric', 'Kira', 'Voss', 'Sera', 'Rowan', 'Astrid', 'Cael'];
const descentOn = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});
// The Descent switched off (the shipped file has it on): the old two-node final act.
const descentOff = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: false },
});

/** A run entering its final act (built as the Descent when `data` has it on). */
function intoFinalAct(difficultyId, data = descentOn(), runSeed = 9) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed, difficultyId });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}
const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);
const win = (rm, key) =>
  rm.completeBattle(
    rm.roster.map((u) => structuredClone(u)),
    nodeOf(rm, key).id,
    0,
    { turnCount: 4, turnPar: 12 },
  );
const ctxOf = (rm, extra = {}) => ({
  ...buildNarrativeContext({ runManager: rm, gameData: rm.gameData }),
  ...extra,
});
const lines = (section, ctx) => (selectDialogueEntries(section, ctx) || []).map((e) => e.line);

describe('the road keys: descent and glassBroken', () => {
  it('descent: on the Descent’s map, or ahead of it with the config on; never on the old final act', () => {
    // On the map itself.
    for (const rung of ['normal', 'dusk', 'hard', 'lunatic']) {
      const rm = intoFinalAct(rung);
      expect(descentRoadOf(rm, rm.gameData), rung).toBe(true);
    }
    // Ahead of it: a fresh run in Act I, with the config on and off.
    const ahead = new RunManager(descentOn());
    ahead.startRun({ runSeed: 4, difficultyId: 'hard' });
    expect(ahead.currentAct).toBe('act1');
    expect(descentRoadOf(ahead, ahead.gameData)).toBe(true);
    const off = new RunManager(descentOff());
    off.startRun({ runSeed: 4, difficultyId: 'hard' });
    expect(off.gameData.descent.enabled).toBe(false);
    expect(descentRoadOf(off, off.gameData)).toBe(false);
    // In the final act on today's two-node map, the config being on now changes nothing.
    const legacy = intoFinalAct('hard', descentOff());
    expect(legacy.nodeMap.descent).toBeUndefined();
    expect(descentRoadOf(legacy, descentOn())).toBe(false);
    // A road with no final act, the prologue, nothing at all.
    expect(descentRoadOf({ actSequence: ['act1', 'act2', 'act3', 'act4'], difficultyId: 'dusk' }, descentOn())).toBe(false); // prettier-ignore
    expect(descentRoadOf({ mode: 'prologue', actSequence: ['act1', 'finalBoss'], difficultyId: 'normal' }, descentOn())).toBe(false); // prettier-ignore
    expect(descentRoadOf(null, descentOn())).toBe(false);
  });

  it('glassBroken: only once the gate’s victory is committed, and never on a road without a gate', () => {
    const rm = intoFinalAct('hard');
    expect(glassBrokenOf(rm)).toBe(false);
    win(rm, 'stair');
    win(rm, 'column');
    win(rm, 'vigil');
    rm.markNodeComplete(nodeOf(rm, 'landing').id);
    expect(glassBrokenOf(rm)).toBe(false);
    win(rm, 'gate');
    expect(glassBrokenOf(rm)).toBe(true);
    expect(ctxOf(rm).glassBroken).toBe(true);
    // The Lieutenant's own road ends at him: no gate, no broken glass, even with his node won.
    const fl = intoFinalAct('normal');
    fl.nodeMap.nodes.forEach((n) => (n.completed = true));
    expect(glassBrokenOf(fl)).toBe(false);
    expect(glassBrokenOf(null)).toBe(false);
  });
});

describe('Act IV into the Descent on the Entity’s roads', () => {
  const T = dialogue.actTransitions;

  it('with the Descent: the ground wakes, his sight returns, the commander answers; the stair, not "It’s here"', () => {
    for (const rung of ['hard', 'lunatic']) {
      const rm = intoFinalAct(rung);
      const key = getActTransitionKey('act4', 'finalBoss', { finale: finaleOf(rm, rm.gameData) });
      expect(key).toBe('finalBoss_to_secretAct');
      for (const commander of LORDS) {
        const ctx = ctxOf(rm, { commander });
        const said = [key, ...getActTransitionFollowUps(key)].flatMap((k) =>
          selectDialogueEntries(T[k], ctx),
        );
        expect(said.map((e) => e.speaker)).toEqual(['Sera', 'Sera', commander, 'Sera', commander]);
        expect(said[1].line).toMatch(/his sight is back/i);
        expect(said[1].line).toMatch(/door/);
        expect(said.at(-2).line).toMatch(/stair/);
        expect(said.map((e) => e.line).join(' ')).not.toMatch(/It's here/);
      }
    }
  });

  it('without it (the config off, the old two-node act): the lines it always had', () => {
    const rm = intoFinalAct('hard', descentOff());
    const ctx = ctxOf(rm, { commander: 'Edric' });
    expect(ctx.descent).toBe(false);
    const edric = T.finalBoss_to_secretAct.variants.find(
      (v) => v.when.commander === 'Edric' && !v.when.descent,
    );
    expect(lines(T.finalBoss_to_secretAct, ctx)).toEqual(edric.entries.map((e) => e.line));
    expect(lines(T.secretAct_start, ctx).join(' ')).toMatch(/It's here/);
  });

  it('First Light’s Act III close gains the stair on the Descent', () => {
    const A3 = T.act3_to_finalBoss_normal;
    const rm = intoFinalAct('normal');
    const legacy = intoFinalAct('normal', descentOff());
    const fresh = { runsCompleted: 0, lastRunResult: 'none' };
    for (const commander of LORDS) {
      const plain = A3.variants.find(
        (v) => Object.keys(v.when).join() === 'commander' && v.when.commander === commander,
      );
      const before = plain.entries.map((e) => e.line);
      const onDescent = lines(A3, ctxOf(rm, { commander, ...fresh }));
      // The commander's own close, with the stair said second.
      expect(onDescent, commander).toEqual([before[0], expect.stringMatching(/stair under the consecrated stones/), ...before.slice(1)]); // prettier-ignore
      expect(lines(A3, ctxOf(legacy, { commander, ...fresh })), commander).toEqual(before);
    }
  });

  it('the stair outranks a veteran’s or a defeat’s close on the Descent, and only there', () => {
    // First match wins in a section's variants (NarrativeDirector.selectDialogueEntries), so a
    // veteran (5 runs won) or a run after a defeat must still hear the stair when the road has one.
    const A3 = T.act3_to_finalBoss_normal;
    const rm = intoFinalAct('normal');
    const legacy = intoFinalAct('normal', descentOff());
    const stair = /stair under the consecrated stones/;
    const memories = [
      { runsCompleted: 5, lastRunResult: 'none' },
      { runsCompleted: 0, lastRunResult: 'defeat' },
      { runsCompleted: 9, lastRunResult: 'defeat' },
    ];
    for (const commander of LORDS)
      for (const memory of memories) {
        const onDescent = lines(A3, ctxOf(rm, { commander, ...memory })).join(' ');
        expect(onDescent, `${commander} ${JSON.stringify(memory)}`).toMatch(stair);
        // The same save with the Descent off keeps the memory it always heard, never the stair.
        const old = lines(A3, ctxOf(legacy, { commander, ...memory })).join(' ');
        expect(old, `${commander} ${JSON.stringify(memory)} (old road)`).not.toMatch(/stair/);
        expect(old).not.toBe(onDescent);
      }
  });

  it('secretAct_start on the Descent: Sera on the stair, then the commander answers in their own voice', () => {
    const rm = intoFinalAct('hard');
    for (const commander of LORDS) {
      const said = selectDialogueEntries(T.secretAct_start, ctxOf(rm, { commander }));
      expect(
        said.map((e) => e.speaker),
        commander,
      ).toEqual(['Sera', commander]);
      expect(said[0].line).toMatch(/stair/);
      expect(said[1].line.length).toBeLessThanOrEqual(90);
      // Not the old road's reply to "This place is... wrong."
      const old = selectDialogueEntries(
        T.secretAct_start,
        ctxOf(intoFinalAct('hard', descentOff()), { commander }),
      );
      expect(said[1].line).not.toBe(old.at(-1).line);
    }
    // A commander the data does not name still hears Sera.
    const other = selectDialogueEntries(T.secretAct_start, ctxOf(rm, { commander: 'Nobody' }));
    expect(other.map((e) => e.speaker)).toEqual(['Sera']);
  });

  it('no Descent, glass or Rite variant sits behind a broader variant that would answer first', () => {
    // The reader takes the first variant whose `when` holds, so a variant naming one of these
    // keys that an earlier variant (naming none of them) can also match is shadowed on the
    // contexts they share: the stair must come before the veteran's close, and so on.
    const NEW = ['descent', 'glassBroken', 'bossRole', 'riteBand', 'finale'];
    const NUMERIC = ['minRunsCompleted', 'maxRunsStarted'];
    const asSet = (v) => new Set(Array.isArray(v) ? v : [v]);
    const compatible = (a, b) =>
      Object.keys(a).every(
        (k) => !(k in b) || NUMERIC.includes(k) || [...asSet(a[k])].some((x) => asSet(b[k]).has(x)),
      );
    const shadowed = [];
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${path}[${i}]`));
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node.variants)) {
        node.variants.forEach((later, j) => {
          const named = Object.keys(later.when || {}).filter((k) => NEW.includes(k));
          if (!named.length) return;
          for (let i = 0; i < j; i++) {
            const earlier = node.variants[i].when || {};
            const lacks = named.filter((k) => !(k in earlier));
            if (lacks.length && compatible(earlier, later.when))
              shadowed.push(`${path} variant ${i} ${JSON.stringify(earlier)} before ${j}`);
          }
        });
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}/${k}`);
    };
    walk(dialogue, '');
    expect(shadowed).toEqual([]);
  });
});

describe('the finale remembers the glass and the Rite', () => {
  it('victory_entity: after the gate, Sera names the broken glass before the commander’s line', () => {
    const R = dialogue.runComplete.victory_entity;
    for (const commander of LORDS) {
      const plain = lines(R, { commander, glassBroken: false });
      const glass = lines(R, { commander, glassBroken: true });
      expect(glass).toHaveLength(plain.length + 1);
      expect(glass[0]).toBe(plain[0]);
      expect(glass.at(-1)).toBe(plain.at(-1));
      expect(glass[1]).toMatch(/glass/);
    }
  });

  it('the Entity’s opening: Broken and Answered say what the Rite did; Spoken is as before', () => {
    const E = dialogue.bossEncounters['The Entity'];
    const opening = (riteBand, extra = {}) => lines(E.preBattle, { riteBand, ...extra });
    expect(opening('spoken')).toEqual(opening('none'));
    expect(opening('broken').join(' ')).toMatch(/half a summons/);
    expect(opening('answered').join(' ')).toMatch(/wide awake/);
    expect(opening('broken')[0]).toBe('...');
  });
});

describe('the Vigil’s words (dialogue.json vigil, engine/VigilWords.js)', () => {
  const pool = dialogue.vigil;
  const vigilPiece = baseData.setPieces.setPieces.find((p) => p.id === 'the_vigil');
  const dev = withDevSetPiece(loadGameData(), 'dev_vigil').setPieces.setPieces.find(
    (p) => p.id === 'dev_vigil',
  );

  it('every Voice the set pieces seat has a verse and a last line, and no other Voice is written', () => {
    const targets = (piece) =>
      new Set(piece.variants.flatMap((v) => v.vigil.sigils.map((s) => s.target)));
    const real = targets(vigilPiece);
    expect([...targets(dev)].sort()).toEqual([...real].sort());
    expect(Object.keys(pool.voices).sort()).toEqual([...real].sort());
    for (const id of real) {
      expect(voiceVerse(pool, id).length, id).toBeGreaterThanOrEqual(5);
      expect(vigilSilencedLine(pool, id), id).toBeTruthy();
    }
    // The words fit over a Voice's head; the lines are the court's, short and plain.
    for (const v of Object.values(pool.voices)) {
      for (const word of v.words) expect(word.length, word).toBeLessThanOrEqual(24);
      expect(v.silenced.length).toBeLessThanOrEqual(90);
    }
    for (const line of pool.call) expect(line.length, line).toBeLessThanOrEqual(24);
  });

  it('the words a Voice says are its verse from the count it had spoken, two at once for the Waking', () => {
    const calling = pool.voices.voice_calling.words;
    const waking = pool.voices.voice_waking.words;
    const said = vigilSpokenWords(
      [
        { voiceId: 'voice_calling', count: 1 },
        { voiceId: 'voice_waking', count: 2 },
        { voiceId: 'voice_nobody', count: 1 },
      ],
      { voice_calling: 2, voice_waking: waking.length - 1 },
      pool,
    );
    expect(said).toEqual([
      { voiceId: 'voice_calling', text: calling[2] },
      // the verse starts again once it runs out
      { voiceId: 'voice_waking', text: `${waking.at(-1)} ${waking[0]}` },
    ]);
    // A Voice that has spoken nothing yet opens its verse; a count of 0 says nothing.
    expect(vigilSpokenWords([{ voiceId: 'voice_binding', count: 1 }], {}, pool)).toEqual([
      { voiceId: 'voice_binding', text: pool.voices.voice_binding.words[0] },
    ]);
    expect(vigilSpokenWords([{ voiceId: 'voice_binding', count: 0 }], {}, pool)).toEqual([]);
    expect(vigilSpokenWords(null, null, pool)).toEqual([]);
    expect(vigilSpokenWords([{ voiceId: 'voice_binding', count: 1 }], {}, null)).toEqual([]);
  });

  it('the roll call answers in turn, and a missing pool says nothing', () => {
    expect(vigilCallLine(pool, 0)).toBe(pool.call[0]);
    expect(vigilCallLine(pool, pool.call.length + 1)).toBe(pool.call[1]);
    expect(vigilCallLine(null, 0)).toBeNull();
    expect(vigilSilencedLine(pool, 'voice_nobody')).toBeNull();
  });

  it('the entry beat: the Voices by the Rite’s tier, the Waking’s warning in each, then the commander', () => {
    const sceneFor = (riteBand, commander) => ({
      gameData: { dialogue },
      battleConfig: { vigil: { sigils: [], circles: [] } },
      battleParams: riteBand ? { riteBand } : {},
      registry: { get: () => null },
      runManager: { difficultyId: 'hard', roster: [], getStartingLordNames: () => [commander, 'Edric'] }, // prettier-ignore
    });
    const heard = new Set();
    for (const band of [null, 'broken', 'spoken', 'answered']) {
      for (const commander of LORDS) {
        const said = new BattleBeatsController(
          sceneFor(band, commander),
          () => 0,
        ).getVigilEntryEntries();
        const speakers = said.map((e) => e.speaker);
        expect(speakers.at(-1), `${band} ${commander}`).toBe(commander);
        expect(speakers.slice(0, -1).every((s) => s.startsWith('Voice of the '))).toBe(true);
        expect(said.some((e) => e.speaker === 'Voice of the Waking' && /twice/.test(e.line))).toBe(
          true,
        );
        heard.add(
          said
            .slice(0, -1)
            .map((e) => e.line)
            .join('|'),
        );
      }
    }
    // Broken, Answered and the rest each have their own opening.
    expect(heard.size).toBe(3);
    // No Vigil on the map, or no run: no beat.
    const plain = sceneFor(null, 'Edric');
    plain.battleConfig = {};
    expect(new BattleBeatsController(plain, () => 0).getVigilEntryEntries()).toEqual([]);
    const standalone = sceneFor(null, 'Edric');
    standalone.runManager = null;
    expect(new BattleBeatsController(standalone, () => 0).getVigilEntryEntries()).toEqual([]);
  });
});

describe('the Descent’s nodes speak for themselves (nodeFlavor.descent)', () => {
  const keys = new Set(
    Object.values(baseData.descent.routes).flatMap((route) =>
      route.rows.flatMap((row) =>
        row.nodes.flatMap((slot) => (slot.oneOf ? slot.oneOf : [slot]).map((n) => n.key)),
      ),
    ),
  );

  it('every node key of every route has its own lines, and no line is written for a key no route has', () => {
    const pools = dialogue.nodeFlavor.descent;
    expect(Object.keys(pools).sort()).toEqual([...keys].sort());
    for (const [key, list] of Object.entries(pools))
      expect(list.length, key).toBeGreaterThanOrEqual(2);
    // The final act's event nodes no longer borrow Act III's road.
    expect(dialogue.nodeFlavor.event.finalBoss.length).toBeGreaterThanOrEqual(2);
  });

  it('the loom card reads a Descent node’s own pool, and an eclipsed or ordinary node its type’s', () => {
    for (const rung of ['normal', 'hard']) {
      const rm = intoFinalAct(rung);
      for (const node of rm.nodeMap.nodes) {
        const card = describeLoomNode(node, { state: 'future', actId: 'finalBoss', dialogue });
        expect(dialogue.nodeFlavor.descent[node.descentKey], node.descentKey).toContain(
          card.flavor,
        );
      }
    }
    expect(descentFlavorLines(dialogue.nodeFlavor, { descentKey: 'nowhere' })).toBeNull();
    expect(descentFlavorLines(dialogue.nodeFlavor, { type: 'battle' })).toBeNull();
    const legacy = { id: 'finalBoss_0_2', type: 'battle', battleParams: {} };
    const card = describeLoomNode(legacy, { state: 'future', actId: 'finalBoss', dialogue });
    expect(dialogue.nodeFlavor.battle.finalBoss).toContain(card.flavor);
  });
});

describe('the Rite’s effect lines read as sentences at any count', () => {
  it('one guard, one stone, one Hollowed: singular; more: plural', () => {
    expect(
      riteModLines({ escortDrop: 1, revivalStones: 1, waveHollowed: 1 }, 'lieutenant'),
    ).toEqual([
      "The Lieutenant's strongest guard is gone from his side",
      'The Lieutenant gains 1 Revival Stone: 1 more health bar',
      '1 Hollowed joins him on turn 4',
    ]);
    expect(
      riteModLines({ escortDrop: 2, revivalStones: 2, waveHollowed: 3, waveTurn: 6 }, 'lieutenant'),
    ).toEqual([
      // prettier-ignore
      "The Lieutenant's 2 strongest guards are gone from his side",
      'The Lieutenant gains 2 Revival Stones: 2 more health bars',
      '3 Hollowed join him on turn 6',
    ]);
    expect(riteModLines({ splashDelta: -2, waveHollowed: 1 }, 'entity')).toEqual([
      "The Entity's splash strikes 2 tiles fewer",
      "Each of the Entity's waves brings 1 more Hollowed",
    ]);
  });
});

describe('the scene plays the Vigil’s entry beat', () => {
  it('BattleScene shows getVigilEntryEntries once a run (vigil_entry) on a Vigil map with no boss', () => {
    // A source pin: the battle's opening is one long async create; the beat must sit beside the
    // boss lines (after the boss card, before the first turn), behind the run's once-gate.
    const src = readFileSync(new URL('../src/scenes/BattleScene.js', import.meta.url), 'utf8');
    const at = src.indexOf("'vigil_entry'");
    expect(at).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, at - 600), at);
    expect(before).toMatch(/else if \(this\.battleConfig\?\.vigil && this\.runManager\)/);
    expect(before).toMatch(/_showStoryDialogueOnce\(\s*$/);
    expect(src.slice(at, at + 200)).toMatch(/getVigilEntryEntries\(\)/);
    expect(src.indexOf("'lieutenant_vision'")).toBeLessThan(at);
  });
});
