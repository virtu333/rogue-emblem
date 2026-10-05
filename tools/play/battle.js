// One battle of a headless play session (tools/play): the harness's battle
// (tests/harness/HeadlessBattle.js) entered the way BattleScene enters it, driven by
// whole-unit commands, with every consequence written down as events, and settled
// at victory the way PostCombatController settles it.

import { GameDriver } from '../../tests/harness/GameDriver.js';
import { HEADLESS_STATES } from '../../tests/harness/HeadlessBattle.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { generateBattle } from '../../src/engine/MapGenerator.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { createBattleRng } from '../../src/engine/BattleRng.js';
import { battleDeployCount } from '../../src/engine/BattleDeployCount.js';
import { serializeUnit } from '../../src/engine/RunManager.js';
import { unitIdentityKey, unitUidOf } from '../../src/engine/UnitIdentity.js';
import { fallenBattleRecruits } from '../../src/engine/BattleRecruits.js';
import { recordBattleParticipation } from '../../src/engine/MasterySystem.js';
import { getLatePressureState } from '../../src/engine/TurnBonusCalculator.js';
import { prepareBattleRewards } from '../../src/engine/PendingBattleRewards.js';
import { prepareBossRecruit } from '../../src/engine/PendingBossRecruit.js';
import { prepareThirdLord } from '../../src/engine/PendingThirdLord.js';
import { gridDistance } from '../../src/engine/Combat.js';
import { canEquip, equipWeapon } from '../../src/engine/UnitManager.js';
import { validateConsumable } from '../../src/engine/ConsumableSettlement.js';
import { GOLD_BATTLE_BONUS, NODE_TYPES } from '../../src/utils/constants.js';
import {
  createStandingRules,
  formationActive,
  formationCushion,
  formationRng,
  pickFormationSpares,
  placeUnit,
  playerSpawnBounds,
  unitOnTile,
} from '../../src/engine/FormationPlacement.js';
import { isEntity } from '../../src/engine/EntitySystem.js';
import {
  UnitIds,
  affixLines,
  renderBoard,
  artChoices,
  battleView,
  forecastText,
  isAreaCenter,
  knowledgeOf,
  movementTiles,
  optionsView,
  skillNames,
  threatView,
  tileKey,
  unitLines,
  weaponsReaching,
  defaultWeapon,
} from './battleView.js';
import { PlayError, findItem, parseTile, splitClauses } from './parse.js';

const ACTION_VERBS = new Set([
  'wait',
  'attack',
  'heal',
  'item',
  'talk',
  'seize',
  'escape',
  'smash',
  'strike',
]);

const AUTO_TURN_CAP = 40;

/** Counts the draws a stream makes (part of a session's state hash). */
export function countingRng(fn) {
  const rng = () => {
    rng.calls++;
    return fn();
  };
  rng.calls = 0;
  return rng;
}

export class PlayBattle {
  /**
   * @param {object} game the session's game (gameData, rm, setRandom)
   * @param {object} node the route node
   * @param {object[]} deployed roster clones to field, in roster order
   * @param {object[]} bench roster clones left behind
   */
  constructor(game, node, deployed, bench) {
    this.game = game;
    this.node = node;
    this.bench = bench;
    this.ids = new UnitIds();
    this.events = [];
    this.agent = null;
    // Whether the last order ended the player phase on its own (the end-again guard).
    this._autoEnded = false;
    this.isBoss = node.type === NODE_TYPES.BOSS;
    const rm = game.rm;
    const gameData = game.gameData;

    // Battle params as BattleScene receives them (NodeMapScene.handleBattle), plus the
    // run inputs the harness reads from its params where the scene reads the run
    // (as RunSimulationDriver supplies them).
    const bp = rm.getBattleParams(node) || {};
    bp.metaEffects = structuredClone(rm.getEffectiveMetaEffects?.() ?? rm.metaEffects ?? null);
    bp.extendedLevelingEnabled =
      rm.getDifficultyModifier?.('extendedLevelingEnabled', false) === true;
    bp.blessingXpDelta = rm.getXpMultiplierDelta?.() || 0;
    bp.fallenUnits = structuredClone(rm.fallenUnits || []);
    if (node.type === NODE_TYPES.RECRUIT) {
      const ctx = rm.getRecruitBattleContext(node);
      bp.recruitNodeId = ctx.nodeId;
      bp.recruitRunSeed = ctx.runSeed;
      bp.recruitRoster = structuredClone(ctx.roster);
      bp.startingLordNames = ctx.startingLordNames;
      bp.recruitLevelBonus = ctx.recruitLevelBonus;
      bp.deployBonus = ctx.deployBonus;
    }
    bp.deployCount = battleDeployCount({ deployedRoster: deployed });
    bp.isBoss = this.isBoss;
    bp.battleNumber = (rm.completedBattles || 0) + 1;
    this.isElite = Boolean(bp.isElite);
    this.battleParams = bp;

    // The map: the node's locked config, else generated on the battle seed and locked
    // (BattleScene.beginBattle).
    let config = rm.getLockedBattleConfig?.(node.id);
    if (!config) {
      const seed = Number.isFinite(bp.battleSeed) ? bp.battleSeed : deriveSeed(rm.runSeed, node.id);
      const prev = Math.random;
      Math.random = createSeededRng(seed >>> 0);
      try {
        config = generateBattle(bp, gameData);
      } finally {
        Math.random = prev;
      }
      rm.lockBattleConfig?.(node.id, config);
    }

    // The battle's own stream (BattleScene.installBattleRng), installed before units spawn.
    const rngSeed = Number.isFinite(rm.rngSeed)
      ? rm.rngSeed >>> 0
      : deriveSeed(rm.runSeed, node.id);
    rm.rngSeed = rngSeed;
    this.rng = countingRng(createBattleRng(rngSeed));
    game.setRandom(this.rng);

    this.driver = new GameDriver(gameData, bp, deployed);
    this.battle = this.driver.battle;
    this.battle.runManager = rm;
    this._instrument();
    // Outside the instrumentation, so a unit that does not fall is never reported falling.
    if (game.options.invincible) this._makeInvincible();
    this.battle.init({ battleConfig: config });
    this._afterStep();
    this.events.push({ type: 'start' });
    this.formation = this._openFormation();
    if (this.formation) this.events.push({ type: 'formation' });
  }

