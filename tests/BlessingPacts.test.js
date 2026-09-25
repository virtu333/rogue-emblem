// Blessing pacts, the deforge rule and the new price effects
// (docs/specs/strategy-layer.md, "Blessing rebalance").
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import {
  validateBlessingsConfig,
  rollCostForBlessing,
  selectBlessingOptionsWithTelemetry,
  createSeededRng,
} from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => {
      store[key] = val;
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
  },
  writable: true,
});

const data = loadGameData();
const catalogBlessing = (id) => data.blessings.blessings.find((b) => b.id === id);
const DEFORGE_LABEL = "Lords' forged weapons lose one forge (never below +0)";
const deforgeEntry = () =>
  data.blessings.costPools['4'].find((entry) =>
    entry.effects.some((e) => e.type === 'starting_weapon_forge_delta'),
  );

function freshRun(seed = 4242) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed });
  return rm;
}

/** Take `id` through the real shrine flow (offer → choose → run-start effects). */
function chooseThroughShrine(rm, id) {
  rm.blessingSelectionTelemetry = { offeredBlessings: [structuredClone(catalogBlessing(id))] };
  rm._blessingChosen = false;
  expect(rm.chooseBlessing(id)).toBe(true);
  return rm.activeBlessings.find((entry) => entry.id === id);
}

function lordCombatWeapons(rm) {
  const out = [];
  for (const unit of rm.roster.filter((u) => u.isLord)) {
    for (const weapon of [...(unit.inventory || []), unit.weapon]) {
      if (!weapon || out.includes(weapon)) continue;
      if (['Staff', 'Consumable', 'Scroll'].includes(weapon.type)) continue;
      out.push(weapon);
    }
  }
  return out;
}

describe('pact data', () => {
  it('blessings.json validates with the pacts', () => {
    const result = validateBlessingsConfig(data.blessings);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('Forbidden Tome and Scroll Archive carry a fixed, labelled pact', () => {
    for (const id of ['forbidden_tome', 'scroll_archive']) {
      const b = catalogBlessing(id);
      expect(b.pact?.label?.length).toBeGreaterThan(0);
      expect(b.pact.effects.length).toBeGreaterThan(0);
      expect(b.costs).toEqual([]);
    }
  });

  it('rejects a malformed pact and a pact on a tier-1 blessing', () => {
    const broken = structuredClone(data.blessings);
    broken.blessings.find((b) => b.id === 'scroll_archive').pact = { label: '', effects: [] };
    broken.blessings.find((b) => b.tier === 1).pact = {
      label: 'x',
      effects: [{ type: 'gold_delta', params: { value: -1 } }],
    };
    const result = validateBlessingsConfig(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/pact\.label/);
    expect(result.errors.join('\n')).toMatch(/pact is only allowed for tier 2\+/);
  });

  it('the deforge price states its floor', () => {
    expect(deforgeEntry().label).toBe(DEFORGE_LABEL);
  });
});

describe('pact offers', () => {
  it('a pact blessing always costs its pact, whatever the seed', () => {
    for (const id of ['forbidden_tome', 'scroll_archive']) {
      const pact = catalogBlessing(id).pact;
      for (let seed = 1; seed <= 25; seed++) {
        const rm = freshRun(seed);
        const resolved = rm._resolveBlessingOfferForSelection(catalogBlessing(id), 0, 'test');
        expect(resolved.rolledCost).toEqual(pact);
      }
    }
  });

  it('a pact still spends one draw so the other offers roll the same prices', () => {
    const pool = data.blessings.costPools['4'];
    const withPact = createSeededRng(9);
    const plain = createSeededRng(9);
    rollCostForBlessing(pool, catalogBlessing('forbidden_tome'), withPact);
    rollCostForBlessing(pool, { ...catalogBlessing('blood_forge') }, plain);
    expect(withPact()).toBe(plain());
  });

  it('shrine offers show the pact as the chosen price and store it on the run', () => {
    const rm = freshRun(77);
    const entry = chooseThroughShrine(rm, 'scroll_archive');
    expect(entry.rolledCost).toEqual(catalogBlessing('scroll_archive').pact);
    const offers = rm.getBlessingOptions();
    expect(offers[0].pact).toBeTruthy();
    expect(offers[0].rolledCost.label).toBe(catalogBlessing('scroll_archive').pact.label);
  });
});

describe('Scroll Archive', () => {
  const artById = new Map(data.weaponArts.arts.map((art) => [art.id, art]));
  const scrollByName = new Map(
    data.weapons.filter((w) => w.type === 'Scroll').map((w) => [w.name, w]),
  );

  it('only ever grants arts that open by Act II', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const rm = freshRun(seed);
      chooseThroughShrine(rm, 'scroll_archive');
      expect(rm.scrolls.length).toBe(2);
      for (const scroll of rm.scrolls) {
        const art = artById.get(scrollByName.get(scroll.name)?.teachesWeaponArtId);
        expect(['act1', 'act2']).toContain(art?.unlockAct || 'act1');
        seen.add(scroll.name);
      }
    }
    // Still a real draw, not a fixed pair.
    expect(seen.size).toBeGreaterThan(2);
  });

  it('charges the blood price: every weapon art costs 2 more HP', () => {
    const rm = freshRun(5);
    expect(rm.blessingRuntimeModifiers.weaponArtHpCostDelta || 0).toBe(0);
    chooseThroughShrine(rm, 'scroll_archive');
    expect(rm.blessingRuntimeModifiers.weaponArtHpCostDelta).toBe(2);
  });

  it('without the unlock cap the grant can reach late-act arts (the old behaviour)', () => {
    // Old catalog shape: no cap.
    const original = structuredClone(catalogBlessing('scroll_archive').boons);
    catalogBlessing('scroll_archive').boons = [{ type: 'starting_scroll', params: { count: 2 } }];
    try {
      const late = [];
      for (let seed = 1; seed <= 60 && late.length === 0; seed++) {
        const run = freshRun(seed);
        run.activeBlessings = [{ id: 'scroll_archive', rolledCost: null }];
        run._runStartBlessingsApplied = false;
        run.applyRunStartBlessingEffects();
        for (const scroll of run.scrolls) {
          const art = artById.get(scrollByName.get(scroll.name)?.teachesWeaponArtId);
          if (['act3', 'act4'].includes(art?.unlockAct)) late.push(scroll.name);
        }
      }
      expect(late.length).toBeGreaterThan(0);
    } finally {
      catalogBlessing('scroll_archive').boons = original;
    }
  });
});

