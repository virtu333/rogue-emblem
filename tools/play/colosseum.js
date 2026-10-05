// The colosseum for headless play (tools/play): arena bouts fought round by round and
// the mercenary board, as ColosseumOverlay plays them, without the presentation. The
// rules are ColosseumEngine's and ArenaBout's; the visit's state lives on the node
// (node.colosseumState), as the overlay persists it.

import {
  arenaEntryBlock,
  calculateArenaReward,
  calculateArenaXP,
  canFight,
  generateChallenger,
  generateMercenaryCandidates,
  getArenaDistance,
  getArenaWeapon,
  getAvailableTiers,
  getMaxFights,
  grantMercenaryClassSkills,
} from '../../src/engine/ColosseumEngine.js';
import {
  arenaMaxRounds,
  arenaRoundOutcome,
  estimateArenaOdds,
  resolveArenaRound,
} from '../../src/engine/ArenaBout.js';
import { getCombatForecast } from '../../src/engine/Combat.js';
import { getSkillCombatMods } from '../../src/engine/SkillSystem.js';
import {
  checkLevelUpSkills,
  equipWeapon,
  gainExperience,
  grantMasterOfArmsWeapons,
  settleAccessoryHpOwed,
} from '../../src/engine/UnitManager.js';
import { relinkWeapon } from '../../src/engine/RunManager.js';
import { resolveRecruitScalingTargets } from '../../src/engine/RecruitScaling.js';
import { findCommander } from '../../src/engine/Commander.js';
import { RECRUIT_PROMOTION_BASE_LEVEL } from '../../src/utils/constants.js';
import { arenaOddsText } from '../../src/ui/arenaOddsText.js';
import { hitChancePercent } from '../../src/ui/forecastDisplay.js';
import { statsText, weaponText } from './battleView.js';
import { PlayError, parseIndex } from './parse.js';

const effectiveLevel = (unit) => {
  const level = Math.max(1, Math.trunc(Number(unit.level) || 1));
  return unit.tier === 'promoted' ? RECRUIT_PROMOTION_BASE_LEVEL + level : level;
};

export class ColosseumVisit {
  constructor(game, node) {
    this.game = game;
    this.node = node;
    this.actId = game.rm.currentAct;
    const state = node.colosseumState ? structuredClone(node.colosseumState) : {};
    this.fightsPerUnit = state.fightsPerUnit || {};
    this.levelsGained = state.levelsGained || {};
    this.mercCandidates = state.mercCandidates || null;
    this.mercCandidates?.forEach((candidate) => {
      relinkWeapon(candidate.unit);
      grantMercenaryClassSkills(candidate.unit, game.gameData.classes, game.gameData.skills);
    });
    this.mercHired = state.mercHired === true;
    this.data = game.gameData.colosseum;
    this.maxFights = getMaxFights(this.difficultyId, this.data);
    this.unit = null;
    this.tier = null;
    this.challenger = null;
    this.bout = null;
  }

  get rm() {
    return this.game.rm;
  }

  get difficultyId() {
    return this.rm.difficultyId ?? 'normal';
  }

  _persist() {
    this.node.colosseumState = structuredClone({
      fightsPerUnit: this.fightsPerUnit,
      levelsGained: this.levelsGained,
      mercCandidates: this.mercCandidates,
      mercHired: this.mercHired,
    });
  }

  tiers() {
    return getAvailableTiers(this.actId, this.data).map(([name, tier]) => ({ name, ...tier }));
  }

