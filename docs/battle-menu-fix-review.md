# Battle submenu repair — September 19, 2026

## Player-visible fixes

- Battle Item now shows consumables in the mobile command panel. Unavailable rows remain visible with a reason (full HP, no conditions, unavailable class change, or exhausted uses).
- Ability, weapon, staff, equipment, weapon-art and reclass submenus explicitly register their actions. The HUD no longer discovers menus by polling every frame.
- Keyboard/controller navigation follows visible DOM buttons on phones, scrolls focused rows into view, and highlights selection after touch input. Desktop canvas menus support Up/Down/Enter. Disabled rows are excluded from activation.
- Equip has an explicit Back row. Reclass uses the normal submenu state so cancel returns to actions without undoing movement or consuming its seal.
- AOE preview cleanup is a menu teardown callback, including shutdown, rather than a nonvisual sentinel mixed with Phaser objects.
- Battle trade proficiency labels identify the recipient (e.g. “Sera cannot equip”). The battle trade screen itself remains canvas pending the broader item-management review.

## Contracts to preserve

Callbacks are bound to their menu instance, selected unit and action-menu state. Healing remains in HEAL_RESOLVING while its banner runs. The regression retains an old activation callback, invokes it again during healing, and presses Escape: HP changes once, one use is spent, and the action completes once.

Disabled rendering does not change engine balance, promotion requirements, item costs, or save schemas. Existing roster/reward changes and the build-4 package edits were already present and are outside this patch.

## Validation

- Full unit suite: 5,117 passed / 273 files. Existing equipment tests now account for the added Back row. AOE teardown test exercises the real cleanup path.
- Phone/desktop submenu regressions: actual Vulnerary use, full-HP reason, keyboard and controller focus, weapon/staff/art/ability/reclass cancellation, and Healing Circle completion.
- Existing mobile HUD regressions: action activation, forecasts, overlay input ownership and shutdown. Corrected one stale assertion to query hidden covered HUD controls explicitly; those controls intentionally leave the accessibility tree.
- Theme gate, production build and targeted lint (no errors; existing BattleScene warnings).

This is a local source update, not a new TestFlight upload. Awaiting the additional out-of-battle findings before defining that follow-up scope.
