// FinaleRally — who answers when the Entity's finale starts, and with what line.
//
// Pure (no Phaser, no RNG stream): picks are hashed from the run seed, so a
// run always hears the same rally. Lines live in dialogue.json `finaleRally`:
//
//   lords.<Lord>.open     the first speaker (the commander, when on the field)
//   lords.<Lord>.lines    general rally lines
//   lords.<Lord>.reply    { <Other lord>: line } — answering whoever just spoke
//   lords.<Lord>.memory   this save has met the Entity before (the loop)
//   lords.<Lord>.wounded  the speaker is below half HP
//   lords.<Lord>.fallen   someone fell earlier this run ({fallen})
//
// When the run has lost someone, one answering lord always speaks for them;
// when the save remembers the Entity, another carries the memory.
//   lords.Sera.close      Sera, whose sight the Thread is, speaks last
//   recruits.<temperament> up to two recruits (the strongest) join in ({leader})
//
// Order: the commander opens, the other lords follow as they stand, then the
// recruits, and Sera closes. At most RALLY_MAX_LINES, so the rally ends inside
// the finale's first strain.

import { temperamentFor, voiceHash } from './UnitVoice.js';

export const RALLY_MAX_LINES = 7;
export const RALLY_MAX_RECRUITS = 2;
// a line that says the Entity is bleeding only plays once it has been wounded
// (turn pressure can start the finale before anyone lands a blow)
const WOUND_WORDS = /\b(bleed|bleeds|bleeding|bled)\b/i;

function usable(list, { hurt }) {
  if (!Array.isArray(list)) return [];
  return list.filter((l) => typeof l === 'string' && l.trim() && (hurt || !WOUND_WORDS.test(l)));
}

function pick(list, key) {
  return list.length ? list[voiceHash(key) % list.length] : null;
}

function chance(key, percent) {
  return voiceHash(key) % 100 < percent;
}

function fill(line, tokens) {
  return line
    .replaceAll('{fallen}', tokens.fallen ?? '')
    .replaceAll('{leader}', tokens.leader ?? '')
    .replaceAll('{name}', tokens.name ?? '');
}

const alive = (u) => u?.faction === 'player' && Number(u.currentHP) > 0;
const belowHalf = (u) => Number(u?.stats?.HP) > 0 && Number(u.currentHP) * 2 < Number(u.stats.HP);

/**
 * The speakers, in order: [{ unit, role: 'open' | 'lord' | 'recruit' | 'close' }].
 */
export function finaleRallySpeakers(units, { pool = null, commander = null } = {}) {
  const lordsPool = pool?.lords || {};
  const recruitsPool = pool?.recruits || {};
  const list = Array.isArray(units) ? units : [];
  const lords = list.filter((u) => u?.isLord && alive(u) && lordsPool[u.name]);
  const hasRecruitLines = Object.values(recruitsPool).some((l) => Array.isArray(l) && l.length);
  const recruits = hasRecruitLines
    ? list
        .filter((u) => !u?.isLord && alive(u) && typeof u.name === 'string')
        .sort(
          (a, b) => (Number(b.level) || 0) - (Number(a.level) || 0) || (a.name < b.name ? -1 : 1),
        )
        .slice(0, RALLY_MAX_RECRUITS)
    : [];
  const opener =
    lords.find((u) => u.name === commander) || lords.find((u) => u.name !== 'Sera') || lords[0];
  const sera = lords.find((u) => u.name === 'Sera' && u !== opener && lordsPool.Sera?.close);
  const middle = [...lords.filter((u) => u !== opener && u !== sera), ...recruits];
  const room = RALLY_MAX_LINES - (opener ? 1 : 0) - (sera ? 1 : 0);
  const out = [];
  if (opener) out.push({ unit: opener, role: 'open' });
  for (const unit of middle.slice(0, Math.max(0, room))) {
    out.push({ unit, role: unit.isLord ? 'lord' : 'recruit' });
  }
  if (sera) out.push({ unit: sera, role: 'close' });
  return out;
}

/**
 * The rally: [{ unit, speaker, line, category }] in speaking order.
 * @param {object} opts
 * @param {object[]} opts.units      the living battle units (player side is used)
 * @param {object} opts.pool         dialogue.json finaleRally
 * @param {object} [opts.voice]      dialogue.json unitVoice (recruit temperaments)
 * @param {string} [opts.commander]  the run's commander (opens the rally)
 * @param {number} [opts.seed]       the run seed
 * @param {boolean} [opts.memory]    this save has met the Entity before
 * @param {string[]} [opts.fallen]   names of units lost earlier this run (lords first)
 * @param {boolean} [opts.hurt]      the Entity has been wounded
 */
export function composeFinaleRally({
  units,
  pool,
  voice = null,
  commander = null,
  seed = 0,
  memory = false,
  fallen = [],
  hurt = true,
} = {}) {
  const lordsPool = pool?.lords || {};
  const speakers = finaleRallySpeakers(units, { pool, commander });
  const fallenName = (Array.isArray(fallen) ? fallen : []).find(
    (n) => typeof n === 'string' && n.trim(),
  );
  const leader = commander || speakers.find((s) => s.role === 'open')?.unit?.name || null;
  const s = seed >>> 0;
  // The run's memories are never left to chance: one answering lord speaks
  // for the fallen, another (when there is one) for the loop.
  const answering = speakers.filter((x) => x.role === 'lord').map((x) => x.unit);
  const pickOne = (list, tag) =>
    list.length ? list[voiceHash(`${s}|finale|${tag}`) % list.length] : null;
  const forFallen = fallenName ? pickOne(answering, 'fallen') : null;
  const forMemory = memory
    ? pickOne(
        answering.filter((u) => u !== forFallen),
        'memory',
      )
    : null;
  const out = [];
  let prev = null;
  for (const { unit, role } of speakers) {
    const name = unit.name;
    const key = (cat) => `${s}|finale|${name}|${cat}`;
    let category = null;
    let line = null;
    const choose = (cat, list) => {
      if (line) return;
      const l = pick(list, key(cat));
      if (l) {
        line = l;
        category = cat;
      }
    };
    if (role === 'recruit') {
      const temper = temperamentFor(unit, { voice, seed: s });
      const own = usable(pool?.recruits?.[temper], { hurt });
      const any = Object.values(pool?.recruits || {}).flatMap((l) => usable(l, { hurt }));
      choose('recruit', own.length ? own : any);
    } else {
      const lp = lordsPool[name] || {};
      const opt = (list) => usable(list, { hurt });
      if (role === 'open') choose('open', opt(lp.open));
      if (role === 'close') choose('close', opt(lp.close));
      if (unit === forFallen) choose('fallen', opt(lp.fallen));
      if (unit === forMemory) choose('memory', opt(lp.memory));
      // answer whoever just spoke, most of the time
      const reply = prev?.isLord ? lp.reply?.[prev.name] : null;
      if (role === 'lord' && reply && chance(key('reply'), 67)) choose('reply', opt([reply]));
      if (belowHalf(unit) && chance(key('wounded'), 60)) choose('wounded', opt(lp.wounded));
      choose('lines', opt(lp.lines));
    }
    if (line) {
      out.push({
        unit,
        speaker: name,
        category,
        line: fill(line, { fallen: fallenName, leader, name }),
      });
      prev = unit;
    }
  }
  return out;
}
