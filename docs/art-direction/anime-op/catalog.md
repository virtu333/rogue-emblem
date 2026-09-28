# Anime opening: reference catalogue

91 images: 61 use, 2 maybe, 28 reject. Sorted by beat (first listed), then verdict. The style target is **The Unwritten Page** ([STYLE.md](STYLE.md)); verdicts judge each image against it and against the PC-98 portraits.

| Source folder | Images | What it is |
|---|---|---|
| `~/Downloads/anime-op-reference` | 23 | The first painterly studies and storyboard, made for an earlier, vocal version of the opening. Old style: composition reference only. |
| `~/Downloads/rogue-dawn-sketchbook-tests` | 4 | The four tests that set the Unwritten Page style. |
| `~/Documents/rogue-emblem-assets/batch-1` | 12 | First production batch ([prompts-batch-1.md](prompts-batch-1.md)). |
| `~/Documents/rogue-emblem-assets/batch-2` | 15 | Second production batch ([prompts-batch-2.md](prompts-batch-2.md)). |
| `~/Documents/rogue-emblem-assets/batch-3` | 25 | Third batch: the redone maybes, model sheets, officers, the rewind test ([prompts-batch-3.md](prompts-batch-3.md)). |
| `~/Documents/rogue-emblem-assets/batch-4` | 12 | Fourth batch: distinct faces, closeup redos, allied soldiers, camp and hymn ([prompts-batch-4.md](prompts-batch-4.md)). |

Not catalogued: the READMEs and `index.html` review pages in each folder.

**Background settings** (for plates): `pixel.py … --no-ink --bilateral 6 --dither 0.3`. The default settings turn fine texture into black speckle.

**Layers** lists a suggested split for the rig. Nothing is cut yet.

## Bars 1-4: Band hits; flashes; Empire boots

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `b01_edric_eye.png` | batch-1 | closeup | Edric's eye; a banner reflected in the iris | 1-4 | **use** | Survives conversion. | 1536×1024 |  |
| `b01_hilt.png` | batch-1 | closeup | Gloved hand closing on a plain longsword hilt; teal cloak | 1-4 | **use** | The teal cloak and belt make it Edric's. Code adds the thread at the wrist. | 1536×1024 |  |
| `b01_empire_boots.png` | batch-2 | closeup | Six iron-shod boots stamping in step on bare paper | 1-4 | **use** | Dense and flat, as the Empire is drawn. Survives conversion. | 1536×1024 |  |
| `b13_empire_soldier_march.png` | batch-2 | character | Imperial pikeman marching in profile, facing left | 1-4, 13-20 | **use** | Tiles into lockstep ranks (tested on the road plate). | 1024×1536 | cloak, pike arm, near leg, far leg, body |
| `storyboard/01-valley-intro.png` | anime-op-reference | plate | The Hollow Sun setting over a dark valley | 1-4 | **reject** | Dark and dense. The camp plate opens the story, and code draws the sun. | 1672×941 |  |
| `storyboard/18-vocal-chop-drop.png` | anime-op-reference | key | Four diagonal panels: Sera, crimson, a violet city, a yellow sun | 1-4 | **reject** | Made for the vocal version. The last panel shows a bright yellow sun, not the Hollow Sun. The diagonal-panel layout is a good idea for the bar 1-4 flashes, done in code. | 1672×941 |  |

