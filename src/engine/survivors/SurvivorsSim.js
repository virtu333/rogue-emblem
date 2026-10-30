// SurvivorsSim.js — the rules of Darkest Before Dawn (docs/specs/survivors-mode.md): one lord
// on a free field at night, waves of the game's own foes, weapons that strike on their own,
// EXP shards, level-ups with the lord's real growths, bosses on the clock, and dawn at the end.
//
// Pure and deterministic: a fixed time step (`STEP`), one seeded stream (`world.rng`), never
// Math.random, no Phaser. The scene (`scenes/SurvivorsScene.js`) feeds it the stick and draws
// `world` plus the events each step leaves in `world.events`; the tests and the balance sim
// drive it headless with a bot (SurvivorsBot.js), so a whole night runs in a unit test.
import { createSeededRng } from '../SeededRng.js';
import {
  CELL,
  avoidAt,
  buildFlowField,
  cellOf,
  costAt,
  createField,
  flowStep,
  slowFactor,
} from './SurvivorsField.js';
import {
  GROWN_STATS,
  critChanceOf,
  enemyProfile,
  lordProfile,
  rollLevelGains,
  strike,
  triangleBonus,
  weaponByName,
} from './SurvivorsUnits.js';

export const STEP = 1 / 60;
const FLOW_MOVE_TYPES = ['Infantry', 'Armored', 'Cavalry'];
const HASH_CELL = 48;
const PULL_SPEED = 320;
const SPAWN_MARGIN = 48;

// --- set-up ------------------------------------------------------------------------------

/** The first weapon a lord carries: the lord's own pick, else their first weapon type the mode has. */
export function startingWeaponId(config, profile) {
  const own = config.startWeaponByLord?.[profile.name];
  if (own && config.weapons[own]) return own;
  for (const type of profile.weaponTypes) {
    const id = config.startWeaponByType?.[type];
    if (id && config.weapons[id]) return id;
  }
  return Object.keys(config.weapons)[0];
}

export function createSurvivorsWorld({
  config,
  gameData,
  lordName,
  seed,
  view = { width: 520, height: 520 },
}) {
  const profile = lordProfile(gameData, lordName);
  if (!profile) throw new Error(`Unknown lord: ${lordName}`);
  const rng = createSeededRng(seed >>> 0);
  const field = createField(config.field, gameData.terrain, rng);
  const p = config.player;
  const startWeapon = startingWeaponId(config, profile);
  const player = {
    name: profile.name,
    className: profile.className,
    moveType: profile.moveType,
    growths: profile.growths,
    baseStats: { ...profile.stats },
    gained: Object.fromEntries(GROWN_STATS.map((s) => [s, 0])),
    stats: null,
    x: field.width / 2,
    y: field.height / 2,
    r: p.radius,
    facing: { x: 1, y: 0 },
    moving: false,
    hp: 0,
    maxHp: 0,
    level: 1,
    xp: 0,
    xpNext: xpToNext(config, 1),
    invuln: 0,
    weapons: [{ id: startWeapon, level: 1, cd: 0.4 }],
    passives: [],
    regenTimer: 0,
    miracleCd: 0,
    weaponType: weaponByName(gameData, config.weapons[startWeapon].levels[0].weapon)?.type || null,
  };
  const world = {
    config,
    gameData,
    seed: seed >>> 0,
    rng,
    field,
    t: 0,
    steps: 0,
    status: 'playing',
    player,
    enemies: [],
    projectiles: [],
    pickups: [],
    events: [],
    queue: [],
    offer: null,
    nextId: 1,
    spawnAcc: 0,
    view: null,
    flowCell: -1,
    flowTimer: 0,
    hash: new Map(),
    kills: 0,
    damageByWeapon: {},
    bossesDown: 0,
    activeBossIds: [],
  };
  setView(world, view.width, view.height);
  recomputeStats(world);
  player.hp = player.maxHp;
  return world;
}

export function xpToNext(config, level) {
  return config.xp.first + config.xp.perLevel * (level - 1);
}

/** A passive's current level (0 when not held). */
export function passiveLevel(world, id) {
  return world.player.passives.find((p) => p.id === id)?.level || 0;
}

/** The lord's stats now: base + level gains + accessory bonuses. Keeps HP's missing share. */
export function recomputeStats(world) {
  const pl = world.player;
  const stats = {};
  for (const stat of [...GROWN_STATS, 'MOV'])
    stats[stat] = (pl.baseStats[stat] || 0) + (pl.gained[stat] || 0);
  for (const held of pl.passives) {
    const def = world.config.passives[held.id];
    if (def?.stat) stats[def.stat] += def.perLevel * held.level;
  }
  const maxHp = stats.HP * world.config.player.hpScale;
  if (pl.maxHp > 0 && maxHp > pl.maxHp) pl.hp += maxHp - pl.maxHp;
  pl.maxHp = maxHp;
  pl.hp = Math.min(pl.hp, maxHp);
  pl.stats = stats;
}

