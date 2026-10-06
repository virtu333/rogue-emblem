import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  parseDevStartupConfig,
  buildDevStartupRoute,
  devRoutesEnabled,
} from '../src/utils/devStartup.js';

function createRegistry() {
  const store = new Map();
  return {
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
      return value;
    },
  };
}

describe('where dev routes run', () => {
  it('the dev server and deploy previews (VITE_DEV_ROUTES), never production', () => {
    expect(devRoutesEnabled({ DEV: true })).toBe(true);
    expect(devRoutesEnabled({ DEV: false, VITE_DEV_ROUTES: 'true' })).toBe(true);
    expect(devRoutesEnabled({ DEV: false })).toBe(false);
    expect(devRoutesEnabled({ DEV: false, VITE_DEV_ROUTES: 'false' })).toBe(false);
    expect(devRoutesEnabled({ DEV: false, VITE_DEV_ROUTES: '1' })).toBe(false);
  });
});

describe('dev startup helpers', () => {
  it('parses dev scene config from query string in dev mode', () => {
    const config = parseDevStartupConfig(
      '?devScene=battle&preset=battle_smoke&seed=123&devTools=1',
      { devMode: true },
    );
    expect(config).toEqual({
      enabled: true,
      sceneKey: 'Battle',
      preset: 'battle_smoke',
      seed: 123,
      difficultyId: 'normal',
      devTools: true,
      qaStep: null,
      qaDescription: null,
      nodeType: null,
    });
  });

  it('devNode=boss routes straight into the act boss battle (ceremony review)', () => {
    const config = parseDevStartupConfig('?devScene=battle&preset=late_act&seed=7&devNode=boss', {
      devMode: true,
    });
    expect(config.nodeType).toBe('boss');
    const route = buildDevStartupRoute(loadGameData(), createRegistry(), config);
    expect(route.key).toBe('Battle');
    expect(route.data.isBoss).toBe(true);
    expect(route.data.battleParams.objective).toBe('seize');
    expect(parseDevStartupConfig('?devScene=battle&devNode=shop', { devMode: true }).nodeType).toBe(
      null,
    );
  });

  it('devNode=recruit routes into a recruit battle with its previewed recruit', () => {
    const config = parseDevStartupConfig(
      '?devScene=battle&preset=battle_smoke&seed=42&devNode=recruit',
      { devMode: true },
    );
    expect(config.nodeType).toBe('recruit');
    const route = buildDevStartupRoute(loadGameData(), createRegistry(), config);
    expect(route.key).toBe('Battle');
    const node = route.data.runManager.nodeMap.nodes.find((n) => n.id === route.data.nodeId);
    expect(node.type).toBe('recruit');
    expect(route.data.battleParams.isRecruitBattle).toBe(true);
    expect(route.data.battleParams.recruitPreview?.className).toBeTruthy();
  });

  it('preset=event stands the party one click from an event (the event review route)', () => {
    const config = parseDevStartupConfig(
      '?devScene=nodemap&preset=event&seed=42&event=abandoned_armory',
      { devMode: true },
    );
    expect(config).toMatchObject({
      preset: 'event',
      event: 'abandoned_armory',
      sceneKey: 'NodeMap',
    });
    const registry = createRegistry();
    const route = buildDevStartupRoute(loadGameData(), registry, config);
    expect(route.key).toBe('NodeMap');
    const run = route.data.runManager;
    const event = run.nodeMap.nodes.find((n) => n.type === 'event');
    expect(event.row).toBeGreaterThanOrEqual(2);
    expect(event.battleParams).toBeNull();
    // The party stands on a completed node that leads to it: the event is one step on.
    expect(run.getAvailableNodes().map((n) => n.id)).toContain(event.id);
    expect(run.nodeMap.nodes.find((n) => n.id === run.currentNodeId).edges).toContain(event.id);
    expect(run.gold).toBeGreaterThanOrEqual(1000);
    // Only the named event (and the fallback) can be picked; its first-time note teaches.
    expect(run.gameData.events.events.map((e) => e.id).sort()).toEqual([
      'abandoned_armory',
      'quiet_road',
    ]);
    expect(registry.get('hints').hasSeen('guide_first_event')).toBe(false);
    // The same seed builds the same road.
    const again = buildDevStartupRoute(loadGameData(), createRegistry(), config).data.runManager;
    expect(again.nodeMap.nodes.find((n) => n.type === 'event').id).toBe(event.id);
    // Without &event=, the whole catalog stays.
    const open = buildDevStartupRoute(
      loadGameData(),
      createRegistry(),
      parseDevStartupConfig('?devScene=nodemap&preset=event&seed=42', { devMode: true }),
    ).data.runManager;
    expect(open.gameData.events.events.length).toBeGreaterThan(5);
  });

  it('ignores unknown scene aliases', () => {
    const config = parseDevStartupConfig('?devScene=unknown', { devMode: true });
    expect(config).toBeNull();
  });

  it('resolves qaStep without explicit scene', () => {
    const config = parseDevStartupConfig('?qaStep=4&devTools=1', { devMode: true });
    expect(config.sceneKey).toBe('NodeMap');
    expect(config.preset).toBe('weapon_arts');
    expect(config.qaStep).toBe(4);
    expect(config.devTools).toBe(true);
  });

  it('resolves new UI qaStep checkpoints', () => {
    const config = parseDevStartupConfig('?qaStep=10&devTools=1', { devMode: true });
    expect(config.sceneKey).toBe('Battle');
    expect(config.preset).toBe('battle_smoke');
    expect(config.qaStep).toBe(10);
    expect(config.devTools).toBe(true);
  });

  it('builds NodeMap route with weapon art preset state', () => {
    const gameData = loadGameData();
    const registry = createRegistry();
    const config = parseDevStartupConfig('?devScene=nodemap&preset=weapon_arts&seed=9&devTools=1', {
      devMode: true,
    });
    const route = buildDevStartupRoute(gameData, registry, config);

    expect(route.key).toBe('NodeMap');
    expect(route.data.runManager).toBeTruthy();
    expect(route.data.runManager.scrolls.length).toBeGreaterThan(0);
    expect(route.data.runManager.gold).toBeGreaterThan(0);
    expect(registry.get('devToolsEnabled')).toBe(true);
  });

  it('builds battle smoke route with node and roster payload', () => {
    const gameData = loadGameData();
    const registry = createRegistry();
    const config = parseDevStartupConfig('?devScene=battle&preset=battle_smoke&seed=42', {
      devMode: true,
    });
    const route = buildDevStartupRoute(gameData, registry, config);

    expect(route.key).toBe('Battle');
    expect(route.data.nodeId).toBeTruthy();
    expect(Array.isArray(route.data.roster)).toBe(true);
    expect(route.data.roster.length).toBeGreaterThan(0);
    expect(route.data.battleParams?.act).toBeTruthy();
  });

  it('builds late-act QA battle route from qaStep', () => {
    const gameData = loadGameData();
    const registry = createRegistry();
    const config = parseDevStartupConfig('?qaStep=7', { devMode: true });
    const route = buildDevStartupRoute(gameData, registry, config);

    expect(route.key).toBe('Battle');
    expect(config.qaStep).toBe(7);
    expect(route.data.battleParams).toBeTruthy();
    expect(route.data.runManager.currentAct).toBeTruthy();
  });
});

