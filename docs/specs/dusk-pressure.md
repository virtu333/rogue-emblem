# Dusk pressure: make efficient play pay

Status: proposal, revision 2. It takes in the review of revision 1 and the owner's
decisions of 2026-10-01 (listed at the end). Branch `claude/dusk-pressure-spec`.
- This branch changes no game code or data. The evidence comes from `sim/pacing.js`.
- PR 1, which has no tuning, is on branch `claude/dusk-pressure-pr1`.
- PR 2 (the Dusk and Nightfall ladders) is on `claude/dusk-pressure-pr2`; §5 has its
  notes and measured results.
- First Light does not change. Boss enrage stat gains are held.

## 1. Problem

The Dusk playtest said: "it's way too strong to click end turn and let the enemy run
across the map and explode… there's no penalty to just sitting there dealing with each
wave safely and slowly." A Dusk win took 120 turns over about 24 battles and gathered 0
Eclipse shadow, so every battle was S-rank.

### Why waiting costs nothing today

| Mechanism | Where | Effect on a turtle |
|---|---|---|
| Every rout enemy chases from turn 1. Guards exist only on seize maps (15–25% of the boss half; they wake at 3 tiles from their post and are leashed back) | `MapGenerator.js:2150-2164`, `AIController.js:203-216` | The enemy walks into the kill zone |
| Anti-turtle: after 3 enemy phases without progress, `aggressiveMode` releases the guard leashes and the boss's throne clamp. **Bug:** the baseline is captured before any enemy has spawned (`BattleScene.js:1418` vs `:1534`), so kills never count as progress | `BattleScene.js:2966-3107`, `constants.js:104` | Guards come to the turtle anyway |
| Par = ceil((base + min(0.6n, 1.3√n) + 0.01·area + terrain) × 0.8), then × rung multiplier (Dusk 0.92), then +3 inflation + the template's `parBonus` | `TurnBonusCalculator.js:13-56`, `turnBonus.json:2,58` | Dusk rout par is 7.5 in Act I and about 11–12 later |
| Every arriving non-repeating wave raises par by 1. That includes procedural and village bandit waves, not only scripted ones | `BattleScene.js:2753-2777`, `HeadlessBattle.js:1037-1046` | Every wave a turtle sits through gives a turn back |
| Ratings: S at par−3 or better, A up to par, B up to par+3, C beyond. XP/gold decay from par+3 (not "5+" as `CLAUDE.md` says). Boss enrage at min(12, par+2) | `turnBonus.json:29-80`, `TurnBonusCalculator.js:65-179` | Penalties start late |
| Eclipse gain = min(max(0, turns − max(1, par−3)), 6), ×1 on every rung | `EclipseSystem.js:114-133` | An S clear adds 0 |
| Reinforcements on Dusk's standard templates start in Act III (T5/T8 ±1, count + `enemyCountBonus`). Arrivals copy the map's spawns at the same level and pass an Infantry-only passability check | `mapTemplates.json:109`, `ReinforcementScheduler.js:29-36,314-345`, `BattleScene.js:2389-2545` | Acts I–II have no waves; arrivals can land on Ballista, Lava or Swamp |
| Field empty = rout victory, even with waves pending | `BattleScene.js:10664-10673` | Good: rewards pushing |
| Status staves and siege roll **per spawn, on eligible classes only**. Dusk has none. Breachbolt uses are never spent for either faction: `spendPerBattleUse` has no caller, and `AttackOptions.js:35` only gates the player's menu | `difficulty.json`, `MapGenerator.js:2096-2125`, `Combat.js:534-549` | Enemy siege fires every phase; a looted Breachbolt (`lootTables.json:318,452`) is unlimited |

Design history: the rule "punish the clock, not the unit" (`docs/design-log.md:652`). The
log rejects "untelegraphed ambush spawns" and "RNG sleep-lock on the player's carry"
(`:703`).

### Method

`sim/pacing.js` plays whole runs through the headless harness:
- real node maps and par, including the wave bumps;
- real Eclipse commits;
- protected units (HP floors at 1);
- HP topped up between battles;
- Master Seals bought at level 15.