function moveSpeedOf(world) {
  const p = world.config.player;
  const boots = world.config.passives.boots;
  const bonus = boots ? 1 + (boots.moveBonus || 0) * passiveLevel(world, 'boots') : 1;
  return (p.speedBase + p.speedPerMov * world.player.stats.MOV) * bonus;
}

// --- events ------------------------------------------------------------------------------

function emit(world, event) {
  world.events.push(event);
}

/** Hand the events since the last call to the caller (the scene draws them). */
export function drainEvents(world) {
  const out = world.events;
  world.events = [];
  return out;
}

// --- spatial hash ------------------------------------------------------------------------

function rebuildHash(world) {
  const hash = world.hash;
  for (const bucket of hash.values()) bucket.length = 0;
  for (const e of world.enemies) {
    const key = Math.floor(e.x / HASH_CELL) * 4096 + Math.floor(e.y / HASH_CELL);
    let bucket = hash.get(key);
    if (!bucket) hash.set(key, (bucket = []));
    bucket.push(e);
  }
}

function forEachNear(world, x, y, radius, fn) {
  const c0 = Math.floor((x - radius) / HASH_CELL);
  const c1 = Math.floor((x + radius) / HASH_CELL);
  const r0 = Math.floor((y - radius) / HASH_CELL);
  const r1 = Math.floor((y + radius) / HASH_CELL);
  for (let c = c0; c <= c1; c++)
    for (let r = r0; r <= r1; r++) {
      const bucket = world.hash.get(c * 4096 + r);
      if (bucket) for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
    }
}

// --- foes --------------------------------------------------------------------------------

function currentWave(world) {
  const waves = world.config.waves;
  let wave = waves[0];
  for (const w of waves) if (w.fromSec <= world.t) wave = w;
  return wave;
}

/**
 * Where a foe walks in: a point just past the edge of the screen (`world.view`, half its
 * width and height in world px, plus a margin), on the field and on ground it can stand on.
 */
function spawnPoint(world, moveType) {
  const { field, player, rng, view } = world;
  const hw = view.halfWidth + SPAWN_MARGIN;
  const hh = view.halfHeight + SPAWN_MARGIN;
  for (let attempt = 0; attempt < 10; attempt++) {
    // a point on the rectangle's edge, each side weighted by its length
    let roll = rng() * (hw + hh) * 2;
    let x;
    let y;
    if (roll < hw * 2) {
      x = player.x - hw + roll;
      y = player.y + (rng() < 0.5 ? -hh : hh);
    } else {
      roll -= hw * 2;
      y = player.y - hh + roll;
      x = player.x + (rng() < 0.5 ? -hw : hw);
    }
    if (x < 16 || y < 16 || x > field.width - 16 || y > field.height - 16) continue;
    if (costAt(field, moveType, x, y) > 0) return { x, y };
  }
  return null;
}

/** Tell the night how much of the field the screen shows (world px), for where foes walk in. */
export function setView(world, width, height) {
  world.view = { halfWidth: Math.max(120, width / 2), halfHeight: Math.max(120, height / 2) };
}

/** Make a foe of a class at a level (not yet placed). `kind`: 'normal' | 'elite' | 'boss'. */
export function makeEnemy(
  world,
  className,
  level,
  { hpScale = 1, kind = 'normal', boss = null } = {},
) {
  const cfg = world.config.enemy;
  const prof = enemyProfile(world.gameData, className, level);
  if (!prof) return null;
  const elite = kind === 'elite' ? world.config.elites : null;
  const speed =
    (cfg.speedBase +
      cfg.speedPerMov * prof.stats.MOV +
      (prof.moveType === 'Flying' ? cfg.flyingSpeedBonus : 0)) *
    (boss?.speedScale || 1);
  const maxHp = Math.max(1, Math.round(prof.stats.HP * hpScale));
  return {
    id: world.nextId++,
    className,
    name: boss?.name || null,
    level,
    kind,
    moveType: prof.moveType,
    stats: prof.stats,
    weaponType: prof.weapon?.type || null,
    power: (prof.magic ? prof.stats.MAG : prof.stats.STR) + (prof.weapon?.might || 0),
    magic: prof.magic,
    ranged: prof.ranged && kind !== 'boss',
    shootCd: cfg.rangedEverySec * (0.5 + world.rng()),
    x: 0,
    y: 0,
    r: cfg.radius * (elite ? elite.sizeScale : kind === 'boss' ? 1.6 : 1),
    hp: maxHp,
    maxHp,
    speed,
    kvx: 0,
    kvy: 0,
    xp:
      kind === 'boss'
        ? 40
        : (cfg.xpBase + Math.floor(level / cfg.xpPerLevels)) * (elite ? elite.xpScale : 1),
    boss: boss || null,
    state: 'chase',
    timer: boss?.charge?.everySec || 0,
    dashX: 0,
    dashY: 0,
    facing: 1,
  };
}

