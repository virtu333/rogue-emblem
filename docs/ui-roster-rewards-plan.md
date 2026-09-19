# Roster, rewards and node map — density and completeness plan

Follow-up to `ui-cohesion-plan.md` after TestFlight build 3 playtesting. Mockups:
`docs/mockups/roster-rewards.html` (open through the Vite dev server,
`http://localhost:3000/docs/mockups/roster-rewards.html`, so the portrait and node assets load).

## 1. What the two screenshots show

**Roster (phone, landscape).** Measured against the 390pt height:

| Region | Share |
|---|---|
| Header ("Your roster" + Close) | 15% |
| Tabs | 13% |
| Footer (hint + "Advanced management") | 19% |
| Content | 53% |

Half the screen is chrome. Body text is 14px, tab buttons are 44px tall, unit cards 64px, card padding
12px (`mobileRoster.css`, `mobileTheme.css:15-29`). The type is not wrong for a phone; the problem is
that every element also carries the full 44px touch budget and the sheet spends two rows on framing.

**"Advanced management".** `MobileRosterSheet` is gated on `canUseTouchUI` (DOM host **and** mobile
flag), covers Stats / Equipment / Convoy with equip, store, withdraw, heal-use and accessory swap, and
then hands off to the 3,149-line canvas `RosterOverlay` (`RosterOverlay.js:158-177`, `show(true)`) for
everything else. What lives only in the canvas path:

| Feature | Canvas entry | Engine call |
|---|---|---|
| Promote (Master Seal), multi-target class choice | `RosterOverlay._usePromote` :1730 | `canPromote`, `resolvePromotionTargets`, `promoteUnit` (`UnitManager.js`) |
| Reclass (Infantry / Mounted Seal) | `_showReclassClassPicker` :1819, `_useReclass` :1855 | `canReclass`, `getReclassTargets`, `reclassUnit` |
| Teach skill scroll | `_showScrollPicker` :2447, `_teachScroll` :1888 | `learnSkill`, `MAX_SKILLS` = 5 |
| Bind weapon-art scroll (weapon, slot, overwrite confirm) | `_showWeaponPickerForScroll` :2615, `_showWeaponArtSlotPicker` :2075 | `WeaponArtSystem` (`getWeaponArtBindings`, `isWeaponArtCompatibleWithWeapon`), 3 slots |
| Trade unit ↔ unit | `RosterTradeController._showTradeScreen` :298 | `removeFromInventory` / `addToInventory`, consumable equivalents |
| Convoy withdraw with recipient picker | `_drawConvoyDetail` :1607 | `runManager.takeFromConvoy` |
| Effective combat stats, growths, XP, tier, mastery star | `_drawStatsTab` :1178 | `getStaticCombatStats` |
| Weapon-arts read-out, forge suffixes, staff uses | `_drawGearTab` :1257-1541 | `summarizeWeaponArtEffect`, `isForged` |
| Battle inspect: terrain block | `UnitDetailOverlay.js:693-711` | — |

Stat boosters are not in this list: they are applied at pickup (`LootScreenController.js:1016`) and
never enter a bag. The DOM sheet's "Use this item in advanced management" reason
(`RosterInventory.js:42`) therefore only ever fires for the three seals.

**Rewards.** `MobileRewards.js` is a 134-line proxy: it renders the card list in DOM, then on claim
hides itself and emits a synthetic `pointerdown` on the canvas card (`:110`). Every step after that is
canvas at 640×480: give-to (`LootScreenController.renderUnitPicker` :639), consumable picker (:828),
stat-booster picker (:1016), whetstone unit (:1168), weapon (`LootFlowController.js:191`), forge stat
(:373), imbue (:474). The screenshot is the give-to step. There is no e2e test for rewards.

**Node map.** 52px node cards on a 64px row pitch and 104px lane pitch (`cohesion.css:200-211`,
`RouteGraph.js:35,42`). A 9-row act is 576px tall inside a ~300px scroller, so the player sees 4–5 rows
and scrolls to see where they are going. The 64 is duplicated in `NodeMapMenu.js:173`.

## 2. Options

### A. Density (all DOM surfaces)

One token edit, no redesign. Proposed values, shown as the `.d` layer in the mockup:

