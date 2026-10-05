// guidanceGate — whether a one-time Guidance note may show outside a battle's
// GuidanceController (the route map, a shop, a church), by the same rules: once per save
// slot (HintManager ids), filtered by the Guidance setting's tiers (engine/Guidance.js),
// and never in the prologue run, whose own lessons stand in for the Act 1 follow-through
// (docs/specs/prologue-chapter.md §7). Pure of rendering: callers show the text where it
// never covers its subject (a service menu's status line, the route map's note).

import { guidanceAllows, isVeteranMeta, noteTier, resolveGuidance } from '../engine/Guidance.js';
import { isPrologueRun } from '../engine/ScriptedBattle.js';

/** The effective Guidance level for this scene's slot: 'full' | 'light' | 'off'. */
export function guidanceLevelOf(scene) {
  const registry = scene?.registry;
  const settings = registry?.get?.('settings');
  if (settings?.getHints?.() === false) return 'off';
  return resolveGuidance(settings?.getGuidance?.() || 'auto', {
    veteran: isVeteranMeta(registry?.get?.('meta')),
  });
}

/** A real run's one-time note `id` may show now (unseen, its tier allowed, not the prologue). */
export function canShowRunNote(scene, id) {
  if (isPrologueRun(scene?.runManager)) return false;
  const hints = scene?.registry?.get?.('hints');
  if (!hints || hints.hasSeen?.(id)) return false;
  return guidanceAllows(guidanceLevelOf(scene), noteTier(id));
}

/** Mark a note read on this slot (it was shown, or the prologue taught its subject). */
export function markNoteSeen(scene, id) {
  scene?.registry?.get?.('hints')?.markSeen?.(id);
}
