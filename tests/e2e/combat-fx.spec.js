// Combat v2: a real seeded combat per effect family at Normal, Fast and Instant, with
// reduced motion and with effects off. Presentation must never touch the battle RNG,
// leak effect objects, or leave a unit off its tile, tinted, scaled or mid-pose, even
// when a strike is cut short by a rewind or a scene shutdown.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

// [weapon, distance, striker flags]
const FAMILIES = [
  ['Iron Sword', 1],
  ['Iron Axe', 1],
  ['Iron Lance', 1],
  ['Iron Bow', 2],
  ['Longbow', 3],
  ['Fire', 2],
  ['Bolting', 3],
  ['Levin Sword', 2],
  ['Excalibur', 2],
  ['Shine', 2],
  ['Twisting Vortex', 2],
  ['Fire Breath', 1],
  ['Toxic Breath', 1],
  ['Ancient Breath', 2],
  ['Hand Axe', 2],
  ['Javelin', 2],
  ['Eldritch Grasp', 1, { isEntity: true }],
];
// [label, speed, reduceMotion, quality, atmosphere]
const CONFIGS = [
  ['normal', 'normal', false, 'high', 'full'],
  ['fast', 'fast', false, 'high', 'full'],
  ['instant', 'instant', false, 'high', 'full'],
  ['reduced', 'normal', true, 'high', 'full'],
  ['effects off', 'normal', true, 'low', 'off'],
];

async function boot(page, extra = '') {
  await page.goto(
    `/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1${extra}`,
  );
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
}

/**
 * In-page helpers (installed once per page): pin two units with fixed stats on fixed
 * tiles, run on the real battle RNG from a fixed seed, and read back the aftermath.
 */
async function installHelpers(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const STATS = { HP: 100, STR: 12, MAG: 12, SKL: 15, SPD: 10, DEF: 5, RES: 5, LCK: 0, MOV: 5 };
    const h = {
      apply(speed, motion, quality, atmosphere) {
        const settings = s.registry.get('settings');
        settings.setBattleSpeed(speed);
        settings.setReduceMotion(motion);
        settings.setEffectsQuality(quality);
        settings.setAtmosphere(atmosphere);
      },
      pin(distance, flags = {}) {
        const a = s.playerUnits.find((u) => u.weapon && u.weapon.type !== 'Staff');
        const b = s.enemyUnits[0];
        for (const unit of [a, b]) {
          unit.stats = { ...STATS };
          unit.currentHP = 100;
          unit.traits = [];
          unit.accessory = null;
          unit.affixes = [];
          unit._conditions = [];
          unit.skills = [];
          delete unit.isEntity;
        }
        Object.assign(a, flags);
        b.col = 6;
        b.row = 4;
        a.col = b.col - distance;
        a.row = b.row;
        for (const u of [a, b]) {
          const p = s.grid.gridToPixel(u.col, u.row);
          u.graphic.x = p.x;
          u.graphic.y = p.y;
          s.updateUnitPosition?.(u);
        }
        return [a, b];
      },
      pose: (u) => ({ x: u.graphic.x, y: u.graphic.y, sx: u.graphic.scaleX, sy: u.graphic.scaleY }),
      /** Swap in the real battle RNG at a fixed seed; returns a restore function. */
      seedBattleRng(seed) {
        const prev = { rng: s._battleRng, random: Math.random };
        s.reseedBattleRng(seed);
        return () => {
          s._battleRng = prev.rng;
          Math.random = prev.random;
        };
      },
      /** Lingering overlays and embers finish on their own; give them a moment. */
      async quiet() {
        const fx = s._combatFx;
        const t0 = performance.now();
        const busy = () => {
          const l = fx?.liveObjects || {};
          return l.strike || l.lingering || l.motes || l.tweens || l.timers || l.poses;
        };
        while (busy() && performance.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 50));
      },
      aftermath(units) {
        const fx = s._combatFx;
        const fxObjects = s.children.list.filter(
          (o) => o.texture?.key === 'fx_atlas' || String(o.texture?.key || '').startsWith('fx-'),
        );
        return {
          settled: units.map(h.pose),
          tinted: units.map((u) => Boolean(u.graphic.isTinted)),
          alpha: units.map((u) => u.graphic.alpha),
          frames: units.map((u) => u.graphic.frame?.name ?? null),
          homes: units.map((u) => u.graphic._fxHomeX ?? null),
          live: fx?.liveObjects || null,
          visibleFx: fxObjects.filter((o) => o.visible && o.alpha > 0).length,
          pooledFx: fxObjects.length,
        };
      },
    };
    window.__fxTest = h;
  });
}

