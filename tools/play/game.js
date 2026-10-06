// The game a headless play session drives (tools/play): one run from the blessing to
// its end, as the scenes run it (BlessingSelect -> NodeMap <-> Battle), through the
// production engine and command modules. PlaySession (session.js) owns the log and
// the replay; this owns the state.
//
// Randomness follows the game's own split: map generation on the battle seed, every
// battle (and its victory settlement) on BattleRng from the run's rngSeed, and
// everything else on one seeded stream standing in for the browser's Math.random.

import { RunManager } from '../../src/engine/RunManager.js';
import { createSeededRng } from '../../src/engine/BlessingEngine.js';
import { resolveDeployLimits } from '../../src/engine/BattleDeployCount.js';
import { resolveDeploymentSelection } from '../../src/engine/DeploymentSelection.js';
import { findCommander } from '../../src/engine/Commander.js';
import { finishRewardClaim } from '../../src/engine/PendingBattleRewards.js';
import { resolveBossRecruit } from '../../src/engine/PendingBossRecruit.js';
import {
  prepareThirdLord,
  rerollThirdLord,
  resolveThirdLordArrival,
} from '../../src/engine/PendingThirdLord.js';
import { awardTeamXp, teamXpLines } from '../../src/engine/TeamXp.js';
import {
  applyAccessoryReward,
  applyRewardBundle,
  applyRewardForge,
  bundleTargetBlock,
  rewardWeaponEligible,
} from '../../src/engine/LootRewardCommands.js';
import { getImbueList, isImbueStone } from '../../src/engine/ImbueSystem.js';
import {
  rosterAccessoryAction,
  rosterItemAction,
  rosterItemWarnings,
} from '../../src/engine/RosterInventory.js';
import { giveRosterItem, teachRosterScroll } from '../../src/engine/RosterTransfers.js';
import { bindRosterArt } from '../../src/engine/RosterArtCommands.js';
import { benchSkill, equipSkill } from '../../src/engine/SkillLoadout.js';
import { getWeaponArtBindings } from '../../src/engine/WeaponArtSystem.js';
import { benchedSkillsOf } from '../../src/engine/UnitManager.js';
import { applyRosterClassChange } from '../../src/engine/RosterCommands.js';
import { getReclassTargets, resolvePromotionTargets } from '../../src/engine/UnitManager.js';
import { DEPLOY_LIMITS, NODE_TYPES } from '../../src/utils/constants.js';
import { _getUidCounter, _setUidCounter } from '../../src/utils/itemUid.js';
import { buildRunMetaEffects } from '../../tests/sim/fullrun-runner.js';
import { PlayBattle, countingRng } from './battle.js';
import { ChurchVisit, ShopVisit } from './services.js';
import { ColosseumVisit } from './colosseum.js';
import { itemDetail, mapView, nodeLine, rosterView } from './runView.js';
import { statsText, weaponText } from './battleView.js';
import { PlayError, findItem, parseIndex, splitClauses, tokenize } from './parse.js';

/** The engine's clock inside a session (2026-01-01T00:00:00Z): fixed, so replays agree. */
export const SESSION_CLOCK = Date.UTC(2026, 0, 1);

export const PHASES = Object.freeze([
  'blessing',
  'map',
  'deploy',
  'battle',
  'reward',
  'shop',
  'church',
  'ruins',
  'colosseum',
  // The commander fell with a Vision charge left: rewind, or accept the defeat.
  'fatal',
  'ended',
]);

function hash32(text) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function normalizeOptions(options = {}) {
  const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : 1;
  return {
    seed,
    difficulty: options.difficulty || 'normal',
    meta: options.meta || 'none',
    commander: options.commander || null,
    partner: options.partner || null,
    // A test aid, as the full-run sim's --invincibility: player units never fall.
    invincible: options.invincible === true,
  };
}

export class Game {
  constructor(gameData, options) {
    this.gameData = gameData;
    this.options = normalizeOptions(options);
    this.outside = countingRng(createSeededRng(hash32(`play:${this.options.seed}`)));
    this.random = this.outside;
    this.uidCounter = 0;
    this.uuidCounter = 0;
    this.phase = null;
    this.rm = null;
    this.battle = null;
    this.visit = null;
    this.pendingDeploy = null;
    this.result = null;
  }

  // --- randomness, the uid counter and the clock, owned by this game while it runs ---

  /**
   * Runs `fn` with this game's globals installed: its random stream, its item-uid
   * counter, a fixed clock and seeded UUIDs. The engine stamps a few records with
   * Date.now() and names the run with crypto.randomUUID(); a replay must rebuild
   * exactly the same state, so neither may read the real clock or entropy.
   */
  async run(fn) {
    const restore = this._install(this.random);
    try {
      return await fn();
    } finally {
      this.uidCounter = _getUidCounter();
      restore();
    }
  }

  /**
   * A read: the game's globals as `run` sets them, but on a throwaway stream, and
   * nothing kept (a look never changes what a command will roll, number or name).
   */
  peek(fn) {
    const uuids = this.uuidCounter;
    const restore = this._install(createSeededRng(0x2545f491));
    try {
      return fn();
    } finally {
      this.uuidCounter = uuids;
      restore();
    }
  }

