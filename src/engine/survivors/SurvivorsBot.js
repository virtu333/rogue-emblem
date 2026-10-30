// SurvivorsBot.js — a plain player for Darkest Before Dawn, for the tests and the balance sim:
// it backs away from the crowd, picks up shards when the way is clear, keeps off the field's
// edge, and takes level-up choices by a fixed taste. Pure; reads the world, never writes it.
import { costAt } from './SurvivorsField.js';

/** The stick the bot pushes this step: `{ x, y }`, length up to 1. */
export function botInput(world) {
  const pl = world.player;
  let fx = 0;
  let fy = 0;
  let nearest = Infinity;
  let nearestFoe = null;
  // stand at the edge of the crowd: close enough for the weapons, out of arm's reach
  const keep = 58;
  for (const e of world.enemies) {
    const dx = pl.x - e.x;
    const dy = pl.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < nearest) {
      nearest = d;
      nearestFoe = e;
    }
    const danger = e.kind === 'boss' ? keep * 2.2 : keep;
    if (d > danger) continue;
    const w = ((danger - d) / danger) * (e.kind === 'boss' ? 3 : 1);
    fx += (dx / d) * w;
    fy += (dy / d) * w;
  }
  if (nearestFoe && nearest > keep * 1.3 && nearest < 400) {
    fx -= ((pl.x - nearestFoe.x) / nearest) * 0.6;
    fy -= ((pl.y - nearestFoe.y) / nearest) * 0.6;
  }
  for (const p of world.projectiles) {
    if (!p.hostile) continue;
    const dx = pl.x - p.x;
    const dy = pl.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 90) {
      fx += (dx / d) * 1.5;
      fy += (dy / d) * 1.5;
    }
  }
  if (nearest > keep * 1.5) {
    let best = null;
    let bestD = 260;
    for (const p of world.pickups) {
      const d = Math.hypot(p.x - pl.x, p.y - pl.y);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (best) {
      fx += ((best.x - pl.x) / bestD) * 0.8;
      fy += ((best.y - pl.y) / bestD) * 0.8;
    }
  }
  // the field's edge and the middle: drift home when the crowd is thin
  const { width, height } = world.field;
  const margin = 220;
  if (pl.x < margin) fx += (margin - pl.x) / margin;
  if (pl.x > width - margin) fx -= (pl.x - (width - margin)) / margin;
  if (pl.y < margin) fy += (margin - pl.y) / margin;
  if (pl.y > height - margin) fy -= (pl.y - (height - margin)) / margin;
  let len = Math.hypot(fx, fy);
  if (len < 0.05) return { x: 0, y: 0 };
  fx /= len;
  fy /= len;
  // steer around ground it cannot cross
  for (let turn = 0; turn < 8; turn++) {
    const a = Math.atan2(fy, fx) + (turn % 2 ? 1 : -1) * Math.ceil(turn / 2) * (Math.PI / 6);
    const tx = pl.x + Math.cos(a) * 24;
    const ty = pl.y + Math.sin(a) * 24;
    if (costAt(world.field, pl.moveType, tx, ty) > 0) return { x: Math.cos(a), y: Math.sin(a) };
  }
  return { x: fx, y: fy };
}

/** Which choice the bot takes: better weapons first, then its own attack stat, then the rest. */
export function botChoice(world) {
  const choices = world.offer?.choices || [];
  const pl = world.player;
  const attack = pl.stats.MAG > pl.stats.STR ? 'MAG' : 'STR';
  const score = (c) => {
    if (c.kind === 'weapon') {
      const stat = world.config.weapons[c.id].stat;
      if (stat !== attack && c.level === 1) return 1;
      return c.level > 1 ? 10 + c.level : 6;
    }
    if (c.kind === 'passive') {
      const def = world.config.passives[c.id];
      if (def.stat === attack) return 8;
      if (def.stat === 'HP' || def.stat === 'DEF') return 5;
      if (def.stat === 'MAG' || def.stat === 'STR') return 0.5;
      return 3;
    }
    return 0;
  };
  let best = 0;
  choices.forEach((c, i) => {
    if (score(c) > score(choices[best])) best = i;
  });
  return best;
}
