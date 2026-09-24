# Second-pass UX fixes — release extension

Source: [ux-audit-supplement-2026-09-20.md](ux-audit-supplement-2026-09-20.md). The first audit implementation remains in this release; build 10 upload is held until this extension is verified. Claims are validated individually against current code and visible behavior.

## Work order and ownership

1. **Persistence and refresh integrity:** node-map abandonment payout; arena result/hire/leave saves; service completion boundaries; stable caravan stock; resolved combat/XP/promotion before blocking presentation. Shared commands and boundary tests must compare persisted outcome with live state rather than only assert that a save function was invoked.
2. **Combat information:** one fog visibility rule for every inspect caller; visible status/reasons; status-staff threats; refreshing visible threat overlays; advance enrage warnings.
3. **Mobile interaction:** shared cancelable press behavior; consistent End turn confirmation; notch-safe rail sizing; safe update notification; accessible auth/rotate behavior; one-finger camera pan after the drag threshold.
4. **Save identity and cloud boundary:** confirm new-run slot allocation when saves exist; show army/location/time/suspended status; preserve a displaced device version before applying newer cloud data and require an explicit version choice on selection; failed logout backup never authorizes a later blind wipe.
5. **Polish and verification:** actual price modifiers, casualty gear outcomes, accessory/scroll resale, confirm labels/order, loading/viewport behavior and copy. Add state-based tests, mechanical call-site inventory, headed adversarial sequences and independent review, then rerun release gates.

## Decisions

- Do not broadly delete legacy renderers during correctness work. Route shared behavior through shared rules/press/persistence helpers now; remove unreachable rendering in a separately verified cleanup. Deleting both behavior and tests while fixing persistence would obscure review.
- Do not send new beta telemetry to Supabase in this release. Diagnostics and reproducible invariant failures stay local. Remote collection needs an explicit data/minimization and consent decision.
- Use deterministic action sequences and reload moves around the changed boundaries as the immediate gate. A long-running random journey fuzzer is a follow-up after these state assertions are proven useful; random clicks without assertions do not improve confidence.
- Preserve existing action balance. Improve drag/pan and target feedback before adding a new confirmation to every movement/staff action.

## Validation notes

- S11: the second canvas is decorative auth artwork, not a second live Phaser game. Remove it after auth teardown to reclaim its backing storage.
- S9: persistent resize reconciliation already exists. Validate the reported late-resize mismatch rather than assuming the startup guard is the only resize owner.
- Existing first-audit browser regressions remain applicable. Some old gamepad tests still inspected deleted canvas focus rings; updated tests must drive the same real pad inputs against shipping DOM behavior and retain no-leak/Back/volume assertions.

## Required acceptance checks

Every service result and leave path: save → load → compare canonical run state. Refresh mid-combat presentation: no replayed action or lost XP/casualty; remaining Canto/continuation is explicit. Fog: hidden enemy inspection yields no identity/range on every input route. Touch: slide away/context change cancels; End turn still confirms. Save choice: neither version is discarded before the user chooses, and failed backup/storage preserves the surviving copy.

## Implemented and reviewed

- **S1–S4 / B4:** service leave paths serialize completed nodes; arena settles before its log and retains per-visit limits/candidates; caravan retains one generated inventory. Resolved XP/promotion presentation has an explicit saved action continuation. Independent review additionally caught the all-sleeping resume edge; its regression is part of the persistence pass.
- **B1–B3 / B5–B6:** shared fog inspection boundary, condition explanations, status-staff danger outlines, visible danger refresh and persistent boss pressure notice. The audit overstated the absence of condition UI: icons existed, but readable explanations and input feedback were missing.
- **M1–M6 / S9–S13:** shared cancelable press behavior, End turn confirmation from rails, notch-safe rail sizing, one-finger map pan, quiet update notification during play, larger auth controls with an explicit offline choice, reachable orientation notice, safe confirm defaults, loader progress and copy cleanup. Late resize already worked; a delayed resize regression now protects it.
- **S5–S8:** New Game explains slot allocation; slot cards identify army, location, battle suspension and save time. Cloud replacement first preserves device and cloud candidates, including progression; selection writes the chosen pair or retains recovery data on failure. Incomplete cloud fetches do not mix run/progression. Logout blocks unresolved versions and requires durable success for each captured backup write; queue completion alone is insufficient. Failed logout leaves local data intact.
- **S14–S16:** shop pricing modifiers are disclosed; casualty equipment outcomes are retained for presentation; unused team accessories and scrolls participate in the existing sale command/ownership checks.

## Independent-review corrections

1. Explicitly write the chosen cloud candidate even when its earlier storage write failed, and roll back the pair if progression cannot be written.
2. Keep incomplete save versions recoverable; never remove a slot's progression and then attempt to resume it.
3. Block logout while an alternative device save remains unresolved. Verify individual backup writes and unchanged captured data before clearing local slots.
4. Preserve automatic all-sleeping phase advancement when resuming past queued level-up presentation.
5. Replace advice to clear browser data after a quota error with advice to free device space while retaining saved data.

## Evidence so far

- Save choice: two headed iPhone SE journeys exercise New Game cancellation, slot identity, cloud/device comparison, Decide later and real resume of the chosen device run (`save-choice-contracts.spec.js`).
- Cloud and logout: 88 tests across eight suites, including rejected writes, remote-newer conflicts, partial fetches, retained alternatives, failed signout and repeated retries.
- Mobile shell: 14 headed gesture/forecast/pause cases plus the slow-loader regression; 108 focused unit tests. Existing controller suites were updated to drive the shipping DOM controls, retaining input-isolation assertions.
- Combat information: three headed phone cases and 141 focused unit tests. Art replacement list/detail scroll regressions pass at phone and base sizes.
- Real-storage boundary tests reload RunManager outcomes, rather than only spying on persistence calls. Final consolidated gates and distribution evidence are recorded in `testflight-beta.md` when complete.

Remaining follow-ups are architectural cleanup, seeded journey fuzzing built on these assertions, and opt-in/minimized runtime diagnostics. They are not represented as shipped changes. Physical iOS notch/keyboard/audio behavior still needs device playtesting.

## Ongoing gates

`npm run test:unit` includes the real-storage persistence and cloud failure invariants. `npm run test:ux-contracts` is now included in CI and exercises action/refresh, fog, touch, save choice and management/navigation contracts through Playwright. The final headed release pass contains all of these cases. CI will only run remotely once this local branch is pushed; no GitHub operation is authorized for this checkpoint.

## Final consolidated verification

5,291 unit tests, 109 real-engine harness tests, all PR simulation slices, 79 headed browser cases without retries, and the production offline phone smoke passed. Lint has zero errors (307 warnings); formatting, data/reference/theme checks, build and Capacitor sync passed. The iOS archive identifies version 0.1.0 build 10. Independent reviewers completed combat/presentation, service persistence and cloud/logout reviews; discovered blockers were fixed before packaging. Distribution status is recorded separately in `testflight-beta.md`.
