// prologueLessons — what a finished prologue chapter carries into a new save slot.
//
// A completed prologue suppresses only the in-run field notes it actually showed
// (PrologueController.recordTaught). The storage keys keep the tutorial's spelling on
// purpose: `emblem_rogue_tutorial_completed` / `emblem_rogue_tutorial_lessons` are
// device-wide onboarding state, read by the title (promotion) and every new slot.
export const TUTORIAL_COMPLETED_KEY = 'emblem_rogue_tutorial_completed';
export const TUTORIAL_LESSONS_KEY = 'emblem_rogue_tutorial_lessons';
// The HintManager ids a prologue lesson may stand in for (prologueContent.NOTE_HINT_IDS).
export const TUTORIAL_HINT_IDS = new Set([
  'battle_first_turn',
  'battle_terrain',
  'battle_triangle',
  'battle_doubling',
  'battle_forecast',
  'battle_danger_zone',
  'battle_staff_scope',
  'battle_heal_uses',
  'battle_consumable_supply',
  'battle_no_counter',
  'battle_village',
  'battle_loot',
  'guide_veteran_kills',
  'guide_recruit_on_map',
  'guide_healer_heals',
  'guide_no_attack',
  'guide_fragile_in_reach',
  'guide_convoy',
  // P4, The Quarry Gate: deploy, seize and par, and the objective's change at the gate.
  'battle_deploy',
  'battle_seize',
  'battle_par',
  'guide_objective_changed',
]);

/** This device finished (or skipped into a run from) the prologue once. */
export function hasCompletedTutorial() {
  try {
    return Boolean(localStorage.getItem(TUTORIAL_COMPLETED_KEY));
  } catch {
    return false;
  }
}

export function applyCompletedTutorialHints(hints) {
  // A saved empty array is an explicit reset, not an uninitialized slot.
  if (!hints || hints.isNew === false) return;
  try {
    if (!localStorage.getItem(TUTORIAL_COMPLETED_KEY)) return;
    const ids = JSON.parse(localStorage.getItem(TUTORIAL_LESSONS_KEY) || '[]');
    if (Array.isArray(ids)) for (const id of ids) if (TUTORIAL_HINT_IDS.has(id)) hints.markSeen(id);
  } catch {
    /* Optional onboarding state must not block a run. */
  }
}

/**
 * Record a finished (or skipped-into-a-run) prologue on this device: the completion
 * flag and the union of the lessons shown so far, known ids only. Never touches a slot.
 * @param {Iterable<string>} taughtIds
 */
export function recordTaughtLessons(taughtIds) {
  const ids = [...taughtIds].filter((id) => TUTORIAL_HINT_IDS.has(id));
  try {
    localStorage.setItem(TUTORIAL_COMPLETED_KEY, '1');
    const previous = JSON.parse(localStorage.getItem(TUTORIAL_LESSONS_KEY) || '[]');
    const all = [
      ...new Set([
        ...ids,
        ...(Array.isArray(previous) ? previous.filter((id) => TUTORIAL_HINT_IDS.has(id)) : []),
      ]),
    ];
    localStorage.setItem(TUTORIAL_LESSONS_KEY, JSON.stringify(all));
    return all;
  } catch {
    /* Optional onboarding state must not block completion. */
    return ids;
  }
}