  /**
   * Formation (FormationController): before turn 1 the player chooses who stands on
   * which spawn tile, among the spawns and the spares drawn on their own stream. The
   * army starts on its default tiles (Auto-place's seeds), so "start" alone keeps them.
   */
  _openFormation() {
    const b = this.battle;
    const bc = b.battleConfig;
    const units = [...b.playerUnits];
    if (
      !formationActive({
        deployCount: units.length,
        disabled: !bc.playerSpawns?.length || units.some((u) => isEntity(u)),
      })
    )
      return null;
    const gd = this.game.gameData;
    const spawns = bc.playerSpawns.map(({ col, row }) => ({ col, row }));
    const template = Object.values(gd.mapTemplates || {})
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .find((t) => t?.id === bc.templateId);
    const occupied = [
      ...b.enemyUnits,
      ...b.npcUnits,
      bc.npcSpawn,
      bc.caravanSpawn,
      bc.villageTile,
      bc.thronePos,
      ...(bc.escapeTiles || []),
      ...(bc.ballistas || []),
    ].filter((t) => Number.isInteger(t?.col) && Number.isInteger(t?.row));
    const seed = [
      this.game.rm.runSeed ?? 0,
      this.node.id ?? this.battleParams?.act ?? 'battle',
      bc.templateId ?? '',
      units.length,
      'formation',
    ].join(':');
    const spares = Array.isArray(bc.formationSpares)
      ? bc.formationSpares.map(({ col, row }) => ({ col, row }))
      : pickFormationSpares({
          mapLayout: b.grid.mapLayout,
          cols: b.grid.cols,
          rows: b.grid.rows,
          terrainData: gd.terrain,
          spawns,
          bounds: playerSpawnBounds(template, b.grid.cols, b.grid.rows),
          blocked: occupied,
          enemies: b.enemyUnits.map((u) => ({ col: u.col, row: u.row })),
          moveTypes: units.map((u) => u.moveType || 'Infantry'),
          count: formationCushion(units.length),
          rng: formationRng(seed),
        });
    const tiles = [...spawns, ...spares];
    const ctx = {
      mapLayout: b.grid.mapLayout,
      cols: b.grid.cols,
      rows: b.grid.rows,
      terrainData: gd.terrain,
    };
    const rules = createStandingRules(ctx, tiles);
    const leniency = units.map((u) => {
      const mt = u.moveType || 'Infantry';
      if (tiles.some((_, t) => !rules.issue(mt, t))) return 'strict';
      const enterable = tiles.some((t) =>
        Number.isFinite(Number(gd.terrain?.[ctx.mapLayout?.[t.row]?.[t.col]]?.moveCost?.[mt])),
      );
      return enterable ? 'enter' : 'any';
    });
    const issue = (u, t) => {
      const mode = leniency[u];
      if (mode === 'any') return '';
      const reason = rules.issue(units[u].moveType || 'Infantry', t);
      if (!reason) return '';
      if (mode === 'enter' && /boxed in/.test(reason)) return '';
      return reason;
    };
    const at = units.map((u) => tiles.findIndex((t) => t.col === u.col && t.row === u.row));
    return { units, tiles, at, issue };
  }

  formationView() {
    const f = this.formation;
    const marks = new Map(f.tiles.map((t, i) => [tileKey(t.col, t.row), i]));
    const lines = [
      '== FORMATION · before turn 1, choose who stands where ==',
      'Formation tiles are marked + (empty). "place <unit> <x,y>" moves a unit there (a unit already there swaps into its old tile); "start" begins the battle.',
      renderBoard(this.battle, this.ids, {
        overlay: (c, r) => (marks.has(tileKey(c, r)) ? '+' : null),
      }),
      'Tiles: ' +
        f.tiles
          .map(
            (t, i) =>
              `${t.col},${t.row}${unitOnTile({ at: f.at }, i) === -1 ? '' : `=${this.ids.id(f.units[unitOnTile({ at: f.at }, i)])}`}`,
          )
          .join(' '),
    ];
    return lines.join('\n');
  }

  _execFormation(verb, words) {
    const f = this.formation;
    const b = this.battle;
    if (verb === 'start') {
      this.formation = null;
      b._refreshFogVisibility();
      this.events.push({ type: 'formationDone' });
      return;
    }
    if (verb !== 'place')
      throw new PlayError('Formation first: "place <unit> <x,y>" to rearrange, then "start".');
    const unit = this.ids.resolve(words[0], f.units, 'unit of yours');
    const tile = parseTile(words[1]);
    const t = f.tiles.findIndex((x) => x.col === tile.col && x.row === tile.row);
    if (t === -1)
      throw new PlayError(
        `${tile.col},${tile.row} is not a formation tile (${f.tiles.map((x) => `${x.col},${x.row}`).join(' ')}).`,
      );
    const u = f.units.indexOf(unit);
    const reason = f.issue(u, t);
    if (reason) throw new PlayError(reason);
    const next = placeUnit({ tiles: f.tiles, at: f.at }, u, t, (o, x) => !f.issue(o, x));
    // A displaced unit that cannot take the vacated tile goes to the nearest free one it may use.
    for (const [i, at] of next.at.entries()) {
      if (at !== null) continue;
      const free = f.tiles.findIndex((_, x) => !next.at.includes(x) && !f.issue(i, x));
      if (free === -1) throw new PlayError(`No tile left for ${f.units[i].name}.`);
      next.at[i] = free;
    }
    f.at = next.at;
    for (const [i, unitAt] of f.at.entries()) {
      f.units[i].col = f.tiles[unitAt].col;
      f.units[i].row = f.tiles[unitAt].row;
    }
    b._refreshFogVisibility();
    this.events.push({ type: 'placed', unit, tile });
  }

