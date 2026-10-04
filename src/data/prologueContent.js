// prologueContent — every line the prologue's coach, field notes and nudges say
// (docs/specs/prologue-chapter.md §6, P1's table). Pure: no DOM, no Phaser.
//
// Beats in data/prologue.json name copy by id (`coach: <id>`, `note: <id>`); spoken
// lines (`dialogue: <key>`) live in data/dialogue.json under `prologue`. Each entry is a
// function of a plain context so touch and desktop read differently ("Tap" / "Click"):
//   ctx.touch        phrase for taps instead of clicks
//   ctx.lord         the commander's name (Edric)
//   ctx.terrain      { name, defBonus, avoidBonus } the unit just arrived on (notes)
//   ctx.consumable   the consumable the note talks about ({ name, effect, value })

const tap = (ctx) => (ctx?.touch ? 'Tap' : 'Click');
const lordOf = (ctx) => ctx?.lord || 'Edric';
const danger = (ctx) => (ctx?.touch ? 'Danger' : 'Danger [D]');

/**
 * Coach goals: the one objective line over the map while a guided step is live.
 * @returns {{ goal: string, detail: string, chapter: string, anchor: object|null, canSkip: boolean }}
 */
export const PROLOGUE_COACH = Object.freeze({
  p1_select_edric: (ctx) => ({
    chapter: 'select',
    goal: `Select ${lordOf(ctx)}`,
    detail: `Blue units are yours; red are the empire's. ${tap(ctx)} ${lordOf(ctx)} to see where he can move.`,
    anchor: { kind: 'unit', name: lordOf(ctx) },
    canSkip: true,
  }),
  p1_move_to_fort: (ctx) => ({
    chapter: 'move',
    goal: 'Move onto the Fort',
    detail: `Blue tiles show his reach. ${tap(ctx)} the gold-framed Fort: cover lowers the damage he takes and raises his avoid.`,
    anchor: { kind: 'tile', ...(ctx?.gateTile || {}) },
    canSkip: true,
  }),
});

/** Field notes (modal, Continue to dismiss) and enemy-phase nudges, by note id. */
export const PROLOGUE_NOTES = Object.freeze({
  battle_terrain: (ctx) => {
    const t = ctx?.terrain;
    const name = t?.name || 'Fort';
    const bonuses = t
      ? ` — Defense +${Number(t.defBonus) || 0}, Avoid +${Number(t.avoidBonus) || 0}.`
      : '.';
    const how = ctx?.touch ? 'tap' : 'point at';
    return (
      `${name} tile reached${bonuses}\n` +
      `The terrain preview shows the bonuses of any tile you ${how}. Fight from cover to take less damage and dodge more.`
    );
  },
  battle_forecast: () =>
    'Reading a forecast: damage per hit, the Hit chance, and whether the enemy strikes back.\n' +
    'Confirm commits the attack. Cancel goes back to planning, and looking costs nothing.',
  p1_wait_or_end_turn: (ctx) =>
    `Wait ends ${lordOf(ctx)}'s move. Once every unit has acted, the turn passes and each red unit gets its move.\n` +
    `Check who can reach you first: ${danger(ctx)} shows every tile an enemy can strike. The near Fighter reaches the Fort; the far one does not.`,
  p1_enemy_phase: (ctx) => `Red units move now. ${lordOf(ctx)} strikes back when attacked, too.`,
  p1_level_up: () => 'Levels raise stats at random. Growth rates decide the odds.',
  p1_holding_enemy: (ctx) =>
    `Some enemies hold their post until you come close. Their red reach shows where.\n${lordOf(ctx)} is inside it now, so this Fighter will come.`,
  battle_triangle: () =>
    'The weapon triangle: swords beat axes, axes beat lances, lances beat swords.\nThe forecast already includes its hit and damage bonus.',
  battle_consumable_supply: (ctx) => {
    const item = ctx?.consumable;
    const name = item?.name || 'Vulnerary';
    const effect =
      item?.effect === 'heal' && Number.isFinite(Number(item.value))
        ? `heals ${Number(item.value)} HP`
        : 'heals';
    return `Item → ${name} ${effect}.\nYou carry few, and they never come back: a consumable's uses are spent for good.`;
  },
  // P2, Old Hands (docs/specs/prologue-chapter.md §6 P2).
  p2_veteran_kills: (ctx) => {
    const name = ctx?.veteran || 'Gaspar';
    return (
      `${name} is strong now but barely grows and earns little XP. Weaken enemies with ${name}, then leave the final blow to ${lordOf(ctx)} and your recruits: they grow from it.\n` +
      `${name} rides 6 tiles, and Measured Step lets him keep moving after a non-combat action.`
    );
  },
  battle_doubling: () =>
    'Weapon choice: the lance reads ×1, the sword ×2.\nAttack speed decides a second strike, and heavy weapons slow you. Switch weapons on the forecast and watch the ×2. A chip leaves the kill to someone who grows from it.',
  battle_no_counter: () =>
    'No counter: bows reach two tiles only.\nAn archer next to you cannot strike back. The forecast says so before you commit.',
  p2_forecast_chances: () =>
    'Hit is a chance, not a promise.\nPick a plan that still holds if this misses. A counter only comes if the defender survives.',
  p2_lances_beat_swords: (ctx) =>
    `Lances beat swords: ${lordOf(ctx)}'s hit and damage drop against a lance, and the counter bites.\nLet ${ctx?.veteran || 'Gaspar'} open the Soldier; ${lordOf(ctx)} finishes it.`,
  battle_danger_zone: (ctx) =>
    `${danger(ctx)} shows every tile an enemy can strike next phase.\nCheck it before you end a unit's move, not after. Holding enemies count too: they wake when you step into their reach.`,
  p2_village_visit: () =>
    "A village: end a unit's action on it to visit.\nVillages give gold, and send an item to the convoy, your army's shared storage.",
  battle_loot: () =>
    'Victory pays: pick one reward on the next screen.\nA weapon goes to a unit or the convoy, a consumable to a unit, and gold also pays for revivals and promotions.',
});

