// What headless play shows the player (tools/play): only what the player could know.
// Two battles that differ only by a unit the fog hides must read the same in every
// view, query and refusal; the event feed leaves out what happened out of sight.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { PlaySession } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';
import { knowledgeOf, movementTiles } from '../../tools/play/battleView.js';

const gameData = loadGameData();

async function foggedBattle() {
  const session = await PlaySession.create(gameData, { seed: 3 });
  for (const cmd of ['bless skip', 'go act1_0_2', 'start']) await session.exec(cmd);
  const b = session.game.battle.battle;
  b.grid.fogEnabled = true;
  b._refreshFogVisibility();
  return session;
}

/** The farthest tile from every player unit that the fog covers and nobody stands on. */
function hiddenTile(b) {
  const taken = new Set(
    [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].map((u) => `${u.col},${u.row}`),
  );
  let best = null;
  for (let r = 0; r < b.grid.rows; r++)
    for (let c = 0; c < b.grid.cols; c++) {
      if (b.grid.isVisible(c, r) || taken.has(`${c},${r}`)) continue;
      if (b.grid.getTerrainAt(c, r)?.defBonus === '--') continue;
      const d = Math.min(...b.playerUnits.map((u) => Math.abs(u.col - c) + Math.abs(u.row - r)));
      if (!best || d > best.d) best = { c, r, d };
    }
  return best;
}

async function answers(session) {
  const b = session.game.battle.battle;
  const known = knowledgeOf(b);
  const queries = ['look', 'help', 'roster', 'map'];
  for (const u of b.playerUnits) {
    queries.push(`options ${u.name}`, `unit ${u.name}`, `threat ${u.col},${u.row}`);
    const tiles = [...movementTiles(b, u).keys()];
    for (const e of b.enemyUnits.filter((x) => known.isKnown(x))) {
      queries.push(`unit ${e.name}`);
      for (const t of tiles.slice(0, 6))
        queries.push(`forecast ${u.name} ${t} ${session.game.battle.ids.id(e)}`);
    }
  }
  for (let r = 0; r < b.grid.rows; r += 3)
    for (let c = 0; c < b.grid.cols; c += 3) queries.push(`threat ${c},${r}`);
  const out = [];
  for (const q of queries) {
    try {
      out.push([q, await session.query(q)]);
    } catch (err) {
      if (!(err instanceof PlayError)) throw err;
      out.push([q, `REFUSED ${err.message}`]);
    }
  }
  out.push(['observe', JSON.stringify(session.observe())]);
  for (const cmd of ['move P1 99,99 wait', 'move P1 stay attack E99', 'move Nobody stay wait']) {
    try {
      await session.exec(cmd);
      out.push([cmd, 'played']);
    } catch (err) {
      if (!(err instanceof PlayError)) throw err;
      out.push([cmd, `REFUSED ${err.message}`]);
    }
  }
  return out;
}

describe('observations read what the player knows', () => {
  it('two battles differing only by a hidden enemy read the same everywhere', async () => {
    const without = await foggedBattle();
    const withHidden = await foggedBattle();
    const bA = without.game.battle.battle;
    const bB = withHidden.game.battle.battle;
    const spot = hiddenTile(bB);
    expect(spot).not.toBeNull();
    // The same non-boss enemy: gone in one world, hiding in the fog in the other.
    const index = bB.enemyUnits.findIndex((e) => !e.isBoss);
    bA.enemyUnits.splice(index, 1);
    const hidden = bB.enemyUnits[index];
    hidden.col = spot.c;
    hidden.row = spot.r;
    expect(knowledgeOf(bB).isKnown(hidden)).toBe(false);

    const a = await answers(without);
    const b = await answers(withHidden);
    expect(b.map(([q]) => q)).toEqual(a.map(([q]) => q));
    for (let i = 0; i < a.length; i++) expect(b[i][1], a[i][0]).toBe(a[i][1]);
  });

  it('marks fogged and status-only tiles in the options map, and never calls a tile safe', async () => {
    const session = await foggedBattle();
    const b = session.game.battle.battle;
    const unit = b.playerUnits[0];
    const text = await session.query(`options ${unit.name}`);
    expect(text).not.toMatch(/safe/);
    expect(text).toMatch(/\? = in fog, unknown/);
    const tiles = [...movementTiles(b, unit).keys()].map((k) => k.split(',').map(Number));
    const fogged = tiles.filter(([c, r]) => !b.grid.isVisible(c, r));
    expect(fogged.length).toBeGreaterThan(0);
    // The board row of a fogged reachable tile draws it as (?).
    const [c, r] = fogged[0];
    const rows = text.split('\n');
    const header = rows.findIndex((l) => /^ {4} *0 +1/.test(l));
    const line = rows[header + 1 + r];
    expect(line.slice(4 + c * 3, 7 + c * 3)).toBe('(?)');
  });
});