  get b() {
    return this.battle;
  }

  /** As RunSimulationDriver's invincibility: a player unit at 0 HP stays at 1. */
  _makeInvincible() {
    const b = this.battle;
    const remove = b._removeUnit.bind(b);
    b._removeUnit = (unit, options) => {
      if (unit?.faction === 'player') {
        unit.currentHP = Math.max(1, unit.currentHP || 1);
        return undefined;
      }
      return remove(unit, options);
    };
    const checkEnd = b._checkBattleEnd.bind(b);
    b._checkBattleEnd = () => {
      for (const u of b.playerUnits) if (u.currentHP <= 0) u.currentHP = 1;
      return checkEnd();
    };
  }

  get over() {
    return this.battle.result !== null;
  }

  get title() {
    const rm = this.game.rm;
    return `${rm.currentAct} · node ${this.node.id} (${this.node.type}${this.isElite ? ', elite' : ''})`;
  }

  view() {
    const main = battleView(this.battle, this.ids, { title: this.title });
    return this.formation ? `${main}\n\n${this.formationView()}` : main;
  }

  // --- queries (never change state) ---

  query(verb, words) {
    const b = this.battle;
    switch (verb) {
      case 'options': {
        const unit = this.ids.resolve(words[0], b.playerUnits, 'unit of yours');
        return optionsView(b, this.ids, unit, { limit: Number(words[1]) || 3 });
      }
      case 'forecast': {
        // forecast <unit> <x,y> <target> [with <weapon>] [art <art>]
        const { head, clauses } = splitClauses(words, ['with', 'art']);
        if (head.length < 3)
          throw new PlayError('Usage: forecast <unit> <x,y> <target> [with <weapon>] [art <art>]');
        const unit = this.ids.resolve(head[0], b.playerUnits, 'unit of yours');
        const tile = parseTile(head[1], unit);
        const target = this.ids.resolve(
          head.slice(2).join(' '),
          this._knownEnemies(),
          'visible enemy',
        );
        const reaching = weaponsReaching(b, unit, target, tile.col, tile.row);
        if (!reaching.length)
          throw new PlayError(
            `${unit.name} cannot reach ${target.name} from ${tile.col},${tile.row}.`,
          );
        const weapon = clauses.with
          ? findItem(reaching, clauses.with, 'weapon in reach')
          : defaultWeapon(unit, reaching);
        const art = clauses.art ? this._resolveArt(unit, weapon, clauses.art).art : null;
        return forecastText(b, this.ids, unit, target, {
          col: tile.col,
          row: tile.row,
          weapon,
          art,
        });
      }
      case 'threat': {
        const tile = parseTile(words[0]);
        const mover = words[1] ? this.ids.resolve(words[1], b.playerUnits, 'unit of yours') : null;
        return threatView(b, this.ids, tile.col, tile.row, mover);
      }
      case 'unit': {
        const pool = [...b.playerUnits, ...this._knownEnemies(), ...this._knownNpcs()];
        const unit = this.ids.resolve(words.join(' '), pool);
        return unitLines(b, this.ids, unit, { detail: true }).join('\n');
      }
      default:
        return null;
    }
  }

  _knownEnemies() {
    const known = knowledgeOf(this.battle);
    return this.battle.enemyUnits.filter((u) => known.isKnown(u));
  }

  _knownNpcs() {
    const known = knowledgeOf(this.battle);
    return this.battle.npcUnits.filter((u) => known.isKnown(u));
  }

  // --- commands ---

  /** Runs one battle command. Returns event lines. Throws PlayError on a refusal. */
  async exec(verb, words) {
    this.events = [];
    this._hpBefore = this._hpSnapshot();
    const b = this.battle;
    if (b.battleState !== HEADLESS_STATES.PLAYER_IDLE)
      throw new Error(`Battle is not waiting for orders (${b.battleState}).`);
    if (this.formation) {
      if (verb === 'auto') this._execFormation('start', []);
      else {
        this._execFormation(verb, words);
        this._afterStep();
        return this._feeds();
      }
    }
    // A turn the last order ended on its own (every unit had acted): an "end" straight
    // after it would throw the next turn away, the usual slip in a chain of orders.
    const autoEnded = this._autoEnded;
    try {
      this._autoEnded = false;
      if (verb === 'move') await this._move(words);
      else if (verb === 'end') {
        if (
          autoEnded &&
          !['again', 'anyway'].includes(String(words[0]).toLowerCase()) &&
          b.playerUnits.every((u) => !u.hasActed)
        )
          throw new PlayError(
            `Turn ${b.turnManager.turnNumber - 1} already ended when every unit had acted. "end" now would skip turn ${b.turnManager.turnNumber} without a move; say "end again" if you mean it.`,
          );
        await b.endTurn();
        await this._settlePhases();
      } else if (verb === 'auto') await this._auto(words[0] || 'turn');
      else throw new PlayError(`Unknown battle command "${verb}". Try "help".`);
    } catch (err) {
      this._autoEnded = autoEnded; // a refusal changes nothing, this included
      throw err;
    }
    this._afterStep();
    return this._feeds();
  }

  /** The player's feed (returned) and the omniscient one (`diagnostics`, never shown in play). */
  _feeds() {
    this.diagnostics = this._eventLines({ omniscient: true });
    return this._eventLines();
  }

