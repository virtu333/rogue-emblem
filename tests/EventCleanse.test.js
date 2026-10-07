// Cleanse, the third church vow (docs/specs/event-nodes-phase2.md §2B): a church lifts one
// burden of the player's choice, beside Promotion and Blessing, and the choice is its vow.
//
// Ways this goes wrong:
//   - Debt is offered, or lifted by a call that skips the menu (the lender has lawyers);
//   - Wounded is offered, and spends the church's one vow on what the same church's free Heal all
//     already ends (so a player who takes it can no longer bless, promote or lift anything else);
//   - it is offered at the Ruins' sanctuary, in the prologue, or with no burden to lift;
//   - it does not commit the vow (a second cleanse, a promotion or a blessing at the same church
//     slips through), or commits it when nothing was lifted;
//   - the vow does not survive a save, or an old save with only the two older vows breaks;
//   - the menu shows it where it must not, or lets a vowed church offer it live.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import {
  churchBlessingBlock,
  churchBlessingOffers,
  churchCleanseBlock,
  churchOffersCleanse,
  churchVow,
  cleanseAtChurch,
  takeChurchBlessing,
} from '../src/engine/ChurchVow.js';
import { cleansableBurdens, isCleansable } from '../src/engine/Burdens.js';
import { CHURCH_VOWS } from '../src/utils/constants.js';
import { baseData, newRun } from './eventKit.js';

const OMEN = { id: 'ill_omen', battles: 2, extraShadow: 1 };
const DEBT = { id: 'debt', owed: 300, garnish: 0.5 };
const WOUNDED = {
  id: 'wounded',
  unitUid: 'ru1',
  unitName: 'Edric',
  stat: 'STR',
  value: -2,
  battles: 3,
};
const HUNTED = {
  id: 'hunted',
  battles: 2,
  wave: { turn: 3, count: [2, 2], xpMultiplier: 0.5 },
};

/** A run standing at a church node (and a ruins node) with the given burdens. */
function churchRun(burdens) {
  const run = newRun({ seed: 77 });
  run.gold = 99999;
  const free = run.nodeMap.nodes.filter((n) => n.type === 'battle' && !n.completed);
  const church = free[0];
  church.type = 'church';
  church.battleParams = null;
  const other = free[1];
  other.type = 'church';
  other.battleParams = null;
  const ruins = free[2];
  ruins.type = 'ruins';
  ruins.battleParams = null;
  run.burdens = structuredClone(burdens);
  return { run, church: church.id, other: other.id, ruins: ruins.id };
}

describe('what a church can lift', () => {
  it('every burden but Debt and Wounded (Heal all mends a wound)', () => {
    expect(CHURCH_VOWS).toEqual(['promote', 'blessing', 'cleanse']);
    expect(isCleansable(OMEN)).toBe(true);
    expect(isCleansable(HUNTED)).toBe(true);
    expect(isCleansable({ id: 'sworn_enemy' })).toBe(true);
    expect(isCleansable(WOUNDED)).toBe(false);
    expect(isCleansable(DEBT)).toBe(false);
    const { run } = churchRun([DEBT, WOUNDED, OMEN]);
    expect(cleansableBurdens(run).map((b) => b.id)).toEqual(['ill_omen']);
  });

  it('a wound is not cleansable at a church: no offer, a refusal that names Heal all, no vow spent', () => {
    const { run, church } = churchRun([WOUNDED]);
    // Wounded is the only burden: there is nothing to cleanse
    expect(churchOffersCleanse(run, church)).toBe(false);
    expect(churchCleanseBlock(run, church, 'wounded')).toBe(
      'Heal all mends a lingering injury. It needs no vow.',
    );
    expect(cleanseAtChurch(run, church, 'wounded')).toEqual({
      ok: false,
      reason: 'Heal all mends a lingering injury. It needs no vow.',
    });
    expect(run.burdens).toEqual([WOUNDED]);
    expect(churchVow(run, church)).toBeNull();
    // With another burden the church still offers Cleanse, for that burden only
    run.burdens = [WOUNDED, OMEN];
    expect(churchOffersCleanse(run, church)).toBe(true);
  });

  it('is offered only at a church, with a burden it can lift, outside the prologue', () => {
    const { run, church, ruins } = churchRun([OMEN]);
    expect(churchOffersCleanse(run, church)).toBe(true);
    expect(churchOffersCleanse(run, ruins)).toBe(false);
    expect(churchOffersCleanse(run, 'no_such_node')).toBe(false);
    expect(churchCleanseBlock(run, ruins, 'ill_omen')).toBe('Only a church can cleanse.');
    run.burdens = [];
    expect(churchOffersCleanse(run, church)).toBe(false);
    run.burdens = [DEBT];
    expect(churchOffersCleanse(run, church)).toBe(false);
    expect(churchCleanseBlock(run, church, 'debt')).toMatch(/lawyers/);
    expect(cleanseAtChurch(run, church, 'debt')).toMatchObject({ ok: false });
    expect(run.burdens).toEqual([DEBT]);

    const prologue = new RunManager(baseData, null);
    prologue.startPrologue(baseData, baseData.prologue);
    prologue.burdens = [OMEN];
    const chapel = prologue.nodeMap.nodes.find((n) => n.type === 'church');
    expect(churchOffersCleanse(prologue, chapel.id)).toBe(false);
    expect(cleanseAtChurch(prologue, chapel.id, 'ill_omen').ok).toBe(false);
    expect(prologue.burdens).toEqual([OMEN]);
  });
});

