# Strategy layer — captures

Recruit nodes you can read before you choose them, and a recruit you can find on the
field (`docs/specs/strategy-layer.md`). Captured in the real game by
`tests/e2e/strategy-layer.spec.js` with `STRATEGY_LAYER_SHOTS=<dir>`: the Loom from
`?devScene=nodemap&preset=battle_smoke&seed=42`, the battle from
`?devScene=battle&preset=battle_smoke&seed=42&devNode=recruit`, `&mobilePreview=1` for
the 844×390 frames.

| File | What |
|---|---|
| `loom_recruit_desktop.png` | 1280×800. A recruit knot inspected two steps ahead: RECRUIT kicker, "Garrick, a potential ally", real foe levels, the elite tags (`Hunters +1`, `Captain` in blood), then the recruit panel — class crest, name, `CAVALIER · LV 3 · SEASONED` pixel kicker, six key stats, the two best growths in gold, each trait with its per-unit text — and the line "Hunters are closing on Garrick. Reach them with a lord and Talk." |
| `loom_recruit_phone.png` | 844×390, the same knot; the 184px pane scrolls to the recruit panel. |
| `battle_beacon_desktop.png` | Turn 1 of that recruit battle. The recruit stands beside the lords' start, out of every foe's first-phase reach, under a gilt banner with a pixel `RECRUIT` label and a verdigris halo; the objective panel names them ("Recruit: reach Garrick with a lord · Talk"). |
| `battle_beacon_phone.png` | The same on the phone HUD. The banner sits above the fog layer, so it reads in fog too. |

The one-time field note ("Garrick (Cavalier) holds out under the gold banner…") is
dismissed before the battle captures; the e2e test asserts it.

Regenerate: `STRATEGY_LAYER_SHOTS=$PWD/docs/art-direction/gameplay/strategy-layer npx
playwright test tests/e2e/strategy-layer.spec.js`.