  async _move(words) {
    const b = this.battle;
    // move <unit> <x,y|stay> [equip <weapon>] <action> [args]
    if (words.length < 3) throw new PlayError('Usage: move <unit> <x,y|stay> <action> ...');
    const unit = this.ids.resolve(words[0], b.playerUnits, 'unit of yours');
    if (unit.hasActed) throw new PlayError(`${unit.name} has already acted this turn.`);
    const tile = parseTile(words[1], unit);
    let rest = words.slice(2);
    let equip = null;
    if (rest[0]?.toLowerCase() === 'equip') {
      const at = rest.findIndex((w, i) => i > 0 && ACTION_VERBS.has(w.toLowerCase()));
      if (at < 0)
        throw new PlayError('After "equip <weapon>" name the action (wait, attack, ...).');
      equip = findItem(
        (unit.inventory || []).filter((w) => w.type !== 'Scroll' && w.type !== 'Consumable'),
        rest.slice(1, at).join(' '),
        'weapon',
      );
      if (!canEquip(unit, equip)) throw new PlayError(`${unit.name} cannot equip ${equip.name}.`);
      rest = rest.slice(at);
    }
    const action = (rest[0] || '').toLowerCase();
    if (!ACTION_VERBS.has(action))
      throw new PlayError(
        `Unknown action "${rest[0] || ''}". Actions: ${[...ACTION_VERBS].join(', ')}.`,
      );
    const args = rest.slice(1);

    const tiles = movementTiles(b, unit);
    if (!tiles.has(tileKey(tile.col, tile.row)))
      throw new PlayError(
        `${unit.name} cannot stop on ${tile.col},${tile.row}. Use "options ${this.ids.id(unit)}".`,
      );

    // Validate the whole order before anything moves, so a refusal changes nothing.
    const plan = this._planAction(unit, tile, action, args, equip);

    const from = { col: unit.col, row: unit.row };
    b.selectUnit(unit);
    // A unit whose move is locked in (it was ambushed) opens on its menu.
    if (b.battleState === HEADLESS_STATES.UNIT_SELECTED) b.moveTo(tile.col, tile.row);
    const ambush = b.lastAmbush;
    if (ambush) {
      // BattleScene: the move stops short and the unit is still to act. The order's
      // action was planned for another tile, so it is not carried out.
      this.events.push({ type: 'order', unit, from, tile: ambush.stop, action: null, args, equip });
      this.events.push({ type: 'ambush', unit, ambusher: ambush.ambusher, planned: tile });
      b.cancel(); // Back from a locked-in move only deselects.
      return;
    }
    if (equip) b.equipFromMenu(equip);
    this.events.push({ type: 'order', unit, from, tile, action, args, equip });
    plan();
    if (!this.over && b.battleState === HEADLESS_STATES.ENEMY_PHASE) {
      this.events.push({ type: 'allActed' });
      this._autoEnded = true;
    }
    await this._settlePhases();
  }

  /** Checks an order against the board with the unit on its destination; returns its commit. */
  _planAction(unit, tile, action, args, equip) {
    const b = this.battle;
    const at = (fn) =>
      withUnitAt(unit, tile, equip, () => {
        b.selectedUnit = unit;
        try {
          return fn();
        } finally {
          b.selectedUnit = null;
        }
      });
    const menu = () => {
      b.battleState = HEADLESS_STATES.UNIT_ACTION_MENU;
      try {
        return b.getAvailableActions().map((a) => a.label);
      } finally {
        b.battleState = HEADLESS_STATES.PLAYER_IDLE;
      }
    };
    switch (action) {
      case 'wait':
        return () => b.chooseAction('Wait');
      case 'attack': {
        const { head, clauses } = splitClauses(args, ['with', 'art']);
        if (!head.length) throw new PlayError('attack <target> [with <weapon>] [art <art>]');
        const target = this.ids.resolve(head.join(' '), this._knownEnemies(), 'visible enemy');
        const reaching = weaponsReaching(b, unit, target, tile.col, tile.row);
        if (!reaching.length)
          throw new PlayError(
            `${unit.name} cannot strike ${target.name} from ${tile.col},${tile.row}.`,
          );
        const weapon = clauses.with
          ? findItem(reaching, clauses.with, 'weapon that reaches')
          : equip && reaching.includes(equip)
            ? equip
            : defaultWeapon(unit, reaching);
        let art = null;
        if (clauses.art) {
          const choice = at(() => this._resolveArt(unit, weapon, clauses.art));
          if (choice.art.targeting === 'chosen_center')
            throw new PlayError(
              `${choice.art.name} is an area art: "strike ${choice.art.id} at x,y".`,
            );
          art = choice.art;
        }
        return () => {
          b.chooseAction('Attack');
          // Confirming a forecast equips the weapon it showed (AttackFlowController).
          if (unit.weapon !== weapon) equipWeapon(unit, weapon);
          if (art) b.selectWeaponArt(art.id, weapon);
          b.chooseAttackTarget(target);
        };
      }
      case 'heal': {
        const { head, clauses } = splitClauses(args, ['with']);
        const staves = b._getUsableStaves(unit);
        if (!staves.length) throw new PlayError(`${unit.name} has no usable staff.`);
        const staff = clauses.with ? findItem(staves, clauses.with, 'usable staff') : null;
        const targets = at(() => {
          const prev = unit.weapon;
          if (staff) unit.weapon = staff;
          try {
            return b._findHealTargets(unit);
          } finally {
            unit.weapon = prev;
          }
        });
        const target = this.ids.resolve(head.join(' '), targets, 'ally in heal range');
        return () => {
          if (staff) b.equipFromMenu(staff);
          b.chooseAction('Heal');
          b.chooseHealTarget(target);
        };
      }
      case 'item': {
        const { head, clauses } = splitClauses(args, ['on']);
        const item = findItem(unit.consumables || [], head.join(' '), 'item');
        const target = clauses.on
          ? this.ids.resolve(clauses.on, b.playerUnits, 'unit of yours')
          : unit;
        if (item.effect === 'promote' || item.effect === 'reclass')
          throw new PlayError(`${item.name}: seals are not modelled in headless battles.`);
        const usable = at(
          () =>
            validateConsumable(unit, item, target) &&
            (target === unit || gridDistance(tile.col, tile.row, target.col, target.row) <= 1),
        );
        if (!usable)
          throw new PlayError(
            `${unit.name} cannot use ${item.name}${target !== unit ? ` on ${target.name}` : ''} (heals need missing HP on the user; cures need a condition on the user or an adjacent ally).`,
          );
        return () => b.useItem(item, target);
      }
      case 'talk': {
        const labels = at(menu);
        if (!labels.includes('Talk'))
          throw new PlayError(
            `No recruit beside ${tile.col},${tile.row} for ${unit.name} to talk to.`,
          );
        return () => b.chooseAction('Talk');
      }
      case 'seize':
      case 'escape': {
        const label = action === 'seize' ? 'Seize' : 'Escape';
        if (!at(menu).includes(label))
          throw new PlayError(
            action === 'seize'
              ? 'Seize needs a lord on the throne with the boss defeated.'
              : 'Escape needs the unit on an escape tile.',
          );
        return () => b.chooseAction(label);
      }
      case 'smash': {
        const center = parseTile(args[0]);
        const ok = at(() =>
          b._findRemainsTargets(unit).some((t) => t.col === center.col && t.row === center.row),
        );
        if (!ok) throw new PlayError(`No remains in reach at ${center.col},${center.row}.`);
        return () => {
          b.chooseAction('Smash');
          b.chooseRemainsTarget(center.col, center.row);
        };
      }
      case 'strike': {
        // strike <art> at <x,y>
        const { head, clauses } = splitClauses(args, ['at']);
        if (!head.length || !clauses.at) throw new PlayError('strike <art> at <x,y>');
        const center = parseTile(clauses.at);
        const entries = b
          ._getAvailableWeaponArtEntriesForUnit(unit)
          .filter((e) => e.art.targeting === 'chosen_center');
        const want = head.join(' ').toLowerCase();
        const entry = entries.find(
          (e) => e.art.id.toLowerCase() === want || e.art.name.toLowerCase() === want,
        );
        if (!entry) throw new PlayError(`${unit.name} has no area art "${head.join(' ')}".`);
        const ok = at(() => isAreaCenter(b, unit, entry.art, entry.weapon, center));
        if (!ok)
          throw new PlayError(
            `${entry.art.name} cannot be centred on ${center.col},${center.row} from there.`,
          );
        return () => {
          if (!b.executeAreaStrike(unit, entry.art.id, center))
            throw new PlayError(`${entry.art.name} cannot be used now.`);
        };
      }
      default:
        throw new PlayError(`Unknown action "${action}".`);
    }
  }