describe('the event feed reports what happened in sight', () => {
  it('an enemy the player strikes down in view is reported falling', async () => {
    const session = await foggedBattle();
    const b = session.game.battle.battle;
    const edric = b.playerUnits.find((u) => u.isCommander);
    const foe = b.enemyUnits.find((e) => !e.isBoss);
    const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
    b.grid.mapLayout[edric.row][edric.col + 1] = plain;
    Object.assign(foe, { col: edric.col + 1, row: edric.row, currentHP: 1 });
    b._refreshFogVisibility();
    session.game.battle._afterStep();
    const { lines } = await session.exec(
      `move Edric stay attack ${session.game.battle.ids.id(foe)}`,
    );
    expect(lines.join('\n')).toMatch(new RegExp(`${foe.name} falls`));
  });
});

describe('the event feed leaves out what happened out of sight', () => {
  async function feed(session, events) {
    const battle = session.game.battle;
    battle.events = events;
    battle._hpBefore = new Map();
    return { seen: battle._eventLines(), all: battle._eventLines({ omniscient: true }) };
  }

  it('an enemy healing an enemy in the fog leaves no trace; in view it is reported', async () => {
    const session = await foggedBattle();
    const [healer, target] = session.game.battle.battle.enemyUnits;
    const hidden = await feed(session, [
      { type: 'enemyHeal', healer, target, from: 5, to: 15, visible: new Set() },
    ]);
    expect(hidden.seen.join('\n')).not.toMatch(/heal|HP|unseen/i);
    expect(hidden.all.join('\n')).toMatch(/heals .*HP 5->15/);
    const shown = await feed(session, [
      { type: 'enemyHeal', healer, target, from: 5, to: 15, visible: new Set([target]) },
    ]);
    expect(shown.seen.join('\n')).toMatch(
      new RegExp(`an unseen ${healer.name} heals .*${target.name}: HP 5->15`),
    );
  });

  it('a fight between hidden units, or a hidden unit falling, is not reported; a fight with one in view is', async () => {
    const session = await foggedBattle();
    const b = session.game.battle.battle;
    const [foe, other] = b.enemyUnits;
    const ally = b.playerUnits[0];
    const fight = (attacker, defender, visible) => ({
      type: 'combat',
      attacker,
      defender,
      before: { a: 20, d: 20 },
      after: { a: 20, d: 12 },
      weapons: { a: 'Iron Axe', d: 'Iron Axe' },
      result: { events: [{ type: 'strike', attackerSide: 'attacker', damage: 8 }] },
      visible,
    });
    const hidden = await feed(session, [
      fight(foe, other, new Set()),
      { type: 'fell', unit: other, visible: new Set() },
    ]);
    expect(hidden.seen).toEqual([]);
    expect(hidden.all.join('\n')).toMatch(/attacks/);
    expect(hidden.all.join('\n')).toMatch(/falls/);
    const onAlly = await feed(session, [fight(foe, ally, new Set())]);
    expect(onAlly.seen.join('\n')).toMatch(
      new RegExp(`an unseen ${foe.name} .*attacks .*${ally.name}`),
    );
  });
});
