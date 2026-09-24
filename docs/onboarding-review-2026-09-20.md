# Emblem Rogue — Onboarding Review & Plan

Date: 2026-09-20
Live doc: https://claude.ai/code/artifact/8b62b7dc-33d7-446f-9822-d42d9b61f125
(The doc is the working copy. This file is an export for agent reference — re-export after edits.)

## Summary

A fresh-profile playthrough of the tutorial and the opening of a first run surfaced one structural problem and several smaller ones.

The structural problem: Emblem Rogue teaches its mechanics well in reference text and almost not at all at the moment of use. The Help overlay already explains staff refreshes, battle objectives, node types and par. None of that reaches the player while they are deciding whether to spend a charge, walk into a threat range, or pick a path. A new player makes irreversible decisions using numbers the UI shows but never labels.

The sharpest instance: three resources with three different lifetimes share one visual language. Vision rewinds last a whole run, staves refill every battle, and consumables are gone forever — yet `Heal (3/3)` sits directly above `Vulnerary (3)` in the same menu, same font, same parenthetical.

**Recommended start: Phase 1 (resource scoping).** Smallest diff, almost entirely string changes plus one toast, and it addresses the confusion that prompted this review.

## Method

Played in a browser against the local dev server, on a fresh profile with no meta progression, no save slots and no prior hint state. The existing local saves were left untouched by running on a separate storage origin.

Covered:

- The tutorial end to end (~4 minutes, 8 Field Notes, 2 turns), including deliberately letting Sera fall to reach the Vision-grant beat and the rewind that follows.
- A first run from New Game through the opening dialogue, the Act 1 node map, battle 1, and the post-battle reward screen.
- The Help overlay (all tabs), the pause menu, and the node map at both desktop and landscape-phone sizes.

Every claim about resource lifetimes was then verified against the engine rather than inferred from play.

## Finding 1 — Resource scoping

Three resources, three lifetimes, one visual language.

| Resource | Actual scope | How it is shown | Documented? |
| --- | --- | --- | --- |
| Vision / rewind | Per **run**. Set once at `startRun()`, +1 for each act boss cleared (Act 1 included as of September 21) | `Eye: 1 (rewind current turn)`; dialogs read "(1 remaining)" | Nowhere, except two meta-upgrade blurbs in the Home Base shop |
| Staves | Per **battle**. All 11 staves carry `perBattleUses`, zeroed in `resetUnitForBattle()` | `Heal (3/3)` | Help → ARMS → Staves only |
| Consumables | **Permanent.** `item.uses--`, removed at 0, gone for the rest of the run | `Vulnerary (3)` | Nowhere |

In Sera's action menu, `Heal (3/3)` and `Vulnerary (3)` were adjacent rows. One is free again next battle; the other is one of three the player will ever have. Nothing on screen distinguishes them.

Neither row says what the item does. `Vulnerary (3)` never mentions that it heals 10 HP.

Vision has a second problem on top of the scoping one. The HUD says it rewinds the "current turn"; the grant dialog says "rewind to your last turn." After the rewind executed, nothing confirmed what had happened — the board simply changed state, which is disorienting the first time.

A fully-upgraded run starts with 3 Vision and can recover 3 more across the act bosses, and spending is unrestricted — all of them can be burned in a single battle. None of that is discoverable in play.

Code references:
- `src/engine/RunManager.js:459` (`startRun` sets charges), `:406` (`getBaseVisionCharges`), `:2877` (act-boss +1)
- `src/scenes/BattleScene.js:312` (`resetUnitForBattle` zeroes `perBattleUses`)
- `src/scenes/BattleScene.js:6887` and `src/engine/RosterInventory.js:73` (consumable decrement + removal)

## Finding 2 — Combat literacy

**No lethal warning.** Sera sat at 1 HP. The forecast showed her dealing 8 into a 10-HP archer that counters for 7 at 85%. Every number needed to predict her death was on screen; nothing said she would die. The forecast already carries a `warnings` array (Shielded, Thorns, Teleporter) in `src/ui/ForecastOverlay.js`, so the mechanism to fix this exists.

**The weapon triangle is invisible.** Edric attacked an axe user with a sword — textbook advantage — and the forecast showed no indicator. The triangle cannot be learned from the UI at all.