/**
 * Which in-run field notes a prologue note stands in for (HintManager ids). A shown
 * note marks these as taught, so a new slot skips their first-use explanation
 * (prologueLessons.applyCompletedTutorialHints).
 */
export const NOTE_HINT_IDS = Object.freeze({
  battle_terrain: ['battle_terrain'],
  battle_forecast: ['battle_forecast'],
  battle_triangle: ['battle_triangle'],
  battle_consumable_supply: ['battle_consumable_supply'],
  p1_wait_or_end_turn: ['battle_danger_zone'],
  p2_veteran_kills: ['guide_veteran_kills'],
  battle_doubling: ['battle_doubling'],
  battle_no_counter: ['battle_no_counter'],
  battle_danger_zone: ['battle_danger_zone'],
  p2_village_visit: ['battle_village'],
  battle_loot: ['battle_loot'],
});

/** The title card the ending stub closes on (data/prologue.json `ending.titleCard`). */
export function prologueEndingCard(prologue) {
  const text = prologue?.ending?.titleCard;
  return typeof text === 'string' && text.trim() ? text.trim() : '';
}

/**
 * The offer a fresh slot gets on New Game (§4): play the prologue (the highlighted
 * default on a device that has not finished it) or skip to the first run.
 */
export const PROLOGUE_OFFER = Object.freeze({
  title: 'Begin the first thread?',
  body: 'The prologue teaches the field in three short chapters: Edric, then the old hands who find him. Skip it and your first run begins at once.',
  play: 'Play the Prologue',
  playSub: 'about 20 minutes',
  skip: 'Skip to the first run',
});

/** Home Base, first visit after the prologue: what the grant is for. */
export const PROLOGUE_HOME_BASE_NOTE =
  'This is what persists. Spend the Valor and Supply from the first thread.';

/** The route-map note of a first run that followed the prologue (Home Base is known). */
export const PROLOGUE_FIRST_RUN_ROUTE_NOTE =
  'Your first run begins here. Difficulty and blessings unlock after it ends. Tap a node to preview; Travel commits.';

/** Short corrections while a guided step is live (coach nudges). */
export const PROLOGUE_NUDGES = Object.freeze({
  gate_select: (ctx) => `Select ${lordOf(ctx)} first.`,
  gate_move: (ctx) => `Move ${lordOf(ctx)} to the gold-framed Fort.`,
  gate_step: () => 'Finish the guided step first.',
  gate_pause: () => 'You can leave once your turn is back.',
});

/** The victory handoff after the chapter's last line. */
export function prologueHandoff({ title = 'the prologue', startRun = false } = {}) {
  return startRun
    ? `Victory! ${title} is yours.\nYour first run starts on the route map — pick a path, fight, and keep your commander alive.`
    : `Victory! ${title} is yours.\nYour saves are waiting on the title screen.`;
}

export function prologueCoachGoal(id, ctx) {
  const build = PROLOGUE_COACH[id];
  return build ? { id, ...build(ctx) } : null;
}

export function prologueNoteText(id, ctx) {
  const build = PROLOGUE_NOTES[id];
  return build ? build(ctx) : '';
}

export function prologueNudgeText(id, ctx) {
  const build = PROLOGUE_NUDGES[id];
  return build ? build(ctx) : '';
}
