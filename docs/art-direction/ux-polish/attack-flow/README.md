# Attack flow — target first, weapon second

Spec: `docs/specs/attack-flow.md`. Captured from the `battle_smoke` preset (Edric carries
Iron Sword [equipped], Steel Sword and Iron Bow; a Fighter adjacent, a second enemy two
tiles away). Desktop 1280×800; phone 844×390 at 2× (palette PNG).

| Step | Desktop | Phone (844×390) |
|---|---|---|
| Action menu (after "stay") | `desktop-0-action-menu.png` | — |
| Attack → every enemy reachable with **any** weapon is highlighted; ember reticle on the focused target (phone: target list in the side pane) | `desktop-1-targets.png` | `phone-1-targets.png` |
| Forecast opens on the **equipped** weapon (**E**), `1/2`, target `1/2`; outcome beside HP (`→ 12`, `→ KO`) | `desktop-2-forecast-equipped.png` | `phone-2-forecast-equipped.png` |
| Switch weapon (Right / ▶ / swipe): numbers update live, **E** disappears (a preview, not an equip) | `desktop-3-forecast-steel.png` | `phone-3-forecast-steel.png` |
| Switch target (Down / ▶ target): the bow-only target defaults to the first weapon that can hit it | `desktop-4-forecast-next-target-bow.png` | `phone-4-forecast-next-target-bow.png` |
| After confirming with Steel Sword: it is equipped and **first** in every inventory view | `desktop-5-unit-details-equipped-first.png` | `phone-5-equip-menu-equipped-first.png` |

Regenerate: `tests/e2e/attack-flow.spec.js` exercises the same flow (and writes its own
screenshots to the Playwright output dir).
