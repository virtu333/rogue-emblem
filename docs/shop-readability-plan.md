# Build 6: service readability and gameplay audit

## Confirmed issue

Shop and Forge detail overlays use 9px canvas text. Scaling the game into a phone
viewport makes essential stats and item effects harder to read than the large
purchase rows. The two-tap preview/purchase behavior also hides the action behind
an undocumented timing window. Recipient and forge pickers are still canvas.

## Implementation

1. Browser-native Shop with Buy/Sell/Forge tabs, scrollable stock and a persistent
   selected-item panel. Mechanical details first, optional lore second, explicit
   purchase/sell/forge action. 44px minimum hit targets and 14px body copy, with
   a stacked scrolling layout in portrait. Use existing weathered theme tokens.
2. Extract validated native purchase, sale and forge commands; compare them with the retained headless fallback, and
   revalidate stock/ownership/gold/caps at commit. Preserve pricing, discounts,
   reroll inventory rules, convoy overflow and persisted service state.
3. Native recipient and forge choices, sale confirmation, readable persistent
   status. Preserve choice and scroll when opening Roster or View Map.
4. Browser gameplay audit: battle/inspect/items, rewards, roster/convoy,
   Shop buy/sell/forge, Church and Colosseum. Repair similar confirmed readability
   or interaction defects; record coverage and deliberate limits below.
5. Verify at 667x375 and 844x390, portrait rotation and desktop keyboard. Run
   targeted, full unit, harness, simulations and production offline gates.
6. Adversarial review of economy/ownership/cleanup, then build 6 TestFlight.

## Audit log

- Reproduced unreadable Shop/Forge canvas detail text. Replaced browser shop and all transaction pickers; expanded mechanical labels, optional lore, blocked reasons, persistent status, guarded confirmations. Stock selection survives map/roster returns.
- Church: canvas service text also scales below readable phone size. Native heal/revive/promote/roster/map panels now show costs and reasons; promotion compares stat/growth/proficiency/skill changes. Canonical command rechecks preserve limits and gold rules.
- Colosseum: tiny fighter/tier/mercenary tables confirmed. Native fighter selection, tiers, forecast, combat log, result and hiring now wrap/scroll with 14px body and 44px targets. Existing combat/XP/hire rules remain in the controller.
- Battle: live Sera Item/Equip walkthrough exposed missing weapon/item summaries in the new command list. Added effect text and weapon stats, including healer-dependent staff uses. Full-HP Vulnerary remains disabled with an explanation.
- Browser checks cover Home Base/run setup, battle action, rewards, Shop transactions, roster, next battle and saved-run resume; six reward completion paths; progression, trade, rewind, early turn input; Church services and arena fight/hire.
- Tested small and larger landscape phone viewports, portrait rotation, keyboard/controller action routing. Screenshots under test-results (ephemeral); physical phone is still a tester check.

## Review and verification

Independent adversarial review added 24 Shop command and 11 Church command tests. Fixed missing roster/restock persistence, full-convoy recipient gating, combined forge-discount cap, promotion comparison loss, misleading arena header labels and stale header callbacks. A browser test caught a missing healer argument in the new staff summary; corrected and all 17 final submenu/service/progression tests pass.

5,172 unit tests / 277 files; 109 harness tests; all PR simulation slices; lint zero errors (existing warnings), theme/reference/data parity gates pass. Six reward paths and the complete touch run/resume loop also pass. Production packaging/offline check recorded with distribution in testflight-beta.md.

## Deliberate boundaries

Canvas/headless fallbacks remain for existing tests; deleting them is separate cleanup, not this release. Browser-native service commands were checked against those implementations. No economy, map size or save-schema changes. Arena retains its existing save-on-Leave contract because intermediate persistence must also store per-visit fight/hire/XP limits; the menu explicitly says to leave to save. Reward reload still forfeits unclaimed loot under the existing contract.