**Unexplained vocabulary at point of use.** `— No Counter —` appears with no hint that bows cannot retaliate at melee range. `AS 6` and `x2` appear with no explanation of attack speed or doubling. The equip tooltip reads `5Mt 95Hit 0Crt / 3Wt Rng1` with no key.

**No attack-range display.** Selecting a unit shows blue movement tiles only, never the reachable attack tiles. On the river map, movement blue is also hard to tell apart from water.

**No enemy-phase summary.** Edric went from 20 to 11 HP between turns with no record of what hit him or for how much.

## Finding 3 — Info panel and HUD

**The top-left panel follows the mouse, not the game.** It went stale repeatedly:

- After Edric stepped off the fort it still read `Fort | Avo +20 | Def +2`, while he stood on plain grass.
- After a kill it still read `XP 22/100`.
- After Sera died it still showed her at `HP 1/20`.
- After a Vulnerary it showed the old HP until the mouse moved.

This matters most in the tutorial, where a Field Note says "Fort tile reached — check terrain in the top-left panel" while the panel reads `Plain`.

**`Move: 1` is a mislabel.** It is the terrain's movement cost, but it reads as the unit's movement range.

**`Par: 7 (S)` is on screen in the tutorial's first second** with no explanation anywhere near it. Par is the largest single lever in the run economy (see Finding 5) and this is its only surface.

**The control-hint row renders through the forecast panel**, leaving both harder to read whenever a forecast is open.

**Grammar:** `Rout: 1 enemies remaining`.

## Finding 4 — Tutorial structure

**It is easy to miss.** On a genuinely fresh profile the cursor defaults to NEW GAME. TUTORIAL is two rows below it, marked only with a small red NEW badge.

**The dialogs cover what they describe.** Every Field Note dims the map and sits over the middle of it. "Click a blue unit to select it. Blue tiles show where it can move" is displayed with the blue units hidden behind the dialog. The same pattern repeats on the forecast lesson, which dims the forecast it is explaining.

**Smaller friction:** each Field Note carries two Continue buttons (a small one top-right and a large one below). One note crams three separate lessons into a single panel — terrain effects, the danger zone key, and inspect-plus-details. The fort note fires before the panel it points to has updated.

**What it never teaches:** the weapon triangle, doubling and attack speed, staves, consumables, any objective other than rout, and the entire run layer — node map, shops, church, colosseum, deploy, blessings, difficulty, meta progression.

**The handoff is missing.** The tutorial ends with "You're ready for a real run" and returns to the title screen with no prompt to start one. Then the first real battle opens with "Click a blue unit to move," repeating the tutorial's first lesson as if it had not happened — the run-layer notes are not gated on tutorial completion.

## Finding 5 — Run layer

**The game describes node types that are not on the map.** The pre-map Field Note reads "Villages let you buy, sell, and forge. Churches heal and promote." The generated Act 1 map had neither — 11 battle, 2 recruit, 1 colosseum, 1 ruins, 1 boss. The post-battle hint then read "Visit Church or Ruins nodes to heal," still naming a node type that did not exist in that run.

**Help → GOALS → Node Types omits Colosseum entirely**, although a colosseum node was on the map. The page is also text-only, with no icon beside each type — so it cannot be used to decode what is drawn on the map.

**The node glyphs are not legible at desktop size.** All types read as similar small tan marks. They are noticeably clearer at landscape-phone size. There is no hover preview either, so downstream nodes cannot be identified before committing to a path.

**The reward screen leaks the gold breakdown.** `Battle+Completion: 197G · Turn S: +375G · Total: 572G · Vault: 772G` repeats verbatim on the accessory and supply entries, where it does not apply.

**The turn bonus is the biggest untaught lever.** That `Turn S: +375G` was nearly double the base gold. Turn count drives the run economy more than anything else the player controls, and nothing in the tutorial or the first run mentions it. `Par: 7 (S)` in the HUD corner is the only hint it exists.

**Minor:** the opening dialogue plays over a black screen. The same help content is labelled "How To Play" on the title menu and "More Info" in the pause menu.

## Proposed plan

### Phase 1 — Resource scoping

Almost entirely copy, highest value per line changed.