describe("cleansing is the church's vow", () => {
  it('lifts the chosen burden only, makes the vow, and closes the other sides here', () => {
    const { run, church, other } = churchRun([OMEN, HUNTED, DEBT]);
    const result = cleanseAtChurch(run, church, 'hunted');
    expect(result).toMatchObject({ ok: true, message: 'Hunted lifted.' });
    expect(run.burdens).toEqual([OMEN, DEBT]);
    expect(churchVow(run, church)).toBe('cleanse');
    // This altar gives nothing more...
    expect(cleanseAtChurch(run, church, 'ill_omen').ok).toBe(false);
    expect(churchCleanseBlock(run, church, 'ill_omen')).toBe(
      'This altar has already cleansed you.',
    );
    const offer = churchBlessingOffers(run, church, baseData)[0];
    expect(churchBlessingBlock(run, church, offer.id, baseData)).toMatch(
      /Cleansing: this altar promotes no one/,
    );
    expect(takeChurchBlessing(run, church, offer.id, baseData).ok).toBe(false);
    expect(run.burdens).toEqual([OMEN, DEBT]);
    // ...and another church is its own vow.
    expect(churchCleanseBlock(run, other, 'ill_omen')).toBe('');
  });

  it('a blessing or a promotion made here first closes the cleansing, with the reason', () => {
    const { run, church } = churchRun([OMEN]);
    const offer = churchBlessingOffers(run, church, baseData)[0];
    expect(takeChurchBlessing(run, church, offer.id, baseData).ok).toBe(true);
    expect(churchCleanseBlock(run, church, 'ill_omen')).toMatch(
      /Blessing: this altar promotes no one/,
    );
    expect(cleanseAtChurch(run, church, 'ill_omen').ok).toBe(false);
    expect(run.burdens).toEqual([OMEN]);
    run.churchVowByNodeId = { [church]: 'promote' };
    expect(churchCleanseBlock(run, church, 'ill_omen')).toMatch(/Promotion/);
  });

  it('a burden the run does not hold changes nothing and makes no vow', () => {
    const { run, church } = churchRun([OMEN]);
    expect(cleanseAtChurch(run, church, 'hunted')).toEqual({
      ok: false,
      reason: 'That burden is not on you.',
    });
    expect(churchVow(run, church)).toBeNull();
    expect(run.burdens).toEqual([OMEN]);
  });

  it('the vow is saved; a save with only the older vows loads as it was', () => {
    const { run, church, other } = churchRun([OMEN]);
    cleanseAtChurch(run, church, 'ill_omen');
    run.churchVowByNodeId[other] = 'blessing';
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);
    expect(loaded.churchVowByNodeId).toEqual({ [church]: 'cleanse', [other]: 'blessing' });
    // A literal record from before the third vow, plus an unknown one from a later build.
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    saved.churchVowByNodeId = { a: 'promote', b: 'blessing', c: 'sacrifice' };
    expect(RunManager.fromJSON(saved, run.gameData).churchVowByNodeId).toEqual({
      a: 'promote',
      b: 'blessing',
    });
  });
});

