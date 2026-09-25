# Rewind picker — screenshots

Rewind to before any unit's action (`docs/specs/rewind-any-action.md`). Captured from the
`combat_actions` lab (Patient waits, Edric uses Wrath Strike on the Knight, Sera heals
Patient), second row selected so the map previews the board before Edric's attack.

| File | What |
|---|---|
| `rewind-picker-phone-844x390.png` | Phone: map preview left, "Before …" rows newest first, outcome chips, charge pips, Rewind here · 1 charge. |
| `rewind-picker-desktop-1280x800.png` | Desktop (opened with `[R]` or by clicking the Eye plate). |
| `rewind-picker-base-640x480.png` | 640×480 design target: long titles clamp to two lines. |
| `rewind-fatal-picker-phone-844x390.png` | From the fallen-commander decision: Back to decision; the death itself is a row. |
| `rewind-fatal-picker-desktop-1280x800.png` | Same, desktop. |
| `rewind-lunatic-phone-844x390.png` | Lunatic (`rewindGranularity: "turn"`): action rows stay visible with the reason; only turn starts spend. |

Regenerate with a Playwright script that plays the same three actions and opens Rewind
(see `tests/e2e/rewind-any-action.spec.js`; set `REWIND_SHOTS=<dir>` to write its
phone/desktop captures).