- Label lifetime wherever a count is shown: `Heal 3/3 · refills each battle`, `Vulnerary ×3 · run supply`, `Eye: 1 rewind left this run`.
- Change both Vision dialogs from "(N remaining)" to "(N left this run)".
- Unify the HUD's "current turn" with the grant dialog's "last turn."
- Add a short confirmation after a rewind resolves, naming what it reverted to.
- Add effect text to item rows, so a Vulnerary says what it heals.

### Phase 2 — Forecast honesty

- Add a `Lethal` entry to the existing forecast `warnings` array whenever the counterattack can kill at any nonzero hit rate.
- Show weapon-triangle state on the Hit and Damage rows.
- Make `No Counter` explain itself.
- Fix the control-hint row bleeding through the forecast panel.

### Phase 3 — HUD truth

- Bind the info panel to the selected unit and its current tile, and refresh it after every action, instead of tracking the last hovered tile.
- Relabel `Move: 1` to `Cost: 1`.
- Surface a one-line par explanation on the first battle.

### Phase 4 — Tutorial rebuild

- Default the fresh-profile cursor to TUTORIAL.
- Reposition Field Notes so they never cover their own subject; drop the duplicate Continue.
- Split the three-lesson note; fix the fort note's timing against the panel refresh.
- Add beats for the weapon triangle, doubling, and staves versus consumables.
- End with a direct "Start your first run" handoff, and gate the first-run battle notes on tutorial completion so they stop repeating it.

### Phase 5 — Run-layer legibility

- Generate node-type copy from the map that was actually rolled, so the game never names a node type that is not present.
- Add Colosseum to the Node Types help page and put the icons beside the names.
- Add an on-map legend or node hover preview.
- Scope the reward gold breakdown to the gold entry only.

### Phase 6 — Compendium

The Stats section drafted separately, plus a Run section covering Vision, staff and consumable scoping, par and the turn bonus, and node types. This is the reference backstop behind everything Phases 1–5 surface inline.

### Sequencing

Phase 1 first. Phases 2 and 3 next, in either order. Phase 7 (below) is the largest piece of work and should follow Phase 1, because Phase 1 establishes the vocabulary the helpers will reuse.

## Phase 7 — Tutorial toggle and contextual helpers

Dave's proposal: a tutorial on/off setting that, when on, surfaces a helper the first time each mechanic appears — map nodes, consumables, rewinds, combat, danger zone and so on — with care taken that it does not become disruptive.

### Most of the machinery already exists

`HintManager` (`src/engine/HintManager.js`) is already the right foundation. It is per-save-slot, fire-once (`shouldShow(id)` returns true once and marks the id seen), has no Phaser dependency, stores to its own `localStorage` key independently of meta and run saves, and degrades quietly in incognito. Seventeen hint ids are already wired, including `battle_danger_zone`, `battle_heal_uses`, `battle_deploy`, `nodemap_hp_persist` and `firstrun_onboarding`.

The contextual hint bar seen after battle 1 — "HP carries between battles. Visit Church or Ruins nodes to heal" — is this system working exactly as intended: brief, bottom-anchored, non-modal, dismissing itself. It is the right pattern, and Phase 7 is mostly a matter of extending its coverage and putting a switch in front of it.

So the work is smaller than it sounds:

1. Add a `hints` setting to `normalizeSettings` in `src/utils/SettingsManager.js`, defaulting to on, and gate `HintManager.shouldShow()` behind it.
2. Add the toggle to the Settings overlay, plus a "reset hints" action so a player can replay them without wiping a slot.
3. Fill the coverage gaps with new hint ids.
4. Convert the remaining modal Field Notes to the same non-modal bar.

### Coverage gaps to fill

Each fires once, on first encounter, and each corresponds to a finding above.

| Trigger | Helper should say |
| --- | --- |
| First consumable in a unit menu | Consumables are spent permanently; this is your run supply |
| First staff use | Staff uses refill at the start of every battle |
| First Vision charge visible | Rewinds last the whole run, not the battle; act bosses in Acts 2–4 grant one more |
| First forecast where the counter can kill | This attack can kill you — pair with the `Lethal` warning from Phase 2 |
| First weapon-triangle matchup | Swords beat axes beat lances beat swords |
| First doubling opportunity | What `AS` and `x2` mean |
| First bow or mage attacked at the wrong range | Why `No Counter` appeared |
| First node map | A legend for the node glyphs — built from the types actually on this map |
| First non-rout objective | What seize or escape requires |
| First battle | What par is and what the turn bonus pays |

