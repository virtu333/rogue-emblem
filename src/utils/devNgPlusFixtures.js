// devNgPlusFixtures.js - the NG+ review route (`?devScene=homebase&preset=ngplus`): a save that
// has won Black Sun with currency to buy NG+ and a win's survivors waiting for "Who rides
// again?". Dev routes only (the dev server and deploy previews); its meta lives under the dev
// meta key, never a real slot.
import { normalizeNgPlusState } from '../engine/NgPlusState.js';

const WIN_MILESTONES = ['beatDusk', 'beatHard', 'beatLunatic'];

const growths = (HP, STR, MAG, SKL, SPD, DEF, RES, LCK) => ({
  HP,
  STR,
  MAG,
  SKL,
  SPD,
  DEF,
  RES,
  LCK,
});

function item(gameData, name, uid) {
  const source =
    (gameData.weapons || []).find((w) => w.name === name) ||
    (gameData.consumables || []).find((c) => c.name === name);
  return source ? { ...structuredClone(source), uid } : null;
}

function recruit(ref, name, className, baseClass, level, growthTable, skills, items) {
  return {
    ref,
    kind: 'recruit',
    name,
    className,
    level,
    tier: 'promoted',
    recordId: null,
    identity: {
      className: baseClass,
      growths: growthTable,
      traits: [],
      traitAttackStat: null,
      markId: null,
      portraitVariant: null,
    },
    items,
    skills: skills.map(([id]) => id),
    skillKinds: Object.fromEntries(skills),
  };
}

/** The survivors of a won Black Sun run, as the run's payout would store them. */
export function devNgPlusRide(gameData) {
  const kit = (pairs) => pairs.map(([name, uid]) => item(gameData, name, uid)).filter(Boolean);
  return {
    runId: 'run-dev-ngplus',
    difficultyId: 'lunatic',
    endedAt: 1,
    candidates: [
      {
        ref: 'dev-edric',
        kind: 'lord',
        name: 'Edric',
        className: 'Great Lord',
        level: 14,
        tier: 'promoted',
        recordId: null,
        identity: null,
        items: kit([
          ['Silver Sword', 'itm_dev_ng_1'],
          ['Elixir', 'itm_dev_ng_2'],
          ['Ragnarok', 'itm_dev_ng_8'],
        ]),
        skills: ['sol', 'vantage'],
        skillKinds: { sol: 'skill', vantage: 'skill' },
      },
      {
        ref: 'dev-sera',
        kind: 'lord',
        name: 'Sera',
        className: 'Light Priestess',
        level: 12,
        tier: 'promoted',
        recordId: null,
        identity: null,
        items: kit([['Elixir', 'itm_dev_ng_3']]),
        skills: ['miracle'],
        skillKinds: { miracle: 'skill' },
      },
      recruit(
        'dev-bjorn',
        'Bjorn',
        'Warrior',
        'Fighter',
        9,
        growths(80, 55, 0, 40, 35, 30, 10, 30),
        [
          ['vantage', 'skill'],
          ['shove', 'ability'],
        ],
        kit([
          ['Steel Axe', 'itm_dev_ng_4'],
          ['Vulnerary', 'itm_dev_ng_5'],
        ]),
      ),
      recruit(
        'dev-lyra',
        'Lyra',
        'Sniper',
        'Archer',
        8,
        growths(55, 45, 5, 60, 50, 20, 15, 40),
        [['sol', 'skill']],
        kit([['Steel Bow', 'itm_dev_ng_6']]),
      ),
      recruit(
        'dev-oren',
        'Oren',
        'Paladin',
        'Cavalier',
        10,
        growths(70, 45, 5, 45, 40, 35, 20, 30),
        [['canto', 'skill']],
        kit([['Steel Lance', 'itm_dev_ng_7']]),
      ),
    ].map((c) => ({ ...c, skills: c.skills.filter((id) => skillKnown(gameData, id)) })),
  };
}

const skillKnown = (gameData, id) => (gameData.skills || []).some((s) => s?.id === id);

/**
 * Applies the NG+ review save: the Black Sun win and, while the slot has neither a ride nor a
 * Barracks yet, the win's survivors. A ride already chosen stays chosen across reloads.
 */
export function applyNgPlusReviewMeta(meta, gameData) {
  for (const id of WIN_MILESTONES) meta.milestones.add(id);
  const state = normalizeNgPlusState(meta.ngPlus);
  if (state.pendingRide || state.barracks.length) return;
  state.pendingRide = devNgPlusRide(gameData);
  state.rev += 1;
  meta.ngPlus = normalizeNgPlusState(state);
}