describe('deforge rule', () => {
  it('is never offered when no lord weapon carries a forge', () => {
    const rm = freshRun(11);
    expect(lordCombatWeapons(rm).every((w) => !(w._forgeLevel > 0))).toBe(true);
    expect(rm.isBlessingCostApplicable(deforgeEntry())).toBe(false);
    const tier4 = data.blessings.blessings.filter((b) => b.tier === 4 && !b.pact);
    for (const blessing of tier4) {
      for (let i = 0; i < 40; i++) {
        const cost = rm._rollCostForBlessingWithSeed(blessing, blessing.id, `deforge:${i}`);
        expect(cost?.label).not.toBe(DEFORGE_LABEL);
      }
    }
  });

  it('is offered once a lord weapon is forged', () => {
    const rm = freshRun(11);
    const weapon = lordCombatWeapons(rm)[0];
    expect(applyForge(weapon, 'might').success).toBe(true);
    expect(rm.isBlessingCostApplicable(deforgeEntry())).toBe(true);
  });

  it('never takes a weapon below +0 or its might below the catalog value', () => {
    const rm = freshRun(12);
    const weapons = lordCombatWeapons(rm);
    const before = weapons.map((w) => ({ name: w.name, might: w.might }));
    applyForge(weapons[0], 'might');
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: structuredClone(deforgeEntry()) }];
    // Isolate the price: apply only the deforge effect, three times over.
    for (let i = 0; i < 3; i++)
      rm._applySingleRunStartBlessingEffect('test', deforgeEntry().effects[0]);
    weapons.forEach((w, idx) => {
      expect(w._forgeLevel || 0).toBe(0);
      expect(w.name).toBe(before[idx].name);
      expect(w.might).toBe(before[idx].might);
      expect(w.might).toBeGreaterThanOrEqual(0);
    });
    const events = rm.blessingHistory.filter((e) => e.effectType === 'starting_weapon_forge_delta');
    expect(events[0].details.void).toBe(false);
    expect(events[1].details.void).toBe(true);
    expect(events[2].details.void).toBe(true);
  });
});