There are two policies: **turtle** (`TacticianAgent`, bait and punish) and **push** (the
same agent always advancing). Neither is an efficient human pusher, so the ladder's cost
to real pushers is probably lower than simulated (§3). Both fall back to the charging
`ScriptedAgent` on seize and escape maps; those rows measure maps, not styles.

**Per-act calibration.** The harness player buys, forges and uses nothing, and the gap
grows by act. `--edge` adds +N to HP, STR, MAG, SKL, SPD, DEF and RES for each battle
only.

- **Grid:** 0–10, Dusk turtle, 16 runs.
- **Rule:** each act takes the smallest edge that keeps the turtle under about 1 would-be
  KO per rout battle (a careful human with Vision rewinds and permadeath loses almost
  nothing). In KOs per battle at the chosen edge: Act I 0.6 (edge 0 gives 3.2), Act II
  0.8, Act III 1.0, Act IV 1.5.
- **Profile:** Act I +2, Act II +6, Act III +10, Act IV and final +12.
- **Check:** the profile reproduces the playtest without being tuned to it. On Dusk the
  turtle takes 5.6 turns per battle and ends at shadow 1.0 ± 0.3.
- **Default army:** the table in §1 also gives the uncalibrated army.

Every number below is 48 runs per cell, seeds 1–48, written as mean ± standard error.
Turtle and push are paired on the same seeds. Force-won stalls are left out of the rating
rows; they count at par in the shadow. The tuning calls quote the paired difference.

### Baseline (calibrated, rout maps unless noted)

| Rung | Turns turtle / push | Par | Turtle S/A/B/C % | Push S/A/B/C % | Shadow turtle / push |
|---|---|---|---|---|---|
| First Light | 4.7 / 3.9 | 9.9 | 98/2/0/0 | 99/1/0/0 | 0.0 / 0.0 |
| Dusk | 5.8 / 4.6 | 9.8 | 85/13/2/0 | 96/3/0/0 | 1.0 ± 0.3 / 0.0 |
| Nightfall | 7.5 / 6.0 | 10.1 | 60/32/7/2 | 78/20/2/0 | 7.9 ± 1.1 / 0.4 ± 0.2 |
| Black Sun | 10.7 / 9.3 | 10.9 | 34/24/24/18 | 47/24/18/10 | 47.3 ± 2.0 / 31.5 ± 2.1 |

Seize is S-rank in at least 93% of battles on every rung up to Nightfall.
`sim/eclipse.js --difficulty dusk` with fixed ratings (A-rank ends at 61 shadow) shows
the Eclipse works once a battle runs past par−3. The turtle never gets there, because the
enemy comes to it. Bigger maps would add walking time for both styles, and arrivals near
the camp would reach the turtle sooner. So neither one taxes the turtle. What does tax
it: arrivals that keep coming until the field is clear, and enemies that do not come to
it.

**The default army** (no edge, 48 runs, rout maps). The harness player takes 9–24 turns
a battle and suffers 9–43 would-be KOs per battle, so it is no proxy for a human. Its one
use: on its own scale, the ladder hurts weak play more than strong play.

| Configuration | Turns turtle / push | Turtle S/A/B/C | Push S/A/B/C | Shadow turtle / push | Force-won stalls turtle / push |
|---|---|---|---|---|---|
| Dusk today | 10.8 / 8.8 | 22/42/20/16 | 46/35/11/8 | 51.2 ± 2.2 / 27.0 ± 2.0 | 73 / 39 |
| Dusk ladder | 14.7 / 12.8 | 12/6/24/58 | 21/10/22/47 | 92.7 ± 1.1 / 81.7 ± 2.0 | 83 / 67 |
| Nightfall today | 17.4 / 14.9 | 4/20/28/48 | 9/25/29/37 | 93.2 ± 1.2 / 86.7 ± 2.3 | 157 / 83 |
| Nightfall ladder | 24.2 / 20.8 | 2/1/2/95 | 2/2/4/92 | 96.7 / 96.9 | 239 / 187 |

## 2. Changes

### 2a. Rout reinforcement ladder (Dusk and Nightfall, one PR)

A finite schedule of waves starts early and comes every 2 turns, each wave larger and
higher-level. Clearing the field cancels the waves still pending (the victory rule is
unchanged). A fast clear sees few waves; a turtle sees them all.

