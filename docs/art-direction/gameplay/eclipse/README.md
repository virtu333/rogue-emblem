# The Eclipse — captures

The visible run clock (`docs/specs/eclipse.md`). Captured in the real game with the dev
review route `?devScene=nodemap&preset=eclipse&seed=42` (an Umbral run: shadow 58, act
shadow 14, falls not yet played), `&mobilePreview=1` for the 844×390 frame, and
`?devScene=battle&preset=eclipse` for the battle HUD. Palette PNGs (256 colours).

| File | What |
|---|---|
| `loom_desktop.png` | 1280×800. Header medallion (Hollow Sun eaten to 58, UMBRAL kicker, number in blood once Umbral). Eclipsed knots as small hollow suns (black medal, thin gold corona, ember cracks, the place's silhouette burnt brown). Knots within three shadow of falling carry a crescent bite on the frame; the inspect card counts it down. The fall line names the loss. |
| `loom_phone.png` | 844×390, the same run. The medallion collapses to the 28px glyph + number; the 184px pane is unchanged. |
| `fall_ceremony_phone.png` | Mid-ceremony: one knot's rim flares as ink blooms over it, the next throws ember sparks on the fx layer. Knots still waiting show the place as it was. Reduced motion swaps them at once. |
| `eclipsed_card_phone.png` | Inspecting an eclipsed knot: ECLIPSED · ROUT, the fall label ("Eclipsed battle", "Burned village", …), the battlefield it became, `Eclipsed` + real foe levels (difficulty + phase + eclipsed bonus) + elite loot. |
| `loom_detail_2x.png` | 2× detail of the weave: bites deepen as the fall nears (1 shadow = deepest), eclipsed halos, the dark creeping in along the fallen outer lanes (ink dither over grain and warp, an unlight bruise from the edge). |
| `eclipse_card_desktop.png`, `eclipse_card_phone.png` | The explainer the medallion opens (read over the loom it explains): phase, shadow, the next fall within reach, the five-phase scale, what darkens the sun, what this phase does now, the land ahead. All numbers come from `data/eclipse.json`. |
| `battle_hud_desktop.png` | 2× crop of the desktop reliquary status plate: the projection `Shadow +N` (gold "Sun holds" → ember → blood) with an eclipsed-sun glyph drawn on the plate. The `Turn: N / Par: P (R)` label is untouched. |
| `battle_hud_phone.png` | Phone HUD: the projection rides its own element under the parsed counters row. |
| `victory_band_phone.png` | The victory band appends what the win did to the sun (`Sun held` / `Shadow +N`, plus `Sun flares −3` on an act boss). |
| `church_kindle_phone.png` | Church Kindle: pay gold to lift 8 shadow, once per chapel. |
| `act_card_phone.png` | The act card carries the phase: ACT III · UMBRAL. |
| `eclipse_card_cap_phone.png` | At the cap (review R2, `&shadow=100&actShadow=3`): HOLLOW · 100 shadow, yet "Next fall in N shadow" still counts down — the act's own shadow is uncapped; "The land ahead" says the sun can darken no further but the land still can. |
| `battle_hud_cap_phone.png`, `battle_hud_cap_desktop.png` | The projection at the cap: `Shadow +5 (land only)` — the act gathers the whole gain, the sun's meter none (near the cap: `Shadow +6 (sun +3)`). One line on the phone rail. |

Regenerate: start the dev server and open the routes above (the medallion and the
ceremony are live on arrival; set a turn past par in the battle route to see the
projection rise).
