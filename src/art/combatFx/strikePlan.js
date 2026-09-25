// strikePlan — the combat choreography as data (pure, no Phaser).
//
// planStrike() turns one resolved strike plus the player's settings into the ordered
// steps the runtime plays and the time each one waits. The runtime executes the plan
// step by step; tests read it directly, so timing budgets (Normal within ~15% of the
// old presentation, Fast half of Normal, Instant adding no waits, reduced motion with
// no displacement) are checked without a renderer.
//
// Every wait is given at Normal speed with a COMBAT_WAITS label, so the scene scales it
// exactly like every other combat wait (utils/combatTiming.js). `ms` in a step is that
// scaled value; `baseMs` is the Normal value the runtime passes to the scene.
//
// Presentation randomness never touches the battle RNG: fxSeed() hashes stable inputs
// (unit ids, turn, strike index) and fxRandom() is a private generator over that seed.

export const STRIKE_TIMING = Object.freeze({
  windup: 70,
  lunge: { melee: 90, followUp: 55, ranged: 70 },
  lungePx: { melee: 10, followUp: 7, ranged: 3 },
  // A Legendary art already follows its cut-in: the signature's weight comes from a
  // longer freeze, and its climax frames keep playing (lingering) past the strike.
  hitStop: { normal: 60, crit: 110, followUp: 45, signature: 115 },
  hold: { normal: 100, crit: 170, followUp: 100, signature: 80 },
  missHold: 250,
  rangedMissHold: 220,
  recover: { melee: 90, ranged: 70 },
  knockPx: { normal: 4, heavy: 6, crit: 7 },
  // Flight time: base + per tile, clamped; bolts strike faster, unlight creeps.
  travel: { base: 40, perTile: 26, min: 60, max: 200, bolt: 0.45, slow: 1.3, stream: 0.9 },
});

/** The presentation this replaces (BattleScene.animateStrike before Combat v2). */
export const LEGACY_TIMING = Object.freeze({
  windup: 70,
  lunge: 90,
  followUp: 55,
  hitHold: 150,
  critHold: 240,
  missHold: 300,
  back: 90,
});

export const WAIT_LABELS = Object.freeze({
  windup: 'combat_fx_windup',
  lunge: 'combat_fx_lunge_forward',
  travel: 'combat_fx_travel',
  hitStop: 'combat_fx_hit_stop',
  hold: 'animate_strike_hit_hold',
  missHold: 'animate_strike_miss_hold',
  recover: 'combat_fx_lunge_back',
});

/** Same semantics as combatTiming.combatDuration: Instant -> 1 ms, Fast -> half. */
export function scaleMs(ms, speed) {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  if (speed === 'instant') return 1;
  if (speed === 'fast') return ms * 0.5;
  return ms;
}

/** Flight time (Normal ms) for a projectile over `tiles` tiles. */
export function travelMs(tiles, kind = 'arc', { slow = false } = {}) {
  const T = STRIKE_TIMING.travel;
  let ms = Math.min(T.max, Math.max(T.min, T.base + T.perTile * Math.max(1, tiles)));
  if (kind === 'bolt') ms *= T.bolt;
  else if (kind === 'stream') ms *= T.stream;
  if (slow) ms *= T.slow;
  return Math.round(ms);
}

/** Arc apex height in world px: longer shots loft higher (reads the distance). */
export function arcHeight(tiles, factor = 1) {
  return Math.round(factor * (6 + 5 * Math.max(1, tiles)));
}

/**
 * Orientation for effects drawn pointing +x: exact quarter turns or a mirror, so
 * pixel art is never resampled at odd angles. Horizontal wins ties (the common case).
 */
export function facing(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return { rotation: 0, flipX: dx < 0 };
  return { rotation: dy > 0 ? Math.PI / 2 : -Math.PI / 2, flipX: false };
}

/**
 * @param {object} strike { miss, crit, followUp, windUp, signature, distance,
 *   projectile: null | { kind, slow } }
 * @param {object} settings { speed: 'normal'|'fast'|'instant', reduced, quality }
 */