**Data.** `routLadder` per mode in `difficulty.json`: `null` on First Light and on
Black Sun (see 2d). Each act lists its waves as `{ turn, count: [min, max], levels?,
promoted? }`. `turn` is the enemy phase whose end brings the arrival. Counts are
absolute: no `enemyCountBonus`, no turn offset, no jitter. `xp` is the per-wave reward
multiplier (0 past the list), and gold uses the same value. A template opts out with
`"ladder": false` (none does today).

| Rung | Act I | Act II | Act III | Act IV (+ final) | `xp` | Promoted |
|---|---|---|---|---|---|---|
| Dusk | T4 1, T6 1–2 | T4 1–2, T6 2 (+1), T8 2–3 (+1) | T4 2, T6 2 (+1), T8 2–3 (+1), T10 2–3 (+2) | T4 2, T6 2–3 (+1), T8 2–3 (+1), T10 3 (+2) | .75 .5 .25 .1 | never |
| Nightfall | T4 1–2, T6 1–2, T8 2 (+1) | T3 1–2, T5 2 (+1), T7 2–3 (+1), T9 2–3 (+2) | T3 2, T5 2–3 (+1), T7 2–3 (+1), T9 3 (+2) | same as III | .75 .5 .25 .1 | 4th wave, Act III+ |

- **Every rout map gets it, including village maps.** The ladder replaces the
  template's procedural `waves`/`extraWavesByDifficulty` and stacks on scripted waves:
  village bandits are a turn-1 scripted wave (`MapGenerator.js:395-428`). Scripted waves
  keep their own XP and their +1 par. In the sims, all 975 Dusk and 1,022 Nightfall
  turtle rout battles ran the ladder. Seize and escape keep their waves.
- **The ladder is fixed at generation.** `MapGenerator` (through
  `engine/RoutLadder.js`) writes the waves into the battle config as
  `reinforcements.ladder`, with each wave's edge, reward, level bonus and promoted flag,
  the computed `front` and `flanks`, and the rung's `parInflation`. The difficulty is
  never consulted at battle start. Its arrivals carry `waveType: 'ladder'`.
  - The config is locked per node (`RunManager.js:3272-3276,4390,4924`), and `turnPar`
    is checkpointed (`BattleSuspendController.js:221-222`).
  - So a resume or a Vision rewind replays the same ladder against the same par.
- **Ladder waves never raise par.** `waveRaisesPar(spawn)` (PR 1) is false for
  `repeating` and `ladder`, and both the scene and the harness use it.
- **Escalation.** `+levels` is added to the copied template's level. Promoted waves draw
  from the act's `pools[act].promoted`, keyed by the spawn hash. Arrivals keep the
  copied affixes and roll no new ones; a promoted arrival drops any its new class is
  excluded from (`affixes.json` `class_exclude`: no hasted Paladin, no teleporting
  General).
- **Spawn tiles.**
  - **Edges.** Each wave chooses **one** edge for all of its arrivals: wave 1 the front
    (the edge behind the enemy centroid, axis from the player-to-enemy centroid gap),
    then flank A, flank B and so on (which flank is A is hashed from the spawns). A flank
    with fewer than 4 usable tiles (chokepoint) passes its waves to the other flank, then
    to the front.
  - **Spread.** Arrivals are drawn along that edge on the turn's seeded stream, as
    simulated. Clustering them round one anchor was measured in PR 2: it lowers the push's
    shadow (Nightfall 36 → 27, Dusk 11 → 9), so it is held back as a lever.
  - **Exclusions.** No tile within Manhattan 3 of a player unit, next to an NPC or the
    caravan, on `REINFORCEMENT_EXCLUDED_TERRAIN` (Lava Crack, the Acidic tiles,
    Ballista, Throne, Village), or impassable for the arriving class's move type (PR 1;
    a promoted wave also checks the act's promoted classes).
  - **Fallback.** The edge is settled once, as the wave arrives. A flank wave whose
    flank has no tile free of the exclusions goes to the front, whole. Arrivals that
    the wave's edge cannot take count as `blockedSpawns`, so a wave never splits
    between two edges. Which edge it takes depends on where units stand at the end of
    the enemy phase, so the telegraph cannot know it in advance.
