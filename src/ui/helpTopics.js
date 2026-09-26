// Help dialog content (ContextHelp blocks), kept short: the answer first, the
// numbers as tiles, then one bulleted point per rule. Pure; no DOM.
import { getStaticCombatStats, isStaff, usesMagic } from '../engine/Combat.js';
import { STAT_DESCRIPTIONS } from '../data/helpContent.js';
import { DOUBLE_ATTACK_SPD_THRESHOLD } from '../utils/constants.js';

const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/**
 * The roster's "Combat baseline" card, explained. `avoid` is the unit's Avoid on its
 * current tile (the card shows the same number).
 */
export function combatBaselineHelp(unit, { avoid, onTile = avoid != null } = {}) {
  const weapon = unit.weapon || null;
  const stats = unit.stats || {};
  const combat = getStaticCombatStats(unit, weapon);
  const armed = Boolean(weapon) && !isStaff(weapon);
  const allowance = Math.floor((stats.STR || 0) / 5);

  // Working notes only when they add up to the number shown (skills and weapon
  // bonuses can make the plain formula disagree; then the note is left off).
  const attackStat = armed && usesMagic(weapon) ? 'Mag' : 'Str';
  const attackBase = armed ? (usesMagic(weapon) ? stats.MAG : stats.STR) || 0 : 0;
  const atkNote =
    armed && attackBase + (weapon.might || 0) === combat.atk
      ? `${attackStat} ${attackBase} + Mt ${weapon.might || 0}`
      : '';
  // Anything beyond Speed − weight is a weapon Speed bonus.
  const speedBonus = armed ? combat.as - ((stats.SPD || 0) - combat.weight) : 0;
  const asNote =
    armed && combat.weight + speedBonus !== 0
      ? `Spd ${stats.SPD} − Wt ${combat.weight}${speedBonus ? ` ${signed(speedBonus)}` : ''}`
      : '';
  const wtNote = armed && weapon.weight ? `Wt ${weapon.weight} − ${allowance}` : '';

  const tiles = [
    { label: 'Attack', value: combat.atk, note: atkNote },
    { label: 'Atk Spd', value: combat.as, note: asNote },
    { label: 'Hit', value: combat.hit },
    { label: 'Avoid', value: avoid ?? stats.SPD * 2 + stats.LCK },
    { label: 'Crit', value: combat.crit },
    { label: 'Weight', value: combat.weight, note: wtNote },
  ];
  return [
    {
      lead: armed
        ? `${unit.name} with the ${weapon.name}, before any enemy, terrain or skill.`
        : `${unit.name} has no attack weapon equipped${weapon ? ` (${weapon.name} is a staff)` : ''}.`,
    },
    { stats: tiles },
    {
      title: 'What they mean',
      points: [
        { term: 'Attack', text: 'Damage before the foe’s Defense (Resistance vs magic).' },
        {
          term: 'Atk Spd',
          text: `Beat the foe’s by ${DOUBLE_ATTACK_SPD_THRESHOLD} to strike twice.`,
        },
        { term: 'Hit · Crit', text: 'Ratings, not odds. The forecast shows the real chance.' },
        {
          term: 'Avoid',
          text: onTile
            ? 'Taken off enemy Hit. Includes this tile’s bonus.'
            : 'Taken off enemy Hit. Cover adds more.',
        },
        {
          term: 'Weight',
          text: 'Slows Atk Spd. Every 5 Str cancels 1 point; staves weigh nothing.',
        },
      ],
    },
    { tip: 'Skills, mastery and terrain shift these. Check the forecast before attacking.' },
  ];
}

/** What each attribute does (roster stat grid). */
export function attributesHelp() {
  return [
    {
      points: Object.entries(STAT_DESCRIPTIONS).map(([stat, description]) => {
        const [name, ...rest] = description.split('. ');
        return { term: stat === 'HP' ? 'HP' : name, text: rest.join('. ') || description };
      }),
    },
    { tip: 'Growths set each attribute’s chance to rise on a level-up.' },
  ];
}

export const WEAPON_ARTS_HELP = [
  { lead: 'An art powers up one attack and costs HP.' },
  {
    title: 'Cost',
    points: [
      'Picking an art is free. The HP (and a use) are spent when the attack lands.',
      'You need more HP than the cost shown. It already counts your accessory and run effects.',
    ],
  },
  {
    title: 'Limits',
    points: [
      { term: 'Per battle', text: 'uses reset on the next map.' },
      { term: 'Per turn', text: 'uses reset each turn.' },
      'Proficiency, rank, the weapon and Silence can lock an art.',
    ],
  },
  { tip: 'Outside battle this sheet shows eligibility and cost only.' },
];

export function convoyHelp({ weapons, consumables }) {
  return [
    { lead: 'Storage shared by the whole army, managed between battles.' },
    {
      points: [
        {
          term: 'Carry',
          text: `Units fight only with what they hold: ${weapons} weapons or staves and ${consumables} consumables each.`,
        },
        { term: 'Store', text: 'moves a carried item into the convoy.' },
        { term: 'Withdraw', text: 'gives an item to the unit shown (tap it to pick another).' },
        {
          term: 'Overflow',
          text: 'Rewards, purchases and a fallen ally’s gear land here when no one has room.',
        },
      ],
    },
  ];
}

const OBJECTIVE_GOALS = {
  rout: 'Defeat every enemy on the map.',
  seize: 'Defeat the boss, then move a Lord onto the throne and choose Seize.',
};

/**
 * The rail's objective button. `text` is the scene's multi-line objective label;
 * `objective` is the battle's objective id (rout / seize / escape).
 */
export function objectiveHelp(text, bossLine = '', objective = '') {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const goal = OBJECTIVE_GOALS[objective];
  const points = [...(goal ? [goal] : []), ...lines.slice(1)];
  return [
    lines[0] ? { lead: lines[0] } : null,
    points.length ? { points } : null,
    bossLine ? { title: 'Boss', points: [bossLine] } : null,
    { tip: 'If your commander falls, the run ends. Others can fall and the run goes on.' },
  ].filter(Boolean);
}

/** A terrain's special rule plus its numbers for the unit type asking. */
export function terrainHelp(terrain, moveType = 'Infantry') {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const def = num(terrain?.defBonus);
  const avo = num(terrain?.avoidBonus);
  const cost = num(terrain?.moveCost?.[moveType]);
  return [
    terrain?.special ? { lead: terrain.special } : null,
    {
      stats: [
        { label: 'Defense', value: def == null ? '—' : signed(def) },
        { label: 'Avoid', value: avo == null ? '—' : signed(avo) },
        { label: 'Move cost', value: cost == null ? '✕' : cost, note: moveType },
      ],
    },
  ].filter(Boolean);
}