describe('the church menu', () => {
  let d;
  beforeEach(() => {
    const storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { activeElement: null });
    d = new RunDriver(storage);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const labels = () => d.buttons().map((b) => b.textContent);
  const body = () =>
    d.church.nativeMenu.surface.body
      .all()
      .map((n) => n.textContent)
      .join(' | ');

  it('offers no Cleanse with no burden, or with only Debt (which it says it will not lift)', () => {
    d.enter('church');
    expect(body()).not.toContain('Cleanse');
    d.back();
    d.run.burdens = [structuredClone(DEBT)];
    d.enter('church');
    expect(body()).not.toContain('Cleanse');
  });

  it("lists each burden a church can lift, with Debt's refusal, and lifts the chosen one", () => {
    d.run.burdens = [structuredClone(OMEN), structuredClone(DEBT), structuredClone(HUNTED)];
    d.enter('church');
    expect(body()).toContain('Cleanse · Free');
    expect(body()).toContain('The lender has lawyers: no altar lifts a Debt.');
    expect(body()).toContain('lift a burden: one vow per church');
    expect(labels()).toEqual(expect.arrayContaining(['Ill Omen · 2 left', 'Hunted · 2 left']));
    // Debt is listed, greyed, and never pressable: the altar will not lift it.
    const debt = d.buttons().find((b) => b.textContent.startsWith('Debt'));
    expect(debt.disabled).toBe(true);
    expect(debt.dataset.burden).toBe('debt');
    // Each burden a church can lift has its words under its row.
    expect(body()).toContain(
      'Each victory gathers more shadow until the omen passes. 2 battles left, +1 shadow each.',
    );

    d.press('Hunted · 2 left');
    expect(d.church.nativeMenu.child.options.confirmation).toBe(true);
    // Backing out lifts nothing.
    d.back();
    expect(d.run.burdens).toHaveLength(3);
    d.press('Hunted · 2 left');
    const result = d.confirm(0);
    expect(result.ok).toBe(true);
    expect(d.run.burdens.map((b) => b.id)).toEqual(['ill_omen', 'debt']);
    expect(churchVow(d.run, d.node('church').id)).toBe('cleanse');
    d.assertPersisted('cleanse');
    expect(loadRun(d.data, 1).burdens.map((b) => b.id)).toEqual(['ill_omen', 'debt']);
    // The vow is made: no second cleanse is offered, and the vow line says so.
    expect(body()).toContain('Hunted lifted.');
    expect(body()).toContain('Your vow here was Cleansing');
    expect(labels().some((l) => l.startsWith('Ill Omen'))).toBe(false);
  });

  const wound = () => {
    const unit = d.run.roster[0];
    return { ...structuredClone(WOUNDED), unitUid: unit.unitUid, unitName: unit.name };
  };

  it('a wound alone shows no Cleanse; the church says Heal all mends it, free, and the vow stays open', () => {
    d.run.burdens = [wound()];
    d.enter('church');
    expect(body()).not.toContain('Cleanse');
    expect(body()).toContain(`Heal all also mends ${d.run.roster[0].name}'s lingering injury.`);
    expect(labels().some((l) => l.startsWith('Lingering Injury'))).toBe(false);
    const gold = d.run.gold;
    d.press('Heal all · Free');
    expect(d.run.burdens).toEqual([]);
    expect(d.run.gold).toBe(gold);
    expect(churchVow(d.run, d.node('church').id)).toBeNull(); // no vow spent on the wound
    expect(body()).toContain('lingering injury mends');
  });

  it('with a wound and another burden the list holds the other only, and Heal all keeps the vow free for it', () => {
    d.run.burdens = [wound(), structuredClone(OMEN)];
    d.enter('church');
    expect(body()).toContain('Cleanse · Free');
    expect(labels()).toContain('Ill Omen · 2 left');
    expect(labels().some((l) => l.startsWith('Lingering Injury'))).toBe(false);
    d.press('Heal all · Free');
    expect(d.run.burdens.map((b) => b.id)).toEqual(['ill_omen']);
    d.press('Ill Omen · 2 left');
    expect(d.confirm(0).ok).toBe(true);
    expect(d.run.burdens).toEqual([]);
    expect(churchVow(d.run, d.node('church').id)).toBe('cleanse');
  });

  it('after a blessing at this church the cleansing stays closed, with the reason', () => {
    d.run.burdens = [structuredClone(OMEN)];
    d.run.churchVowByNodeId = { [d.node('church').id]: 'blessing' };
    d.enter('church');
    const button = d.buttons().find((b) => b.textContent === 'Ill Omen · 2 left');
    expect(button.disabled).toBe(true);
    expect(body()).toContain('Your vow here was a Blessing');
  });

  it("the Ruins' sanctuary offers no Cleanse at all", () => {
    d.run.burdens = [structuredClone(OMEN)];
    const node = d.node('church');
    node.type = 'ruins';
    node.battleParams = null;
    d.scene.handleRuins = (n) => d.church.handleRuins(n);
    d.run.currentNodeId = node.id;
    d.church.handleRuins(node);
    d.service = 'church';
    expect(body()).not.toContain('Cleanse');
    d.press(/^Rest/);
    d.confirm(0);
    expect(body()).not.toContain('Cleanse');
    expect(d.run.burdens).toEqual([OMEN]);
  });
});