/** One pinned, seeded combat; returns the outcome and the presentation's aftermath. */
async function runCombat(page, { weapon, distance, flags, config, index }) {
  return page.evaluate(
    async ({ weapon, distance, flags, config, index }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const h = window.__fxTest;
      h.apply(...config);
      const w = s.gameData.weapons.find((x) => x.name === weapon);
      const [a, b] = h.pin(distance, flags);
      // Alternate crits so both beats run; ranges cover every distance used.
      a.weapon = { ...structuredClone(w), crit: index % 2 ? 100 : 0, range: '1-10' };
      b.weapon = null;
      const home = [h.pose(a), h.pose(b)];
      if (s._procBanner) s._procBanner._lastCutInAt = -Infinity;
      s.battleState = 'COMBAT_RESOLVING';
      const restore = h.seedBattleRng(240);
      let resolved;
      let rngState;
      try {
        resolved = await s._runCombatResolution(
          a,
          b,
          s._prepareCombatContext(a, b, { isPlayerInitiator: true }),
        );
        rngState = s._battleRng.getState();
      } finally {
        restore();
      }
      s.battleState = 'PLAYER_IDLE';
      await h.quiet();
      return {
        result: resolved.result,
        rngState,
        hp: [a.currentHP, b.currentHP],
        home,
        ...h.aftermath([a, b]),
      };
    },
    { weapon, distance, flags, config, index },
  );
}

function expectClean(out, where) {
  expect(out.settled, where).toEqual(out.home);
  expect(out.tinted, where).toEqual(out.tinted.map(() => false));
  expect(out.alpha, where).toEqual(out.alpha.map(() => 1));
  for (const f of out.frames) expect(['windup', 'strike'], where).not.toContain(f);
  expect(out.homes, where).toEqual(out.homes.map(() => null));
  expect(out.live, where).toMatchObject({
    strike: 0,
    lingering: 0,
    motes: 0,
    tweens: 0,
    timers: 0,
    poses: 0,
    dissolves: 0,
  });
  expect(out.visibleFx, where).toBe(0);
  expect(out.pooledFx, where).toBeLessThanOrEqual(120);
}

// traced map sprites are the default (they carry the windup / strike pose frames); the
// rebuilt set is the dev comparison without pose frames
for (const [spriteLabel, extra] of [
  ['traced sprites', ''],
  ['rebuilt sprites', '&spriteArt=rebuilt'],
]) {
  test(`every weapon family: identical outcomes and battle RNG with effects on or off, no leaks (${spriteLabel})`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page, extra);
    await installHelpers(page);
    const families = extra ? FAMILIES.filter((_, i) => i % 3 === 0) : FAMILIES;
    let index = 0;
    for (const [weapon, distance, flags = {}] of families) {
      let reference = null;
      for (const [label, ...config] of CONFIGS) {
        const out = await runCombat(page, { weapon, distance, flags, config, index });
        const where = `${weapon} @${distance} ${label}`;
        expectClean(out, where);
        const comparable = { result: out.result, hp: out.hp, rngState: out.rngState };
        if (!reference) reference = comparable;
        expect(comparable, where).toEqual(reference);
      }
      index++;
    }
    expect(errors).toEqual([]);
  });
}