function placeEnemy(world, enemy) {
  const at = spawnPoint(world, enemy.moveType);
  if (!at) return false;
  enemy.x = at.x;
  enemy.y = at.y;
  world.enemies.push(enemy);
  return true;
}

function spawnFromWave(world, wave, kind = 'normal') {
  const { rng } = world;
  const className = wave.classes[Math.floor(rng() * wave.classes.length)];
  const [lo, hi] = wave.level;
  let level = lo + Math.floor(rng() * (hi - lo + 1));
  let hpScale = wave.hpScale ?? 1;
  if (kind === 'elite') {
    level += world.config.elites.levelBonus;
    hpScale *= world.config.elites.hpScale;
  }
  const enemy = makeEnemy(world, className, level, { hpScale, kind });
  if (!enemy || !placeEnemy(world, enemy)) return null;
  if (kind === 'elite') emit(world, { type: 'elite', id: enemy.id, className });
  return enemy;
}

function spawnBoss(world, def) {
  const entry = (world.gameData.enemies?.bosses?.[def.act] || []).find((b) => b.name === def.name);
  if (!entry) return null;
  const enemy = makeEnemy(world, entry.className, entry.level + (def.levelBonus || 0), {
    hpScale: def.hpScale,
    kind: 'boss',
    boss: def,
  });
  if (!enemy) return null;
  if (!placeEnemy(world, enemy)) {
    // a boss always comes: at the field's nearest open edge of the ring, else beside the lord
    enemy.x = Math.min(world.field.width - 24, Math.max(24, world.player.x + world.view.halfWidth));
    enemy.y = world.player.y;
    world.enemies.push(enemy);
  }
  world.activeBossIds.push(enemy.id);
  emit(world, { type: 'boss', id: enemy.id, name: def.name, className: entry.className });
  return enemy;
}

function crossed(world, prevT, at) {
  return prevT < at && world.t >= at;
}

function runSchedule(world, prevT) {
  const wave = currentWave(world);
  for (const at of world.config.elites?.atSec || [])
    if (crossed(world, prevT, at)) spawnFromWave(world, wave, 'elite');
  for (const def of world.config.bosses || [])
    if (crossed(world, prevT, def.atSec)) spawnBoss(world, def);
  world.spawnAcc += wave.spawnPerSec * STEP;
  let normals = 0;
  for (const e of world.enemies) if (e.kind === 'normal') normals++;
  while (world.spawnAcc >= 1) {
    world.spawnAcc -= 1;
    if (normals >= wave.maxAlive) {
      world.spawnAcc = 0;
      break;
    }
    if (spawnFromWave(world, wave)) normals++;
  }
}

function refreshFlow(world) {
  const cell = cellOf(world.field, world.player.x, world.player.y);
  world.flowTimer -= STEP;
  if (cell === world.flowCell && world.flowTimer > 0) return;
  world.flowCell = cell;
  world.flowTimer = 0.5;
  for (const moveType of FLOW_MOVE_TYPES)
    world.field.flow[moveType] = buildFlowField(world.field, moveType, cell);
}

function moveBody(world, body, dx, dy, moveType) {
  const { field } = world;
  const nx = Math.min(field.width - 4, Math.max(4, body.x + dx));
  if (costAt(field, moveType, nx, body.y) > 0) body.x = nx;
  const ny = Math.min(field.height - 4, Math.max(4, body.y + dy));
  if (costAt(field, moveType, body.x, ny) > 0) body.y = ny;
}

