// Omens UI (omensModel.js, utils/omenChoice.js, the pause entry). Expectations come from
// difficulty.json's Omen entries, never from the code under test.
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  cycleOmen,
  cycleRank,
  heatLabel,
  omenRows,
  omensNote,
  omensSummary,
} from '../src/ui/omensModel.js';
import { pauseBurdenEntries } from '../src/ui/eventMenuModel.js';
import {
  OMEN_CHOICE_REGISTRY_KEY,
  readOmenChoice,
  writeOmenChoice,
} from '../src/utils/omenChoice.js';
import { getSlotOmensKey } from '../src/engine/SlotManager.js';

const data = loadGameData();
const list = data.difficulty.omens.list;
const first = list[0];
const multi = list.find((o) => o.ranks.length > 1);

describe('omensModel', () => {
  it('an Off row shows the lore and no heat; a ranked row shows that rank only', () => {
    // Failure: a ranked row shows rank 1's words or the cumulative heat of the ranks below.
    const off = omenRows(data, {}).find((r) => r.id === multi.id);
    expect(off).toMatchObject({ rank: 0, heat: 0, text: multi.lore, rankLabel: 'Off' });
    expect(off.nextHeat).toBe(multi.ranks[0].heat);
    const top = multi.ranks.length;
    const ranked = omenRows(data, { [multi.id]: top }).find((r) => r.id === multi.id);
    expect(ranked).toMatchObject({
      rank: top,
      heat: multi.ranks[top - 1].heat,
      text: multi.ranks[top - 1].text,
      nextHeat: null,
    });
    expect(omenRows(data, {})).toHaveLength(list.length);
  });

  it('cycling walks Off, 1 .. max, then Off, and drops rank 0 from the choice', () => {
    // Failure: the top rank overshoots the data or leaves a zero entry the engine ignores.
    const seen = [];
    let ranks = {};
    for (let i = 0; i <= multi.ranks.length; i++) {
      ranks = cycleOmen(data, ranks, multi.id);
      seen.push(ranks[multi.id] ?? 0);
    }
    expect(seen).toEqual([...multi.ranks.map((_, i) => i + 1), 0]);
    expect(Object.keys(ranks)).toEqual([]);
    expect(cycleRank(3, 3)).toBe(0);
    expect(cycleOmen(data, { x: 1 }, 'unknown')).toEqual({});
  });

  it('cycling keeps the other Omens and never mutates the input', () => {
    // Failure: raising one Omen clears or aliases another.
    const other = list.find((o) => o.id !== first.id);
    const before = { [other.id]: 1 };
    const after = cycleOmen(data, before, first.id);
    expect(after).toEqual({ [other.id]: 1, [first.id]: 1 });
    expect(before).toEqual({ [other.id]: 1 });
  });

  it("the label, summary and note add up the chosen ranks' heat", () => {
    // Failure: the footer's Heat disagrees with the heat the run will carry.
    const a = list[0];
    const b = list[1];
    const ranks = { [a.id]: 1, [b.id]: 1 };
    const heat = a.ranks[0].heat + b.ranks[0].heat;
    expect(heatLabel(heat)).toBe(`Omens: Heat ${heat}`);
    expect(omensSummary(data, ranks, 9)).toBe(`Heat ${heat} · Best: 9`);
    const note = omensNote(data, ranks);
    expect(note).toContain(`Heat ${heat}`);
    expect(note).toContain(a.name);
    expect(note).toContain(b.name);
    expect(omensNote(data, {})).toBe('');
  });
});

describe('pause list entry', () => {
  const start = (omens) => {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 7, applyBlessingsAtStart: false, difficultyId: 'lunatic', omens });
    return rm;
  };

  it("lists each chosen Omen with its rank text and the run's Heat", () => {
    // Failure: the pause menu hides what the run carries, or shows the wrong rank's words.
    const a = list[0];
    const b = list[1];
    const rm = start({ [a.id]: 1, [b.id]: 1 });
    const entry = pauseBurdenEntries(rm, data.events).find((e) => e.id === 'omens-heat');
    const heat = rm.omens.heat;
    // The pause menu shows `${label} · ${short}`: the Heat is named once.
    expect(`${entry.label} · ${entry.short}`).toBe(`Omens · Heat ${heat}`);
    expect(entry.short).toBe(`Heat ${heat}`);
    expect(entry.text).toBe(`${a.name}: ${a.ranks[0].text} ${b.name}: ${b.ranks[0].text}`);
  });

  it('a run without Omens has no entry', () => {
    // Failure: a "Heat 0" row on every ordinary run.
    expect(pauseBurdenEntries(start(null), data.events).some((e) => e.id === 'omens-heat')).toBe(
      false,
    );
  });
});

describe('remembered choice', () => {
  const memory = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
      map,
    };
  };
  const registry = (slot = 2) => {
    const map = new Map([['activeSlot', slot]]);
    return { get: (k) => map.get(k), set: (k, v) => map.set(k, v) };
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });

  it('round-trips per slot and an empty choice clears the key', () => {
    // Failure: slot 1's Omens leak into slot 2, or a cleared choice comes back.
    const storage = memory();
    writeOmenChoice(registry(1), { [first.id]: 2 }, { storage });
    expect(storage.map.has(getSlotOmensKey(1))).toBe(true);
    expect(readOmenChoice(registry(1), { storage })).toEqual({ [first.id]: 2 });
    expect(readOmenChoice(registry(2), { storage })).toEqual({});
    writeOmenChoice(registry(1), {}, { storage });
    expect(storage.map.size).toBe(0);
    expect(readOmenChoice(registry(1), { storage })).toEqual({});
  });

  it('garbage in storage reads as no choice', () => {
    // Failure: a corrupt value throws on the difficulty screen.
    const storage = memory();
    storage.setItem(getSlotOmensKey(2), '{nope');
    expect(readOmenChoice(registry(), { storage })).toEqual({});
    storage.setItem(getSlotOmensKey(2), JSON.stringify({ a: 0, b: 'x', c: 2 }));
    expect(readOmenChoice(registry(), { storage })).toEqual({ c: 2 });
  });

  it('a storage that throws falls back to the registry for the session', () => {
    // Failure: private mode loses the choice or throws out of the picker.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    const reg = registry();
    expect(() => writeOmenChoice(reg, { [first.id]: 1 })).not.toThrow();
    expect(reg.get(OMEN_CHOICE_REGISTRY_KEY)).toEqual({ 2: { [first.id]: 1 } });
    expect(readOmenChoice(reg)).toEqual({ [first.id]: 1 });
  });

  it('a refused write keeps the registry copy, and a later good write drops it', () => {
    // Failure: a stale registry copy shadows a cleared slot.
    const reg = registry();
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    writeOmenChoice(reg, { [first.id]: 1 }, { storage: refusing });
    expect(readOmenChoice(reg, { storage: refusing })).toEqual({ [first.id]: 1 });
    const storage = memory();
    writeOmenChoice(reg, {}, { storage });
    expect(readOmenChoice(reg, { storage })).toEqual({});
  });
});