test('signatures, ballista bolts and staff heals draw nothing from the battle RNG and settle', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await installHelpers(page);
  const legendaryByType = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const catalog = s._getWeaponArtCatalog();
    const arts = (catalog?.arts || catalog || []).filter?.((a) => a.tierAffinity === 'Legendary');
    const out = {};
    for (const art of arts || []) if (!out[art.weaponType]) out[art.weaponType] = art.name;
    return out;
  });
  expect(Object.keys(legendaryByType).length).toBeGreaterThan(0);
  const ballistaStates = [];
  for (const [label, ...config] of CONFIGS) {
    // Legendary arts (signature + cut-in) for every weapon type that has one.
    for (const [type, artName] of Object.entries(legendaryByType)) {
      const out = await page.evaluate(
        async ({ config, type, artName }) => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          const h = window.__fxTest;
          h.apply(...config);
          const [a, b] = h.pin(type === 'Bow' || type === 'Tome' ? 2 : 1);
          const w = s.gameData.weapons.find((x) => x.type === type && x.type !== 'Staff');
          a.weapon = structuredClone(w);
          const home = [h.pose(a), h.pose(b)];
          if (s._procBanner) s._procBanner._lastCutInAt = -Infinity;
          const original = Math.random;
          let calls = 0;
          Math.random = () => {
            calls++;
            return original();
          };
          try {
            await s.animateStrike(
              {
                attacker: a.name,
                attackerSide: 'attacker',
                damage: 9,
                isCrit: false,
                miss: false,
                skillActivations: [{ id: 'weapon_art', name: artName }],
              },
              a,
              b,
              { strikeIndex: 0 },
            );
          } finally {
            Math.random = original;
          }
          await h.quiet();
          return { calls, home, ...h.aftermath([a, b]) };
        },
        { config, type, artName },
      );
      const where = `signature ${type} ${label}`;
      expectClean(out, where);
      expect(out.calls, where).toBe(0);
    }
    // A ballista bolt (real resolution on the battle RNG) and a staff heal.
    const out = await page.evaluate(async (config) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const h = window.__fxTest;
      h.apply(...config);
      const [a, b] = h.pin(1);
      const home = [h.pose(a), h.pose(b)];
      const saved = s.ballistas;
      s.ballistas = [{ col: a.col - 3, row: a.row, owner: 'enemy', captured: false }];
      const restore = h.seedBattleRng(77);
      let rngState;
      try {
        await s.processBallistaFire([a], 'enemy');
        rngState = s._battleRng.getState();
      } finally {
        restore();
        s.ballistas = saved;
      }
      a.currentHP = Math.max(1, a.currentHP);
      const original = Math.random;
      let calls = 0;
      Math.random = () => {
        calls++;
        return original();
      };
      try {
        await s.animateHeal(a, 7, b);
      } finally {
        Math.random = original;
      }
      await h.quiet();
      return { rngState, healCalls: calls, hp: a.currentHP, home, ...h.aftermath([a, b]) };
    }, config);
    expectClean(out, `ballista + heal ${label}`);
    expect(out.healCalls, `heal ${label}`).toBe(0);
    ballistaStates.push({ rng: out.rngState, hp: out.hp });
  }
  expect(new Set(ballistaStates.map((b) => JSON.stringify(b))).size).toBe(1);
  expect(errors).toEqual([]);
});

test('a strike cut short by a rewind or a shutdown stops cleanly', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  await installHelpers(page);
  for (const [weapon, distance, waitMs] of [
    ['Iron Sword', 1, 40],
    ['Iron Bow', 2, 90],
    ['Fire', 2, 110],
  ]) {
    const out = await page.evaluate(
      async ({ weapon, distance, waitMs }) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const h = window.__fxTest;
        h.apply('normal', false, 'high', 'full');
        const [a, b] = h.pin(distance);
        a.weapon = structuredClone(s.gameData.weapons.find((x) => x.name === weapon));
        a.weapon.range = '1-10';
        const home = [h.pose(a), h.pose(b)];
        s.battleState = 'COMBAT_RESOLVING';
        const run = s._runCombatResolution(
          a,
          b,
          s._prepareCombatContext(a, b, { isPlayerInitiator: true }),
        );
        // Wait for the strike to start (cut-ins and chips come first), then a beat more.
        const t0 = performance.now();
        const striking = () => {
          const l = s._combatFx?.liveObjects;
          return l && (l.strike > 0 || l.tweens > 0 || l.poses > 0);
        };
        while (!striking() && performance.now() - t0 < 3000)
          await new Promise((r) => setTimeout(r, 4));
        await new Promise((r) => setTimeout(r, waitMs));
        const mid = { x: a.graphic.x, live: { ...s._combatFx.liveObjects } };
        // What a vision rewind does first: drop the in-flight presentation.
        s._combatFx.reset();
        const created = s.children.list.length;
        await run;
        s.battleState = 'PLAYER_IDLE';
        await h.quiet();
        // This harness drops the presentation but (unlike a real rewind) lets the exchange
        // run on, so a later strike (the counter) still floats its own damage number. With
        // the traced default the reset lands mid-lunge, before the first contact, so that
        // number can still be fading here; let the self-destroying floaters finish before
        // counting what was left behind.
        // Bound the wait in game time (the frame deltas the tweens advance by), not wall
        // time: on a slow machine a floater's tween still runs well past 3 s of wall time.
        const floating = () => s.children.list.some((o) => o.type === 'Text' && o.depth === 300);
        let gameMs = 0;
        const onStep = (_time, delta) => (gameMs += delta);
        s.game.events.on('step', onStep);
        try {
          while (floating() && gameMs < 3000) await new Promise((r) => setTimeout(r, 50));
        } finally {
          s.game.events.off('step', onStep);
        }
        return { mid, created, after: s.children.list.length, home, ...h.aftermath([a, b]) };
      },
      { weapon, distance, waitMs },
    );
    const where = `${weapon} rewound mid-strike`;
    // It really was mid-strike, and nothing more was drawn after the reset. A held pose
    // counts: with the traced default the striker holds windup / strike from the start of
    // its lunge (whose own tween is the scene's, not a reaction tween) until finishStrike,
    // the same signal `striking()` waits for above.
    expect(out.mid.live.strike + out.mid.live.tweens + out.mid.live.poses, where).toBeGreaterThan(
      0,
    );
    expect(out.after, where).toBeLessThanOrEqual(out.created);
    expectClean(out, where);
  }
  // Shutdown mid-lunge: the strike stops, no controller is resurrected, no errors.
  const shut = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const h = window.__fxTest;
    const [a, b] = h.pin(1);
    s.battleState = 'COMBAT_RESOLVING';
    const run = s
      ._runCombatResolution(a, b, s._prepareCombatContext(a, b, { isPlayerInitiator: true }))
      .catch((e) => `rejected: ${e?.message}`);
    await new Promise((r) => setTimeout(r, 50));
    window.__emblemRogueGame.scene.stop('Battle');
    const settled = await Promise.race([
      run.then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('pending'), 3000)),
    ]);
    await new Promise((r) => setTimeout(r, 300));
    const fxObjects = s.children.list.filter(
      (o) => o.texture?.key === 'fx_atlas' || String(o.texture?.key || '').startsWith('fx-'),
    );
    const l = s._combatFx?.liveObjects || {};
    return {
      settled,
      fxObjects: fxObjects.length,
      live: (l.strike || 0) + (l.lingering || 0) + (l.motes || 0) + (l.dissolves || 0),
    };
  });
  // Nothing the strike would have drawn after the shutdown exists on the stopped scene.
  expect(shut.settled).toBe('settled');
  expect(shut.fxObjects).toBe(0);
  expect(shut.live).toBe(0);
  expect(errors).toEqual([]);
});

