# Large maps 05: boss maps

Status: proposal, revision 1 (2026-10-09), fact-checked against the code. Specs only: no
game code or data changes.
Branch `claude/large-maps-specs`. Part of the large-maps set ([README](README.md)); this
spec owns roadmap **Phase 5** (boss set pieces) and a new strand the owner asked for:
**enhancing today's boss maps** rather than replacing them. It writes `02`'s groups and
triggers, `03`'s phases and bonuses and `04`'s set-piece format; it defines no rule those
specs own. It adds two trigger kinds (§4.3), two engine modules (`engine/BossKit.js` at
generation, `engine/BossSignature.js` in play, §10.3) and a short list of extensions to
`02`–`04`'s vocabularies, each listed under "Notes for the README" so the owning spec can
take it in.

The owner's decisions this spec takes as given (README §6):
- set pieces appear at most once per act on ordinary nodes, plus a chance on elite nodes;
- **First Light gets no set pieces**; it may still get the boss enhancements that are not
  set pieces (§9.5 says exactly which);
- a bonus objective **may** pay a Vision charge: Act III+, at most once per act (`03` §7.4);
- boss maps are **enhanced, not replaced**: "I'm sure there's ways for us to sort of
  expand them in terms of creative possibilities." The hybrid arenas stay in the pool.

So this spec has two halves. The first (§4–§7) makes every boss fight in the game richer on
the map it already plays on, First Light included under §9.5's rules. The second (§8) adds
boss set pieces to the Act III, Act IV and finale pools beside today's arenas, on Dusk and
up, never on First Light.

## 1. Where we are

Line numbers are from 2026-10-09 and drift. "BS" is `src/scenes/BattleScene.js`, "MG" is
`src/engine/MapGenerator.js`.

### 1.1 The bosses

`data/enemies.json` `bosses` (`:176-272`): eleven bosses, namely eight act bosses
(Acts I–III), the Emperor (Act IV) and two finales. Each is a class, a level, a name, an
epithet and a lore line (the two finales also carry `difficultyFilter`, the Entity
`isEntity`); nothing else. A boss has no kit: no signature skill, no scripted behaviour, no
phases of its own.

