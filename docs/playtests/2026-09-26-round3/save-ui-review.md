# Save/UI review — September 26, 2026

Read-only review of `/tmp/rogue-review113`, compared with `/tmp/rogue-review89`. Focus: native mirror fix #97, phone ceremony/clipping work #109/#112, and slot routing fix #113. No source edits or browser interaction in this subagent pass.

## Confirmed: original native deletion finding is fixed

New tombstones carry `deletedSavedAt`. A stale local run at or below that stamp is removed before boot; a newer local run survives. Both cases passed using the real `NativeSaveMirror` class in the attached standalone probe. Legacy tombstones without an ordering stamp intentionally retain local data rather than risk deleting a newer run.

## Remaining edge — P3: a second deletion can retain the first deletion's stamp

**Location:** `src/utils/nativeSaveMirror.js:512`.

The equality shortcut compares only the stored value. When the previous native record is already a tombstone, a new run written and removed before the next native flush ends with the same value (`null`). The flush skips writing, even though `stamps` now contains the newer run's stamp. This leaves the old `deletedSavedAt` on disk.

Concrete reproduction with real storage hooks and an in-memory backend:

1. Native record is a tombstone at sequence 2, `deletedSavedAt:100`.
2. Write run stamp 200, then remove it before the mirror flush.
3. Flush retains tombstone100 instead of updating it to tombstone200.
4. Simulate a restart where WebKit retained run200 but lost its removal.
5. Restoration considers run200 newer than the tombstone and keeps it; reconciliation writes it as live sequence 3.

This is a narrow debounce/crash edge, not a normal observed browser failure. The same broad deletion-resurrection outcome remains possible only in this narrower sequence. Existing tests cover a created-and-ended run with **no previous native record**, but not one following an existing tombstone.

Recommendation: include the deletion watermark in the equality decision (track the watermark represented by the last issued record), and persist a tombstone when that watermark advances even if both values are null. Add this sequence to the native suite.

Evidence: [executable probe](native-redelete-probe.mjs), [captured output](native-redelete-probe.txt). The probe also verifies the two fixed baseline cases above.

## UI/routing assessment

No additional concrete correctness regression found in the reviewed code:

- Frame-relative safe-area padding avoids counting the notch twice on map-bound ceremony layers and now reserves the timeline's bottom inset.
- Ceremony fit helpers compact progressively and restore the original layout on resize; level/promotion overflow has a scrolling fallback. Promotion choices keep natural row height rather than shrinking below their contents.
- Cut-in detail and epithet text now fit/wrap instead of ellipsizing. Notice stacking accounts for wrapped height.
- #113 consistently opts the reviewed slot continuation branches into the router's bounded blocked-transition retry. Existing transition locks, rollback and suspended-battle selection paths remain intact.

This is a code assessment, not proof of physical phone typography or safe-area rendering. Other agents own the visible browser checks.

## Verification

**124 tests passed across 7 suites:** NativeSaveMirror (48), CeremonyFit (9), CeremonySafeArea (5), SlotPickerContinueRouting (12), SlotPickerSelectionFlow (5), ForecastDisplay (26), GrowthCeremonyController (19). The slot rollback test deliberately logs its injected router error; suite passed.

No native app build or physical-device kill/restart testing performed. No application source or real saves modified.