  _resolveArt(unit, weapon, token) {
    const want = String(token).trim().toLowerCase();
    const choices = artChoices(this.battle, unit, weapon);
    const choice = choices.find(
      (c) => c.art.id.toLowerCase() === want || c.art.name.toLowerCase() === want,
    );
    if (!choice)
      throw new PlayError(
        `No art "${token}" on ${weapon.name}. Available: ${choices.map((c) => c.art.id).join(', ') || 'none'}.`,
      );
    if (!choice.canUse) throw new PlayError(`${choice.art.name} unavailable: ${choice.reason}.`);
    return choice;
  }

  /** Hand the battle to the harness's careful player (sim/lib/TacticianAgent). */
  async _auto(scope) {
    if (!['turn', 'battle'].includes(scope)) throw new PlayError('auto turn | auto battle');
    this.agent ||= new TacticianAgent(this.driver, { rescue: true, objectives: true });
    // `auto battle` hands back after AUTO_TURN_CAP turns, so a stalemate (the stock
    // tactician cannot finish every map) never spins on.
    const startTurn = this.battle.turnManager.turnNumber;
    for (let i = 0; i < 5000 && !this.over; i++) {
      const turn = this.battle.turnManager.turnNumber;
      if (scope === 'turn' && turn !== startTurn) break;
      if (turn - startTurn >= AUTO_TURN_CAP) {
        this.events.push({ type: 'autoCap', turns: AUTO_TURN_CAP });
        break;
      }
      const legal = this.driver.listLegalActions();
      const action = legal.length ? this.agent.chooseAction(legal) : null;
      if (!action) break;
      const b = this.battle;
      if (action.type === 'choose_action' && b.selectedUnit && b.preMoveLoc)
        this.events.push({
          type: 'order',
          unit: b.selectedUnit,
          from: { ...b.preMoveLoc },
          tile: { col: b.selectedUnit.col, row: b.selectedUnit.row },
          action: action.payload.label.toLowerCase(),
          args: [],
          equip: null,
        });
      await this.driver.step(action);
    }
    // Never leave a half-given order behind (the agent stopped mid-unit or ran out of steps).
    while (!this.over && this.battle.battleState !== HEADLESS_STATES.PLAYER_IDLE) {
      if (this.battle.battleState === HEADLESS_STATES.ENEMY_PHASE) await this._settlePhases();
      else this.battle.cancel();
    }
    await this._settlePhases();
  }

  /** Runs any enemy phase the last order started (as GameDriver.step does). */
  async _settlePhases() {
    while (!this.over && this.battle.battleState === HEADLESS_STATES.ENEMY_PHASE) {
      await this.battle._processEnemyPhase();
    }
  }

  _afterStep() {
    for (const r of this.ids.sync(this.battle)) this.events.push({ type: 'renamed', ...r });
  }

  // --- events ---

  _hpSnapshot() {
    const b = this.battle;
    return new Map([...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].map((u) => [u, u.currentHP]));
  }