- **Telegraph.** The rout objective gains a line such as "Reinforcements 1/4 · T6: up to
  3, top or right edge". It gives the waves resolved, the next wave's turn and its most
  arrivals. "Up to" is there because blocked tiles can shrink a wave. It then names the
  wave's edge and, for a flank wave, the front it falls back to. Both are named as the
  board is drawn: an upright portrait board is turned a quarter. A front wave names one
  edge. The compact mobile header shows "Waves 1/4 · next T6". Fogged arrivals stay
  unmarked; the band still counts them.
- **Field clear.** The rule is unchanged, and a clear wins at once in the player phase;
  the waves still pending never come. A field cleared during the enemy phase (an enemy
  falls to a counter) waits for that phase's reinforcements: a wave due at the end of
  that turn still arrives and the battle goes on, while a phase with no wave due ends in
  victory (`checkBattleEnd`'s `_reinforcementsPendingThisTurn` deferral, pinned in
  `tests/RoutLadder.test.js` for the scene and the harness).
- **Finite.** A rout map must stay winnable by a weak army, and an open stream capped by
  live units creates a stall equilibrium. The Eclipse and late pressure already price the
  time.
- **No farming after XP reaches 0:**
  - A zero-reward kill still counts toward deed kills, but not toward `maxKillLevelGap`
    or the terrain/weapon tallies (`DeedSystem.js:214-219`).
  - Defender survival XP is 0 against an attacker whose wave pays 0, and the usual
    minimum (`XP_DEFEND_SURVIVE`, 1) against any other (`BattleXp.combatXpAwards`). It
    is not multiplied by the reward. The minimum is 1 XP, so a multiplied, floored value
    would already be 0 at the first ladder wave (.75). A rounded one would only split
    the .5 and .25 waves. Neither stops farming better than the 0 rule, and both cost an
    honest defender its floor.
  - **Future-proofing.** The shipped data never triggers these rules. Every ladder has at
    most 4 waves against 4 `xp` entries (.75 .5 .25 .1). No template wave, pursuit wave
    or scripted wave pays 0 (escape pursuit pays .25). A 0 appears only if a ladder grows
    past its `xp` list.

**Results** (calibrated army, 48 paired runs, rout maps):

| Configuration | Turns turtle / push | Turtle S/A/B/C | Push S/A/B/C | Shadow turtle / push | Paired gap |
|---|---|---|---|---|---|
| Dusk today | 5.8 / 4.6 | 85/13/2/0 | 96/3/0/0 | 1.0 / 0.0 | 1.0 ± 0.3 |
| Dusk ladder, inflation 3 | 7.2 / 5.5 | 58/16/18/8 | 79/9/9/3 | 22.9 (Pale 28, Waning 19) / 7.5 | 15.4 ± 2.1 |
| **Dusk ladder, inflation 2** | 7.2 / 5.5 | 46/23/19/12 | 70/15/9/6 | **30.9** (Pale 17, Waning 26, Umbral 5) / **11.0** (Pale 46) | 19.9 ± 2.3 |
| Dusk ladder, inflation 1 | 7.2 / 5.5 | 28/36/18/18 | 50/33/7/10 | 41.9 (Waning 31, Umbral 13) / 18.1 (Pale 38) | 23.8 ± 2.3 |
| Nightfall today | 7.5 / 6.0 | 60/32/7/2 | 78/20/2/0 | 7.9 / 0.4 | 7.5 ± 1.2 |
| **Nightfall ladder, inflation 3** | 10.3 / 7.9 | 22/17/27/34 | 46/18/22/15 | **66.4** (Umbral 30, Totality 14) / **36.3** (Waning 27) | 30.1 ± 2.7 |
| Nightfall ladder, inflation 2 | 10.3 / 7.9 | 16/18/18/48 | 37/21/15/27 | 74.0 / 44.6 | 29.4 ± 2.6 |

The Dusk ladder lands in Act II–III (2.2–2.6 waves per battle for the turtle). Act I
maps usually end before wave 2 (0.6 per battle), and Act IV maps are short. Shipping
Dusk and Nightfall together keeps the rungs in order (push 11 < 36, turtle 31 < 66). A
Dusk-only ladder would put Dusk above today's Nightfall (7.9 / 0.4).