describe('combat action review preset', () => {
  it('uses real skills and weapons, deploys five units, and disconnects the save slot', () => {
    const gameData = loadGameData();
    const original = JSON.stringify(gameData);
    const registry = createRegistry();
    registry.set('activeSlot', 3);
    const config = parseDevStartupConfig('?devScene=battle&preset=combat_actions&seed=42', {
      devMode: true,
    });
    const route = buildDevStartupRoute(gameData, registry, config);
    expect(registry.get('activeSlot')).toBeNull();
    expect(route.data.battleParams.act).toBe('act2');
    expect(route.data.roster.map((u) => u.name)).toEqual([
      'Edric',
      'Sera',
      'Utility',
      'Support',
      'Patient',
    ]);
    for (const u of route.data.roster) {
      for (const skill of u.skills) expect(gameData.skills.some((s) => s.id === skill)).toBe(true);
      for (const weapon of u.inventory)
        expect(gameData.weapons.some((w) => w.name === weapon.name)).toBe(true);
    }
    expect(JSON.stringify(gameData)).toBe(original);
  });
  it('cannot be enabled in a production build', () => {
    expect(
      parseDevStartupConfig('?devScene=battle&preset=combat_actions', { devMode: false }),
    ).toBeNull();
  });
});

it('combat review ignores alternate saved lords without rewriting their selection', () => {
  const gameData = loadGameData();
  const registry = createRegistry();
  const effects = { startingLords: { commander: 'Sera', partner: 'Kira' }, commanderChoiceTier: 2 };
  registry.set('meta', { getActiveEffects: () => effects });
  const config = parseDevStartupConfig('?devScene=battle&preset=combat_actions&seed=42', {
    devMode: true,
  });
  const route = buildDevStartupRoute(gameData, registry, config);
  expect(route.data.roster.slice(0, 2).map((u) => u.name)).toEqual(['Edric', 'Sera']);
  expect(effects.startingLords).toEqual({ commander: 'Sera', partner: 'Kira' });
});