test('deaths fade to embers and leave nothing behind at every speed', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await boot(page);
  for (const style of [{}, { isBoss: true }, { isEntity: true }, { faction: 'player' }]) {
    const rngCalls = [];
    for (const [speed, motion] of [
      ['normal', false],
      ['fast', false],
      ['instant', false],
      ['normal', true],
    ]) {
      const out = await page.evaluate(
        async ({ speed, motion, style }) => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          const settings = s.registry.get('settings');
          settings.setBattleSpeed(speed);
          settings.setReduceMotion(motion);
          settings.setEffectsQuality('high');
          // A fresh copy of an enemy on a free tile, so every setting gets its own death.
          const skip = new Set(['graphic', 'label', 'factionIndicator', 'hpBar', 'affixPips']);
          const victim = JSON.parse(
            JSON.stringify(s.enemyUnits[0], (k, v) => (skip.has(k) ? undefined : v)),
          );
          delete victim.battleEntityId;
          Object.assign(victim, { col: 8, row: 2, isBoss: false }, style);
          const list = victim.faction === 'player' ? s.playerUnits : s.enemyUnits;
          list.push(victim);
          s.addUnitGraphic(victim);
          const texturesBefore = Object.keys(s.textures.list).length;
          const original = Math.random;
          let calls = 0;
          Math.random = () => {
            calls++;
            return original();
          };
          let peak = 0;
          const fx = (s._combatFx ||= new (
            await import('/src/ui/CombatFxController.js')
          ).CombatFxController(s));
          const watch = setInterval(() => (peak = Math.max(peak, fx.motes?.liveCount || 0)), 16);
          try {
            victim.currentHP = 0;
            await s.removeUnit(victim, { killer: null });
          } finally {
            Math.random = original;
          }
          const t0 = performance.now();
          while ((fx.motes?.liveCount || 0) > 0 && performance.now() - t0 < 4000)
            await new Promise((r) => setTimeout(r, 50));
          clearInterval(watch);
          return {
            removed: !list.includes(victim),
            graphic: victim.graphic,
            calls,
            peak,
            live: fx.liveObjects,
            textureDelta: Object.keys(s.textures.list).length - texturesBefore,
            dissolveTextures: Object.keys(s.textures.list).filter((k) =>
              k.startsWith('fx-dissolve'),
            ),
          };
        },
        { speed, motion, style },
      );
      const where = `${JSON.stringify(style)} ${speed}${motion ? ' reduced' : ''}`;
      expect(out.removed, where).toBe(true);
      expect(out.graphic, where).toBeNull();
      rngCalls.push(out.calls);
      expect(out.peak, where).toBeLessThanOrEqual(60);
      expect(out.live, where).toMatchObject({ motes: 0, dissolves: 0, poses: 0 });
      expect(out.dissolveTextures, where).toEqual([]);
      expect(out.textureDelta, where).toBeLessThanOrEqual(1); // the shared vignette at most
    }
    // The dissolve draws nothing from the battle RNG: every speed (and the plain
    // reduced-motion fade) consumes exactly the same draws.
    expect(new Set(rngCalls).size, JSON.stringify(style)).toBe(1);
  }
  expect(errors).toEqual([]);
});
