# Rewind to before any action

Status: built on `claude/rewind-any-action` (2026-09-25). This file is the request as given,
refined to what was built; deviations are listed at the end.

## Request

> Vision rewind must be able to go back to before any player unit's action, not just the
> beginning of the turn.

Every completed player-unit action in the current player phase (move+wait, attack, staff,
item, trade, dance, weapon art, ability, escape, ballista, …) is a destination
"Before <Unit>'s <action>" — the state immediately before that unit began (including its
move) — plus the turn start. Earlier turns stay reachable as far as the budget allows. The
Rewind UI lists destinations newest first (portrait, action, target, outcome), one tap to
preview, one to confirm, cost shown, opens on the most recent point, works with touch at
844×390 and with keyboard/mouse on desktop, and is offered from the fallen-commander
decision. Restores must be exact, survive suspend/resume, keep one charge per rewind and
the fixed-v1 RNG honesty. Enemy-phase moments are never destinations.

## What a player experienced before (origin/main 403507a)

Played in the browser (phone 844×390 and desktop 1280×800; `combat_actions` lab: Patient
waits, Edric attacks the Knight, Sera heals Patient; plus `late_act` / `battle_smoke`
battles played over five turns) and measured the stored history. Why players could only
reach turn starts:

1. **Backwards labels.** Rewind opened the *Battle timeline*: rows were events and a rewind
   restored the state *after* the selected event. The latest action was "Now" (disabled).
   To undo an action you had to pick the row above it; to undo the first action of a turn,
   "Turn begins" was the only way. On phones the view opened on the disabled "Now" map with
   the list hidden behind a History toggle. With one action taken, the only enabled row was
   the turn start. (Playtest #27 describes exactly this workaround: "return after Sera
   attack, before Elara move".)
2. **The budget evicted action points first.** Every row (one per enemy action too) carried
   a board preview with one `{col,row,label}` object per tile (~6.5 KB on 14×10, ~10 KB on
   18×13), and every destination a full state (15–60 KB). `retain()` dropped action
   snapshots before anything else. Measured with real classes/weapons (18×13, 6 deployed,
   6 in reserve, 13 enemies, fog): after turn 1 only 4 of 6 actions were stored; after
   turn 2 only the turn-2 start; from turn 3 **no rewind point at all** (previews alone
   filled 512 KB). Act-2 size (14×10, 5/3/9): by turn 3 only turn starts plus one action.
   In the browser a `late_act` battle held 444 KB after four turns, 217 KB of it previews.
3. **Lunatic** allowed turn starts only (hard-coded in `canRewindToEntry`).
4. **Legacy-v1** battles (resumed from pre-timeline builds) recorded turn starts only.
5. **Quota fallback** wiped the whole timeline, leaving only the turn-start anchor.
6. **Desktop** had only the `[R]` key (hint "[R] Vision"); no clickable control.
7. **Fatal decision** opened the same timeline ("Review timeline") with the same semantics.
8. **Set-aside partial actions** (trade, then back out) had no point: rewinding before the
   next unit also undid the trade.

## As built

### Destinations (engine)

- The timeline already records the settled state after every completed player action and
  at every player-turn start. The state *before* action N is the settled point after action
  N−1 (or the turn start). `RewindDestinations.listRewindDestinations` turns the timeline
  into rows: each stored player-phase point labelled by the first event that followed it,
  newest first, never the live point ("you are here") and never a point where the enemy
  phase is already committed (returning there would only replay it).
- The recorder adds a structured action fact per activation (`summarizeActionFact`, from
  the visibility-filtered history beats): actor, verb (attack, heal, cure, warp, rally,
  ensnare, dance, gambit refresh, shove, pull, swap, trade, item, escape, village visit,
  ballista, talk, promotion, reclass, wall break, terrain, equipment change, wait/move),
  target, the art/staff/item/ability used, and outcome (hits, misses, crits, damage dealt
  and taken, heal amount, KOs, fell). Hidden units are never named. Older entries without
  facts fall back to their text ("Before Edric fell").
- **Set-aside activations.** When the next activation starts from a settled board (unit
  selection at idle, or End turn) and the last row is a partial-action fragment, or a free
  change happened since the last point (equipment, bags, accessory, convoy, gold —
  `rewindFingerprint`), that board is recorded as its own point first
  (`VisionRewindController.settleParkedActivation`). So "Before Y's attack" never undoes X's
  trade or re-equip.
- **Granularity is difficulty data**: `difficulty.json` `rewindGranularity` — `action` on
  Normal/Hard, `turn` on Lunatic (unchanged rule, now data; one line to change). Missing
  in older saves → the difficulty's default.
- **Legacy-v1** battles now record action points too, restored through the same canonical
  checkpoint a resume uses, and keep their reroll-on-rewind RNG rule (`hashRewindSeed`).
  A turn-start rewind in those battles already rerolled everything, so no new exploit.

### History budget (timeline v3)

- Each destination after a keyframe is stored as an exact structural patch
  (`BattleStateDelta`: object/array/entity-keyed-by-`battleEntityId` diffs). A patch is
  kept only if applying it reproduces the state byte-for-byte and it is < 60% of the full
  state; otherwise the state becomes the next keyframe. Dropping a keyframe re-bases its
  dependents. Hydration validates patch shapes (no prototype keys, bounded, base must be an
  earlier full state) and then the materialized state with `validateBattleState`.
- Board previews store terrain packed (label table + one char per tile, ~30× smaller);
  `previewTiles()` reads both forms.
- Byte pressure sheds, in order: review-only row previews (the visual archive keeps those
  frames), earlier turns' action points (oldest turn first), earlier turn starts, this
  turn's action points, then rows. The optional visual archive keeps ≥64 KB reserved.
- Quota fallback: drop the visual archive → keep only the current turn → wipe (as before).
- Limits unchanged: current + 3 previous turns, 500 rows, 512 KB.

Measured (18×13 late game, same fixture as above, 7 turns): every turn start and every
action of the current and three previous turns retained (28 points) at ~375 KB; a real
action patch is < 10% of its state (~3–6 KB vs ~60 KB). Act-2 size: ~220 KB. Append cost
went down (≈21 ms vs ≈33 ms per recorded row in Node for the late-game fixture).

### Rewind picker (UI)

`VisionRewindPicker` (DOM, `MenuSurface`, `visionRewind.css`, Ink & Ember tokens):

- Header: REWIND (Press Start 2P), ember charge pips "◆◆◇ 2 left", History, Back.
- List (right rail on phones and desktop): turn groups ("TURN 3 · THIS TURN", "TURN 2"),
  rows with the actor's portrait (PC-98 or rebuilt), "Before Edric's Wrath Strike on
  Knight", class or turn, outcome chips (Missed / Hit 7 / Crit 21 / Took 10 / +9 HP / KO /
  Fell). Turn-start rows read "Start of turn 3 · before Patient's wait". Unavailable rows
  stay visible with the reason (budget, difficulty).
