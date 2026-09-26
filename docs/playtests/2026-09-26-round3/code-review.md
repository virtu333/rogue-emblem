# Round 3 — recruit identity, spawn, portrait sprites, loot and continuation review

Snapshot: `/tmp/rogue-review113`, parent-pinned SHA `336cd41d`; baseline `/tmp/rogue-review89`. Read `AGENTS.md`. No source patches. Reviewed PR scopes #98, #111, #110 and #108 through diffs, surrounding callers, focused suites and independent engine probes.

## P2 — Old mid-battle collision saves can mark the living recruit dead and lose the actual casualty

**Primary location:** `src/engine/BattleRecruits.js:104–110`, especially the conversion to `entry.unit` and roster-first matching at lines 107–108. Related: `src/engine/UnitIdentity.js:84–91` and `src/engine/RunManager.js:3430–3458`.

The new UID fix works for new recruits and for legacy runs which have not yet recruited the NPC. However, a checkpoint made before #98 can already contain a Talk recruit and its fallen-recruit record, both without `unitUid`. The run roster receives UIDs on load, but checkpoint units and existing recruit records are not migrated to matching identities. If a hired mercenary and the Talk recruit share a name, and the mercenary dies while the recruit survives, the fallback claims the survivor for the roster mercenary by name first. It then reports the living recruit as fallen.

At victory, `completeBattle` repeats this pairing: the recruit gets the mercenary's UID in the living roster, and a second copy of that same recruit is put into the fallen pool under a fresh UID. The real dead mercenary's stats/items are not retained as the casualty. This is an incomplete legacy-save repair with a newly introduced false fallen entry; new saves with fully stamped identities are unaffected.

### Reproduction and observed consequence

`legacy-recruit-collision-probe.mjs` uses shipped data and the original round-2 collision:

1. Run seed **2** promises Archer **Linnet** at `act1_4_0`.
2. The old mercenary-name exclusion list (current roster only), mercenary RNG seed **10**, produces another Archer **Linnet**, level **4**. This models a hire made before the fix.
3. Build the promised recruit, level **2**, and record its Talk with battle entity ID **u9**. Keep all units/records without `unitUid`, matching the old format.
4. Load the old-format run roster through `RunManager.fromJSON`; model the legacy checkpoint's survivors with the mercenary absent and the level-2 Talk recruit alive.
5. Call the real `fallenBattleRecruits` and `completeBattle` paths.

Observed output:

| Unit | Expected | Actual |
|---|---|---|
| Hired Linnet, level 4 | Fallen, revivable | Missing from fallen pool |
| Talk recruit Linnet, level 2 | Living only | Living as `ru3` **and** fallen as `ru4` |

The legacy record's `entityId` and surviving NPC's `battleEntityId` are both **u9**, so sufficient identity information exists before victory serialization. `fallenBattleRecruits` discards the record's outer entity ID; `PostCombatController` also serializes survivors before matching, removing their battle IDs. The repair should migrate the checkpoint's units and recruit records consistently before those identities are lost, rather than treating every old same-name survivor as a roster unit.

The existing legacy test in `tests/RecruitIdentity.test.js` removes UIDs from survivors but leaves a freshly stamped recruit/record and exercises the opposite casualty direction. It does not cover a real old record with no UID and a surviving Talk recruit.

Evidence: `legacy-recruit-collision-evidence.json`. This is an engine-level reproduction of legacy boundary objects and real completion functions, not an end-to-end browser resume test.

## Prior findings reverified

### Fixed: new mercenary hires no longer take promised recruit names

Independent original-seed probe: run **2**, mercenary RNG **10**. Old exclusion list produced `[Oriel, Linnet, Ilka]`; the current UI's `getTakenUnitNames()` exclusion produces `[Oriel, Colm, Ilka]`. Pending Linnet's identity stays unchanged.

The same probe models an already-existing collision with current stamped units: mercenary `ru3`, recruit `ru4`. With the recruit dead and mercenary alive, the recruit is correctly recorded fallen as `ru4`. The previous round's exact casualty-loss case is fixed. The finding above is the narrower pre-UID checkpoint case in the other death direction.