## Bars 5-12: The camp on the night before; the Thread; Edric rises

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `b05_camp_night_plate.png` | batch-1 | plate | Night camp, empty; fire low; a clear sky band for the Thread | 5-12 | **use** | Right layout: no people, fire low, an empty sky band, tall for the tilt. Detailed, so convert with the background settings. | 1024×1536 |  |
| `b05_edric_at_fire.png` | batch-1 | character | Edric seated, sword drawn across his knees, looking to the side | 5-12 | **use** | Keys cleanly. Hair drifts auburn (the portrait is chestnut). | 1024×1536 | head and hair, cloak, arms with sword, body |
| `b53_edric_looks_up.png` | batch-1 | key | Edric looks up at the night sky; firelight below | 5-12 | **use** | Use for Edric seeing the Thread in bars 5-12. Not the final frame: b53_edric_final_frame replaces it there. | 1536×1024 |  |
| `b05_kira_at_camp.png` | batch-4 | character | Kira on a crate, reading a map across the knees | 5-12 | **use** | On-model; the face leans androgynous as asked. | 1024×1536 | head, map and hands, coat, crate |
| `b05_sera_at_camp.png` | batch-4 | character | Sera seated, knees up, blanket round her shoulders, looking up | 5-12 | **use** | On-model; the gold cross is there. | 1024×1536 | hair, blanket, body |
| `01-edric-standing-greenscreen.png` | rogue-dawn-sketchbook-tests | character | Edric standing, three-quarter view, looking up past the viewer; gold thread at his wrist | 5-12, 13-20 | **use** | Clean key, on-model; the model for all character assets. "Edric rises", and the standing Edric in the ensemble. | 1024×1536 | hair, head, cloak, sword arm, body, legs |
| `storyboard/08-edric-ahead.png` | anime-op-reference | group | Edric reaches back for Sera's hand in ruins | 5-12 | **reject** | Replaced by sketchbook 04-bridge-thread: the same hands-joined beat, in style. | 1672×941 |  |

## Bars 13-20: Cross-cut: our army against the Empire

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `b13_card_astrid.png` | batch-2 | character | Astrid mounted on a white winged horse, facing right | 13-20 | **use** | On-model. Mounted cards need about 1.45x scale to match the figures on foot. | 1536×1024 | near wing, far wing, rider with lance, horse, tail |
| `b13_card_cael.png` | batch-2 | character | Cael in plate with an open helm, axe across his body | 13-20 | **use** | On-model. | 1024×1536 | scarf and cloak, arms with axe, body |
| `b13_card_kira.png` | batch-2 | character | Kira pointing right, tome in hand | 13-20 | **use** | On-model. Fix before use: paint out a small pale-blue glint behind the head. | 1024×1536 | hair, pointing arm, coat tails, body |
| `b13_card_rowan.png` | batch-2 | character | Rowan mounted on a bay horse, lance upright | 13-20 | **use** | On-model. About 1.45x scale to match the figures on foot. | 1536×1024 | rider with lance, scarf, horse, tail |
| `b13_card_sera.png` | batch-2 | character | Sera standing, one hand raised, feeling for the thread | 13-20 | **use** | Gold cross present; on-model. | 1024×1536 | hair, head, raised arm and sleeve, robe |
| `b13_card_voss.png` | batch-2 | character | Voss with bow, quiver and green cloak | 13-20 | **use** | On-model: scar, beard, tied-back hair. | 1024×1536 | cloak, bow arm, body |
| `b13_empire_road_plate.png` | batch-2 | plate | Straight road side-on under a crimson sky | 13-20 | **use** | For the marching column. Match the left and right edges before tiling. | 1536×1024 |  |
| `b21_officer_drill.png` | batch-3 | character | Bareheaded drill officer, sword raised, calling the count | 13-20, 21-28 | **use** | Dense and flat, faces left. A scar already gives him his own face. | 1024×1536 | sword arm, head, cloak, body |
| `b21_officer_mounted.png` | batch-3 | character | Mounted officer on a black horse, walking left | 13-20, 21-28 | **use** | Profile, one foreleg raised: a walk cycle can start from this pose. | 1536×1024 | rider, cloak, caparison, horse, tail |
| `b21_officer_standard.png` | batch-3 | character | Standard-bearer marching left; black sword on crimson | 13-20 | **use** | Profile march, matches the soldier. The banner can hang on a spring in code. | 1024×1536 | banner, pole arm, cloak, legs, body |
| `04-bridge-thread.png` | rogue-dawn-sketchbook-tests | key | Edric and Sera hand in hand, crossing a ruined bridge along the thread | 13-20 | **use** | Wide establishing shot. The figures are about 80 px tall at game size, so no acting at this scale. Crop the torn border. | 1536×1024 |  |
| `b13_empire_soldier.png` | batch-1 | character | Imperial spearman standing front-on at rest | 13-20 | **maybe** | Livery is right (crimson, cross clasps), but he stands front-on at rest. Usable as-is for ranks facing the camera; b13_empire_soldier_march covers the march. | 1024×1536 |  |
| `05-bridge-ensemble.png` | anime-op-reference | group | Kira points with a map, Astrid overhead, Edric braces on a bridge in iron rain | 13-20 | **reject** | Replaced by the batch-2 cast cards. The figures are part of a busy scene, so they cannot be layered. | 1672×941 |  |
| `storyboard/03-banner-hook.png` | anime-op-reference | key | Torn crimson banner over a city under the black sun; travellers below | 13-20 | **reject** | Dense. The soldier, boots and road assets carry the Empire now. | 1672×941 |  |
| `storyboard/15-bridge-clean.png` | anime-op-reference | group | Cleaner redraw of 05-bridge-ensemble | 13-20 | **reject** | Replaced by the cast cards; cannot be layered. | 1672×941 |  |