  _instrument() {
    const b = this.battle;
    // Each event records whom the player could see as it happened: the feed shows a
    // hidden unit's doings only where the game would (its fight with a unit in view).
    const log = (e) => {
      e.visible = new Set(knowledgeOf(b).units);
      this.events.push(e);
    };
    const wrap = (name, around) => {
      const orig = b[name].bind(b);
      b[name] = (...args) => around(orig, ...args);
    };
    let lastResult = null;
    wrap('_recordDeedCombat', (orig, attacker, defender, result) => {
      lastResult = result;
      return orig(attacker, defender, result);
    });
    // Each event is logged when its action begins (so what it causes, the XP and the
    // falls, reads after it) and completed when the action returns.
    const combat = (orig, attacker, defender) => {
      const before = { a: attacker.currentHP, d: defender.currentHP };
      const weapons = { a: attacker.weapon?.name, d: defender.weapon?.name };
      const event = { type: 'combat', attacker, defender, before, weapons, result: null };
      log(event);
      lastResult = null;
      const out = orig(attacker, defender);
      event.result = lastResult;
      event.after = { a: attacker.currentHP, d: defender.currentHP };
      return out;
    };
    wrap('_executeCombat', combat);
    wrap('_executeEnemyCombat', combat);
    wrap('_removeUnit', (orig, unit, options) => {
      log({ type: 'fell', unit, killer: options?.killer || null });
      return orig(unit, options);
    });
    wrap('_grantScaledXP', (orig, unit, baseXp) => {
      const before = {
        level: unit.level,
        xp: unit.xp || 0,
        stats: { ...unit.stats },
        skills: [...(unit.skills || [])],
      };
      const out = orig(unit, baseXp);
      log({
        type: 'xp',
        unit,
        before,
        after: {
          level: unit.level,
          xp: unit.xp || 0,
          stats: { ...unit.stats },
          skills: [...(unit.skills || [])],
        },
      });
      return out;
    });
    wrap('_executeHeal', (orig, healer, target) => {
      const event = { type: 'heal', healer, target, from: target.currentHP };
      log(event);
      const out = orig(healer, target);
      event.to = target.currentHP;
      return out;
    });
    wrap('useItem', (orig, item, target) => {
      const event = {
        type: 'item',
        user: b.selectedUnit,
        target,
        item: item.name,
        from: target?.currentHP,
      };
      log(event);
      const out = orig(item, target);
      event.to = target?.currentHP;
      return out;
    });
    wrap('_executeTalk', (orig, lord, npc) => {
      log({ type: 'talk', lord, npc });
      return orig(lord, npc);
    });
    wrap('_executeEscape', (orig, unit) => {
      log({ type: 'escape', unit });
      return orig(unit);
    });
    wrap('_handleVillageVisit', (orig, unit) => {
      const gold = b.goldEarned;
      const items = b.villageRewardItems.length;
      const out = orig(unit);
      if (out)
        log({
          type: 'village',
          unit,
          gold: b.goldEarned - gold,
          items: b.villageRewardItems.slice(items).map((i) => i.name),
        });
      return out;
    });
    wrap('_handleVillageRaze', (orig, enemy) => {
      const out = orig(enemy);
      if (out) log({ type: 'razed', enemy });
      return out;
    });
    wrap('_onEnemyHeal', (orig, healer, target, result) => {
      log({
        type: 'enemyHeal',
        healer,
        target,
        from: target.currentHP - (Number(result?.healAmount) || 0),
        to: target.currentHP,
      });
      return orig(healer, target, result);
    });
    wrap('_processEnemyPhase', async (orig) => {
      const par = b.turnPar;
      const known = knowledgeOf(b);
      const seen = new Map(
        b.enemyUnits.filter((u) => known.isKnown(u)).map((u) => [u, { col: u.col, row: u.row }]),
      );
      const roster = new Set(b.enemyUnits);
      log({ type: 'enemyPhase', turn: b.turnManager.turnNumber });
      const out = await orig();
      if (Number.isFinite(par) && b.turnPar !== par) log({ type: 'par', from: par, to: b.turnPar });
      log({
        type: 'enemyPhaseEnd',
        seen,
        roster,
        over: b.result !== null,
        turn: b.turnManager.turnNumber,
      });
      return out;
    });
  }

  /**
   * When a unit lost more HP than the strikes on it dealt, say whose affixes or skills
   * added the rest (Venomous, Thorns, a weapon art's cost...): the strikes alone would
   * not add up.
   */
  _effectsNote(e) {
    if (!e.after) return '';
    const strikes = (e.result?.events || []).filter((s) => s.type === 'strike' && !s.miss);
    const dealt = (side) =>
      strikes
        .filter((s) =>
          side === 'a' ? s.attackerSide === 'defender' : s.attackerSide !== 'defender',
        )
        .reduce((sum, s) => sum + (Number(s.damage) || 0), 0);
    const notes = [];
    for (const [side, unit, foe] of [
      ['a', e.attacker, e.defender],
      ['d', e.defender, e.attacker],
    ]) {
      const lost = e.before[side] - Math.max(0, e.after[side]);
      const extra = lost - Math.min(dealt(side), e.before[side]);
      if (extra <= 0) continue;
      const sources = [
        ...affixLines(foe, this.game.gameData).map((l) => `${foe.name}'s ${l.split(':')[0]}`),
        ...affixLines(unit, this.game.gameData).map((l) => `own ${l.split(':')[0]}`),
      ];
      notes.push(
        `${unit.name} lost ${extra} more than the strikes dealt${sources.length ? ` (${sources.join(', ')})` : ' (skills, arts or effects)'}`,
      );
    }
    return notes.length ? ` ${notes.join('; ')}.` : '';
  }