function updateEnemies(world) {
  const { player, field, config } = world;
  const cfg = config.enemy;
  const slowPerCost = config.player.terrainSlowPerCost;
  for (const e of world.enemies) {
    const dxp = player.x - e.x;
    const dyp = player.y - e.y;
    const dist = Math.hypot(dxp, dyp) || 1;
    // far behind the lord: walk back in at the edge of the night, as a fresh arrival
    const farAway = Math.hypot(world.view.halfWidth, world.view.halfHeight) * cfg.despawnScale;
    if (!e.boss && dist > farAway) {
      const at = spawnPoint(world, e.moveType);
      if (at) {
        e.x = at.x;
        e.y = at.y;
      }
      continue;
    }
    let vx = 0;
    let vy = 0;
    const speed = e.speed * slowFactor(costAt(field, e.moveType, e.x, e.y) || 1, slowPerCost);
    if (e.boss?.charge) {
      e.timer -= STEP;
      if (e.state === 'chase' && e.timer <= 0) {
        e.state = 'windup';
        e.timer = e.boss.charge.windupSec;
        e.dashX = dxp / dist;
        e.dashY = dyp / dist;
        emit(world, { type: 'bossWindup', id: e.id });
      } else if (e.state === 'windup') {
        if (e.timer <= 0) {
          e.state = 'dash';
          e.timer = e.boss.charge.dashSec;
        }
        continue;
      } else if (e.state === 'dash') {
        const s = e.speed * e.boss.charge.dashSpeedScale;
        moveBody(world, e, e.dashX * s * STEP, e.dashY * s * STEP, e.moveType);
        if (e.timer <= 0) {
          e.state = 'chase';
          e.timer = e.boss.charge.everySec;
        }
        continue;
      }
    }
    const touching = dist <= player.r + e.r;
    if (e.ranged) {
      e.shootCd -= STEP;
      if (e.shootCd <= 0 && dist < cfg.rangedKeepDistance * 1.6) {
        e.shootCd = cfg.rangedEverySec;
        fireEnemyShot(world, e, dxp / dist, dyp / dist);
      }
      if (dist > cfg.rangedKeepDistance) {
        vx = dxp / dist;
        vy = dyp / dist;
      } else if (dist < cfg.rangedKeepDistance * 0.7) {
        vx = -dxp / dist;
        vy = -dyp / dist;
      }
    } else if (!touching) {
      const step =
        e.moveType === 'Flying' ? null : flowStep(field, field.flow[e.moveType] || [], e.x, e.y);
      const tx = step ? step.x : player.x;
      const ty = step ? step.y : player.y;
      const d = Math.hypot(tx - e.x, ty - e.y) || 1;
      vx = (tx - e.x) / d;
      vy = (ty - e.y) / d;
    }
    if (vx) e.facing = vx > 0 ? 1 : -1;
    const kx = e.kvx * STEP;
    const ky = e.kvy * STEP;
    e.kvx *= 0.85;
    e.kvy *= 0.85;
    moveBody(world, e, vx * speed * STEP + kx, vy * speed * STEP + ky, e.moveType);
  }
  // keep foes from stacking into one sprite: push overlapping pairs apart (bosses hold)
  rebuildHash(world);
  for (const e of world.enemies) {
    forEachNear(world, e.x, e.y, e.r * 2, (o) => {
      if (o.id <= e.id) return;
      const dx = o.x - e.x;
      const dy = o.y - e.y;
      const min = (e.r + o.r) * 0.8;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) return;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const ux = dx / d;
      const uy = dy / d;
      if (!e.boss) moveBody(world, e, -ux * push, -uy * push, e.moveType);
      if (!o.boss) moveBody(world, o, ux * push, uy * push, o.moveType);
    });
  }
}

function fireEnemyShot(world, e, ux, uy) {
  const speed = world.config.enemy.rangedSpeed;
  world.projectiles.push({
    id: world.nextId++,
    hostile: true,
    kind: e.magic ? 'enemyFire' : 'enemyArrow',
    x: e.x,
    y: e.y,
    vx: ux * speed,
    vy: uy * speed,
    r: 6,
    life: 3,
    power: e.power,
    magic: e.magic,
    weaponType: e.weaponType,
  });
  emit(world, { type: 'enemyShot', id: e.id, magic: e.magic });
}

// --- the lord's weapons -------------------------------------------------------------------

function weaponLevelDef(world, held) {
  return world.config.weapons[held.id].levels[held.level - 1];
}

function cooldownScale(world, catalog) {
  const p = world.config.player;
  const s = world.player.stats;
  // Attack Speed, the battle's formula: a weapon heavier than STR / 5 slows the hand.
  const attackSpeed = s.SPD - Math.max(0, (catalog?.weight || 0) - Math.floor(s.STR / 5));
  return Math.max(p.minCooldownScale, 1 - attackSpeed * p.cooldownPerAttackSpeed);
}

function nearestEnemies(world, count, maxDist) {
  const { player } = world;
  const list = [];
  for (const e of world.enemies) {
    const d = Math.hypot(e.x - player.x, e.y - player.y);
    if (d <= maxDist) list.push({ e, d });
  }
  list.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
  return list.slice(0, count).map((x) => x.e);
}

function hitEnemy(world, held, e, fromX, fromY) {
  if (e.hp <= 0) return;
  const pl = world.player;
  const def = world.config.weapons[held.id];
  const lvl = weaponLevelDef(world, held);
  const catalog = weaponByName(world.gameData, lvl.weapon);
  const magic = def.stat === 'MAG';
  const wrath = world.config.passives.wrath;
  const lowHp = pl.hp <= pl.maxHp / 2;
  const wrathBonus = wrath && lowHp ? wrath.lowHpCrit * passiveLevel(world, 'wrath') : 0;
  const { damage, crit } = strike(
    {
      power: magic ? pl.stats.MAG : pl.stats.STR,
      might: catalog?.might || 0,
      defense: magic ? e.stats.RES : e.stats.DEF,
      triangle: triangleBonus(catalog?.type, e.weaponType, world.config.triangleDamage || 0),
      critChance: critChanceOf(pl.stats.SKL, catalog?.crit || 0, wrathBonus, e.stats.LCK),
    },
    world.rng,
  );
  const dealt = Math.min(damage, e.hp);
  e.hp -= damage;
  world.damageByWeapon[held.id] = (world.damageByWeapon[held.id] || 0) + dealt;
  emit(world, { type: 'hit', id: e.id, x: e.x, y: e.y, amount: damage, crit, weapon: held.id });
  if (!e.boss) {
    const dx = e.x - fromX;
    const dy = e.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const k = world.config.enemy.knockback * (e.kind === 'elite' ? 0.3 : 1);
    e.kvx += (dx / d) * k;
    e.kvy += (dy / d) * k;
  }
  const sol = world.config.passives.sol;
  const solLevel = passiveLevel(world, 'sol');
  if (sol && solLevel && world.rng() < sol.healChance * solLevel) {
    heal(world, Math.max(1, Math.floor(dealt * sol.healShare)), 'sol');
  }
  if (e.hp <= 0) killEnemy(world, e);
}

