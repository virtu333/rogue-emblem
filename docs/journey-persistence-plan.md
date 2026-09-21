# Journey persistence and fuzzing

## Next roadmap

The reviewed `implementation-plan-2026-09-20.md` follows this local stability checkpoint. Sequence: release/phone feedback → effects/accessibility split → focused UX improvements → separate story wave → measured balance slices. Complete random combat/suspend journey integration before AI/2RN/enemy-healing changes. Targeted combat contracts below do not close that item. Runtime telemetry remains separately scoped. Church/Colosseum/Shop renderer cleanup is completed locally and must not be scheduled again from older notes.

## Combat contracts and Part B — local checkpoint, September 20

Completed the three service removals in the planned Church → Colosseum → Shop order. The controllers now contain lifecycle/gameplay orchestration; ChurchMenu, ArenaMenu and ShopMenu are their only renderers. Removed canvas focus, scrolling, tooltips, recipient/forge pickers, scene delegates and the unused service-layout module. Shared utilities with other live consumers remain.

- Church: retained healing/revive/promotion commands, ruins-to-market handoff, map/roster return, node completion and save warnings.
- Arena: retained generation and malformed-board handling, Master of Arms, old-board innate-skill repair, combat/XP settlement before the log, hire revalidation and durable visit limits.
- Shop: retained pricing, stacked discounts, restock behavior, caravan state, details and persistence. Non-shop node-flavor and weapon-art unlock notices still reach the shared hint channel. Entry flavor now appears in the native status region.
- Deleted renderer-only tests were replaced with native menu contracts. Kept underlying engine, extended-level, convoy, accessory, pricing, refund, stale-apply and service persistence coverage. Lower unit totals reflect removal of obsolete canvas assertions, not skipped tests.

### Combat scope and discovered issue

`JourneyCombat.test.js` adds seven targeted production checkpoint contracts to the explicit `test:journey` gate. It drives real XP, popup checkpoint capture, save/load, unit/world restore, final action completion and Rewind. Reload reads existing storage; it never saves first. Tests cover popup refresh without duplicate XP/actions, a missing-save calibration, failed-write durability and retry, condition/usage/movement/terrain/fog preservation, and sanctioned Continue from Map restoring entry charge state.

The test fixture starts with resolved damage and calls real XP/presentation orchestration; it does not substitute for a whole graphical attack. The existing battle harness tests combat resolution. Combat is **not yet part of the random service journey vocabulary or its JSON replay format**. That broader fuzz integration remains a follow-up, not a claim of this checkpoint.

The storage-fault test exposed a misleading success result: `captureCheckpoint()` returned true even when `_persistBattleRunState()` swallowed a failed write. The scene now returns the actual result and capture returns true only for `ok: true`. A failed write leaves the previous disk checkpoint intact; a successful retry stores live state without replaying XP. No save schema changes.

### Review and verification

- Independent adversarial source review: no blocking regression or stale deleted service call; retained live non-shop notice callers and arena preparation/settlement explicitly checked.
- 5,211 unit tests passed, all 289 files. The full harness passed after removal; the dedicated journey gate passes 53 cases, including the seven new combat contracts.
- Fresh-seed service soak: 295 journeys passed in ten seconds. All PR simulation slices passed.
- Headed service tests passed at 667×375 and 844×390: Church heal/promote/cancel, roster/map round trips, arena forecast/fight/reward/hire, Shop details/buy/sell/forge and rotation.
- The rotation test was corrected to acknowledge the existing portrait landscape prompt and restore landscape before tapping underlying controls.
- The broader headed regression pass found pre-existing disconnected selection helpers in RunSetupMenu and ReferenceMenu. Keyboard/controller navigation now calls those helpers; search editing and modified shortcuts remain untouched. The headed setup/reference/desktop checks then passed.
- Theme, data parity, reference and production build passed. ESLint reports zero errors; existing warnings remain. Logs: `/tmp/legacy-*`; soak artifacts: `/tmp/journey-legacy-soak/`.

TestFlight remains **0.1.0 (10)**. This checkpoint is local and uncommitted; no GitHub push, iOS archive or TestFlight upload was performed. Phone checks of build 10 do not exercise these changes.

## A3/A4 — implemented locally

