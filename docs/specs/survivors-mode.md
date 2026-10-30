# Darkest Before Dawn (the survivors mode)

A Vampire Survivors–style mode beside the runs: one lord on an open field, weapons that strike
on their own, waves of the game's own enemy classes, and ten minutes to hold until dawn. The
draft and the reasoning behind it are in the project's review notes (`survivors-mode-spec.md`,
2026-10-27); this page is the mode as built.

## Decisions (Dave, 2026-10-30)

| Question | Decision |
| --- | --- |
| Where it lives | A separate Home Base mode. **Web only** for now: never in the iOS or Android app. |
| Rewards | Records and unlocks only. No Valor, nothing that makes a run stronger. |
| Length | 10 minutes to dawn (`durationSec` 600). |
| Who fights | One lord now; recruit companions are wanted (Tier 1, not built). |
| A refresh mid-night | Loses the night. There is no suspend. |
| Name | Darkest Before Dawn. |

## Tier 0 as built

**Where.** Home Base shows a "Darkest Before Dawn" button under Begin Run when
`utils/survivorsEntry.js` `survivorsEntryShown()` says so: never in a native app
(`nativeCapacitor()`), and on the web only where review routes run (the dev server, Netlify
previews with `VITE_DEV_ROUTES`), so the live site does not show it yet. Review route:
`?devScene=survivors[&seed=N][&lord=Name][&autoplay=1]` (`autoplay`: the balance bot plays the
night, for looking and timing). The scene is lazily loaded (`utils/sceneLoader.js`), so the
mode costs a run nothing to download, and it reuses the game's art and music, so it adds no
assets.

**Data.** `data/survivors.json` holds every number: the field, the lord's and the foes' tuning,
the XP curve, the six weapons (each five levels naming a real catalog weapon), the passives,
the seven waves, elites, the two bosses and the music. `npm run validate:data` checks it
against the rest of the game's data (`engine/survivors/SurvivorsConfig.js`
`validateSurvivorsConfig`: weapons, classes, bosses, lords and terrain must exist; boss-tier
classes are refused in waves; numbers the rules divide by must be positive).

**Rules (pure, `src/engine/survivors/`).** A fixed step (`STEP` 1/60 s) on a seeded mulberry32
stream (`createSeededRng`), never `Math.random`, so a seed replays the same night and a whole
night runs headless in a unit test (about 7 s).

- `SurvivorsField.js`: a 64×64 field of terrain names (seeded blobs of Forest, Water and
  Mountain around a clear centre), read for movement through `terrain.json` move costs, so a
  pond stops Infantry and lets fliers over exactly as on the battle map; terrain slows by its
  cost and gives its avoid as a chance a blow misses. Foes walk breadth-first flow fields per
  move type (no corner cutting through a pond).
- `SurvivorsUnits.js`: the lord's stats and growths from `lords.json` and `classes.json`; a
  foe is its class at a level (base to 12, then promoted, as `createPromotedEnemyUnit`), with
  an Iron or Steel weapon. Blows use the game's formulas: (STR or MAG + Might + triangle) − DEF
  or RES, at least 1; crits triple. Level-ups roll the lord's growths, with the streak guard's
  closest miss when every stat misses.
- `SurvivorsSim.js`: the world. Foes spawn just past the view's edge and are moved back when
  they fall far behind; archers and casters keep their distance and shoot; elites drop a chest;
  the Iron Captain (5:00) and the Warchief (9:00) charge. Weapons fire on their cooldowns
  (sword arc, lance thrust, axe boomerang, arrows, fire bolts with a burst, a light aura) and
  aim at the nearest foe. Kills drop XP shards; a level or a chest stops the clock and offers
  three choices (a new or better weapon, a new or better accessory or skill; Rest when nothing
  is left). The lord holds 4 weapons and 4 passives.
- `SurvivorsBot.js`: a simple player for the balance sim and `autoplay`.

**Scene (`scenes/SurvivorsScene.js`, `ui/survivors/`).** The traced unit sprites, the terrain
painter, the fx atlas, `combatNumberStyle` numbers and the item icons. The night darkens and
lightens on a multiply layer with a lantern glow around the lord. A DOM HUD (XP bar, level,
clock, kills, pause, held weapons and passives, the boss bar) and DOM panels for the lord
picker, the level-up cards, pause and the result. Input: a floating stick (touch anywhere on
the field), WASD and arrows, a pad's left stick; Escape, P, the pad's Start and the input bus's
Cancel pause; number keys pick a card. Backgrounding the page pauses. Music: the eclipsed
battle theme, calm or full by the number of foes, each boss's own theme and its enrage layer,
then the run's win or defeat theme.

**Records.** The longest night per lord on this device (`emblem_rogue_survivors_best`,
`ui/survivors/survivorsModel.js` `recordNight`), shown on the lord picker and the result.
Not in the meta save yet. Lords: a run must have met a lord before the mode offers them
(`meta.hasMetLord`); review routes offer all seven.

**Balance.** `node sim/survivors.js [--trials N] [--seed S] [--lord Name]` plays nights with the
bot. At Tier 0 the bot reaches dawn in roughly half its nights, depending on the lord (bows
easiest, a lone Light Sage hardest). Tune it by Dave's play, not by the bot.

**Tests.** `tests/Survivors.test.js` (rules, determinism, no `Math.random`, waves, bosses,
dawn), `tests/SurvivorsModel.test.js` (words, records, where the entry shows),
`tests/e2e/survivors.spec.js` (`mobile-ui` lane: Home Base's entry, the picker, the stick, a
level-up card, pause, giving up, the trip home).

## Not built yet (Tier 1 and on)

- Recruit companions fighting beside the lord.
- Records in the slot's meta (synced through the cloud), and unlocks inside the mode (fields,
  the Long Night stage, weapons).
- More fields (one per act biome), act bosses beyond the two, elites with affixes.
- Weapon evolutions into legendary arts, achievements, Compendium entries, outfits.
- A decision on showing it on the live site.