  /**
   * The events of the last command as lines. The player's feed (the default) shows
   * what the player could see as each happened: a unit the fog hid then is named
   * only in a fight with a unit in view (the combat panel shows both sides), and an
   * event among hidden units only is left out. `omniscient` shows everything, for
   * diagnostics.
   */
  _eventLines({ omniscient = false } = {}) {
    const b = this.battle;
    const known = knowledgeOf(b);
    const visibleTo = (u, e) =>
      omniscient || !u || u.faction === 'player' || Boolean(e?.visible?.has(u)) || !e?.visible;
    const name = (u, e = null) => {
      if (!u) return 'someone';
      const id = this.ids.byUnit.get(u);
      if (omniscient && !id) return `(hidden) ${u.name}`;
      if (!visibleTo(u, e)) return `an unseen ${u.name}`;
      return `${id || '?'} ${u.name}`;
    };
    const lines = [];
    const hpSeen = new Map(this._hpBefore);
    for (const e of this.events) {
      switch (e.type) {
        case 'start':
          lines.push('Battle begins.');
          break;
        case 'autoCap':
          lines.push(`(auto battle stopped after ${e.turns} turns without a result: your orders.)`);
          break;
        case 'formation':
          lines.push(
            'Formation: arrange your units on the marked tiles ("place <unit> <x,y>"), then "start".',
          );
          break;
        case 'formationDone':
          lines.push('Formation set. Turn 1, player phase.');
          break;
        case 'placed':
          lines.push(`${name(e.unit)} takes position at ${e.tile.col},${e.tile.row}.`);
          break;
        case 'order': {
          const moved = e.from.col !== e.tile.col || e.from.row !== e.tile.row;
          const where = moved
            ? `moves ${e.from.col},${e.from.row}->${e.tile.col},${e.tile.row}`
            : `holds ${e.tile.col},${e.tile.row}`;
          lines.push(
            e.action
              ? `${name(e.unit)} ${where}${e.equip ? `, equips ${e.equip.name}` : ''}, ${e.action}${e.args.length ? ` ${e.args.join(' ')}` : ''}.`
              : `${name(e.unit)} ${where}.`,
          );
          break;
        }
        case 'ambush': {
          const hostile = e.ambusher.faction === 'enemy';
          lines.push(
            `${hostile ? 'AMBUSH! ' : ''}${name(e.ambusher)} was hidden on the way to ${e.planned.col},${e.planned.row}: ${e.unit.name} stops at ${e.unit.col},${e.unit.row}. The move is locked in; ${e.unit.name} has not acted yet: give it an action there ("move ${this.ids.id(e.unit)} stay <action>").`,
          );
          break;
        }
        case 'combat': {
          if (!visibleTo(e.attacker, e) && !visibleTo(e.defender, e)) break;
          const strikes = (e.result?.events || [])
            .filter((s) => s.type === 'strike')
            .map((s) => {
              const who = s.attackerSide === 'defender' ? e.defender : e.attacker;
              const skills = (s.skillActivations || []).map((x) => x.name || x.id).filter(Boolean);
              const what = s.miss ? 'misses' : `${s.isCrit ? 'CRITS' : 'hits'} ${s.damage}`;
              return `${(visibleTo(who, e) && this.ids.byUnit.get(who)) || name(who, e)} ${what}${skills.length ? ` (${skills.join(', ')})` : ''}`;
            });
          lines.push(
            `${name(e.attacker, e)} [${e.weapons.a || 'no weapon'}] attacks ${name(e.defender, e)} [${e.weapons.d || 'no weapon'}]: ${strikes.join('; ') || 'no strikes'}. HP ${e.attacker.name} ${e.before.a}->${Math.max(0, e.after?.a ?? e.attacker.currentHP)}, ${e.defender.name} ${e.before.d}->${Math.max(0, e.after?.d ?? e.defender.currentHP)}.${this._effectsNote(e)}`,
          );
          hpSeen.set(e.attacker, e.after?.a ?? e.attacker.currentHP);
          hpSeen.set(e.defender, e.after?.d ?? e.defender.currentHP);
          break;
        }
        case 'fell':
          hpSeen.delete(e.unit);
          if (!visibleTo(e.unit, e)) break;
          lines.push(
            `${name(e.unit, e)} falls${e.unit.faction === 'player' ? (e.unit.isCommander ? ' — the commander is down' : ' (fallen: lost unless revived)') : ''}.`,
          );
          hpSeen.delete(e.unit);
          break;
        case 'xp': {
          const u = e.unit;
          const { before, after } = e;
          if (after.level > before.level) {
            const gains = Object.entries(after.stats)
              .filter(([k, v]) => v !== before.stats[k])
              .map(([k, v]) => `${k}+${v - (before.stats[k] || 0)}`);
            const learned = skillNames(
              { skills: after.skills.filter((id) => !before.skills.includes(id)) },
              this.game.gameData,
            );
            lines.push(
              `${name(u)} LEVEL UP ${before.level}->${after.level}: ${gains.join(' ') || 'no stat gains'}${learned.length ? `; learned ${learned.join(', ')}` : ''}.`,
            );
          } else if (after.xp !== before.xp) lines.push(`${name(u)} xp ${before.xp}->${after.xp}.`);
          break;
        }
        case 'enemyHeal':
          hpSeen.set(e.target, e.to);
          // A heal on a unit out of sight shows nothing: not that it happened, nor its HP.
          if (!visibleTo(e.target, e)) break;
          lines.push(`${name(e.healer, e)} heals ${name(e.target, e)}: HP ${e.from}->${e.to}.`);
          break;
        case 'allActed':
          lines.push('Every unit has acted: the player phase ends.');
          break;
        case 'par':
          lines.push(`Par is now ${e.to} (was ${e.from}): reinforcements raise it.`);
          break;
        case 'renamed':
          lines.push(`${e.from} ${e.unit.name} now fights as ${e.to}.`);
          break;
        case 'heal':
          lines.push(`${name(e.healer)} heals ${name(e.target)}: HP ${e.from}->${e.to}.`);
          hpSeen.set(e.target, e.to);
          break;
        case 'item':
          lines.push(
            `${name(e.user)} uses ${e.item}${e.target !== e.user ? ` on ${name(e.target)}` : ''}: HP ${e.from}->${e.to}.`,
          );
          hpSeen.set(e.target, e.to);
          break;
        case 'talk':
          lines.push(`${name(e.lord)} talks to ${name(e.npc)}: ${e.npc.name} joins the army!`);
          break;
        case 'escape':
          lines.push(`${name(e.unit)} escapes the map.`);
          break;
        case 'village':
          lines.push(
            `${name(e.unit)} visits the village: +${e.gold} gold${e.items.length ? `, ${e.items.join(', ')} sent to the convoy` : ''}.`,
          );
          break;
        case 'razed':
          // The village's state shows on the map whoever burned it.
          lines.push(`${name(e.enemy, e)} razes the village.`);
          break;
        case 'enemyPhase':
          lines.push(`-- Enemy phase (turn ${e.turn}) --`);
          break;
        case 'enemyPhaseEnd': {
          const moved = [];
          for (const u of b.enemyUnits) {
            if (!omniscient && !known.isKnown(u)) continue;
            const was = e.seen.get(u);
            if (!e.roster.has(u)) moved.push(`${name(u)} arrives at ${u.col},${u.row}`);
            else if (!was) moved.push(`${name(u)} spotted at ${u.col},${u.row}`);
            else if (was.col !== u.col || was.row !== u.row)
              moved.push(`${name(u)} ${was.col},${was.row}->${u.col},${u.row}`);
          }
          if (moved.length) lines.push(`Enemy movement: ${moved.join('; ')}.`);
          if (!e.over) lines.push(`-- Turn ${e.turn}, player phase --`);
          break;
        }
        default:
          break;
      }
    }
    for (const u of [...b.playerUnits, ...b.npcUnits, ...b.enemyUnits]) {
      if (!hpSeen.has(u) || (!omniscient && u.faction !== 'player' && !known.isKnown(u))) continue;
      const was = hpSeen.get(u);
      if (was !== u.currentHP)
        lines.push(`${name(u)} HP ${was}->${u.currentHP} (terrain, status or skill).`);
    }
    if (this.over) lines.push(this.battle.result === 'victory' ? 'VICTORY!' : 'DEFEAT.');
    return lines;
  }

