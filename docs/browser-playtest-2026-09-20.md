# Visible browser playtest — September 20, 2026

## Scope and method

Played the local working build at `http://127.0.0.1:3000/?mobilePreview=1` through the visible in-app browser, using normal UI input. No injected wins, altered units, forced rewards or gameplay-state mutations. Tested 844×390 and 667×375 landscape viewports. This is the current development working tree, not a physical-device verification of the archived TestFlight binary.

Created a new Normal run in the available Slot 3; existing Slots 1 and 2 were not changed. Completed the first two battles, claimed a forge reward and a weapon reward, then recruited Halvar in the third encounter. Saved that encounter on Turn 1 after recruitment. The slot remains available through Continue → Slot 3 → Resume Battle. Reload may recompute the stale objective, so reproduce that particular defect with a fresh Talk action rather than relying on its saved text.

Also exercised: first-run hints/dialogue; movement and invalid destination taps; combat forecast and weapon selection; healing; items in and out of battle; roster inspection; level-up Enter/Escape; nested reward Back; save/title/reload/resume; route portrait shortcuts; Compendium search and return to pause. No shop/church/arena was reached naturally in this pass. No physical iOS audio, software keyboard, notch, controller hardware or late-act balance conclusions are implied.

## Confirmed issues, prioritized

### P2 — Title controls shrink below the touch target baseline

At 844×390 the 640×480 canvas displays at 520×390 (scale 0.8125). Title menu hit zones are 42 logical pixels tall, therefore about **34 screen pixels**. Settings is 28 logical pixels, about **23 screen pixels**. These are the actual rectangle hit areas, not just decorative bounds. This makes the first screen less touch-friendly than the native menus that follow it.

Evidence: visible title screenshot plus DOM canvas dimensions; `src/scenes/TitleScene.js:createMenuButton` uses the same `btnH` for artwork and interactive rectangle (defaults at line 378; hit zone near 438), Settings specifies height 28 near 928.

Suggested fix: retain the title artwork, but lay out actions in a responsive DOM layer with 44px targets. Avoid simply overlapping larger canvas hit zones because the current vertical pitch also scales down.

### P2 — Route portrait opens the wrong selected unit

Reproduced twice: after battle 2, tap **Sera 3/18 HP** (later **Sera 13/18 HP**) in the route side panel. The roster opens with **Edric selected**, requiring another selection before treating Sera.

Confirmed cause: `src/ui/NodeMapMenu.js:152` gives every portrait the same `s._openRoster()` callback; `src/scenes/NodeMapScene.js:1556` accepts no selected-unit argument.

Suggested fix: pass the clicked unit through the roster-opening contract; keep the general Roster button's default. Cover a non-first-unit shortcut and focus restoration on close.

### P2 — Recruitment objective does not refresh after successful Talk

In encounter 3, Sera moved adjacent to Halvar and used Talk. Halvar joined the player roster and appeared in the roster sheet, but the HUD still displayed **“Recruit: Talk to green unit.”** It remained after opening/closing the roster and Compendium.

Confirmed cause: `BattleScene.executeTalk` removes the NPC and adds the player unit, but does not call `updateObjectiveText`. The HUD reads the existing objective text rather than deriving recruitment state itself.

Suggested fix: refresh the objective after conversion; optionally show a brief “Halvar joined” status. Test that the instruction disappears when the last NPC is recruited and remains if another recruitable NPC exists.

### P2 — River generation leaves isolated bridge fragments

The third encounter contains a Bridge tile at **column 6, row 8 (one-based)** in a 12×8 map. Clicking its left, right and upper neighbors identifies all three as Water, blocked to Infantry; the fourth edge is the map boundary. The tile says “Crosses water” but cannot serve as a ground crossing. Full crossings exist elsewhere, so this observation is **not a softlock**.

Source lead: `data/mapTemplates.json` river terrain includes random `Bridge: 15` alongside Water. `MapGenerator.ensureBridges` adds guaranteed crossings but does not remove isolated initial bridge fragments. This is a plausible source supported by code; the exact generated template/seed was not captured from UI.

Suggested fix: generate deliberate bank-to-bank bridge components, or remove disconnected bridge remnants after connectivity checks. Preserve intended piers only if visually and mechanically labelled as such. Validate multiple river seeds without changing established map dimensions.

## UX improvements, not broken gameplay

