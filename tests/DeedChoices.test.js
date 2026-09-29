// Deeds the player chooses (playtest 2026-09-28): the title a unit goes by, the one
// Oath it swears at promotion, and the Compendium listing only the deeds earned.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { createUnit, resolvePromotionTargets } from '../src/engine/UnitManager.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import { RunManager } from '../src/engine/RunManager.js';
import {
  TITLE_NONE,
  chooseTitle,
  commitBattleDeeds,
  emptyBattleDeeds,
  normalizeUnitDeeds,
  pledgeOath,
  promotionOath,
  promotionOathCandidates,
  unitEpithet,
} from '../src/engine/DeedSystem.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { earnedDeedIdsAcrossSlots, getMetaKey, getRunKey } from '../src/engine/SlotManager.js';
import { deedReferenceEntries } from '../src/ui/deedReference.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { PromotionPathChooser } from '../src/ui/PromotionPathChooser.js';

const data = loadGameData();
const fighterClass = data.classes.find((c) => c.name === 'Fighter');
let key = 0;
function earn(unit, battle) {
  unit._battleDeeds = { ...emptyBattleDeeds(), ...battle };
  commitBattleDeeds([unit], data.deeds, { battleKey: `choice:${++key}` });
  return unit;
}
// Held the Line (prestige 4, Oath: Shieldwall) and Keen Edge (prestige 2, Oath: Keen Eye).
const bridgeAndCrits = { heldPhases: 3, heldPlaces: ['Bridge', 'Bridge', 'Bridge'], crits: 3 };
const veteran = () =>
  earn(createUnit(fighterClass, 10, data.weapons, { name: 'Garr' }), bridgeAndCrits);
const reload = (unit) => normalizeUnitDeeds(structuredClone(serializeUnit(unit)));

describe('the title a unit goes by', () => {
  it('defaults to the greatest deed; the player may pick another, none, or go back', () => {
    const unit = veteran();
    expect(unit.deeds.earned.map((e) => e.id).sort()).toEqual(['held_the_line', 'keen_edge']);
    expect(unitEpithet(unit).text).toBe('Who Held the Bridge');

    expect(chooseTitle(unit, 'keen_edge')).toBe(true);
    expect(unitEpithet(unit).text).toBe('the Keen Edge');
    // The choice is saved with the unit and survives a load.
    expect(unitEpithet(reload(unit)).text).toBe('the Keen Edge');

    expect(chooseTitle(unit, TITLE_NONE)).toBe(true);
    expect(unitEpithet(unit)).toBeNull();
    expect(unitEpithet(reload(unit))).toBeNull();

    expect(chooseTitle(unit, null)).toBe(true);
    expect(unitEpithet(unit).text).toBe('Who Held the Bridge');
    expect(chooseTitle(unit, null)).toBe(false); // already automatic
  });

  it('refuses a deed the unit has not earned, and drops a stale choice on load', () => {
    const unit = veteran();
    expect(chooseTitle(unit, 'bossbane')).toBe(false);
    expect(unitEpithet(unit).text).toBe('Who Held the Bridge');
    const saved = structuredClone(serializeUnit(unit));
    saved.deeds.chosenTitle = 'bossbane';
    expect(unitEpithet(normalizeUnitDeeds(saved)).text).toBe('Who Held the Bridge');
    expect(saved.deeds.chosenTitle).toBeUndefined();
  });

  it('a greater deed earned later does not replace the chosen title', () => {
    const unit = veteran();
    chooseTitle(unit, 'keen_edge');
    earn(unit, { bossKills: 1, bossNames: ['Knight Commander'] });
    expect(unit.deeds.earned.some((e) => e.id === 'bossbane')).toBe(true);
    expect(unitEpithet(unit).text).toBe('the Keen Edge');
    // Back on automatic, the new greatest deed shows.
    chooseTitle(unit, null);
    expect(unitEpithet(unit).text).toBe('Bane of the Knight Commander');
  });
});

describe('the one Oath, chosen by the player', () => {
  it('lists every Oath open to the unit, the greatest first', () => {
    const unit = veteran();
    expect(promotionOathCandidates(unit, data.deeds, data.skills).map((o) => o.skillId)).toEqual([
      'pavise',
      'crit_plus_15',
    ]);
  });

  it('a pledged deed swears on promotion instead of the greatest, then the pledge is spent', () => {
    const run = new RunManager(data);
    run.gold = 99999;
    const unit = veteran();
    run.roster = [unit];
    expect(pledgeOath(unit, 'keen_edge')).toBe(true);
    expect(promotionOath(unit, data.deeds, data.skills).skillId).toBe('crit_plus_15');
    // The pledge is saved with the unit.
    expect(promotionOath(reload(unit), data.deeds, data.skills).skillId).toBe('crit_plus_15');
    const target = resolvePromotionTargets(unit, data.classes, data.lords)[0];
    const result = promoteAtChurch(run, unit, 'church', target, data);
    expect(result.message).toContain('Oath of the Edge');
    expect(unit.skills).toContain('crit_plus_15');
    expect(unit.skills).not.toContain('pavise');
    expect(unit.deeds.oath).toMatchObject({ deedId: 'keen_edge', skillId: 'crit_plus_15' });
    expect(unit.deeds.pledge).toBeUndefined();
    // One Oath, ever.
    expect(promotionOathCandidates(unit, data.deeds, data.skills)).toEqual([]);
    expect(pledgeOath(unit, 'held_the_line')).toBe(false);
  });

  it('refuses a deed the unit has not earned; clearing returns to the greatest', () => {
    const unit = veteran();
    expect(pledgeOath(unit, 'bossbane')).toBe(false);
    pledgeOath(unit, 'keen_edge');
    expect(pledgeOath(unit, null)).toBe(true);
    expect(promotionOath(unit, data.deeds, data.skills).skillId).toBe('pavise');
  });
});