function killEnemy(world, e) {
  world.kills++;
  emit(world, {
    type: 'kill',
    id: e.id,
    x: e.x,
    y: e.y,
    className: e.className,
    kind: e.kind,
    name: e.name,
  });
  dropShard(world, e.x, e.y, e.xp);
  if (e.kind !== 'normal') addPickup(world, 'chest', e.x + 10, e.y, 0);
  else if (world.rng() < world.config.enemy.vulneraryChance)
    addPickup(world, 'vulnerary', e.x, e.y + 8, 0);
  if (e.kind === 'boss') {
    world.bossesDown++;
    world.activeBossIds = world.activeBossIds.filter((id) => id !== e.id);
    emit(world, { type: 'bossDown', id: e.id, name: e.name });
  }
}

function sweepDead(world) {
  if (world.enemies.some((e) => e.hp <= 0)) world.enemies = world.enemies.filter((e) => e.hp > 0);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * Where a close weapon swings: at the nearest foe within its reach (the lord turns to meet
 * it), else the way the lord faces.
 */
function aimAngle(world, reach) {
  const pl = world.player;
  let best = null;
  let bestD = reach;
  forEachNear(world, pl.x, pl.y, reach, (e) => {
    if (e.hp <= 0) return;
    const d = Math.hypot(e.x - pl.x, e.y - pl.y) - e.r;
    if (d < bestD || (d === bestD && best && e.id < best.id)) {
      best = e;
      bestD = d;
    }
  });
  return best ? Math.atan2(best.y - pl.y, best.x - pl.x) : Math.atan2(pl.facing.y, pl.facing.x);
}

function fireWeapon(world, held) {
  const pl = world.player;
  const def = world.config.weapons[held.id];
  const lvl = weaponLevelDef(world, held);
  const facing =
    def.pattern === 'arc' || def.pattern === 'thrust'
      ? aimAngle(world, (lvl.reach || lvl.length) + 16)
      : Math.atan2(pl.facing.y, pl.facing.x);
  emit(world, { type: 'fire', weapon: held.id });
  switch (def.pattern) {
    case 'arc': {
      const half = ((lvl.arc || 120) * Math.PI) / 360;
      for (let s = 0; s < lvl.swings; s++) {
        const angle = facing + s * Math.PI;
        emit(world, {
          type: 'swing',
          weapon: held.id,
          x: pl.x,
          y: pl.y,
          angle,
          reach: lvl.reach,
          arc: lvl.arc,
        });
        forEachNear(world, pl.x, pl.y, lvl.reach + 24, (e) => {
          const d = Math.hypot(e.x - pl.x, e.y - pl.y);
          if (d > lvl.reach + e.r) return;
          if (d > e.r && angleDiff(Math.atan2(e.y - pl.y, e.x - pl.x), angle) > half) return;
          hitEnemy(world, held, e, pl.x, pl.y);
        });
      }
      break;
    }
    case 'thrust': {
      const dirs =
        lvl.thrusts >= 4
          ? [0, Math.PI / 2, Math.PI, -Math.PI / 2]
          : lvl.thrusts >= 2
            ? [0, Math.PI]
            : [0];
      for (const off of dirs) {
        const angle = facing + off;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        emit(world, {
          type: 'thrust',
          weapon: held.id,
          x: pl.x,
          y: pl.y,
          angle,
          length: lvl.length,
        });
        forEachNear(
          world,
          pl.x + (ux * lvl.length) / 2,
          pl.y + (uy * lvl.length) / 2,
          lvl.length / 2 + 24,
          (e) => {
            const rx = e.x - pl.x;
            const ry = e.y - pl.y;
            const along = rx * ux + ry * uy;
            const across = Math.abs(rx * uy - ry * ux);
            if (along < -e.r || along > lvl.length + e.r || across > lvl.width / 2 + e.r) return;
            hitEnemy(world, held, e, pl.x, pl.y);
          },
        );
      }
      break;
    }
    case 'boomerang': {
      for (let i = 0; i < lvl.count; i++) {
        const angle = facing + (i - (lvl.count - 1) / 2) * ((Math.PI * 2) / Math.max(lvl.count, 3));
        world.projectiles.push({
          id: world.nextId++,
          kind: 'axe',
          weapon: held.id,
          x: pl.x,
          y: pl.y,
          vx: Math.cos(angle) * lvl.speed,
          vy: Math.sin(angle) * lvl.speed,
          speed: lvl.speed,
          r: lvl.radius,
          out: lvl.range,
          returning: false,
          life: 6,
          hitAt: new Map(),
        });
      }
      break;
    }
    case 'arrow':
    case 'bolt': {
      const targets = nearestEnemies(world, lvl.count, 520);
      for (let i = 0; i < lvl.count; i++) {
        const target = targets.length ? targets[i % targets.length] : null;
        let angle = target ? Math.atan2(target.y - pl.y, target.x - pl.x) : facing;
        if (target && i >= targets.length) angle += (i - targets.length + 1) * 0.18;
        world.projectiles.push({
          id: world.nextId++,
          kind: def.pattern === 'arrow' ? 'arrow' : 'fire',
          weapon: held.id,
          x: pl.x,
          y: pl.y,
          vx: Math.cos(angle) * lvl.speed,
          vy: Math.sin(angle) * lvl.speed,
          r: def.pattern === 'arrow' ? 6 : 8,
          life: 1.8,
          pierce: def.pattern === 'arrow' ? lvl.pierce : 1,
          burst: lvl.burst || 0,
          hit: new Set(),
        });
      }
      break;
    }
    case 'aura': {
      emit(world, { type: 'aura', weapon: held.id, x: pl.x, y: pl.y, radius: lvl.radius });
      forEachNear(world, pl.x, pl.y, lvl.radius + 24, (e) => {
        if (Math.hypot(e.x - pl.x, e.y - pl.y) <= lvl.radius + e.r)
          hitEnemy(world, held, e, pl.x, pl.y);
      });
      break;
    }
    default:
      break;
  }
}

function updateWeapons(world) {
  for (const held of world.player.weapons) {
    held.cd -= STEP;
    if (held.cd > 0) continue;
    const lvl = weaponLevelDef(world, held);
    held.cd = lvl.cooldown * cooldownScale(world, weaponByName(world.gameData, lvl.weapon));
    fireWeapon(world, held);
  }
}

function heldWeapon(world, id) {
  return world.player.weapons.find((w) => w.id === id) || null;
}

function updateProjectiles(world) {
  const pl = world.player;
  const keep = [];
  for (const p of world.projectiles) {
    p.life -= STEP;
    if (p.hostile) {
      p.x += p.vx * STEP;
      p.y += p.vy * STEP;
      if (Math.hypot(p.x - pl.x, p.y - pl.y) <= p.r + pl.r) {
        hurtPlayer(world, p);
        continue;
      }
      if (p.life > 0) keep.push(p);
      continue;
    }
    const held = heldWeapon(world, p.weapon);
    if (!held) continue;
    if (p.kind === 'axe') {
      if (!p.returning) {
        p.out -= p.speed * STEP;
        if (p.out <= 0) p.returning = true;
      } else {
        const dx = pl.x - p.x;
        const dy = pl.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 16) continue;
        p.vx = (dx / d) * p.speed * 1.15;
        p.vy = (dy / d) * p.speed * 1.15;
      }
      p.x += p.vx * STEP;
      p.y += p.vy * STEP;
      forEachNear(world, p.x, p.y, p.r + 24, (e) => {
        if (Math.hypot(e.x - p.x, e.y - p.y) > p.r + e.r) return;
        const last = p.hitAt.get(e.id);
        if (last !== undefined && world.t - last < 0.4) return;
        p.hitAt.set(e.id, world.t);
        hitEnemy(world, held, e, p.x, p.y);
      });
      if (p.life > 0) keep.push(p);
      continue;
    }
    p.x += p.vx * STEP;
    p.y += p.vy * STEP;
    let spent = false;
    forEachNear(world, p.x, p.y, p.r + 24, (e) => {
      if (spent || e.hp <= 0 || p.hit.has(e.id)) return;
      if (Math.hypot(e.x - p.x, e.y - p.y) > p.r + e.r) return;
      p.hit.add(e.id);
      if (p.burst) {
        emit(world, { type: 'burst', weapon: p.weapon, x: p.x, y: p.y, radius: p.burst });
        forEachNear(world, p.x, p.y, p.burst + 24, (o) => {
          if (Math.hypot(o.x - p.x, o.y - p.y) <= p.burst + o.r) hitEnemy(world, held, o, p.x, p.y);
        });
      } else hitEnemy(world, held, e, p.x, p.y);
      p.pierce -= 1;
      if (p.pierce <= 0) spent = true;
    });
    if (
      !spent &&
      p.life > 0 &&
      p.x > 0 &&
      p.y > 0 &&
      p.x < world.field.width &&
      p.y < world.field.height
    )
      keep.push(p);
  }
  world.projectiles = keep;
}

