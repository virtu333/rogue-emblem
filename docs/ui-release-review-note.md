# UI release checkpoint — reviewer note

Review `2491783..HEAD` on `mobile-rebuild-checkpoint` after this note is committed.
The prior reward migration is `2491783`; include it if reviewing the complete
roster/reward lifecycle rather than just this follow-up.

## Changes

- DOM deployment with commander lock, limits, portrait rows, and roster management
  layered over the same menu. Selection survives edits without recreating deployment.
- DOM boss recruitment and lord arrival, full roster detail inspection, one-shot
  selection/reroll, optional-recruit cancel and required-arrival feedback.
- Directional roster navigation; desktop rewards, pause and dialogue now use DOM.
  The battle HUD alone remains touch-specific by design.
- Shared portrait resolution; explicit roster live announcements; generated DOM
  depth CSS and a numeric-depth rejection gate in `check:ui-theme`.
- Historical mockup warning corrects its misleading letter-rank examples.

## Review emphasis

Check layered input ownership and cleanup, commander/selection preservation after
promotion/reclass, recruit skip/reroll semantics, and reward claim/transition
boundaries. Inspect empty/full/long rosters and mandatory-arrival cancel feedback.

The earlier claim that `new RosterOverlay` reopened canvas was incorrect: its
browser branch already delegated to the DOM sheet. This pass removes that wrapper
from deployment and layers `MobileRosterSheet` directly.

## Deliberate limits

- Reload during rewards retains the win and **forfeits unclaimed loot**, matching
  the existing save contract. It does not restore the step stack. A new browser
  test checks unchanged saved state and no orphan reward menu after reload.
- Canvas fallback implementations remain for headless tests/shared behavior. The
  unused `forceLegacy` switches are removed, so browsers cannot opt into that UI.
  Full deletion requires extracting the remaining shared commands and adapting
  headless tests; it is not a safe delete-only change or part of this checkpoint.
- Device checks still needed: actual iOS safe areas/rotation, software keyboard,
  physical controller, and a save carried over from the previous TestFlight build.
  No TestFlight upload is included in this source checkpoint.

## Validation

Unit suite, harness suite, reference/data parity and PR simulation slices passed.
Browser coverage includes the mobile run/resume loop, all reward types, desktop
input, deployment/roster layering, recruitment/reroll, reload and rotation.
Final command counts and checkpoint hash are provided in the handoff message.

Final verification: 5,117 unit tests; 109 harness tests; all PR simulation slices;
17 combined phone/menu/cohesion cases plus 10 compact-project cases. Separate
desktop, reload, rotation and review-regression cases passed during this pass.
Lint reported no errors (existing legacy warnings remain); theme and reference
checks and data parity passed. One overly broad Back locator in the run-loop test
was corrected; covered battle controls are now also hidden from accessibility
navigation. The historical mockup is intentionally not a current specification.