export function planStrike(strike = {}, settings = {}) {
  const speed = ['normal', 'fast', 'instant'].includes(settings.speed) ? settings.speed : 'normal';
  const reduced = settings.reduced === true;
  const low = settings.quality === 'low';
  const miss = strike.miss === true;
  const crit = !miss && strike.crit === true;
  const signature = !miss && strike.signature === true;
  const followUp = strike.followUp === true;
  const T = STRIKE_TIMING;
  const L = LEGACY_TIMING;
  const steps = [];
  const add = (id, baseMs, { wait = true, label = WAIT_LABELS[id] || null } = {}) =>
    steps.push({ id, baseMs, ms: scaleMs(baseMs, speed), wait, label });

  const legacyHold = miss ? L.missHold : crit ? L.critHold : L.hitHold;
  let mode = 'full';
  if (speed === 'instant') mode = 'instant';
  else if (reduced) mode = 'reduced';

  // A ranged strike keeps its draw/cast tempo at every quality; only the flight itself is
  // an effect (low quality: the shot lands without one, adding no travel wait).
  const ranged = mode === 'full' && Boolean(strike.projectile);
  const projectile = ranged && !low ? strike.projectile : null;

  const holdId = miss ? 'missHold' : 'hold';
  if (mode === 'instant') {
    // Exactly the legacy waits (each scales to 1 ms); Combat v2 adds none.
    if (strike.windUp && !followUp) add('windup', L.windup);
    add('lunge', followUp ? L.followUp : L.lunge);
    add('contact', 0, { wait: false });
    if (!miss) add('react', 0, { wait: false });
    add(holdId, legacyHold);
    add('recover', L.back);
  } else if (mode === 'reduced') {
    // No displacement at all: the unit stays on its tile and effects show one frame.
    add('lunge', 0, { wait: false });
    add('contact', 0, { wait: false });
    if (!miss) add('react', 0, { wait: false });
    add(holdId, legacyHold);
    add('recover', 0, { wait: false });
  } else {
    if (strike.windUp && !followUp) add('windup', T.windup);
    const lunge = ranged ? T.lunge.ranged : followUp ? T.lunge.followUp : T.lunge.melee;
    add('lunge', lunge);
    if (projectile) {
      add('travel', travelMs(strike.distance || 1, projectile.kind, { slow: projectile.slow }));
    }
    add('contact', 0, { wait: false });
    if (miss) {
      add('missHold', ranged ? T.rangedMissHold : T.missHold);
    } else {
      const tier = signature ? 'signature' : crit ? 'crit' : followUp ? 'followUp' : 'normal';
      add('hitStop', T.hitStop[tier]);
      add('react', 0, { wait: false });
      // A critical Legendary art keeps the crit's hold (its legacy hold was the crit's).
      add('hold', signature && crit ? T.hold.crit : T.hold[tier]);
    }
    // A ranged striker barely moved: it settles during the hold, adding no wait.
    add('recover', ranged ? T.recover.ranged : T.recover.melee, { wait: !ranged });
  }

  const totalMs = steps.filter((s) => s.wait).reduce((sum, s) => sum + s.ms, 0);
  const legacyMs =
    speed === 'instant' || !reduced
      ? [
          strike.windUp && !followUp ? L.windup : 0,
          followUp ? L.followUp : L.lunge,
          legacyHold,
          L.back,
        ].reduce((sum, ms) => sum + scaleMs(ms, speed), 0)
      : scaleMs(legacyHold, speed);
  const full = mode === 'full';
  return {
    mode,
    speed,
    steps,
    totalMs,
    legacyMs,
    flags: {
      motion: full,
      ranged,
      projectile: Boolean(projectile),
      hitStop: full && !miss,
      poses: mode !== 'reduced',
      ghosts: full && !low && (miss || crit || signature || followUp),
      overlays: !low,
      animatedOverlays: full && !low,
      dust: full && !low && !miss,
      motes: full && !low,
      vignette: full && !low && (crit || signature),
      impactLight: full && !low,
      lungePx: ranged ? T.lungePx.ranged : followUp ? T.lungePx.followUp : T.lungePx.melee,
      knockPx: crit ? T.knockPx.crit : T.knockPx.normal,
    },
  };
}

/** Death dissolve plan: body dissolve time (awaited) and ember budget. */
export function planDeath(style, settings = {}) {
  const speed = ['normal', 'fast', 'instant'].includes(settings.speed) ? settings.speed : 'normal';
  const reduced = settings.reduced === true;
  const low = settings.quality === 'low';
  const base = style?.dissolveMs || 380;
  if (speed === 'instant') return { mode: 'instant', ms: 1, baseMs: 300, motes: 0, steps: 1 };
  if (reduced) return { mode: 'reduced', ms: scaleMs(140, speed), baseMs: 140, motes: 0, steps: 2 };
  if (low) return { mode: 'low', ms: scaleMs(300, speed), baseMs: 300, motes: 0, steps: 1 };
  return {
    mode: 'full',
    ms: scaleMs(base, speed),
    baseMs: base,
    motes: Math.min(60, style?.motes ?? 40),
    steps: 9,
  };
}

// ---------------------------------------------------------------- seeded fx ------

/** FNV-1a over the joined parts: a stable seed from ids, turn and strike index. */
export function fxSeed(...parts) {
  const s = parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('|');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/** Private mulberry32 stream for presentation choices (never Math.random). */
export function fxRandom(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