- Targeted calibration: S2 suppresses the arena settlement call to `saveServiceRun`; S3 suppresses ShopController._persistVisit, Church's `saveServiceRun`, or the arena scene's persistRunSave. Other writers remain active. S1/S4 retain their focused spies. No production fix is reverted for calibration.
- `RunDriver.trace` is the authoritative action record. Regex selectors become exact button labels/indices; picker choices include a content hash. Replay consumes the recorded targets without an action chooser and rejects unavailable targets, incomplete checkpoints, catalog changes and state divergence.
- `JourneyFuzzAgent` uses a separate seeded RNG. Gameplay RNG and the item UID counter reset at run start. Every scenario recreates real storage/controllers; globals are restored afterward. The runner rejects concurrent use within one worker.
- Guided random selection uses currently enabled production menu callbacks. View Map/Roster and early Abandon are outside this fixture's random vocabulary (Abandon remains covered by its focused contract). A service is not deliberately left until its transaction goals are met. This is randomized service navigation, not a random campaign or browser-click fuzzer.
- Passing requires buy/sell/forge, church heal/promote/revive, arena fight/hire, caravan purchase, every service leave and a post-transaction reload. Histograms count actual durable state changes rather than clicks on transaction buttons. Idle-only traces fail coverage.
- JSON artifacts include format/fixture versions, seed, data hash, initial hash, resolved action trace, per-action state hashes, coverage, failure index and field-level diff. The old `d.trace` was extended, not replaced by a second trace implementation.
- `test:journey` explicitly runs the ten fixed seeds, calibration and replay integrity checks in CI. The merge-gate script includes it too; its existing full harness also discovers these files. CI uploads replay artifacts on failure. These are local workflow edits; no remote CI run is claimed without pushing the repository.

### Commands

```sh
npm run test:journey
npm run fuzz:journey -- --seed 1308702465
npm run fuzz:journey -- --trace /absolute/path/to/replay.json
npm run fuzz:journey:soak
npm run fuzz:journey -- --soak-seconds 10 --out /tmp/journey-soak
```

The soak uses fresh seeds, logs each completed seed and coverage in `soak-summary.json`, stops on failure and keeps the full failing trace. The default five-minute soak is separate from CI; a ten-second smoke soak was executed here. Replaying a still-failing invariant exits nonzero even when the failure reproduces exactly. A trace from before a gameplay fix may correctly diverge afterward; its seed can then become a post-fix regression.

### First real finding: mercenary class abilities

Fresh seed **1308702465** failed at action 65: hiring a Dancer produced live skills `[astra]`, while reload added `dance`. The CLI reproduced the same action and state diff. `ColosseumEngine` now grants class-innate abilities before showing new candidates, through a shared cap-aware helper; `ColosseumOverlay` applies that helper when reopening older saved boards too. Tests cover Dancer, Hunter and Paladin abilities, an old Dancer board, and the discovered seed. This is an application fix queued for the next build, not shipped to TestFlight in this task.

### Verification and reviewer focus

- **5,294 unit tests** and **155 harness tests** passed.
- **46 journey checks** cover fixed seeds, replay integrity, calibration, failure handling and service journeys.
- After the generation fix, a ten-second fresh-seed soak completed **324 journeys** without failure. The subsequent saved-board compatibility fix has targeted coverage.
- All PR simulation slices, reference/data parity and targeted ESLint passed (zero errors; three pre-existing warnings in ColosseumEngine.test.js).
- CLI generation and replay of the repaired seed passed with identical hashes/coverage.
- Artifacts/logs: `/tmp/journey-a3/`; initial failure and exact reproduction under `soak/` and `reproduced/`, corrected CLI trace/replay under `fixed-regression/` and `replay-fixed/`.

Review the oracle separately from the driver: there must be no save-before-reload, no command-level substitute for a shipping menu save, and no coverage counted for a no-op mutation. `JourneyTestSetup.js` contains the shared presentation substitutions for both suites. Existing browser contracts still own real input timing, DOM teardown, layout, notch/keyboard/audio behavior and actual page refresh. Combat checkpoint/fog integration and legacy renderer removal remain follow-ups.

## A1/A2 foundation — historical checkpoint

Implemented the first service-journey driver and invariant library. This checkpoint changes tests and documentation only; build 10 and player saves are unaffected. No renderer deletion, application mutation, GitHub commit/push or TestFlight upload is part of this checkpoint.

At this foundation checkpoint the suite was deterministic and scripted. Random action selection, replay files, coverage reporting, a dedicated CLI/CI job, and full combat/popup journeys remain A3/A4 and the following integration phase. Do not describe this checkpoint as a completed journey fuzzer.

## Production paths exercised

`tests/harness/RunDriver.js` builds a real RunManager with real catalog data and Map-backed localStorage. A synthetic service route, damaged lord eligible for promotion, fallen ally, gold and optional pending caravan establish reproducible preconditions. Map generation/traversal legality and act transitions are not tested by this fixture.

- ShopController.handleShop/showShopOverlay -> actual ShopMenu render callbacks -> Buy/Sell/Forge picker apply -> ShopMenu.complete/persist -> real save functions. Entry caches stock. Leave uses the actual controller close/mark/save path.
- ChurchController.handleChurch/showChurchOverlay -> actual ChurchMenu callbacks for Heal, Promote and Revive -> finish/save. Leave marks the node and saves using the actual controller.
- ColosseumOverlay.show -> actual ArenaMenu fighter/tier/forecast/Fight callbacks -> real combat and settlement -> immediate persistence before log dismissal. Mercenary generation, confirm hire, reopening visit limits, and leave are exercised.
- NodeMapScene.showPauseMenu -> actual onAbandon callback -> run removal, failure and persisted meta settlement. Scene transition rendering is stubbed.

