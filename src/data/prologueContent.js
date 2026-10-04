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
});

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