## Bars 21-28: The seers; officers and the Emperor

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `b21_emperor.png` | batch-1 | character | The Emperor standing with a sceptre | 21-28 | **use** | Close to the portrait. Stands with a sceptre, not on a throne; more flexible. | 1024×1536 | crown and head, cloak, sceptre arm, body |
| `b21_lieutenant_eyes.png` | batch-1 | closeup | The Lieutenant's eyes; white streak, cracks and a red eye | 21-28 | **use** | On-model: the cracks and the red eye are on the same side as in the portrait. | 1536×1024 |  |
| `b21_sera_eyes.png` | batch-1 | closeup | Sera's eyes; a gold crack in one iris | 21-28 | **use** | Green eyes, as in the portrait. Same eye height as the Lieutenant's, for the mirrored cut. | 1536×1024 |  |
| `b21_lieutenant_full.png` | batch-3 | character | The Lieutenant standing, hand raised, mirroring a seer | 21-28 | **use** | Faces left. Mirrors Sera reaching for the thread. | 1024×1536 | raised arm, head, cloak, body |
| `b21_lieutenant_threads.png` | batch-3 | key | The Lieutenant, gold threads whole in one hand, crimson snapped in the other | 21-28 | **use** | Replaces the old reveal. Cracks and red eye on the correct side. Delivered 1672x941 and centre-cropped to 3:2 by the generator. | 1536×1024 |  |
| `b21_sera_closeup.png` | batch-3 | closeup | Sera winds a gold thread round two fingers | 21-28 | **use** | Replaces the old close-up. Delivered 1672x941 and centre-cropped to 3:2. | 1536×1024 |  |
| `b21_sera_closeup_v2.png` | batch-4 | closeup | Sera close-up, repainted with the new face | 21-28 | **use** | Nearly identical to the batch-3 version; either works. | 1536×1024 |  |
| `03-sera-window.png` | rogue-dawn-sketchbook-tests | key | Sera at a ruined window finds the thread | 21-28 | **use** | On-model, and survives conversion well. The robe has no gold cross (minor). Crop the torn border. | 1536×1024 |  |
| `04-sera-closeup.png` | anime-op-reference | closeup | Sera winds a gold thread round her fingers; dawn in her eye | 21-28 | **reject** | Replaced by batch-3 b21_sera_closeup. | 1672×941 |  |
| `06-lieutenant-reveal.png` | anime-op-reference | key | The Lieutenant, symmetrical, holding gold and snapped crimson threads | 21-28 | **reject** | Replaced by batch-3 b21_lieutenant_threads. | 1672×941 |  |
| `storyboard/09-future-window.png` | anime-op-reference | key | Sera at a rain-streaked window; her reflection shows a future city | 21-28 | **reject** | Replaced by sketchbook 03-sera-window. | 1672×941 |  |

