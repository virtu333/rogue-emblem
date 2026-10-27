// The Wardrobe (docs/specs/lord-outfits.md): buying a lord's outfit with Valor, what unlocks it,
// what each lord wears, how it is saved, and the portrait and sprite resolvers that show it.
// Real MetaProgressionManager on the shipped data; each test names the failure it catches.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { readFileSync } from 'fs';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import {
  hasWonWithLord,
  LORD_OUTFIT_CATALOG,
  outfitPortraitId,
  validateLordOutfitsConfig,
} from '../src/engine/LordOutfits.js';
import { portraitIdForUnit } from '../src/ui/portraitArt.js';
import { tracedKeyFor } from '../src/ui/TracedSprites.js';
import { setWornOutfitSource } from '../src/ui/lordOutfitArt.js';
import { wardrobeRows } from '../src/ui/wardrobeModel.js';

const upgrades = JSON.parse(readFileSync('data/metaUpgrades.json', 'utf8'));
const lords = JSON.parse(readFileSync('data/lords.json', 'utf8'));
const KEY = 'emblem_rogue_slot_1_meta';
const PRICE = 6000;

const victory = (id, survivors) => ({
  v: 2,
  id,
  endedAt: 1,
  difficulty: 'normal',
  actsCleared: 4,
  roster: survivors.map((name) => ({ name, className: 'Lord', level: 10, isLord: true })),
  fallen: [],
});

function freshMeta(valor = 20000) {
  const meta = new MetaProgressionManager(upgrades, KEY);
  meta.addValor(valor);
  return meta;
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
});
afterEach(() => setWornOutfitSource(null));

describe('the catalog', () => {
  it('prices every outfit at 6,000 Valor, one per lord, each lord real (validator)', () => {
    expect(LORD_OUTFIT_CATALOG.price).toBe(PRICE);
    expect(validateLordOutfitsConfig(LORD_OUTFIT_CATALOG, lords)).toEqual([]);
    const byLord = LORD_OUTFIT_CATALOG.outfits.map((o) => o.lord).sort();
    expect(byLord).toEqual(lords.map((l) => l.name).sort());
  });

  it('refuses an outfit naming no lord, a duplicate id and a free price', () => {
    const bad = {
      price: 0,
      outfits: [
        { id: 'x', lord: 'Nobody', name: 'X', description: 'x' },
        { id: 'x', lord: 'Edric', name: 'Y', description: 'y' },
      ],
    };
    const errors = validateLordOutfitsConfig(bad, lords);
    expect(errors.some((e) => /price/.test(e))).toBe(true);
    expect(errors.some((e) => /not a lord/.test(e))).toBe(true);
    expect(errors.some((e) => /duplicate/.test(e))).toBe(true);
  });
});