1. **Forge confirmation needs a before/after preview.** Might Whetstone → Edric → Iron Sword ends with “Might 5 · Hit 95 · Crit 0 · Weight 3” and Apply reward. It should say “Might 5 → 6,” with forge-cap impact. Application itself worked: the next battle showed Iron Sword +1, Might 6.
2. **Explain conditional counterattacks in forecasts.** Edric showed 8×2 at 100% against a 6-HP Fighter while “Enemy response” showed 9×1. The enemy correctly died before responding. Label its response “If it survives,” and consider projected HP/defeat cues based on the real attack sequence. Do not promise deterministic outcomes for imperfect hit or skill-proc cases.
3. **Save-slot recognition is weak.** All three cards said Act 1 in progress with similar metadata. Show last played time, difficulty, battle/turn, and lord portraits; initially focus the most recently active slot when appropriate.
4. **Terminology:** Resume explains restoring “Vision charges,” but the battle button is “Rewind.” Use the same player-facing term.
5. **Route readability:** dimmed future icons are difficult to distinguish. Preserve the bright reachable frontier while retaining recognizable recruit/service glyphs on future nodes. Do not restore identical styling for available and unavailable nodes.
6. **Search scope:** “Search compendium” searches only the current category. Searching “vulnerary” under Arms yields no matches; switching to Items finds it. Either label the scope (“Search Arms”) or offer cross-category results when the local category is empty.
7. **Level-up presentation:** readable and fully dismissible, but the modal occupies nearly the full phone height with substantial unused space and two Continue buttons. A content-sized stat panel would feel more deliberate.
8. **Healing clarity:** target selection commits healing immediately with no forecast of HP restored. Consider an inline target label with current → resulting HP, without necessarily adding another confirmation step.

## Gameplay and balance observations

| Milestone | Observed outcome |
| --- | --- |
| Battle 1 | 12×8, two Fighters; won on turn 4; both lords survived; S-rank turn bonus |
| Battle 1 income | 197G battle/completion + 375G turn bonus = 572G; vault 772G from 200G start |
| First reward | Might Whetstone applied once to Edric's Iron Sword; next battle confirmed +1 Might |
| Battle 2 | 10×8, two Fighters; won on turn 3; both lords survived; S-rank turn bonus |
| Battle 2 income | 208G battle/completion + 375G turn bonus = 583G; vault 1,355G before optional reward |
| Second reward | Wind Sword to Edric; recipient row clearly showed AS 6 → 2 if equipped |
| Entering encounter 3 | Edric Lv 3, Sera Lv 1 (96 XP); Sera had 3/18 HP, healed to 13/18 with one out-of-battle Vulnerary use |
| Recruitment | Four enemies present; Sera successfully recruited Halvar on turn 1 |

The first two encounters contained no Cavaliers. This supports the opening restriction for this run only, not a statistical proof across seeds.

The opening was beatable with basic tactics, but Sera is fragile: a level-1 Fighter hit her for 12 of 18 HP. Staff use now lets her counterattack normally, but does not make exposure safe. Keeping damage between battles makes consumable discovery consequential. I would improve threat/outcome communication before weakening enemies further.

Two initial all-Fighter encounters also favor Edric's sword advantage and funnel kill XP to him. This may be appropriate onboarding, but check variety and Sera's progression over several seeds before deciding it is a balance defect.

The 375G S bonus exceeded the base payout in both battles. That may be intentional; compare novice/slow runs against practiced play to see whether early shop affordability diverges too sharply. No economy nerf is justified from this single run.

## Confirmed working / stability

- Sera healed Edric from 11→20, automatically returned to Lightning, then counterattacked during the enemy phase.
- Sera's in-battle Vulnerary healed 6→16 and consumed one charge/action; the next battle reset Heal to 3/3.
- Save → title → reload → Continue → Slot 3 → Resume restored turn 4, one ready unit, Sera at 16/18 and Edric at 20/20. No replay of the consumed healing action was observed.
- Forge Back preserved navigation; reward application advanced once; weapon-recipient stats were explicit.
- Level-up dismissed using Enter in battle 1 and Escape in battle 2; no input dead end.
- Smaller-phone reward, roster and route layouts remained usable after settling following resize. Route details correctly moved below the graph.
- Compendium input, filtering, result highlighting and return to pause worked.
- No runtime error dialog, stuck transition or warning/error in the captured browser log during this pass. This is limited evidence from this session, not a full stability certification.

## Recommended next work

1. Fix the portrait-selection and stale recruitment-objective bugs; address title touch targets.
2. Add forge outcome previews and consistent Rewind terminology.
3. Clean up river bridge generation with connectivity-focused tests and visual samples.
4. Follow with a multi-seed Normal onboarding study: time to recruit, unavoidable threat exposure, healing consumption, Sera/Edric XP split, turn ranks and gold at first shop. Include rookie mistakes, not only optimal tactics.
5. Continue visible testing from this saved recruitment battle toward a natural shop/church visit; separately verify physical iOS app-switch audio and keyboard/safe-area behavior.

This pass records findings only. No gameplay source changes, balance changes, GitHub commit or TestFlight upload were made.

## Follow-up: first-tap unit actions

User-reported extra tap on occupied Forest/Mountain tiles was traced to the general mobile selection flow: first tap entered movement selection; a second tap on the current tile opened actions. Native mobile input now opens the unit's action menu on the first tap on any terrain, keeps movement highlights tappable, and shows the selected unit's terrain bonuses alongside the actions. Only this initial menu accepts a destination; submenus, committed actions, trades and post-move menus cannot grant another move. Tutorial movement gates retain their guided flow. Back/undo remains available.

Validation: 132 targeted input/mobile/tutorial tests passed; nine existing headed battle-HUD checks passed; three new headed phone tests cover Forest, Mountain and Plain selection, terrain display, direct movement, no second move and undo. Lint and whitespace checks passed. This follow-up is in the local working tree and is not yet in TestFlight.
