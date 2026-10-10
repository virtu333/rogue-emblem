# Large maps 05: boss maps

Status: proposal, revision 4 (2026-10-10), fact-checked against the code; its notes are
taken in by the README (revision 5) and `01`–`04`. Revision 4 takes in the owner's rung
ladder of 2026-10-10 (README §6): Act I's boss stays today's map on every rung, and the rest
grows with the rung. Specs only: no game code or data changes.
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
  expand them in terms of creative possibilities." The hybrid arenas stay in the pool;
- **the rung ladder (2026-10-10): "Act I boss stays simple everywhere; scale grows with the
  rung."** Act I's bosses keep today's map on every rung (no arena, kit, signature or
  court). First Light, from Act II, gets at most one gentle, telegraphed, never-lethal
  signature on today's maps and **nothing else from the kit** (no court, phase, affix or
  bonus: the strict reading, decided 2026-10-10), and no new arena or variant. Dusk adds
  the Act II arena, the variants, sleeping courts and the full signature. The boss set
  pieces are Nightfall and up, the finale variant Black Sun only (§9.5 has the table).

So this spec has two halves. The first (§4–§7) makes every boss fight from Act II on richer
on the map it already plays on (on First Light only its one gentle signature, §9.5); Act I's
stay as they are. The second (§8) adds boss set pieces to the Act III, Act IV and finale
pools beside today's arenas, on Nightfall and Black Sun (the finale variant on Black Sun
only), never on First Light or Dusk.

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
- Every boss from Act II on has a **kit**: phases, a signature the player can read and play
  around, a court (its guard as named groups), beats, music and presentation hooks. It plays
  on the boss's map whatever that map is: today's procedural seize template, a hybrid arena,
  or a set piece. Act I's two bosses are `kitless` (owner decision, 2026-10-10; §7.1 keeps
  their designs, deferred).
- Today's boss arenas get **arena variants**, and Act II, which has none, gets one; both
  from Dusk up (§9.5).
- Boss maps get **bonus objectives**, and they are where this spec offers Vision (`03`
  §7.4's rule; §6).
- `04`'s two boss set pieces (Long Road and the Parade, refined here), two new ones (the
  Dueling Halls, the Battery) and `04`'s finale variant (Sanctum of Echoes, refined) join
  the Act III, Act IV and finale pools beside today's arenas, on Nightfall and Black Sun
  (Sanctum of Echoes on Black Sun only).
- The finale deepens without touching the hinge, the rally or the hum's contract.
- Every rule is a pure module called by `BattleScene` and `HeadlessBattle` alike; every
  mid-battle change rides the checkpoint, the Vision snapshot and the validator.

**Non-goals.**
- No boss stat rebalance, no new classes, no new weapons beyond a kit's authored loadout.
- No new run-ending defeat. A boss's signature can fell a unit; it can never end a run on
  its own: no signature ever takes the commander below 1 HP (§5.2).
- No replacement or migration of the v1 hybrid arenas (`04` §7: they stay v1, with Phase 0's
  fix; their authored overrides and waves are untouched, §4.4).
- No set piece on First Light; no boss set piece on Dusk; no Act I or Act II boss set piece
  in this revision (§13 Q6).
- **No change to Act I's boss battles on any rung** (owner decision, 2026-10-10): no arena,
  no kit, no signature, no court. Phase 0's fixes (`02` §2) still apply to them.
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
   siege tomes, terrain sets and triggered waves are the vocabulary (forced moves are left
   to `aoe-weapon-arts.md`, §5.2). A
   signature that needs a new combat rule is a later revision.