| Token | Now | Proposed |
|---|---|---|
| `--re-t-body` | 14px | 13px |
| `--re-t-micro` | 11px | 10.5px |
| `--re-tap` | 44px | 40px |
| `--re-tap-row` | 64px | 50px |
| `--re-s3` (card padding, header gap) | 12px | 10px |
| Tab button height | 44px | 34px |

40px is still above Apple's 44pt-with-spacing guidance when rows have a 4px gap, and the rail buttons
keep 44. The catch: `mobileUpgrade.css`, `mobileRoster.css` and `mobilePause.css` hard-code their own
14px / 44px (`mobileUpgrade.css:1-32`), so the token change only reaches them once they are rebuilt
on the `.re-*` kit (options C and D do that for roster and rewards; Home Base / upgrades / pause need
a mechanical pass).

Effort: half a day for tokens, plus the `.mu-*` pass (half a day). Two e2e assertions read the 13px
token and the 44px minimum (`mobile-release.spec.js`); update them with the change.

### B. Node map

**B1 — shrink in place.** Node 52→40, row pitch 64→50, lane pitch 104→80, one shared `ROW_PITCH`
constant. Shows 6 rows instead of 4–5. Three CSS values and two lines in `RouteGraph.js`. Half a day.

**B2 — horizontal act (recommended).** Rows become columns along the long axis: 9 columns at a 74px
pitch, 5 lanes at 56px. The whole act fits in the landscape viewport with no scrolling; the current
position is always visible next to the boss. Node visual is a 36px ring around the icon inside a 44px
hit target; the 52px card background goes and a ring colour carries state (done / here / available /
locked). The detail panel stays on the right and takes the Travel primary. Mockup frame 1.

Work: `RouteGraph.js` position function and viewBox, `NodeMapMenu.js` centering (becomes a no-op on
phones, horizontal scroll on the 640×480 desktop frame), `cohesion.css:200-240`, the "Start / Elite /
Boss" column captions. `ui-cohesion.spec.js:20-27,87` select by `.re-node` and `aria-label`, so they
survive. 1–2 days. Both options keep the Phaser node map untouched; it only runs without a DOM host.

### C. Roster — complete the DOM sheet, delete the canvas one

Structure: title, tabs and Close in one 40px header; footer removed; unit rail stays at 200px.
Content goes from 53% to ~80% of the screen.

**Tab layout, two options:**

- **R1 — Stats · Equipment · Items · Convoy.** Items = consumables, seals, team scrolls. Matches how a
  bag is organised. Skills stay on Stats, so Stats gets long and weapon arts have no home.
- **R2 — Stats · Skills · Equipment · Convoy (recommended).** Consumables already sit on Equipment
  (they are shown there today as `n/3`). Skills is the tab that is missing outright: learned skills
  with the `n/5` cap, weapon arts per weapon, and the team scroll shelf with Teach. Seals are used from
  their Equipment row. Mockup frames 2a–2c.

**Per tab:**

- *Stats*: portrait strip with tier, level, XP bar, HP, proficiencies as chips; 4-column stat grid;
  Atk / AS / Hit / Avo / Crt / Wt chips from `getStaticCombatStats`; growths folded.
- *Skills*: skill cards `n/5`; weapon arts with the bound weapon; scroll shelf. "Teach Edric" is one
  tap for the selected unit; "Teach…" opens the unit picker. Art scrolls: weapon → slot → confirm
  overwrite, same rules as `RosterOverlay._planWeaponArtScrollApply`.
- *Equipment*: master/detail inside the tab. 50px rows with one stat line; the full card renders once
  for the selected item, with Equip / Give… / Store (or Use for seals, with the reason when disabled).
  Give… replaces the two-column trade screen. Promote with several targets shows the class list in
  the detail pane; reclass likewise.
- *Convoy*: unchanged, plus a recipient row at the top ("Withdraw to: Edric ▾") so the canvas
  "Change" button has an equivalent.
- *Battle inspect* (`UnitDetailOverlay` on phone): add the terrain block and the weapon-arts list to
  the sheet, delete "More details".

**Shared component — `UnitPicker`** (frame 2d). Title, rows with portrait / class / one-line reason /
count, optional Convoy row, Cancel. Rows can be classes instead of units. Used by Give, Teach…,
Promote target, reward give-to, stat booster, whetstone unit and weapon steps, convoy withdraw-to. One
component gives one set of gamepad / keyboard rules and one e2e test. Build it on `MenuSurface` so
it inherits the input scope, modal shield and focus handling that Settings and Compendium already use.

