# UI cohesion pass — review and plan

Date: 2026-09-18. Branch: `mobile-rebuild-checkpoint`.
Mockups: `docs/mockups/index.html` (serve via `npm run dev`, then open
`http://localhost:3000/docs/mockups/index.html`). Proposed stylesheet:
`docs/mockups/re-kit.css`.

Status: original design proposal, implemented in checkpoint `8ad908d` with follow-up review fixes. See `ui-cohesion-implementation.md` for delivered scope and `ui-cohesion-review-response.md` for validation and corrections.

---

## 1. Where the game actually stands

The mobile rebuild produced a real design language — dark teal surfaces, sand text,
restrained gold, pixel font for labels and system font for prose — but it only reaches
six screens. Everything else is still the pre-mobile canvas style: near-black panels
(`0x1a1a2e` / `0x111111`), electric gold `#ffdd44`, `monospace` at 8–12px.

| Style | Screens |
|---|---|
| **New** (HTML overlay, teal/sand) | Battle HUD, Roster sheet, Pause, Home Base, Upgrades, Rewards |
| **Old** (Phaser canvas, navy/`#ffdd44`) | Title, SlotPicker, DifficultySelect, BlessingSelect, NodeMap, RunComplete, Boot, Compendium, Help, HowToPlay, Settings, Colosseum, Shop, Church, Deploy, Loot sub-screens, Forecast, CampaignMap, legacy Roster/UnitDetail |
| **Neither** | The `index.html` side rails — black fill, white `monospace`, 4px radius. Visible on the node map and every non-battle scene. |

So the split is roughly 6 screens new, 19 old, and a third style sitting on top of both.

### Three problems beyond "different colours"

1. **The rails are the worst offender.** On a phone the node map is a 640×480 letterboxed
   canvas flanked by black-and-white monospace buttons. `mobileBattle.css` re-themes those
   rails under `.mobile-battle-layout` — but only in battle. Everywhere else they stay raw.
   This is the single most visible seam and also the cheapest to fix.

2. **The new style isn't internally consistent yet.** 14 tokens are declared; ~60 literal
   hexes surround them. Six golds, three muteds, two scrim hues, four tap-target sizes
   (44/46/48/64), five different focus rings. `mobileUpgrade.css` — which drives Home Base,
   Upgrades *and* Rewards, the largest surface area — does not `@import` the theme and uses
   zero `var()`. It renders correctly only because another sheet loaded `:root` first.
   `mobileBattle.css` and `mobileRoster.css` each re-declare selectors later in the file,
   so the top half of both files is dead code (`.mb-primary`, `.mb-forecast` border,
   `.mr-portrait` three times).

3. **`uiStyles.js` is bypassed by exactly the screens that need it.** None of the eight menu
   scenes import it; all eleven battle overlays do. Two consequences: the menu scenes never
   call `applyTextResolution`, so their text renders at 1× on a `pixelArt` canvas while
   battle text renders at 2× — a visible sharpness difference independent of palette. And
   `NodeMapScene.drawRoster` reimplements the HP thresholds with different breakpoints
   (0.5/0.25) and a different mid colour than `getHPBarColor` (0.7/0.4).

---

## 2. Proposed approach

**Do the foundation first, then screens.** Eight independent recolours will drift again
within a release. The kit in `docs/mockups/re-kit.css` is the foundation: one token set,
one button, one header, one row, one scroll recipe, one focus ring, one tap minimum.

### Phase 0 — foundation (~1.5 days, unblocks everything)

- Promote `re-kit.css` to `src/ui/reKit.css`, imported once. Rewrite `mobileTheme.css`,
  `mobileBattle.css`, `mobileRoster.css`, `mobilePause.css`, `mobileUpgrade.css` on top of
  it; delete the dead duplicate rules while you're in there.
- Retarget `src/utils/uiStyles.js` at the same tokens (`UI_COLORS.panelBg 0x222222 →
  0x233c46`, `gold '#ffdd44' → '#d6bd83'`, etc.) and add a Phaser-side mirror:
  `drawPanel()`, `makeButton()`, `makeTabStrip()`, `makeSearchBox()`.
  **This sweeps all eleven battle overlays along for free** — the cheapest high-leverage
  move available.
- Restyle `.mobile-btn` in `index.html` to `.re-rail` so the rails match everywhere, not
  just in battle.
- Unify the four spellings of the mobile gate (`canShowMobileRoster`, the inlined
  `inputHint(scene,false,true)` in `PauseOverlay`, `scene.isMobileInput` in Loot,
  `this.isMobileInput` in HomeBase) into one exported predicate.

### Phase 1 — cheap, high visibility (~1 day)

