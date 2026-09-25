# Deeds & Epithets

Status: built (gameplay wave 1, branch `claude/deeds`). Approved direction: user, 2026-09-25.
This is the approved spec, refined to what shipped; deviations are marked **Built:** and
collected at the end. Presentation: `docs/art-direction/gameplay/deeds/README.md`.

## Why

Random recruits are hard to care about, and camp/support conversations were rejected for
this game. Deeds give units stories that come out of play: a unit that holds a bridge
through three enemy phases becomes **"Elara, Who Held the Bridge"**. The title follows the
unit into ceremonies, the roster, the fallen band, the run's end and the records. Deeds
also leave a mark on promotion (an **Oath**) — the seed of hidden promotions.

## Principles

- Deeds come from real engine outcomes (resolveCombat events, the removeUnit death
  funnel, heals, dances, phase ends), never from the fog-filtered battle timeline.
- Deterministic and RNG-free. Deed code never calls `Math.random` (tested).
- Battle progress lives on the unit as plain JSON (`unit._battleDeeds`) so Vision rewind
  and suspend restore it for free (`serializeBattleUnit` clones own properties). Enemies
  that kill a player unit carry `_slewAllies` the same way. Deeds commit to the run only
  at victory, in `PostCombatController.onVictory`, before `serializeUnit` and the save.
  "Continue from Map" discards them: the roster is still at entry state.
  `serializeUnit` strips `_battleDeeds`, `_slewAllies` and the leaking `_fortHealStreak`.
- `unit.name` is identity. Epithets are a separate field rendered through one set of
  helpers (`src/engine/DeedTitles.js`: `unitDisplayName(unit, {epithet:true})`,
  `titledName`, `sentenceName`). Nothing writes into `name`.
- No deed rewards doing something the player would regret; deeds celebrate and never
  become a checklist (the help page explains the idea; no compendium list of conditions).

## Data: `data/deeds.json` (schema `schemas/deeds.schema.json`)

```json
{
  "id": "held_the_line",
  "name": "Held the Line",
  "scope": "battle",
  "condition": { "type": "battleStat", "stat": "heldPhases", "min": 3 },
  "epithet": { "form": "who", "text": "Who Held {place}" },
  "prestige": 4,
  "oathSkill": "pavise",
  "oathName": "Oath of {place}",
  "lore": "Three nights the line bent and held."
}
```

- `form`: `who` → "Elara, Who Held the Bridge"; `the` → "Elara the Untouched"; `of` →
  "Elara of the Greenwood"; `bane` → "Elara, Bane of the Emperor"; **Built:** also `title`
  (appositive: "Elara, Lantern of the March") and `name` (a by-name: "Elara Deathblow",
  "Elara Far-Sight").
- Tokens `{place}`, `{boss}`, `{weapon}` resolve once at award time from the top-level
  `places`, `bosses` and `weapons` phrase tables and are stored with the award.
- Condition types: `battleStat` (min/max on the battle scratch), `runStat` (run tallies),
  `runStatMap` (sum of listed keys of a tally map), `runStatBest` (the best key of a map,
  its phrase becomes the token), `all` (every part).
- `prestige` 1–5 picks the displayed epithet (highest; ties → most recent).
- `tuning`: `heldPhaseMinAttacks` (2), `shieldPhaseMinAttacks` (1).
- `lore` follows `docs/lore-style-guide.md` v2 (≤85 chars, one line, no double quotes;
  `LoreContent` test): each is a found text from the march — a surgeon's note, an
  armorer's complaint, an overheard exchange, a campfire line, a triage log, a rhyme —
  with the chronicle voice kept for the one deed that earns it (Held the Line).
