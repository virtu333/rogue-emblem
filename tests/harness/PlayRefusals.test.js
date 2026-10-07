// Why headless play refuses (tools/play): a refusal names the rule that stopped the
// order, so a playtest can tell its own mistake from a rule it did not know. From the
// seed-7 forks: a Vulnerary refused for a Wounded unit blamed full HP, an unreachable
// tile gave no cost, a far forecast blamed the tile, and two Vulneraries could not be
// told apart from the convoy's.

import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { PlaySession, digestOf } from '../../tools/play/session.js';
import { Game } from '../../tools/play/game.js';
import { PlayError } from '../../tools/play/parse.js';
import { ShopVisit } from '../../tools/play/services.js';
import { itemDetail, mapView, rosterView } from '../../tools/play/runView.js';
import { applyCondition } from '../../src/engine/StatusConditionSystem.js';

const gameData = loadGameData();
const consumable = (name) => structuredClone(gameData.consumables.find((c) => c.name === name));

/** A started battle with a 7x7 block of plain around Edric and nobody else in it. */
async function openBattle() {
  const session = await PlaySession.create(gameData, { seed: 3 });
  const opening = [];
  for (const cmd of ['bless skip', 'go act1_0_2', 'start'])
    opening.push(...(await session.exec(cmd)).lines);
  const b = session.game.battle.battle;
  const edric = b.playerUnits.find((u) => u.name === 'Edric');
  const sera = b.playerUnits.find((u) => u.name === 'Sera');
  const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
  Object.assign(edric, { col: 3, row: 3 });
  for (let y = 0; y <= 6; y++) for (let x = 0; x <= 6; x++) b.grid.mapLayout[y][x] = plain;
  for (const u of [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits])
    if (u !== edric && u.col <= 6 && u.row <= 6) u.col = 9 + (u.col % 3);
  Object.assign(sera, { col: 3, row: 4 });
  return { session, b, edric, sera, opening: opening.join('\n') };
}

async function refusal(session, cmd) {
  const before = digestOf(session.game);
  const err = await session.exec(cmd).then(
    () => null,
    (e) => e,
  );
  expect(err, cmd).toBeInstanceOf(PlayError);
  expect(digestOf(session.game), `${cmd} changed nothing`).toBe(before);
  return err.message;
}

describe('battle refusals name their rule', () => {
  it('the opening line maps each id to its unit', async () => {
    const { b, session, opening } = await openBattle();
    const ids = b.playerUnits.map((u) => `${session.game.battle.ids.id(u)} ${u.name}`);
    expect(ids.length).toBeGreaterThan(1);
    expect(opening).toContain(`Ids are new each battle: ${ids.join(', ')}.`);
  });

  it('a heal item: full HP, Wounded, or carried by someone else', async () => {
    const { session, edric } = await openBattle();
    edric.consumables = [consumable('Vulnerary')];
    edric.currentHP = edric.stats.HP;
    expect(await refusal(session, 'move Edric stay item Vulnerary')).toMatch(/Edric is at full HP/);
    expect(await refusal(session, 'move Edric stay item Vulnerary on Sera')).toMatch(
      /Vulnerary heals only the unit that carries it/,
    );
    edric.currentHP = 5;
    applyCondition(edric, 'wounded', 1);
    expect(await session.query('look')).toMatch(
      /Edric \(Lord, commander\) Lv\d+ \d+xp HP 5\/\d+ \(Wounded\)/,
    );
    expect(await refusal(session, 'move Edric stay item Vulnerary')).toMatch(
      /Edric is Wounded and recovers no HP except from a staff/,
    );
    edric._conditions = [];
    await session.exec('move Edric stay item Vulnerary');
    expect(edric.currentHP).toBeGreaterThan(5);
  });

  it('a cure: nothing to cure, or the ally is not beside the tile', async () => {
    const { session, edric, sera } = await openBattle();
    edric.consumables = [consumable('Herb')];
    expect(await refusal(session, 'move Edric stay item Herb on Sera')).toMatch(
      /Sera has no condition to cure/,
    );
    applyCondition(sera, 'wounded', 1);
    expect(await refusal(session, 'move Edric 3,1 item Herb on Sera')).toMatch(
      /Sera is not adjacent to 3,1/,
    );
    await session.exec('move Edric stay item Herb on Sera');
    expect(sera._conditions).toEqual([]);
  });

  it('a move: who stands there, what the terrain allows, what the path costs', async () => {
    const { session, b, edric } = await openBattle();
    expect(await refusal(session, 'move Edric 3,4 wait')).toMatch(/Sera stands on 3,4/);
    const mov = edric.mov ?? edric.stats.MOV;
    // Straight along the cleared row and then off its end: one movement a plain tile.
    expect(mov).toBeLessThan(6);
    // 6,6 is |dx| + |dy| = 3 + 3 away over plain (1 each) with nobody between.
    expect(await refusal(session, 'move Edric 6,6 wait')).toMatch(
      new RegExp(`the shortest open path costs 6 movement; Edric has MOV ${mov}`),
    );
    const wall = b.gameData.terrain.findIndex((t) => t.moveCost?.Infantry === '--');
    expect(wall).toBeGreaterThanOrEqual(0);
    b.grid.mapLayout[2][3] = wall;
    expect(await refusal(session, 'move Edric 3,2 wait')).toMatch(
      new RegExp(`${b.gameData.terrain[wall].name} is impassable for Infantry units`),
    );
  });

  it('after a move is locked in, a new tile is refused for that reason', async () => {
    const { session, edric, sera } = await openBattle();
    await session.exec('move Edric stay trade Sera give Vulnerary');
    expect(sera.consumables.some((i) => i.name === 'Vulnerary')).toBe(true);
    expect(await refusal(session, 'move Edric 2,3 wait')).toMatch(
      /Edric has already moved; it may act only where it stands/,
    );
    expect(edric.hasActed).toBe(false);
  });

  it('a forecast out of reach gives the distance and each weapon reach', async () => {
    const { session, b, edric } = await openBattle();
    const foe = b.enemyUnits.find((e) => !e.isBoss);
    Object.assign(foe, { col: 6, row: 3 });
    session.game.battle._afterStep(); // the foe in view gets its id
    const id = session.game.battle.ids.id(foe);
    const text = await session.query(`forecast Edric 3,3 ${id}`).then(
      () => '',
      (e) => e.message,
    );
    const w = edric.weapon;
    expect(text).toContain(`${foe.name} is 3 tile(s) from 3,3; reach: ${w.name} 1-1`);
    // From a tile Edric cannot reach this turn, but beside the foe: a forecast.
    expect(await session.query(`forecast Edric 5,3 ${id}`)).toMatch(/Edric/);
  });
});

