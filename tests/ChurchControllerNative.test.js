import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { loadRun } from '../src/engine/RunManager.js';
import { twistPriceOf } from '../src/engine/EarnedBlessings.js';
import { addBurden } from '../src/engine/Burdens.js';
// The unit sheet is a DOM view; record how the church opens it.
vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));
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
it('Church uses one native surface, replacing it without completing the visit', async () => {
  await d.step({ type: 'enter', service: 'church' });
  const controller = d.church;
  const first = controller.nativeMenu.surface;
  controller.showChurchOverlay(d.node('church'));
  expect(first.destroyed).toBe(true);
  expect(controller.nativeMenu.surface.destroyed).not.toBe(true);
  expect(d.node('church').completed).toBe(false);
  controller.destroy();
  expect(d.scene.churchOverlay).toBeNull();
  expect(d.node('church').completed).toBe(false);
});
// The Ruins: Rest OR Scavenge (RuinsCommands). The route's church node plays
// the ruins here; the scene's shop/ruins hand-offs are the controllers' own.
function openRuins() {
  const node = d.node('church');
  node.type = 'ruins';
  node.battleParams = null;
  d.scene.handleShop = (n, o) => d.shop.handleShop(n, o);
  d.scene.handleRuins = (n) => d.church.handleRuins(n);
  d.run.currentNodeId = node.id; // NodeMapScene.onNodeClick commits it first
  d.church.handleRuins(node);
  d.service = 'church';
  return node;
}
const labels = () => d.buttons().map((b) => b.textContent);
const bodyText = () =>
  d.church.nativeMenu.surface.body
    .all()
    .map((n) => n.textContent)
    .join(' | ');
const REST = 'Rest — heal everyone, revive the fallen';
const SCAVENGE = "Scavenge — the ruins' wares (+25%)";
const savedChoice = (id) => loadRun(d.data, 1).ruinsChoiceByNodeId[id] ?? null;

it('Ruins before a choice offers only the two paths; backing out chooses nothing', () => {
  const node = openRuins();
  expect(labels()).toEqual(expect.arrayContaining([REST, SCAVENGE, 'View map', 'Roster']));
  for (const hidden of ['Heal all · Free', 'Browse wares']) expect(labels()).not.toContain(hidden);
  expect(labels().some((l) => /Revive|^Promote/.test(l))).toBe(false);
  for (const path of [REST, SCAVENGE]) {
    d.press(path);
    const options = d.church.nativeMenu.child.options;
    expect(options.confirmation).toBe(true);
    d.back();
    expect(d.church.nativeMenu.child).toBeNull();
  }
  expect(d.run.ruinsChoiceByNodeId).toEqual({});
  expect(savedChoice(node.id)).toBeNull();
  expect(d.scene.shopOverlay).toBeFalsy();
  expect(node.completed).toBe(false);
});

it('Scavenge commits, opens the wares, and leave, re-entry and reload never offer rest', () => {
  const node = openRuins();
  expect(d.run.roster[0].currentHP).toBe(1);
  d.press(SCAVENGE);
  expect(d.confirm(0).ok).toBe(true);
  // Saved the moment it was chosen.
  expect(savedChoice(node.id)).toBe('scavenge');
  d.assertPersisted('ruins scavenge');
  expect(d.scene.churchOverlay).toBeNull();
  expect(d.scene._currentShopIsRuins).toBe(true);
  expect(d.run.roster[0].currentHP).toBe(1);
  // Buy from the wares.
  const vulnerary = structuredClone(d.data.consumables.find((i) => i.name === 'Vulnerary'));
  const entry = { type: 'consumable', item: vulnerary, price: 100 };
  d.scene.shopBuyItems = [entry];
  const gold = d.run.gold;
  d.shop.nativeMenu.buy(entry);
  expect(d.shop.nativeMenu.child.options.apply(d.run.roster[0]).ok).toBe(true);
  d.shop.nativeMenu.child.close();
  expect(d.run.gold).toBe(gold - 100);
  // 'Return to ruins' goes back to the sanctuary: the wares only.
  d.shop.nativeMenu.surface.onClose();
  expect(d.scene.shopOverlay).toBeNull();
  expect(labels()).toContain('Browse wares');
  expect(labels()).not.toContain('Heal all · Free');
  expect(labels()).not.toContain(REST);
  expect(labels().some((l) => /Revive/.test(l))).toBe(false);
  expect(bodyText()).toContain('You chose to scavenge here. No rest tonight.');
  d.church.nativeMenu.surface.onClose();
  expect(d.run.canReenterService(node.id)).toBe(true);
  d.service = null;
  d.reload();
  d.scene.handleShop = (n, o) => d.shop.handleShop(n, o);
  d.scene.handleRuins = (n) => d.church.handleRuins(n);
  d.church.handleRuins(d.node('church'));
  d.service = 'church';
  expect(labels()).toContain('Browse wares');
  expect(labels()).not.toContain('Heal all · Free');
  expect(labels()).not.toContain(REST);
  expect(d.run.roster[0].currentHP).toBe(1);
  expect(d.run.gold).toBe(gold - 100);
  d.press('Browse wares');
  expect(d.scene._currentShopIsRuins).toBe(true);
});