describe('unlocking', () => {
  it('a lord needs a win with that lord alive; one who fell in the win does not count', () => {
    const meta = freshMeta();
    expect(meta.lordOutfitBlock('field_marshal')).toBe('locked');
    // Kira fell: she is not among the survivors of the won run.
    meta.recordRunEnd({ result: 'victory', victoryRecord: victory('run-a', ['Edric', 'Sera']) });
    expect(meta.lordOutfitBlock('field_marshal')).toBe('locked');
    expect(meta.lordOutfitBlock('hollow_sun_vestments')).toBe(null);
    meta.recordRunEnd({ result: 'victory', victoryRecord: victory('run-b', ['Kira']) });
    expect(meta.lordOutfitBlock('field_marshal')).toBe(null);
  });

  it('a defeat unlocks nothing', () => {
    const meta = freshMeta();
    meta.recordRunEnd({ result: 'defeat', victoryRecord: victory('run-a', ['Kira']) });
    expect(meta.lordOutfitBlock('field_marshal')).toBe('locked');
  });

  it('Edric unlocks after any win, even one he was not in', () => {
    const meta = freshMeta();
    expect(meta.lordOutfitBlock('ashen_crown')).toBe('locked');
    meta.recordRunEnd({ result: 'victory', victoryRecord: victory('run-a', ['Kira', 'Sera']) });
    expect(meta.lordOutfitBlock('ashen_crown')).toBe(null);
  });

  it('the unlock outlives the victory record it came from (records age out)', () => {
    const meta = freshMeta();
    meta.recordRunEnd({ result: 'victory', victoryRecord: victory('run-a', ['Voss']) });
    meta.runRecords = [];
    expect(meta.lordOutfitBlock('winter_ranger')).toBe(null);
  });

  it('an older save whose only proof is a victory record still unlocks', () => {
    expect(
      hasWonWithLord('Cael', { milestones: new Set(), runRecords: [victory('r', ['Cael'])] }),
    ).toBe(true);
    expect(
      hasWonWithLord('Cael', { milestones: new Set(), runRecords: [victory('r', ['Rowan'])] }),
    ).toBe(false);
    // A recruit who shares no lord's name never stands in for one: only lords count.
    const recruit = { ...victory('r', []), roster: [{ name: 'Cael', isLord: false }] };
    expect(hasWonWithLord('Cael', { milestones: new Set(), runRecords: [recruit] })).toBe(false);
  });
});

describe('buying and wearing', () => {
  function unlocked(valor) {
    const meta = freshMeta(valor);
    meta.recordRunEnd({ result: 'victory', victoryRecord: victory('run-a', ['Edric', 'Kira']) });
    return meta;
  }

  it('spends exactly 6,000 Valor once, owns it and wears it', () => {
    const meta = unlocked(7000);
    expect(meta.buyLordOutfit('field_marshal')).toEqual({ ok: true });
    expect(meta.getTotalValor()).toBe(1000);
    expect(meta.getLordOutfits()).toEqual({
      owned: ['field_marshal'],
      worn: { Kira: 'field_marshal' },
    });
    expect(meta.buyLordOutfit('field_marshal')).toEqual({ ok: false, reason: 'owned' });
    expect(meta.getTotalValor()).toBe(1000);
  });

  it('refuses a buy short of Valor and spends nothing', () => {
    const meta = unlocked(5999);
    expect(meta.buyLordOutfit('field_marshal')).toEqual({ ok: false, reason: 'valor' });
    expect(meta.getTotalValor()).toBe(5999);
    expect(meta.ownsLordOutfit('field_marshal')).toBe(false);
  });

  it('a failed write spends nothing and owns nothing', () => {
    const meta = unlocked(7000);
    const setItem = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(meta.buyLordOutfit('field_marshal').ok).toBe(false);
    } finally {
      globalThis.localStorage.setItem = setItem;
    }
    expect(meta.getTotalValor()).toBe(7000);
    expect(meta.getLordOutfits()).toEqual({ owned: [], worn: {} });
  });

  it('a stale copy never pays twice for what the other copy bought', () => {
    const a = unlocked(13000);
    const b = new MetaProgressionManager(upgrades, KEY); // same slot, read before A buys
    expect(a.buyLordOutfit('field_marshal').ok).toBe(true);
    expect(b.buyLordOutfit('field_marshal')).toEqual({ ok: false, reason: 'owned' });
    expect(b.getTotalValor()).toBe(7000);
  });

  it('switches between the outfit and the own look; an unowned outfit cannot be worn', () => {
    const meta = unlocked(7000);
    expect(meta.setLordOutfit('Kira', 'field_marshal')).toEqual({ ok: false, reason: 'not_owned' });
    meta.buyLordOutfit('field_marshal');
    expect(meta.setLordOutfit('Kira', null).ok).toBe(true);
    expect(meta.wornLordOutfit('Kira')).toBe(null);
    expect(meta.setLordOutfit('Edric', 'field_marshal')).toEqual({ ok: false, reason: 'unknown' });
    expect(meta.setLordOutfit('Kira', 'field_marshal').ok).toBe(true);
    expect(meta.wornLordOutfit('Kira')).toBe('field_marshal');
  });

  it('ownership and the choice survive a reload; an outfit worn but not owned is dropped', () => {
    const meta = unlocked(7000);
    meta.buyLordOutfit('field_marshal');
    const reloaded = new MetaProgressionManager(upgrades, KEY);
    expect(reloaded.getLordOutfits()).toEqual({
      owned: ['field_marshal'],
      worn: { Kira: 'field_marshal' },
    });
    // A hand-edited or corrupted save wearing an outfit it never bought.
    const saved = JSON.parse(store[KEY]);
    saved.lordOutfitsWorn = { Kira: 'field_marshal', Edric: 'ashen_crown', Voss: 'nonsense' };
    store[KEY] = JSON.stringify(saved);
    expect(new MetaProgressionManager(upgrades, KEY).getLordOutfits().worn).toEqual({
      Kira: 'field_marshal',
    });
  });

  it('ownership rides inside purchasedUpgrades, which an older build copies whole', () => {
    const meta = unlocked(7000);
    meta.buyLordOutfit('field_marshal');
    const saved = JSON.parse(store[KEY]);
    expect(saved.purchasedUpgrades.lord_outfit_field_marshal).toBe(1);
  });

  it('no refund path touches an outfit', () => {
    const meta = unlocked(7000);
    meta.buyLordOutfit('field_marshal');
    expect(meta.canRefund('lord_outfit_field_marshal').success).toBe(false);
  });
});