  view() {
    const rm = this.rm;
    const out = [`== COLOSSEUM · ${rm.gold} gold ==`];
    if (this.bout) {
      out.push(
        `Bout in progress: ${this.unit.name} vs ${this.challenger.unit.name}, round ${this.bout.round} of ${arenaMaxRounds(this.data)}.`,
      );
      out.push(
        `  ${this.unit.name} HP ${this.unit.currentHP}/${this.unit.stats.HP} · ${this.challenger.unit.name} HP ${this.challenger.unit.currentHP}/${this.challenger.unit.stats.HP}`,
      );
      out.push('  next — fight the next round | yield — forfeit the fee, keep your HP');
      return out.join('\n');
    }
    if (this.challenger) {
      out.push(this._forecastText());
      out.push('  fight | back');
      return out.join('\n');
    }
    out.push(
      `Arena: each unit may fight ${this.maxFights} time(s) this visit. Bouts run until one falls (max ${arenaMaxRounds(this.data)} rounds); losing leaves your fighter at 1 HP, never dead. HP lost here stays lost.`,
    );
    for (const u of rm.roster) {
      const reason = arenaEntryBlock(u, this.fightsPerUnit[u.name] || 0, this.maxFights);
      out.push(
        `  ${u.name} ${u.className} Lv${u.level} HP ${u.currentHP}/${u.stats.HP} · fights ${this.fightsPerUnit[u.name] || 0}/${this.maxFights}${reason ? ` [${reason}]` : ''}`,
      );
    }
    out.push('Tiers:');
    for (const t of this.tiers())
      out.push(
        `  ${t.name}: entry ${t.entryFee} G, win +${t.goldReward} G, XP x${t.xpMultiplier}${rm.gold < (t.entryFee || 0) ? ' [too dear]' : ''}`,
      );
    out.push('  arena <unit> <tier> — meet a challenger (see the forecast before paying)');
    if (this.mercCandidates) {
      out.push(`Mercenaries${this.mercHired ? ' (one already hired this visit)' : ''}:`);
      this.mercCandidates.forEach((c, i) => {
        const u = c.unit;
        out.push(
          `  ${i + 1}. ${u.name} ${u.className} Lv${u.level} HP ${u.stats.HP} · ${statsText(u)} · ${weaponText(u.weapon, u)} — ${c.hireCost} G${u._hired ? ' (hired)' : ''}`,
        );
      });
      out.push('  hire <n>');
    } else out.push('  mercs — browse the mercenary board');
    out.push('  leave');
    return out.join('\n');
  }

  help() {
    if (this.bout) return 'next | yield';
    if (this.challenger) return 'fight | back';
    return 'arena <unit> <tier> | mercs | hire <n> | leave';
  }

  _forecastText() {
    const gd = this.game.gameData;
    const unit = this.unit;
    const challenger = this.challenger.unit;
    const weapon = getArenaWeapon(unit);
    const distance = getArenaDistance(weapon, challenger.weapon);
    const plain = { avoidBonus: 0, defBonus: 0 };
    const masteryCtx = { classesData: gd.classes, traitsData: gd.traits || null };
    const atkMods = getSkillCombatMods(
      unit,
      challenger,
      [unit],
      [challenger],
      gd.skills || [],
      plain,
      true,
      null,
      { ...masteryCtx, weapon },
    );
    const defMods = getSkillCombatMods(
      challenger,
      unit,
      [challenger],
      [unit],
      gd.skills || [],
      plain,
      false,
      null,
      masteryCtx,
    );
    const f = getCombatForecast(
      unit,
      weapon,
      challenger,
      challenger.weapon,
      distance,
      plain,
      plain,
      {
        atkMods,
        defMods,
        imbuesData: gd.imbues || null,
      },
    );
    const odds = estimateArenaOdds(unit, challenger, gd, {
      trials: 300,
      maxRounds: arenaMaxRounds(this.data),
    });
    const side = (u, s, w) =>
      `${u.name} (${u.className} Lv${u.level} HP ${u.currentHP}/${u.stats.HP}, ${w?.name || 'unarmed'}): each round ${s.damage} dmg x${s.attackCount} @ ${hitChancePercent(s.hit)}% hit, ${s.crit}% crit`;
    return [
      `Challenger (${this.tier.name} tier): ${statsText(challenger)}`,
      `  ${side(unit, f.attacker, weapon)}`,
      `  ${side(challenger, f.defender, challenger.weapon)}`,
      `  ${arenaOddsText(odds)}. Entry ${this.tier.entryFee} G now; win +${this.tier.goldReward} G and the fee back.`,
    ].join('\n');
  }

