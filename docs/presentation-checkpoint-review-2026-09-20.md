# Presentation checkpoint — reviewer handoff

**Status:** implementation and verification complete; **0.1.0 (11)** uploaded September 21 at 00:39 Pacific. App Store Connect confirms **Testing** in **Public Playtest**, with automatic tester notifications enabled. Review the working tree with `implementation-plan-2026-09-20.md`; no GitHub commit/push was made.

## What changed

- Independent motion, visual quality and battle-speed controls; clearer combat forecasts; player-controlled level-up/promotion reveals.
- Mobile selection/inspection improvements, roster touch feedback and level labels, remembered deployment and easier saved-run navigation.
- Compendium Stats/Run references, reward-menu access, clearer item/resource descriptions and current-shop re-entry.
- Tutorial lessons now explain the visible action without covering its subject. Learned lessons carry to new slots, while Reset hints remains respected.
- Approved playtester adjustments: Clever for magic/staff recruits without its former DEF penalty, improved Act 1 boss choices, no random Sunder on Normal Act 2, and modest fitting changes for reported tall sprites. Elfire remains a valid Act 2 Steel-tier weapon.
- Earlier local journey/persistence harness and service cleanup are included in the working tree; their detailed accounting remains in `journey-persistence-plan.md`.

## Findings resolved in final review

HP estimates omitted Venom/drain/mitigation and some weapon-granted effects; these cases now suppress projections. A Pavise proc could invalidate a displayed first-hit KO and hide a lethal counter warning; a real-resolver regression now covers it. Unit HP and combat resolution are unchanged by forecast rendering.

Visible-browser testing also found first-tap Tutorial and immediate resumed-route Advance could be dropped during the scene cooldown. Both use the existing guarded transition retry. Encounter preparation occurs once; retries reuse its data. The resume→Advance journey passed three consecutive runs after the fix.

## Escape-map blocker follow-up (September 21)

Phone feedback showed no visible escape destination in a fresh Act 2 forest encounter. The screenshot shows approximately 15 columns of a 16-column map; Hunter's Woods places exits on the rightmost column. A headed reproduction confirmed that tactical framing can crop every exit, and Overview reveals them. The exact phone save was not available.

- Added **Show exits** beside the mobile objective, using the existing overview camera without changing selection, movement or turn state.
- Replaced faint pulsing markers with permanent gold outlines and high-contrast EXIT labels above movement highlights and unit sprites. Objective copy explains moving onto an exit and choosing Escape.
- Adversarial review caught a confirmation-focus issue; Show exits is hidden during End Turn confirmation and redraw restores focus to Keep playing. Broader browser verification also caught the covered HUD remaining in the accessibility tree; its aria-hidden state now follows visibility. Updated an older forecast assertion to validate the current separate damage-per-hit and planned-hit fields against engine values.
- Regression covers fresh and resumed Act 2 Hunter's Woods, fog, 667px/844px widths, fully visible marker bounds, preserved selection, and both lords exiting to victory.
- Follow-up verification: 52 targeted unit tests and 17 headed browser checks passed without retries; build/theme/diff checks passed, lint zero errors (two existing unused-catch warnings). Independent follow-up review found no remaining issue. Evidence: `/tmp/escape-regression-unit.log`, `/tmp/escape-regression-final.log`, `/tmp/escape-build-final.log`.

## Verification

- 5,294 unit tests / 298 files; 162 harness tests, including 53 journey contracts.
- All PR full-run simulation slices passed.
- 24 distinct headed browser checks across slice coverage, final tutorial/forecast checks and production mobile smoke. Final six tutorial/forecast cases passed without retries. The initial combined run exposed the cooldown issue described above; it was not waived as flaky.
- Build, generated reference, data parity, UI theme and diff checks passed. Lint: zero errors, 310 existing warnings.
- Two adversarial review passes; no outstanding blocker reported after fixes.

Evidence: `/tmp/checkpoint-unit-final.log`, `/tmp/checkpoint-harness.log`, `/tmp/checkpoint-sim.log`, `/tmp/checkpoint-final-ui.log`, `/tmp/reload-final.log`, `/tmp/checkpoint-production.log`. Screenshots: `/tmp/checkpoint-final-ui` and `test-results-release/production-battle.png`.

**Phone review priorities:** tutorial text/Continue on the smallest landscape device; forecast scrolling and weapon changes; motion/speed/audio feel; thumb selection versus scrolling; resume a carried-over slot. Browser production smoke blocks external requests; it does not prove native app-switch audio or an installed-app upgrade. Physical iOS checks remain necessary.

Later story, opt-in seen-dialogue, hold-to-fast-forward and larger gameplay/AI changes remain separate checkpoints, not implied complete here.

## Item clarity, consumables, revival and balance follow-up (September 21)

- **Consumable blocker:** the roster only offered Use for healing items. All eight stat boosters now use the shared engine stat-boost helper, with a recipient/stat before→after confirmation, ownership/use revalidation and immediate persistence. Herb/Remedy also have Use, with explicit no-effect reasons. Battle inspection stays read-only; these actions cannot bypass battle turn costs.
- **Item-description audit (GPT Sol):** Vanguard Crest now says “+4 Atk when no ally is within 2 tiles.” Shared accessory text expands positional conditions, HP thresholds, follow-up attacks (Attack Speed), heals, XP and weapon-art costs. Promotion/reclass seals describe eligible classes. Battle item summaries include weapon special rules, staff descriptions and effective staff range. Skill-scroll rewards no longer expose engine tokens such as SKL_HALF.
- **Art discoverability:** shop, roster/convoy and rewards expose tappable native Details sections for weapon arts, including effects, eligibility, HP per use and battle/turn limits. Weapon Art Scroll and Skill Scroll are distinct categories. Art scrolls explain Team scrolls → Roster → Skills → Bind to weapon, and when the scroll is consumed.
- **Revival:** catches up to the floor of the living roster’s average effective level (existing promoted +12 equivalence), capped in the current tier; no free promotion or downlevel. Only missed-level rolls use growth minus 10 percentage points, clamped to zero. Future growths stay unchanged. Uses deterministic rolls, normal nonempty-level rules and skill milestone checks; Church previews the result and reports skills blocked by the cap. Returns at 1 HP as before.
- **Rewind:** previous rules explicitly excluded Act 1. Every act boss now grants +1 charge, preserving unused charges; no full refill or retroactive grant to already-completed old saves. Duplicate completion and act-transition/save-load paths are covered.
- **Vampiric:** 15% per strike, rounded down, replacing 30%. Existing weapons resolve their imbue by ID from the catalog and receive the updated effect; item description matches.

Verification: **5,317 unit tests / 301 files passed**, plus 30 journey persistence contracts; **12 headed browser checks passed without retries**, covering fresh/resumed escape maps at 667/844px, item details, Vanguard copy, Spirit Dust cancel/reopen/use/immediate persistence, revival and roster interactions. Build, UI theme, data schema/parity and diff checks passed. Lint: zero errors, 310 existing warnings. Independent adversarial review found a healing-SFX regression introduced by the new action name; fixed before final tests. A browser fixture initially bypassed the production roster owner; corrected to enter through the real Roster button.

Evidence: `/tmp/items-full-unit-final.log`, `/tmp/items-expanded-unit.log`, `/tmp/items-regression-e2e.log`, `/tmp/items-build.log`, `/tmp/items-lint.log`. Screenshots are under `test-results/item-explanations-revival-*`. These follow-ups are included in uploaded **0.1.0 (11)**; Public Playtest distribution is complete (Testing).
