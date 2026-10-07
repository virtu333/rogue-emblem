// EventJoin.js — the `join` effect: a unit joins the army from an event
// (docs/specs/event-nodes-phase2.md §2A "`join` effect").
//
//   { type: 'join', class: '<class>' | classPool: ['<class>', ...], name?, levelOffset?, trait? }
//
// The unit is built by the SAME builder a recruit node's recruit comes from
// (RecruitNodeSystem.buildRecruitNodeUnit), so it gets the recruit rules for free: the
// Edric-anchored level (the strongest squad's average, the act's minimum, blessing/meta
// recruit-level bonuses: RecruitScaling / resolveRecruitNodeLevel), seasoned growths, at least
// one trait, the join bonus, the meta recruit gear (Lethal Armory, Master of Arms, ...) and,
// for a promoted class, the promotion roll that either promotes the recruit or joins it in
// its base class (RecruitPromotion, the same chance a recruit node uses). Two things differ
// on purpose:
//   * never a lord: the builder's lord roll is switched off by handing it a game-data copy
//     with no lords, so the unit is always the class asked for;
//   * the stream is the event's, `event-join:${runSeed}:${nodeId}:${page}:${choiceId}:${n}`,
//     never the battle's or the node map's.
//
// The class must be one a recruit can be (joinClassBlock): a real class that appears in some
// act's recruit pool (which leaves out lord classes, bosses, undead and dragons), never an
// enemy-only class, and, when it is a promoted class, only in the acts whose pool lists it
// (an Act II road may not hand out a Hero). The unit's NAME is never one the run has used:
// the roster, the fallen, the laid-to-rest, names a recruit node has promised
// (RunManager.getTakenUnitNames) and names an earlier join of the same plan took.
//
// The roster has no size cap (the Expanded Ranks upgrade retired it), so a join is never
// blocked for room; deploy limits are unchanged. The unit lands in the roster like a boss
// recruit (blessing consumables, a unit uid, a face the army lacks) and the name is recorded
// as used. Result record: { kind: 'join', name, className, level, unitUid }.
//
// Pure of Phaser and the DOM; the draws are seeded and the builder never reads the caller's
// Math.random.

import { createSeededRng } from './BlessingEngine.js';
import { everFallenUnits } from './LaidToRest.js';
import { isPromotedRecruitSource } from './RecruitPromotion.js';
import { buildRecruitNodeUnit } from './RecruitNodeSystem.js';
import { serializeUnit } from './RunManager.js';
import { isPromotionClassBlocked, ENEMY_ONLY_CLASS_NAMES } from './UnitManager.js';
import { eclipseHash } from './EclipseSystem.js';
import { runSeedOf } from './EventSystem.js';

const recruitPools = (recruits) =>
  Object.entries(recruits || {}).filter(
    ([key, value]) => key !== 'namePool' && Array.isArray(value?.classPool),
  );

/**
 * Why a class may not be handed out by a join in the given acts ('' when it may).
 * @param {{ classes?: object[], recruits?: object }} data
 * @param {string} className
 * @param {string[]} acts - the acts the effect can play in (a promoted class must be in every pool)
 */
export function joinClassBlock(data, className, acts) {
  const classes = data?.classes || [];
  const cls = classes.find((c) => c?.name === className);
  if (!cls) return `unknown class "${className}"`;
  if (ENEMY_ONLY_CLASS_NAMES.has(className)) return `"${className}" is an enemy-only class`;
  if (cls.tier === 'boss') return `"${className}" is a boss class`;
  if (isPromotionClassBlocked(className)) return `"${className}" cannot be recruited`;
  const pools = recruitPools(data?.recruits);
  if (!pools.some(([, pool]) => pool.classPool.includes(className)))
    return `"${className}" is in no act's recruit pool (not a class a recruit can be)`;
  if (cls.tier === 'promoted') {
    if (!isPromotedRecruitSource(cls, classes))
      return `"${className}" has no base class to promote from`;
    for (const act of acts || []) {
      if (!data?.recruits?.[act]?.classPool?.includes(className))
        return `"${className}" is not in ${act}'s recruit pool (a promoted recruit class only appears in the acts that list it)`;
    }
  } else if (!cls.baseStats || !cls.growthRanges) return `"${className}" has no recruit template`;
  return '';
}