  exec(verb, words) {
    const rm = this.rm;
    const gd = this.game.gameData;
    if (this.bout && !['next', 'yield'].includes(verb))
      throw new PlayError('A bout is under way: next | yield');
    switch (verb) {
      case 'arena': {
        if (this.challenger) throw new PlayError('A challenger waits: fight | back');
        if (words.length < 2) throw new PlayError('arena <unit> <tier>');
        const tierName = words.at(-1).toLowerCase();
        const tier = this.tiers().find((t) => t.name.toLowerCase() === tierName);
        if (!tier)
          throw new PlayError(
            `No tier "${words.at(-1)}": ${this.tiers()
              .map((t) => t.name)
              .join(', ')}.`,
          );
        const unit = this.game.resolveRosterUnit(words.slice(0, -1).join(' '));
        const reason = arenaEntryBlock(unit, this.fightsPerUnit[unit.name] || 0, this.maxFights);
        if (reason) throw new PlayError(reason);
        if (rm.gold < (tier.entryFee || 0)) throw new PlayError(`Requires ${tier.entryFee} gold.`);
        this.unit = unit;
        this.tier = tier;
        this.challenger = generateChallenger(
          effectiveLevel(unit),
          tier,
          this.actId,
          gd.enemies,
          gd.classes,
          gd.weapons,
          this.difficultyId,
          this.data,
          Math.random,
          gd.difficulty,
        );
        return { lines: [this._forecastText(), 'fight | back'] };
      }
      case 'back':
        if (!this.challenger) throw new PlayError('Nothing to step back from.');
        this.challenger = null;
        this.unit = null;
        this.tier = null;
        return { lines: ['You step back from the challenger.'] };
      case 'fight':
        return this._fight();
      case 'next':
        if (!this.bout) throw new PlayError('No bout under way.');
        return this._round();
      case 'yield':
        if (!this.bout) throw new PlayError('No bout under way.');
        return this._settle('yield', ['You yield.']);
      case 'mercs':
        this._mercs();
        return { lines: ['The mercenary board:'] };
      case 'hire':
        return this._hire(words);
      case 'leave':
        if (this.challenger) throw new PlayError('A challenger waits: fight | back first.');
        rm.markNodeComplete(this.node.id);
        return { lines: ['You leave the colosseum.'], leave: true };
      default:
        throw new PlayError(`Unknown colosseum command "${verb}".\n${this.help()}`);
    }
  }

  /** As ColosseumOverlay._executeFight. */
  _fight() {
    const rm = this.rm;
    const unit = this.unit;
    const tier = this.tier;
    if (!this.challenger)
      throw new PlayError('Choose a fighter and tier first: arena <unit> <tier>');
    if (rm.gold < (tier.entryFee || 0)) throw new PlayError(`Requires ${tier.entryFee} gold.`);
    if (!canFight(unit, this.fightsPerUnit[unit.name] || 0, this.maxFights))
      throw new PlayError(
        arenaEntryBlock(unit, this.fightsPerUnit[unit.name] || 0, this.maxFights),
      );
    const fee = Math.max(0, tier.entryFee || 0);
    if (fee > 0 && rm.spendGold(fee) === false)
      throw new PlayError(`Requires ${tier.entryFee} gold.`);
    settleAccessoryHpOwed(unit);
    const weapon = getArenaWeapon(unit);
    if (weapon !== unit.weapon) equipWeapon(unit, weapon);
    this.fightsPerUnit[unit.name] = (this.fightsPerUnit[unit.name] || 0) + 1;
    this.bout = { round: 0, feePaid: fee };
    return this._round([`${unit.name} pays ${fee} G and enters the arena.`]);
  }

  /** As ColosseumOverlay._fightRound. */
  _round(prefix = []) {
    const bout = this.bout;
    bout.round += 1;
    const unit = this.unit;
    const foe = this.challenger.unit;
    const result = resolveArenaRound(unit, foe, this.game.gameData);
    const outcome = arenaRoundOutcome(result, bout.round, arenaMaxRounds(this.data));
    const strikes = (result.events || [])
      .filter((e) => e.type === 'strike')
      .map(
        (e) => `${e.attacker} ${e.miss ? 'misses' : `${e.isCrit ? 'CRITS' : 'hits'} ${e.damage}`}`,
      );
    const lines = [
      ...prefix,
      `Round ${bout.round}: ${strikes.join('; ') || 'no strikes'}. ${unit.name} HP ${unit.currentHP}/${unit.stats.HP}, ${foe.name} HP ${foe.currentHP}/${foe.stats.HP}.`,
    ];
    if (outcome) return this._settle(outcome, lines);
    this._persist();
    lines.push('next | yield');
    return { lines };
  }