**Gating and deletion.** Once parity holds, switch `canShowMobileRoster` from `canUseTouchUI` to
`hasDOMHost()` (the same switch Home Base and the node map made), then delete `RosterOverlay.js`,
`RosterTradeController.js`, `PromotionChoicePanel.js` and the roster half of `UnitDetailOverlay.js`.
About 4,500 lines. Tests that drive the canvas roster (`tests/Roster*.test.js`,
`tests/UnitDetail*.test.js`) either move to the engine functions they exercise or are deleted with it.

Effort: 4–5 days including the picker, plus one day for the deletion and test cleanup.

### D. Rewards — one sheet, every step

**D1 — DOM sub-pickers behind the proxy.** Keep `MobileRewards` and the canvas cards; add DOM
versions of the five pickers that call the existing `LootScreenController` / `LootFlowController`
methods. Fastest, but the flow stays two code paths glued by a synthetic click, and the canvas
victory banner and gold summary still show underneath.

**D2 — `RewardSheet` with a step stack (recommended).** Split `LootScreenController` into the
decision model it already mostly is (generate choices, per-type branch at :252-487, finalize at
`LootFlowController.js:681`, cleanup and transition at :715-747) and two renderers: the canvas one it
has today, used without a DOM host and by the headless tests, and a DOM sheet. The sheet is one
screen: header with the gold breakdown chips (battle, turn rating, late pressure, vault), left column
"what you are choosing", right column "where it goes" with a breadcrumb and Back. Frames 3a–3c.