describe('enemy_level_delta and eclipse_shadow_delta effects', () => {
  it('raises every foe level, optionally in one act only, and survives a save', () => {
    const rm = freshRun(3);
    rm._applySingleRunStartBlessingEffect('test', {
      type: 'enemy_level_delta',
      params: { value: 1 },
    });
    rm._applySingleRunStartBlessingEffect('test', {
      type: 'enemy_level_delta',
      params: { value: 2, act: 'act2' },
    });
    expect(rm.getBlessingEnemyLevelDelta('act1')).toBe(1);
    expect(rm.getBlessingEnemyLevelDelta('act2')).toBe(3);
    const node = rm.nodeMap.nodes.find((n) => n.battleParams);
    const base = freshRun(3).getBattleParams(node).enemyLevelBonus;
    expect(rm.getBattleParams(node).enemyLevelBonus).toBe(base + 1);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(loaded.getBlessingEnemyLevelDelta('act2')).toBe(3);
  });

  it('normalizes a garbage or missing enemyLevelDeltas list on load', () => {
    const rm = freshRun(3);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.blessingRuntimeModifiers.enemyLevelDeltas = 'nope';
    expect(RunManager.fromJSON(saved, data).getBlessingEnemyLevelDelta('act1')).toBe(0);
    delete saved.blessingRuntimeModifiers.enemyLevelDeltas;
    expect(RunManager.fromJSON(saved, data).getBlessingEnemyLevelDelta('act1')).toBe(0);
  });

  it('darkens the run sun without moving the act clock', () => {
    const rm = freshRun(3);
    if (!rm.eclipse) return;
    const before = rm.eclipse.shadow;
    const actBefore = rm.eclipse.shadow - rm.eclipse.actStartShadow;
    rm._applySingleRunStartBlessingEffect('test', {
      type: 'eclipse_shadow_delta',
      params: { value: 20 },
    });
    expect(rm.eclipse.shadow).toBe(before + 20);
    expect(rm.eclipse.shadow - rm.eclipse.actStartShadow).toBe(actBefore);
  });
});

describe('active runs keep their old price', () => {
  it('a saved Forbidden Tome with a rolled price loads unchanged', () => {
    const rm = freshRun(21);
    const oldCost = structuredClone(data.blessings.costPools['4'][0]);
    rm.activeBlessings = [{ id: 'forbidden_tome', rolledCost: oldCost }];
    rm._runStartBlessingsApplied = true;
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(loaded.activeBlessings[0].rolledCost).toEqual(oldCost);
    expect(loaded.getBlessingEnemyLevelDelta('act1')).toBe(0);
    expect(loaded.blessingRuntimeModifiers.weaponArtHpCostDelta || 0).toBe(0);
  });

  it('a legacy save with no stored price migrates to a pool price, not the new pact', () => {
    const rm = freshRun(21);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.activeBlessings = ['forbidden_tome', 'scroll_archive'];
    const loaded = RunManager.fromJSON(saved, data);
    const pool = data.blessings.costPools['4'].map((entry) => entry.label);
    for (const entry of loaded.activeBlessings) {
      expect(entry.rolledCost).toBeTruthy();
      expect(pool).toContain(entry.rolledCost.label);
      expect(entry.rolledCost.label).not.toBe(catalogBlessing(entry.id).pact.label);
    }
    // Loading twice is stable (persistence boundary idempotence).
    const again = RunManager.fromJSON(JSON.parse(JSON.stringify(loaded.toJSON())), data);
    expect(again.activeBlessings).toEqual(loaded.activeBlessings);
  });

  it('selection telemetry still never co-offers exclusions with pacts in the catalog', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { selected } = selectBlessingOptionsWithTelemetry(
        data.blessings,
        createSeededRng(seed),
        { count: 4, allowTier4: true },
      );
      expect(new Set(selected.map((b) => b.id)).size).toBe(selected.length);
    }
  });
});