  /** As ColosseumOverlay._settleFight. */
  _settle(outcome, lines) {
    const rm = this.rm;
    const gd = this.game.gameData;
    const unit = this.unit;
    const challenger = this.challenger.unit;
    const baseXP = calculateArenaXP(unit, challenger, outcome === 'win');
    const levelsGained = this.levelsGained[unit.name] || 0;
    const reward = calculateArenaReward(this.tier, outcome, baseXP, levelsGained, this.data);
    const payout = reward.goldDelta + (this.bout?.feePaid || 0);
    if (payout > 0) rm.awardGold(payout);
    const out = [
      ...lines,
      `Result: ${outcome.toUpperCase()}.${payout > 0 ? ` +${payout} G.` : ''}`,
    ];
    if (reward.xpGained > 0) {
      const prevLevel = unit.level;
      const before = { ...unit.stats };
      const extendedLevelingEnabled =
        rm.getDifficultyModifier?.('extendedLevelingEnabled', false) || false;
      const xpResult = gainExperience(unit, reward.xpGained, { extendedLevelingEnabled });
      out.push(`${unit.name} +${reward.xpGained} XP.`);
      const ups = xpResult.levelUps?.length || 0;
      if (unit.level > prevLevel || xpResult.levelUps?.some((lu) => lu.isExtended)) {
        this.levelsGained[unit.name] = levelsGained + ups;
        const learned = checkLevelUpSkills(unit, gd.classes);
        const gains = Object.entries(unit.stats)
          .filter(([k, v]) => v !== before[k])
          .map(([k, v]) => `${k}+${v - (before[k] || 0)}`);
        out.push(
          `${unit.name} LEVEL UP ${prevLevel}->${unit.level}: ${gains.join(' ')}${learned?.length ? `; learned ${learned.join(', ')}` : ''}.`,
        );
      }
    }
    this.bout = null;
    this.challenger = null;
    this.unit = null;
    this.tier = null;
    this._persist();
    return { lines: out };
  }

  /** As ColosseumOverlay._showMercBrowse (rolled once per visit). */
  _mercs() {
    if (this.mercCandidates) return;
    const rm = this.rm;
    const gd = this.game.gameData;
    const roster = rm.roster || [];
    const { recruitTargetLevel } = resolveRecruitScalingTargets(roster);
    let lordLevel = recruitTargetLevel;
    if (!findCommander(roster)) {
      const lords = roster.filter((u) => u?.isLord);
      lordLevel = lords.length ? Math.max(1, ...lords.map(effectiveLevel)) : 1;
    }
    let candidates;
    try {
      candidates = generateMercenaryCandidates(
        this.actId,
        lordLevel,
        gd.recruits,
        gd.classes,
        gd.weapons,
        gd.skills,
        this.difficultyId,
        this.data,
        Math.random,
        gd.traits || null,
        [...(rm.getTakenUnitNames?.() || roster.map((u) => u.name))],
        rm.getEffectiveMetaEffects?.() ?? rm.metaEffects ?? null,
      );
    } catch {
      candidates = [];
    }
    this.mercCandidates = (Array.isArray(candidates) ? candidates : []).filter(
      (c) => c?.unit?.name && c?.unit?.stats && typeof c?.hireCost === 'number',
    );
    rm.assignPortraitVariants?.(this.mercCandidates.map((c) => c.unit));
    if (rm.metaEffects?.masterOfArms)
      for (const entry of this.mercCandidates)
        if (entry?.unit) grantMasterOfArmsWeapons(entry.unit, gd.weapons);
    this._persist();
  }

  /** As ColosseumOverlay._hireMercenary. */
  _hire(words) {
    const rm = this.rm;
    if (!this.mercCandidates) throw new PlayError('Browse the board first: mercs');
    if (this.mercHired) throw new PlayError('One mercenary per visit.');
    const candidate =
      this.mercCandidates[parseIndex(words[0], this.mercCandidates.length, 'mercenary')];
    const { unit, hireCost } = candidate;
    if (unit._hired) throw new PlayError(`${unit.name} is already hired.`);
    if (rm.spendGold(hireCost) === false) throw new PlayError(`${unit.name} costs ${hireCost} G.`);
    unit.faction = 'player';
    rm.grantRecruitBlessingConsumables?.(unit);
    rm.assignUnitUid?.(unit);
    rm.roster.push(unit);
    unit._hired = true;
    this.mercHired = true;
    this._persist();
    return { lines: [`${unit.name} the ${unit.className} joins for ${hireCost} G.`] };
  }
}
