// The service cues, played through the real shop, church, arena and event pages (the journey
// harness's rendering-only presentation) and the roster sheet's and reward screen's handlers.
// Each test listens on the scene's audio manager and asks what a player hears.
//
// Ways this can fail: a purchase still clinks like a sale (or a sale like a purchase); a forge
// or a hire is silent; the church rings nothing, or rings at the Ruins; a refused action makes
// a sound; an event's turned page is silent; an equip that changed nothing (or was refused)
// plays the equip sound; a reroll plays its old confirm on top of the reveal's sparkle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { EventDriver } from './harness/EventDriver.js';
import { runWithEvents, soloEvent } from './eventKit.js';
import { MobileRosterSheet } from '../src/ui/MobileRosterSheet.js';
import { MobileRewards } from '../src/ui/MobileRewards.js';
import { ChurchMenu } from '../src/ui/ChurchMenu.js';
import { installFakeDom } from './helpers/fakeDom.js';

vi.mock('../src/ui/rewardReveal.js', async (importOriginal) => ({
  ...(await importOriginal()),
  playRewardReveal: () => ({ skip() {}, done: true }),
}));

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Every sound effect the scene asks for from now on. */
function listen(scene) {
  const played = [];
  // The manager's other calls (music for the service, stingers) are no-ops here.
  const audio = new Proxy(
    { playSFX: (key) => played.push(key), playStinger: async () => null },
    { get: (target, name) => target[name] ?? (name === 'then' ? undefined : () => undefined) },
  );
  const get = scene.registry.get;
  scene.registry.get = (key) => (key === 'audio' ? audio : get(key));
  return played;
}
const press = (label) => ({ type: 'press', label });
const confirm = (index = 0) => ({ type: 'confirm', index });

describe('the shop and the arena', () => {
  it('a purchase sounds like a purse; a sale keeps the gold clink', async () => {
    const d = new RunDriver(storage);
    const played = listen(d.scene);
    await d.step({ type: 'enter', service: 'shop' });
    await d.step(press(/^Buy ·/));
    await d.step(confirm(d.menu.child.options.choices.length - 1));
    expect(played).toEqual(['sfx_purchase']);
    await d.step(press('Sell'));
    await d.step(press(/^Sell ·/));
    await d.step(confirm());
    expect(played).toEqual(['sfx_purchase', 'sfx_gold']);
  });

  it('a forge is paid for with the purchase sound', async () => {
    const d = new RunDriver(storage);
    const played = listen(d.scene);
    await d.step({ type: 'enter', service: 'shop' });
    await d.step(press('Forge'));
    await d.step(press('Choose forge'));
    await d.step(confirm());
    expect(d.scene.shopForgesUsed).toBe(1);
    expect(played).toEqual(['sfx_purchase']);
  });

  it('a refused purchase makes no sound', () => {
    const d = new RunDriver(storage);
    const played = listen(d.scene);
    d.shop.handleShop(d.node('shop'));
    d.run.gold = 0;
    const entry = { type: 'weapon', item: structuredClone(d.run.roster[0].weapon), price: 100 };
    d.scene.shopBuyItems = [entry];
    d.menu.buy(entry);
    expect(d.menu.child.options.apply(d.run.roster[0]).ok).toBe(false);
    expect(played).toEqual([]);
  });

  it('hiring a mercenary is a purchase', async () => {
    const d = new RunDriver(storage);
    const played = listen(d.scene);
    await d.step({ type: 'enter', service: 'arena' });
    await d.step(press('Mercenary board'));
    const candidate = d.arena._mercCandidates[0].unit.name;
    const card = d.buttons().find((b) => b.textContent.startsWith(`${candidate} ·`));
    await d.step(press(card.textContent));
    await d.step(press('Confirm hire'));
    expect(d.arena._mercHired).toBe(true);
    expect(played).toEqual(['sfx_purchase']);
  });
});