// --- the lord taking blows ------------------------------------------------------------------

function heal(world, amount, source) {
  const pl = world.player;
  const healed = Math.min(amount, pl.maxHp - pl.hp);
  if (healed <= 0) return 0;
  pl.hp += healed;
  emit(world, { type: 'heal', amount: healed, source });
  return healed;
}

/** One blow on the lord from a foe or a foe's shot: terrain may turn it aside. */
function hurtPlayer(world, attacker) {
  const pl = world.player;
  if (pl.invuln > 0 || world.status !== 'playing') return;
  pl.invuln = world.config.player.invulnSec;
  const avoid = avoidAt(world.field, pl.x, pl.y);
  if (avoid > 0 && world.rng() < avoid / 100) {
    emit(world, { type: 'dodge', x: pl.x, y: pl.y });
    return;
  }
  const defense = attacker.magic ? pl.stats.RES : pl.stats.DEF;
  const triangle = triangleBonus(
    attacker.weaponType,
    pl.weaponType,
    world.config.triangleDamage || 0,
  );
  const scale = world.config.enemy.damageScale ?? 1;
  const damage = Math.max(1, Math.round((attacker.power + triangle - defense) * scale));
  if (damage >= pl.hp && pl.miracleCd <= 0 && passiveLevel(world, 'miracle')) {
    const miracle = world.config.passives.miracle;
    pl.miracleCd = miracle.cooldownSec[passiveLevel(world, 'miracle') - 1];
    pl.hp = 1;
    emit(world, { type: 'miracle', x: pl.x, y: pl.y });
    return;
  }
  pl.hp = Math.max(0, pl.hp - damage);
  emit(world, {
    type: 'playerHit',
    amount: damage,
    magic: Boolean(attacker.magic),
    x: pl.x,
    y: pl.y,
  });
  if (pl.hp <= 0) {
    world.status = 'lost';
    emit(world, { type: 'lost' });
  }
}