it('Rest heals at once and revives; the wares stay closed after reload', () => {
  const node = openRuins();
  d.press(REST);
  expect(d.confirm(0).ok).toBe(true);
  expect(d.run.roster.every((u) => u.currentHP === u.stats.HP)).toBe(true);
  const saved = loadRun(d.data, 1);
  expect(saved.ruinsChoiceByNodeId[node.id]).toBe('rest');
  expect(saved.roster.every((u) => u.currentHP === u.stats.HP)).toBe(true);
  d.assertPersisted('ruins rest');
  expect(labels()).toContain('Heal all · Free');
  expect(labels()).not.toContain('Browse wares');
  expect(labels()).not.toContain(SCAVENGE);
  expect(labels().some((l) => /^Promote/.test(l))).toBe(false);
  expect(bodyText()).toContain('You chose to rest here. The wares stay buried.');
  // Journey Fallen: a level 1 Fighter, 500 + 1 × 300 gold.
  const gold = d.run.gold;
  d.press(/^Journey Fallen · Fighter · Revive 800 G$/);
  expect(d.confirm(0).ok).toBe(true);
  expect(d.run.gold).toBe(gold - 800);
  expect(d.run.roster.some((u) => u.name === 'Journey Fallen')).toBe(true);
  d.run.roster[0].currentHP = 1;
  d.press('Heal all · Free');
  expect(d.run.roster[0].currentHP).toBe(d.run.roster[0].stats.HP);
  d.church.nativeMenu.surface.onClose();
  d.service = null;
  d.reload();
  d.scene.handleRuins = (n) => d.church.handleRuins(n);
  // The wares refuse to open: the sanctuary (rest side) opens instead.
  d.shop.handleShop(d.node('church'), { ruins: true });
  d.service = 'church';
  expect(d.scene.shopOverlay).toBeFalsy();
  expect(d.run.getShopState(node.id)).toBeNull();
  expect(labels()).toContain('Heal all · Free');
  expect(labels()).not.toContain('Browse wares');
});

it('the map view, a reopened sanctuary and a stale picker never reopen the choice', () => {
  const node = openRuins();
  d.press(SCAVENGE);
  const stale = d.church.nativeMenu.child.options;
  d.back();
  d.press(REST);
  d.confirm(0);
  const menu = d.church.nativeMenu;
  menu.setVisible(false);
  menu.setVisible(true);
  expect(labels()).not.toContain(REST);
  expect(labels()).not.toContain(SCAVENGE);
  expect(labels()).not.toContain('Browse wares');
  d.church.showChurchOverlay(d.node('church'), { ruinsMode: true });
  expect(labels()).toContain('Heal all · Free');
  expect(labels()).not.toContain('Browse wares');
  // The Scavenge picker opened before the choice cannot apply a second path.
  expect(stale.blocked('scavenge')).toBe('You chose to rest here. The wares stay buried.');
  expect(stale.apply('scavenge').ok).toBe(false);
  expect(savedChoice(node.id)).toBe('rest');
  expect(d.scene.shopOverlay).toBeFalsy();
});

it('native map-view visibility keeps status and restores the same visit', async () => {
  await d.step({ type: 'enter', service: 'church' });
  const menu = d.church.nativeMenu;
  menu.render('Retained notice');
  menu.setVisible(false);
  expect(menu.surface).toBeNull();
  menu.setVisible(true);
  expect(menu.surface.body.all().some((n) => n.textContent === 'Retained notice')).toBe(true);
  expect(d.node('church').completed).toBe(false);
});

it('church re-entry preserves promotion and Kindle use after a save round trip', () => {
  const node = d.node('church');
  d.run.currentNodeId = node.id;
  d.run.setChurchPromotionCount(node.id, 1);
  d.run.eclipse = { ...d.run.eclipse, shadow: 12, actShadow: 10 };
  const kindle = d.run.kindleSun(node.id);
  expect(kindle.ok).toBe(true);
  d.church.handleChurch(node);
  d.church.leaveChurchNode();
  expect(d.run.canReenterService(node.id)).toBe(true);
  d.run = d.run.constructor.fromJSON(d.run.toJSON(), d.data);
  d.bindScene();
  const gold = d.run.gold;
  d.church.handleChurch(d.node('church'));
  expect(d.scene._churchPromotionsThisVisit).toBe(1);
  expect(d.run.getChurchPromotionCount(node.id)).toBe(1);
  expect(d.run.kindleSun(node.id).ok).toBe(false);
  expect(d.run.gold).toBe(gold);
  d.run.currentNodeId = 'next';
  expect(d.run.canReenterService(node.id)).toBe(false);
});

