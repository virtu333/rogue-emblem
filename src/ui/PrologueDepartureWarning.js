// PrologueDepartureWarning — the choice the route map offers when the player travels
// on from Harrow's Market or Chapel with Tamsin still unarmed (engine/PrologueDeparture
// says when; docs/specs/prologue-chapter.md §6 "Route map, row 2").
//
// Never a gate: "Continue anyway" always travels, Escape or closing it leaves the map
// as it was, and "Open Roster" opens the roster on her. It is asked once per Travel
// attempt (the attempt that continues is not asked again).

import { hasDOMHost } from '../utils/domUI.js';
import { showImportantHint } from './HintDisplay.js';
import { PROLOGUE_UNARMED_DEPARTURE } from '../data/prologueContent.js';

/**
 * Ask. Resolves 'go' (travel now), 'roster' (open the roster on the unit) or 'stay'
 * (dismissed). Without a DOM host, or if the dialog fails, it resolves 'go': the
 * warning can never stand between the player and the road.
 * @param {object} scene - NodeMapScene
 * @param {{ unit: string }} warning - unarmedDeparture's result
 */
export async function confirmPrologueDeparture(scene, warning) {
  if (!warning?.unit || !hasDOMHost()) return 'go';
  const copy = PROLOGUE_UNARMED_DEPARTURE;
  let choice;
  try {
    choice = await showImportantHint(scene, copy.body(warning.unit), {
      actions: [
        { label: copy.roster, value: 'roster', primary: true },
        { label: copy.go, value: 'go' },
      ],
    });
  } catch {
    return 'go';
  }
  if (choice === 'roster' || choice === 'go') return choice;
  return 'stay';
}
