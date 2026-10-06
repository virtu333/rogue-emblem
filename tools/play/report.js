// What a headless play session amounts to (tools/play), for comparing runs: built by
// replaying its log and watching the game between commands, plus the journal's
// counts. Facts only (what went in, what came out, what was offered and taken), no
// judgement: a playtest's conclusions are drawn from these, not written into them.

import { PlaySession } from './session.js';
import { isMagical, isPhysical, isStaff } from '../../src/engine/Combat.js';
import { canEquip } from '../../src/engine/UnitManager.js';

export const REPORT_VERSION = 1;

/** The kinds of harm a unit can deal with what it carries and can wield. */
function damageKinds(unit) {
  const kinds = new Set();
  for (const w of unit.inventory || []) {
    if (!canEquip(unit, w)) continue;
    if (isStaff(w)) kinds.add('staff');
    // A magic sword strikes RES (its special says so).
    else if (isMagical(w) || /targets RES/i.test(w.special || '')) kinds.add('magic');
    else if (isPhysical(w)) kinds.add('physical');
    if (/Effective vs [^(]*Armored/i.test(w.special || '')) kinds.add('anti-armor');
  }
  return [...kinds].sort();
}

function unitFacts(u) {
  return {
    name: u.name,
    className: u.className,
    level: u.level,
    hp: u.currentHP,
    maxHp: u.stats?.HP,
    weapon: u.weapon?.name || null,
    damage: damageKinds(u),
  };
}

function rewardOffers(record) {
  return (record?.choices || []).map((c) =>
    c.type === 'gold'
      ? { type: 'gold', gold: c.goldAmount, xp: c.xpAmount || 0 }
      : { type: c.type, item: c.item?.name || null, quantity: c.quantity || 1 },
  );
}

/**
 * The report for a session record, with its journal entries (parsed lines) when
 * there are any. Returns a plain object (JSON).
 */
export async function buildReport(gameData, record, { journal = [], manifest = null } = {}) {
  const battles = [];
  const rewards = [];
  const purchases = [];
  const visits = [];
  let current = null; // the battle being played
  let reward = null; // the spoils on offer
  let visit = null;
  let prev = { phase: null, gold: 0, battlesWon: 0, fallen: 0 };

  const session = await PlaySession.fromRecord(gameData, record, {
    verify: false,
    onEntry: (i, entry, _digest, s) => {
      const g = s.game;
      const rm = g.rm;
      const at = i + 1;
      const word = entry.cmd.split(/\s+/)[0].toLowerCase();
      // A battle begins: what went in.
      if (g.phase === 'battle' && !current) {
        const b = g.battle.battle;
        current = {
          node: g.battle.node.id,
          type: g.battle.node.type,
          elite: g.battle.isElite,
          boss: g.battle.isBoss,
          act: rm.currentAct,
          objective: b.battleConfig?.objective || null,
          par: Number.isFinite(b.turnPar) ? b.turnPar : null,
          enteredAt: at,
          goldBefore: prev.gold,
          deployed: b.playerUnits.map(unitFacts),
          enemies: b.enemyUnits.length,
          fallenBefore: prev.fallen,
          rewinds: 0,
          autos: 0,
        };
      } else if (current) {
        if (word === 'rewind') current.rewinds++;
        if (word === 'auto') current.autos++;
      }
      // A battle ends: what came out.
      if (current && g.phase !== 'battle' && g.phase !== 'fatal') {
        const won = rm.completedBattles > prev.battlesWon;
        current.result = won ? 'victory' : rm.status === 'defeat' ? 'defeat' : 'left';
        current.turns = g.lastBattle?.turns ?? null;
        current.overPar =
          current.par != null && current.turns != null ? current.turns - current.par : null;
        // The fallen as the run records them; a lost battle's army as it stood.
        const alive = new Set(rm.roster.map((u) => u.name));
        current.fallen = [
          ...new Set([
            ...rm.fallenUnits.slice(current.fallenBefore).map((u) => u.name),
            ...current.deployed.map((u) => u.name).filter((n) => won && !alive.has(n)),
          ]),
        ];
        delete current.fallenBefore;
        current.goldAfter = rm.gold;
        current.endedAt = at;
        current.commands = at - current.enteredAt;
        battles.push(current);
        current = null;
      }
      // Spoils: what was offered, and what was taken.
      if (rm?.pendingBattleReward && !reward)
        reward = {
          afterBattle: battles.length,
          offers: rewardOffers(rm.pendingBattleReward),
          skipGold: rm.pendingBattleReward.skipGold,
          picks: [],
        };
      if (reward && (word === 'take' || word === 'skip')) reward.picks.push(entry.cmd);
      if (reward && !rm?.pendingBattleReward) {
        rewards.push(reward);
        reward = null;
      }
      // Services: what was bought, sold, forged, healed.
      if (['shop', 'church', 'ruins', 'colosseum'].includes(g.phase) && !visit)
        visit = { node: g.visit?.node?.id ?? null, kind: g.phase, enteredAt: at, commands: [] };
      if (visit && word !== 'go') {
        visit.commands.push(entry.cmd);
        if (
          [
            'buy',
            'sell',
            'forge',
            'restock',
            'heal',
            'revive',
            'promote',
            'hire',
            'fight',
          ].includes(word)
        )
          purchases.push({ at, node: visit.node, cmd: entry.cmd, gold: rm.gold - prev.gold });
      }
      if (visit && !['shop', 'church', 'ruins', 'colosseum'].includes(g.phase)) {
        visits.push(visit);
        visit = null;
      }
      prev = {
        phase: g.phase,
        gold: rm?.gold ?? 0,
        battlesWon: rm?.completedBattles ?? 0,
        fallen: rm?.fallenUnits?.length ?? 0,
      };
    },
  });
  if (current) {
    const { fallenBefore: _f, ...open } = current;
    battles.push({ ...open, result: 'in progress', commands: record.log.length - open.enteredAt });
  }
  if (reward) rewards.push(reward);
  if (visit) visits.push(visit);

  const rm = session.game.rm;
  const count = (type) => journal.filter((e) => e.type === type).length;
  return {
    reportVersion: REPORT_VERSION,
    options: record.options,
    commands: record.log.length,
    revision: record.revision ?? record.log.length,
    outcome: record.outcome ?? (session.over ? { kind: rm.status } : { kind: 'unfinished' }),
    provenance: record.provenance ?? null,
    manifest: manifest
      ? {
          code: manifest.code,
          data: manifest.data,
          adapter: manifest.adapter,
          agent: manifest.agent,
        }
      : null,
    run: {
      phase: session.game.phase,
      act: rm.currentAct,
      battlesWon: rm.completedBattles,
      gold: rm.gold,
      visionCharges: rm.visionChargesRemaining,
      visionUsed: rm.visionCount || 0,
      fallen: rm.fallenUnits.map((u) => u.name),
      army: rm.roster.map(unitFacts),
      blessings: (rm.activeBlessings || []).map((b) => b.id),
    },
    battles,
    rewards,
    purchases,
    visits,
    journal: {
      queries: count('query'),
      refusals: count('refused'),
      notes: count('note'),
      faults: count('fault'),
      observationFaults: count('observationFault'),
      unsupported: journal.filter((e) => e.type === 'unsupported').map((e) => e.line),
    },
  };
}

/** A few lines a person can read; the JSON holds the rest. */
export function reportText(report) {
  const lines = [
    `Seed ${report.options.seed}, ${report.options.difficulty}: ${report.outcome.kind}${report.outcome.reason ? ` (${report.outcome.reason})` : ''}. ${report.commands} commands; ${report.journal.queries} queries, ${report.journal.refusals} refusals, ${report.journal.faults} faults.`,
    `Run: ${report.run.act}, ${report.run.battlesWon} battles won, ${report.run.gold} gold, Vision ${report.run.visionUsed} used / ${report.run.visionCharges} left; fallen: ${report.run.fallen.join(', ') || 'none'}.`,
    'Battles:',
    ...report.battles.map(
      (b) =>
        `  ${b.node} (${b.type}${b.elite ? ', elite' : ''}, ${b.objective}): ${b.result}${b.turns != null ? ` in ${b.turns} turns` : ''}${b.par != null ? ` (par ${b.par})` : ''}${b.fallen?.length ? `; fell: ${b.fallen.join(', ')}` : ''}${b.rewinds ? `; ${b.rewinds} rewind(s)` : ''}. Army: ${b.deployed.map((u) => `${u.name} Lv${u.level} [${u.damage.join('/')}]`).join(', ')}.`,
    ),
    'Spoils:',
    ...report.rewards.map(
      (r) =>
        `  after battle ${r.afterBattle}: ${r.offers.map((o) => (o.type === 'gold' ? `${o.gold}g+${o.xp}xp` : o.item)).join(' | ')} -> ${r.picks.join('; ') || 'pending'}`,
    ),
  ];
  if (report.journal.unsupported.length)
    lines.push(`Not modelled, but in reach: ${report.journal.unsupported.join(' ')}`);
  return lines.join('\n');
}