Steps in the sheet: choose → give-to / consumable / booster picker → done; whetstone → unit → weapon
→ stat or imbue → done. Elite maps keep the chosen row greyed and the "Choose 1 more" instruction.
The picker shows the recipient's AS change and the "needs Sword" or "inventory full" reason on the
row, so the canvas dead ends ("Convoy is full. Choose another reward.", "No forgeable weapons in
roster!") are visible before the tap.

Contracts to keep: `_elitePicksRemaining`, `_lootResolving`, `_lootCleanedUp`, `scheduleLootCleanup`
dedupe, the 8s post-loot transition fallback, `reportLootError` on forge / imbue failure, the Roster
button during loot (open the roster sheet read-only). Twelve test files cover this flow; the model
split should leave them green because they drive the controller, not the renderer.

Effort: 3–4 days. Add `tests/e2e/mobile-rewards.spec.js` (`?preset=battle_smoke&seed=42`, win, claim
a weapon, give to a unit; claim a whetstone, forge a stat).

## 3. Things not in the screenshots that belong in the same wave

- **Deploy screen** (`DeployScreenOverlay.js`) is canvas and is the pre-battle entry to the roster.
  Same treatment as the roster sheet; otherwise the player meets the old UI once per battle.
- **Boss recruit and third-lord arrival overlays** run between victory and rewards, both canvas.
- **In-battle item / trade menus** (unit action menu → Item, Trade) are canvas and use a different
  give-to. `UnitPicker` can serve them later.
- **Shop, Church, Colosseum, Run Complete, Title, Slot Picker** remain canvas, as already noted in
  `ui-cohesion-implementation.md`. Not this wave, but the service menus are the next most-touched.
- **Two DOM kits.** `.re-*` (kit, tokens) and `.mu-* / .mr-* / .mh-*` (hard-coded sizes). Every screen
  rebuilt in C and D should land on `.re-*`; the density change in A then applies everywhere.
- **Gating inconsistency.** Home Base and node map switch on `hasDOMHost()`; roster and rewards on
  `canUseTouchUI` (mobile flag). Desktop currently gets the canvas roster. C and D close this.
- **Phaser Home Base and node map** are unreachable in any browser and should be deleted or marked
  test-only; the cohesion review already flagged this.

## 4. Sequence and effort

| Step | Days | Depends on |
|---|---|---|
| A. Density tokens + `.mu-*` pass | 1 | — |
| B2. Horizontal node map | 1–2 | A |
| `UnitPicker` on `MenuSurface` | 1 | A |
| C. Roster tabs to parity, battle inspect | 4 | picker |
| C. Switch gate, delete canvas roster, test cleanup | 1 | C parity |
| D2. Reward model split + sheet + e2e | 3–4 | picker |
| Deploy screen sheet | 1–2 | picker |

Roughly 12–15 working days. A and B2 ship first: they are what a playtester sees in the first
minute. C before D, because the picker and the tab layout settle the patterns D reuses.

## 5. Decisions needed

1. Tab layout: R2 (Stats · Skills · Equipment · Convoy) or R1 (… · Items · …).
2. Node map: B2 horizontal, or B1 shrink in place.
3. Density numbers in A, or keep 44px rows and only remove the footer.
4. Whether the deploy screen joins this wave or waits.
5. Whether desktop switches to the DOM roster at the same time the canvas one is deleted (recommended),
   or keeps canvas until a separate desktop pass.


## 6. Validated implementation amendments (September 18)

Approved direction: Stats / Skills / Equipment / Convoy, horizontal campaign route,
shared compact density tokens, full DOM reward steps. Include deployment; migrate
desktop after parity, and delete legacy rendering separately.

Corrections to the proposal above:

- Keep `--re-tap: 44px`. Spacing does not enlarge a hit target. Body 13px,
  row minimum 50px, and card spacing 10px are shared tokens, not a mobile fork.
- Horizontal fit depends on usable width after safe areas. Below 700px use a
  bottom detail strip. Keep at least 64px column pitch and horizontal scrolling
  when needed; fresh entry anchors the available frontier near the leading edge,
  showing the following columns. Selection and service/roster round trips preserve
  the user's scroll. Do not promise a fixed swipe distance on every device.
- Production labels use Prof/Mast from real data, never mockup letter ranks.
  Show equip capability and AS comparison explicitly **if equipped**; giving an
  item does not imply equipping it. Eligibility is supplied per operation.
- Promotion/reclass commands must include weapon grants, seal consumption, skill
  cap reporting, and persistence behavior currently owned by RosterOverlay.
  Both roster and reward apply flows need busy guards: duplicate confirmation
  and Back during application must not repeat or abandon a partial mutation.
- Existing mobile-run-loop tests cover reward entry/back/skip. Add recipient
  completion, forging/imbue, and multi-pick tests rather than replacing coverage.
- A shared picker needs component input tests **and** per-operation behavior
  tests. Sharing presentation does not make one e2e test sufficient.
- Keep canvas and Advanced management available until replacement parity is
  verified. Preserve behavioral tests when deleting rendering code separately.

### Implementation checkpoint

Implemented: horizontal route with compact art and 44px buttons; responsive
bottom details below 700px; scroll/selection preservation; shared density tokens;
roster tabs in one header; compact unit portraits; upgrade/pause base typography
uses the shared body token. The earlier title disclaimer/GitHub removal remains
in the working tree.

Added `playwright.compact.config.js` with iPhone SE 667x375 and iPhone 13 844x390
projects. It checks route/roster containment, target sizes, header tabs, boss
selection and scroll restoration after roster. Existing cohesion and mobile
run-loop coverage also passed during this checkpoint.

Remaining sequence:
1. Extract roster commands and guarded application; implement shared picker.
2. Complete Skills, Equipment, Convoy and inspect parity, then remove the footer.
3. Replace reward proxy with explicit commands and one stepped DOM sheet.
4. Deployment, boss recruitment and third-lord arrival presentations.
5. Desktop input parity, full gates, cleanup commit, then TestFlight update.

### Phase 1 review follow-up

Future nodes are dimmed while selected/focused nodes stay readable. Horizontal
lane positions scale with the graph height (240px minimum to preserve separate
44px targets), eliminating the SE's incidental vertical scroll.

The vertical renderer is **not dead code**: CampaignMapMenu still calls the
default vertical layout for the in-battle read-only overview. Retain it until
that caller is explicitly migrated. Compact tests now assert no vertical overflow
on the two supported landscape fixtures and a dimmed future-node state.

### Phase 2a: class changes and shared picker

`RosterCommands` now owns promotion/reclass mutation, grants and consumption,
with ownership/eligibility revalidation. Both canvas and DOM call it. DOM Equipment
now exposes Promote/Reclass through `ChoicePicker`; cancel before confirmation is
non-mutating. The picker accepts operation-specific eligibility and rejects extra
confirmation or Back while applying. Class changes remain synchronous, avoiding
input interleaving between unit mutation and seal consumption. Existing save
ownership remains with the roster/scene lifecycle.

Validation: targeted command/promotion/reclass/roster suites; compact phone tests
exercise cancel, promoted weapon grants, seal consumption, and delayed-apply
duplicate-confirm/Back guards. Full roster parity, Skills/scrolls/trade/convoy,
rewards and deployment remain subsequent steps.

### Phase 2b: skills and item recipients

Native roster now has Stats / Skills / Equipment / Convoy. Skills displays the
learned-skill cap, carried weapon arts, and team scroll shelf. Ordinary skill
scroll teaching uses a revalidated shared command from both roster renderers.
Giving equipment or supplies uses the shared picker; as in legacy trading, lack
of proficiency warns but does not prevent carrying an item. Capacity and stale
item ownership are checked at confirmation, and items are added successfully
before being removed from their source. Convoy has an explicit recipient picker.

Stats now includes effective combat values and folded growths. The identity
summary is compact and shows tier/XP. Advanced management is retained specifically
until weapon-art scroll binding and the remaining detail parity are complete.
Phone browser tests cover teaching, giving, and convoy-recipient changes on both
landscape sizes; command tests cover full bags, full skills, duplicate skills,
and repeated application of a consumed scroll/transferred item.

### Phase 2c: review fixes and native art binding

Fixed Dancer/blocked-only promotion by checking resolved targets before enabling
Promote; ChoicePicker independently accepts null/empty choices with a disabled
Confirm and usable Close. Removed the redundant synchronous WeakSet guard;
mutation safety is provided by ownership/uses/canonical-target rechecks, while
the UI busy guard prevents concurrent asynchronous confirmations.

Give retains legacy permissiveness but warns when it leaves the source unarmed.
Combat includes Avoid, tiers are capitalized, and skill failure codes are mapped
to readable text. Full-bag Iron grants return visible notices in both renderers;
no new convoy policy was introduced. Legacy canvas trade remains a separate
implementation and must be retired or migrated during final parity cleanup.

Weapon-art scroll binding now runs natively: owner/weapon choice, replacement-slot
choice when full, and explicit final confirmation showing the overwritten art
and its source. The command rechecks compatibility, rank, roster/weapon/scroll
ownership and replacement identity/source. Stale slots cannot be overwritten.
The remaining Advanced management entry is for outstanding detail parity, not
art binding. Rewards/deployment remain subsequent phases.

Validation added: blocked Dancer, empty picker, full-bag grant notice, compatible
art binding, consumed-scroll replay, stale overwrite and incompatible ownership.
Eight compact phone browser cases include native overwrite confirmation.

### Phase 2d: picker refinement and native detail handoff removal

Weapon binding now filters hard-ineligible owner/weapon combinations, retains
already-bound entries with their explanation, labels sources Innate / Scroll /
Meta Innate, and renders its final step as a plain confirmation using the same
busy/cancel ownership machinery as the picker.

Native Stats/inspection now includes terrain-aware Avoid and terrain bonuses
(with flying exclusions), mastery progress/perk, traits, enemy affixes and
expandable attribute explanations. Equipment adds explicit forge deltas, imbue
descriptions and effective staff range; weapon arts show availability. The
Advanced management / More details links and their footer were removed.
Legacy classes remain for desktop/headless callers until the separate migration
and cleanup; their removal is not part of this checkpoint.

Compact e2e now checks no legacy handoff, plain confirmation, and battle terrain /
mastery details while keeping inspection read-only. Next is the complete reward
sheet and its recipient/forge/imbue steps, then deployment and desktop parity.

### Phase 2e: review follow-ups and desktop roster

Weapon-art readiness is now limited to active battles. Outside battle, the Skills
card shows static weapon compatibility, proficiency/rank and HP cost without
reading stale per-map usage. Mastery perk labels share the canvas formatter, and
forge details use ForgeSystem's display helper.

The native roster now opens on any DOM host, including desktop; headless callers
retain the canvas fallback. Initial focus lands on the active tab. Arrows and
Tab move focus, Enter/Space activate, controller navigation/confirmation uses the
same controls, and shoulder actions switch units. Canvas deletion remains a
separate cleanup after the remaining flows migrate.

Validation: 5,113 unit tests, ten compact phone cases, and the new desktop roster
case passed; lint and production build passed. Desktop coverage seeds exhausted
prior-battle art usage and exercises keyboard plus controller action dispatch.
Physical controller/device testing remains useful. Next: native reward recipient,
forge and imbue flows; no new TestFlight build in this checkpoint.