- Unit voices (`UnitVoice.js`, main #70) can react to deeds later: every voiced unit
  carries `unit.deeds` (`earnedDeeds`, `unitEpithet`); no voice lines use it yet.

| id | Condition | Epithet | Prestige | Oath |
|---|---|---|---|---|
| held_the_line | 3 **consecutive** held enemy phases (attacked ≥2 times in the phase, alive at its end) | Who Held {place} | 4 | Pavise |
| untouched | ≥5 enemy strikes faced in a battle, none wounded | the Untouched | 3 | Vigilance |
| would_not_fall | wounded to exactly 1 HP in a combat, or saved by Miracle | Who Would Not Fall | 3 | Unyielding |
| red_harvest | 5 kills in one battle | of the Red Harvest | 3 | Colossus |
| giantslayer | killed an enemy ≥6 effective levels higher (promoted = level + 12) | the Giantslayer | 4 | Lethality |
| bossbane | the killing blow on a boss | Bane of {boss} | 5 | Fiendish Blow |
| avenger | killed the enemy that slew an ally this battle | the Avenger | 4 | Fury |
| lordshield | 3 enemy phases ended adjacent to the living commander, attacked in them | the Lord's Shield | 3 | Aegis |
| keen_edge | 3 crits in one battle | the Keen Edge | 2 | Critical +15 |
| deathblow | 12 crits in the run | Deathblow | 3 | Sure Shot |
| mender | 150 HP healed (others) in the run | the Mender | 2 | Renewal |
| lantern | 400 HP healed in the run | Lantern of the March | 4 | Renewal |
| tempo | 12 dances in the run | Who Danced at the End | 3 | — |
| greenwood / heights / mire | 6 run kills standing on Forest / Mountain / Swamp, Bog, Acidic Swamp, Acidic Bog | of the Greenwood / of the Heights / of the Mire | 2 | Pathfinder / Skirmisher / Drain |
| weapon_family | 25 run kills with one weapon type | the Blade, the Spear, the Woodsplitter, Far-Sight, the Burning, the Dawn (the Unlit reserved) | 3 | Duelist Stance |
| veteran | 15 battles survived in the run | Veteran of the March | 2 | Discipline |
| last_of_them | the only non-lord alive at the end of a battle with ≥4 deployed | the Last | 4 | — |

Places: Bridge → the Bridge, Fort → the Fort, Throne/Wall → the Gate, Village → the
Village, Forest → the Wood, Mountain → the Pass, Floor/Pillar → the Hall, else the Line.
Bosses: "the {name}"; The Entity → the Sleeper; Dark Champion → the Lieutenant.

## Engine: `src/engine/DeedSystem.js` (pure)

- `beginBattleDeeds(unit)` ensures (and repairs) the scratch.
- `recordCombat(result, attacker, defender, {phase})` — after the final HP is applied:
  crits dealt, enemy strikes faced, wounds, brink (wounded to 1 HP or Miracle), and the
  enemy-phase attack count on the defender.
- `recordKill(victim, killer, {terrain})` — kills, killer's terrain, weapon type, level
  gap, boss kills (raw name, phrased at award), avenging; a player death stamps
  `_slewAllies` on the enemy.
- `recordHeal(healer, amount)`, `recordRefresh(dancer)`.
- `recordEnemyPhaseEnd(units, {turn, terrainAt, commander, deedsData})` — held streaks and
  the place of the longest one, the lord's shield. Idempotent per turn.
- `commitBattleDeeds(units, deedsData, {battleKey, act, battle, deployedCount})` — merges
  the scratch into `unit.deeds.stats`, awards every deed newly met as
  `{id, epithet, form, prestige, seq, oath, awardedAt:{act, battle}}`, recomputes
  `unit.deeds.epithet`, deletes the scratch, returns announcements for the rite.
  Idempotent per `battleKey` (`act:nodeId:completedBattles`).
- Oaths: `promotionOath(unit, deedsData, skillsData)`, `applyPromotionOath(unit, gameData)`.
- Display: `deedsForDisplay`, `deedTallyText`, `bossPhrase`; titles in `DeedTitles.js`.

Unit state: `unit.deeds = { stats, earned, epithet: null | {id, text, form}, oath?,
lastBattle? }`. Legacy saves: absent stays absent (read as empty); present is sanitized on
load (`normalizeUnitDeeds` in `RunManager.fromJSON`, idempotent). Units without deeds that
already fought (a legacy mid-run save) seed `battles` from their class-mastery counts.

**Hooks** (`src/ui/DeedController.js`, one-line calls): `_runCombatResolutionAtSpeed`
after the final HP, `removeUnit`, `HealController` (single and heal-all),
`AbilityController` Healing Circle, the dance, `onPhaseChange('player')` for the enemy
phase that ended (and a victory won inside the enemy phase closes it at commit),
`PostCombatController.onVictory` for the commit and the rite. No recording without a run
or in the tutorial. `tests/harness/HeadlessBattle.js` mirrors every call and commits at
its victory, so the harness and the full-run sim exercise deeds.

## Oaths (promotion)

Player promotions — battle Master Seal (`PromotionController`), church
(`promoteAtChurch`), roster seal (`RosterCommands.promote`) — swear the Oath right after
`promoteUnit`: the highest-prestige earned deed (ties: most recent) whose Oath skill the
unit does not already know (class innates count) teaches that skill, once per run. The
path chooser card and the rite project it through the same function
(`promotionPathContent` → `content.oath`, a sealed `oath` beat in ember). At the skill cap
the Oath is shown as dropped, never silent. Silent engine promotions (recruit spawns,
colosseum mercs, boss recruits, promoted enemies) call only `promoteUnit` and never swear.

Oath skills are the ones no scroll or level-up curriculum teaches (each is otherwise only
a promoted class's innate); `validateCrossReferences` checks they exist and the unit test
checks the "never a scroll / learnable" rule. Lord signature skills (Skyward, Intimidate)
were left out on purpose: they identify Astrid and Cael, and a blessing strips lord
personal skills. True hidden classes remain a follow-up.

## Presentation

- **Deed rite** — `GrowthCeremonyController.showDeeds({entries})`, after the save: an
  anime title card per deed (ink slash across the map with speed lines and an ember
  streak, the portrait standing in it, `DEED · NAME` kicker, NAME and the epithet in
  Cinzel slammed in over a dry-brush stroke, an ember wax seal stamped with the deed's
  initial and prestige numeral, the lore line, an Oath teaser for the deed that will
  swear, "1 / 3"). One press reveals, the next moves on; "Skip all" ends the batch;
  Instant speed / reduced motion open each card revealed; effects Low drops lines, streak,
  flash and shake. Presentation only.
- **Roster / unit details** — epithet under the name in the unit list and the summary
  (body face, muted gold, `fitText`), a "Deeds" section in Stats: this march's tallies,
  the Oath (sworn or waiting), each deed with its epithet, lore, act and battle; the title
  first. Canvas fallbacks (`UnitDetailOverlay`, `RosterOverlay`) show the epithet clamped.
- **Level-up card** (epithet under the name), **promotion rite** kicker ("Promotion ·
  Elara, Who Held the Bridge"), **fallen band** ("Edric, Who Held the Bridge, has fallen"),
  a crimson notice when any other titled unit falls, **crit cut-in** epithet line.
- **Run end** — "Deeds of the March" in the run result: every titled unit, the living
  then the fallen. **Records** — victory rows keep `epithet` + `epithetForm`
  (`mergeRunRecords` whitelist) and `RunRecordsMenu` shows the titled name.
- **Narrative** — `{epithet}` token (the commander's titled name) with the
  `commanderHasEpithet` condition; one act II→III line uses it.
- **Help** — Skills tab, "Deeds & Epithets" page.

## Tests

`tests/DeedSystem.test.js` (every condition ±, streaks, places, tokens, prestige, commit
idempotence, sanitize, oaths, no RNG), `tests/DeedIntegration.test.js` (serializeUnit,
save round-trip and legacy, completeBattle and the fallen, Continue from Map, records,
Oaths on each player path and none on `promoteUnit`, content helpers, narrative token,
DeedController), `tests/DeedRite.test.js` (rite DOM, two-stage cards, Skip all, Instant /
reduced motion, cleanup, roster section with the longest name + epithet),
`BattleSnapshotContracts` (rewind rolls back, suspend/resume keeps),
`PostCombatController` (commit → save → rite order), `LoreContent`, `NarrativeDirector`,
`StorySlices`, `DataLoaderBlessings`. E2E `tests/e2e/deeds.spec.js` at 1280×800, 844×390
and 640×480. Balance: `npm run sim:deeds` (see the design log for numbers).

## Deviations from the proposal

- **Held the Line** needs three enemy phases held **in a row** (the proposal: three in the
  battle). The invincible sim showed the looser rule landing for nearly every frontliner;
  "three nights the line bent" reads as consecutive anyway. The place is where the longest
  hold stood.
- Two extra epithet forms (`title`, `name`) so "Lantern of the March" takes a comma and
  "Deathblow" / "Far-Sight" read as by-names.
- Oath choice skips deeds whose skill the unit already knows (the proposal: only the top
  deed); one Oath per unit per run.
- Kills by Staff/Breath/Scroll have no weapon phrase; `Dark` is reserved (no Dark tomes).
- Brink needs the unit to be wounded in that combat (standing at 1 HP is not a deed).
- The recruit card has no epithet: every card-bearing join is a new unit with no deeds.
- The deed announcement queue exists only after victory, so Vision rewind has nothing
  to reset.