### 2b. Hold AI (seize and escape, with a seize par fix in the same PR)

New `aiMode: 'hold'`, separate from `guard`. A holder stays put until its pack wakes,
then hunts for the rest of the battle.

- **Packs.** Holders are assigned in groups of 2 or more linked within 3 tiles, so no
  holder stands alone to be pulled away one at a time. The pack id is stored on the unit
  and survives snapshots.
- **Wake rule** (pure `engine/HoldActivation.js`, called at the top of
  `AIController.processEnemyPhase`, so the scene needs no change). A pack wakes when a
  member:
  1. **is visible to the player** (`PlayerKnowledge` at the start of the enemy phase)
     and has a player or NPC unit on its `ThreatForecast.enemyThreatTiles`. Those are
     exactly the tiles the Danger overlay draws for it, so red zone = wake zone for
     everything the player can see. A fogged holder never wakes this way: it wakes once
     it is revealed with a player unit still in its zone, or by rule 2 or 3. Danger drops
     fogged sources (`ThreatForecast.js:151`), so this keeps the rule honest.
  2. is below full HP or carries a status (it was struck, shoved or hexed).
  3. turn-pressure boss enrage has started.
- **Anti-turtle `aggressiveMode` does not wake holders.** If it did, a turtle would only
  have to wait 3 phases.
- **Shares.** Seize: Dusk 35%, Nightfall 45%, Black Sun 55% of the non-boss enemies,
  nearest the throne first; this replaces the guard roll on Dusk+. Escape: 30/40/50% of
  the enemies in the exit half. First Light keeps its guards. Rout: 0% for now (owner).
- **Seize par fix ships in the same PR.** With seize par loose (93% or more of seize
  battles are S on every rung up to Nightfall), pulling holders off a pack would be free.
  - Tune `objectiveAdjustments.seize` per rung with a seize/escape-aware agent; the
    current fallback agent cannot measure holds.
  - Target: a push median of par−2.
- **Cost.** One movement flood per sleeping holder per enemy phase (about 8 at most),
  the same cost as one Danger zone.

### 2c. Breachbolt, siege and status-staff ladder