describe('phone review routes (deploy previews)', () => {
  const route = (query, registry = createRegistry()) =>
    buildDevStartupRoute(loadGameData(), registry, parseDevStartupConfig(query, { devMode: true }));

  it('fog_ambush: a foggy battle, Sera with Canto and staves, no save slot', () => {
    const registry = createRegistry();
    registry.set('activeSlot', 2);
    const r = route('?devScene=battle&preset=fog_ambush&seed=42', registry);
    expect(r.key).toBe('Battle');
    expect(r.data.battleParams).toMatchObject({ fogEnabled: true, devScenario: 'fog_ambush' });
    const sera = r.data.roster.find((u) => u.name === 'Sera');
    expect(sera.skills).toContain('canto');
    expect(sera.inventory.map((w) => w.name)).toContain('Rescue Staff');
    expect(registry.get('activeSlot')).toBeNull();
  });

  it('roster_checks: an Oath on the bench, one to meet the cap, Edric in a robe at 1 HP', () => {
    const registry = createRegistry();
    const r = route('?devScene=nodemap&preset=roster_checks&seed=1', registry);
    expect(r.key).toBe('NodeMap');
    const roster = r.data.runManager.roster;
    const bramwell = roster.find((u) => u.name === 'Bramwell');
    expect(bramwell.tier).toBe('promoted');
    expect(bramwell.deeds.oath).toMatchObject({ skillId: 'pavise' });
    expect(bramwell.benchedSkills).toContain('pavise');
    expect(bramwell.benchedUnseen).toContain('pavise');
    const corwin = roster.find((u) => u.name === 'Corwin');
    expect(corwin.skills).toHaveLength(5);
    expect(corwin.consumables.map((c) => c.name)).toEqual(['Master Seal']);
    const edric = roster.find((u) => u.name === 'Edric');
    expect(edric.accessory?.name).toBe('Seraph Robe');
    expect(edric.currentHP).toBe(1);
    expect(edric.consumables.map((c) => c.name)).toEqual(['Elixir', 'Vulnerary']);
    expect(registry.get('activeSlot')).toBeNull();
    // First-time lessons teach once, in memory (no slot): the skill bench's included.
    const hints = registry.get('hints');
    expect(hints.shouldShow('roster_skill_benched')).toBe(true);
    expect(hints.shouldShow('roster_skill_benched')).toBe(false);
    expect(hints.hasSeen('roster_skill_benched')).toBe(true);
    // Nothing else interrupts the review (the route map's own first-visit notes).
    expect(hints.shouldShow('nodemap_intro')).toBe(false);
    expect(hints.hasSeen('guide_prepare')).toBe(true);
  });

  it('roster_checks keeps a real save slot’s hints, and hints off stays off', () => {
    const kept = { shouldShow: () => false };
    const registry = createRegistry();
    registry.set('hints', kept);
    route('?devScene=nodemap&preset=roster_checks&seed=1', registry);
    expect(registry.get('hints')).toBe(kept);

    const off = createRegistry();
    off.set('settings', { getHints: () => false });
    route('?devScene=nodemap&preset=roster_checks&seed=1', off);
    expect(off.get('hints').shouldShow('roster_skill_benched')).toBe(false);
  });

  it('ladder: Dusk and Nightfall open on the difficulty screen', () => {
    const registry = createRegistry();
    const r = route('?devScene=difficulty&preset=ladder', registry);
    expect(r.key).toBe('DifficultySelect');
    const milestones = registry.get('meta').milestones;
    expect(milestones.has('beatGame')).toBe(true);
    expect(milestones.has('beatDusk')).toBe(true);
    expect(milestones.has('beatHard')).toBe(false);
  });

  it.each([
    ['lieutenant', 'normal', 'finalBoss'],
    ['emperor', 'dusk', 'act4'],
    ['entity', 'hard', 'finalBoss'],
  ])('victory&route=%s: a won %s run at its last act', (routeName, difficultyId, lastAct) => {
    const registry = createRegistry();
    registry.set('activeSlot', 1);
    const r = route(`?devScene=victory&route=${routeName}`, registry);
    expect(r.key).toBe('RunComplete');
    expect(r.data.result).toBe('victory');
    const rm = r.data.runManager;
    expect(rm.difficultyId).toBe(difficultyId);
    expect(rm.actSequence.at(-1)).toBe(lastAct);
    expect(rm.actIndex).toBe(rm.actSequence.length - 1);
    expect(registry.get('activeSlot')).toBeNull();
  });
});