  _install(random) {
    const prev = { random: Math.random, uid: _getUidCounter(), now: Date.now };
    const crypto = globalThis.crypto;
    const ownUuid = crypto && Object.prototype.hasOwnProperty.call(crypto, 'randomUUID');
    const prevUuid = crypto?.randomUUID;
    Math.random = random;
    _setUidCounter(this.uidCounter);
    Date.now = () => SESSION_CLOCK;
    if (crypto) crypto.randomUUID = () => this._nextUuid();
    return () => {
      Math.random = prev.random;
      _setUidCounter(prev.uid);
      Date.now = prev.now;
      if (crypto) {
        if (ownUuid) crypto.randomUUID = prevUuid;
        else delete crypto.randomUUID;
      }
    };
  }

  /** A UUID-shaped id from the seed and a counter (never from a random stream). */
  _nextUuid() {
    const n = this.uuidCounter++;
    const hex = (text) => hash32(text).toString(16).padStart(8, '0');
    const a = hex(`uuid:${this.options.seed}:${n}:a`);
    const b = hex(`uuid:${this.options.seed}:${n}:b`);
    const c = hex(`uuid:${this.options.seed}:${n}:c`);
    return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-8${c.slice(1, 4)}-${c.slice(4)}${a.slice(0, 4)}${b.slice(0, 4)}`;
  }

  /** Switch streams mid-command (a battle installs its own; settling it restores ours). */
  setRandom(rng) {
    this.random = rng;
    Math.random = rng;
  }

  rngState() {
    return { outside: this.outside.calls, battle: this.battle?.rng?.calls ?? null };
  }

  // --- start ---

  start() {
    const { seed, difficulty, meta, commander, partner } = this.options;
    const metaEffects = buildRunMetaEffects(
      { metaPreset: meta === 'max' ? 'endgame' : 'none', commander, partner },
      this.gameData,
    );
    const rm = new RunManager(this.gameData, metaEffects);
    rm.startRun({ runSeed: seed, difficultyId: difficulty, applyBlessingsAtStart: false });
    this.rm = rm;
    // BlessingSelectScene offers the first four; skip is always there.
    this.blessingOffers = rm.getBlessingOptions().slice(0, 4);
    this.phase = 'blessing';
    return [`A new run begins (seed ${seed}, ${difficulty}). Choose a blessing.`];
  }

  // --- lookups ---

  resolveUnitIn(token, pool, what = 'unit') {
    const t = String(token || '')
      .trim()
      .toLowerCase();
    if (!t) throw new PlayError(`Name a ${what}.`);
    const exact = pool.filter((u) => String(u.name).toLowerCase() === t);
    if (exact.length === 1) return exact[0];
    const prefix = pool.filter((u) => String(u.name).toLowerCase().startsWith(t));
    if (prefix.length === 1 && exact.length === 0) return prefix[0];
    const names = pool.map((u) => u.name).join(', ') || 'none';
    if (exact.length > 1 || prefix.length > 1)
      throw new PlayError(`"${token}" is ambiguous among: ${names}.`);
    throw new PlayError(`No ${what} "${token}". Choose from: ${names}.`);
  }

  resolveRosterUnit(token) {
    return this.resolveUnitIn(token, this.rm.roster, 'unit in your army');
  }

  availableNodes() {
    return this.rm.getAvailableNodes() || [];
  }

  reenterableNode() {
    const id = this.rm.currentNodeId;
    return id && this.rm.canReenterService?.(id)
      ? this.rm.nodeMap.nodes.find((n) => n.id === id)
      : null;
  }

  // --- views ---

  view() {
    switch (this.phase) {
      case 'blessing':
        return this._blessingView();
      case 'map':
        return [
          mapView(this.rm, { available: this.availableNodes(), reenter: this.reenterableNode() }),
          '',
          this._armySummary(),
        ].join('\n');
      case 'deploy':
        return this._deployView();
      case 'battle':
        return this.battle.view();
      case 'fatal':
        return `${this.battle.view()}\n\nYOUR COMMANDER HAS FALLEN. "rewinds" lists the moments a Vision can return to (${this.rm.visionChargesRemaining} left); "rewind <n>" | "accept".`;
      case 'reward':
        return this._rewardView();
      case 'shop':
      case 'church':
      case 'ruins':
        return this.visit.view();
      case 'colosseum':
        return this.visit.view();
      case 'ended':
        return this._endView();
      default:
        return '';
    }
  }

  _armySummary() {
    const lines = ['Army:'];
    for (const u of this.rm.roster) {
      lines.push(
        `  ${u.name} ${u.className} Lv${u.level} HP ${u.currentHP}/${u.stats.HP} · ${weaponText(u.weapon, u)}${u.consumables?.length ? ` · ${u.consumables.map((i) => `${i.name}${i.uses !== undefined ? ` x${i.uses}` : ''}`).join(', ')}` : ''}`,
      );
    }
    lines.push('("roster" shows stats, growths, convoy and pools.)');
    return lines.join('\n');
  }

  _blessingView() {
    const out = ['== BLESSING · choose one, or skip =='];
    this.blessingOffers.forEach((b, i) => {
      const costs = (b.costs || []).length
        ? ` Cost: ${b.rolledCost?.description || b.costs.map((c) => c.description || c.type).join(', ')}`
        : '';
      out.push(`  ${i + 1}. ${b.name} (tier ${b.tier}): ${b.description}${costs}`);
    });
    out.push(`  skip — no blessing`);
    out.push('');
    out.push(rosterView(this.rm, this.gameData));
    return out.join('\n');
  }

  _deployView() {
    const { node, limits } = this.pendingDeploy;
    const out = [
      `== DEPLOY for ${nodeLine(this.rm, node)} ==`,
      `Field ${limits.min} to ${limits.max} units. The commander always deploys.${this.rm.lastDeployment?.length ? ` Last time: ${this.rm.lastDeployment.join(', ')}.` : ''}`,
    ];
    for (const u of this.rm.roster) {
      out.push(
        `  ${u.name} (${u.className}${u.isCommander ? ', commander' : ''}) Lv${u.level} HP ${u.currentHP}/${u.stats.HP} · ${statsText(u)} · ${weaponText(u.weapon, u)}`,
      );
    }
    return out.join('\n');
  }

  _rewardView() {
    const rm = this.rm;
    const gd = this.gameData;
    const out = [];
    if (rm.pendingBossRecruit) {
      out.push('== BOSS RECRUIT · one may join your army ==');
      rm.pendingBossRecruit.candidates.forEach((c, i) => {
        const u = c.unit;
        out.push(
          `  ${i + 1}. ${u.name} (${c.className || u.className}${c.isLord ? ', lord' : ''}) Lv${u.level} HP ${u.stats.HP} · ${statsText(u)} · ${weaponText(u.weapon, u)}`,
        );
      });
      out.push('  recruit <n> | recruit none');
      return out.join('\n');
    }
    if (rm.pendingThirdLord) {
      out.push('== A LORD ARRIVES ==');
      rm.pendingThirdLord.candidates.forEach((c, i) => {
        const u = c.unit;
        out.push(`  ${i + 1}. ${u.name} (${u.className}) Lv${u.level} · ${statsText(u)}`);
      });
      out.push(`  lord <n> | lord none${rm.canRerollThirdLord?.() ? ' | reroll' : ''}`);
      return out.join('\n');
    }
    const record = rm.pendingBattleReward;
    if (!record) return 'No reward pending.';
    out.push(`== SPOILS · ${record.summary} · pick ${record.picksRemaining} ==`);
    record.choices.forEach((choice, i) => {
      if (record.claimed.includes(i)) return out.push(`  ${i + 1}. (taken)`);
      if (choice.type === 'gold')
        return out.push(
          `  ${i + 1}. ${choice.goldAmount} gold${choice.xpAmount ? ` + ${choice.xpAmount} XP to every unit` : ''}`,
        );
      const qty = choice.quantity > 1 ? ` x${choice.quantity}` : '';
      return out.push(`  ${i + 1}. ${itemDetail(choice.item, gd)}${qty} [${choice.type}]`);
    });
    out.push(`  skip — take ${record.skipGold} gold instead`);
    out.push(
      'take <n> [to <unit>|convoy|pool] · forge stones: take <n> forge <unit> <weapon> [might|hit|crit|weight|<imbue>]',
    );
    return out.join('\n');
  }

  _endView() {
    const rm = this.rm;
    return [
      `== RUN OVER: ${String(rm.status).toUpperCase()} ==`,
      `Act ${rm.currentAct}, ${rm.completedBattles} battle(s) won, ${rm.gold} gold.`,
      rosterView(rm, this.gameData),
    ].join('\n');
  }

  help() {
    const common = 'Any time: look | roster | help | note <text>';
    const phaseHelp = {
      blessing: 'bless <n> | bless skip',
      map: [
        'go <node id>                       travel (or re-enter the service you stand on)',
        'equip <unit> <weapon> · store <unit> <item> · withdraw <unit> <item>',
        'use <unit> <item> [<class>] · give <unit> <item> to <unit> · accessory <unit> <name|none>',
        'teach <unit> <scroll> [on <weapon>] [replace <slot>] · bench <unit> <skill> · unbench <unit> <skill> [for <skill>]',
      ].join('\n'),
      deploy: 'deploy <unit>, <unit>, ... | deploy last',
      battle: [
        ...(this.battle?.formation
          ? ['FORMATION: place <unit> <x,y> | start   (auto keeps the default tiles)']
          : []),
        'move <unit> <x,y|stay> [equip <weapon>] <action> [then <x,y|stay>]',
        '  actions: wait | attack <enemy> [with <weapon>] [art <art>] | heal <ally> [with <staff>]',
        '           item <item> [on <ally>] | talk | seize | escape | smash <x,y> | strike <art> at <x,y>',
        '           swap|shove|pull <ally> | dance <ally> | trade <ally> give <item> [for <item>] | trade <ally> take <item>',
        '           ability <name> [at <x,y>]   (Blink, Rally Cry, Healing Circle, Ensnare)',
        'canto <x,y|stay>                   move on after acting (Canto, Measured Step); "then" does it in the order',
        'end                                end the player phase',
        'auto turn | auto battle            let the harness tactician play',
        'rewinds | rewind <n>               a Vision: return to an earlier moment of this battle (one charge)',
        'Queries: options <unit> | forecast <unit> <x,y> <enemy> [with <weapon>] [art <art>] | threat <x,y> [<unit>] | unit <id>',
      ].join('\n'),
      reward:
        'recruit <n>|none · lord <n>|none|reroll · take <n> [to <unit>|convoy|pool] · take <n> forge <unit> <weapon> [<stat>] · skip',
      shop: this.visit?.help?.(),
      church: this.visit?.help?.(),
      ruins: this.visit?.help?.(),
      colosseum: this.visit?.help?.(),
      fatal: 'rewinds (list) | rewind <n> | accept',
      ended: 'The run is over.',
    };
    return `${phaseHelp[this.phase] || ''}\n${common}`;
  }

  /** A read-only command's text, or null when `line` is not a query. */
  query(line) {
    const words = tokenize(line);
    const verb = (words.shift() || '').toLowerCase();
    if (verb === 'look' || verb === '') return this.view();
    if (verb === 'help') return this.help();
    if (verb === 'roster')
      return `${this.phase === 'battle' ? '(The army as it entered this battle: "look" shows the battle. Growths, convoy and pools below.)\n' : ''}${rosterView(this.rm, this.gameData, { detail: true })}`;
    if (verb === 'map')
      return mapView(this.rm, {
        available: this.availableNodes(),
        reenter: this.reenterableNode(),
      });
    if (this.phase === 'battle' || this.phase === 'fatal') return this.battle.query(verb, words);
    return null;
  }

  _skillName(id) {
    return this.gameData.skills.find((x) => x.id === id)?.name || id;
  }

  /** A skill id among `ids`, named by its id or its name (or a unique prefix of either). */
  _resolveSkill(ids, token, what) {
    const t = String(token || '')
      .trim()
      .toLowerCase();
    const choices = ids.map((id) => ({ id, name: this._skillName(id) }));
    const list = () => choices.map((c) => c.name).join(', ') || 'none';
    if (!t) throw new PlayError(`Name an ${what}: ${list()}.`);
    const exact = choices.filter((c) => c.id.toLowerCase() === t || c.name.toLowerCase() === t);
    if (exact.length === 1) return exact[0].id;
    const prefix = choices.filter(
      (c) => c.id.toLowerCase().startsWith(t) || c.name.toLowerCase().startsWith(t),
    );
    if (prefix.length === 1) return prefix[0].id;
    throw new PlayError(
      `${prefix.length > 1 ? `"${token}" is ambiguous` : `No ${what} "${token}"`}. Choose from: ${list()}.`,
    );
  }

  // --- commands ---

  /** Runs one state-changing command. Returns lines to show. Throws PlayError on a refusal. */
  async exec(line) {
    this.diagnostics = null;
    const words = tokenize(line);
    const verb = (words.shift() || '').toLowerCase();
    switch (this.phase) {
      case 'blessing':
        return this._execBlessing(verb, words);
      case 'map':
        return this._execMap(verb, words);
      case 'deploy':
        return this._execDeploy(verb, words);
      case 'battle':
        return this._execBattle(verb, words);
      case 'reward':
        return this._execReward(verb, words);
      case 'shop':
      case 'church':
      case 'ruins':
        return this._execVisit(verb, words);
      case 'colosseum': {
        const out = this.visit.exec(verb, words);
        return out.leave ? this._checkActComplete(out.lines) : out.lines;
      }
      case 'fatal':
        if (verb === 'accept') return this._acceptDefeat();
        throw new PlayError('Your commander has fallen: "rewind <n>" (see "rewinds") or "accept".');
      case 'ended':
        throw new PlayError('The run is over.');
      default:
        throw new PlayError(`Unknown phase ${this.phase}.`);
    }
  }

  _execBlessing(verb, words) {
    if (verb !== 'bless') throw new PlayError('bless <n> | bless skip');
    const pick = String(words[0] || '').toLowerCase();
    const blessing =
      pick === 'skip' || pick === 'none'
        ? null
        : this.blessingOffers[parseIndex(pick, this.blessingOffers.length, 'blessing')];
    if (!this.rm.chooseBlessing(blessing ? blessing.id : null))
      throw new PlayError('That blessing is not on offer.');
    this.phase = 'map';
    return [blessing ? `Blessing taken: ${blessing.name}.` : 'No blessing taken.'];
  }

  _execMap(verb, words) {
    if (verb === 'go') {
      const id = words.join(' ');
      const reenter = this.reenterableNode();
      const node =
        this.availableNodes().find((n) => n.id === id) || (reenter?.id === id ? reenter : null);
      if (!node)
        throw new PlayError(
          `Cannot travel to "${id}". Next: ${
            this.availableNodes()
              .map((n) => n.id)
              .join(', ') || 'none'
          }${reenter ? `, or re-enter ${reenter.id}` : ''}.`,
        );
      return this._enterNode(node);
    }
    return this._execRoster(verb, words);
  }

  /** As NodeMapScene.onNodeClick. */
  _enterNode(node) {
    const rm = this.rm;
    const lines = [`You travel to ${nodeLine(rm, node)}.`];
    if (node.type === NODE_TYPES.CHURCH || node.type === NODE_TYPES.RUINS) {
      rm.currentNodeId = node.id;
      this.visit = new ChurchVisit(this, node, { ruins: node.type === NODE_TYPES.RUINS });
      this.phase = node.type === NODE_TYPES.RUINS ? 'ruins' : 'church';
      return lines;
    }
    if (node.type === NODE_TYPES.COLOSSEUM) {
      rm.currentNodeId = node.id;
      this.visit = new ColosseumVisit(this, node);
      this.phase = 'colosseum';
      return lines;
    }
    if (node.type === NODE_TYPES.SHOP) {
      if (node.isAmbush === true && node.ambushCleared !== true) {
        lines.push('AMBUSH! The shop was a trap.');
        return [...lines, ...this._prepareBattle(node)];
      }
      rm.currentNodeId = node.id;
      const pendingAmbush = rm.getAmbushPendingNode?.()?.id === node.id;
      return [
        ...lines,
        ...this._openShop(node, {
          ambushDiscount: Boolean(node.isAmbush && (node.ambushCleared === true || pendingAmbush)),
          pendingAmbush,
        }),
      ];
    }
    return [...lines, ...this._prepareBattle(node)];
  }

  _openShop(node, options) {
    const visit = new ShopVisit(this, node, options);
    const opened = visit.open();
    if (opened.skipped) return [...opened.lines, ...this._checkActComplete([])];
    this.visit = visit;
    this.phase = 'shop';
    return opened.lines;
  }

  /** BattleScene.create: the deploy screen only when the roster exceeds the cap. */
  _prepareBattle(node) {
    const rm = this.rm;
    const act = rm.currentAct;
    const limits = resolveDeployLimits({
      base: DEPLOY_LIMITS[act] || DEPLOY_LIMITS.act1,
      deployBonus: rm.getDeployBonus?.() || 0,
      lockedSpawnCount: rm.getLockedSpawnCount?.(node.id),
    });
    if (rm.roster.length <= limits.max) return this._beginBattle(node, rm.getRoster());
    this.pendingDeploy = { node, limits };
    this.phase = 'deploy';
    return [`Choose who deploys (${limits.min}-${limits.max}).`];
  }

  _execDeploy(verb, words) {
    if (verb !== 'deploy') throw new PlayError('deploy <unit>, <unit>, ... | deploy last');
    const rm = this.rm;
    const { node, limits } = this.pendingDeploy;
    const roster = rm.getRoster();
    let names;
    if (words.length === 1 && words[0].toLowerCase() === 'last') {
      if (!rm.lastDeployment?.length) throw new PlayError('No earlier deployment to repeat.');
      names = resolveDeploymentSelection(roster, limits, rm.lastDeployment).map((u) => u.name);
    } else {
      names = words
        .join(' ')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((t) => this.resolveUnitIn(t, roster, 'unit in your army').name);
    }
    const commander = findCommander(roster);
    const chosen = new Set(names);
    if (commander) chosen.add(commander.name);
    if (chosen.size < limits.min || chosen.size > limits.max)
      throw new PlayError(
        `Deploy ${limits.min} to ${limits.max} units (the commander, ${commander?.name}, always goes); you named ${chosen.size}.`,
      );
    // In roster order, as the deploy screen confirms.
    const deployed = roster.filter((u) => chosen.has(u.name));
    this.pendingDeploy = null;
    return this._beginBattle(node, deployed, roster);
  }

  _beginBattle(node, deployed, roster = null) {
    const rm = this.rm;
    const all = roster || deployed;
    const fielded = new Set(deployed);
    const bench = all.filter((u) => !fielded.has(u));
    rm.lastDeployment = deployed.map((u) => u.name);
    this.battle = new PlayBattle(this, node, deployed, bench);
    this.phase = 'battle';
    return [`Deployed: ${deployed.map((u) => u.name).join(', ')}.`, ...this.battle._eventLines()];
  }

  async _execBattle(verb, words) {
    const lines = await this.battle.exec(verb, words);
    this.diagnostics = this.battle.diagnostics || null;
    if (!this.battle.over) return lines;
    return [...lines, ...this._endBattle()];
  }

  _endBattle() {
    const rm = this.rm;
    const battle = this.battle;
    let lines;
    if (battle.battle.result === 'victory') {
      lines = battle.settleVictory();
    } else {
      // VisionRewindController.showLordDeathPrompt: with a charge left the fall is a
      // choice, rewind or accept fate, before the run ends.
      if ((rm.visionChargesRemaining || 0) > 0) {
        this.phase = 'fatal';
        return [
          `Your commander has fallen. A Vision can undo it (${rm.visionChargesRemaining} left this run): "rewinds" lists the moments to return to, "rewind <n>" spends one; "accept" ends the run.`,
        ];
      }
      return this._acceptDefeat();
    }
    this.setRandom(this.outside);
    this.lastBattle = {
      node: battle.node.id,
      result: battle.battle.result,
      turns: battle.battle.turnManager?.turnNumber,
    };
    this.battle = null;
    if (rm.status === 'defeat') {
      this.phase = 'ended';
      return lines;
    }
    if (rm.pendingBossRecruit || rm.pendingThirdLord || rm.pendingBattleReward) {
      this.phase = 'reward';
      return lines;
    }
    return this._checkActComplete(lines);
  }

  /** The run ends with this battle lost (BattleScene.onDefeat). */
  _acceptDefeat() {
    const battle = this.battle;
    this.rm.failRun({ wasBoss: battle.isBoss });
    this.setRandom(this.outside);
    this.lastBattle = {
      node: battle.node.id,
      result: battle.battle.result,
      turns: battle.battle.turnManager?.turnNumber,
    };
    this.battle = null;
    this.phase = 'ended';
    return ['Your commander has fallen. The run ends.'];
  }

  _execReward(verb, words) {
    const rm = this.rm;
    const gd = this.gameData;
    if (rm.pendingBossRecruit) {
      if (verb !== 'recruit')
        throw new PlayError('First the boss recruit: recruit <n> | recruit none');
      const pick = String(words[0] || '').toLowerCase();
      const candidates = rm.pendingBossRecruit.candidates;
      const choice =
        pick === 'none' || pick === 'skip'
          ? null
          : candidates[parseIndex(pick, candidates.length, 'candidate')];
      resolveBossRecruit(rm, choice ? choice.unit : null);
      // A lord's arrival due this victory is rolled once the recruit is decided.
      if (!rm.pendingThirdLord && rm.shouldTriggerThirdLord()) prepareThirdLord(rm, gd);
      return this._afterRewardStep([
        choice ? `${choice.unit.name} joins your army.` : 'No one joins.',
      ]);
    }
    if (rm.pendingThirdLord) {
      if (verb === 'reroll') {
        if (!rm.canRerollThirdLord?.()) throw new PlayError('No reroll available.');
        rerollThirdLord(rm);
        prepareThirdLord(rm, gd);
        return ['New candidates.'];
      }
      if (verb !== 'lord') throw new PlayError('lord <n> | lord none | reroll');
      const pick = String(words[0] || '').toLowerCase();
      const candidates = rm.pendingThirdLord.candidates;
      const choice =
        pick === 'none' || pick === 'skip'
          ? null
          : candidates[parseIndex(pick, candidates.length, 'lord')];
      resolveThirdLordArrival(rm, choice ? choice.unit : null);
      return this._afterRewardStep([
        choice ? `${choice.unit.name} joins your army.` : 'No lord joins.',
      ]);
    }
    const record = rm.pendingBattleReward;
    if (!record) return this._afterRewardStep([]);
    if (verb === 'skip') {
      rm.awardGold(record.skipGold);
      finishRewardClaim(rm, record.choices.length);
      return this._afterRewardStep([`You take ${record.skipGold} gold instead.`]);
    }
    if (verb !== 'take') throw new PlayError('take <n> [to <unit>|convoy|pool] | skip');
    const index = parseIndex(words[0], record.choices.length, 'reward');
    if (record.claimed.includes(index)) throw new PlayError('Already taken.');
    const choice = record.choices[index];
    const rest = words.slice(1);
    const lines = this._applyReward(choice, rest);
    finishRewardClaim(rm, index);
    return this._afterRewardStep(lines);
  }

  /** As PendingRewardController.activateReward and MobileRewards' recipient steps. */
  _applyReward(choice, words) {
    const rm = this.rm;
    const gd = this.gameData;
    const item = choice.item;
    if (choice.type === 'gold') {
      rm.awardGold(choice.goldAmount || 0);
      const report = awardTeamXp(rm.roster, choice.xpAmount, gd.classes, {
        extendedLevelingEnabled: rm.getDifficultyModifier('extendedLevelingEnabled', false),
      });
      return [`+${choice.goldAmount} gold.`, ...teamXpLines(report, gd.skills)];
    }
    if (choice.type === 'forge') {
      // take <n> forge <unit> <weapon> [stat|imbue]
      if (String(words[0] || '').toLowerCase() !== 'forge' || words.length < 3)
        throw new PlayError(`${item.name}: take <n> forge <unit> <weapon> [stat or imbue]`);
      const unit = this.resolveRosterUnit(words[1]);
      const needsChoice = item.forgeStat === 'choice' || item.imbueId === 'choice';
      const eligible = (unit.inventory || []).filter((w) => rewardWeaponEligible(item, w));
      if (!eligible.length) throw new PlayError(`${unit.name} has no weapon this can upgrade.`);
      let weaponWords = words.slice(2);
      let selection;
      if (needsChoice) {
        const options = isImbueStone(item)
          ? getImbueList(gd.imbues).map((e) => e.id)
          : ['might', 'hit', 'crit', 'weight'];
        selection = weaponWords.at(-1)?.toLowerCase();
        if (!options.includes(selection))
          throw new PlayError(`Name the upgrade last: ${options.join(' | ')}.`);
        weaponWords = weaponWords.slice(0, -1);
      }
      const weapon = findItem(eligible, weaponWords.join(' '), 'eligible weapon');
      const result = applyRewardForge(rm, gd, item, unit, weapon, selection);
      if (!result.ok) throw new PlayError(result.reason);
      return [`${item.name} applied to ${unit.name}'s ${weapon.name}.`];
    }
    const { head, clauses } = splitClauses(words, ['to', 'for']);
    // "take 2 to Edric", or simply "take 2 Edric" / "take 2 convoy".
    const who = (clauses.to || clauses.for || head.join(' ')).toLowerCase();
    if (choice.type === 'accessory') {
      const target = !who || who === 'pool' ? 'pool' : this.resolveRosterUnit(who);
      const result = applyAccessoryReward(rm, item, target);
      if (!result.ok) throw new PlayError(result.reason);
      return [
        target === 'pool'
          ? `${item.name} goes to the accessory pool.`
          : `${target.name} equips ${item.name}.`,
      ];
    }
    if (item?.type === 'Scroll') {
      (rm.scrolls ||= []).push(structuredClone(item));
      return [`${item.name} goes to the scroll pool ("teach <unit> <scroll>" on the map).`];
    }
    if (!who) throw new PlayError(`Who gets ${item.name}? take <n> to <unit> | to convoy`);
    const target = who === 'convoy' ? 'convoy' : this.resolveRosterUnit(who);
    const qty = choice.quantity || 1;
    const reason = bundleTargetBlock(rm, item, target, qty);
    if (reason) throw new PlayError(reason);
    const result = applyRewardBundle(rm, item, target, qty);
    if (!result.ok) throw new PlayError(result.reason || 'Could not take it.');
    return [
      `${item.name}${qty > 1 ? ` x${qty}` : ''} -> ${target === 'convoy' ? 'convoy' : target.name}.`,
    ];
  }

  _afterRewardStep(lines) {
    const rm = this.rm;
    if (rm.pendingBossRecruit || rm.pendingThirdLord || rm.pendingBattleReward) return lines;
    return this._checkActComplete(lines);
  }

  /** As NodeMapScene.checkActComplete, then the map's pending ambush and caravan shops. */
  _checkActComplete(lines) {
    const rm = this.rm;
    this.visit = null;
    if (rm.pendingBattleReward) {
      this.phase = 'reward';
      return lines;
    }
    if (rm.isActComplete()) {
      if (rm.isRunComplete()) {
        rm.status = 'victory';
        this.phase = 'ended';
        return [...lines, 'The final boss has fallen. VICTORY: the run is won!'];
      }
      const from = rm.currentAct;
      const { unlockedArtIds, displacedSkills } = rm.advanceAct();
      lines = [
        ...lines,
        `Act complete! ${from} -> ${rm.currentAct}. The army rests and is fully healed.`,
      ];
      if (unlockedArtIds?.length) lines.push(`Weapon arts unlocked: ${unlockedArtIds.join(', ')}.`);
      if (displacedSkills?.length)
        lines.push(`Skills displaced: ${JSON.stringify(displacedSkills)}.`);
    }
    return this._toMap(lines);
  }

  _toMap(lines) {
    const rm = this.rm;
    const ambush = rm.getAmbushPendingNode?.();
    if (ambush?.type === NODE_TYPES.SHOP && rm.currentNodeId === ambush.id)
      return [
        ...lines,
        'The ambushers are routed; the shop opens.',
        ...this._openShop(ambush, { ambushDiscount: true, pendingAmbush: true }),
      ];
    const caravan = rm.getPendingCaravanShop?.();
    if (caravan) {
      const visit = new ShopVisit(this, null, { caravan: true, caravanActId: caravan.actId });
      const opened = visit.open();
      this.visit = visit;
      this.phase = 'shop';
      return [...lines, 'The merchant caravan you protected opens its wares.', ...opened.lines];
    }
    this.phase = 'map';
    return lines;
  }

  _execVisit(verb, words) {
    const out = this.visit.exec(verb, words);
    const lines = out.lines || [];
    if (out.openWares) {
      const node = this.visit.node;
      const visit = new ShopVisit(this, node, { ruins: true });
      lines.push(...visit.open().lines);
      this.visit = visit;
      this.phase = 'shop';
      return lines;
    }
    if (!out.leave) return lines;
    if (out.backToRuins) {
      this.visit = new ChurchVisit(this, this.visit.node, { ruins: true });
      this.phase = 'ruins';
      return lines;
    }
    if (this.visit.caravan) return this._toMap(lines);
    return this._checkActComplete(lines);
  }

  /** Roster management between battles (RosterInventory, RosterTransfers, RosterCommands). */
  _execRoster(verb, words) {
    const rm = this.rm;
    const gd = this.gameData;
    const unitFirst = () => {
      if (!words.length) throw new PlayError(`${verb} <unit> ...`);
      return this.resolveRosterUnit(words[0]);
    };
    const fail = (reason) => {
      if (reason) throw new PlayError(reason);
    };
    switch (verb) {
      case 'equip': {
        const unit = unitFirst();
        const item = findItem(unit.inventory, words.slice(1).join(' '), 'weapon');
        fail(rosterItemAction(rm, unit, item, 'equip'));
        return [`${unit.name} equips ${item.name}.`];
      }
      case 'store': {
        const unit = unitFirst();
        const item = findItem(
          [...(unit.inventory || []), ...(unit.consumables || [])],
          words.slice(1).join(' '),
        );
        const warnings = rosterItemWarnings(rm, unit, item, 'store');
        fail(rosterItemAction(rm, unit, item, 'store'));
        return [
          `${unit.name} stores ${item.name} in the convoy.${warnings.length ? ` (${unit.name} is now unarmed.)` : ''}`,
        ];
      }
      case 'withdraw': {
        const unit = unitFirst();
        const convoy = rm.getConvoyItems();
        const item = findItem(
          [...convoy.weapons, ...convoy.consumables],
          words.slice(1).join(' '),
          'convoy item',
        );
        fail(rosterItemAction(rm, unit, item, 'withdraw'));
        return [`${unit.name} takes ${item.name} from the convoy.`];
      }
      case 'use': {
        const unit = unitFirst();
        // The convoy's own items (getConvoyItems copies them; a copy is not "in the convoy").
        const pool = [...(unit.consumables || []), ...(rm.convoy?.consumables || [])];
        // The item is the longest leading run of words naming one; a seal's class follows.
        if (words.length < 2) throw new PlayError('use <unit> <item> [<class>]');
        let item = null;
        let rest = [];
        for (let n = words.length - 1; n >= 1 && !item; n--) {
          try {
            item = findItem(pool, words.slice(1, n + 1).join(' '), 'consumable');
            rest = words.slice(n + 1);
          } catch (err) {
            // Only "no such item" moves on to a shorter name; anything else is a fault.
            if (!(err instanceof PlayError) || n === 1) throw err;
          }
        }
        if (item.effect === 'promote' || item.effect === 'reclass') {
          const targets =
            item.effect === 'promote'
              ? resolvePromotionTargets(unit, gd.classes, gd.lords) || []
              : getReclassTargets(unit, gd.classes, item.subEffect) || [];
          const want = rest.join(' ').toLowerCase();
          const target = want
            ? targets.find((t) => t.name.toLowerCase() === want)
            : targets.length === 1
              ? targets[0]
              : null;
          if (!target)
            throw new PlayError(
              `Which class? ${targets.map((t) => t.name).join(' | ') || 'none available'}`,
            );
          const result = applyRosterClassChange(rm, unit, item, target, gd);
          if (!result.ok) throw new PlayError(result.reason);
          return [result.message || `${unit.name} is now a ${target.name}.`];
        }
        const before = { hp: unit.currentHP, stats: { ...unit.stats } };
        fail(rosterItemAction(rm, unit, item, 'use'));
        const gains = Object.entries(unit.stats)
          .filter(([k, v]) => v !== before.stats[k])
          .map(([k, v]) => `${k} ${before.stats[k]}->${v}`);
        return [
          `${unit.name} uses ${item.name}.${unit.currentHP !== before.hp ? ` HP ${before.hp}->${unit.currentHP}.` : ''}${gains.length ? ` ${gains.join(', ')}.` : ''}`,
        ];
      }
      case 'give': {
        const { head, clauses } = splitClauses(words, ['to']);
        if (!clauses.to || head.length < 2) throw new PlayError('give <unit> <item> to <unit>');
        const from = this.resolveRosterUnit(head[0]);
        const to = this.resolveRosterUnit(clauses.to);
        const item = findItem(
          [...(from.inventory || []), ...(from.consumables || [])],
          head.slice(1).join(' '),
        );
        const result = giveRosterItem(rm, from, to, item);
        if (!result.ok) throw new PlayError(result.reason);
        return [`${from.name} gives ${item.name} to ${to.name}.`];
      }
      case 'accessory': {
        const unit = unitFirst();
        const name = words.slice(1).join(' ');
        const item =
          name.toLowerCase() === 'none'
            ? null
            : findItem(rm.accessories || [], name, 'pooled accessory');
        fail(rosterAccessoryAction(rm, unit, item));
        return [
          item ? `${unit.name} equips ${item.name}.` : `${unit.name} removes their accessory.`,
        ];
      }
      case 'teach': {
        // teach <unit> <scroll> [on <weapon>] [replace <slot>]: a skill scroll, or a
        // weapon-art scroll bound to one of the unit's weapons (the Roster's Arts tab).
        const unit = unitFirst();
        const { head, clauses } = splitClauses(words.slice(1), ['on', 'replace']);
        const scroll = findItem(rm.scrolls || [], head.join(' '), 'scroll');
        if (!scroll.teachesWeaponArtId) {
          const result = teachRosterScroll(rm, unit, scroll, gd.skills);
          if (!result.ok) throw new PlayError(result.reason);
          return [
            `${unit.name} learns from ${scroll.name}${result.benched ? ' (benched: every slot is full; "unbench" swaps it in)' : ''}.`,
          ];
        }
        if (!clauses.on)
          throw new PlayError(
            `${scroll.name} binds an art to a weapon: teach ${unit.name} ${scroll.name} on <weapon> [replace <slot>].`,
          );
        const weapon = findItem(unit.inventory || [], clauses.on, 'weapon');
        const bindings = getWeaponArtBindings(weapon);
        let replacement = null;
        if (clauses.replace) {
          const slot = parseIndex(clauses.replace, bindings.length, 'art slot');
          replacement = { index: slot, id: bindings[slot].id, source: bindings[slot].source };
        }
        const arts = gd.weaponArts?.arts || [];
        const result = bindRosterArt(rm, unit, weapon, scroll, arts, replacement);
        if (!result.ok)
          throw new PlayError(
            bindings.length >= 3 && !replacement
              ? `${weapon.name} holds 3 arts (${bindings.map((b, i) => `${i + 1} ${b.id}`).join(', ')}): add "replace <slot>".`
              : result.reason,
          );
        const art = arts.find((a) => a.id === scroll.teachesWeaponArtId?.trim());
        return [
          `${unit.name}'s ${weapon.name} learns ${art?.name || scroll.teachesWeaponArtId}${replacement ? ` in place of ${replacement.id}` : ''}.`,
        ];
      }
      case 'bench': {
        // bench <unit> <skill>: set an equipped skill aside (SkillLoadout).
        const unit = unitFirst();
        const skill = this._resolveSkill(
          unit.skills || [],
          words.slice(1).join(' '),
          'equipped skill',
        );
        const reason = benchSkill(unit, skill, gd);
        if (reason) throw new PlayError(reason);
        return [`${unit.name} benches ${this._skillName(skill)}.`];
      }
      case 'unbench': {
        // unbench <unit> <skill> [for <equipped skill>]: take a benched skill into battle.
        const unit = unitFirst();
        const { head, clauses } = splitClauses(words.slice(1), ['for']);
        const skill = this._resolveSkill(benchedSkillsOf(unit), head.join(' '), 'benched skill');
        const replace = clauses.for
          ? this._resolveSkill(unit.skills || [], clauses.for, 'equipped skill')
          : null;
        const reason = equipSkill(unit, skill, replace, gd);
        if (reason) throw new PlayError(reason);
        return [
          `${unit.name} equips ${this._skillName(skill)}${replace ? ` and benches ${this._skillName(replace)}` : ''}.`,
        ];
      }
      default:
        throw new PlayError(`Unknown command "${verb}" on the route map.\n${this.help()}`);
    }
  }
}