### Fixed: Rowan's original Mountain spawn

Original run **54**, Act I node `act1_3_4`, battle RNG **1674** now resolves Cavalry Rowan before placement and puts him at **Forest (1,7)**, Cavalry cost **3**, instead of impassable Mountain (4,7).

Independent generated-map sweep: **1,504 recruit battles**, run seeds 1–200 across Acts I–IV, checked the actual built recruit's move type against the generated tile. **Zero invalid spawn tiles.** This checks terrain compatibility, not tactical rescue success or full-run balance.

Evidence and reproducible script: `recruit-fix-evidence.json`, `recruit-fix-probe.mjs`.

## Other reviewed scopes

- **#111 portrait/sprite identity:** shared displayed-person resolution, promotion/reclass fallback, derived NPC textures, replay texture recreation, and legacy sprite-key fallback. No additional actionable defect confirmed. Pixel appearance is a separate visual-playtest concern.
- **#110 loot:** unused-name filtering, duplicate weighted entries, item resolution, quality-upgrade ordering, and gold fallback. No additional actionable defect confirmed; quality upgrades still have a post-upgrade duplicate guard.
- **#108 action continuation:** shared engine normalizer, snapshot validator integration, UI re-export and battle-entity ID checks. No new actionable defect confirmed.

## Focused verification

**11 test files passed, 340 tests passed**, zero failures (Vitest reported 1.15 s):

| Suite | Tests |
|---|---:|
| RecruitIdentity | 19 |
| RecruitLordSpawnTile | 9 |
| FallenRecruitRevival | 13 |
| RecruitNodeSystem | 30 |
| BattleSceneRecruitNode | 7 |
| TracedPersonSprites | 77 |
| TracedSprites | 17 |
| PortraitVariants | 28 |
| LootNoWastedDraws | 3 |
| LootSystem | 98 |
| ActionContinuation | 39 |

No source changes, browser actions, deployment, or balance simulation performed by this reviewer. The standalone probes and report are review artifacts only.

## Follow-up: code corroboration of visible mobile UX observations

### Confirmed selection defect — Sera's route chip opens Edric

The parent browser playtest observed tapping `Sera 19/19 HP` on the route's bottom mini-roster and landing on Edric in the full roster. The handler confirms this is deterministic:

- `src/ui/NodeMapMenu.js:224–225` loops over each lord, but binds every individual chip to the same zero-argument `s._openRoster()` call. The rendered `unit` is not passed.
- `src/scenes/NodeMapScene.js:1443` accepts no initial selection and constructs a new overlay each time.
- `src/ui/RosterOverlay.js:131` initializes `{ kind: 'unit', index: 0 }`; line 179 passes that index to `MobileRosterSheet`.

Thus every named lord chip opens the first roster member, regardless of which chip was tapped. This is a current UX defect corroborated by source, not a newly introduced regression in this snapshot (`NodeMapMenu.js` is unchanged from the prior snapshot). A narrow correction is to carry the clicked unit/index through `_openRoster` and initialize the overlay selection before `show`; the generic Roster button can retain the index-0 default. No edits made.

### Forecast Shieldmate — no hidden explanation gesture found

`Shieldmate` is a trait, with description **“+10 Avo while adjacent to an ally.”** (`data/traits.json:164–169`). The mobile forecast displays the names from `info.skills` in a plain `p.mb-detail` (`src/ui/MobileBattleHUD.js:482–485`). This element has no `title`, tooltip, click, or long-press binding. The forecast pointer handlers at lines 556–577 implement weapon swiping, not description lookup. Canvas forecast similarly draws only the names in noninteractive text (`src/ui/ForecastOverlay.js:560–579`).

The explanation is available elsewhere: `MobileRosterSheet` renders full trait text in its Traits section (`src/ui/MobileRosterSheet.js:445–449`), and skill descriptions in its Skills section. Therefore the accurate UX observation is **missing in-context trait explanation while deciding an attack**, not missing documentation throughout the game. An inline description or explicit inspect affordance in the forecast would address it; do not advise the player that an existing forecast long-press reveals it. No new test run was needed for these handler/render-path inspections.