**Breachbolt (PR 1, owner's numbers).**
- **Uses.** The player's copy has 3 uses per battle and an enemy's has 5, on every rung,
  with no MAG bonus. Data: `uses: 3` and `usesByFaction: { "enemy": 5 }` in
  `weapons.json` (schema updated), read by `getPerBattleMaxUses`. A future per-rung
  override would live in `siegeWeaponConfig`.
- **Spending.** One use is spent per combat in which the wielder strikes with it,
  attacking or countering. A spent Breachbolt cannot counter, and `canAttackWithWeapon`
  rejects it.
- **Enemy fallback.** An enemy siege caster keeps its own weapon behind the Breachbolt
  and re-equips it once its shots are spent. The swap uses `Combat.nextStrikeWeapon`,
  and ThreatForecast draws the same weapon. The AI checks shots only, not
  `canAttackWithWeapon` in full:
  - the rank check would disarm a Dark Knight (Tomes P) carrying the Mastery tome;
  - the silence check would change how the AI picks attacks today (Combat already
    blocks silenced magic), which is out of scope.
- **Display.** The weapon tooltip, the roster card and the Siege keyword show the shots,
  read from data. The canvas unit row is left alone because it is already at its width
  limit.
- **Also in PR 1:**
  - The anti-turtle baseline fix.
  - Arrival tiles checked against every move type an arrival may copy.
  - `REINFORCEMENT_EXCLUDED_TERRAIN`.
  - Harness mirrors for anti-turtle, spawn gear and enemy staves.

**Artillery AI (later PR).** A Breachbolt holder that still has shots does not move. It
fires from its post at the best target 3–10 away, and ThreatForecast draws its reach from
the post (mov 0) so Danger matches the AI.

**Frequency (later PR).** Switch from a per-spawn chance to a per-battle chance, rolled
only when an eligible class is on the map, on a stream derived from `battleSeed`.

| Rung | Staff kinds | Staff chance II / III / IV / final, max | Siege chance III / IV / final, max |
|---|---|---|---|
| Dusk | **Silence only, from Act III** (owner) | 0 / .15 / .20 / —, 1 | 0 / .15 / —, 1 |
| Nightfall | Silence + Sleep | .10 / .25 / .30 / .35, 1 | .25 / .30 / .35, 1 |
| Black Sun | Silence + Sleep | .15 / .30 / .35 / .45, 2 | .35 / .40 / .45, 1 |

Measured effective shares today (map-only, 40 seeds): Nightfall staves 3% / 8% / 20% of
battles, no siege. Black Sun staves 5% / 10% / 15% / 35%, siege 4% / 10% / 13%.
Eligible casters appear on about 40–75% of maps for staves and 22–39% for siege. Dusk
keeps shop cures.

### 2d. Par, Eclipse and Black Sun

- **Eclipse:** unchanged.
- **Par:** `parInflation` per rung in `difficulty.json`: First Light 3, **Dusk 2**,
  Nightfall 3, Black Sun 3. A new map locks its rung's value into the battle config; a
  map without one (generated before PR 2) uses `turnBonus.parInflation` (3).
  - Dusk −1 lifts the turtle from 22.9 to 30.9 shadow and the push from 7.5 to 11.0.
    Push stays Pale in 46 of 48 runs and 85% S+A.
  - Inflation 1 (turtle 41.9, push 18.1) is the next lever if playtests still see S
    turtles.
  - With inflation 2 on both, Dusk's par is about equal to Nightfall's (0.92 vs 0.85
    multiplier), so the rungs never invert.
- **Black Sun:** keeps its current template waves and only loses the per-wave par bump
  (they become par-neutral like the ladder): `templateWavesRaisePar: false` marks the
  procedural waves of every Black Sun map (`reinforcements.wavesRaisePar`). Scripted
  waves (village bandits, boss keeps) still add one. Shadow push 31.5 → 55.4 ± 2.6, turtle
  47.3 → 73.5 ± 2.3 (Umbral or worse in 44 of 48 runs). The calibrated army is
  Dusk-strength, so the real Black Sun numbers will be lower. Re-run with a Black Sun
  calibration before release.

## 3. Risks, targets, tests, rollout

**Targets** (calibrated, 48 paired seeds, rout):
- Dusk push: at least 75% S+A and mostly Pale.
- Dusk turtle − push paired gap: at least 15 shadow.
- Nightfall above Dusk by at least 10 shadow for each style.
- First Light unchanged.
- Force-won stalls: no more than 2× baseline.

**Risks.**
- `push` is not an efficient human, and calibration is per act, not per player, so the
  ladder's cost to strong pushers is overstated.
- The Act I–II turtle cost is understated: the harness turtle advances after 2 quiet
  turns, while a human might simply keep ending the turn.
- XP falls on Dusk+; measure levels at each act's end.
- Arrivals in fog can feel unfair, which is why the telegraph exists.
- n=48 still gives ±2 shadow per cell, so tuning steps smaller than about 4 need more
  seeds.

**Tests:**
- `RoutLadder`:
  - The exact schedule, counts and levels.
  - Par is unchanged after a ladder wave, +1 after a bandit wave.
  - No arrival within 3 tiles of a player, on excluded terrain, or impassable for its
    class.
  - One edge per wave.
  - Village maps stack.
  - First Light configs are unchanged.
  - A field clear at T5 cancels the T6 wave.
  - A resume replays the same ladder.
- `HoldActivation`:
  - Asleep outside the Danger tiles; one tile inside wakes the whole pack.
  - A fogged holder ignores the zone until it is seen.
  - Damage wakes it; anti-turtle doesn't; enrage does.
  - Snapshot round trip.
- Deeds and XP: zero-reward kills skip `maxKillLevelGap`; survival XP from a 0-reward
  wave is 0.

**Sims:**
- `sim/pacing.js` on four rungs × two policies, at 48 seeds, with the calibration
  profile and the default army.
- `sim/eclipse.js`.
- `sim:fullrun:pr` and `test:harness:pr`, with threshold PR notes.

**Rollout:**
1. **PR 1, no tuning** (`claude/dusk-pressure-pr1`):
   - The Breachbolt fix (both factions, 3/5).
   - `waveRaisesPar`.
   - `engine/TurnPressure.js` (plus the baseline fix).
   - Harness mirrors for anti-turtle, siege/staff spawns and enemy staves.
   - Move-type-aware spawn tiles.
2. **PR 2:** the Dusk and Nightfall ladders, Black Sun's par-neutral waves, Dusk
   inflation 2, and the deed and survival-XP fixes.
3. **PR 3:** hold on seize and escape, the seize par fix, and a seize/escape-aware sim
   agent.
4. **PR 4:** Dusk Silence staves and the per-battle staff/siege model with artillery AI.

**BattleScene.** All the logic lives in engine modules. The draft stability stack
(#171–#178) does not touch `BattleScene.js` 2966–3107 (anti-turtle) or 2369–2780
(reinforcements). It rewrites combat resolution (8209–9316) and the enemy phase
(10037–10804), so PR 1's scene glue in those areas is one call each. Land after the
stack, or rebase onto it.

## 4. Owner decisions (2026-10-01)

- **Rout hold share:** 0% for now. Ship the ladder alone and re-measure.
- **Deeds:** count the kill, but exclude zero-reward units from `maxKillLevelGap` and the
  terrain/weapon tallies. Stop survival-XP farming as well.
- **Black Sun:** keep its waves and drop the par bump.
- **Dusk staves:** Silence only, from Act III.
- **Breachbolt:** player 3, enemy 5.
- **Map sizes:** keep.

Open: confirm Dusk inflation 2, with 1 held in reserve.

## 5. PR 2 as shipped (`claude/dusk-pressure-pr2`)

- **Engine.** `engine/RoutLadder.js` builds the ladder at generation and words the
  telegraph. `ReinforcementScheduler` places ladder waves. `engine/ReinforcementSpawns.js`
  holds what used to be duplicated in BattleScene and the harness: the template pool,
  the spawn spec (level bonus, promoted waves), the scheduler call, the reward multiplier
  and the zero-reward rule.
- **Locked with the map.** The ladder, `parInflation` and Black Sun's
  `wavesRaisePar: false` are written into the battle config. The rung's values reach
  the map through the run's saved `difficultyModifiers`. A run saved before PR 2 keeps
  its old pacing for the rest of the run: no ladder, inflation 3 and par-raising waves.
  The same holds for its locked maps.
- **Caravan maps.** The harness now fields the Merchant Caravan as an NPC and steps it
  each enemy phase through `CaravanSystem.advanceCaravan`, which the scene's
  `CaravanController` also uses. So the ladder's NPC exclusion holds in sims too.
- **Zero-reward arrivals.** A kill still counts toward deeds but skips the level gap and
  the terrain/weapon tallies. Surviving one earns no XP; surviving any other keeps the
  1 XP minimum. These rules are future-proofing: nothing in the shipped data pays 0
  (see §2a).
- **Results** (`sim/pacing.js`, calibrated profile, 48 paired seeds, final shadow mean ±
  SE). "Prototype" reruns this branch's sim ladder on the PR 2 code. It shows that the
  shipped ladder matches the simulated one, and that the drift from §2 comes from PR 1's
  changes and noise.

| Rung | Spec turtle / push | Shipped turtle / push | Prototype, same code | Today (PR 1 code) |
|---|---|---|---|---|
| First Light | 0.0 / 0.0 | 0.0 / 0.0 | — | — |
| Dusk (infl. 2) | 30.9 / 11.0 | 37.2 ± 1.5 / 9.1 ± 1.2 | 34.5 / 11.7 | 0.9 / 0.1 |
| Nightfall | 66.4 / 36.3 | 61.4 ± 2.5 / 35.0 ± 2.5 | 64.9 / 37.2 | 5.8 / 0.2 |
| Black Sun | 73.5 / 55.4 | 73.3 ± 2.1 / 55.6 ± 2.8 | — | — |

Targets (§3) on the shipped numbers:
- Dusk push is S+A in 87% of rout battles and Pale in 44 of 48 runs.
- The paired Dusk gap is 28.1 ± 1.9.
- Nightfall sits 24 / 26 above Dusk.
- Force-won stalls are within 1.5× of today.