  // --- the end ---

  /**
   * Victory, as PostCombatController.onVictory settles it: battle-scoped deltas
   * cleared, mastery participation, survivors serialized in roster order with the
   * bench, the completion gold at the late-pressure rate, then the rewards (and a
   * boss's recruit, a due lord's arrival) prepared once on the run.
   */
  settleVictory() {
    const { battle: b, game } = this;
    const rm = game.rm;
    b.clearBattleScopedDeltas(b.playerUnits);
    b.clearBattleScopedDeltas(b.escapedUnits || []);
    b.clearBattleScopedDeltas(this.bench);
    const liveSurvivors = [...b.playerUnits, ...(b.escapedUnits || [])];
    for (const u of liveSurvivors) recordBattleParticipation(u);
    const surviving = liveSurvivors.map((u) => serializeUnit(u));
    const rosterOrder = new Map((rm.roster || []).map((u, i) => [unitIdentityKey(u), i]));
    const nameOrder = new Map();
    (rm.roster || []).forEach((u, i) => {
      if (!nameOrder.has(u?.name)) nameOrder.set(u?.name, i);
    });
    const orderOf = (u) =>
      rosterOrder.get(unitIdentityKey(u)) ??
      (unitUidOf(u) ? undefined : nameOrder.get(u?.name)) ??
      Infinity;
    const allUnits = [...surviving, ...this.bench].sort((a, c) => orderOf(a) - orderOf(c));
    const turn = b.turnManager?.turnNumber;
    const pressure = getLatePressureState(turn, b.turnPar, game.gameData.turnBonus);
    const completionGoldAward = Math.max(
      0,
      Math.floor(GOLD_BATTLE_BONUS * pressure.goldMultiplier),
    );
    const goldBefore = Math.max(0, Math.trunc(rm.gold || 0));
    const hadCaravan = Boolean(b.battleConfig?.caravanSpawn);
    const caravanSurvived = hadCaravan
      ? b._caravanExited === true || b.npcUnits.some((u) => u.isCaravan && u.currentHP > 0)
      : false;
    const applied = rm.completeBattle(allUnits, this.node.id, b.goldEarned, {
      turnCount: turn,
      turnPar: b.turnPar,
      completionGoldOverride: completionGoldAward,
      caravanSurvived,
      fallenRecruits: fallenBattleRecruits(b._battleRecruits, allUnits, rm.roster),
    });
    const awarded = applied ? Math.max(0, Math.trunc(rm.gold || 0)) - goldBefore : 0;
    const goldAfterBattle = Math.max(0, Math.trunc(rm.gold || 0));
    if (applied && !rm.isRunComplete()) {
      prepareBattleRewards(rm, game.gameData, {
        nodeId: this.node.id,
        authoredLoot: b.battleConfig?.loot || null,
        isElite: this.isElite,
        isBoss: this.isBoss,
        goldEarned: b.goldEarned,
        turnPar: b.turnPar,
        turnBonusConfig: game.gameData.turnBonus,
        turnNumber: turn,
        victoryPressureState: pressure,
        completionGoldAward,
        battleCompletionAwardedGold: awarded,
        metaEffects: rm.metaEffects,
      });
      if (this.isBoss) prepareBossRecruit(rm, game.gameData);
      if (!rm.pendingBossRecruit && rm.shouldTriggerThirdLord())
        prepareThirdLord(rm, game.gameData);
    }
    // prepareBattleRewards pays the turn rating's gold (the spoils header names it).
    const turnBonus = Math.max(0, Math.trunc(rm.gold || 0)) - goldAfterBattle;
    const lines = [
      `Battle won in ${turn} turn(s)${Number.isFinite(b.turnPar) ? ` (par ${b.turnPar})` : ''}. Gold +${awarded} for the battle${turnBonus > 0 ? `, +${turnBonus} turn bonus` : ''} (now ${rm.gold}).`,
    ];
    if (caravanSurvived) lines.push('The caravan survived: its shop opens on the route map.');
    const commit = rm.lastEclipseCommit;
    if (commit && rm.eclipse)
      lines.push(
        `Eclipse shadow now ${rm.eclipse.shadow}${commit.fell?.length ? `; ${commit.fell.length} node(s) fell to the dark` : ''}.`,
      );
    for (const d of b.deedAnnouncements || []) if (d?.text) lines.push(`Deed: ${d.text}`);
    return lines;
  }
}

function deriveSeed(runSeed, nodeId) {
  let hash = 2166136261 >>> 0;
  const input = `${Number(runSeed || 0) >>> 0}:${nodeId}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Runs `fn` with the unit on `tile` (and holding `equip`), then puts it back. */
function withUnitAt(unit, tile, equip, fn) {
  const saved = { col: unit.col, row: unit.row, weapon: unit.weapon };
  unit.col = tile.col;
  unit.row = tile.row;
  if (equip) unit.weapon = equip;
  try {
    return fn();
  } finally {
    unit.col = saved.col;
    unit.row = saved.row;
    unit.weapon = saved.weapon;
  }
}