const chooserScene = () => ({
  events: { once() {}, off() {} },
  textures: { exists: () => false, get: () => null },
  registry: { get: () => null },
});

describe('the promotion chooser asks which Oath', () => {
  let dom;
  beforeEach(() => {
    dom = installFakeDom(vi);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('picking an Oath pledges it and every path card shows it', () => {
    const unit = veteran();
    const targets = resolvePromotionTargets(unit, data.classes, data.lords);
    const chooser = new PromotionPathChooser({
      scene: chooserScene(),
      unit,
      targets,
      gameData: data,
    });
    const options = () => dom.doc.querySelectorAll('.gr-oath-option');
    expect(options().map((b) => b.textContent)).toEqual([
      'Oath of the Bridge · Shieldwall',
      'Oath of the Edge · Keen Eye',
    ]);
    expect(options()[0].getAttribute('aria-pressed')).toBe('true');
    options()[1].click();
    expect(unit.deeds.pledge).toBe('keen_edge');
    // The order stays put; the pressed one moves.
    expect(options().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    const cards = dom.doc.querySelectorAll('.gr-path-oath');
    expect(cards).toHaveLength(targets.length);
    for (const card of cards) expect(card.textContent).toContain('Oath of the Edge · Keen Eye');
    // Only a preview: nothing is learned until the promotion is confirmed.
    expect(unit.skills).not.toContain('crit_plus_15');
    chooser.destroy();
  });

  it('a path whose class already has the pledged skill swears the other Oath, and says so', () => {
    const unit = earn(
      createUnit(
        data.classes.find((c) => c.name === 'Myrmidon'),
        10,
        data.weapons,
        { name: 'Ayla' },
      ),
      bridgeAndCrits,
    );
    pledgeOath(unit, 'keen_edge');
    const targets = resolvePromotionTargets(unit, data.classes, data.lords);
    const swordmaster = targets.find((c) => c.name === 'Swordmaster');
    const chooser = new PromotionPathChooser({ scene: chooserScene(), unit, targets, gameData: data }); // prettier-ignore
    expect(chooser.contents.get(swordmaster).oath.skillId).toBe('pavise');
    chooser.selected = swordmaster;
    chooser.render();
    expect(dom.doc.querySelectorAll('.gr-oath-option')).toHaveLength(0);
    expect(dom.doc.querySelector('.gr-oath-note').textContent).toBe(
      'A Swordmaster already has Keen Eye, so this path swears Oath of the Bridge.',
    );
    chooser.selected = targets.find((c) => c.name === 'Duelist');
    chooser.render();
    expect(dom.doc.querySelector('.gr-oath-note')).toBeNull();
    const pressed = dom.doc
      .querySelectorAll('.gr-oath-option')
      .filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((b) => b.textContent)).toEqual(['Oath of the Edge · Keen Eye']);
    chooser.destroy();
  });

  it('with a single Oath there is nothing to choose', () => {
    const unit = earn(createUnit(fighterClass, 10, data.weapons, { name: 'Bo' }), {
      heldPhases: 3,
      heldPlaces: ['Bridge', 'Bridge', 'Bridge'],
    });
    const targets = resolvePromotionTargets(unit, data.classes, data.lords);
    const chooser = new PromotionPathChooser({
      scene: chooserScene(),
      unit,
      targets,
      gameData: data,
    });
    expect(dom.doc.querySelectorAll('.gr-oath-option')).toHaveLength(0);
    chooser.destroy();
  });
});

describe('the Compendium lists only deeds earned', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      key: (i) => [...store.keys()][i] ?? null,
      get length() {
        return store.size;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a save remembers the deeds its army earned, across reloads', () => {
    const meta = new MetaProgressionManager(data.metaUpgrades, getMetaKey(1));
    meta.recordDeedsEarned(['keen_edge', 'held_the_line', 'keen_edge']);
    const again = new MetaProgressionManager(data.metaUpgrades, getMetaKey(1));
    expect(again.deedsEarned).toEqual(['held_the_line', 'keen_edge']);
    expect(again.hasEarnedDeed('bossbane')).toBe(false);
  });

  it('reads every slot, and the deeds on a run from before the record', () => {
    store.set(getMetaKey(1), JSON.stringify({ deedsEarned: ['mender'] }));
    const unit = veteran();
    store.set(
      getRunKey(3),
      JSON.stringify({ roster: [serializeUnit(unit)], fallenUnits: [{ deeds: { earned: [{ id: 'avenger' }] } }] }), // prettier-ignore
    );
    expect([...earnedDeedIdsAcrossSlots()].sort()).toEqual([
      'avenger',
      'held_the_line',
      'keen_edge',
      'mender',
    ]);
  });

  it('shows an earned deed in full and only a count of the rest', () => {
    const entries = deedReferenceEntries(data, new Set(['held_the_line']));
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('Held the Line');
    expect(entries[0].referenceLines[0]).toBe('Title: Who Held the Line · ★★★★');
    expect(entries[0].referenceLines[1]).toMatch(/^Oath: Shieldwall — /);
    const hidden = data.deeds.deeds.length - 1;
    expect(entries[1].name).toBe(`${hidden} more to find`);
    // No hidden deed leaks its name, title or story.
    const text = JSON.stringify(entries);
    for (const deed of data.deeds.deeds.filter((d) => d.id !== 'held_the_line'))
      expect(text, deed.id).not.toContain(deed.name);
    expect(deedReferenceEntries(data, [])[0].name).toBe(`${data.deeds.deeds.length} deeds to find`);
  });
});
