# UI completion release plan — September 19, 2026

## Validated scope and corrections

The battle submenu fixes are complete and included in this release. The source audit confirmed missing Item rows, AOE menu failure, submenu input gaps, touch-only shop preview loss, and missing reward reference menus.

PromotionChoicePanel already had controller and ESC support; its migration fixes layout, explicit confirmation and promise settlement on shutdown. LevelUpPopup had no such input ownership. The Title issue was delayed visibility, not a logic input lock. Empty Continue slots must remain unavailable; explain how to start a game without changing save behavior.

Weapon tier is quality metadata, not a universal rarity field. Reward icons indicate category; weapon rows show actual Iron/Steel/Silver/Rare/Legend text and tokenized colors. Untiered supplies/accessories receive category labels, not invented Epic/Legendary classifications. SVG glyphs fit the pixel art grid without generated raster assets, preload costs or external requests.

## Implemented release work

1. Battle menu registration, consumable visibility/reasons, visible DOM and canvas keyboard/controller focus, AOE cleanup, reclass cancellation, Equip Back.
2. Shop/Forge persistent touch preview, next-tap dismissal, and pointerdown ownership preventing service dismissal after a control destroys itself.
3. Native level-up/promotion result and class choice; native rewind confirmation. Modal scopes isolate the HUD; pending progression promises settle on shutdown.
4. Reward Roster (read-only) and Settings from any reward step, preserving selected choice and breadcrumbs; category icons, actual tier labels and subdued color stripes.
5. Native battle trade with item details and explicit recipient confirmation, separate bag capacities, and movement/rewind commitment preserved.
6. Colosseum keyboard/controller choices with screen-local Back behavior and resolution input blocking.
7. Clear empty-save explanation; immediately visible Title menu controls; native transition recovery prompt with feedback rather than silent cancellation.

8. Turn-start resolution lock and cancellation guards: effects finish before player actions become available; hints wait, stale effects stop after rewind/death/shutdown, suspend records only completed effects.
9. Resume-time generated text texture collision protection without altering gameplay RNG or suppressing named-asset diagnostics.

## Deliberately separate parity work

A full Shop/Church/Colosseum DOM conversion and deletion of the remaining canvas renderers is not included in this bug-fix release. Those service controllers contain approximately 4,500 lines with purchasing, forge caps, recruitment, revival, arena and save behavior. Confirmed interaction bugs are repaired now. A later surface-by-surface migration should keep behavior tests and remove fallbacks only after each reaches parity. Noninteractive combat effects and banners can remain canvas.

## Release gates and reviewer focus

- Targeted and full unit tests, harness, data parity, theme gate, lint and production build.
- Phone end-to-end coverage: level-ups (including rotation and repeated confirmation), promotion choose/cancel/shutdown, rewards reference-menu round trips and tier labels, trade, rewind and Colosseum navigation.
- Retain existing battle submenu, native rewards, run-loop and production offline tests.
- Adversarial reviewer: stale selection, duplicate mutations, promise resolution, input ownership, child teardown and unintended rule changes.
- Fix material findings before incrementing the iOS build, syncing the production bundle, archiving and uploading to the existing Public Playtest group.
- Do not push GitHub. Preserve the local uncommitted checkpoint and provide reviewer notes.