BootScene, RunCompleteScene, SlotPickerScene. ~50 literals total, no layout work.
RunComplete currently has **no background fill at all** — it shows the raw canvas
`#0a0c1e` through, one tap before you land in the teal Home Base.

### Phase 2 — the menus the player actually reads (~3–4 days)

Compendium + Help + HowToPlay are near-identical copies of the same panel, tab strip,
search box and keyboard handler. Build the component once and all three convert, plus
CampaignMapOverlay for free. Then Settings (26px transparent hit-rects → 44px rows).

> Compendium search today is `input.keyboard.on('keydown', …)` behind a "Press / to search"
> prompt, with no field to tap. On a phone it cannot be used at all. Replacing it with a real
> `<input>` is a functional fix, not a cosmetic one.

### Phase 3 — the run-setup screens (~2 days)

DifficultySelect (mode colours live in `data/difficulty.json` — data edit, not code),
BlessingSelect, Church, Colosseum.

### Phase 4 — Title and NodeMap (~1 week, art-bound)

Title's background is hand-painted procedural canvas art (sky ramp, clouds, mountains,
glow, particles); retinting it is iterative visual work, not find-and-replace.

NodeMap is the schedule risk: the node glyphs are **sprites** (`node_battle.png`,
`node_boss.png`, …), not rectangles, and the auras use `BlendModes.ADD`, which behaves
differently over `#192f3b` than over near-black. Code is a day or two; re-authoring the
node set and re-tuning the auras is art time.

### Phase 5 — decide, don't default (~2 days)

HomeBaseScene's desktop Phaser path is ~60 literals across six tab renderers, two picker
modals, tooltips, progress bars and scroll chrome — and on mobile it is already fully
replaced by `MobileHomeBase`. **Restyling it is a desktop-only investment.** The alternative
is promoting the DOM version to desktop and deleting the Phaser path. Worth deciding before
spending the two days.

---

## 3. Open design questions

These need a call, not a find-and-replace.

1. **Blessing tiers.** `BlessingSelectScene.TIER_COLORS` gives each of four tiers its own
   background, border and label — twelve values spanning green/blue/orange/red. Flattening
   to one teal hue loses the at-a-glance tier read. The mockup proposes a shared panel with
   tier carried by a 4px left border + roman-numeral badge, keeping the four hues as accents.
   Frame 7 in the mockups shows it.

2. **Node map colour identity.** Seven node-type colours (orange, red, amber, tan, teal,
   gray, purple) currently read against near-black. Against `#192f3b` they read as a
   different game. Either re-author the sprites or accept that the node map keeps a darker
   canvas than the menus.

3. **Desktop.** The teal/sand language was designed at phone size. Does desktop adopt it,
   or does desktop keep the current navy/`#ffdd44`? If desktop keeps its own look, the
   plan above shrinks considerably — but `uiStyles.js` then has to serve two palettes.

4. **Pixel font budget.** The kit reserves Press Start 2P for headings, tabs and captions
   and uses system-ui for everything a player reads. That is already what the mobile sheets
   do. Confirm it applies to the canvas scenes too, or Title/NodeMap will keep drifting.

---

## 4. Contracts to not break

- `MobilePauseMenu.sync()` mirrors `PauseOverlay._menuButtons` / `_confirmButtons` and
  string-matches the labels `'Resume'`, `'Cancel'`, `'Abandon Run'`. Any restyle of
  `PauseOverlay._addButton` must keep producing objects with a `.text` property.
- `MobileRewards` mirrors only `LootScreenController`'s main reward screen. Four sub-screens
  (forge, imbue, unit picker, …) stay raw Phaser, so a mobile loot flow starts in DOM and
  drops into canvas mid-flow. Restyling loot closes that seam.
- `RosterOverlay.show(forceLegacy)` and `UnitDetailOverlay.show(…, forceLegacy)` are still
  reachable on mobile via the "Advanced management" / "More details" affordances. A phone
  user taking that second tap lands in the 3093-line hover-driven Phaser roster.

---

## 5. Effort summary

| Phase | Scope | Effort |
|---|---|---|
| 0 | Token kit, `uiStyles` retarget, rails, gate unification | 1.5 d |
| 1 | Boot, RunComplete, SlotPicker | 1 d |
| 2 | Compendium / Help / HowToPlay / CampaignMap / Settings | 3–4 d |
| 3 | Difficulty, Blessing, Church, Colosseum | 2 d |
| 4 | Title, NodeMap (+ node sprite art) | 5 d + art |
| 5 | HomeBase desktop path — or delete it | 2 d / 0 d |

Phases 0–3 are ~8 days and cover every screen a player passes through before combat.
Phase 4 is where the art dependency lives.