describe('route-map refusals and texts', () => {
  async function startedGame(seed = 3) {
    const game = new Game(gameData, { seed });
    await game.run(() => game.start());
    await game.run(() => game.exec('bless skip'));
    return game;
  }

  it('two different Vulneraries are told apart by who holds them and their uses', async () => {
    const game = await startedGame();
    const edric = game.rm.roster.find((u) => u.name === 'Edric');
    const mine = consumable('Vulnerary');
    const theirs = { ...consumable('Vulnerary'), uses: 1 };
    edric.consumables = [mine];
    game.rm.convoy.consumables.push(theirs);
    const err = await game
      .run(() => game.exec('use Edric Vulnerary'))
      .then(
        () => null,
        (e) => e,
      );
    expect(err).toBeInstanceOf(PlayError);
    expect(err.message).toMatch(
      new RegExp(
        `#1 Vulnerary \\[Edric's\\] \\(${mine.uses} uses left\\); #2 Vulnerary \\[convoy\\] \\(1 use left\\)`,
      ),
    );
  });

  it('an accessory bought for the convoy goes to the pool; a weapon is never pooled', async () => {
    const game = await startedGame();
    const rm = game.rm;
    rm.gold = 99999;
    const node = rm.nodeMap.nodes.find((n) => n.type === 'shop' && !n.isAmbush);
    await game.run(() => {
      const visit = new ShopVisit(game, node);
      visit.open();
      const accessory = gameData.accessories[0];
      visit.stock.push({ type: 'accessory', item: structuredClone(accessory), price: 100 });
      const out = visit.exec('buy', [...accessory.name.split(' '), 'for', 'convoy']);
      expect(rm.accessories.map((a) => a.name)).toContain(accessory.name);
      expect(out.lines.join('\n')).toMatch(/accessories are kept in the accessory pool/);
      const weapon = visit.stock.find((e) => e.type !== 'accessory' && e.type !== 'scroll');
      const gold = rm.gold;
      expect(() => visit.exec('buy', [...weapon.item.name.split(' '), 'for', 'pool'])).toThrow(
        /Only accessories and scrolls are pooled/,
      );
      expect(rm.gold).toBe(gold);
    });
  });

  it('forge stones list their choices; the Eclipse and Vision lines say what is so', async () => {
    const game = await startedGame();
    const rm = game.rm;
    const prismatic = { name: 'Prismatic Stone', type: 'Whetstone', imbueId: 'choice' };
    const text = itemDetail(prismatic, gameData);
    for (const imbue of gameData.imbues.imbues)
      expect(text).toContain(`${imbue.id} (${imbue.name}:`);
    const silver = gameData.whetstones.find((w) => w.forgeStat === 'choice');
    expect(itemDetail(silver, gameData)).toMatch(/might, hit, crit or weight/);

    expect(rosterView(rm, gameData)).not.toMatch(/not modelled/);
    rm.isEclipseActive = () => true;
    const view = rm.getEclipseView.bind(rm);
    rm.getEclipseView = (opts) => ({ ...(view(opts) || {}), shadow: 7, cap: 100, nextFall: null });
    expect(mapView(rm, { gameData })).toMatch(/no node within reach can fall this act/);
    expect(mapView(rm, { gameData })).not.toMatch(/null/);
  });
});