function contactDamage(world) {
  const pl = world.player;
  if (pl.invuln > 0) return;
  let attacker = null;
  forEachNear(world, pl.x, pl.y, pl.r + 40, (e) => {
    if (attacker || e.hp <= 0) return;
    if (e.state === 'windup') return;
    if (Math.hypot(e.x - pl.x, e.y - pl.y) <= pl.r + e.r + 2) attacker = e;
  });
  if (attacker) hurtPlayer(world, attacker);
}

// --- pickups ------------------------------------------------------------------------------

function addPickup(world, kind, x, y, value) {
  world.pickups.push({ id: world.nextId++, kind, x, y, value, pulled: false });
}

function dropShard(world, x, y, value) {
  let count = 0;
  for (const p of world.pickups) if (p.kind === 'xp') count++;
  if (count >= world.config.xp.shardMergeAbove) {
    const oldest = world.pickups.find((p) => p.kind === 'xp');
    oldest.value += value;
    return;
  }
  addPickup(world, 'xp', x, y, value);
}

function updatePickups(world) {
  const pl = world.player;
  const cfg = world.config.player;
  const reach = cfg.pickupRadius + cfg.pickupPerLck * pl.stats.LCK;
  const keep = [];
  for (const p of world.pickups) {
    const dx = pl.x - p.x;
    const dy = pl.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (!p.pulled && d <= reach) p.pulled = true;
    if (p.pulled) {
      p.x += (dx / d) * Math.min(d, PULL_SPEED * STEP);
      p.y += (dy / d) * Math.min(d, PULL_SPEED * STEP);
    }
    if (d <= pl.r + 8) {
      collect(world, p);
      continue;
    }
    keep.push(p);
  }
  world.pickups = keep;
}

function collect(world, p) {
  emit(world, { type: 'pickup', kind: p.kind });
  if (p.kind === 'xp') gainXp(world, p.value);
  else if (p.kind === 'vulnerary')
    heal(
      world,
      Math.max(1, Math.round(world.player.maxHp * world.config.vulneraryHealShare)),
      'vulnerary',
    );
  else if (p.kind === 'chest') world.queue.push({ source: 'chest' });
}

function gainXp(world, amount) {
  const pl = world.player;
  const band = world.config.passives.mentors_band;
  const bonus = band ? 1 + band.xpBonus * passiveLevel(world, 'mentors_band') : 1;
  pl.xp += amount * bonus;
  while (pl.xp >= pl.xpNext) {
    pl.xp -= pl.xpNext;
    pl.level++;
    pl.xpNext = xpToNext(world.config, pl.level);
    const gains = rollLevelGains(pl.growths, world.rng);
    for (const stat of GROWN_STATS) pl.gained[stat] += gains[stat];
    recomputeStats(world);
    world.queue.push({ source: 'level', level: pl.level, gains });
  }
}

// --- level-up offers ------------------------------------------------------------------------