## Follow-up: resumed terrain and lean-level wording

### Resumed terrain: transient fallback, not a confirmed persistent regression

The parent browser playtest initially saw small repeated legacy forest/fort tiles after Save & Return to Title → reload → Resume. Later, after roughly a minute spent opening/stepping history and returning live, the painterly live terrain was present again, with no `[BattlefieldArt]` warning observed. Classify this as a visible loading/presentation transition, not persistent save corruption or a verified missing theme.

The code supports a transient fallback explanation: both fresh and resumed battles create `Grid` and call `paintBattlefieldTerrain` at `src/scenes/BattleScene.js:1299–1309`. `Grid.render` initially creates ordinary tile displays (`src/engine/Grid.js:251–265`), while `BattlefieldTerrainPainting.start` asynchronously paints and later replaces their texture frames (`src/ui/BattlefieldArt.js:190–215`, `_paintAll` at line 234 onward). There is no distinct resume branch omitting terrain initialization. Checkpoint restoration changes the same grid through `setTerrainAt`, which the painter supports. Exact observed latency was not timed against paint completion; history navigation coinciding with the later correct view does not establish that history repaired it.

Additional focused verification: **BattlefieldArt — 14 tests passed**, including tile restoration and terrain changes during an async paint. These are in addition to the earlier 340 tests. No source correction proposed without a reproducible timing failure. History/rewind's separate miniature terrain presentation should not be mistaken for the live battlefield's terrain renderer.

### Confirmed minor wording mismatch: a +1 RES level can say “No change”

`src/ui/growthContent.js:223–228` classifies any non-extended level with total gains **0 or 1** as `blank`, displayed as **A LEAN LEVEL**. `src/engine/UnitVoice.js:208–214` selects a lord's voice pool using that kind. Sera's `blank` pool (`data/dialogue.json:7483–7488`) includes “No change. I've walked this step before. It's always this quiet.” and “Nothing gained.” Therefore the observed +1 RES alongside a no-change quote follows the current rules. This is a flavor-text accuracy issue, not a lost stat gain. Either distinguish zero gains from one gain for dialogue, or make lean-pool wording valid for both.

## Follow-up: The Last is awarded after a casualty-free victory

**Confirmed award/narrative defect; not a new code regression.** The parent's mobile Act II battle ended with Edric, Sera, Voss and Leona alive, yet Leona received **The Last**, with lore “Came back alone, carrying the names of the rest.” The standalone `last-deed-probe.mjs` reproduces the exact party composition with all four at 20/20 HP, deployed count 4, zero deaths, and no preexisting deeds: `commitBattleDeeds` returns `last_of_them` for Leona.

Source:

- `src/engine/DeedSystem.js:573–587` filters living survivors, then counts only non-lords; if exactly one remains, it sets `lastStanding` to the **total** deployed count. There is no casualty check or requirement that another non-lord was deployed.
- `src/ui/DeedController.js:142–146` supplies total `battleParams.deployCount`.
- `data/deeds.json:241–247` grants the title when `lastStanding >= 4`, with the alone/survivor lore.

**Intent nuance:** `docs/specs/deeds-epithets.md:84` explicitly describes “the only non-lord alive at the end of a battle with ≥4 deployed.” `tests/DeedSystem.test.js:271–282` encodes that same condition, asserting the award with a surviving lord and one recruit. Therefore the implementation follows the written rule; the written rule itself permits a casualty-free award that contradicts its meaning. It is not accurate to call this a newly introduced implementation/spec mismatch. `DeedSystem.js` is byte-identical to the previous review snapshot.

Correction should align the design rule, narrative, and tests. If this is meant to commemorate loss, require actual relevant casualties and track the original eligible deployment, not just total deployment size. A literal single-survivor requirement also needs care because the commander normally must survive to win. Add a negative test for **three surviving lords plus one surviving recruit, all deployed units alive**; current tests do not exercise this no-loss party.

Evidence: `last-deed-evidence.json`. **47 DeedSystem tests passed** despite the probe demonstrating this edge case; no source modifications.
