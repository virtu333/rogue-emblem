# Frequent Regressions Watchlist

Use this list before merging scene/input/audio changes that are high risk for user-facing crashes or UX regressions.

## 1) Music overlap across scene transitions

Risk:
- Two tracks audible at once after quick transitions (Title/HomeBase/NodeMap/Battle).

Checks:
- Run `Manual Audio Transition Soak` from `docs/testing_matrix.md`.
- Confirm a single audible track during:
  - `NodeMap -> Battle`
  - `Battle -> Victory/Loot -> NodeMap`
  - rapid repeat transitions in one session

## 2) Battle entry race/spam

Risk:
- Double transition attempts or failed battle launch when repeatedly tapping battle nodes.

Checks:
- Rapidly tap an available battle node several times.
- Confirm:
  - no freeze
  - no duplicate scene starts
  - clean fallback message if launch fails

## 3) Audio unlock / first-click edge cases

Risk:
- Early click before browser audio unlock can break flow or drop music unexpectedly.

Checks:
- From fresh reload, click `New Game` quickly and proceed.
- Confirm no crash and scene remains responsive.
- Confirm expected music ownership after each transition.

## 4) Mobile touch input parity

Risk:
- Desktop-only affordances (right-click/hover) become inaccessible on mobile.

Checks:
- Validate touch alternatives for inspect/details.
- Ensure touch gestures do not trigger accidental move/action.
- Ensure long-press interactions do not leave stale selection/overlay state.

## 5) Overlay/state cancellation consistency

Risk:
- Cancel/ESC/right-click/off-map tap drift into inconsistent states.

Checks:
- Open/close inspection, detail overlay, pause, and action menu in sequence.
- Confirm cancel behavior always returns to stable `PLAYER_IDLE` when appropriate.

## 6) Menu click bleed-through into map input

Risk:
- A pointer/tap used to select a menu option is also interpreted as a map click on pointer-up (unintended move/target/confirm).

Checks:
- In battle, open weapon/action picker and click an option near map targets.
- Confirm no immediate map action occurs unless the next click explicitly targets the map.
- Repeat with mouse and touch paths.

## 7) Defeat/overlay lock-state escape paths

Risk:
- After defeat or interrupted overlays, input remains partially active, preventing clean return to NodeMap/Title.

Checks:
- Trigger defeat and verify transition to post-battle flow is deterministic.
- Confirm ESC/right-click cannot re-open stale battle interaction states after defeat banner appears.
- Reload and verify run-state resumes at expected NodeMap position.