| Act | Boss | Class, level | Stones (First Light / Dusk / Nightfall / Black Sun) | Theme, enrage layer, card cue |
|---|---|---|---|---|
| I | Iron Captain, Warchief | Cavalier 3, Fighter 3 | 0 / 0 / 1 / 1 (`actBoss`) | `music_boss_act1`, one layer each, `boss_iron_captain` / `boss_warchief` |
| II | Knight Commander, Archmage, Dark Rider | Paladin 12, Sage 12, Dark Knight 12 | 0 / 0 / 1 / 1 | `music_boss_act2` |
| III | Blade Lord, Iron Wall, Berserker King | Swordmaster 17, General 17, Berserker 17 | 0 / 0 / 1 / 1 | `music_boss_act3` (the Lieutenant's sign appears) |
| IV | The Emperor | General 20 | — / 1 / 1 / 2 (`emperor`) | `music_boss_emperor` |
| finale | The Lieutenant (`difficultyFilter: normal, dusk`; Dusk's run ends at the Emperor, so only First Light meets him) | Hero 20 | 0 (`lieutenant`, every rung) | `music_boss_lieutenant`, `boss_lieutenant_card` |
| finale | The Entity (Nightfall, Black Sun) | Entity 20, 3x3, MOV 0 | never (`RevivalStones.js:38`) | `music_boss_entity` → the finale (§1.3 item 8) |

Stones per rung: `difficulty.json` `revivalStones`; First Light all 0. Boss level: the
definition's level plus the rung's `bossLevelBonus` (0 / 2 / 3 / 4), never `enemyLevelBonus`
(MG:2002-2005). Every boss stat is raised by `BOSS_STAT_BONUS` 2 at creation (BS:2613-2619,
`constants.js:146`). Combat skills come from `assignEnemySkills` like any enemy
(`UnitManager.js:469-500`, by act chance and level). Act bosses roll no affixes
(`assignRolledAffixes` skips every `isBoss` spawn, `AffixEngine.js:262`); the Entity takes two
curated ones (`affixes.json` `config.bossAffixRules`, `AffixEngine.js:240-261`). Elite captains
(`enemies.elites`, `:273-303`) hold mid-act seize thrones as `isBoss` with `eliteCaptain`
stones (Black Sun 1) but `scene.isBoss` false: no card, no recruit.

### 1.2 How a boss map is made

- A boss node is a seize battle: `buildBattleParams` writes `{ objective: 'seize' }`
  (`NodeMapGenerator.js:516-523`); `pickTemplateForNode` (`:614-647`) filters the act's
  seize pool by the node's rolled biome (`ACT_BIOME_WEIGHTS`, `constants.js:453`) and only
  *permits* `bossOnly` templates on boss nodes (appendix §5). The seize pool is
  `castle_assault`, `hilltop_fortress` (no biome: grassland), `great_hall` (castle,
  Act II+), `glacier_fortress` (tundra) and `eruption_point` (volcano, both Act IV), plus the
  two `bossOnly` hybrid arenas: `act3_dark_champion_keep` (castle) and
  `act4_boss_intent_bastion` (tundra). By the appendix's reading the keep lands on about 27%
  of Act III boss maps and the bastion on about 17% of Act IV's. **Acts I and II have no
  boss arena at all.** The finale (`finalBoss`) always plays `eldritch_sanctum`, the only
  template listing that act (`fixedSize [16,14]`, `entitySpawn [11,5]`, no fog, three
  absolute template waves at T4 / T7 / T10 with `difficultyScaling: false`), for the
  Lieutenant on First Light as for the Entity.
- `generateEnemies` draws the boss with `Math.random` on the battle stream and seats it on
  the throne (MG:1992-2077); the Entity is stamped at `entitySpawn` with Floor under its
  footprint and the Throne restored under it (MG:2012-2051). Stones are computed by
  `revivalStoneKind` (MG:2006-2009) and written on the spawn (`spawn.revivalStones`, :2074)
  so a locked map keeps them; `EnemySpawnGear.applyEnemySpawnGear` → `applyRevivalStones`
  puts them on the unit in the scene and the harness alike.
- A Sworn Enemy gives the boss one tier-1 affix on its own seeded stream
  (`AffixEngine.assignSwornAffix` `:128-152`; `RunManager.js:3683-3685`); the Entity takes
  none (it keeps its two curated affixes).
- The hybrid arenas stamp a 4x3 block of Plain/Floor and one Fort at an absolute origin near
  the top centre (`arenaOrigin [7,0]` / `[6,0]`), raise walls at absolute turns (T2/T5 and
  T3/T6) and spawn scripted waves on the same tiles: the confirmed wall-on-wave bug of `02`
  §2.2, which `02` PR 0b fixes with `engine/TerrainPhases.js` (proposed; not in the code
  yet).

### 1.3 What a boss battle does today

1. **The card.** `_presentBossEncounter` (BS:2391-2407) builds `BossPresenceController`
   and shows the encounter card (`CeremonyController.showBossIntro` `:137-170`:
   act · class, name, epithet, the boss's card cue over the ducked theme;
   `bossCardContent`, `ceremonyContent.js:113-126`; the Entity's card is `· · ·` in
   silence).
2. **Lines.** `preBattle` plus the commander's `preBattleReply`, once per boss name
   (BS:2262-2280, `BattleBeatsController.getBossPreBattleEntries` `:79-93`); in an Act III
   boss battle on a road that never fights him, the Lieutenant's `vision`
   (`getLieutenantVisionEntries` `:94-105`). One `halfHealth` line the first time the
   living boss stands strictly below half (`currentHP * 2 < maxHP`), or once a bar has
   broken (`checkBossHalfHealth` `:107-148`, awaited after deaths are applied; a boss killed
   outright from above half never speaks), once per run (`hasShownDialogue`). `defeat` lines
   after the fall. Every boss in `enemies.json` `bosses` has all four sections in
   `dialogue.json` `bossEncounters` (`halfHealth` as `{ base, variants }`, variants keyed by
   `NarrativeDirector`'s `when` keys such as `bossKilledYouBefore` / `bossSlainBefore`); the
   Lieutenant also has `vision`.
3. **The bar.** A gilt reliquary bar at the boss's feet with a gold "just lost" chunk, a
   gem per stone, the ember frame when enraged, and a one-line reading for the rail and the
   desktop plate ("Warchief · 26/26 HP · Stones 1/1 · Enrages on turn 12";
   `BossPresenceController.js:1-140`, `bossBarView` `ceremonyContent.js:465-482`).
4. **Stones.** `UnitHealth.absorbLethal` refills the bar once per stone and ends the
   exchange (`RevivalStones.js:1-16`); `RevivalStoneController` plays the refill and the
   `sealed` cue; only the last bar counts as a kill.
5. **Enrage.** `TurnPressure.advanceTurnPressure` (`:78-110`) sets `turnEnrageActive` from
   turn `min(12, par + 2)` (`TurnBonusCalculator.getBossEnrageTurn` `:180-195`) while a boss
   lives; `02` PR 0a adds the `par + 1` floor. It is a battle-wide switch: `aggressiveMode`
   (also raised by the anti-turtle clock) releases the throne clamp and every guard, enrage
   wakes every holder, the boss gets a flame aura, the banner says "The boss is enraged!"
   and the music crossfades to the boss's enrage layer (BS:3006-3031,
   `BattleMusicController.onBossEnrage` `:167-174`).
6. **The clamp.** A seize boss keeps to tiles within 1 of the throne until `aggressiveMode`
   (`AIController.js:340-353`, `boss_hold_throne` `:649`); a clamped boss with no reachable
   tile near the throne stays where it is. The player must come to it.
7. **The fall.** `FOE VANQUISHED` (BS:9332, `_showBossDefeatedBanner` `:10917-10929`),
   `guide_objective_changed` points at the throne, and a Lord's Seize on the throne, with no
   living `isBoss`, ends the battle (BS:6349-6364). The finale is a seize map too: the
   Throne lies under the Entity's footprint (restored at MG:2035-2039), so its fall is
   followed by a Seize, and that victory ends the run (won).
8. **The Entity** (`EntitySystem.js`; AI `_decideEntityAction` `AIController.js:209-239`):
   stationary, strikes within 2 of its footprint (`ENTITY_PRIMARY_ATTACK_RANGE`) with the
   better of two range 1–4 weapons (Eldritch Grasp, Twisting Vortex:
   `weapons.json:2123-2149`), then splashes 0–2 orthogonal neighbours of its target for
   5–10 (`_applyEntitySplash` BS:10814-10850, `rollSplashTiles` / `rollSplashDamage` on the
   battle stream, `ENTITY_SPLASH_COUNT` 2 and `ENTITY_SPLASH_DAMAGE` `[5, 10]`,
   `constants.js:472-473`). **The splash lives only in the scene:** `HeadlessBattle` never
   splashes, a parity gap K6 closes (§10.3). Its first wound cuts the theme, two seconds of
   silence, the `entity_answer` violin, and `music_boss_entity_finale` starts on the cue's
   `handoff` downbeat with the `_hum` stem's gain following its HP
   (`entityHumGain(ratio)`, `BattleMusicController.js:43`, applied through
   `audio.setMusicLayerGain('hum', …)` at `:216`; the finale `:209-290`; `SCORE.md:25-62`).
   The army answers one line every two bars (`BattleBeatsController.entityRally`
   `:151-193`, `FinaleRally.js`).

### 1.4 After the fight

`RunManager.completeBattle` on a boss node: the Sworn Enemy ends (`Burdens.js:343-344`,
`RunManager.js:4206-4215`), the Eclipse relieves `bossRelief` shadow (3, `eclipse.json`;
`RunManager.js:4388`), **+1 Vision charge** on the act boss of Acts I–IV, never the finale
(`visionChargesRemaining + 1`, `RunManager.js:4316-4328`); the kill pays `GOLD_BOSS_BONUS`
300 on top of kill gold (`LootSystem.js:74`, any `isBoss`, so elite captains too); the
`bossbane` deed (`deeds.json:97-107`); then the boss recruit draft (`BossRecruitSystem.js`),
the third lord, the loot screen and `advanceAct`. After the finale the run ends: its
currencies are `calculateCurrencies(actIndex, completedBattles, isVictory, multiplier)`
(`MetaProgressionManager.js:1730-1743`), which never reads gold.

### 1.5 What is thin

- **Bosses are stat blocks.** Nothing a boss does is its own. The Blade Lord and the Iron
  Wall differ by class, portrait and lines; the fight is "walk to the throne, wear down the
  bar". Enrage is the only mid-battle change, and it is the same change for every boss.
- **One beat.** The half-HP line is the only mid-fight story, and it changes nothing on the
  board.
- **Arenas are rare and only in Acts III–IV**, and their waves arrive at half strength on
  the two most-played rungs (`02` §2.2).
- **Stones are a bar, not a phase.** A broken stone refills HP and plays a cue; the fight
  before and after it is identical.
- **The Entity does not escalate.** It stands still from turn 1 to its death; the finale
  music is the only second act. The sanctum's three waves are absolute turns.
- **First Light** meets the enrage cap on every boss map (`02` §1.5) and, with no stones,
  gets the plainest fights of all on the rung most players play.
- **Two parity gaps** this spec's PRs must close because kits lean on them: the Entity's
  splash (scene only, item 8) and the `haste` affix's MOV, which `BattleScene.addEnemyFromSpawn`
  applies at spawn (`getAffixMovBonus`, BS:2604-2611) and `HeadlessBattle._addEnemyFromSpawn`
  does not (it copies `affixes` only, `HeadlessBattle.js:931-933`).

## 2. Goals and non-goals

**Goals.**
- Every boss has a **kit**: phases, a signature the player can read and play around, a
  court (its guard as named groups), beats, music and presentation hooks. It plays on the
  boss's map whatever that map is: today's procedural seize template, a hybrid arena, or a
  set piece.
- Today's boss maps get **arena variants** and the acts with no arena get one.
- Boss maps get **bonus objectives**, and they are where this spec offers Vision (`03`
  §7.4's rule; §6).
- `04`'s two boss set pieces (Long Road and the Parade, refined here), two new ones (the
  Dueling Halls, the Battery) and `04`'s finale variant (Sanctum of Echoes, refined) join
  the Act III, Act IV and finale pools beside today's arenas, on Dusk and up.
- The finale deepens without touching the hinge, the rally or the hum's contract.
- Every rule is a pure module called by `BattleScene` and `HeadlessBattle` alike; every
  mid-battle change rides the checkpoint, the Vision snapshot and the validator.

**Non-goals.**
- No boss stat rebalance, no new classes, no new weapons beyond a kit's authored loadout.
- No new run-ending defeat. A boss's signature can fell a unit; it can never end a run on
  its own: no signature ever takes the commander below 1 HP (§5.2).
- No replacement or migration of the v1 hybrid arenas (`04` §7: they stay v1, with Phase 0's
  fix; their authored overrides and waves are untouched, §4.4).
- No set piece on First Light; no Act I or Act II boss set piece in this revision (§13 Q6).
- The prologue's Varro is untouched (`isScriptedBattle`).

## 3. Principles for a boss fight

1. **Read before it happens.** Every signature is told one player phase before it resolves,
   on the board (outlined tiles, a badge, a marker) and in words (a band, the strip's boss
   row). README pillar 7 applies to bosses twice over: the boss is the one enemy the player
   is studying.
2. **The boss is the map.** A kit changes what the court does, which door is open and where
   the fire falls; it does not add a second rule book. Phases are `03`'s phases, wakes are
   `02`'s, terrain is `TerrainPhases`.
3. **Bars are acts.** A Revival Stone is a curtain: breaking one changes the fight. On rungs
   with no stones, the half-HP point is the curtain, so First Light and Dusk still get the
   second act.
4. **One signature per boss, built from parts that exist.** Affixes, AI modes, timed buffs,
   siege tomes, forced moves, terrain sets and triggered waves are the vocabulary. A
   signature that needs a new combat rule is a later revision.
5. **First Light gets the kit, not the set piece.** The intro rung meets phases, courts and
   tells on its own boss maps, on today's map formats only, with gentler numbers
   (`byRung.normal`) and no sleeping groups (§9.5), so a player who climbs to Dusk already
   knows what a boss can do.
6. **Enrage is still the clock.** No phase delays enrage, and enrage is the implicit last
   phase of every kit: everything wakes, the boss leaves the throne. A kit adds acts before
   it; it never moves it.

## 4. The boss kit

### 4.1 Shape

`data/enemies.json` gains `bossKits`, keyed by boss name (bosses are uniquely named,
`ceremonyContent.findBossDefinition`). A kit is authored in the vocabulary of `02`, `03`
and `04` and **compiled at generation** into the ordinary config fields those specs define,
plus one small field of its own for the signature. The runtime therefore has one phase
machine (`03` §6), one trigger evaluator (`02` §3.4) and one terrain module
(`TerrainPhases`); this spec adds two trigger kinds (§4.3) and the signature module (§5).

```jsonc
"bossKits": {
  "Archmage": {
    "version": 1,
    "signature": { "kind": "volley", "name": "The Calculation",
                   "cadence": { "afterContact": 1, "every": 3, "latest": { "parOffset": -4 } },
                   "tiles": 3, "weapon": "Breachbolt",
                   "byRung": { "normal": { "lethal": false }, "dusk": { "lethal": false } } },
    "court": [
      { "id": "circle", "pick": "nearestThrone", "share": 0.4, "state": "dormant",
        "wake": [{ "kind": "danger" }, { "kind": "hurt" }],
        "onWake": { "mode": "guard", "anchor": "court" } },
      { "id": "field", "pick": "rest", "state": "awake" }
    ],
    "phases": [
      { "id": "reading",
        "until": { "kind": "bossBar", "broken": 1, "fallback": { "kind": "bossHp", "below": 0.5 } } },
      { "id": "corrected",
        "onEnter": { "signature": { "cadence": { "every": 2 } },
                     "court": { "circle": { "mode": "guard", "anchor": "court", "guardRadius": 2 } },
                     "line": "boss.archmage.corrected", "music": "card" } }
    ],
    "bonus": [{ "id": "pages", "kind": "reach", "anchor": "lectern", "deadline": { "signatureCount": 2 } }],
    "anchors": { "lectern": { "derive": "courtRing", "radius": 2, "terrain": "Fort", "pick": "farFromDeploy" } },
    "arena": { "variants": ["doctrine_yard_n", "doctrine_yard_s"] }
  }
}
```

(`reward` omitted: the bonus takes its kind's default from `objectives.json` `bonusRewards`
by act, locked at generation, `03` §7.4. On First Light the compiler turns the `dormant`
circle into an awake guard, §9.5.)

Fields:

| field | meaning | compiled into |
|---|---|---|
| `signature` | the boss's one telegraphed action (§5): `kind`, `name`, `cadence`, kind-specific fields, `byRung` | `battleConfig.bossSignature` (resolved per rung, locked) |
| `court[]` | the boss's guard as `02` groups. `pick` partitions the map's non-boss spawns with **no draw**: `nearestThrone` (the `share` nearest the throne by path), `flank:<side>`, `moveType:<type>` (with `count`), `rest`; ties by spawn index. A set piece names `region` instead | `battleConfig.encounterGroups` (`02` §3.2), members' `aiMode`/`holdPack` written as `02` §3.6 |
| `phases[]` | `03` phases that all keep the same primary (the seize; §4.5), `until` a trigger (this spec's `bossBar` / `bossHp`, or any README kind) or a list of triggers (any one fires), `onEnter` effects: `03`'s own `setTiles`, `wake` and `line` (the band's text key), plus this spec's `court` orders (§5.2 `court_order`), `signature` patches, `affix` (§5.3), `wave` (a `triggeredWaves` id to fire), `bossLine` (a spoken line key) and `music` (§7.6) | `battleConfig.objectives.phases`, with `objectives.primary` the seize `03` §3.2 would derive (written because phases say more than the derivation, `04` §3.7) |
| `bonus[]` | at most one from a kit; `03` §7.1 kinds; `deadline` may count signatures (§6) | `objectives.bonus` |
| `anchors` | derived points on a procedural map (§4.2) or chunk anchors on a set piece | `battleConfig.anchors` |
| `arena.variants` | arena variant ids of the boss's act `bossOnly` template (§4.4); the kit prefers them when the template has several | the template's hybrid overlay |
| `byRung` | per-rung patches to any of the above, from the rung up (`04` §3.4's rule); `normal` carries §9.5's First Light values | resolved at compile |

Everything compiled is **locked with the config** (README §3); a resume reads the config,
never the kit. A locked map from before kits plays exactly as today (no `bossSignature`, no
phases, no groups: every reader has that branch already).

**Par.** A kit writes `objectives`, so its config takes `02` §5.2's `groups-v1` ("Which
model": every config with written `objectives`), with W from the derived seize `parRoute`
(`03` §5.9), S counting the court's sleeping groups that touch the route, and `parAdjust`
holding only `03`'s boss bars (one turn per stone). The kit adds no par term of its own:
phases with a `bossBar` / `bossHp` `until` contribute nothing (only `survive` does, `03`
§5.10), and bonuses never touch par. So a kit map's par moves only by `groups-v1`'s
calibration against today's `calculatePar` (`02` §5.2: First Light within ±1 on maps
without pods), which §11's sims check per boss.

### 4.2 Courts and anchors on a procedural boss map

Today's boss maps have no named places. `engine/BossKit.js` `deriveBossAnchors(config)`
resolves, by BFS from the throne over Infantry-passable tiles and with no draw:
- `throne` (the one tile);
- `court` (standable tiles within path distance 2 of the throne);
- `apron` (distance 3–5);
- `gate` (the tile on the Infantry path from the player-spawn centroid to the throne that
  is 4 steps short of it: the mouth of the approach);
- `flank:n` / `flank:s` (the standable tiles of the enemy half nearest the top and bottom
  edges, within 6 of the throne).

A court `pick: 'nearestThrone'` takes the `share` nearest non-boss spawns by that BFS;
Dusk+ hold packs (`assignHolders`) are folded in: a holder inside the pick keeps its hold
fields and the group is `dormant` (`02` §3.6's adapter already derives `hold:<pack>`
groups; a kit's named court replaces the pack id for those members, validated to agree).
A pick that finds too few members (an Act II pool that rolled no cavalry for a
`moveType:Cavalry` wedge) takes the nearest remaining spawns, and a named member a bonus
needs (a court captain, §6) is the pick's highest-level member, ties by spawn index; with
no member at all the bonus is not written. With no kit the map is untouched.

Set pieces resolve the same anchor names from chunks (`04` §3.2), so a kit written against
`throne`, `court`, `gate` plays on both.

### 4.3 Two trigger kinds

Added to README §3's vocabulary and `02` §3.4's check, both "hurt-shaped": noted when they
happen, read at the next check, `≥` comparisons, fired once.

| kind | fires when | default `delay` | as the player sees it |
|---|---|---|---|
| `bossBar` | `{ broken: n }`: the boss has broken at least `n` stones (`revivalStonesMax − revivalStones ≥ n`); `n` may be `'last'` (= `revivalStonesMax`: the boss is on its last bar). Required `fallback`, a `bossHp` or `turn` trigger (never `bossBar`), used **when the boss carries fewer than `n` stones on this rung, or none for `'last'`** (decided at compile from `spawn.revivalStones`, validated), so the phase exists on every rung | 0 | the stone's own beat (`RevivalStoneController`), then the phase band at the check |
| `bossHp` | `{ below: share }`: the boss's HP on its **current bar** satisfies `currentHP < maxHP × share` at the check (at 0.5 this is exactly `checkBossHalfHealth`'s `currentHP * 2 < maxHP`, so the line and the trigger agree). Counts a bar that broke since the last check as having crossed, as `checkBossHalfHealth` does | 0 | the boss's `halfHealth` line plays at once as today (it is words); the board changes at the check |

Both are noted from the boss's state at the check, never from a hidden unit's, and both
count a fallen boss as true (its bars are spent). Both may carry `latest` (a `parOffset`,
or the legacy `{ turn: n }` for a converted template wave, §8.1–§8.2), as `turn` does,
firing at the earlier.

**Position in `02` §3.4's order.** A new slot **2b, `boss`**, right after `hurt` (slot 2)
and before `tile` (slot 3), evaluates the group wakes and triggered waves that name these
kinds. A phase whose `until` is one of them is evaluated, like every `until`, in the
`phase` slot (slot 7, `03`'s `checkPhase`), so its `onEnter` court orders land before the
`groupWoken` cascade (slot 9). The order with this spec's additions is: 1 enrage, 2 `hurt`,
**2b `boss`**, 3 `tile`, 4 `danger`, 5 `sight`, 6 `objective`, 7 `phase`, **7b the
signature** (§5.1), 8 `turn`, 9 `groupWoken`, 10 contact.

Why at the check and not at the blow: `03` §6's rule. The bar breaks in the player's phase;
the line may play then (it is words, as today); the band, the court's moves, the doors and
the signature's change wait for the enemy-phase check. The player always gets the rest of
their turn to answer what they just caused.

### 4.4 Arenas for every act, and variants for today's

- **Arena variants.** The hybrid v1 contract gains `arenaVariants: [{ id, weight,
  arenaOrigin, arenaTiles, anchors, phaseTerrainOverrides, scriptedWaves }]` on a
  `bossOnly` template (the template's own `hybridArena` block, overrides and waves are
  variant 0, unchanged). Today's blocks are 4x3 (`[7,0]` / `[6,0]`, §1.2), too small to
  change a decision, so a variant is a larger authored block. The variant is drawn on
  `keyedBattleRandom(runSeed, 'boss-arena:<nodeId>')` in the post-pass below and written to
  `battleParams.arenaVariant`: no node-map or battle stream moves, and an old save without
  the field plays variant 0 (today's map). Variants are **structural** (pillar 5): the keep's
  throne court with its doorway north or south; the bastion's firing lane left or right of
  the throne, its Fort on the near or far side. Overrides and scripted waves are authored
  per variant and stay v1 (absolute turns, deferred by `02` PR 0b's `TerrainPhases`), and
  `02` PR 0b's validator (no override on a wave tile) runs on each. Variant 0 keeps today's
  data exactly, so `04` §7's "migration: none" holds.
- **Arenas for Acts I and II** (`bossOnly` v1 templates, data only, after PR 0b), both
  grassland (no `biome`), the only biome Act I rolls (`ACT_BIOME_WEIGHTS.act1`) and the
  most common in Act II: `act1_border_post` (a palisade with one gate, the throne behind,
  a Fort at each corner of the yard, two variants; **terrain only: no scripted waves and no
  phase overrides**, since v1 has no per-rung patch and Act I is every new player's first
  boss) and `act2_doctrine_yard` (a cavalry yard: open ground, a wall line with two gaps,
  the throne on the far side; the Knight Commander's wedge wants the open ground, the
  Archmage's circle wants the wall; at most one scripted wave). Both are ordinary v1
  hybrid templates (approach procedural, arena fixed), validated like the keep. Once in
  the data, `pickTemplateForNode`'s ordinary draw may also pick them on an Act I–II boss
  node: still one `Math.random` over a longer list, so the node-map stream's cursor does not
  move, but that node's pick can (only boss nodes: `bossOnly` is filtered out elsewhere).
- **Arena share.** Boss nodes today meet an arena on about 27% of Act III boss maps and 17%
  of Act IV's, never in Acts I–II. A keyed post-pass after node generation, run right
  after `04`'s `assignSetPieces` at both `_withNodeMapSeed(generateNodeMap…)` sites
  (`RunManager.js:718`, `:4466`; never in the prologue), on
  `keyedBattleRandom(runSeed, 'boss-arena-share:<nodeId>')` and never the node-map stream,
  replaces the boss node's drawn template with one of the act's `bossOnly` templates whose
  biome equals the drawn template's (`getTemplateBiome`; absent is grassland), at the
  rung's `bossKits.arenaShare` (§10.1: First Light 0.5, Dusk and up 0.75), else leaves it.
  A boss set piece (§8) placed by `04`'s pass first wins. Old saves keep their
  `templateId` (`fromJSON` never runs the pass).

Set pieces are not needed for any of this. It is the cheapest large change in this spec and
it reaches First Light (§9.5): the arenas are today's hybrid format, not set pieces.

### 4.5 Phases that keep the primary

Every kit phase carries the same primary (the one seize). `03` §4 as written takes victory
only in the last phase and offers no Seize for a later phase before its advance, so a boss
killed and seized in phase 0 (a First Light boss taken from above half to 0 in one
exchange, before its `bossHp` `until` has fired) would leave the player waiting an enemy
phase on a won map. `04`'s Long Road drawbridge phase has the same shape. This spec needs,
and asks `03` to adopt (Notes for the README):
- **Shared primary wins in any phase.** When the current phase's primaries are the same
  objectives (same ids) as every later phase's, their completion is victory at once, as in
  the last phase; the remaining phases never enter.
- **The band is the kit's.** An advance between phases with the same primary shows the
  phase's `onEnter.line` band (§7.6), not NEW OBJECTIVE; it raises no `guide_phase_change`,
  the strip shows no "Next" row, and the history fact is the band's sentence, not "New
  objective: …" (`02` §3.8).
- **A fallen boss.** `bossBar` / `bossHp` count a fallen boss as true, so the phase advances
  at the next check as usual; `onEnter` effects aimed at the boss (an `affix`, `unclamp`)
  are skipped, court orders still apply, and a pending signature is dropped (§5.1).

## 5. Signatures

### 5.1 The module

`engine/BossSignature.js` (pure). It runs in `02`'s check, in a slot **7b, after `phase`
and before `turn`** (§4.3; so a phase's `onEnter.signature` patch is read the same check),
for the living boss that carries `battleConfig.bossSignature`. Within the slot it first
resolves what is due, then plans the next:

```js
resolveSignature(world, boss, signature, state, turn) // → effects applied at the check of T+1 from state.pending, never re-planned
planSignature(world, boss, signature, state, turn)   // → { tell, due } or null: decides at the check of T what resolves at T+1
signatureView(state, signature, knowledge)           // → the tell for the board, the strip and the inspect line
```

- **State** rides battle state as `bossState.signature: { pending, firedTurns, count,
  marked }` (`captureBattleWorldState`, the Vision snapshot, the validator) from the first
  PR (README §3). A resume shows the same outlined tiles and resolves the same effect; a
  rewind past the tell forgets it. A boss that falls with a tell pending drops it (no
  resolve; the history says the tell ended with him).
- **Cadence** is a `turn` clock in `02`'s sense: `{ afterContact: n, every: k, latest: {
  parOffset } }`. It counts from contact (`02` §3.4's `contactTurn`) with a par-relative
  `latest` (`02` §2.1: nothing that taxes the turtle is contact-relative without one), so a
  turtle meets the first signature by `latest` whatever they do. `latest` is validated
  ≤ `parOffset −2`, so the first resolve lands before enrage (≥ par + 1, `02` PR 0a).
- **Tell first, always.** A signature plans at the check of turn T and resolves at the
  check of T+1, at the top of that enemy phase, before any enemy acts. The player's phase
  of T+1 sits between. The tell is drawn on the board through `02` §3.8's outline layer (a
  second dash style and a new `UI_PALETTE` token; the Entity's splash text uses
  `rarityEpic` today), named in the strip's boss row ("The Calculation · next enemy phase ·
  3 tiles") and in the boss's inspect line, and gets a warn band at the check that plans
  it. Two asks of `01` (Notes for the README): its pointer priority (§2.8: the boss is third)
  promotes the boss to first while a tell is pending, and its enemy-phase beat table
  (§2.7) gains a row, "signature resolves: the affected tiles the player can see".
- **RNG.** A signature that needs a draw (which tiles among equals, which flank) uses
  `keyedBattleRandom(battleSeed, 'boss-sig:<turn>:<n>')`, never `Math.random` (the
  Necromancer's raise is the precedent: a resume or rewind replays it).
- **Fog.** A tell is drawn only where the player sees the boss or the tiles; a hidden
  tell is told in words without a position ("The Archmage reads the field"), as a hidden
  `sight` wake is (`02` §3.8).

### 5.2 Kinds in v1

Each kind is built from one existing system and is what the scene and the harness both
call. Nothing here adds a combat rule.

| kind | what it does | built on | fairness |
|---|---|---|---|
| `court_order` | at the tell, a named court group is given new orders (`guard` an anchor, with an optional `guardRadius`; `seek` an anchor `then` `hunt`; `hunt` with `together`; `ignoreEnrage: false`) and acts on them from the resolve. On a `dormant` or `patrol` group this is its wake with that `onWake`; on an `awake` group it rewrites the members' `aiMode` / `guardPost` / `aiTargetTile` through the same writer (a re-order: new, since `02` §3.3 applies `onWake` once) | `02` §3.7 `onWake` shapes (`hunt`, `guard`, `seek` with `then: 'hunt'`), `seek_tile` / `guard` AI modes (`02` PR 2.4) | the court's new posts are outlined at the tell |
| `aura` | at the resolve, court members within `radius` of the boss take a timed buff (`stat`, `value`) for one turn: an entry from `resolveTimedBuffExpiry(boss, T+1, 1)`, expiring as the next enemy phase starts | `applyTimedBuffEntry` (`TimedWeaponArtBuffs.js:31`), the Road Mark's one-turn MOV entry (`MarkSystem.roadBuffEntry`, `:135`); badge from `StatusBadges` | the buffed units show the badge; the forecast reads the buffed stat (`timedBuffCombatMods`, `:162`, already feeds combat) |
| `affix` | the boss takes or drops an affix at a phase's `onEnter` (not cadenced). The rung's `excludedAffixes`, the class exclusions and the mutual table hold (`AffixEngine`'s private `isAffixAllowed`, `:41`, exported for this through a `kitAffixAllowed` helper); the rung's `tierPool` governs rolled affixes, not authored ones, except on First Light (tier 1 only, §9.5). An affix the rules refuse at compile (a Sworn `regenerator` beside a kit's `shielded`: `affixes.json` makes them mutually exclusive) is left out of the locked config and its band word with it. A boss rolls no affixes (§1.1), so it carries at most its Sworn affix plus the kit's | `unit.affixes`, serialized; one mid-battle applier (`AffixSystem`) that also applies a spawn-time stat (`haste`'s MOV, `getAffixMovBonus`), in the scene and the harness alike (§1.5's gap); `updateAffixPips` draws the pip; the affix tooltip explains it. `regenerator` given at the check of T first heals at T+1 (turn-start effects run before the check) | the band names the affix and what it does |
| `volley` | at the tell, `tiles` tiles are fixed: the tiles under the `tiles` player units nearest the boss (Manhattan, ties on the keyed stream). At the resolve, every player-side unit standing on a fixed tile takes `max(0, MAG + Mt − RES)`, Mt the named siege tome's (`weapon`, read from `weapons.json` by name and locked in `bossSignature`; the boss never carries it, so its AI and `SiegeArtillery`'s stance never see it) and MAG the boss's (or, with `source: <group>`, the highest MAG among that group's living members), through `damageUnitDetailed` (no hit roll, no counter, no XP, no art, no skill proc; Miracle is a combat skill and does not apply, as with area damage). `lethal: false` passes `floor: 1`; the commander is always floored at 1 (§2) | `weapons.json` `Breachbolt` (Mt 8, the one siege tome, `siegeWeaponConfig.weaponName`; First Light has no `siegeWeaponConfig`, which is why the kit names the weapon itself), `UnitHealth.damageUnitDetailed` | the tiles are known a whole player phase ahead and the forecast's threat line shows the figure ("Volley: 14") on them; stepping off is the counter |
| `unclamp` | the boss's per-unit `clampTile` is released (`clampTile: false`, an explicit release: `03` PR 1b falls back to `thronePos` on seize when the field is absent) and it hunts with its court, `together`; or it returns: `seek_tile` to the throne, and the signature module writes `clampTile` again at the first check it stands within 1 of it (a clamp set far from the throne would freeze it: the clamp keeps only tiles within 1, §1.3 item 6) | `03` PR 1b's `clampTile`, `02` §3.7 `seek` | the band says it; the boss's Danger zone grows the next player phase and is drawn like any |
| `terrain` | `setTiles` at the resolve (a door closes, a postern opens) | `TerrainPhases.applyTerrainSetTiles` (`02` §2.2); never under an occupant (recorded and skipped, as `03`'s phases do) | the target tiles are outlined at the tell |
| `wave` | a triggered wave fires at the resolve from `side: anchor:<name>` | `02` §4 `triggeredWaves` | the warn band names the edge and the turn, as every triggered wave does |
| `mark` | the boss answers the blade that touched it: `bossState.signature.marked` is the uid of the last player-side unit whose strike damaged it (noted where `02` notes hostile exchanges, `world.noteHostileExchange` in `PostCombatEffects`, the `02` PR 2.2b site the scene and the harness both drive; the prologue's `damagedBy` ledger is `PrologueController`'s own and is not it). The boss's target scoring gives the marked unit +60 (above the caravan's +40, `AIController.js:1297`). It is not an affix `aiOverride`: `_hasAiOverride` (`:1424`) reads only `affixes.json` entries (`berserker`'s `target_lowest_hp`), so `_scoreAttackTarget` reads the mark from the `bossState` the AI is handed, never a private unit flag | `_scoreAttackTarget` (`:1263`) | the marked unit wears a badge and a line between it and the boss; whoever strikes last chooses who he comes for |
| `foretell` | the Lieutenant alone (§8.1): during the player phase the boss's next decision is previewed against the board as it stands and redrawn after every player action (his move tile and target). It is a view, not a pending effect: nothing is saved, and when his phase comes he decides as any enemy. Offered only on fog-free maps (validated): the AI reads every unit | `AIController._decideAction` through a new non-mutating `previewDecision` (it must not write `guardPost` (`:296`), `weapon` (`_equipUsableWeapon`), `_aiNoMoveStreak` (`:1048`) or `_lastAiDecision` (`:155`): a guarded copy of the inputs) | the player is shown exactly what he would do if nothing else moved; moving changes it |
| `echo` | the Entity alone (§8.2): held pillars reduce its splash | `EntitySystem` (new helpers) | a held pillar is a lit tile |

Kinds this revision leaves out, and why: a boss that teleports (the `teleporter` affix
already exists and may be given by `affix` from Dusk up, where the rung's `excludedAffixes`
allow it; First Light excludes it), a boss that heals its court (a Cleric court member in
its heal role does it), a boss with a weapon art of its own (`EnemyAreaArts` exists for
elites, `enemies.json` `eliteAreaArts`; adding one to a boss is a data line in the kit's
loadout, not a signature), and anything that moves a player unit on the enemy phase outside
a strike (a signature that shoves is `aoe-weapon-arts.md`'s to add).

### 5.3 How a kit reaches the unit

`EnemySpawnGear.applyEnemySpawnGear` already turns spawn flags into unit fields (stones,
carried items, siege tomes). A compiled kit writes on the boss spawn `bossKit: { id,
version }` and `clampTile` (the throne, or the kit's post: the Iron Wall's gate), and on
court spawns `encounterGroupId`. It writes no weapon: a `volley`'s tome lives in
`battleConfig.bossSignature` (§5.2). The scene and the harness build units from spawns
through the same function (`BattleScene.js:2624`, `HeadlessBattle.js:945`), so neither keeps
a copy.

## 6. Bonus objectives on boss maps

- **Every boss map may carry one bonus from its kit** (`MAX_BONUS_OBJECTIVES` 2 still
  holds with a derived village or caravan), authored in the kit (procedural maps and v1
  arenas) or the set piece. `03` §7.2 keeps ordinary procedural maps to the derived village
  and caravan in v2 (its open question 5); this spec asks that boss nodes be the exception
  (Notes for the README). `03`'s rules hold unchanged: judged once at the victory commit,
  never XP, never a `slay` on a primary's target or a throne's guard (`'@boss'`: any
  `isBoss`; `04` §8.2 check 9), the cost in turns on the strip. None on a scripted battle.
- **Kinds that fit a boss map:** `reach` (a cache in the court: the Iron Captain's
  strongbox, the Archmage's middle pages), `claim` (a ballista on the wall, only where
  `MapGenerator` placed one: Nightfall+, not Act I), `unbloodied`, `slay` a court captain
  (never `isBoss`), and a new deadline form `deadline: { signatureCount: n }` (done before
  the boss's n-th signature resolves: "Take the pages before the second Calculation";
  failed at the check where it resolves), locked at generation as an integer of signatures
  and shown as such. `03` §7.1 gives a deadline only to `slay` (`byTurn`); a `reach` or
  `claim` with a `deadline` (`signatureCount`, or `byTurn` locked as `par − k`) is this
  spec's extension (Notes for the README).
- **Vision.** `03` §7.4's `vision: 1` reward is allowed (owner decision): Act III and later,
  at most once per act (`run.bonusVisionActs`), never on First Light (`03` §7.4: "none on
  First Light"; §9.5 keeps it so although First Light boss maps now carry bonuses). This
  spec offers it only on boss-map bonuses (`03` allows any Act III+ bonus; the boss-only
  choice is §13 Q3). The reward is a seeded choice at generation
  (`keyedBattleRandom(battleSeed, 'bonus-reward:<id>')`, `objectives.json`
  `bonusRewards.visionOffer` 0.5): half the offers on Dusk+ Act III and IV boss maps are
  `vision: 1`, half the kind's default gold plus item. The choice is resolved before the
  config is locked, so the locked `reward` is one plain `03` §7.4 key, which `03`'s
  validator accepts; when `run.bonusVisionActs` already holds the act at generation (an
  ordinary set piece paid one), the offer is the gold-plus-item side. The strip says which
  before the first move ("+1 Vision" or "+500 G · Elixir"). Why boss maps: the act boss
  already pays a charge at the commit (`RunManager.js:4316-4328`), so Vision is the
  currency the player expects to see there; a bonus charge is a second one for the next
  act. **The finale:** nothing `03` §7.4 can pay (gold, an item, a forge step, Vision)
  outlives the last battle, and gold is not converted at the run's end (§1.4:
  `calculateCurrencies` reads acts, battles and victory only). So a finale bonus is a
  **feat**: it pays no reward, the victory band names it, and the run's records keep it
  (`RunRecords`, a new `bonusFeats` list). A reward-less bonus is an extension of `03`
  §7.4 (Notes for the README); §13 Q9 asks whether the finale should carry one at all.
- **The never-XP rule holds.** A bonus pays through `BonusSettlement`, never the loot
  screen (`03` §7.3), so the +1 Vision is a plain `visionChargesRemaining + 1` beside the
  boss's own, both in one `completeBattle`, both rolled back together by a revert.
- **Deadlines and tells agree.** A `signatureCount` deadline reads
  `bossState.signature.count`, which the signature module increments at each resolve, so
  the strip's "before the second Calculation" and the board's tell cannot disagree.

## 7. Per boss: the kits

Each kit names its phases, signature, court, arena, bonus, beats and music. "Half" means
the `bossBar broken: 1` trigger with `bossHp below: 0.5` as its fallback (§4.3): a bar
break on Nightfall and Black Sun, the half-HP point on First Light and Dusk. Court sizes
follow `02` §5.1's budget (the court is a partition of today's count; awake-at-start ≤ the
base). Lines are content keys in `dialogue.json` `bossEncounters.<boss>.phases` and
`src/data/bossKitContent.js` (bands, tells, inspect lines), under the lore style guide
(boss lore ≤ 240 characters; the loop: "bosses half-remember dying").

### 7.1 Act I

**Iron Captain**, Warden of the Unrelieved Line (Cavalier).
- *Court:* `line` (40% nearest the throne, `awake`, `guard` the `gate` anchor: they hold
  the mouth of the approach, not the throne), `rest` (`awake`, hunt).
- *Phase 1 "The Line":* the court holds the gate; signature `aura` **Hold the Line**
  (cadence `afterContact 1, every 2`): court members within 2 of the gate take +2 DEF for
  one turn. Tell: the gate tiles and the badge.
- *Half ("Fall back and REFORM!"):* `court_order`: `line` seeks the throne, then guards it;
  the Captain takes `anchored` (+2 DEF on the Throne, no pushes). Band: "The line reforms
  around him."
- *Arena:* `act1_border_post`, the palisade gate north or south of the throne.
- *Bonus:* `reach` the dispatch (a Fort tile in the court: his sealed orders, the item the
  `defeat` lines already describe) → the act's gold plus item. Cost about 1 turn.
- *Why it teaches:* the first boss a new player meets has one readable idea (a line that
  holds, then closes ranks) and nothing that strikes from afar.
- *First Light:* as written; the aura is +1.

**Warchief**, Breaker of the Old Treaties (Fighter).
- *Court:* `clan` (a `dormant` pod on `flank:n` or `flank:s`, a keyed choice; wake
  `danger`, `hurt`, `groupWoken: throne_guard`), `throne_guard` (`awake`, guard the
  throne).
- *Phase 1:* the clan sleeps on the ridge with its outline drawn from turn 1 (`02` §3.8).
- *Half ("the axe remembers"):* **War Cry**: the clan wakes (`onEnter.court`), the Warchief
  takes `berserker` (+5 ATK, −3 DEF, targets the weakest nearby) and drops his clamp
  (`unclamp`): he comes down from the throne. Band: "The clan answers."
- *Signature:* none cadenced; the half is the signature. (Two Act I bosses, one with a
  cadence and one without, so the first act shows both shapes.)
- *Bonus:* `unbloodied` (no unit below half) → gold. The Warchief's war cry is exactly what
  breaks it.
- *First Light:* the clan is 2 and wakes a phase later (`delay 1`), so the warn band is
  seen before it moves.

### 7.2 Act II

**Knight Commander**, First Lance of the Second Push (Paladin).
- *Court:* `wedge` (3–4 cavalry picks, `dormant` behind the throne, wake `groupWoken:
  commander` or the cadence), `field` (`awake`).
- *Signature `court_order` + `unclamp`* **The Second Push** (cadence `afterContact 2,
  latest parOffset −3`): at the tell the wedge's charge lane (the `apron` tiles nearest the
  army's centroid) is outlined and the band says "The second push forms"; at the resolve
  the wedge wakes `hunt` `together` and the Commander drops his clamp and rides with it.
  He is a Paladin off his throne: the player holds a chokepoint or baits him onto a Fort.
- *Half:* he returns (`seek` throne, then clamp) and takes `shielded` (the first hit each
  player phase does 0): the doctrine's casualty tables. Band: "He has read the tables. Back
  to the throne."
- *Arena:* `act2_doctrine_yard`, the wall's two gaps.
- *Bonus:* `slay` the wedge's captain (a Paladin court member, `objectiveRef`, never
  `isBoss`) before the second push resolves (`deadline: { signatureCount: 1 }`) → gold +
  forge step.

**Archmage**, Keeper of the Middle Pages (Sage).
- *Court:* `circle` (40%, `dormant` around the throne, wake `danger`, `hurt`; the mages
  among them keep their class), `field`.
- *Signature `volley`* **The Calculation** (cadence `afterContact 1, every 3, latest
  parOffset −4`, 3 tiles, a Bolting-class siege tome from the rung's siege config): "he
  reads the field" — the tiles under the three nearest player units are fixed at the tell
  and struck at the resolve. First Light and Dusk: `lethal: false`.
- *Half ("corrected a semitone"):* the cadence becomes `every 2`; the circle's mages plant
  (`SiegeArtillery` stance) where they stand. Band: "The calculation is corrected."
- *Bonus:* `reach` the lectern (the middle pages, a Fort in the court) before the second
  Calculation (`deadline: { signatureCount: 2 }`) → Act II's item (a tome).
- *Why it is the first volley:* Act II, a 3-tile volley told a full phase ahead that cannot
  kill on the intro rungs: the player learns to read outlined tiles before the Entity's
  splash.

**Dark Rider**, Bearer of the Sealed Orders (Dark Knight).
- *Court:* `escort` (2, `patrol` on `[throne, gate]` with him), `garrison` (`dormant` at
  the throne).
- *Phase 1 "The Road":* the Rider is not clamped. He and his escort are a `patrol` group
  (`02` PR 2.4) between the throne and the gate: the road empties ahead of him. His group
  wakes to `hunt` on `danger` / `hurt`.
- *Signature `wave`* **Sealed Orders** (cadence `afterContact 2, latest parOffset −3`,
  once): the orders are read: riders arrive at the gate's edge (`side: anchor:gate`, 2–3,
  `xpMultiplier 0.5`). The warn band names the edge and the turn.
- *Half:* `seek` the throne, then clamp; the garrison wakes. Band: "He rides for the throne.
  The orders are delivered."
- *Bonus:* `slay` him on the road: not allowed (he is the boss). Instead `reach` the
  dispatch rider's post (a Fort on the road) before the orders are read
  (`signatureCount: 1`) → gold + item: the sealed orders themselves, intercepted.
- *Engine note:* a boss in a `patrol` group needs the clamp gate `04` §10.4 already asks
  for the Parade ("the clamp skips a member of a `patrol` group until its column reaches
  its last anchor"); the Rider is its first and cheaper user (one boss, one route). If
  `02` PR 2.4 is not in, the Rider ships on the throne with the wave and the half only.

### 7.3 Act III

**Blade Lord**, Proof of the Dueling Halls (Swordmaster).
- *Court:* `hall` (`dormant`, `ignoreEnrage` until the half, wake `hurt` only), `field`.
- *Signature `mark`* **The Perfect Duel**: he answers the blade that touched him. The last
  player unit to strike him is marked; he goes for it. The court holds: a duel is formal.
  Tell: the badge and the line. Counterplay: choose who strikes last; a General can take
  his two clipped strikes, a Myrmidon cannot.
- *Half ("the sacred ground keeps no forms"):* the court wakes (`ignoreEnrage` off, `hunt`
  `together` on the marked unit); he takes `haste` (+2 MOV) and drops his clamp. Band: "No
  forms. The hall empties onto the floor."
- *Arena:* the keep (`act3_dark_champion_keep`) is already his: its variants (§4.4).
- *Bonus:* `unbloodied` → Vision or gold (§6's `oneOf`).
- *Music:* the half plays his card cue again over the ducked theme (§7.6).

**Iron Wall**, Holder of the Breach (General).
- *Court:* `wall` (50%, `awake`, `guard` the `gate`: they stand in the breach with him),
  `posterns` (`dormant`, wake on the half).
- *Phase 1 "The Breach":* he and the wall hold the gate (the Wall's clamp is the gate, not
  the throne: `clampTile: gate`; Seize still needs him dead). Signature `aura` **Doctrine**
  (`every 2`): wall members adjacent to him take +3 DEF.
- *Half ("the order never came"):* `terrain`: two posterns open (`flank:n`/`flank:s` tiles
  nearest the wall, Wall → Floor, outlined from turn 1 as "sealed posterns"); the `posterns`
  group wakes and sallies through them (`seek` the army's nearest flank anchor, then hunt):
  two fronts. He falls back to the throne. Band: "The posterns open."
- *Bonus:* `claim` the gatehouse ballista (Nightfall+, where ballistae roll) → Vision or
  gold; on First Light and Dusk, `reach` the armoury in the court → gold + item.
- *Set piece:* Long Road to the Keep prefers him (§8.3).

**Berserker King**, Crowned by Frightened Acclaim (Berserker).
- *Court:* two pods, `clan:n` and `clan:s` (`dormant` on each flank, wake `danger`, `hurt`
  and `groupWoken` of the other with delay 1: hurt one and the other comes).
- *Signature `aura`* **Acclaim** (cadence `afterContact 1, every 3`): every court member
  within 3 of him takes `haste` (+2 MOV) for one turn: the clan surges. Tell: the badge on
  each, the band "The acclaim rises."
- *Half ("the corruption changed nothing"):* he takes `berserker` and `unclamp`s; the aura
  becomes `every 2`. Band: "He leaves the throne. Nobody objects."
- *Bonus:* `slay` the clan's chief (a Warrior court member) before the first Acclaim →
  gold + forge step.

### 7.4 Act IV: The Emperor

The Emperor, Who Sold the Empire's Future (General; stones 1 / 1 / 2 on Dusk / Nightfall /
Black Sun). Every Act IV run fights him, and on Dusk it is the last battle. His kit is the
one with three acts.

- *Court:* `imperial_guard` (`dormant` at the steps of the throne, wake `bossBar broken 1`
  or `hurt`), `household` (`awake`, guard the throne), `gate` (Nightfall+, a triggered wave
  at the gate, `bossBar broken 2` with fallback `bossHp below 0.25`).
- *Phase 1 "The Arithmetic":* he holds the throne with the household; signature `affix`
  **Held the Dark Back**: `shielded` on his first bar (the first hit each player phase does
  0). Readable: the player leads with a weak hit.
- *Bar 1 breaks ("behold what I kept for myself"):* the imperial guard wakes; `shielded`
  is dropped; the arena changes: the bastion's firing lane walls (the v1 overrides, now a
  phase `setTiles`) rise behind the army's forward units (never under one). Band: "The
  guard he kept for himself."
- *Bar 2 (Black Sun) / last bar:* the gate wave; he takes `regenerator` (20% at each enemy
  phase start) for the last bar and the music goes to the enrage layer (§7.6): the last bar
  is a race. Band: "The arithmetic runs in his favour."
- *Bonus:* `slay` the standard-bearer (`04` §10.4's General, `objectiveRef`) before his
  first bar breaks (`deadline: { signatureCount }` does not fit; this one is `byTurn` =
  the par-locked `par − 3`) → Vision or gold.
- *Arena:* the bastion's variants; the Parade (§8.4) and the Battery (§8.6) as set pieces.
- *Dusk:* one stone, so bar 1 is the only curtain: the guard wakes on it, and the last-bar
  effects fold into the same phase (the validator collapses phases whose triggers coincide
  on a rung into one `onEnter`, in order).

### 7.5 The finale

See §8.1 (the Lieutenant) and §8.2 (the Entity).

### 7.6 Beats, music and presentation shared by every kit

- **The card** gains a third line under the epithet: the signature's name and one plain
  sentence ("The Calculation: reads the field, then strikes where you stood"). The Entity's
  card stays `· · ·`.
- **Phase bands** reuse the ceremony band (`03` §6's NEW OBJECTIVE style, word by phase:
  "THE LINE REFORMS", "NO FORMS", "THE POSTERNS OPEN"); the `halfHealth` line keeps its
  timing (at once) and the band plays at the check. A kit's phase line in
  `bossEncounters.<boss>.phases.<id>` follows the `halfHealth` shape (`base`, `variants`
  by `bossKilledYouBefore` / `bossSlainBefore` / `commander`), so the loop's memory reaches
  the new lines too.
- **The bar** draws a thin phase tick per phase under the stones (a kit with two phases:
  one tick at the trigger's HP share when it is `bossHp`, at the stone when it is
  `bossBar`), so the player sees where the fight changes. `summaryLine` adds the pending
  tell ("· Calculation next phase").
- **Music.** Turn enrage keeps the enrage layer. A kit's phase may say `music: 'card'`
  (replay the boss's card cue, `BOSS_CARD_CUES`, over the ducked theme: "his motif
  returns") or `music: 'enrage'` (the enrage layer from here: the last bar of a stone boss
  defaults to it, since the enrage layer is already "this boss, cornered",
  `SCORE.md:126-143`). `BattleMusicController.onBossPhase(kind)` is the one entry; the
  Entity ignores it (its finale is its second act). No new scores.
- **History words** (`02` §3.8's table): "The Calculation falls on 3 tiles.", "The
  posterns open.", "The line reforms.", never a hidden position.
- **Guidance.** One new essential note, `guide_boss_tell`, at the first pending tell on a
  slot: "The boss has shown its next move. The outlined tiles are where it lands next
  enemy phase; anything standing there takes it." Once per slot, never in the prologue.
- **Camera** (`01` §2.7): the tell's tiles are a beat subject at the check; the phase band
  pans to the phase's anchor (`03` §6 step 4).

## 8. Set pieces and the finale

### 8.1 The Lieutenant (First Light's finale; no set piece)

First Light gets no set piece, and the Lieutenant is fought only there, so his fight is
enhanced on `eldritch_sanctum` as it stands.
- *Signature `foretell`* **The Far Side of the Glass**: at each check his next decision is
  shown (the tile he will move to, the unit he will strike). "I have watched you win this
  fight a hundred ways." Nothing is locked: he decides afresh when his phase comes; the
  forecast is true only if the board does not change. The player reads it and moves the
  threatened unit, or feeds him the one that can take it. It is the only signature that
  costs no HP and still changes every turn of the fight.
- *Half ("every future you could reach"):* the sanctum's T7 wave is replaced by a `bossHp
  below 0.5` wave with `latest: { turn: 7 }` (the same wave, now answering the wound, never
  later than today); T4 and T10 stay absolute (First Light's par clocks). Band: "He has
  seen this one."
- *Sera:* the `halfHealth` exchange already answers him (Sera's violin answers his line in
  the last strain, `SCORE.md:122`); a `variants` entry when Sera is on the field and below
  half ("You always did prefer the far side of the glass") joins the phase line.
- *Bonus:* `unbloodied` → gold (the run ends here).
- *Engine:* `previewDecision` (§5.2) is the one AI change; everything else is data.

### 8.2 The Entity (Nightfall, Black Sun)

The hinge, the finale track, the hum's HP contract and the rally are not touched. What is
added sits beside them.
- *Echo pillars.* `eldritch_sanctum` gains four anchors `echo_1..4`: the Floor tile nearest
  the Entity on each side of the four pillars closest to its footprint (derived on the
  fixed-size template, so they are the same every run). A pillar is **held** while a player
  unit stands on its tile at the check. Each held pillar quiets one echo:
  - the Entity's splash count is `ENTITY_SPLASH_COUNT − held` (floor 0;
    `EntitySystem.entitySplashCountFor(held)`, read by `_applyEntitySplash` and the
    harness alike);
  - the hum's gain is `entityHumGain(ratio) × (1 − 0.15 × held)` (presentation; the HP
    term is unchanged, so a resumed battle restores the same level from positions).
  A held pillar is lit (a marker, `01`); a pillar lost when its unit steps off goes dark at
  the next check. Standing on a pillar is standing within the Entity's reach: the price is
  the point.
- *Stages* (`bossHp` phases, both rungs): at 2/3 the first echoes arrive (the T4 wave
  becomes `{ kind: 'bossHp', below: 0.67, latest: { turn: 4 } }`), at 1/3 the second (T7,
  `latest: { turn: 7 }`); T10 stays absolute. The waves now answer the wound and never come
  later than today. Band words only: "The echoes answer." The hum already tells the rest.
- *Bonus:* `claim` two of the four pillars at once (held at the same check) → gold (§6:
  no Vision at the finale). The rally is unchanged; a resumed finale with pillars held
  opens on the finale as today.
- *Black Sun:* the **Sanctum of Echoes** set piece (§8.7) at `04`'s 0.5 finale share;
  Nightfall keeps the sanctum with the above (`04` open question 7 answered: Black Sun by
  default, Nightfall if the owner wants it).

### 8.3 Long Road to the Keep (Act III boss, 22x14, refined)

`04` §10.3 stands. Refinements from the kits:
- **The boss.** The set piece prefers the Iron Wall (`boss: { weights: { 'Iron Wall': 3,
  'Blade Lord': 1, 'Berserker King': 1 } }`, drawn on `'setpiece:<id>:boss'`; the
  procedural `Math.random` boss pick is skipped on the set-piece path). The keep is the
  Holder of the Breach's map; the other two can hold it.
- **The drawbridge drops on the sally's trigger or on the half**, whichever comes first
  (`until: oneOf [groupWoken outer_camp delay 1, turn parOffset −4, bossBar broken 1 /
  bossHp 0.5]`): breaking his first bar from the postern side opens the gate behind you.
- **The posterns are the kit's:** his half opens them (`terrain`) and the sally comes
  through them, so the map's sally and the kit's posterns are one group with two routes
  (a keyed choice: N or S).
- **Bonus:** `claim` the gatehouse ballista (Nightfall+; it covers the moat) → Vision or
  gold (§6); Dusk: `reach` the armoury → gold + item.
- Estimate 10–11 plus the stone on Nightfall+ (`04` §10.3).

### 8.4 The Emperor's Parade (Act IV boss, 24x14, refined)

`04` §10.4 stands. Refinements:
- **The bars are the phases.** `seated` (the column reaches the throne: `tile by: group`)
  arms his clamp and `shielded`; **bar 1** wakes the palace guard (`04`'s `dormant` palace
  group becomes the kit's `imperial_guard`) and raises the parade ground's barriers (the
  Parade's `setTiles`: the market's stalls become Wall on two tiles, never under a unit);
  **bar 2 / last** fires the gate wave (already `afterContact 3` on Nightfall+; on Black
  Sun it is the bar instead, `latest` the same clock) and the enrage layer.
- **If he is caught on the avenue** (intercept plan): the column is his court; `seated`
  never fires; bar 1 still wakes the palace guard, who come down the steps to him
  (`seek` the column's current tile is not a thing: they `hunt` `together`).
- **Bonus** stays the standard-bearer `slay` by turn 4 (`04`), with Vision as its `oneOf`
  reward on Act IV (§6).
- `04` open question 5 (always the Parade on Dusk?): recommend **no**. Dusk's final battle
  should be the kit on whichever map comes, so a Dusk player who never rolls the Parade
  still meets the Arithmetic.

### 8.5 The Dueling Halls (Act III boss, 22x12; a boss that moves between arenas)

```
macro grid (cols 7|8|7, rows 6|6)         combination: doors north, the proof in hall 2
+--------+----------+--------+            #######..######..#######
| hall1  |  hall2   | hall3  |            #_____#..#____#..#_____#   G = the throne (hall 3)
| deploy |  proof   | throne |            #_p_p_#__#_pp_#__#_p__G#   __ = the doors (2 wide, Floor)
+--------+----------+--------+            #_____#..#____#..#_____#   p = pillars
| yard1  |  yard2   | yard3  |            ##_#_##..##__##..##_#_##   the yards: open ground
| fill   |  fill    | fill   |            .......F........F.......
+--------+----------+--------+            ....F......T.......F....
deploy: hall 1 (cols 1-5, rows 1-4)       .F.......F......T.......
                                          ........................
```

**Decision.** He comes to you. The Blade Lord walks from hall 3 through hall 2 toward the
army (a `patrol` group of one, `loop: false`, route `[hall3_door, hall2, hall1_door]`;
the clamp gate for a marching boss, `04` §10.4). Each hall's court is `dormant` with
`ignoreEnrage` until the half and wakes only on `tile by: { group: blade_lord }` on its hall
anchor: the duel passes through, the hall empties behind him. Fight him in hall 1's
doorway (a chokepoint, his two strikes on one unit at a time), or in the yard (open ground,
your cavalry, his `haste` later).
- **The twist.** On the half he turns back (`seek` the throne, then clamp) and **the doors
  close behind him** except one (`terrain`, a keyed choice: hall 1's north or south door
  stays open; `TerrainPhases` never closes a door under a unit, and a unit in a doorway
  holds it open: that is the counter). Every hall's court wakes. The army crosses the yards
  or the one open hall to the throne.
- **Groups:** his group (1), hall courts 2 / 2 / 3 (`dormant`), a yard picket (2,
  `picket`) so the yard is never free.
- **Choices:** doors N/S (mirrorY); which door stays open; which hall holds the proof (the
  bonus); pillar variants per hall. 8 combinations.
- **Bonus:** `reach` the proof (a weapon on a Fort in hall 2, before the half:
  `deadline: { signatureCount }` does not apply to `mark`; it is `byTurn` par − 3) → Vision
  or gold. It lies before the last target on every combination (check 9: the throne is
  past hall 2).
- **Estimate:** 9–11 (scratch assembler, Nightfall counts: 2 turns to the doorway, the
  duel 3–4, the walk to the throne 3, the stone). Needs `01`'s desktop camera (22 wide).
- **New vs reused:** `02` patrol (PR 2.4), `tile by: group`, `03` phases, `TerrainPhases`,
  the kit's `mark`. New: nothing beyond the clamp gate the Parade needs.

### 8.6 The Battery (Act IV boss, 24x14; a siege where the boss commands artillery)

```
macro grid (cols 8|8|8, rows 5|9)          combination: south stair, west ballista live
+---------+----------+---------+            ########################
| wall W  | the wall | wall E  |            #..B....#_G_#......B..#   B = ballista emplacements
| ballista| throne   | ballista|            #_______#___#_________#   G = the Emperor on the wall
+---------+----------+---------+            ###_#######_######_####   _ in the wall line = the stairs
|         |  the     |         |            ......................   (N stair always; S stair a choice)
|  field  |  field   |  field  |            ...F.......T.....F....
|  deploy |          |         |            ..........,,,.........   , = the ditch (Bog)
+---------+----------+---------+            .T.....,,,,,,,,,......
deploy: cols 0-7, rows 9-13                 .....,,,,.....,,,,,...
column of fire: the battery's tells         ......................
```

**Decision.** The wall fires on you every other turn and you can see where. Cross the ditch
under it, take a stair, and turn its engines on the court; or sit back and lose turns to
the clock. Two stairs (two fronts, pillar 4): the near one is a choke the household holds;
the far one is longer and empty until the battery's mages come down.
- **The Emperor's signature here is `volley`** (`signatureOverride`, allowed on a set piece
  that pins the boss): **The Arithmetic, applied**: cadence `afterContact 1, every 2`, 3
  tiles, the rung's siege tome, fired "by the battery" (the tell names it). His `shielded`
  bar and the guard-on-bar-1 stay from the kit.
- **Engines.** Two ballistae (`04` §3.2 anchors with `feature: 'Ballista'`; Nightfall+ as
  today's rule, so the Battery is Nightfall+ only) are `claim` points: a claimed ballista
  fires for the player (`BallistaEngine` capture, as today). A `battery` court group of 2
  Sages with siege tomes planted on the wall (`SiegeArtillery` stance) fires like any
  siege caster; the kit's volley is on top of them, so the tell is what the player watches.
- **Phases:** `bombard` (contact) → `breached` (`tile` on either stair top by a player
  unit: the household wakes and the battery unplants and comes down, `court_order` `hunt`)
  → the bars as in the kit.
- **Choices:** south stair present or walled; which ballista is live (the other is a
  broken emplacement, Floor); the ditch's crossing (one dry causeway N or S). 8
  combinations.
- **Bonus:** `claim` either ballista before the third volley (`deadline: { signatureCount:
  3 }`) → Vision or gold.
- **Estimate:** 11–12 (3 turns to the wall under two volleys, the stair fight 3, the throne
  3, two stones on Black Sun). The upper edge of the band: the ditch is Bog on purpose and
  the validator will tell us if it is one tile too wide.
- **New vs reused:** `03` `claim`, `04` ballista anchors, `SiegeArtillery`, the kit's
  volley. New: a siege tome in a court member's hands is today's `siegeWeaponConfig` roll
  made certain for a named spawn (`spawn.siegeWeapon: true` exists: `MapTemplateEngine`
  allows it on scripted spawns).

### 8.7 Sanctum of Echoes (finale, 24x16, Black Sun; refined from `04` §9)

- `defeat` the Entity (`03` §5.4; `isEntity` stays the one footprint rule) / `claim` 2 of 4
  pillars (§8.2's rule on a bigger floor).
- **Wardens:** one `dormant` pod per pillar (2 each), wake on `tile` of its pillar or
  `hurt`: holding a pillar means holding it against its warden.
- **Echoes:** the `bossHp` waves of §8.2 (thirds), `latest` the sanctum's turns, from the
  three far edges.
- **Approach chunks:** two of four pillars are **lit** at generation (a keyed choice, `04`
  §3.5): lit pillars are the ones that count for the bonus and the splash; the others are
  Pillar terrain. So the player reads which two matter from turn 1.
- **Estimate:** 11–12 (the walk 4, the Entity at 120 HP with the army's Act IV damage 6–7).
  Needs `01` in full (24x16).
- **Rung:** Black Sun only in v1 (`04` Q7). The hum, the hinge, the rally: unchanged.

### 8.8 Catalogue, this spec's additions

| Set piece | Size | Slot | Primary / bonus | Boss | New engine needs |
|---|---|---|---|---|---|
| Long Road to the Keep (refined) | 22x14 | boss III | seize / `claim` ballista or `reach` | prefers Iron Wall | none beyond `02`/`03`, the kit |
| The Emperor's Parade (refined) | 24x14 | boss IV | seize / `slay` the standard-bearer | the Emperor | the marching-boss clamp gate |
| The Dueling Halls | 22x12 | boss III | seize / `reach` the proof | prefers Blade Lord | the same clamp gate; `02` patrol |
| The Battery | 24x14 | boss IV, Nightfall+ | seize / `claim` a ballista | the Emperor | a named siege spawn |
| Sanctum of Echoes (refined) | 24x16 | finale, Black Sun | `defeat` / `claim` 2 pillars | the Entity | `03` `claim`; the echo rule |

Deferred: an Act II boss set piece (The Second Push, 18x12: the Knight Commander's wedge
crosses one ford as the army crosses the other) is a good map, but README §2's bands give
boss set pieces to Acts III–IV and this revision keeps to that (§13 Q6).

## 9. Fairness and readability

### 9.1 Telegraphing

- A signature is never a surprise: tell at the check of T, resolve at T+1 (§5.1). The one
  thing that happens without a prior tell is the half's band, and that answers the player's
  own blow (the `halfHealth` line plays at the blow, as today).
- Sleeping courts have their outlines from turn 1 (`02` §3.8); sealed posterns and closing
  doors are marked as what they are (`01` markers, kind `structure`).
- A `volley`'s figure is on the forecast's threat line for a unit standing in it, read from
  the locked siege tome and the unit's RES: no hidden numbers.
- A `mark` is a badge and a line; the unit detail says "Marked: the Blade Lord comes for
  this unit."

### 9.2 Phones

- The strip's primary row carries the boss line (`summaryLine` exists) and, while a tell is
  pending, the tell ("Calculation · next phase"); a tap pans to the tiles (`01` §2.8).
- Tells use the outline layer's second style, legible at 30 CSS px a tile; below that
  (`01` §2.11's bands) the dash is thickened as the Danger hatching is.
- A phase band is a band, not a dialogue: it never blocks input longer than the ceremony
  timing (`bossFelled` 1.8 s hold). Phase lines go through `dialogueOverlay` as the half
  line does today (auto-dismiss about 3 s).
- The boss card's third line is one sentence of at most 60 characters (9 px budget).

### 9.3 Par, enrage and the clock

- Par is `02` §5.2's; `03`'s `parAdjust` already counts one turn per stone. A kit's phases
  add **no par**: they change the court's posture and the arena, not the walk; the court is
  a partition of today's count, so S is unchanged on a procedural map. A `volley` can make
  a turn cost a heal; that is pressure, not a wall, and the sims (§11) must show the push
  median stays inside par − 4 … par − 2 on each kit.
- Enrage is untouched (`02` PR 0a: never before par + 1). A kit's cadence `latest` is
  always ≤ par − 2, so every signature has resolved at least once before enrage, and no kit
  gives the boss a second wind at enrage: the last bar's `regenerator` (the Emperor) is a
  bar trigger, which on a push comes before enrage and on a turtle is already lost ground.
- A bonus with `signatureCount` is a clock the boss sets; it is locked as an integer and
  the strip shows the count ("before the 2nd Calculation · 2 to go").

### 9.4 Stones, rewind and resume

- A bar break is the curtain (§3 principle 3). Rewinding past the break (Vision) restores
  the stone and the phase together: `objectiveState.phase`, the fired ledger and
  `bossState` all ride the snapshot (`03` §12, `02` §6, §5.1). The validator checks that a
  phase whose `until` is `bossBar broken n` is never current while the boss holds more
  than `max − n` stones.
- A pending tell survives a refresh exactly (it is state, not a recomputation); the volley
  resolves on the saved tiles even if the board around them changed, which is the rule the
  player was shown.
- Continue from Map reverts everything, as for any battle.

### 9.5 First Light

**Recommendation: First Light gets every non-set-piece enhancement.** Kits with `byRung`
`normal` entries (smaller courts, `lethal: false` volleys, auras one point lower, the
Warchief's clan a phase slower), the new Act I/II arenas and the arena share, the bars'
fallback phases at half HP, bonuses (gold and items; Vision only from Act III, and First
Light's Act III boss bonus may offer it). Why: these are the fights the most-played rung
spends the most time in, the kits are where a boss stops being a stat block, and the
tells are a kinder teacher than a set piece's sleeping pods. The set-piece ban is about
size and multi-objective load (`04` Q1), not about bosses having character. A `bossOnly`
hybrid template is a template, not a set piece: it carries no groups, phases or bonuses
of its own and fits the 640x480 canvas at zoom 1 (open question 1 confirms this reading).

## 10. Data model and modules

### 10.1 Data

- `enemies.json` `bossKits` (§4.1), validated by `engine/BossKitValidation.js` in
  `npm run validate:data`: every boss in `bosses` has a kit or is listed in `kitless`
  (the Entity's kit is the echo rule only); signature kinds known; `bossBar` triggers
  carry a `fallback` that is not itself `bossBar`; affix ids exist and are tier 1–2; court
  shares sum ≤ 1; a `volley` names a siege tome in `weapons.json`; a kit's bonus is
  `03`-valid and never a `slay` on the boss; `byRung` keys are rungs; content keys exist
  in `dialogue.json` and `bossKitContent.js`; lines ≤ 90 characters.
- `dialogue.json` `bossEncounters.<boss>.phases.<id>` (the `halfHealth` shape).
- `mapTemplates.json`: `arenaVariants` on `bossOnly` templates; `act1_border_post`,
  `act2_doctrine_yard`; `eldritch_sanctum` `anchors` for `echo_1..4` (fixed coordinates
  on the fixed size).
- `setPieces.json`: `boss: { weights }`, `signatureOverride`, `04`'s fields.
- `difficulty.json` `modes.<rung>.bossKits: { enabled, volleyLethal }` (every rung,
  validated; First Light `volleyLethal: false`). `constants.js` `BOSS_ARENA_SHARE` 0.75.
- `turnBonus.json`: nothing. `objectives.json` (`03`): `bonusRewards.visionOffer` 0.5 for
  boss-map bonuses on Act III+.

### 10.2 Config and battle state

| Where | Field | Written by | Read by |
|---|---|---|---|
| `battleConfig` | `objectives.phases` (kit phases), `encounterGroups` (courts), `anchors` (derived or chunk), `triggeredWaves`, `bossSignature` (resolved), `bossKit: { id, version }` | `BossKit.compile` at generation, locked | `03`, `02`, `BossSignature`, display |
| boss spawn | `clampTile`, `bossKit`, the signature's weapon | compile | `EnemySpawnGear` |
| battle state | `bossState: { version, signature: { pending, firedTurns, count, marked }, pillars: [ids] }` | `BossSignature`, the echo rule | checkpoint, Vision, validator, strip |
| `battleParams` | `arenaVariant` | node post-pass | `MapGenerator` hybrid overlay |
| run | `bonusVisionActs` (`03`) | `BonusSettlement` | the reward `oneOf` |

An old checkpoint without `bossState` derives it empty; a config without `bossSignature`
has no signature; a template without `arenaVariants` has one.

### 10.3 Modules

| Module | Role | Called by |
|---|---|---|
| `engine/BossKit.js` | `compileBossKit(kit, config, rung, deps)` → config fields; `deriveBossAnchors`; court partition; the rung collapse of coincident phases | `MapGenerator` (procedural and v1 arenas), `SetPieceGenerator` |
| `engine/BossSignature.js` | plan / resolve / view (§5.1); the kind table | `02`'s check in `BattleScene` and `HeadlessBattle`; the strip model; the inspect panel |
| `engine/EncounterTriggers.js` (`02`) | `bossBar`, `bossHp` kinds, slot 2b | — |
| `engine/EntitySystem.js` | `entitySplashCountFor(held)`, `heldPillars(positions, anchors)` | `_applyEntitySplash`, the harness, `BattleMusicController` (hum) |
| `engine/AIController.js` | `target_marked` override; `previewDecision`; the marching-boss clamp gate (`04` §10.4) | — |
| `ui/BossPresenceController.js` | phase ticks, the tell in `summaryLine` | — |
| `ui/BattleMusicController.js` | `onBossPhase('card' \| 'enrage')` | the phase band |
| `src/data/bossKitContent.js` | bands, tells, inspect lines, the card's third line, `guide_boss_tell` | ceremonies, strip, Guidance |

Harness parity (CLAUDE.md): `HeadlessBattle` calls `BossSignature` in the same check and
builds boss units through `applyEnemySpawnGear`; it keeps no copy of any kit rule. Its
`_applyDueHybridOverridesForTurn` is already deleted by `02` PR 0b.

### 10.4 Determinism

| Draw | Stream |
|---|---|
| arena variant, arena share | `keyedBattleRandom(runSeed, 'boss-arena…:<nodeId>')`, after the node map |
| a set piece's boss pick | `keyedBattleRandom(battleSeed, 'setpiece:<id>:boss')`; the procedural `Math.random` pick is skipped on that path only |
| signature draws (which flank, which tiles among equals) | `keyedBattleRandom(battleSeed, 'boss-sig:<turn>:<n>')` |
| bonus reward `oneOf` | `keyedBattleRandom(battleSeed, 'bonus-reward:<id>')` |
| court partition, anchors | no draw |

No existing stream gains a draw: a seeded run's maps are byte-identical apart from the new
fields, and a kit's affix at a phase is applied at the check from data, never rolled.

## 11. Tests and measurement

**Realistic failures first**, each one test, each shown to fail by planting its bug:

| # | Failure | Test |
|---|---|---|
| 1 | an old locked boss map or checkpoint plays differently | `BossKitLegacy.test.js`: 40 seeded boss battles per act on configs without kits, before and after: outcome, turn and RNG cursor identical; an old checkpoint resumes with empty `bossState` |
| 2 | a kit draws on the battle or node-map stream | seeded node maps and configs with kits on and off: identical apart from the compiled fields |
| 3 | a signature resolves without a tell, or on other tiles than it told | `BossSignature.test.js`: plan at T, mutate the board, resolve at T+1: the saved tiles are struck; a resolve with no `pending` is a no-op |
| 4 | a tell is lost or doubled across resume or rewind | round trip `bossState` through the checkpoint, the Vision snapshot and the validator mid-tell; a rewind past the plan has no `pending`; a resume resolves once |
| 5 | `bossBar` / `bossHp` fire twice, or never after a resume that skipped the exact turn | per kind: fires once, `≥`; the fallback fires on a rung with no stones and never on one with them |
| 6 | a phase is current while its stone stands | the validator refuses it; a rewind restoring the stone restores the phase |
| 7 | a volley kills on First Light, or counters, or gives XP | hand cases per rung; `awardScaledXP` never reached; the RNG cursor unchanged by a resolve |
| 8 | `mark` targets a hidden or dead unit, or the wrong one | last-striker bookkeeping over a counter-kill, a Dance refresh, a Steal; a dead marked unit clears |
| 9 | `foretell` writes AI state | `previewDecision` leaves `guardPost`, `_aiNoMoveStreak`, `_lastAiDecision` and the unit untouched (deep equality); the real decision next phase equals the preview on an unchanged board |
| 10 | the echo rule and the hum disagree | `entitySplashCountFor` by hand (0 / 1 / 2 held); the hum gain by hand; paired worlds differing by a hidden unit hold the same pillars (pillars read player positions only) |
| 11 | a kit affix breaks the rung's rules | First Light's excluded affixes, class exclusions and the mutual table hold on every kit × rung (`validate:data`) |
| 12 | a court partition changes a hold pack's wake | golden wake record (`02` §3.6) on Dusk+ boss maps with kits: the same packs wake for the same reasons |
| 13 | the arena share or variant moves the node map | 50 seeds: node types, `battleSeed`, edges, templates of non-boss nodes equal; the boss node's `templateId` differs only by the share |
| 14 | a Vision bonus pays twice, or on the wrong act | `BonusSettlement.test.js`: once per `completeBattle`; `bonusVisionActs`; never on the finale; a revert before the commit pays nothing |
| 15 | a bonus deadline and the tell disagree | the strip's "n to go" equals `pending`/`count` across a resume |
| 16 | the scene and the harness differ | every kit × rung × 2 seeds through `HeadlessBattle` with `ScriptedAgent` to the end; scene snapshots at fixed turns equal the harness's (`GridParity` style) |
| 17 | words lie about fog | strip, band and history words for a hidden tell carry no position (the `PlayerKnowledgePreviews` pattern) |
| 18 | a boss set piece's boss pick changes a procedural map | the set-piece path skips the pick; a procedural boss map's pick is unchanged for the seed |
| 19 | the closing doors trap or crush | `TerrainPhases` never closes a door under a unit; after the half, every lord move type reaches the throne (validator check 3 after each phase, `04` §8.2) |
| 20 | a kit's phases collapse wrongly on a rung | the Emperor on Dusk: one phase with bar-1 and last-bar effects in order; on Black Sun three |

**Sims.** `sim/pacing.js --bossKits` on 48 paired seeds per rung and act: push median inside
par − 4 … par − 2 per boss (the kit may not cost more than one turn against today), turtle
− push ≥ today's gap, force-won stalls ≤ today's, and a per-boss table of signature
resolves per battle and units felled by a volley (target: under 0.1 per battle on Dusk, 0
on First Light). `sim:fullrun:pr` with threshold notes if a slice moves.

**Browser specs** (each in a `tests/e2e/lanes.json` lane): `boss-kit-tell.spec.js`
(`run-flow`): an Act II Archmage battle on the dev route; the tell appears, the strip names
it, a unit steps off, the volley strikes the empty tile; a refresh mid-tell restores it;
desktop and 844x390. `portrait-boss-tell.spec.js` (`portrait`): the same upright.
`boss-arena-variant.spec.js` (`battle`): two seeds, two variants, the card's third line.

## 12. Rollout

Ordered for the biggest felt improvement at the least cost. PR numbers of the other specs
are theirs.

| PR | Content | Needs | Behaviour change | Effort |
|---|---|---|---|---|
| **K0** | **Arenas everywhere**: `arenaVariants` on the keep and the bastion (2 variants each), `act1_border_post`, `act2_doctrine_yard`, the arena share post-pass, the card's third line (data-driven, empty until K1), phase ticks on the bar | `02` PR 0b (the wall/wave fix and its validator, so the new variants are born correct) | every boss node meets an arena 3 times in 4; Acts I–II get one | 3 days + art review of two arena blocks |
| **K1** | **Kit data, compile and triggers**: `bossKits` schema and validator, `BossKit.compile` (courts, anchors, phases, bonus), `bossBar` / `bossHp` in `02`'s check (slot 2b), the rung collapse, `bossState` persistence, `onBossPhase` music, phase bands and lines, `guide_boss_tell`; the **Act I kits** (court orders, auras, affix at the half) | `02` 2.1, 2.2a (groups, warn bands, outlines), `02` 2.5 (par, so the court's groups price as today's: `calculatePar` on procedural maps, `02` §5.2 "which model"), `03` PR 3, 4 (phases with the same primary) | Act I bosses have two acts and a readable court | 5 days |
| **K2** | `BossSignature.js` with `court_order`, `aura`, `affix`, `unclamp`, `terrain`, `wave`; the **Act II and III kits** but the Archmage's volley and the Blade Lord's mark | K1; `03` PR 1b (`clampTile`), `02` 2.3 (waves), 2.4 (the Rider's patrol; without it he ships clamped) | Acts II–III bosses have signatures | 4 days + 1 tuning |
| **K3** | `volley` and `mark` (the Archmage, the Blade Lord); the forecast's volley line; `target_marked` | K2 | the two bosses with a per-unit threat | 3 days |
| **K4** | **The Emperor's kit** (bars, `shielded`, the guard, the last bar's `regenerator` and enrage layer), the bastion's overrides as phases on its variants | K2 | Act IV's one boss has three acts | 2 days |
| **K5** | **Boss-map bonuses and Vision**: the kit's bonus, `signatureCount` deadlines, the reward `oneOf`, the boss-map Vision rule | `03` PR 5 (bonus kinds); K1 | a bonus on every boss map; Vision from Act III | 2 days |
| **K6** | **The finale**: `foretell` and `previewDecision` (the Lieutenant), the echo pillars and `bossHp` waves (the Entity), the sanctum's anchors | K2; `03` PR 7 (`claim`) for the pillar bonus (the splash and hum rules need only positions and can ship first) | the Lieutenant shows his hand; the Entity can be quieted | 3 days |
| **K7** | Long Road refined (boss weights, the half's drawbridge, the ballista `claim`) | `04` PR E; K2 | — | 1 day on top of E |
| **K8** | The Parade refined (bars as phases) | `04` PR F; K4 | — | 1 day on top of F |
| **K9** | The Dueling Halls | `04` PR E's hybrid v2; the marching-boss clamp gate (`04` F); K3 | a second Act III boss set piece | 4 days + 1 tuning |
| **K10** | The Battery | `04` PR F; `03` `claim`; K4 | a second Act IV boss set piece, Nightfall+ | 4 days + 1 tuning |
| **K11** | Sanctum of Echoes refined (wardens, lit pillars) | `04` PR G's finale slot; K6 | Black Sun's finale variant | 3 days |

**The cheapest big win is K0 then K1.** K0 needs nothing but `02` PR 0b and changes every
act's boss map in a way the player sees on the first turn (the arena, the card's line).
K1 brings the bars and the courts to life on the rung everyone plays, and the Act I kits
are the simplest. Together, about 8 days after PR 0b, with no set piece and no camera work.

**What waits for the camera:** only the set pieces (K7–K11; 22 and 24 wide). Everything in
K0–K6 plays on today's sizes.

**What waits for `03`:** K1's phases need `03` PR 4 (phases with the same primary) and PR 3
(`objectiveState`). If `03` is late, K1 can ship a trimmed kit, **K1-lite**: courts and the
half's court orders through `02`'s groups alone (`onWake` with a `bossHp` wake and no
phase record): the band plays, the court moves, no terrain or affix. That is still the
Iron Captain and the Warchief as designed, since neither uses terrain.

## 13. Open questions for the owner

1. **Is a `bossOnly` hybrid template a "set piece" on First Light?** This spec says no (no
   groups, phases or bonuses of its own; today's size) and gives First Light the Act I/II
   arenas and the share. If the owner reads the ban more widely, K0 ships on Dusk+ and
   First Light keeps the plain seize pool.
2. **Volley lethality.** `lethal: false` on First Light and Dusk, lethal from Nightfall: or
   never lethal anywhere, so a boss can never fell a unit outside combat? The second is
   safer and weaker; the tell is a whole phase.
3. **Vision from boss-map bonuses:** half the offers on Act III+ boss maps, once per act
   (this spec), or always on the act boss's bonus from Act III (simpler to read, more
   Vision in the economy: a run could end with +2 charges an act)?
4. **The Emperor on Dusk:** the kit on whatever map (recommended), or the Parade always?
5. **A boss's affix at the half on First Light:** the rung's `excludedAffixes` hold; is a
   boss with `berserker` or `anchored` acceptable there at all, or should First Light's
   kits use only `court_order` and `aura`?
6. **Act II boss set piece** (The Second Push, 18x12): add it to Phase 6, or keep boss set
   pieces to Acts III–IV as the README's bands say?
7. **Boss weights on a set piece:** pin (Long Road is always the Iron Wall) or weight
   (recommended: 3 : 1 : 1, so a run can still meet the Blade Lord in the keep)?
8. **The Lieutenant's foretell:** is a shown-but-not-locked forecast honest enough, or
   should he be bound to it (locking an AI decision a phase ahead is a larger change and a
   stiffer fight)?

## Notes for the README

1. **Two trigger kinds** join §3's table: `bossBar { broken: n, fallback }` and
   `bossHp { below: share }`, both delay 0, both "hurt-shaped", evaluated in a `boss` slot
   after `hurt`. Both may carry `latest`.
2. **One more shared module**: `engine/BossSignature.js` (plan at T, resolve at T+1, state
   in `bossState`), beside `02`'s check; and `engine/BossKit.js` at generation.
3. **Battle state** gains `bossState` (the pending tell, the signature count, the marked
   unit, the pillars), riding the checkpoint, the Vision snapshot and the validator from
   K1.
4. **§4 "Where large maps appear"**: boss set pieces join the pool beside today's arenas
   (README Q4 answered: beside, not instead), and today's arenas get variants and two new
   acts; the Dueling Halls and the Battery join Long Road and the Parade; Sanctum of
   Echoes is Black Sun's finale variant.
5. **§6 questions 3 and 4** are answered by the owner: Vision may be a bonus reward (this
   spec limits it to boss maps, Act III+, once per act), and boss maps are enhanced, not
   replaced. Question 2 (First Light) is answered for set pieces; §13 Q1 here asks the
   narrower one about templates.
6. **Roadmap**: a Phase 5a, "boss kits on today's maps" (K0–K6), is shippable before any
   boss set piece and needs no camera work; Phase 5 proper (Long Road, the Parade) becomes
   K7–K8 on top of `04`'s E and F.