describe('what the screens show', () => {
  const kira = (tier) => ({
    name: 'Kira',
    isLord: true,
    faction: 'player',
    tier,
    className: 'Lord',
  });

  it('a worn outfit is the portrait, and only for the lord wearing it', () => {
    setWornOutfitSource((name) => (name === 'Kira' ? 'field_marshal' : null));
    expect(portraitIdForUnit(kira())).toBe(outfitPortraitId('Kira', 'field_marshal'));
    expect(portraitIdForUnit({ name: 'Edric', isLord: true, faction: 'player' })).toBe(
      'lord_edric',
    );
  });

  it('a promoted lord without the promoted drawing keeps the outfit, never the old look', () => {
    setWornOutfitSource(() => 'field_marshal');
    expect(portraitIdForUnit(kira('promoted'))).toBe('lord_kira__field_marshal');
  });

  it("no outfit, no source, or a foe of the same name: the lord's own portrait", () => {
    expect(portraitIdForUnit(kira())).toBe('lord_kira');
    setWornOutfitSource(() => 'field_marshal');
    expect(portraitIdForUnit({ ...kira(), faction: 'enemy' })).not.toMatch(/__field_marshal/);
  });

  it("the map sprite falls back to the lord's own figure until the outfit has one", () => {
    setWornOutfitSource(() => 'field_marshal');
    const sprites = { lord_kira: {}, lord_kira__field_marshal: {} };
    expect(tracedKeyFor(kira(), sprites)).toBe('lord_kira__field_marshal');
    expect(tracedKeyFor(kira(), { lord_kira: {} })).toBe('lord_kira');
  });

  it('the Wardrobe lists met lords only, with what blocks each', () => {
    const meta = freshMeta(1000);
    const rows = wardrobeRows(meta, lords, LORD_OUTFIT_CATALOG);
    expect(rows.map((r) => r.lord).sort()).toEqual(['Edric', 'Sera']);
    expect(rows.find((r) => r.lord === 'Sera').blockText).toBe(
      'Win a run with Sera alive to unlock.',
    );
    meta.recordRunEnd({ result: 'victory', victoryRecord: victory('run-a', ['Sera']) });
    const sera = wardrobeRows(meta, lords, LORD_OUTFIT_CATALOG).find((r) => r.lord === 'Sera');
    expect(sera.blockText).toBe('Needs 6,000 Valor (you have 1,000 Valor).');
  });
});
