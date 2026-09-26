// Completed tutorials suppress only the lessons that were actually displayed.
export const TUTORIAL_LESSONS_KEY = 'emblem_rogue_tutorial_lessons';
export const TUTORIAL_HINT_IDS = new Set([
  'battle_first_turn',
  'battle_terrain',
  'battle_triangle',
  'battle_doubling',
  'battle_forecast',
  'battle_staff_scope',
  'battle_heal_uses',
  'battle_consumable_supply',
]);

export function applyCompletedTutorialHints(hints) {
  // A saved empty array is an explicit reset, not an uninitialized slot.
  if (!hints || hints.isNew === false) return;
  try {
    if (!localStorage.getItem('emblem_rogue_tutorial_completed')) return;
    const ids = JSON.parse(localStorage.getItem(TUTORIAL_LESSONS_KEY) || '[]');
    if (Array.isArray(ids)) for (const id of ids) if (TUTORIAL_HINT_IDS.has(id)) hints.markSeen(id);
  } catch {
    /* Optional onboarding state must not block a run. */
  }
}

export function forecastTutorialLesson(forecast, taught = new Set()) {
  // One concept per forecast; unshown concepts remain eligible next time.
  const lines = [],
    ids = [];
  if (!taught.has('battle_forecast')) {
    lines.push(
      'Review damage per hit and Hit chance before committing. Confirm attacks; Cancel returns to planning.',
    );
    ids.push('battle_forecast');
    return { message: lines[0], ids };
  }
  const triangle = forecast?.display?.triangle;
  if ((triangle?.damage || triangle?.hit) && !taught.has('battle_triangle')) {
    lines.push(
      'Weapon triangle: swords beat axes, axes beat lances, and lances beat swords. The forecast includes its damage and accuracy bonus.',
    );
    ids.push('battle_triangle');
    return { message: lines[0], ids };
  }
  if (
    (forecast?.attacker?.doubles || forecast?.defender?.doubles) &&
    !taught.has('battle_doubling')
  ) {
    lines.push(
      'Attack speed (AS) includes weapon weight. A 5-point speed lead normally grants a second attack; Planned hits shows the result.',
    );
    ids.push('battle_doubling');
  }
  return { message: lines.join('\n\n'), ids };
}