5. **Act I stays simple; the rest grows with the rung** (the owner's ladder, §9.5). Act I's
   bosses are today's fights on every rung. First Light meets, from Act II, only a kit's one
   gentle signature, told a phase ahead and never lethal (`byRung.normal`), on today's maps
   exactly as they are: no court, phase, affix or bonus. Dusk adds the whole kit, the new
   arena, the variants, sleeping courts and the full signature; the boss set pieces wait for
   Nightfall.
   So a player who climbs to Dusk already knows what a boss can do.
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
    "anchors": { "lectern": { "derive": "courtRing", "radius": 2, "terrain": "Fort", "pick": "farFromDeploy" } }
  }
}
```

(`reward` omitted: the bonus takes its kind's default from `objectives.json` `bonusRewards`
by act, locked at generation, `03` §7.4. On First Light the compiler keeps only the
signature, at its `normal` values, and drops the court, the phase and the bonus, §9.5.)

Fields:

| field | meaning | compiled into |
|---|---|---|
| `signature` | the boss's one telegraphed action (§5): `kind`, `name`, `cadence`, kind-specific fields, `byRung` | `battleConfig.bossSignature` (resolved per rung, locked) |
| `court[]` | the boss's guard as `02` groups. `pick` partitions the map's non-boss spawns with **no draw**: `nearestThrone` (the `share` nearest the throne by path), `flank:<side>`, `moveType:<type>` (with `count`), `rest`; ties by spawn index. A set piece names `region` instead | `battleConfig.encounterGroups` (`02` §3.2), members' `aiMode`/`holdPack` written as `02` §3.6 |
| `phases[]` | `03` phases that all keep the same primary (the seize; §4.5), `until` a trigger (this spec's `bossBar` / `bossHp`, or any README kind) or a list of triggers (any one fires), `onEnter` effects: `03`'s own `setTiles`, `wake` and `line` (the band's text key), plus this spec's `court` orders (§5.2 `court_order`), `signature` patches, `affix` (§5.3), `wave` (a `triggeredWaves` id to fire), `bossLine` (a spoken line key) and `music` (§7.6) | `battleConfig.objectives.phases`, with `objectives.primary` the seize `03` §3.2 would derive (written because phases say more than the derivation, `04` §3.7) |
| `bonus[]` | at most one from a kit; `03` §7.1 kinds; `deadline` may count signatures (§6) | `objectives.bonus` |
| `anchors` | derived points on a procedural map (§4.2) or chunk anchors on a set piece | `battleConfig.anchors` |
| (no `arena` field) | the arena and its variant are drawn at node generation (§4.4), before the battle's `generateEnemies` picks the boss, so a kit cannot choose them; it may name a variant's anchors (`lane`), and an effect whose anchor the drawn variant lacks is dropped at compile | — |
| `byRung` | per-rung patches to any of the above, from the rung up (`04` §3.4's rule); `normal` carries §9.5's First Light signature values (on First Light only `signature` is compiled) | resolved at compile |

Everything compiled is **locked with the config** (README §3); a resume reads the config,
never the kit. A locked map from before kits plays exactly as today (no `bossSignature`, no
phases, no groups: every reader has that branch already).

**Par.** A kit writes `objectives`, so its config takes `02` §5.2's `groups-v1` ("Which
model": every config with written `objectives`), with W from the derived seize `parRoute`
(`03` §5.9), S counting the court's sleeping groups that touch the route, and `parAdjust`
holding only `03`'s boss bars (one turn per stone). The kit adds no par term of its own:
phases with a `bossBar` / `bossHp` `until` contribute nothing (only `survive` does, `03`
§5.10), and bonuses never touch par. So a kit map's par moves only by `groups-v1`'s
calibration against today's `calculatePar` (`02` §5.2), which §11's sims check per boss.
A First Light kit is signature-only (§9.5): it writes no `objectives` and no group, so its
par is today's `calculatePar`, unchanged.

### 4.2 Courts and anchors on a procedural boss map

Today's boss maps have no named places. `engine/BossKit.js` `deriveBossAnchors(config)`
resolves, by BFS from the throne over Infantry-passable tiles and with no draw:
- `throne` (the one tile);
- `court` (standable tiles within path distance 2 of the throne);
- `apron` (distance 3–5);
- `gate` (the tile on the Infantry path from the player-spawn centroid to the throne that
  is 4 steps short of it: the mouth of the approach);
- `flank:n` / `flank:s` (the standable tiles of the enemy half nearest the top and bottom
  edges, within 6 of the throne);
- a kit's own derived anchors (`derive`, e.g. the Archmage's lectern: a Fort in the court
  ring). A derivation that finds nothing on the rolled layout drops the bonus or effect
  that names it (validated at compile, never thrown in play), so a procedural map never
  carries an anchor it does not have.

All are written into `battleConfig.anchors` (README §3) and locked.

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

### 4.4 An arena for Act II, and variants for today's (Dusk and up)

- **Arena variants.** The hybrid v1 contract gains `arenaVariants: [{ id, weight,
  arenaOrigin, arenaTiles, anchors, phaseTerrainOverrides, scriptedWaves }]` on a
  `bossOnly` template (the template's own `hybridArena` block, overrides and waves are
  variant 0, unchanged). Today's blocks are 4x3 (`[7,0]` / `[6,0]`, §1.2), too small to
  change a decision, so a variant is a larger authored block. The variant is drawn on
  `keyedBattleRandom(runSeed, 'boss-arena:<nodeId>')` in the post-pass below and written to
  `battleParams.arenaVariant`: no node-map or battle stream moves, and an old save without
  the field plays variant 0 (today's map). **Dusk and up only** (owner decision,
  2026-10-10): on First Light the post-pass draws no variant and writes nothing, so a keep
  the ordinary draw picks there plays today's map, variant 0, and no `arena` capability is
  written. Variants are **structural** (pillar 5): the keep's throne court with its doorway
  north or south; the bastion's firing lane left or right of the throne, its Fort on the
  near or far side. Overrides and scripted waves are authored
  per variant and stay v1 (absolute turns, deferred by `02` PR 0b's `TerrainPhases`), and
  `02` PR 0b's validator (no override on a wave tile) runs on each. Variant 0 keeps today's
  data exactly, so `04` §7's "migration: none" holds.
- **An arena for Act II** (a `bossOnly` v1 template, data only, after PR 0b), grassland
  (no `biome`), the most common biome in Act II: `act2_doctrine_yard` (a cavalry yard: open
  ground, a wall line with two gaps, the throne on the far side; the Knight Commander's
  wedge wants the open ground, the Archmage's circle wants the wall; at most one scripted
  wave). It is an ordinary v1 hybrid template (approach procedural, arena fixed),
  validated like the keep, with one new flag, `shareOnly: true`: `pickTemplateForNode`'s
  ordinary draw filters it out as it filters `bossOnly` templates off other nodes, so the
  draw runs over today's list, no node's pick moves, and the yard is reached only through
  the share post-pass below, which is rung-gated. Without the flag the ordinary draw would
  bring it to First Light, which the owner's ladder rules out (§9.5). The validator refuses
  `shareOnly` on a template that is not `bossOnly`.
- **Act I's arena is deferred, out of scope by owner decision (2026-10-10).** The design is
  kept for a later revision and is not added to the data: `act1_border_post` (grassland, the
  only biome Act I rolls, `ACT_BIOME_WEIGHTS.act1`: a palisade with one gate, the throne
  behind, a Fort at each corner of the yard, two variants; terrain only, no scripted waves
  and no phase overrides, since v1 has no per-rung patch and Act I is every new player's
  first boss). The post-pass never runs on an Act I boss node.
- **Arena share.** Boss nodes today meet an arena on about 27% of Act III boss maps and 17%
  of Act IV's, never in Acts I–II. A keyed post-pass after node generation, run right
  after `04`'s `assignSetPieces` at both `_withNodeMapSeed(generateNodeMap…)` sites
  (`RunManager.js:718`, `:4466`; never in the prologue), on
  `keyedBattleRandom(runSeed, 'boss-arena-share:<nodeId>')` and never the node-map stream,
  replaces the boss node's drawn template with one of the act's `bossOnly` templates whose
  biome equals the drawn template's (`getTemplateBiome`; absent is grassland), at the
  rung's `bossKits.arenaShare` (§10.1: First Light 0, validated; Dusk and up 0.75), else
  leaves it. Acts II–IV only. A boss set piece (§8) placed by `04`'s pass first wins. Old
  saves keep their `templateId` (`fromJSON` never runs the pass).

Set pieces are not needed for any of this. It is the cheapest large change in this spec. It
does not reach First Light (owner decision, 2026-10-10, §9.5): a 0 share and no variant
there, so First Light's boss maps are today's, the keep included where the ordinary draw
picks it.

### 4.5 Phases that keep the primary

Every kit phase carries the same primary (the one seize). `03` §4 as written takes victory
only in the last phase and offers no Seize for a later phase before its advance, so a boss
killed and seized in phase 0 (a Dusk boss, with no stone, taken from above half to 0 in
one exchange, before its `bossHp` `until` has fired) would leave the player waiting an enemy
phase on a won map. `04`'s Long Road drawbridge phase has the same shape. This spec needs
the rule below, which `03` has adopted (`03` §4, §6, revision 3):
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
  it. Two asks of `01`, taken in (`01` §2.7, §2.8): its pointer priority promotes the boss
  ahead of the primary objective while a tell is pending (behind only a commander at half
  HP or less, whose safety ends runs), and its enemy-phase beat table gains a row,
  "signature resolves: the affected tiles the player can see".
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
| `court_order` | at the tell, a named court group is given new orders (`guard` an anchor, with an optional `guardRadius`; `seek` an anchor `then` `hunt`; `hunt` with `together`; `ignoreEnrage: false`) and acts on them from the resolve. On a `dormant` or `patrol` group this is its wake with that `onWake`; on an `awake` group it rewrites the members' `aiMode` / `guardPost` / `aiTargetTile` through the same writer (a re-order: new, since `02` §3.3 applies `onWake` once). An order given at a phase's `onEnter` may carry `delay: n` (whole enemy phases, a warn band at the check that gives it, as a delayed group wake has, `02` §3.8) | `02` §3.7 `onWake` shapes (`hunt`, `guard`, `seek` with `then: 'hunt'`), `seek_tile` / `guard` AI modes (`02` PR 2.4) | the court's new posts are outlined at the tell |
| `aura` | at the resolve, court members within `radius` of the boss (or of a named anchor, such as a gate; on First Light, where no court is compiled, every non-boss enemy within `radius` of the boss) take a timed buff (`stat`, `value`) for one turn: an entry from `resolveTimedBuffExpiry(boss, T+1, 1)`, expiring as the next enemy phase starts | `applyTimedBuffEntry` (`TimedWeaponArtBuffs.js:31`), the Road Mark's one-turn MOV entry (`MarkSystem.roadBuffEntry`, `:135`); badge from `StatusBadges` | the buffed units show the badge; the forecast reads the buffed stat (`timedBuffCombatMods`, `:162`, already feeds combat) |
| `affix` | the boss takes or drops an affix at a phase's `onEnter` (not cadenced). The rung's `excludedAffixes`, the class exclusions and the mutual table hold (`AffixEngine`'s private `isAffixAllowed`, `:41`, exported for this through a `kitAffixAllowed` helper); the rung's `tierPool` governs rolled affixes, not authored ones. Never on First Light, where a kit compiles to its signature alone (§9.5). An affix the rules refuse at compile (a Sworn `regenerator` beside a kit's `shielded`: `affixes.json` makes them mutually exclusive) is left out of the locked config and its band word with it. A boss rolls no affixes (§1.1), so it carries at most its Sworn affix plus the kit's | `unit.affixes`, serialized; one mid-battle applier (`AffixSystem`) that also applies a spawn-time stat (`haste`'s MOV, `getAffixMovBonus`), in the scene and the harness alike (§1.5's gap); `updateAffixPips` draws the pip; the affix tooltip explains it. `regenerator` given at the check of T first heals at T+1 (turn-start effects run before the check) | the band names the affix and what it does |
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

- **Every boss map from Act II, Dusk and up, may carry one bonus from its kit** (none in Act
  I, and none on First Light, whose kits are signature-only, §9.5; `MAX_BONUS_OBJECTIVES` 2
  still holds with a derived village or caravan), authored in the kit (procedural maps and
  v1 arenas) or the set piece. `03` §7.2 keeps ordinary procedural maps to the derived
  village and caravan in v2 (its open question 5); this spec asks that boss nodes be the
  exception (Notes for the README). `03`'s rules hold unchanged: judged once at the victory
  commit, never XP, never a `slay` on a primary's target or a throne's guard (`'@boss'`: any
  `isBoss`; `04` §8.2 check 9), the cost in turns on the strip. None on a scripted battle.
- **Kinds that fit a boss map:** `reach` (a cache in the court: the Archmage's middle
  pages, the Iron Wall's armoury), `claim` (a ballista on the wall, only where
  `MapGenerator` placed one: Nightfall+, not Act I), `unbloodied`, `slay` a court captain
  (never `isBoss`), and a new deadline form `deadline: { signatureCount: n }` (done before
  the boss's n-th signature resolves: "Take the pages before the second Calculation";
  failed at the check where it resolves), locked at generation as an integer of signatures
  and shown as such. `03` §7.1 gives a deadline only to `slay` (`byTurn`); a `reach` or
  `claim` with a `deadline` (`signatureCount`, or `byTurn` locked as `par − k`) is this
  spec's extension (Notes for the README).
- **Vision.** `03` §7.4's `vision: 1` reward is allowed (owner decision): Act III and later,
  at most once per act (`run.bonusVisionActs`), never on First Light (`03` §7.4: "none on
  First Light"; its boss maps carry no kit bonus at all, §9.5). `03`
  allows it on any Act III+ set-piece or boss-map bonus (README §6.3); this spec makes its
  offers on boss maps, and an ordinary or elite set piece may make its own (§13 Q3,
  decided). The reward is a seeded choice at generation
  (`keyedBattleRandom(battleSeed, 'bonus-reward:<id>')`, `objectives.json`
  `bonusRewards.visionOffer` 0.5): half the offers on Dusk+ Act III and IV boss maps are
  `vision: 1`, half the kind's default reward (gold plus an item for `reach` and
  `unbloodied`, gold plus a forge step for `slay`). The choice is resolved before the
  config is locked, so the locked `reward` is one plain `03` §7.4 key (a `vision` reward
  locks the default side beside it as its `fallback`), which `03`'s validator accepts; when
  `run.bonusVisionActs` already holds the act at generation (an ordinary set piece paid
  one), the offer is the default side, and the commit checks again and pays the
  `fallback` (`03` §7.4). The strip says which
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
break where the boss carries a stone (act bosses on Nightfall and Black Sun), the half-HP
point where it carries none (act bosses on First Light and Dusk). Court sizes follow `02`
§5.1's budget (the court is a partition of today's count; awake-at-start ≤ the base). Lines
are content keys in `dialogue.json` `bossEncounters.<boss>.phases` and
`src/data/bossKitContent.js` (bands, tells, inspect lines), under the lore style guide
(boss lore ≤ 240 characters; the loop: "bosses half-remember dying"). Every *First Light*
line below applies §9.5's strict reading: the kit compiles to its one signature at gentle
values (`byRung.normal`), never lethal, and nothing else: no court (today's First Light
guards, as rolled), no phase or half beyond today's `halfHealth` line, no affix, no
`unclamp` or clamp change, no bonus. A signature built on a court order compiles to none.

### 7.1 Act I (deferred: out of scope by owner decision)

**Not built.** The owner's ladder (2026-10-10, §9.5) keeps Act I's boss battles exactly as
they are on every rung: today's map, no arena, no kit, no signature, no court (Phase 0's
fixes still apply). The two designs below are kept for a later revision, if the owner ever
reopens Act I. Until then `enemies.json` lists the Iron Captain and the Warchief in
`kitless` (§10.1, validated), `act1_border_post` is not in the data (§4.4), and no K
delivers either kit (§12). Act II's Knight Commander is the first kit a Dusk+ player
meets. Their *First Light* lines predate the strict reading (§9.5) and would follow it if
Act I is reopened.

**Iron Captain**, Warden of the Unrelieved Line (Cavalier).
- *Court:* `line` (40% nearest the throne, `awake`, `guard` the `gate` anchor: they hold
  the mouth of the approach, not the throne), `rest` (`awake`, hunt).
- *Phase 1 "The Line":* the court holds the gate; signature `aura` **Hold the Line**
  (cadence `afterContact 1, every 2`, `latest parOffset −3`): court members within 2 of the
  gate take +2 DEF for one turn. Tell: the gate tiles and the badge.
- *Half ("Fall back and REFORM!", his `halfHealth` line):* `court_order`: `line` guards the
  `throne` anchor instead (a `guard` member walks back to its post when no foe is within its
  radius, `AIController.js:296-305`); the Captain takes `anchored` (tier 1: +2 DEF on Fort
  or Throne, cannot be shoved or pulled). Band: "The line reforms around him."
- *Arena:* `act1_border_post`, the palisade gate north or south of the throne.
- *Bonus:* `reach` the border post's strongbox (a Fort tile in the court; his `defeat`
  lines find the dispatch itself in his coat) → the act's gold plus item. Cost about 1
  turn.
- *Why it teaches:* the first boss a new player meets has one readable idea (a line that
  holds, then closes ranks) and nothing that strikes from afar.
- *First Light:* as written (no group sleeps); the aura is +1.

**Warchief**, Breaker of the Old Treaties (Fighter).
- *Court:* `clan` (a `dormant` pod on `flank:n` or `flank:s`, a keyed choice on
  `'boss-kit:<boss>:flank'`; wake `danger`, `hurt`, `groupWoken: throne_guard`),
  `throne_guard` (`awake`, guard the throne).
- *Phase 1:* the clan sleeps on the ridge with its outline drawn from turn 1 (`02` §3.8).
- *Half ("the axe remembers"):* **War Cry**: the clan wakes (`onEnter.court`, hunt), the
  Warchief takes `berserker` (tier 1: +5 ATK, −3 DEF, `aiOverride: target_lowest_hp`) and
  drops his clamp (`unclamp`): he comes down from the throne. Band: "The clan answers."
- *Signature:* none cadenced; the half is the signature. (Two Act I bosses, one with a
  cadence and one without, so the first act shows both shapes.)
- *Bonus:* `unbloodied` (no unit below half) → gold. The Warchief's war cry is exactly what
  breaks it.
- *First Light:* the clan is 2, stands as an awake guard on its flank anchor (today's
  First Light guard, §9.5), and the War Cry's order reaches it with `delay 1`, so the warn
  band is seen a player phase before it moves.

### 7.2 Act II

**Knight Commander**, First Lance of the Second Push (Paladin). With Act I `kitless`, his is
the first kit a Dusk+ player meets on a run, and K1 ships it (§12).
- *Court:* `wedge` (3–4 `moveType:Cavalry` picks, `dormant` behind the throne, woken by
  the signature), `field` (`awake`).
- *Signature `court_order` + `unclamp`* **The Second Push** (cadence `afterContact 2,
  latest parOffset −3`, once): at the tell the wedge's charge lane (the `apron` tiles
  nearest the army's centroid) is outlined and the band says "The second push forms"; at
  the resolve the wedge wakes `hunt` `together` and the Commander drops his clamp and rides
  with it. He is a Paladin off his throne: the player holds a chokepoint or baits him onto
  a Fort.
- *Half:* he returns (`unclamp` back: `seek_tile` the throne, then the clamp) and takes
  `shielded` (tier 2: the first hit each player phase does 0): the doctrine's casualty
  tables. Band: "He has read the tables. Back to the throne."
- *Arena:* `act2_doctrine_yard`, the wall's two gaps.
- *Bonus:* `slay` the wedge's captain (the wedge's highest-level member, `objectiveRef`,
  never `isBoss`) before the second push resolves (`deadline: { signatureCount: 1 }`) →
  gold + forge step.
- *First Light:* nothing. The Second Push is a court order with an `unclamp`, which First
  Light never compiles (§9.5), so his kit there is empty: today's fight, with no card line
  and no tell.

**Archmage**, Keeper of the Middle Pages (Sage).
- *Court:* `circle` (40%, `dormant` around the throne, wake `danger`, `hurt`; the mages
  among them keep their class), `field`.
- *Signature `volley`* **The Calculation** (cadence `afterContact 1, every 3, latest
  parOffset −4`, 3 tiles, `weapon: "Breachbolt"`, the one siege tome, named by the kit
  because Act II's `siegeWeaponConfig` is 0 on every rung and First Light has none): "he
  reads the field". The tiles under the three nearest player units are fixed at the tell
  and struck at the resolve. First Light and Dusk: `lethal: false`.
- *Half ("corrected a semitone"):* the cadence becomes `every 2`; the circle digs in
  (`court_order`: `guard` the `court` anchor with `guardRadius` 2: they stop chasing and
  hold the ring). Band: "The calculation is corrected." The circle carries no siege tomes,
  so `SiegeArtillery`'s stance never applies to it.
- *Bonus:* `reach` the lectern (the middle pages, a Fort in the court) before the second
  Calculation (`deadline: { signatureCount: 2 }`) → Act II's item (a tome).
- *Why it is the first volley:* Act II, a 3-tile volley told a full phase ahead that cannot
  kill on the intro rungs: the player learns to read outlined tiles before the Entity's
  splash.
- *First Light:* the Calculation alone: 2 tiles, never lethal, on its cadence; no circle,
  no half, no lectern.

**Dark Rider**, Bearer of the Sealed Orders (Dark Knight).
- *Court:* `escort` (2, `patrol` on `[throne, gate]` with him), `garrison` (`dormant` at
  the throne).
- *Phase 1 "The Road":* the Rider is not clamped. He and his escort are a `patrol` group
  (`02` PR 2.4) between the throne and the gate: the road empties ahead of him. His group
  wakes to `hunt` on `danger` / `hurt`.
- *Signature `wave`* **Sealed Orders** (cadence `afterContact 2, latest parOffset −3`,
  once): the orders are read: riders arrive at the gate's edge (`side: anchor:gate`, 2–3,
  `xpMultiplier 0.5`). The warn band names the edge and the turn.
- *Half:* `unclamp` back (`seek_tile` the throne, then the clamp); the garrison wakes.
  Band: "He rides for the throne. The orders are delivered."
- *Bonus:* `slay` him on the road: not allowed (he is the throne's guard, `03` §7.2).
  Instead `reach` the dispatch rider's post (a Fort on the road) before the orders are read
  (`deadline: { signatureCount: 1 }`) → gold + item: the sealed orders themselves,
  intercepted.
- *Engine note:* a boss in a `patrol` group needs the clamp gate `04` §10.4 already asks
  for the Parade ("the clamp skips a member of a `patrol` group until its column reaches
  its last anchor"); the Rider is its first and cheaper user (one boss, one route), so K2
  ships it and `04` PR F reuses it (§12). If `02` PR 2.4 is not in, the Rider ships on the
  throne with the wave and the half only.
- *First Light:* Sealed Orders alone: he holds the throne, clamped, as today, and the
  orders bring 2 riders at the gate's edge, told a phase ahead; no escort or garrison, no
  half, no bonus.

### 7.3 Act III

**Blade Lord**, Proof of the Dueling Halls (Swordmaster).
- *Court:* `hall` (`dormant`, `ignoreEnrage` until the half, wake `hurt` only), `field`.
- *Signature `mark`* **The Perfect Duel**: he answers the blade that touched him. The last
  player unit to damage him is marked; he goes for it. The court holds: a duel is formal.
  Tell: the badge and the line. Counterplay: choose who strikes last; a General can take
  his two clipped strikes, a Myrmidon cannot.
- *Half ("the sacred ground keeps no forms"):* the court wakes (`court_order`:
  `ignoreEnrage: false`, `hunt` `together`, its shared target the marked unit); he takes
  `haste` (tier 1, +2 MOV through the mid-battle applier, §5.2) and drops his clamp. Band:
  "No forms. The hall empties onto the floor."
- *Arena:* the keep (`act3_dark_champion_keep`) is already his: its variants from Dusk up
  (§4.4); First Light plays it as it is.
- *Bonus:* `unbloodied` → Vision or gold on Dusk+ (§6); none on First Light.
- *Music:* the half plays his card cue again over the ducked theme (§7.6).
- *First Light:* the Perfect Duel alone: the mark, its badge and line, and his target
  score; no hall court, no half, no `haste`, no unclamp, no bonus.

**Iron Wall**, Holder of the Breach (General).
- *Court:* `wall` (50%, `awake`, `guard` the `gate`: they stand in the breach with him),
  `posterns` (`dormant`, woken by the half).
- *Phase 1 "The Breach":* he and the wall hold the gate (the Wall's clamp is the gate, not
  the throne: `clampTile: gate`, `03` PR 1b; Seize still needs him dead). Signature `aura`
  **Doctrine** (cadence `afterContact 1, every 2, latest parOffset −3`): wall members
  adjacent to him take +3 DEF.
- *Half ("the order never came"):* `terrain`: two posterns open (derived at compile: on each
  of `flank:n` / `flank:s`, a Wall tile of the court ring that, set to Floor, joins the
  court to that flank; marked from turn 1 as "sealed posterns"; where the derivation finds
  none, the half keeps only its court order); the `posterns` group wakes and sallies
  through them (`seek` the posterns' outer tile, `then: 'hunt'`): two fronts. He falls back
  to the throne (`unclamp` back). Band: "The posterns open."
- *Bonus:* `claim` the gatehouse ballista where `MapGenerator` placed one (Nightfall+, not
  Act I) → Vision or gold; otherwise (and always on First Light and Dusk, which roll no
  ballistae) `reach` the armoury in the court → gold + item.
- *Set piece:* Long Road to the Keep prefers him (§8.3), on Nightfall and Black Sun.
- *First Light:* Doctrine alone, +2 DEF to the enemies adjacent to him, on the throne as
  today (no `clampTile: gate`); no wall or posterns court, no half, no bonus.

**Berserker King**, Crowned by Frightened Acclaim (Berserker).
- *Court:* two pods, `clan:n` and `clan:s` (`dormant` on each flank, wake `danger`, `hurt`
  and `groupWoken` of the other with delay 1: hurt one and the other comes).
- *Signature `aura`* **Acclaim** (cadence `afterContact 1, every 3, latest parOffset −3`):
  every court member within 3 of him takes +2 MOV for one turn (a timed `MOV` buff, as the
  Road Mark's, not the `haste` affix): the clan surges. Tell: the badge on each, the band
  "The acclaim rises."
- *Half ("the corruption changed nothing"):* he takes `berserker` and `unclamp`s; the aura
  becomes `every 2`. Band: "He leaves the throne. Nobody objects."
- *Bonus:* `slay` the clan's chief (a court member: the highest-level of the two pods)
  before the first Acclaim resolves (`deadline: { signatureCount: 1 }`) → gold + forge step.
- *First Light:* Acclaim alone, +1 MOV to the enemies within 3 of him; no pods, no half,
  no bonus.

### 7.4 Act IV: The Emperor

The Emperor, Who Sold the Empire's Future (General; stones 1 / 1 / 2 on Dusk / Nightfall /
Black Sun, `revivalStones.emperor`; First Light has no Act IV). Every Act IV run fights
him, and on Dusk it is the last battle. His kit is the one with three acts.

- *Court:* `imperial_guard` (`dormant` at the steps of the throne, the `court` anchor; wake
  `hurt`, and the bar-1 phase wakes it), `household` (`awake`, guard the throne). Nightfall+
  adds `gate`, a triggered wave at the `gate` anchor (`when: { kind: 'bossBar', broken: 2,
  fallback: { kind: 'bossHp', below: 0.25 } }`: Black Sun's second bar; on Nightfall, with
  one stone, his last bar below a quarter).
- *Phase 1 "The Arithmetic"* (`until`: `bossBar broken 1`; he carries a stone on every rung
  that meets him): he holds the throne with the household; signature `affix` **Held the
  Dark Back**: `shielded` (tier 2) on his first bar (the first hit each player phase does
  0). Readable: the player leads with a weak hit. If his Sworn affix is `regenerator`,
  `shielded` is refused by the mutual table (§5.2) and the phase has no affix.
- *Bar 1 breaks ("behold what I kept for myself", his `halfHealth` line):* the imperial
  guard wakes; `shielded` is dropped; on the bastion the arena changes: walls rise on the
  variant's `lane` anchors (`onEnter.setTiles`, never under a unit: recorded and skipped),
  so the firing lane closes behind whoever has entered it. The bastion's v1 overrides
  (T2/T5) stay as authored (§4.4). Band: "The guard he kept for himself."
- *Last bar* (`until`: `bossBar broken: 'last'`): he takes `regenerator` (tier 1: 20% of
  max HP at each enemy-phase start, from the next one) and the music goes to the enrage
  layer (§7.6): the last bar is a race. Band: "The arithmetic runs in his favour."
- *Bonus:* `slay` the standard-bearer (the `imperial_guard`'s highest-level General,
  `objectiveRef`, `04` §10.4's role on a procedural map) by turn `par − 3` (`03` §7.1's
  `byTurn`, locked as an integer: no signature counts here) → Vision or gold.
- *Arena:* the bastion's variants (Dusk and up); the Parade (§8.4) and the Battery (§8.6) as
  set pieces, Nightfall and up.
- *The rung collapse.* With one stone (Dusk, Nightfall) `bossBar broken: 'last'` is the same
  event as `broken 1`; `03` §6 arms an `until` only from the check after its phase became
  current, so two phases on one event would land a check apart. `BossKit.compile` therefore
  merges phases whose `until`s are the same event on the rung into one phase whose
  `onEnter` runs both effect lists in order (validated): two phases on Dusk and Nightfall,
  three on Black Sun.

### 7.5 The finale

See §8.1 (the Lieutenant) and §8.2 (the Entity).

### 7.6 Beats, music and presentation shared by every kit

- **The card** gains a third line under the epithet: the signature's name and one plain
  sentence ("The Calculation: reads the field, then strikes where you stood";
  `bossCardContent`, `ceremonyContent.js:113-128`). The Entity's card stays `· · ·`.
- **Phase bands** reuse the ceremony band (the style of `03` §6's NEW OBJECTIVE band, but
  with the kit's word, `onEnter.line`, §4.5: "THE LINE REFORMS", "NO FORMS", "THE POSTERNS
  OPEN"); the `halfHealth` line keeps its timing (at once) and the band plays at the
  check. A kit's spoken phase line (`onEnter.bossLine`, in
  `bossEncounters.<boss>.phases.<id>`) follows the `halfHealth` shape (`base`, `variants`
  with `NarrativeDirector`'s `when` keys: `bossKilledYouBefore`, `bossSlainBefore`,
  `partner`, `commanderHasEpithet`, …; an unknown key never matches), so the loop's memory
  reaches the new lines too.
- **The bar** draws a thin phase tick per phase under the stones (a kit with two phases:
  one tick at the trigger's HP share when it is `bossHp`, at the stone when it is
  `bossBar`), so the player sees where the fight changes. `summaryLine`
  (`BossPresenceController.js:104-111`) adds the pending tell ("· Calculation next phase").
- **Music.** Turn enrage keeps the enrage layer. A kit's phase may say `music: 'card'`
  (replay the boss's card cue, `BOSS_CARD_CUES` in `musicConfig.js`, over the ducked theme
  through `ceremonyMusic`'s `playStinger`: "his motif returns") or `music: 'enrage'` (the
  enrage layer from here: the last bar of a stone boss defaults to it, since the enrage
  layer is already "this boss, cornered", `SCORE.md:126-143`).
  `BattleMusicController.onBossPhase(kind)` is the one entry; an `enrage` phase latches the
  layer for the battle (it rides `bossState`, so a resume restores it and later intensity
  changes do not fall back to the full mix); the Entity ignores it (its finale is its
  second act). No new scores.
- **History words** (`02` §3.8's table): "The Calculation falls on 3 tiles.", "The
  posterns open.", "The line reforms.", never a hidden position.
- **Guidance.** One new essential note, `guide_boss_tell` (`engine/Guidance.js`
  `GUIDANCE_NOTES`, raised by `GuidanceController`), at the first pending tell on a slot:
  "The boss has shown its next move. The outlined tiles are where it lands next enemy
  phase; anything standing there takes it." Once per slot, never in the prologue or a
  scripted battle.
- **Camera** (`01` §2.7): the tell's tiles are a beat subject at the check (the new beat
  row, §5.1); the phase band pans to the phase's anchor (`03` §6 step 4).

## 8. Set pieces and the finale

### 8.1 The Lieutenant (First Light's finale; no set piece)

First Light gets no set piece, and the Lieutenant is fought only there (his
`difficultyFilter` is `normal, dusk`, and a Dusk run ends at the Emperor), so his fight is
enhanced on `eldritch_sanctum` as it stands: today's template, no new format. The ladder's
First Light column for Acts III–IV (§9.5) governs him, strictly: today's map plus one
gentle, never-lethal signature (the foretell costs no HP), and nothing else. The half, the
Sera line and the bonus below were written before that decision; they are **deferred** (not
built), and the sanctum keeps its three absolute template waves (T4, T7, T10) on First
Light.
- *Signature `foretell`* **The Far Side of the Glass**: through the player phase his next
  decision is shown (the tile he will move to, the unit he will strike), redrawn after
  each player action. "I have watched you win this fight a hundred ways." Nothing is
  locked: he decides afresh when his phase comes; the forecast is true only if nothing else
  moves first. The player reads it and moves the threatened unit, or feeds him the one that
  can take it. It is the only signature that costs no HP and still changes every turn of
  the fight. The sanctum has `fogChance: 0`, as `foretell` requires (§5.2).
- *Half (deferred, see above; "every future you could reach"):* on configs generated after
  K6, the Lieutenant's kit writes the sanctum's T7 template wave as `triggeredWaves` with
  `when: { kind: 'bossHp', below: 0.5, latest: { turn: 7 } }` (the template wave's count,
  its edges as `side: 'edge:<name>'` entries, its own stream: `02` §4), so it answers the
  wound and never comes later than today; T4 and T10 stay absolute template waves. This is
  `02` §4's "template waves to contact-relative" tuning item for one template, so it ships
  only if §11's sims show First Light's finale push median does not rise; else the wave
  stays T7 and the half keeps only its band. Band: "He has seen this one."
- *Sera (the phase line is deferred with the half):* his theme already answers him (in its
  last strain Sera's violin plays his falling line once, `SCORE.md:122`); a phase line
  variant when Sera is on the field and below half ("You always did prefer the far side of
  the glass") needs a new `NarrativeDirector` `when` key
  (`unitOnField: { name, belowHalf }`; unknown keys never match today), which waits with it.
- *Bonus (deferred, see above):* `unbloodied` as a feat (§6: the run ends here, so no reward
  outlives it).
- *Engine:* `previewDecision` (§5.2) is the one AI change; everything else is data.

### 8.2 The Entity (Nightfall, Black Sun)

The hinge, the finale track, the hum's HP contract and the rally are not touched. What is
added sits beside them.
- *Echo pillars.* `eldritch_sanctum` gains four anchors `echo_1..4`, derived at generation
  and written into `battleConfig.anchors` (so a locked map keeps them): the four Pillar
  tiles of the template's `pillar_grid` structure (deterministic on the fixed size,
  `MapGenerator.applyPillarGrid`, `:997-1009`; the zones' randomly rolled Pillars are not
  candidates) nearest the Entity's footprint, each paired with its standable neighbour
  nearest the footprint. A pillar is **held** while a player unit stands on that neighbour
  at the check (recorded in `bossState.pillars`). Each held pillar quiets one echo:
  - the Entity's splash count is `ENTITY_SPLASH_COUNT − held` (floor 0), through a new
    `EntitySystem.entitySplashCountFor(held)`. The splash itself moves out of
    `BattleScene._applyEntitySplash` into a pure `EntitySystem` step that the scene and the
    harness both drive (today the harness never splashes, §1.3 item 8; the move changes
    harness finale results, measured with `test:harness:pr` and threshold notes). The draws
    stay on the battle stream (`rollSplashTiles`' shuffle and count draws are the same in
    number; fewer victims mean fewer `rollSplashDamage` draws afterwards), so a held pillar
    changes the rest of that battle's stream deterministically and nothing else;
  - the hum's gain is `entityHumGain(ratio) × (1 − 0.15 × held)` (presentation; the HP
    term is unchanged, and `held` is read from `bossState.pillars`, so a resumed battle
    restores the same level).
  A held pillar is lit (a marker, `01` §2.8); a pillar lost when its unit steps off goes
  dark at the next check. Standing on a pillar is standing within the Entity's reach: the
  price is the point.
- *Stages* (`bossHp` triggers on Nightfall and Black Sun): on configs generated after K6
  the Entity's kit writes the T4 and T7 template waves as `triggeredWaves` (as in §8.1),
  the first at
  `{ kind: 'bossHp', below: 0.67, latest: { turn: 4 } }`, the second at `below: 0.34,
  latest: { turn: 7 }`; T10 stays absolute. The waves now answer the wound and never come
  later than today (as for §8.1, measured before it ships). Band words only: "The echoes
  answer." The hum already tells the rest.
- *Bonus:* two of the four pillars held at the same check, a `claim` on points (`03` §7.1
  `claim` with `need: 2` held at once, an extension: Notes for the README), as a feat
  (§6: nothing pays after the finale). The rally is unchanged; a resumed finale with
  pillars held opens on the finale as today.
- *Black Sun:* the **Sanctum of Echoes** set piece (§8.7) at `04`'s 0.5 finale share;
  Nightfall keeps the sanctum with the above. This answers `04` open question 7 with "Black
  Sun only" and so asks `04` §6.1's table to set Nightfall's finale share to 0 (Notes for
  the README); Nightfall can be added if the owner wants it.

### 8.3 Long Road to the Keep (Act III boss, 22x14, refined)

`04` §10.3 stands. Nightfall and Black Sun only (owner decision, 2026-10-10; `04` §6.1).
Refinements from the kits:
- **The boss.** The set piece prefers the Iron Wall (`boss: { weights: { 'Iron Wall': 3,
  'Blade Lord': 1, 'Berserker King': 1 } }`, a new `setPieces.json` field, drawn on
  `keyedBattleRandom(battleSeed, 'setpiece:<id>:boss')`; on the set-piece path this replaces
  the `generateEnemies`-style `Math.random` boss pick `04` §4.3 describes, and the procedural
  path keeps its pick). The keep is the Holder of the Breach's map; the other two can hold
  it.
- **The drawbridge drops on the sally's trigger or on the half**, whichever comes first:
  the `drawbridge` phase's `until` becomes a list, any one firing (`[{ kind: 'groupWoken',
  group: 'outer_camp', delay: 1 }, { kind: 'turn', parOffset: -4 }, { kind: 'bossBar',
  broken: 1, fallback: { kind: 'bossHp', below: 0.5 } }]`; `04` §10.3 already needs a
  list for its "whichever comes first"): breaking his first bar from the postern side opens
  the gate behind you.
- **The kit's terrain step is the drawbridge here.** On this map the Iron Wall's half
  lowers the drawbridge (the `until` above) and his sally comes out over it, so the map's
  `sally` group is the kit's `posterns` court and the derived flank posterns of §7.3 are not
  used (the set piece's own 1-wide postern is the player's way in, `04`'s N/S choice).
- **Bonus:** `claim` the gatehouse ballista (under `04` §3.2's Ballista-anchor rule, which
  places it on every rung this map meets; it covers the moat) → Vision or gold (§6). The
  `reach` armoury (→ gold + item), written for Dusk before Dusk lost boss set pieces, stays
  authored as the fallback should no ballista be placed. `04` §10.3 wrote no bonus; this
  adds one.
- Estimate 10–11 at Nightfall counts, the stone included (`04` §10.3).

### 8.4 The Emperor's Parade (Act IV boss, 24x14, refined)

`04` §10.4 stands. Nightfall and Black Sun only (owner decision, 2026-10-10; `04` §6.1).
Refinements:
- **The bars are the phases**, so the phase machine never waits on the march. Phase 0
  (`until: bossBar broken 1`) gives him `shielded` from turn 1, marching or seated. `04`'s
  `seated` phase becomes a wake instead: the palace guard (the kit's `imperial_guard`) wakes
  on `{ kind: 'tile', anchor: 'throne', by: { group: 'column' } }` (`02` §3.4), and his clamp
  engages on arrival through `04` §10.4's clamp gate, which needs no phase. (With `seated` as
  phase 0, an intercepted column would never advance it and the bar phases would never arm.)
- **Bar 1** wakes the palace guard if it still sleeps (`onEnter.wake`), drops `shielded`,
  and raises the parade ground's barriers (`onEnter.setTiles`: the market's stalls become
  Wall on two anchored tiles, never under a unit). **The last bar** gives `regenerator` and
  the enrage layer. The gate wave keeps `04`'s `afterContact 3, latest parOffset −2` on
  Nightfall; on Black Sun its `when` is `{ kind: 'bossBar', broken: 2, fallback: { kind:
  'bossHp', below: 0.25 }, latest: { parOffset: -2 } }`, the same clock as its `latest`.
- **If he is caught on the avenue** (intercept plan): the column is his court; the palace
  guard's `tile` wake never fires, but bar 1 still wakes it, and it comes down the steps to
  him (`hunt` `together`; `02` has no "seek a moving tile").
- **Bonus** stays the standard-bearer `slay` by turn 4 (`04`), with Vision as the other side
  of its reward choice on Act IV (§6).
- `04` open question 5 (always the Parade on Dusk?): **decided no** (owner, 2026-10-10), and
  further: Dusk never meets the Parade. Dusk's final battle is the Emperor's kit on today's
  maps and the bastion's variants, so every Dusk player meets the Arithmetic.

### 8.5 The Dueling Halls (Act III boss, 22x12; a boss that moves between arenas)

Nightfall and Black Sun only (owner decision, 2026-10-10), at `04` §6.1's boss share.

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
- **The twist.** On the half he turns back (`unclamp` back: `seek_tile` the throne, then
  the clamp) and **the doors close behind him** except one (`terrain`, a keyed choice: hall 1's north or south door
  stays open; `TerrainPhases` never closes a door under a unit, and a unit in a doorway
  holds it open: that is the counter; `04` §8.2 check 3 proves every lord move type still
  reaches the throne after the phase). Every hall's court wakes. The army crosses the yards
  or the one open hall to the throne.
- **Groups:** his group (1), hall courts 2 / 2 / 3 (`dormant`), a yard picket (2,
  `picket`) so the yard is never free.
- **Choices:** doors N/S (mirrorY); which door stays open; which hall holds the proof (the
  bonus); pillar variants per hall. 8 combinations.
- **Bonus:** `reach` the proof (a weapon on a Fort in hall 2) with `deadline: { byTurn }`
  locked as `par − 3` (§6's extension; a `mark` has no cadence to count) → Vision or gold.
  `04` §8.2 check 9's tile rule binds only kill-shaped maps; on this seize map the proof
  still lies on the way, hall 2 standing between the deploy and the throne on every
  combination.
- **Estimate:** 9–11 at Nightfall counts, by hand with `04` §8.3's formula (2 turns to the
  doorway, the duel 3–4, the walk to the throne 3, the stone); not yet run through the
  validator, which must confirm it. Needs `01`'s desktop camera (22 wide).
- **New vs reused:** `02` patrol (PR 2.4), `tile by: group`, `03` phases, `TerrainPhases`,
  the kit's `mark`. New: nothing beyond the clamp gate the Parade needs and §6's `reach`
  deadline.

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
- **The Emperor's signature here is `volley`** (`signatureOverride`, a new `setPieces.json`
  field allowed on a set piece that pins the boss): **The Arithmetic, applied**: cadence
  `afterContact 1, every 2, latest parOffset −4`, 3 tiles, `weapon: "Breachbolt"`,
  `source: battery` (the battery's highest MAG, §5.2: a General has little MAG of his own;
  with no gunner left the volley stops), fired "by the battery" (the tell names it). His
  `shielded` bar and the guard-on-bar-1 stay from the kit.
- **Engines.** Two ballistae (`04` §3.2 anchors with `feature: 'Ballista'`; Nightfall+ as
  today's rule, so the Battery is Nightfall+ only) are `claim` points: a claimed ballista
  fires for the player (`BallistaEngine` capture, as today). A `battery` court group of 2
  Sages carrying `siegeWeapon: "Breachbolt"` stands on the wall and plants whenever a
  player unit is in its 3–10 ring (`SiegeArtillery` stance), firing like any siege caster;
  the kit's volley is on top of them, so the tell is what the player watches.
- **The breach is a wake, not a phase.** The battery is a `dormant` group whose members
  keep their artillery role (`02` §3.3), woken by `tile` on either stair top with
  `onWake: { mode: 'seek', anchor: 'stair_foot', then: 'hunt' }` (a `seek_tile` unit takes no
  artillery stance, `SiegeArtillery.js:35` `OWN_ORDERS`: the battery comes down); the
  household wakes on the same trigger. The phases are the kit's bars, so a flier who breaks
  his bar before anyone takes a stair never leaves the phase machine waiting.
- **Choices:** south stair present or walled; which ballista is live (the other is a
  broken emplacement, Floor); the ditch's crossing (one dry causeway N or S). 8
  combinations.
- **Bonus:** `claim` either ballista before the third volley (`deadline: { signatureCount:
  3 }`) → Vision or gold.
- **Estimate:** 11–12 by hand (3 turns to the wall under two volleys, the stair fight 3, the
  throne 3, two stones on Black Sun). The upper edge of the band: the ditch is Bog on
  purpose and the validator will tell us if it is one tile too wide.
- **New vs reused:** `03` `claim`, `04` ballista anchors, `SiegeArtillery`, the kit's
  volley. New: a siege tome in a court member's hands is today's `siegeWeaponConfig` roll
  made certain for a named spawn: the set-piece generator writes `spawn.siegeWeapon:
  "Breachbolt"` (the field `CasterGear` writes, a weapon name that
  `EnemySpawnGear.applyEnemySpawnGear` already equips with the unit's own weapons kept
  behind it). It is not a template scripted-spawn key: `MapTemplateEngine`'s scripted
  spawns allow only `col`, `row`, `className`, `level`, `sunderWeapon`, `poisonWeapon`,
  `aiMode` and `affixes` (`:128-137`).

### 8.7 Sanctum of Echoes (finale, 24x16, Black Sun; refined from `04` §9)

- `defeat` the Entity (`03` §5.4; `isEntity` stays the one footprint rule; the procedural
  sanctum is a seize, §1.3 item 7) / `claim` 2 of 4 pillars as a feat (§8.2's rule on a
  bigger floor; nothing pays after the finale, §6).
- **Wardens:** one `dormant` pod per pillar (2 each), wake on `tile` of its pillar or
  `hurt`: holding a pillar means holding it against its warden.
- **Echoes:** the `bossHp` waves of §8.2 (thirds), `latest` the sanctum's turns, from the
  three far edges.
- **Approach chunks:** two of four pillars are **lit** at generation (a keyed choice, `04`
  §3.5): lit pillars are the ones that count for the bonus and the splash; the others are
  Pillar terrain. So the player reads which two matter from turn 1.
- **Estimate:** 11–12 by hand (the walk 4, the Entity's 120 base HP (`classes.json`; more
  with its level and `BOSS_STAT_BONUS`) against the army's Act IV damage 6–7). Needs `01`
  in full (24x16).
- **Rung:** Black Sun only in v1 (`04` Q7; §8.2). The hum, the hinge, the rally: unchanged.

### 8.8 Catalogue, this spec's additions

| Set piece | Size | Slot | Primary / bonus | Boss | New engine needs |
|---|---|---|---|---|---|
| Long Road to the Keep (refined) | 22x14 | boss III, Nightfall+ | seize / `claim` ballista or `reach` | prefers Iron Wall | none beyond `02`/`03`, the kit |
| The Emperor's Parade (refined) | 24x14 | boss IV, Nightfall+ | seize / `slay` the standard-bearer | the Emperor | the marching-boss clamp gate |
| The Dueling Halls | 22x12 | boss III, Nightfall+ | seize / `reach` the proof | prefers Blade Lord | the same clamp gate; `02` patrol |
| The Battery | 24x14 | boss IV, Nightfall+ | seize / `claim` a ballista | the Emperor | a named siege spawn; `signatureOverride` |
| Sanctum of Echoes (refined) | 24x16 | finale, Black Sun | `defeat` / `claim` 2 pillars (a feat) | the Entity | `03` `claim` on points with `need` (PRs 5, 7); the echo rule |

Every boss set piece is Nightfall and up (owner decision, 2026-10-10): Dusk and First Light
meet their bosses on today's maps with their kits.

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

- Par is `02` §5.2's and nothing here changes its formula. A kit map writes `objectives`, so
  it is priced by `groups-v1` (§4.1 "Par"): W from the derived seize `parRoute`, S from the
  engagements (the court's sleeping groups count where their spawn-time Danger tiles touch
  the route), `parAdjust` = `03`'s boss bars, one turn per stone. A kit adds **no par
  term**: its phases change the court's posture and the arena, not the walk, and the court
  is a partition of today's count (`02` §5.1). What can move a kit map's par against today's
  `calculatePar` is `groups-v1` itself, held by `02` §5.2's calibration (First Light within
  ±1 of today on maps without pods). A First Light kit writes no `objectives` (signature
  only, §9.5), so First Light's boss par is today's `calculatePar` exactly. A `volley` can
  make a turn cost a heal; that is pressure, not a wall, and the sims (§11) must show the
  push median stays inside par − 4 … par − 2 on each kit (`04` §11's target).
- Enrage is untouched (`02` PR 0a: never before par + 1). A kit's cadence `latest` is
  validated ≤ `parOffset −2`, so every cadenced signature has resolved at least once before
  enrage, and no kit gives the boss a second wind at enrage: the last bar's `regenerator`
  (the Emperor) is a bar trigger, which on a push comes before enrage and on a turtle is
  already lost ground.
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

### 9.5 The rung ladder, and First Light

**The owner's ladder (2026-10-10, README §6).** The owner left the details to this spec and
agreed the rule "Act I boss stays simple everywhere; scale grows with the rung":

| Rung | Act I boss | Act II boss | Act III–IV bosses (and the finale's) | Boss set pieces |
|---|---|---|---|---|
| First Light | today's map, nothing new | today's map; at most one gentle, telegraphed, never-lethal signature and nothing else from the kit (no court, phase, affix or bonus); no new arena or arena variant | today's arenas (variant 0) + that gentle signature, nothing else | none |
| Dusk | today's map, nothing new | the new arena (`act2_doctrine_yard`), arena variants, sleeping courts and the full signature start here | full enhancements on today's arenas and their variants | none (no Long Road, Parade, Dueling Halls or Battery) |
| Nightfall / Black Sun | today's map, nothing new | as Dusk | full enhancements | all of §8; Sanctum of Echoes on Black Sun only |

(Ordinary and elite set pieces: none on First Light, 20x12 or less on Dusk, all from
Nightfall: `04` §6.1.)

- **"Act I boss: today's map, nothing new"** means no Act I arena, no Act I kit or signature
  and no court, on every rung; Phase 0's fixes still apply. §7.1's designs and
  `act1_border_post` are deferred, out of scope by owner decision. The Iron Captain and the
  Warchief are `kitless` (§10.1); the arena post-pass skips Act I (§4.4).
- **"Full signature"** on Dusk means the kit's own values (its tile counts, aura values and
  wave sizes), not First Light's gentler ones. Whether Dusk's volley may kill is still §13
  Q2; this spec keeps `volleyLethal: false` on Dusk until the owner answers it.
- **The strict reading (decided 2026-10-10).** On First Light "at most one gentle
  signature" is the whole kit: no court orders (awake or sleeping), no affix at the half or
  a phase, no kit bonus, no phase beyond today's.
- **This answers §13 Q1, Q5 and Q10.** Q1 (is a v1 hybrid template a "set piece" on First
  Light?) no longer matters: First Light gets no new arena and no variant whatever the
  word means, and keeps today's maps exactly. Q5 (an affix at the half on First Light): none.
  Q10 (sleeping courts on First Light): no court of any kind, on any act.

**What counts as a set piece.** A set piece is `04`'s format: a node carrying
`battleParams.setPiece`, assembled by `SetPieceGenerator` from a skeleton, chunks and
seeded choices at a fixed size. A `bossOnly` hybrid v1 template is not one: it is today's
procedural template format (zones, structures, a fixed arena block, absolute overrides and
waves). First Light already plays the keep on its Act III boss maps today, and under the
ladder it goes on playing it as it is (variant 0), at today's sizes, inside the 640x480
canvas at zoom 1.

**First Light, exactly:**
- **Never:** a set piece in any slot (`04`'s First Light row is all zeros, validated), a
  boss set piece, `signatureOverride`, a new map format, a new arena (the yard is
  `shareOnly`, §4.4, so the ordinary draw never brings it), an arena variant (no variant is
  drawn or written there, §4.4), an arena share (`bossKits.arenaShare` 0, validated), and
  anything new in Act I.
- **Maps:** today's maps exactly: the procedural seize templates, the v1 keep as it stands
  where the ordinary draw picks it (about 27% of Act III boss maps), and `eldritch_sanctum`
  as it stands for the Lieutenant.
- **From Act II, a kit compiles to its signature alone (the strict reading, decided
  2026-10-10).** `BossKit.compile` for `normal` writes `bossKit` and `bossSignature` (and
  the anchors the signature names) and nothing else:
  - **At most one signature**, told a whole player phase ahead like every signature (§5.1),
    at gentle `byRung.normal` values and never lethal: volleys never kill
    (`bossKits.volleyLethal: false`) and strike one tile fewer; auras are one point lower
    and reach the non-boss enemies near the boss (no court is compiled, §5.2); a `wave`
    brings 2. Only the kinds `volley`, `aura`, `wave`, `mark` and `foretell` compile there.
    A signature built on `court_order`, `affix`, `unclamp` or `terrain` compiles to none, so
    the Knight Commander's First Light kit is empty (§7.2).
  - **No court:** no group, awake or sleeping, and no court order. The boss's escorts are
    today's First Light guards as `generateEnemies` and the template roll them (`02` §3.5
    gives First Light seize maps no groups), and the boss keeps today's throne clamp.
  - **No phase:** no `objectives` and no phase record; the half-HP point is today's
    `halfHealth` line and nothing more (no band, no affix, no unclamp, no court order, no
    signature patch). So par is today's `calculatePar` (§9.3).
  - **No affix**, no `unclamp`, no `clampTile`.
  - **No kit bonus**, so never a Vision offer either (`03` §7.4: "none on First Light").
- **Presentation:** the card's third line (the signature's name and sentence; none for an
  empty kit), the tell and its strip row, `guide_boss_tell`, since a tell is the gentlest
  teacher there is. No phase band or tick (there is no phase). The first tell a First Light
  player meets is an Act II boss's (the Dark Rider's orders or the Archmage's Calculation).
- **Old clients:** First Light is not exempt from the run-format guard. It has no set piece,
  arena, group or phase, but a signature alone is still a kit: a First Light run with kits
  on holds the `bossKit` capability (detected from the run's `bossKits.enabled` snapshot,
  the locked config's `bossKit` / `bossSignature` or the checkpoint's `bossState`), so it
  requires the newer client and stays local-only until `CLOUD_SAFE_RUN_FORMAT` is raised
  (`04` §12.1, test 23: a First Light, non-set-piece Act II boss run with the Archmage's
  signature-only kit). A Dark Rider kit there also writes `triggeredWaves` (`encounters`).

**Dusk, exactly:** Act I as on every rung. Act II meets the whole kit (courts, sleeping
ones included, phases, affixes, bonus, the full signature) and the yard and the variants at
the 0.75 share. Acts III–IV meet the full kits on the
procedural templates, the keep and the bastion and their variants. No boss set piece: the
Emperor, Dusk's last battle, is his kit on those maps (§8.4).

Why the signature and no more on First Light: these are the fights the most-played rung
spends the most time in, and the signature is where a boss stops being a stat block; a tell
told a whole player phase ahead is the gentlest new thing a boss can do, and the rest of the
kit (courts, phases, affixes, bonuses) waits for the rung above. The set-piece ban is about
size and multi-objective load (`04` Q1), not about bosses having character. Why Act I stays
as it is: it is every new player's first boss, and the owner wants that fight plain on every
rung.

## 10. Data model and modules

### 10.1 Data

- `enemies.json` `bossKits` (§4.1), validated by `engine/BossKitValidation.js` in
  `npm run validate:data`: every boss in `bosses` has a kit or is listed in `kitless` (the
  Entity's kit is the echo rule only); every Act I boss is in `kitless` and has no kit (owner
  decision, 2026-10-10: the Iron Captain and the Warchief); a kit has at most one
  `signature`; signature kinds known; `bossBar` triggers carry a `fallback` that is a
  `bossHp` or `turn` trigger; a cadence's `latest` is ≤ `parOffset −2`; affix ids exist in
  `affixes.json`, and a kit's affix passes the class and mutual rules for the boss's class
  on every rung, `excludedAffixes` included (a per-run Sworn affix is checked at compile,
  §5.2); court shares sum ≤ 1; a `volley`'s `weapon` is a siege tome in `weapons.json`
  (`special: "Siege magic"`); a kit's bonus is `03`-valid, at most one, and never a `slay`
  on a primary's target or a throne's guard; **a kit compiled for First Light (`normal`) is
  signature-only** (§9.5, the strict reading decided 2026-10-10): the validator compiles
  every kit for `normal` and refuses any output beyond `bossKit`, `bossSignature` and the
  anchors the signature names (no `encounterGroups` from a court, no `objectives`, phase or
  bonus, no affix, `unclamp` or `clampTile`), a signature of a kind other than `volley`,
  `aura`, `wave`, `mark` or `foretell` there, and a First Light volley that can kill;
  `foretell` only on a fog-free template; `byRung` keys are rungs; content keys exist in
  `dialogue.json` and `bossKitContent.js`; lines ≤ 90 characters.
- `dialogue.json` `bossEncounters.<boss>.phases.<id>` (the `halfHealth` shape).
- `mapTemplates.json`: `arenaVariants` on `bossOnly` templates (validated by
  `MapTemplateEngine.validateMapTemplatesConfig` per variant, `02` PR 0b's override-on-wave
  check included); `act2_doctrine_yard` with `shareOnly: true` (§4.4; `shareOnly` only on a
  `bossOnly` template); no `bossOnly` template lists `act1` (`act1_border_post` is deferred,
  owner decision). The sanctum's `echo_1..4` are derived at generation from its
  `pillar_grid` (§8.2), not authored.
- `setPieces.json`: `boss: { weights }`, `signatureOverride`, `04`'s fields.
- `difficulty.json` `modes.<rung>.bossKits: { enabled, volleyLethal, arenaShare }` (every
  rung, `dusk` included, validated like the other rung tables; First Light
  `volleyLethal: false`, `arenaShare` 0, and the validator refuses any other share there
  (owner decision, 2026-10-10); Dusk `volleyLethal: false`, 0.75; Nightfall and Black Sun
  `volleyLethal: true`, 0.75). These are the values each switch is turned on with; all ship
  at `enabled: false` and `arenaShare` 0 (§12 "Gating"). Snapshotted into the run's
  difficulty modifiers at run start, so a run keeps its values; a run saved before has none
  (no kits, no share).
- `turnBonus.json`: nothing. `objectives.json` (`03`): `bonusRewards.visionOffer` 0.5 for
  boss-map bonuses on Dusk+ Act III+.

### 10.2 Config and battle state

| Where | Field | Written by | Read by |
|---|---|---|---|
| `battleConfig` | `objectives.phases` (kit phases), `encounterGroups` (courts), `anchors` (derived or chunk), `triggeredWaves`, `bossSignature` (resolved), `bossKit: { id, version }` | `BossKit.compile` at generation, locked | `03`, `02`, `BossSignature`, display |
| boss spawn | `clampTile`, `bossKit` | compile | `EnemySpawnGear` (and `03` PR 1b's clamp) |
| battle state | `bossState: { version, signature: { pending, firedTurns, count, marked }, pillars: [ids], musicLatch }` | `BossSignature`, the echo rule, `onBossPhase` | checkpoint, Vision, validator, strip, the AI's mark term |
| `battleParams` | `arenaVariant`; `templateId` (rewritten by the share) | node post-pass | `MapGenerator` hybrid overlay |
| run | `bonusVisionActs` (`03`) | `BonusSettlement` | the reward choice at generation |
| run save | `requiresClient`, `requiresCapabilities` (`bossKit`, with `encounters`, `objectives`, `parModel`, `arena` as the config writes them; `04` §12.1) | `toJSON`, derived by `RunFormat.requiredRunFormat` from the snapshot, the config and `bossState` | the loader, the slot card, `isLocalOnlyRunSave` |
| run records | `bonusFeats` (finale bonuses, §6) | `completeBattle` on the finale | `RunRecords` |

An old checkpoint without `bossState` derives it empty; a config without `bossSignature`
has no signature; a template without `arenaVariants` has one.

**Old clients.** A kit is a capability of its own, not a property of set pieces. An older
client that loaded a kit run would play the old boss rules and write a checkpoint without
`bossState`, so the guard is keyed on the kit's own marks (`04` §12.1), and `BossKit.compile`
and `assignBossArenas` are not merged ahead of `04` PR A0.

### 10.3 Modules

| Module | Role | Called by |
|---|---|---|
| `engine/BossKit.js` | `compileBossKit(kit, config, rung, deps)` → config fields; `deriveBossAnchors`; court partition; First Light's compile (§9.5); the rung collapse of coincident phases; the arena share post-pass `assignBossArenas(nodeMap, ctx)` (Acts II–IV; no variant and no share on First Light) | `MapGenerator` (procedural and v1 arenas), `SetPieceGenerator`; `RunManager` beside `assignSetPieces` |
| `engine/BossKitValidation.js` | §10.1's checks | `tools/validateSchemas.js` (`npm run validate:data`) |
| `engine/BossSignature.js` | resolve / plan / view (§5.1); the kind table | `02`'s check (slot 7b) in `BattleScene` and `HeadlessBattle`; the strip model; the inspect panel |
| `engine/EncounterTriggers.js` (`02`) | `bossBar`, `bossHp` kinds, slot 2b | — |
| `engine/EntitySystem.js` | new: `entitySplashCountFor(held)`, `heldPillars(positions, anchors)`, and the splash step moved out of the scene | `BattleScene` and `HeadlessBattle` (the harness splashes from K6), `BattleMusicController` (hum) |
| `engine/AffixEngine.js` / `engine/AffixSystem.js` | `kitAffixAllowed` (exports the private `isAffixAllowed` rule with the rung's `excludedAffixes`); one mid-battle affix applier that also applies `getAffixMovBonus` | `BossKit.compile`, `BossSignature`, the scene's and the harness's spawn paths |
| `engine/AIController.js` | the marked-target score term (from the `bossState` it is handed, not an affix `aiOverride`); `previewDecision`; the marching-boss clamp gate (`04` §10.4) | — |
| `engine/NarrativeDirector.js` | the `unitOnField` `when` key (§8.1; deferred with the Lieutenant's half) | phase lines |
| `ui/BossPresenceController.js` | phase ticks, the tell in `summaryLine` | — |
| `ui/BattleMusicController.js` | `onBossPhase('card' \| 'enrage')` | the phase band |
| `src/data/bossKitContent.js` | bands, tells, inspect lines, the card's third line, `guide_boss_tell` | ceremonies, strip, Guidance |

Harness parity (CLAUDE.md): `HeadlessBattle` calls `BossSignature` in the same check and
builds boss units through `applyEnemySpawnGear`; it keeps no copy of any kit rule. Its
`_applyDueHybridOverridesForTurn` (`HeadlessBattle.js:1039`) is deleted by `02` PR 0b. Two
gaps close with this work (§1.5): the Entity's splash (K6) and a `haste` affix's MOV (K1,
through the shared applier).

### 10.4 Determinism

| Draw | Stream |
|---|---|
| arena variant, arena share | `keyedBattleRandom(runSeed, 'boss-arena:<nodeId>')` / `'boss-arena-share:<nodeId>'`, in the post-pass after the node map |
| a kit's keyed choices (which flank) | `keyedBattleRandom(battleSeed, 'boss-kit:<boss>:<choice>')` |
| a set piece's boss pick | `keyedBattleRandom(battleSeed, 'setpiece:<id>:boss')`; the procedural `Math.random` pick is skipped on that path only |
| signature draws (which flank, which tiles among equals) | `keyedBattleRandom(battleSeed, 'boss-sig:<turn>:<n>')` |
| bonus reward choice | `keyedBattleRandom(battleSeed, 'bonus-reward:<id>')` |
| court partition, anchors, First Light's compile | no draw |

No existing stream gains a draw. A seeded run's maps are byte-identical apart from the new
fields and the boss node's template where the share replaced it (the new arena is `shareOnly`,
so the ordinary pick runs over today's list and never moves, §4.4); Act I's boss maps, and
First Light's on every act but for a kit's fields, are byte-identical to today's; a kit's
affix at a phase is applied at the check from data, never rolled. The one battle-stream change
is the Entity's splash: with a pillar held it rolls fewer damage draws, so the rest of that
finale's stream differs, deterministically (§8.2).

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
| 7 | a volley kills on First Light or Dusk, kills the commander on any rung, counters, or gives XP | hand cases per rung (the commander at 1 HP on a fixed tile survives on Black Sun); `awardScaledXP` never reached; the RNG cursor unchanged by a resolve |
| 8 | `mark` targets a hidden or dead unit, or the wrong one | last-striker bookkeeping over a counter-kill, a Dance refresh, a Steal; a dead marked unit clears |
| 9 | `foretell` writes AI state | `previewDecision` leaves `guardPost`, `weapon`, `_aiNoMoveStreak`, `_lastAiDecision` and the unit untouched (deep equality); the real decision next phase equals the preview on an unchanged board |
| 10 | the echo rule and the hum disagree, or the harness still never splashes | `entitySplashCountFor` by hand (0 / 1 / 2 held); the hum gain by hand; paired worlds differing by a hidden unit hold the same pillars (pillars read player positions only); the scene and the harness splash the same tiles for the same damage on one seed and board |
| 11 | a kit affix breaks the rung's rules | each rung's excluded affixes, class exclusions and the mutual table hold on every kit × Dusk+ rung; no kit affix compiles on First Light (`validate:data`) |
| 12 | a court partition changes a hold pack's wake | golden wake record (`02` §3.6) on Dusk+ boss maps with kits: the same packs wake for the same reasons |
| 13 | the arena share or variant moves the node map | 50 seeds: node types, `battleSeed`, edges, templates of non-boss nodes equal; the boss node's `templateId` differs only by the share (the `shareOnly` yard never changes the ordinary pick); a variant-0 config equals today's byte for byte |
| 14 | a Vision bonus pays twice, or on the wrong act | `BonusSettlement.test.js`: once per `completeBattle`; `bonusVisionActs`; never on the finale; a revert before the commit pays nothing |
| 15 | a bonus deadline and the tell disagree | the strip's "n to go" equals `pending`/`count` across a resume |
| 16 | the scene and the harness differ | every kit × rung × 2 seeds through `HeadlessBattle` with `ScriptedAgent` to the end; scene snapshots at fixed turns equal the harness's (`GridParity` style) |
| 17 | words lie about fog | strip, band and history words for a hidden tell carry no position (the `PlayerKnowledgePreviews` pattern) |
| 18 | a boss set piece's boss pick changes a procedural map | the set-piece path skips the pick; a procedural boss map's pick is unchanged for the seed |
| 19 | the closing doors trap or crush | `TerrainPhases` never closes a door under a unit; after the half, every lord move type reaches the throne (validator check 3 after each phase, `04` §8.2) |
| 20 | a kit's phases collapse wrongly on a rung | the Emperor on Dusk and Nightfall: two phases, the second running bar-1's and the last bar's effects in order; on Black Sun three |
| 21 | a boss seized in an earlier phase does not win | a Dusk boss with no stone taken from above half to 0 and seized in phase 0: victory on the Seize, no remaining phase enters (§4.5) |
| 22 | First Light meets more than one gentle signature (the strict reading) | every kit compiled for `normal` writes only `bossKit`, `bossSignature` and the signature's anchors: no `encounterGroups` from a court (awake or sleeping), no `objectives`, phase or bonus (so no Vision offer), no affix, `unclamp` or `clampTile`; at most one signature, of an allowed kind, none that can kill; the Knight Commander compiles to an empty kit; a First Light boss config's par equals today's `calculatePar`. Plant: let the compiler keep the court as an awake guard |
| 23 | a mid-battle `haste` moves the boss in the scene but not the harness | the Blade Lord's half on Nightfall in both worlds: equal MOV and equal path |
| 24 | a Sworn affix and a kit affix break the mutual table | a Sworn `regenerator` Emperor compiles with no `shielded` and no band word for it |
| 25 | a fallen boss resolves its tell or takes its affix | a boss killed with a volley pending: no resolve; the next phase applies its court orders but no affix |
| 26 | a finale bonus pays something | the Entity's two-pillar `claim` done on Nightfall: gold, convoy and Vision unchanged at the commit; the run's records list the feat (the Lieutenant's bonus is deferred: First Light kits carry none) |
| 27 | Act I gains something (the owner's ladder) | 50 seeds × every rung with kits and arenas switched on: every Act I boss node's params and locked config equal the switches-off run's byte for byte (no `arenaVariant`, no `bossKit`, no court, no phase); `validate:data` refuses a kit for an Iron Captain or Warchief, and a `bossOnly` template that lists `act1`. Plant: let the post-pass or the compiler run on Act I |
| 28 | First Light meets a new arena or a variant | 50 First Light seeds with kits and arenas on: no node carries `arenaVariant`, the yard is never a boss node's template, a keep drawn by the ordinary pick plays today's config byte for byte (kit fields aside); a First Light `arenaShare` above 0 fails `validate:data`; the `arena` capability is never derived. Plant: drop `shareOnly` from the ordinary draw's filter |

**Sims.** `sim/pacing.js --bossKits` on 48 paired seeds per rung and act: push median inside
par − 4 … par − 2 per boss (the kit may not cost more than one turn against today), turtle
− push ≥ today's gap, force-won stalls ≤ today's, and a per-boss table of signature
resolves per battle and units felled by a volley (target: 0 on First Light and Dusk, where
it cannot kill; under 0.1 per battle on Nightfall), and par against today's per boss on
Dusk (`groups-v1` within ±1, §9.3; First Light's par is today's exactly, its kits writing
no `objectives`). The converted sanctum waves (§8.2) run
paired against today's absolute waves before they ship. `test:harness:pr` and
`sim:fullrun:pr` with threshold notes if a slice moves (the harness's new Entity splash
moves the finale slice).

**Browser specs** (each in a `tests/e2e/lanes.json` lane): `boss-kit-tell.spec.js`
(`run-flow`): an Act II Archmage battle on the dev route; the tell appears, the strip names
it, a unit steps off, the volley strikes the empty tile; a refresh mid-tell restores it;
desktop and 844x390. `portrait-boss-tell.spec.js` (`portrait`): the same upright.
`boss-arena-variant.spec.js` (`run-flow`; there is no `battle` lane in `tests/e2e/lanes.json`): two Dusk seeds, two variants, the card's third line; a First Light seed on the same node plays today's map.

## 12. Rollout

Ordered for the biggest felt improvement at the least cost. PR numbers of the other specs
are theirs: `01` §5 (PRs 1–10), `02` §8 (0a–0e, 2.0–2.6), `03` §14 (1, 1b, 2–7), `04` §14
(A–F, G…).

| PR | Content | Needs | Behaviour change | Effort |
|---|---|---|---|---|
| **K0** | **Arenas from Act II, Dusk and up** (`arena` capability): `arenaVariants` on the keep and the bastion (2 variants each, variant 0 today's data), `act2_doctrine_yard` and its `shareOnly` filter in the ordinary draw, the arena share post-pass (Acts II–IV; no variant drawn on First Light) and `bossKits.arenaShare` per rung with First Light's 0 validated, the card's third line (data-driven, empty until K1), phase ticks on the bar (none until K1); tests 13, 27 (the arena half) and 28. No Act I arena (`act1_border_post` is deferred, owner decision 2026-10-10) | `04` PR A0 (the run-format guard: K0 is the earliest writer in this track); `02` PR 0b (the wall/wave fix, `TerrainPhases` and the override-on-wave validator, so the new variants are born correct) | on Dusk and up, Act II–IV boss nodes meet an arena whenever the act has one of the drawn biome, at the rung's share (0.75); Act II gets one; First Light and Act I keep today's maps exactly | 2.5 days + art review of the yard and the variants' blocks |
| **K1** | **Kit data, compile and triggers**: `bossKits` schema and `BossKitValidation` (Act I's bosses `kitless`, test 27's kit half), `BossKit.compile` (courts, anchors, phases, bonus slot, First Light's signature-only compile and its validation, test 22, the rung collapse), `bossBar` / `bossHp` in `02`'s check (slot 2b), `bossState` persistence, §4.5's shared-primary rule, `onBossPhase` music, phase bands and lines, `guide_boss_tell`, the shared mid-battle affix applier (closing the `haste` MOV gap); `BossSignature.js`'s core (resolve / plan / view, slot 7b, `bossState.signature`) with the kinds the Knight Commander uses (`court_order`, `affix`, `unclamp`); the **Knight Commander's kit** (Act II, §7.2). No Act I kit (deferred, owner decision 2026-10-10) | `04` PR A0 (the `bossKit`, `encounters`, `objectives` and `parModel` capabilities this PR first writes); `02` PRs 2.1, 2.2a (groups, warn bands, outlines), 2.2b (the `phase` slot calling `checkPhase`, the hostile-exchange hook), 2.4 (`guard` / `seek` posts and `together` for court orders), 2.5 (`groups-v1`: a kit config writes `objectives`, `02` §5.2 "Which model"); `03` PRs 1 (the model), 1b (`clampTile`, for `unclamp`), 3 (`objectiveState`), 4 (phases, which itself follows `02` PR 0b) | on Dusk and up the Knight Commander has two acts and a readable court; on First Light nothing changes (his signature is a court order, so his First Light kit is empty, §7.2); Act I's bosses unchanged on every rung; kit maps are priced by `groups-v1` | 5 days (one kit instead of Act I's two, but his wedge pick and his ride off the throne are the harder half) |
| **K2** | `BossSignature.js`'s `aura`, `terrain` and `wave` kinds; the marching-boss clamp gate (`04` §10.4's rule, first used by the Dark Rider; `04` PR F reuses it); the **other Act II and the Act III kits** (the Dark Rider, the Archmage, the Blade Lord, the Iron Wall, the Berserker King) but the Archmage's volley and the Blade Lord's mark | K1; `02` PR 2.3 (triggered waves) | Acts II–III bosses have signatures | 4 days + 1 tuning |
| **K3** | `volley` and `mark` (the Archmage, the Blade Lord); the forecast's volley line; the marked-target score term in `_scoreAttackTarget` | K2 | the two bosses with a per-unit threat | 3 days |
| **K4** | **The Emperor's kit** (bars, `shielded`, the guard, the last bar's `regenerator` and enrage layer, the Nightfall+ gate wave), the bar-1 `setTiles` on the bastion's variants (the v1 overrides stay) | K2 (K0 for the variants) | Act IV's one boss has three acts on Black Sun, two on Dusk and Nightfall | 2 days |
| **K5** | **Boss-map bonuses and Vision**: the kit's bonus, `deadline` on `reach` / `claim` (`signatureCount`, `byTurn`), the reward choice at generation (`visionOffer`, the `fallback` side), the finale's feats (`bonusFeats`) | K1; `03` PR 5 (`slay`, `reach`, `claim`, the validator; its later parts `unbloodied` and the `vision` reward) | a bonus on every boss map from Act II on Dusk and up (none in Act I or on First Light); Vision from Act III on Dusk+ | 2 days |
| **K6** | **The finale**: `foretell` and `previewDecision` (the Lieutenant's whole First Light kit; his half, Sera line, `unitOnField` key and feat are deferred, §8.1); the echo pillars, the splash moved into `EntitySystem` (the harness splashes), the hum term, the sanctum's derived anchors; the Entity's T4/T7 waves as `bossHp` triggered waves once the paired sims pass (Nightfall and Black Sun; First Light's sanctum keeps its absolute waves) | K2 (`02` PR 2.3 rides it); the pillar bonus also needs `03` PR 5 (`claim`) and PR 7 (capture points), with `need` (Notes); the splash, hum and waves need only positions and ship first | the Lieutenant shows his hand; the Entity can be quieted | 3 days |
| **K7** | Long Road refined (boss weights, the half's drawbridge `until` list, the ballista `claim`) | `04` PR E; K2; `01` PRs 3–5, 7, 8 (as `04` E) | — | 1 day on top of E |
| **K8** | The Parade refined (bars as phases, `seated` as a wake) | `04` PR F; K4; `01` as K7 | — | 1 day on top of F |
| **K9** | The Dueling Halls | `04` PR E (hybrid v2) and the marching-boss clamp gate (K2, or `04` PR F); K3; K5 (the `reach` deadline); `01` PRs 3–5, 7, 8 (22 wide) | a second Act III boss set piece | 4 days + 1 tuning |
| **K10** | The Battery | `04` PR F; `03` PR 5 (`claim`); K3 (`volley`), K4, K5; `01` as K7 | a second Act IV boss set piece, Nightfall+ | 4 days + 1 tuning |
| **K11** | Sanctum of Echoes refined (wardens, lit pillars) | `04` PR G… (the finale slot and Sanctum of Echoes); K6; `03` PRs 5, 7; `01` PRs 3–5, 7, 8 (24x16) | Black Sun's finale variant | 3 days |

**Gating.** The boss track does not wait for the set-piece track, and does not ride on it.
- **The guard** (`04` PR A0) is a dependency of K0 and K1, the earliest PRs here that can
  write a capability. It does not depend on any set piece (`04` §12.1).
- **Kits ship dark.** `bossKits.enabled` is `false` and `arenaShare` is 0 on every rung when
  K0 and K1 merge; a rung's switch goes on in its own change, with §11's `--bossKits` report,
  so the difficulty effect of kits is read apart from larger maps' and from each other
  rung's.
- **The slice first.** No kit or arena switch is turned on until the Mill Ford has passed its
  exit criteria (README §5 "Rollout gates"): the encounter and `groups-v1` par model that K1
  relies on is proven on one bounded map before it carries every boss battle.

**The cheapest big win is K0 then K1.** K0 needs nothing but `02` PR 0b and changes Act
II–IV boss maps on Dusk and up in a way the player sees on the first turn (the arena, the
card's line); First Light and Act I keep today's maps (owner decision, 2026-10-10). K1
brings the bars, the courts and the signature core to life with the first kit a Dusk+ run
meets, the Knight Commander's. First Light's first change comes with K2 and K3 (the Dark
Rider's orders, the Archmage's Calculation, each alone there); K1 needs `02`'s Phase
2 core (2.1, 2.2a, 2.2b, 2.4, 2.5) and `03` PRs 1, 1b, 3 and 4, so it lands with them: about
5 days of its own, no set piece and no camera work.

**What waits for the camera:** only the set pieces (K7–K11; 22 and 24 wide: `01` PRs 3–5,
7 and 8). Everything in K0–K6 plays on today's sizes.

**What waits for `03`:** K1's phases need `03` PR 4 (phases, with §4.5's shared-primary
rule), PR 3 (`objectiveState`) and PR 1b (`clampTile`). If `03` is late, K1 can ship a
trimmed kit, **K1-lite**: courts through `02`'s groups alone, a `dormant` court waking on a
`bossHp` trigger in slot 2b, with no phase record and no signature module. It needs `02`
PRs 2.1, 2.2a and 2.4 and the two trigger kinds. It writes `encounterGroups` but no
`objectives`, so its par stays `calculatePar` (`02` §5.2 "Which model") and it needs neither
`02` PR 2.5 nor `03`. The court's wake band plays and a sleeping court moves; there is no
terrain, no affix, no unclamp, no aura, and an awake court cannot be re-ordered (that needs a
phase). Since sleeping courts start at Dusk (§9.5), K1-lite does nothing on First Light. On
Dusk and up it is the Emperor's imperial guard sleeping at the steps and waking at his
first bar (or on `hurt`), without `shielded`, the bastion's walls or the last bar's
`regenerator`; the Knight Commander's wedge, which only his signature wakes, waits for K1.

## 13. Open questions for the owner

1. **Decided by the owner's ladder (2026-10-10, README §6; §9.5).** The question was
   whether a `bossOnly` hybrid template counts as a "set piece" on First Light, which would
   decide whether First Light got the new arenas, the variants and a 0.5 share. The ladder
   makes the reading moot: First Light gets no new arena, no variant and a 0 share
   (validated), and keeps today's v1 arenas as they are. K0 is Dusk and up.
2. **Volley lethality.** `lethal: false` on First Light and Dusk, lethal from Nightfall (the
   commander always floored at 1): or never lethal anywhere, so a boss can never fell a unit
   outside combat? The second is safer and weaker; the tell is a whole phase. The ladder
   fixes First Light as never lethal; its "full signature" on Dusk is read as the kit's own
   values (§9.5), so whether Dusk's volley may kill is still this question.
3. **Decided by the owner's rule (README §6.3):** Vision may be offered on any Act III+
   set-piece or boss-map bonus, at most once per act, never on First Light. This spec's
   boss maps offer it on half their draws (Dusk+); ordinary and elite set pieces may offer
   it too, and the once-per-act check (at generation and again at the commit, `03` §7.4)
   keeps the economy at one bonus charge an act. Still open: the share (`visionOffer` 0.5),
   tuned with `sim/pacing.js`.
4. **Decided (owner, 2026-10-10): the Emperor on Dusk is his kit on today's maps and the
   bastion's variants; Dusk never meets the Parade** (no boss set piece on Dusk, `04` §6.1).
5. **Decided (2026-10-10, the strict reading, §9.5): no affix on First Light**, at the half
   or any phase; a First Light kit is its one gentle signature and nothing else. The
   original question: tier-1 affixes outside First Light's `excludedAffixes` (`anchored`,
   `berserker`, `regenerator`), or only `court_order` and `aura`?
6. **Act II boss set piece** (The Second Push, 18x12): add it to Phase 6, or keep boss set
   pieces to Acts III–IV as the README's bands say? Under the ladder it would be Nightfall
   and up like every boss set piece.
7. **Boss weights on a set piece:** pin (Long Road is always the Iron Wall) or weight
   (recommended: 3 : 1 : 1, so a run can still meet the Blade Lord in the keep)?
8. **The Lieutenant's foretell:** is a shown-but-not-locked forecast honest enough, or
   should he be bound to it (locking an AI decision a phase ahead is a larger change and a
   stiffer fight)?
9. **Finale bonuses:** nothing a bonus pays outlives the last battle (gold is not converted
   at the run's end). A feat recorded in the run's records (this spec), a new reward that
   reaches the meta (Valor or Supply: a new `03` §7.4 key), or no bonus on the finale?
10. **Decided by the owner's ladder (2026-10-10): no sleeping court on First Light, on any
    act** (§9.5), and under the strict reading (decided 2026-10-10) no court at all: the
    kit compiles to its signature alone, and the boss's escorts are today's First Light
    guards. Courts, sleeping ones included, start at Dusk.

## Notes for the README

Items the owning spec should take in; none changes a rule of `01`–`04` until it does.
**All fifteen were taken in on 2026-10-09** (README revision 4; `01`–`04` revision 3): 1–7,
10–14 as written, 8 and 9 with a change (said under each), 15 where the files are the set's.

1. **Resolved (README §3, `02` §3.4):** two trigger kinds join README §3's table and `02`
   §3.4: `bossBar { broken: n | 'last', fallback }` (fallback a `bossHp` or `turn` trigger)
   and `bossHp { below: share }` (`currentHP < maxHP × share`, `checkBossHalfHealth`'s own
   test), both default delay 0, both "hurt-shaped", true for a fallen boss, both may carry
   `latest`. Group wakes and waves that name them are evaluated in a new slot **2b** after
   `hurt`; a phase `until` of either kind stays in the `phase` slot (7). The signature
   module runs in a slot **7b** after `phase`, before `turn`. `02` §5.1's awake-at-start
   rule also counts them as "never" (but their `latest` or a `turn` fallback).
2. **Resolved (README §3, `03` §6, `04` §10.3):** a phase `until` may be a list (any one
   fires, as a group's `wake` list): `04`'s Long Road drawbridge now writes one, with this
   spec's `bossBar` member (§8.3).
3. **Resolved (README §3, `03` §4, §6, §11.3, §13; `02` §3.4, §3.8; `04` §3.7, §10.3):**
   phases that keep the primary (§4.5). `03` §4 takes victory in any phase whose primaries
   are the same objectives (same ids: the same objective listed again, one status record)
   as every later phase's; such a phase must carry an `until`. `03` §6 shows such an advance
   with the phase's own `onEnter.line` band, no NEW OBJECTIVE, no `guide_phase_change`, no
   "Next" row, and `02` §3.8's history fact is the band's sentence. `04`'s Long Road: a
   seize before the drawbridge drops wins at once.
4. **Resolved (`03` §6, README §3):** `onEnter` keys beyond `03` §6's `setTiles`, `wake` and
   `line` (`court`, `signature`, `affix`, `wave`, `bossLine`, `music`, §4.1) are this spec's;
   `03`'s `checkPhase` passes them through in its `effects`, and skips those aimed at a
   fallen boss.
5. **Resolved (`02` §3.7):** a court order on an `awake` group rewrites its members' orders
   (a re-order, through the same writer as `onWake`; not a wake: no `groupWoken`, no wake
   band, recorded in the ledger); orders may set `guardRadius` and `ignoreEnrage: false`,
   and an order given at a phase's `onEnter` may carry a `delay` with its warn band.
6. **Resolved (`03` §5.2, §10, §14 PR 1b):** `clampTile: false` is an explicit release,
   distinct from the absent field (which falls back to `thronePos` on seize).
7. **Resolved (`03` §7.1–§7.4, §13, §14 PR 5):** a `deadline` on `reach` and `claim`
   (`signatureCount: n`, or `byTurn` locked as `par − k`); `claim` on points with `need: n`
   held at the same check (§5.7's points from `03` PR 7, or the finale's echo pillars from
   `bossState.pillars`); a reward-less **feat** bonus, finale only (`feat: true`); a reward
   choice resolved at generation into one plain key (`objectives.json`
   `bonusRewards.visionOffer`); kit bonuses on procedural boss maps, an exception to `03`
   §7.2 (its open question 5, answered for boss nodes).
8. **Resolved with a change (README §6.3, `03` §7.4, §6 and §13 Q3 here):** Vision is
   offered on any Act III+ set-piece or boss-map bonus, at most once per act, never on
   First Light, not only on boss maps. Why: the owner allowed Vision as a bonus reward in
   general (README §6.3), and nothing here needs the boss-only limit: the once-per-act
   ledger already bounds the economy at one bonus charge an act, whichever battle pays it.
   This spec's own offers stay on boss maps. `03` §7.4 also checks the ledger again at the
   commit and pays the reward's locked `fallback` when the act is already paid.
9. **Resolved with a change (`01` §2.7, §2.8, §2.11, §4, §5):** the beat row ("signature
   resolves: the affected tiles the player can see") and the tell's second dash style are
   adopted. The pointer promotion places a boss with a pending tell ahead of the primary
   objective but **behind a commander at half HP or less** (`01`'s existing promotion to
   first), not first outright: a falling commander ends the run, a tell costs a heal (§5.1
   now says so).
10. **Resolved (`04` §3.4, §4.3, §5, §6.1, §6.2, §10.4, §14, Q5, Q7):** `setPieces.json`
    gains `boss: { weights }` (a keyed boss pick that replaces the `generateEnemies`-style
    pick on the set-piece path) and `signatureOverride` (only on a set piece that pins its
    boss); the Parade's `seated` phase is a `tile`-by-column wake (§8.4) and its phases are
    the bars; Sanctum of Echoes is Black Sun's only, so `04` §6.1's Nightfall finale share is
    0; the marching-boss clamp gate ships first in K2 (PR F reuses it, or ships it if first).
11. **Resolved (README §3):** battle state gains `bossState` (the pending tell, the
    signature count, the marked unit, the held pillars, the music latch), riding the
    checkpoint, the Vision snapshot and the validator from K1. **Shared modules** gain
    `engine/BossKit.js` (generation) and `engine/BossSignature.js` (play); the config field
    list gains `bossKit` and `bossSignature`.
12. **Resolved (README §2, §4):** boss set pieces join the pool beside today's arenas, today's
    arenas get variants, Acts I–II get one each (`difficulty.json` `bossKits.arenaShare`
    per rung); the Dueling Halls and the Battery join Long Road and the Parade; Sanctum of
    Echoes is Black Sun's finale variant. The README's boss size band now starts at 20x12,
    so the Dueling Halls (22x12) passes `04` §8.2 check 1. (Narrowed by the owner's ladder,
    2026-10-10: Act I gets no arena, the arenas and variants are Dusk and up, and the boss
    set pieces Nightfall and up.)
13. **Resolved (README §6.2):** First Light as applied in §9.5 (no set pieces; kits, today's
    arena formats and bonuses, never Vision, with gentle values and no sleeping courts). The
    owner's ladder of 2026-10-10 answered §13 Q1, Q5 and Q10 and narrowed it: no Act I kit
    or arena, no new arena or variant, a 0 share, and the kit compiled to at most one gentle
    signature and nothing else (no court, phase, affix or bonus).
14. **Resolved (README §5):** Phase 5a, "boss enhancements on today's maps" (K0–K6), with
    its dependencies from §12 (K0: `02` PR 0b; K1: `02`'s Phase 2 core and `03` PRs 1, 1b,
    3, 4, or K1-lite), shippable before any boss set piece and with no camera work; Phase 5
    (Long Road, the Parade) carries K7–K8 on top of `04`'s E and F; Phase 6 gains K9–K11;
    the ordering notes say K0 then K1 runs beside the slice.
15. **Resolved where the files are the set's:** `02` §2.5's `enemy-phase-pacing.spec.js` is
    now in lane `presentation` (beside `battle-speed.spec.js`; `tests/e2e/lanes.json` has
    no `battle` lane). Outside this set and left for the owner: `CLAUDE.md` counts 12
    affixes where `affixes.json` holds 13 and cites `docs/specs/phase3.md`, which does not
    exist; the harness's missing Entity splash and `haste` MOV are this spec's K6 and K1.

## Fact-check notes (revision 1, 2026-10-09)

What this pass corrected against the code and specs `01`–`04`:
- **Bosses:** eleven, not twelve (eight act bosses, the Emperor, two finales); every one
  named in §7 exists with the stated class, level and act. The Lieutenant is reached only on
  First Light (Dusk's acts end at Act IV). Act bosses roll no affixes; the Entity carries
  two curated ones.
- **Stones** per rung confirmed (`actBoss` 0/0/1/1, `emperor` 0/1/1/2, `lieutenant` 0,
  `eliteCaptain` 0/0/0/1); the Entity check is `RevivalStones.js:38`.
- **The finale is a seize**: the Entity's fall is followed by a Seize on the Throne under
  its footprint, not an automatic end; the Lieutenant also plays `eldritch_sanctum`.
- **Gold is not converted** to Valor or Supply at the run's end (`calculateCurrencies`), so
  finale bonuses became feats.
- **Siege tome:** the one siege tome is `Breachbolt` ("Bolting" does not exist), First
  Light has no `siegeWeaponConfig` and Act II's chance is 0 on every rung, so a volley
  names its weapon and the boss never carries it (carrying it would make him artillery).
  `spawn.siegeWeapon` is a weapon name and is not a scripted-spawn key in
  `MapTemplateEngine`.
- **`EntitySystem.entitySplashCountFor` does not exist** (proposed here); the splash is
  scene-only today (the harness never splashes), so K6 moves it into the engine.
- **Music:** `entityHumGain` and `setMusicLayerGain` exist as cited; `onBossEnrage` is
  `BattleMusicController.js:167-174`; Sera's answer to the Lieutenant is in his theme's
  last strain, not his `halfHealth` exchange.
- **Beats:** `BattleBeatsController` line ranges corrected; dialogue `variants` have no
  `commander` condition (unknown keys never match), so the Sera variant needs a new
  `NarrativeDirector` key.
- **Affixes:** `shielded` (tier 2), `regenerator`, `berserker`, `anchored`, `haste` exist;
  `shielded` and `regenerator` are mutually exclusive; First Light excludes `haste`,
  `teleporter` and `deathburst`; `isAffixAllowed` is module-private; `haste`'s MOV is applied
  at spawn in the scene only. Kit affix rules rewritten accordingly (no
  "`maxAffixesPerUnit` + 1").
- **AI:** `aiOverride` is an affix field read by `_hasAiOverride`, so the mark is a score
  term fed from `bossState`, not a new override; `previewDecision` must also leave `weapon`
  untouched; re-clamping a boss far from the throne would freeze it, so `unclamp` back seeks
  first; `clampTile` needs an explicit release value.
- **Timed buffs:** `applyTimedBuffEntry` (`:31`) and `roadBuffEntry` (`MarkSystem.js:135`)
  confirmed; the Berserker King's surge is a timed MOV buff, not the `haste` affix.
- **`volley` damage** goes through `damageUnitDetailed` with `floor: 1` for non-lethal;
  Miracle does not apply there, and player units carry no stones; the commander is floored
  at 1 on every rung, so no signature ends a run.
- **`02`:** court orders use only `02` §3.7's modes (no `artillery`, no `hold`, `seek`'s
  `then` is `hunt` or `exit`); the new trigger slots are placed explicitly in §3.4's order;
  `noteHostileExchange` (the mark's hook) is `02` PR 2.2b's, while `damagedBy` is the
  prologue's own ledger.
- **Par:** a kit writes `objectives`, so it takes `groups-v1`, not `calculatePar`; the
  claim that S is unchanged was wrong (sleeping courts on the route count); the kit adds no
  par term of its own.
- **`03`:** Vision is never paid on First Light (`03` §7.4); `slay` alone has a deadline;
  `claim` is in `03` PR 5, not PR 7 (points are PR 7); a `oneOf` reward cannot be locked,
  so the choice is resolved at generation; same-primary phases need §4.5's rule.
- **`04`:** the v1 hybrid arenas are not migrated, so the bastion's overrides stay and the
  Emperor's walls are an added phase; the Parade's `seated` phase would block the bar phases
  on an intercept and became a wake; PR ids checked against `04` §14 (A–F, G…; K-table
  needs now cite them with `01`, `02` and `03` PR ids); `04`'s table gives Nightfall a 0.5
  finale share, which this spec's Black-Sun-only answer changes.
- **Arenas:** today's arena blocks are 4x3 near the top centre, so variants are larger
  authored blocks; the share respects the template's biome; adding templates changes Act
  I–II boss nodes' ordinary pick but not the stream's cursor.
- **First Light** rules made explicit (§9.5): no set pieces or new formats, no sleeping or
  patrolling courts, tier-1 non-excluded affixes, non-lethal volleys, a 0.5 arena share,
  no Vision.
- **Line numbers** refreshed throughout (`NodeMapGenerator.js:516-523`, MG:2002-2077,
  `UnitManager.js:469-500`, `BattleScene.js:2613-2619`, `:6349-6364`, `:10814-10850`,
  `TurnPressure.js:78-110`, `AIController.js:340-353`, `RunManager.js:4316-4328`,
  `deeds.json:97-107`, `ceremonyContent.js:113-128`); the browser spec lane `battle` does not
  exist and became `run-flow`; scratch-assembler estimates are marked as by-hand.

## Revision 2 changelog (2026-10-09)

- The fifteen notes are taken in by the README and `01`–`04` and marked resolved; two with a
  change: Vision may be offered on any Act III+ set-piece or boss-map bonus (§6, §13 Q3),
  and a pending tell's pointer ranks behind a commander at half HP (§5.1).

## Revision 3 changelog (2026-10-09)

- **Old clients (review finding, P1).** Boss kits, signatures and arenas are capabilities of
  the run-format guard (`04` §12.1), detected without any `setPiece`; First Light is held like
  any rung (§9.5). §10.2 lists the save marker; K0 and K1 depend on `04` PR A0.
- **Gating (§12).** Kits and arenas ship dark (`bossKits.enabled` false, `arenaShare` 0),
  switch on per rung in separate changes, and wait for the Mill Ford's exit criteria.

## Revision 4 changelog (2026-10-10)

Takes in the owner's rung ladder (README §6, 2026-10-10: "Act I boss stays simple
everywhere; scale grows with the rung").
- **Act I** (§2, §3, §7.1, §9.5): today's map on every rung, no arena, kit, signature or
  court. The Iron Captain's and the Warchief's kits and `act1_border_post` are kept as
  designs, deferred and out of scope; the Act I bosses are `kitless` (validated, test 27).
- **Arenas** (§4.4, §10.1): the Act II yard and the variants are Dusk and up. First Light's
  `arenaShare` is 0 (validated) and no variant is drawn there, so it keeps today's v1 arenas
  as they are; the yard is `shareOnly`, so the ordinary draw never brings it to First Light
  and no ordinary pick moves (§10.4, test 13). Test 28.
- **First Light** (§9.5, rewritten with the ladder's table), on the strict reading decided
  2026-10-10: from Act II a kit compiles to at most one gentle, telegraphed, never-lethal
  signature and nothing else (no court orders, awake or sleeping; no affix; no phase beyond
  today's; no kit bonus), validated (§10.1, test 22). Each boss's *First Light* line in §7 is
  rewritten (the Knight Commander's kit is empty there); auras reach nearby enemies when no
  court is compiled (§5.2); the Lieutenant keeps only his foretell (his half, Sera line and
  feat deferred, §8.1, K6); First Light's boss par is today's `calculatePar`. Q1, Q5 and Q10
  are answered. The guard is unchanged: a signature alone is still the `bossKit` capability
  (test 23 moves to the Archmage's signature-only kit, `04` §13). Tests 11, 21 and 26 move
  to Dusk+ cases.
- **Boss set pieces** (§1 intro, §2, §8): Nightfall and Black Sun only; Q4 and `04` Q5
  decided (no Parade on Dusk). Long Road's Dusk `reach` bonus stays only as the fallback.
- **Rollout** (§12): K0 drops the Act I arena and gains the First Light gates (2.5 days); K1
  ships the Knight Commander's kit instead of the Act I kits; K2 gains `aura` and the
  remaining Act II–III kits; K1-lite's example moves to the Emperor's imperial guard (Dusk+).