### Rules to keep it non-disruptive

This is the part worth being strict about, because a helper system that interrupts is worse than none.

- **Non-modal by default.** Bottom-anchored bar, no dim, no Continue button, auto-dismissing. Reserve modal Field Notes for the tutorial map only, where blocking is the point.
- **Never cover the subject.** A helper about the forecast must not sit on the forecast. This is the single most common defect in the current notes.
- **One per decision point.** Never two helpers in the same player action. If two would fire, queue the second to the next eligible moment.
- **Fire at the decision, not before it.** The current "Villages let you buy, sell, and forge" note fires on a black screen before the map exists. A helper should appear when the player can act on it.
- **Never name what is not there.** Generate helper copy from live run state, so the game stops describing Churches on maps that have none.
- **Cap early density.** A budget of roughly one helper per battle in Act 1 keeps the first run from feeling like a manual.
- **Suppress after the tutorial.** If the tutorial taught it, do not re-teach it in battle 1.

### Where the toggle lives

Settings, defaulting on, so a first-time player gets helpers without opting in and a returning player can switch them off in one place. Worth considering a second surface on the fresh-profile title screen — the only moment a new player is choosing how much help they want — though that risks asking the question before they know what they are answering.

## Open questions

1. **Branch.** Do these land on `mobile-rebuild-checkpoint` or a branch off it?
2. **Mobile parity per phase.** Should every inline change ship with its mobile-HUD equivalent in the same pass? At least one string has two sites already — `MobileBattleHUD` relabels `Eye:` to `Rewinds:`.
3. **Phase 7 scope.** Full helper system as described, or start with the toggle plus the four resource-scoping helpers and extend from there?
4. **Tutorial rebuild depth.** Phase 4 as written is a repair of the existing tutorial. An alternative is to rebuild it as a second, longer tutorial map that also covers the run layer. That is considerably more work and worth deciding before starting Phase 4.


## Implementation acceptance — tutorial repairs

- TutorialController now owns concise fort, forecast, and resource lessons. The fort preview refreshes before the lesson; the strict movement gate remains active until dismissal.
- Forecast lessons teach triangle and doubling only when the current exchange exhibits them. Subsequent tutorial forecasts can introduce an unseen mechanic without repeating the generic explanation.
- The first staff/consumable menu explains both resource lifetimes. This is a tutorial-only modal; optional live-run helpers retain their separate budget.
- Completed tutorial records the actual taught hint IDs. A newly-created slot imports only those known IDs; skipping does not suppress lessons, and unencountered mechanics remain eligible later.
- Reserved scene integration: BattleScene calls the fort/forecast methods, MobileBattleHUD calls the resource method after strict-gate release, PostCombatController records completion, and new-slot setup applies completed tutorial hints. First-run handoff uses the existing Title new-game path.
- Acceptance tests cover conditional lesson selection, preview-before-hint order, concurrent lesson rejection, shutdown without restoring gameplay input, and taught-hint propagation to a new slot.


## Final acceptance — local presentation checkpoint

The tutorial now launches on the first title tap even during the preceding transition cooldown. TUTORIAL and its START HERE subtitle fit within the phone button. At the fort, terrain information refreshes before its lesson. Forecast lessons reserve a separate screen area and show the actual relevant damage/hit, triangle or AS/planned-hit fields; Continue restores the full forecast and its input scope. First staff targeting teaches resource lifetime even when no staff picker is needed. Completion records only lessons actually shown and returns to Title's START FIRST RUN action. Reset hints remains respected on subsequent reloads.

Normal-run helpers share one claim-on-display budget per battle, remain optional, and include forecast conditions and rewind scope. Queued first-turn explanations only begin from PLAYER_IDLE. Detailed Run/Stats references remain available on demand. Desktop forecast uses the same display helpers and an opaque panel; unsupported HP-changing effects omit projections.

Verified by the headed SE tutorial journey (including subject/note rectangle separation), phone/desktop forecast tests, input/rotation/shutdown contracts, full unit and harness suites. This is local, not uploaded. See `presentation-checkpoint-review-2026-09-20.md` for the concise release review note and verification limits.