/** The class names of an effect (`class` or `classPool`) the current act may hand out. */
export function joinClassCandidates(run, effect) {
  const names = typeof effect?.class === 'string' ? [effect.class] : effect?.classPool || [];
  const data = { classes: run.gameData?.classes, recruits: run.gameData?.recruits };
  return names.filter((name) => joinClassBlock(data, name, [run.currentAct]) === '');
}

/** The tuple of key parts a join's streams hang from. */
const joinKey = (ctx, index) =>
  `event-join:${runSeedOf(ctx.run)}:${ctx.nodeId}:${ctx.pageTag || ctx.page || 'start'}:${ctx.choice?.id || 'choice'}:${ctx.phase}${index}`;

function pickName(ctx, className, taken, rng) {
  const { run } = ctx;
  const pool = run.gameData?.recruits?.namePool?.[className];
  const names = Array.isArray(pool) ? pool : [];
  const free = names.filter((name) => !taken.has(name));
  if (free.length) return free[Math.floor(rng() * free.length)];
  const base = names.length ? names[Math.floor(rng() * names.length)] : className;
  return run._makeUniqueRecruitName(base, taken);
}

/**
 * The class and the name a join (or a recruit battle's green unit) will have: a seeded pick
 * among the classes the act may hand out, and a name nobody in the run has used. Pure; the
 * stream is keyed by the effect's place, so a replan is the same. `ledger.joined` keeps two
 * of one plan apart.
 * @returns {{ className: string, name: string, key: string, rng: Function } | { error: string }}
 */
export function pickJoinSelf(ctx, effect, index, ledger) {
  const { run } = ctx;
  const classes = joinClassCandidates(run, effect);
  if (classes.length === 0) return { error: 'No one of that kind can join the army here.' };
  const key = joinKey(ctx, index);
  const rng = createSeededRng(eclipseHash(`${key}:pick`));
  const className = classes[Math.floor(rng() * classes.length)];
  const taken = run.getTakenUnitNames();
  for (const name of ledger.joined) taken.add(name);
  let name = typeof effect.name === 'string' && effect.name.trim() ? effect.name.trim() : null;
  name = name
    ? taken.has(name)
      ? run._makeUniqueRecruitName(name, taken)
      : name
    : pickName(ctx, className, taken, rng);
  return { className, name, key, rng };
}

/**
 * Plan a join: pick the class and the name, and build the unit (pure; nothing on the run
 * changes). `ledger.joined` (a Set of names) keeps two joins of one plan apart.
 * @returns {{ step: object } | { error: string }}
 */
export function planJoin(ctx, effect, index, ledger) {
  const { run } = ctx;
  const self = pickJoinSelf(ctx, effect, index, ledger);
  if (self.error) return { error: self.error };
  const { className, name, key } = self;

  const context = run.getRecruitBattleContext({ id: key });
  const gameData = { ...run.gameData, lords: [] };
  if (typeof effect.trait === 'string' && effect.trait) {
    const trait = (run.gameData?.traits || []).find((t) => t.id === effect.trait);
    if (trait) gameData.traits = [trait];
  }
  const built = buildRecruitNodeUnit({
    ...context,
    nodeId: key,
    act: run.currentAct,
    preview: { className, name },
    gameData,
    fallenUnits: everFallenUnits(run),
    recruitLevelBonus: context.recruitLevelBonus + Math.trunc(Number(effect.levelOffset) || 0),
  });
  if (!built?.unit) return { error: 'No one answered the call.' };
  const unit = serializeUnit({ ...built.unit, faction: 'player' });
  ledger.joined.add(unit.name);
  return { step: { type: 'join', unit } };
}

/** Put the planned unit in the army the way every recruit source does; returns the record. */
export function applyJoin(ctx, step) {
  const { run } = ctx;
  const unit = step.unit;
  unit.faction = 'player';
  run.assignPortraitVariants?.([unit]);
  run.grantRecruitBlessingConsumables?.(unit);
  run.assignUnitUid(unit);
  run._trackRecruitNameUse(unit.className, unit.name);
  run.roster.push(unit);
  return [
    {
      kind: 'join',
      name: unit.name,
      className: unit.className,
      level: Math.max(1, Math.trunc(Number(unit.level) || 1)),
      unitUid: unit.unitUid || null,
    },
  ];
}