## Bars 29-44: Chorus: the charge, the fraying thread, the falls

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `b29_edric_charge.png` | batch-1 | character | Edric running right, sword low, cloak streaming | 29-44, 13-20 | **use** | Runs right (our side's direction). Clean, held pose. | 1024×1536 | hair, cloak, sword arm, far arm, body, legs |
| `b29_edric_falls.png` | batch-1 | character | Edric stumbling as he is hit | 29-44 | **use** | The fall on each hit. Hair drifts auburn. | 1024×1536 | hair, cloak, sword arm, body |
| `b29_ford_plate.png` | batch-1 | plate | Shallow ford at dusk; torn blue banner; no people | 29-44 | **use** | First fall. Convert with the background settings. | 1536×1024 |  |
| `b29_bridge_plate.png` | batch-2 | plate | Stone bridge over a misty gorge; torn blue banner | 29-44 | **use** | Second fall. The orange sunset and visible sun break the one-warm-light rule: take the sun out and cool the grade in code (tested). Convert with the background settings. | 1536×1024 |  |
| `b29_edric_collapse.png` | batch-2 | character | Edric on one knee, sword planted, head bowed | 29-44 | **use** | The held collapse for the freeze and crack. Rips in the cloak key through as holes, which reads as torn cloth. | 1024×1536 | hair and head, cloak, body with arms and sword |
| `b29_fens_plate.png` | batch-2 | plate | Grey fens; broken spears; ruins in the fog | 29-44 | **use** | Third fall. Same sunset fix as the bridge (tested). Convert with the background settings. | 1536×1024 |  |
| `b29_ridge_plate.png` | batch-2 | plate | Grassy ridge under a clear violet dusk sky | 29-44 | **use** | The sky is clear for the code-drawn Hollow Sun. Tested with the charge and with the whole cast. | 1536×1024 |  |
| `b29_stair_plate.png` | batch-2 | plate | Wide stair to a fortress gate; crimson banners | 29-44 | **use** | Fourth fall. Convert with the background settings. | 1536×1024 |  |
| `b29_first_light_plate.png` | batch-3 | plate | Cold first light over a misty valley; an open hilltop | 29-44 | **use** | No sun. Wide enough for the whole cast. Convert with the background settings. | 1536×1024 |  |
| `b29_sera_hands_fray_strip.png` | batch-3 | strip | Sera's hands on the thread: whole, fraying, half unravelled | 29-44, 45-48 | **use** | The three frames are registered, so they play in sequence. Frame 1 doubles for the hymn. | 1536×1024 |  |
| `b29_sera_run.png` | batch-3 | character | Sera running right, skirts gathered, hand reaching forward | 29-44 | **use** | Pairs with b29_edric_charge. Matches the cast card costume. | 1024×1536 | hair, reaching arm and sleeve, skirt-hand arm, robe, legs |
| `b29_ally_spear.png` | batch-4 | character | Allied militia spearman, kettle helm, teal armband, facing right | 29-44 | **use** | For filling out the army at first light; repeat and vary in code. | 1024×1536 | spear arm, pack, body |
| `b29_ally_sword_shield.png` | batch-4 | character | Allied militia, mail shirt and round shield, facing right | 29-44 | **maybe** | His face and hair read as Voss (long brown hair tied back, stubble). Fix: recolour the hair and add a helm in code, or regenerate with a helm. | 1024×1536 | shield arm, body |
| `02-chorus-run.png` | anime-op-reference | key | Sera and Edric run under the black sun | 29-44 | **reject** | Failed the pixel test: the dense texture turns to mush at 480×270. 11-chorus-run-clean is the cleaner version. | 1672×941 |  |
| `storyboard/11-chorus-run-clean.png` | anime-op-reference | group | Sera and Edric run together, black sun behind | 29-44 | **reject** | Replaced by batch-3 b29_sera_run with b29_edric_charge on the ridge plate. | 1672×941 |  |
| `storyboard/12-thread-frays.png` | anime-op-reference | closeup | Sera's hands pull a gold thread taut as it frays | 29-44 | **reject** | Replaced by batch-3 b29_sera_hands_fray_strip. | 1672×941 |  |
| `storyboard/13-edric-falls.png` | anime-op-reference | key | Edric kneels; his earlier falls ghosted behind him | 29-44 | **reject** | Replaced by the falls on four plates (batches 1 and 2). The ghosted-repeat idea is done in code. | 1672×941 |  |
| `storyboard/14-unnamed-dawn.png` | anime-op-reference | group | Sera and Edric on a hill above a valley at dawn | 29-44 | **reject** | Replaced by batch-3 b29_first_light_plate with the cast cards. It also shows a bright sun. | 1672×941 |  |

## Bars 45-48: The hymn: stillness, violet

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `07-thread-transition.png` | anime-op-reference | fx | Gold thread stitched across paper, fraying beside an ink eclipse | 45-48, 49-52 | **use** | Already the Unwritten Page idea: bare paper, a stitched thread, an ink eclipse. Sparse, so it survives conversion. Code redraws the thread so it can animate. | 1672×941 |  |
| `b45_sera_hymn_kneel.png` | batch-4 | character | Sera kneeling, eyes closed, drawing the thread back | 45-48 | **use** | Side view facing right; hair and sleeves ready for a wind spring in code. | 1024×1536 | hair, sleeves and hands, robe |
| `02-hymn-plate.png` | rogue-dawn-sketchbook-tests | plate | Empty page: a half-erased battlefield, a sewn thread ending at the centre | 45-48 | **use** | The hymn. Convert with the background settings. Crop the torn paper border, and cover the painted thread so code can draw it. | 1536×1024 |  |

## Bars 49-52: The rewind

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `storyboard/06-the-roll.png` | anime-op-reference | key | A ghosted crowd walks backward over wet stone (the Roll) | 49-52 | **reject** | In "Again" the rewind uses the opening's own frames, stripped back to paper in code. Keep only as a concept note. | 1672×940 |  |
| `rw_camp_lines.png` | batch-3 | fx | Line-only redraw of the camp plate (rewind test) | 49-52 | **reject** | Shapes move and new things appear (stars, a palisade). Cannot cross-fade with the painting; code fakes the paint stages. | 1024×1536 |  |
| `rw_edric_final_lines.png` | batch-3 | fx | Line-only redraw of the final frame (rewind test) | 49-52 | **reject** | Face, hair and cloth move. Keep only as a reference for the line style. | 1536×1024 |  |

## Bars 53-56: Edric looks up; silence; the Hollow Sun and title

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `storyboard/17-half-beat-silence.png` | anime-op-reference | fx | One gold thread hanging over a faint ring on black | 53-56, 1-4 | **use** | Sparse, and it survives conversion. Composition reference for the silence at the end; code draws the thread and the ring. | 1672×941 |  |
| `b53_edric_final_frame.png` | batch-2 | key | Edric at the fire looks straight into the camera; full colour | 53-56 | **use** | The final frame, and the only fully painted one. Chestnut hair; the ghost of a smile. | 1536×1024 |  |
| `b53_edric_final_frame_v2.png` | batch-4 | key | Final frame, repainted with the new Edric face | 53-56 | **use** | Firmer face that matches ms2_edric_heads. The batch-2 version stays as the alternate: owner picks. | 1536×1024 |  |
| `storyboard/20-hollow-cut-clean.png` | anime-op-reference | key | Cleaner redraw of 03-hollow-sun-cut | 53-56 | **reject** | The old ending. Code draws the final Hollow Sun and the title. | 1672×941 |  |

## Bars model: Model sheets (for the rig, not a beat)

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `ms_astrid_turn.png` | batch-3 | sheet | Astrid model sheet: turnaround, on foot | model | **use** | Turnaround: front, three-quarter, side, back. The three-quarter view faces left. | 1536×1024 |  |
| `ms_cael_heads.png` | batch-3 | sheet | Cael model sheet: four heads | model | **use** | Expression heads. Distinct face (age, helm). Not registered: align before swapping. | 1536×1024 |  |
| `ms_cael_turn.png` | batch-3 | sheet | Cael model sheet: turnaround | model | **use** | Turnaround: front, three-quarter, side, back.  | 1536×1024 |  |
| `ms_edric_turn.png` | batch-3 | sheet | Edric model sheet: turnaround | model | **use** | Turnaround: front, three-quarter, side, back. Chestnut hair held in every view; thread at the wrist. | 1536×1024 |  |
| `ms_kira_turn.png` | batch-3 | sheet | Kira model sheet: turnaround | model | **use** | Turnaround: front, three-quarter, side, back.  | 1536×1024 |  |
| `ms_rowan_turn.png` | batch-3 | sheet | Rowan model sheet: turnaround, on foot | model | **use** | Turnaround: front, three-quarter, side, back.  | 1536×1024 |  |
| `ms_sera_turn.png` | batch-3 | sheet | Sera model sheet: turnaround | model | **use** | Turnaround: front, three-quarter, side, back.  | 1536×1024 |  |
| `ms_voss_heads.png` | batch-3 | sheet | Voss model sheet: four heads | model | **use** | Expression heads. Distinct face (age, beard, scar). Not registered: align before swapping. | 1536×1024 |  |
| `ms_voss_turn.png` | batch-3 | sheet | Voss model sheet: turnaround | model | **use** | Turnaround: front, three-quarter, side, back.  | 1536×1024 |  |
| `ms2_astrid_heads.png` | batch-4 | sheet | Astrid: six heads, distinct face, facing right | model | **use** | Registered for swaps: silhouettes overlap 99% between heads (batch 3: 95%). Blink tested: the closed eyes patch cleanly onto the open head.  | 1536×1024 |  |
| `ms2_edric_heads.png` | batch-4 | sheet | Edric: six heads, distinct face, facing right | model | **use** | Registered for swaps: silhouettes overlap 99% between heads (batch 3: 87%). Blink tested: the closed eyes patch cleanly onto the open head. Heavier, lower brows. A stray line runs down the neck: paint out or keep as a scar. | 1536×1024 |  |
| `ms2_kira_heads.png` | batch-4 | sheet | Kira: six heads, androgynous face, facing right | model | **use** | Registered for swaps: silhouettes overlap 97% between heads (batch 3: 96%). Blink tested: the closed eyes patch cleanly onto the open head.  | 1536×1024 |  |
| `ms2_rowan_heads.png` | batch-4 | sheet | Rowan: six heads, broad face, no tooth gap, facing right | model | **use** | Registered for swaps: silhouettes overlap 97% between heads (batch 3: 98%). Blink tested: the closed eyes patch cleanly onto the open head. The closed eyes are a smiling squint, which suits his grin. | 1536×1024 |  |
| `ms2_sera_heads.png` | batch-4 | sheet | Sera: six heads, distinct face, facing right | model | **use** | Registered for swaps: silhouettes overlap 98% between heads (batch 3: 96%). Blink tested: the closed eyes patch cleanly onto the open head.  | 1536×1024 |  |
| `ms_astrid_heads.png` | batch-3 | sheet | Astrid model sheet: four heads | model | **reject** | Replaced by batch-4 ms2_astrid_heads (distinct face, registered heads). | 1536×1024 |  |
| `ms_edric_heads.png` | batch-3 | sheet | Edric model sheet: six heads | model | **reject** | Replaced by batch-4 ms2_edric_heads (distinct face, registered heads). | 1536×1024 |  |
| `ms_kira_heads.png` | batch-3 | sheet | Kira model sheet: four heads | model | **reject** | Replaced by batch-4 ms2_kira_heads (distinct face, registered heads). | 1536×1024 |  |
| `ms_rowan_heads.png` | batch-3 | sheet | Rowan model sheet: four heads | model | **reject** | Replaced by batch-4 ms2_rowan_heads (distinct face, registered heads). | 1536×1024 |  |
| `ms_sera_heads.png` | batch-3 | sheet | Sera model sheet: six heads | model | **reject** | Replaced by batch-4 ms2_sera_heads (distinct face, registered heads). | 1536×1024 |  |

## No beat in "Again"

| File | Source | Kind | Subject | Beats | Verdict | Why | Size | Layers |
|---|---|---|---|---|---|---|---|---|
| `01-ash-city.png` | anime-op-reference | key | Sera kneels at a thread by a fallen banner; Edric looks to the road; ash city | none | **reject** | The ash city is from the old storyboard and has no place in "Again". Dense watercolour turns to mush at 480×270. 04-ash-city-clean is the same shot. | 1672×941 |  |
| `03-hollow-sun-cut.png` | anime-op-reference | key | Sera small in a ruined shrine under the black sun; the thread ends in the air | none | **reject** | The old ending. "Again" ends on Edric at the fire, then the Hollow Sun and the title, drawn in code. | 1672×941 |  |
| `storyboard/04-ash-city-clean.png` | anime-op-reference | key | Cleaner redraw of 01-ash-city | none | **reject** | Old-storyboard beat; the figures are part of a busy scene. | 1672×941 |  |
| `storyboard/05-sera-wakes.png` | anime-op-reference | key | Sera on the ground, fingertips on the thread | none | **reject** | Old-storyboard beat (Sera wakes in the ash city); no place in "Again". | 1672×941 |  |
| `storyboard/19-not-yet.png` | anime-op-reference | group | Sera and Edric in ruins under the black sun | none | **reject** | The old ending; dense. | 1672×941 |  |
