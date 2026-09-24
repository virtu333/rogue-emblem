# UX contract fixes — build 10 candidate

Implements the findings in [ux-contract-audit.md](ux-contract-audit.md). Build 9 remains the live baseline until distribution is verified in `testflight-beta.md`. No GitHub commit or push is part of this release.

## Changes

- **Action integrity (C1–C2):** trade mutation commits movement on the unit; returning through menus cannot grant another move. Ordinary completion and all Canto exits share village resolution, checkpoint and turn-finalization ordering.
- **Coherent rewind/resume (C3–C5):** the snapshot boundary follows automatic turn effects. Restored units use canonical inventory hydration. World state includes terrain, temporary-terrain owners, casualties and applied hybrid overrides; derived danger data is invalidated. Additional snapshot fields are optional for older saves.
- **Management outcomes (C6–C7, N6–N8):** zero-weight forging is rejected before payment or reward consumption. Reclass retains or equips a usable combat weapon and reports missing equipment/omitted skills. Class previews show stats, proficiencies, growth behavior, seals and skill-cap consequences without consuming RNG. Art binding supports step Back with old/new effects. Revival explicitly explains 1 HP and convoy equipment.
- **Navigation and explanations (N1–N5, N9–N10):** Home Base restores focus after skill changes; DOM screens own Escape. Controller traversal reaches reference filters, detail text and setup actions. Mobile help uses touch copy; Help search spans categories and restores the prior view. The persistent-HP hint waits for its prerequisite. Results derive their act total from the run.
- **Contextual help:** class mastery shows battles and the actual perk before unlock; help explains class-family behavior. Weapon proficiency labels are expanded. Combat baseline explains effective weight and target-dependent numbers. Arts show numeric effects, effective HP cost and remaining uses. Earned mastery persists in the DOM reward sheet with a help link.

## Verification contract

For meaningful actions: eligibility → preview → cancel with no mutation → confirm once → correct resulting state/focus → save/resume equivalence. Fixtures create otherwise rare cases, but actions run through shipping controls. Targeted tests cover the complete trade/Back chain, all Canto exits, turn-start healing with rewind, equipment identity after JSON, paid forge no-ops, class outcomes and nested help/pickers.

Independent cross-review is required before release. Newly found issues are fixed and their verification recorded below. Full unit, harness, PR simulation, parity/reference/theme/lint/build gates and headed browser checks follow targeted tests. Production offline smoke precedes iOS packaging.

## Adversarial-review follow-ups

- Corrected effectiveness descriptions: the multiplier applies to weapon **might**, not total damage. Added an engine-backed arithmetic example and synchronized authored data.
- Added a real scroll region to contextual help and a small-phone regression that scrolls its body, closes with Escape/controller, and restores exact focus/scroll without mutating roster data.
- Forecast input ownership/detail scrolling and binding-picker list/detail scroll retention passed headed phone and controller regressions. Independent review findings are addressed.

## Physical-device focus

Upgrade a carried-over save; finish an item/heal action with Canto; suspend/resume then rewind; use a controller through forecast details and class previews. Check notched-phone safe areas, long text, rapid Back/Confirm, and foreground audio. Chromium phone emulation does not establish physical iOS behavior. Synthetic regression scenarios do not establish campaign balance.


## Battle information supplement (B1–B3, B5–B6)

- `BattleInformation.canInspectUnit` gates right-click, long-press, inspect tap, controller inspect, hover summaries, quick-tooltip direct calls, and full-detail direct calls/cycling. It mirrors rendered fog visibility, including any visible tile of an Entity footprint. Allied roster access remains available in fog.
- Condition badges existed before this pass; the audit's “no UI anywhere” claim was too broad. Readable condition descriptions now appear in the HUD, quick inspection, and Stats. Sleep taps explain the block and show no actionable movement/attack range. Durations count down at the unit's own phase start; possible early recovery is labeled “up to.” Silence-disabled magic/art/staff actions stay visible with a reason.
- Danger previews include usable status-staff reach using the same staff range parser as enemy AI. Outlined tiles distinguish status reach from damage fill, with a text legend. Potential next-phase recovery is treated conservatively. Exhausted staves and hidden enemies do not contribute. Existing damage threat remains conservative; the overlay is not a prediction of which action AI will select.
- The frame update refreshes a visible stale danger overlay and its cache on all platforms. Position and condition updates refresh directly; reinforcements/deaths/fog/world restoration use the same invalidation contract. Hiding/showing the overlay cannot resurrect a prior cache.
- Boss pressure warns one turn before the authored threshold and on the triggering enemy phase, then retains an enraged indicator while a boss lives. Both the native HUD and canvas turn summary expose it.
- Focused verification: `BattleInformation.test.js` uses real condition application/recovery and Grid attack ranges; `battle-information.spec.js` runs headed at 667×375 and covers fog denial/detail cycling, sleep/silence UI, staff-range semantics, visible danger refresh after position/uses changes, and enrage notices. Screenshots are under `/tmp/management-contract-tests/information-results`.
- Management follow-up: choice-list scroll has its own identity and survives render/Back; scrolling preview text cannot overwrite it. Separate small-phone/base regression cases verify this. Legacy moved-but-not-acted checkpoints conservatively retain movement commitment, while explicit new `false` remains false. Canto animation faults use the same village → checkpoint → phase-completion path.