- Opens with the newest point selected, focused and scrolled into view; its preview is
  already on the map (history scene, fitted to the board, the actor who acts next
  outlined, ribbon "Turn 3 · before Edric's attack on Knight").
- One tap previews (free, no state/save/RNG change); "Rewind here · 1 charge" commits via
  the existing durable transaction (no second dialog: the button states the cost). Status
  line: "Undoes the last 2 actions. Same moves, same outcomes." / "Returns to turn 2;
  everything after is undone."
- Keyboard: ↑/↓ move and preview, PageUp/PageDown jump turns, Home/End, Enter on a row
  moves to the Rewind button (Enter again spends), Esc/Back closes. Gamepad NAVIGATE,
  L/R turn jumps, CONFIRM, CANCEL. Touch uses the cancelable-press primitive (scrolling
  never selects).
- Entry points: phone rail "Rewind"; desktop `[R]` and now a click on the Eye plate;
  fallen-commander decision ("Rewind · N left" → picker with "Back to decision").
- History → the existing full timeline (enemy phases included), "Back to rewind" returns.

## Tests

- Unit: `BattleStateDelta.test.js`, `BattleTimelineRewindPoints.test.js` (patch storage,
  exact restore over 7 real late-game turns, budget, eviction order, re-basing, branch,
  hydration rejects unsafe patches, legacy points, quota trim, preview packing),
  `RewindDestinations.test.js` (every action kind's label and chips, list order,
  now/enemy-handoff exclusion, granularity, eviction reasons), `VisionRewindPicker.test.js`
  (DOM: rows, preview, confirm once, reasons, keyboard, gamepad, empty, fatal),
  `RewindAnyActionIntegration.test.js` (controller + transaction on the production
  checkpoint path: exact restore + reload, refusals, traded/equipped set-aside points,
  fatal decision, legacy reroll).
- E2E: `rewind-any-action.spec.js` (phone: three units, rewind before the second, exact
  state, the repeated attack resolves identically, reload resumes exactly; preview is free;
  trade point; desktop keyboard + mouse), `rewind-action-types.spec.js` (wait, move, attack,
  weapon art, heal, warp, cure, item, shove, pull, healing circle, rally, ensnare, blink,
  dance, end turn: act → rewind → exact), updated `battle-timeline.spec.js` and
  `battle-contracts.spec.js`.

## Deviations and open points

- **Lunatic keeps turn-start rewinds** (a deliberate identity rule from D4 of the original
  proposal), now data-driven; flip `rewindGranularity` to `action` to change it.
- **No second confirmation dialog** in the picker: the Rewind button states the cost and
  is only enabled for an eligible selection. The full timeline keeps its confirm dialog.
- **Seize** is not a destination: it ends the battle (victory is final). Escape and
  ballista are recorded like any action (unit-tested labels; not in the e2e map).
- Free changes (equip, bags) become a point only when the next activation starts or the
  turn ends. Opening Rewind right after a free change lists the previous point, and
  returning there also reverts that change (it happened after that point).
- A re-recorded turn start (interrupted turn-start effects) supersedes the earlier one in
  the list.
- Recruit last words (`fallenLine`, main #70) are presentation only: the line is picked
  purely, and Rewind cannot open while the dialogue is showing (story input lock), so no
  stale last-words UI survives a rewind past a death.
