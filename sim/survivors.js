// Balance sim for Darkest Before Dawn (docs/specs/survivors-mode.md): plays whole nights with
// the bot (engine/survivors/SurvivorsBot.js) for each lord and reports how long it lasts, the
// level it reaches, kills, crowd size and the damage each weapon did.
//   node sim/survivors.js [--trials N] [--seed S] [--lord Edric]
import { readFileSync } from 'node:fs';
import {
  createSurvivorsWorld,
  stepWorld,
  chooseOffer,
  drainEvents,
} from '../src/engine/survivors/SurvivorsSim.js';
import { botInput, botChoice } from '../src/engine/survivors/SurvivorsBot.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const gameData = {
  terrain: load('terrain.json'),
  lords: load('lords.json'),
  classes: load('classes.json'),
  weapons: load('weapons.json'),
  enemies: load('enemies.json'),
};
const config = load('survivors.json');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
// an upright phone's view of the field (world px), as SurvivorsScene shows it
const VIEW = { width: 400, height: 860 };
const trials = Number(arg('trials', 3));
const seed0 = Number(arg('seed', 1));
const lords = arg('lord', null) ? [arg('lord')] : gameData.lords.map((l) => l.name);

export function playNight(lordName, seed) {
  const world = createSurvivorsWorld({ config, gameData, lordName, seed, view: VIEW });
  let peak = 0;
  const marks = {};
  while (world.status === 'playing' || world.status === 'choosing') {
    if (world.status === 'choosing') chooseOffer(world, botChoice(world));
    else stepWorld(world, botInput(world));
    drainEvents(world);
    peak = Math.max(peak, world.enemies.length);
    const minute = Math.floor(world.t / 60);
    if (!marks[minute])
      marks[minute] = {
        level: world.player.level,
        enemies: world.enemies.length,
        hp: world.player.hp,
      };
  }
  return { world, peak, marks };
}

for (const lord of lords) {
  const rows = [];
  for (let i = 0; i < trials; i++) {
    const { world, peak } = playNight(lord, seed0 + i);
    rows.push({
      status: world.status,
      t: Math.round(world.t),
      level: world.player.level,
      kills: world.kills,
      peak,
      bosses: world.bossesDown,
      weapons: world.player.weapons.map((w) => `${w.id}${w.level}`).join(' '),
      dmg: Object.entries(world.damageByWeapon)
        .map(([k, v]) => `${k}:${v}`)
        .join(' '),
    });
  }
  const won = rows.filter((r) => r.status === 'won').length;
  const avgT = Math.round(rows.reduce((s, r) => s + r.t, 0) / rows.length);
  console.log(`${lord}: dawn ${won}/${rows.length}, avg ${avgT}s`);
  for (const r of rows) console.log('   ', JSON.stringify(r));
}