/** Everything the lord could take now: new or better weapons and accessories/skills. */
export function offerCandidates(world) {
  const pl = world.player;
  const { config } = world;
  const out = [];
  for (const [id, def] of Object.entries(config.weapons)) {
    const held = heldWeapon(world, id);
    if (held && held.level < def.levels.length)
      out.push({ kind: 'weapon', id, level: held.level + 1, weight: 1.3 });
    else if (!held && pl.weapons.length < config.player.maxWeapons)
      out.push({ kind: 'weapon', id, level: 1, weight: 1 });
  }
  for (const [id, def] of Object.entries(config.passives)) {
    const lvl = passiveLevel(world, id);
    if (lvl && lvl < def.maxLevel) out.push({ kind: 'passive', id, level: lvl + 1, weight: 1.1 });
    else if (!lvl && pl.passives.length < config.player.maxPassives)
      out.push({ kind: 'passive', id, level: 1, weight: 0.8 });
  }
  return out;
}

/** Draw `count` distinct choices by weight; a lord with nothing left to take may rest. */
export function makeOffer(world, count = world.config.offerCount) {
  const pool = offerCandidates(world);
  const picks = [];
  while (picks.length < count && pool.length) {
    const total = pool.reduce((s, c) => s + c.weight, 0);
    let roll = world.rng() * total;
    let index = 0;
    for (; index < pool.length - 1; index++) {
      roll -= pool[index].weight;
      if (roll < 0) break;
    }
    picks.push(pool.splice(index, 1)[0]);
  }
  if (!picks.length) picks.push({ kind: 'rest', id: 'rest', level: 0 });
  return picks.map(({ kind, id, level }) => ({ kind, id, level }));
}

function openNextOffer(world) {
  if (world.offer || !world.queue.length || world.status !== 'playing') return;
  const next = world.queue.shift();
  world.offer = { ...next, choices: makeOffer(world) };
  world.status = 'choosing';
  emit(world, { type: next.source === 'chest' ? 'chest' : 'levelup', level: next.level || null });
}

/** Take choice `index` of the open offer and play on (or open the next queued one). */
export function chooseOffer(world, index) {
  if (world.status !== 'choosing' || !world.offer) return false;
  const choice = world.offer.choices[index];
  if (!choice) return false;
  const pl = world.player;
  if (choice.kind === 'weapon') {
    const held = heldWeapon(world, choice.id);
    if (held) held.level = choice.level;
    else pl.weapons.push({ id: choice.id, level: 1, cd: 0.2 });
  } else if (choice.kind === 'passive') {
    const held = pl.passives.find((p) => p.id === choice.id);
    if (held) held.level = choice.level;
    else pl.passives.push({ id: choice.id, level: 1 });
    recomputeStats(world);
  } else if (choice.kind === 'rest') {
    heal(world, Math.max(1, Math.round(pl.maxHp * world.config.restHealShare)), 'rest');
  }
  emit(world, { type: 'chosen', choice });
  world.offer = null;
  world.status = 'playing';
  openNextOffer(world);
  return true;
}

// --- the step --------------------------------------------------------------------------------

function updatePlayer(world, input) {
  const pl = world.player;
  let mx = Number(input?.x) || 0;
  let my = Number(input?.y) || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) {
    mx /= len;
    my /= len;
  }
  pl.moving = len > 0.05;
  if (pl.moving) {
    const l = Math.hypot(mx, my);
    pl.facing = { x: mx / l, y: my / l };
    const speed =
      moveSpeedOf(world) *
      slowFactor(
        costAt(world.field, pl.moveType, pl.x, pl.y) || 1,
        world.config.player.terrainSlowPerCost,
      );
    moveBody(world, pl, mx * speed * STEP, my * speed * STEP, pl.moveType);
  }
  pl.invuln = Math.max(0, pl.invuln - STEP);
  pl.miracleCd = Math.max(0, pl.miracleCd - STEP);
  const renewal = world.config.passives.renewal;
  const renewalLevel = passiveLevel(world, 'renewal');
  if (renewal && renewalLevel) {
    pl.regenTimer += STEP;
    const every = renewal.regenEverySec / renewalLevel;
    if (pl.regenTimer >= every) {
      pl.regenTimer -= every;
      heal(world, renewal.regenAmount, 'renewal');
    }
  }
}

/** Advance the night by one fixed step. `input`: the stick, `{ x, y }` in -1..1. */
export function stepWorld(world, input) {
  if (world.status !== 'playing') return;
  const prevT = world.t;
  world.t += STEP;
  world.steps++;
  updatePlayer(world, input);
  runSchedule(world, prevT);
  refreshFlow(world);
  updateEnemies(world);
  updateWeapons(world);
  updateProjectiles(world);
  sweepDead(world);
  contactDamage(world);
  if (world.status !== 'playing') return;
  updatePickups(world);
  if (world.t >= world.config.durationSec) {
    world.status = 'won';
    emit(world, { type: 'won' });
    return;
  }
  openNextOffer(world);
}

/** Seconds left until dawn. */
export function timeLeft(world) {
  return Math.max(0, world.config.durationSec - world.t);
}

/** The bosses on the field now (for the boss bar). */
export function activeBosses(world) {
  return world.enemies.filter((e) => e.kind === 'boss' && e.hp > 0);
}

export { CELL };