describe('the church', () => {
  it('rings its bell over a heal and a promotion', async () => {
    const d = new RunDriver(storage);
    const played = listen(d.scene);
    await d.step({ type: 'enter', service: 'church' });
    await d.step(press('Heal all · Free'));
    expect(played).toEqual(['sfx_chime']);
    await d.step(press(/^Edric ·/));
    await d.step(confirm());
    expect(d.run.roster[0].tier).toBe('promoted');
    expect(played).toEqual(['sfx_chime', 'sfx_chime']);
  });

  it('the Ruins keep the heal sound (no church bell there)', () => {
    expect(ChurchMenu.prototype.serviceSfx.call({ scene: { _churchRuinsMode: true } })).toBe(
      'sfx_heal',
    );
    expect(ChurchMenu.prototype.serviceSfx.call({ scene: { _churchRuinsMode: false } })).toBe(
      'sfx_chime',
    );
  });
});

describe('event pages', () => {
  it('a committed choice turns the page', () => {
    const run = runWithEvents([soloEvent([{ type: 'gold', value: 10 }], { id: 'sfx_page_test' })]);
    const d = new EventDriver({ run, eventId: 'sfx_page_test' });
    d.open();
    const played = listen(d.scene);
    d.choose('go');
    expect(played).toEqual(['sfx_page']);
  });
});

describe('the roster sheet and the reward screen', () => {
  function sheet(run, played) {
    const card = { append: (node) => (card.button ||= node) };
    const self = {
      run,
      scene: {
        registry: { get: (key) => (key === 'audio' ? { playSFX: (k) => played.push(k) } : null) },
      },
      lesson: null,
      render: vi.fn(),
      persistNow: () => '',
      button: (label, action, reason = '') => ({
        label,
        action,
        disabled: !!reason,
        setAttribute() {},
      }),
    };
    return { self, card };
  }

  it('equipping a weapon from the bag plays the equip sound once; a refusal plays nothing', () => {
    const d = new RunDriver(storage);
    installFakeDom(vi); // the card's reason line is a DOM node
    const unit = d.run.roster[0];
    const spare = { ...structuredClone(unit.weapon), uid: 'sfx-spare' };
    unit.inventory.push(spare);
    const played = [];
    const { self, card } = sheet(d.run, played);
    MobileRosterSheet.prototype.action.call(self, card, 'Equip', unit, spare, 'equip');
    card.button.action();
    expect(unit.weapon).toBe(spare);
    expect(played).toEqual(['sfx_equip']);

    const staff = {
      ...structuredClone(d.data.weapons.find((w) => w.type === 'Staff')),
      uid: 'sfx-staff',
    };
    unit.inventory.push(staff);
    const refused = sheet(d.run, played);
    MobileRosterSheet.prototype.action.call(
      refused.self,
      refused.card,
      'Equip',
      unit,
      staff,
      'equip',
    );
    refused.card.button.action();
    expect(unit.weapon).toBe(spare);
    expect(played).toEqual(['sfx_equip']);
  });

  it('a reward reveal sparkles, and a reroll is that one sound (no confirm on top)', () => {
    const played = [];
    const scene = {
      registry: { get: (key) => (key === 'audio' ? { playSFX: (k) => played.push(k) } : null) },
    };
    const screen = {
      scene,
      overlayScene: scene,
      busy: false,
      child: null,
      notice: null,
      steps: [],
      visible: true,
      controller: { rerollRewards: () => ({ ok: true }), choices: [] },
      root: { contains: () => false, querySelector: () => null },
      render() {
        if (this.replayReveal) {
          this.replayReveal = false;
          MobileRewards.prototype.playReveal.call(this, { children: [] }, []);
        }
      },
    };
    MobileRewards.prototype.playReveal.call(screen, { children: [] }, []);
    expect(played).toEqual(['sfx_loot']);
    MobileRewards.prototype.reroll.call(screen);
    expect(played).toEqual(['sfx_loot', 'sfx_loot']);
  });
});