// Playtest (Sep 2026): a fallen ally's details could not be seen before paying to
// revive them, and they came back unarmed (death sends their gear to the convoy).
it('a fallen ally shows their details and comes back with an Iron weapon', async () => {
  await d.step({ type: 'enter', service: 'church' });
  const fallen = d.run.fallenUnits[0];
  fallen.inventory = [];
  fallen.weapon = null;
  d.press("Journey Fallen's details");
  const sheet = d.church.nativeMenu.child;
  expect(sheet.run).toBeNull();
  expect(sheet.units[sheet.index]).toBe(fallen);
  sheet.onClose();
  expect(d.church.nativeMenu.child).toBeNull();

  d.press(/^Journey Fallen · Fighter · Revive/);
  expect(d.church.nativeMenu.child.options.describe()).toContain(
    'Comes back carrying an Iron Axe.',
  );
  const result = d.confirm(0);
  expect(result.ok).toBe(true);
  expect(result.message).toContain('Carries an Iron Axe.');
  const revived = d.run.roster.find((u) => u.name === 'Journey Fallen');
  expect(revived.weapon?.name).toBe('Iron Axe');
  expect(revived.inventory[0]).toBe(revived.weapon);
  const saved = loadRun(d.data, 1).roster.find((u) => u.name === 'Journey Fallen');
  expect(saved.weapon?.name).toBe('Iron Axe');
});

// Review (blessings v3 D3): a twisted blessing's burden held alone used to leave the church
// silent (the section returned before its refusal rows, since nothing could be lifted).
it("a twist's burden held alone is still listed at the altar, greyed, with the refusal", async () => {
  const card = (id) => d.data.blessings.blessings.find((b) => b.id === id);
  for (const id of ['blood_covenant', 'hollow_sun_favor'])
    expect(d.run.addBlessingMidRun(id, { earned: true, price: twistPriceOf(card(id)) }), id).toBe(
      true,
    );
  expect(d.run.burdens.map((b) => b.id)).toEqual(['ill_omen', 'hunted']);
  d.enter('church'); // the run was changed by hand above: no persistence boundary to check
  const nodes = d.church.nativeMenu.surface.body.all();
  expect(nodes.some((n) => n.tag === 'h3' && n.textContent === 'Cleanse')).toBe(true);
  const refusals = nodes.filter((n) => String(n.className).includes('church-cleanse-twist'));
  expect(refusals.map((n) => n.textContent)).toEqual([
    "A twisted blessing's price: no altar lifts it.",
    "A twisted blessing's price: no altar lifts it.",
  ]);
  const rows = d.buttons().filter((b) => String(b.className).includes('church-cleanse'));
  expect(rows.map((b) => b.textContent)).toEqual([
    'Ill Omen · Never ends',
    'Hunted · Until Act III',
  ]);
  expect(rows.every((b) => b.disabled)).toBe(true);
});

it("on a merged record the altar lifts the passing part only and lists the twist's beside it", async () => {
  const card = d.data.blessings.blessings.find((b) => b.id === 'blood_covenant');
  d.run.addBlessingMidRun('blood_covenant', { earned: true, price: twistPriceOf(card) });
  addBurden(d.run, 'ill_omen', { battles: 2, extraShadow: 2 });
  d.enter('church'); // the run was changed by hand above: no persistence boundary to check
  const nodes = d.church.nativeMenu.surface.body.all();
  expect(nodes.some((n) => n.tag === 'h3' && n.textContent === 'Cleanse · Free')).toBe(true);
  const rows = d.buttons().filter((b) => String(b.className).includes('church-cleanse'));
  expect(rows.map((b) => [b.textContent, b.disabled])).toEqual([
    ['Ill Omen · 2 left', false],
    ['Ill Omen · Never ends', true],
  ]);
  d.press('Ill Omen · 2 left');
  const result = d.confirm(0);
  expect(result.ok, result.reason).toBe(true);
  expect(d.run.burdens).toEqual([{ id: 'ill_omen', battles: 0, extraShadow: 1, permanent: true }]);
  expect(loadRun(d.data, 1).burdens).toEqual(d.run.burdens);
});

it("Kingmaker's Oath: the church's path chooser is handed the run, so its paths show the +2", () => {
  const card = d.data.blessings.blessings.find((b) => b.id === 'kingmakers_oath');
  d.run.addBlessingMidRun('kingmakers_oath', { earned: true, price: twistPriceOf(card) });
  d.enter('church');
  const unit = d.run.roster[0];
  d.press(new RegExp(`^${unit.name} · ${unit.className} · Lv`));
  const chooser = d.church.nativeMenu.child;
  expect(chooser.options.churchRun).toBe(d.run);
  expect(chooser.options.note).toMatch(/^Free \(Kingmaker's Oath\)/);
});