No ShopCommands/ChurchCommands calls or save calls are supplied by the driver to make transactions succeed. The only driver-owned run write creates the initial fixture. `reload` drops live controller references and calls loadRun against storage as it exists; it never saves, invokes Leave, or calls visual teardown callbacks that could persist state.

## Presentation boundary

`JourneyPresentation.js` substitutes MenuSurface's display objects, ChoicePicker's visual shell and PauseOverlay's shell. Production menus still build their own real closures, eligibility checks, command calls, messages and save calls. Phaser, navigation to a new scene and hint rendering are replaced; hint calls remain observable. The picker adapter executes the real selected-choice block/apply callback.

This is not a DOM emulator or input/async timing test. Browser contracts continue to own focus, modal depth, gestures, keyboard/controller routing, in-flight cancellation, layout and actual page termination. The stub models only the display operations needed to capture callbacks, including moving an existing button into another container.

## Invariant boundaries

`JourneyInvariants.js` compares individual durable fields: gold; roster/fallen-unit health, level, XP, stats, growths, proficiencies and skills; equipment and carried/team/convoy items; node completion and position; shop stock/forge/restock counts; caravan pending/active state; arena fight/XP/hire limits and mercenary contents; church promotion count and dialogue flags.

Comparison excludes save timestamps, methods, scene/view state and item UID stamping introduced during legacy-load repair. Item content, order, equipment and owner remain compared. UID identity preservation, battle transient fields, multi-slot/cloud state and the rest of RunManager's full schema are not claimed by this projection.

| Flow | Required durable boundary |
| --- | --- |
| Shop/caravan | Entry, successful transaction, leave |
| Church | Successful heal/revive/promote and leave; entry itself is read-only |
| Arena | Generated mercenary board, resolved fight before log, hire, leave |
| Pending picker/Back | No transaction from a cancelled choice; root Back follows its real leave callback |
| Reload | Existing stored state restored without a write or service-leave call |
| Abandon | Run save removed; expected Valor/Supply and one completed run persisted to meta |

Additional semantic assertions ensure that caravan entry consumes the pending reward and caches stock, leave completes the expected node/position (or ends the caravan), and completed nodes remain completed within the same run/act. These catch consistently wrong live-and-saved state that equality alone would miss. Arena challenger previews are regenerated by the current controller and are not persisted; this checkpoint does not claim preview-opponent continuity across reload.

Write failures throw from storage. They preserve the previous durable expectation; the live mutation is not mislabeled as saved. Tests require a visible warning path, verify reload restores the old durable state, and verify a later successful leave saves a previously failed purchase without charging twice.

## Calibration

Calibrations are isolated defect equivalents, not literal historical source reverts. Production fixes are never edited or left reverted. Expected invariant failures are asserted within passing tests.

| Historical family | Injected defect | Detection |
| --- | --- | --- |
| S1 | Suppress settlement in the actual Abandon callback | Meta payout mismatch |
| S2 | Suppress the settlement save call during actual Fight/settlement | Live/stored arena or resource mismatch |
| S3 | Suppress the specific persistence method on each Shop/Church/arena leave | Saved route/position mismatch |
| S4 | Suppress caravan-entry persistence method; separately retain pending reward/remove active stock while saving | Persistence mismatch or explicit caravan-entry contract |

Also calibrated: missing markNodeComplete despite a successful save; unsaved gold, XP, inventory, fallen roster and route changes; compensating gold/item changes; and completed-node rollback. The targeted missing-save spies leave other persistence paths intact, while quota-failure tests throw to represent actual storage failure. These are separate failure modes.

## Verification

- 29 new journey cases pass.
- Combined run of `tests/harness` and `tests/PersistenceBoundaryContracts.test.js`: 155 tests pass, including existing seeded battle fuzz and determinism suites.
- Targeted ESLint and Prettier checks pass.
- Command: `npx vitest run tests/harness/JourneyPersistence.test.js`.
- Broader command: `npx vitest run tests/harness tests/PersistenceBoundaryContracts.test.js`.

This file is discovered by `npm test` and `test:harness`; current CI's `test:unit` excludes it and `test:harness:pr` invokes the older battle runner directly. Explicit CI wiring remains A4, not silently assumed complete.

## Original follow-up sequence (status superseded above)

1. A3: legal-action enumerator and weighted chooser with a separate RNG stream, resolved target identifiers, versioned replay artifacts and action/boundary coverage. Ensure scripts recreate RNG and item-UID generator state; current deterministic seed installation belongs to Vitest setup.
2. A4: dedicated short seeded tier and explicit CI invocation; separate time-bounded soak with recorded seeds. A pass that exercises no substantive transaction must fail coverage requirements.
3. Add combat/popup/suspend checkpoints through production orchestration, retaining headed timing contracts. Include storage fault recovery and intentional Continue from Map/Rewind semantics.
4. Legacy cleanup: Church -> Colosseum -> Shop. Inventory call sites and test dependencies, extract shared behavior before renderer removal, and require service, journey and headed contracts per slice. Do not use zero coverage alone as proof of unreachability.
