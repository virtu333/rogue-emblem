# Dusk pressure: make efficient play pay

Status: proposal with sim evidence (branch `claude/dusk-pressure-spec`). No game code or
data has changed. The evidence comes from `sim/pacing.js` (added on this branch). First
Light stays as it is, and boss enrage stat gains are out of scope (held).

## 1. Problem

The Dusk playtest said: "it's way too strong to click end turn and let the enemy run
across the map and explode… there's no penalty to just sitting there dealing with each
wave safely and slowly." A Dusk win took 120 turns over about 24 battles (5 turns a
battle) and gathered 0 Eclipse shadow, so every battle was S-rank.

### Why waiting costs nothing today

| Mechanism | Where | Effect on a turtle |
|---|---|---|
| Every enemy on a rout map chases from turn 1. Guards exist only on seize maps (15–25% of the boss half, woken at 3 tiles from their post, leashed back) | `MapGenerator.js:2150-2164`, `AIController.js:203-216` | The enemy closes the distance, so a turtle loses no time |
| Anti-turtle: after 3 turns with no kill and no objective progress, `aggressiveMode` releases the guard leash and the seize boss's throne clamp | `BattleScene.js:3059-3107`, `constants.js:104`, `AIController.js:214,251-252` | On a seize map the guards come to the turtle as well |
| Par = ceil((base + min(0.6n, 1.3√n) + 0.01·area + terrain) × 0.8), then × rung multiplier (Dusk 0.92), then +3 inflation, + the template's `parBonus` | `TurnBonusCalculator.js:13-56`, `turnBonus.json:2,58` | Dusk rout par is 7.5 in Act I and about 12 in Act III/IV |
| **Every non-repeating wave that arrives adds +1 par**. This covers procedural waves too, not only scripted ones (and village bandit waves) | `BattleScene.js:2753-2777` (harness `HeadlessBattle.js:1037-1046`) | A turtle that sits through two waves gets 2 turns back |
| Ratings: S ≤ par−3, A ≤ par, B ≤ par+3, C beyond. XP and gold decay from par+3. Boss enrage at min(12, par+2) only sets `aggressiveMode` | `turnBonus.json:29-80`, `TurnBonusCalculator.js:65-179`, `BattleScene.js:3096-3106` | Penalties start only at par+3 |
| Eclipse gain = min(max(0, turns − max(1, par−3)), 6) × 1 on every rung | `EclipseSystem.js:114-133`, `eclipse.json:4-7` | An S clear adds 0 shadow |
| Reinforcements: Dusk standard rout and seize templates are gated `minActByDifficulty.dusk = "act3"`. Their waves come at about T5 and T8 (±1), each wave's count gets +`enemyCountBonus`, and the arrivals copy the map's own spawns at the same level. They spawn on enemy-side edges, and only the tile and its inward neighbour must be free, so an arrival can land next to a player unit | `mapTemplates.json:109`, `MapGenerator.js:613-688`, `ReinforcementScheduler.js:314-345,465-472`, `BattleScene.js:2389-2545` | Acts I–II have no waves at all, and later waves walk into the kill zone |
| Rout victory fires when the field is empty, even with waves still pending | `BattleScene.js:10664-10673` | Good: this rewards pushing |
| Status staves: `dusk.statusStaffConfig = null`, Nightfall act3/4 .08. Siege only on Black Sun. Both roll **per spawn and only on eligible classes**, so the real share of battles is far below the number in the table (below) | `difficulty.json:55-56,98-105,155-162,190-198`, `MapGenerator.js:2096-2125`, `constants.js:284-287` | No ranged threat that forces anyone to move |

The design history behind these choices: "Punish the clock, not the unit"
(`docs/design-log.md:652`). The log rejects "untelegraphed ambush spawns" and "RNG
sleep-lock on the player's carry" (`:703`). "Wary AI" and the twin-pincer rout template
were deferred (`:681-690`). Dusk shipped with no status staves on purpose, as "halfway
on every number" (`docs/playtest-triage-2026-09-28.md:124`).

**Bug found while doing this research (and it blocks siege on Dusk):** nothing ever spends
a Breachbolt use. No code in `src/` calls `spendPerBattleUse` (`Combat.js:546-549`). Only
the player's attack menu checks the remaining uses (`AttackOptions.js:35`), and the AI
never looks at them. So an enemy Breachbolt fires from range 3–10 on **every** enemy
phase, not once.

### Baseline evidence

`sim/pacing.js` plays whole runs through the headless harness: real node maps, real par
with the wave bumps, real Eclipse commits. Units are protected (HP never drops below 1),
HP is topped up between battles, and Master Seals are bought at level 15. There are two
policies:
- **turtle** is `TacticianAgent` as shipped: bait and punish. It holds the safest tile
  and advances only after 2 turns without contact.
- **push** is the same agent always advancing.

Both fall back to `ScriptedAgent` on seize and escape maps, so those rows measure the map
and not the play style.

Reproduce with `node sim/pacing.js --difficulty dusk --policy turtle|push --seeds 16 --edge 6
[--ladder 1] [--holdRout 0.2] [--out file.jsonl]`.

**Calibration.** The harness player buys, forges and uses nothing, so out of the box it
is far weaker than a human. On Dusk with no edge, the turtle takes 10.6 turns per rout
battle and suffers about 1,500 would-be KOs per run. `--edge N` adds +N to HP, STR, MAG,
SKL, SPD, DEF and RES for each battle only. At +6 the Dusk turtle takes 6.1 turns per
battle and ends with 3.9 shadow (all 16 runs Pale), which reproduces the playtest. Every
number below uses edge +6, 16 runs per cell and seeds 1–16. "Shadow" is the run's final
shadow. Battles that hit the action budget are force-won and left out of the rating rows;
they count at par in the shadow.

| Rung (current data) | Rout turns turtle / push | Rout par | Turtle S/A/B/C % | Push S/A/B/C % | Shadow turtle / push |
|---|---|---|---|---|---|
| First Light | 4.7 / 4.0 | 10.0 | 95/4/0/0 | 99/0/0/0 | 0.1 / 0.0 |
| Dusk | 6.3 / 5.1 | 10.1 | 79/17/4/1 | 92/7/1/0 | 3.9 / 0.3 |
| Nightfall | 7.4 / 6.7 | 10.4 | 67/24/9/1 | 80/16/4/1 | 8.6 / 2.9 |
| Black Sun | 11.7 / 10.1 | 11.3 | 31/32/19/18 | 50/25/14/12 | 49.9 / 33.3 |

Seize is S-rank in at least 94% of battles on every rung up to Nightfall (5–7 turns
against a par near 12). Reinforcements on Dusk arrive at 0.2 waves per rout battle in
Acts I–II and 1.0–1.6 in Acts III–IV. On a rout map, turtling costs about 1 turn and
nothing else. A dominant strategy that is this safe and almost free is the problem.

Two findings shape the design:
1. **Par/Eclipse is not the broken part.** `node sim/eclipse.js --difficulty dusk` with
   fixed ratings gives: A-rank play ends Dusk at 61 shadow (Umbral 97%), B at 97. The
   clock bites as soon as a battle runs past par−3. The turtle never gets there because
   the enemy walks into it.
2. **Bigger maps or plain flank arrivals do not tax a turtle by themselves.** With every
   enemy chasing, a bigger map adds walking time to both styles, and arrivals near the
   player's camp reach the turtle faster. What does cost a turtle time is (a) enemies
   that do not come to it and (b) a stream of arrivals that keeps coming until the field
   is clear.

## 2. Changes

### 2a. Rout reinforcement ladder (Dusk+)

On a rout map, a fixed, finite schedule of waves starts early and arrives every 2 turns,
each wave bigger and higher-level than the last. Clearing the field cancels the waves
still pending (the victory rule stays as it is). A fast clear sees one or two small
waves; a turtle sees all of them.

**Data.** Add `routLadder` to each mode in `difficulty.json` (`null` on `normal`). Each
row below is one wave: `[turn, count min–max, +levels]`. `turn` is the enemy phase whose
end brings the arrival, so arrivals first move one enemy phase later and the player
always gets a phase to react. Counts are absolute: no `enemyCountBonus` and no
`turnJitter`. The `xp` list is the per-wave reward multiplier (gold uses the same value
through `getEnemyRewardMultiplier`).

| Rung | Act I | Act II | Act III / IV (+ final) | `xp` per wave | Promoted arrivals |
|---|---|---|---|---|---|
| First Light | — | — | — | — | — |
| Dusk | T4 1, T6 1–2 | T4 1–2, T6 2 (+1), T8 2–3 (+1) | III: T4 2, T6 2 (+1), T8 2–3 (+1), T10 2–3 (+2); IV: T4 2, T6 2–3 (+1), T8 2–3 (+1), T10 3 (+2) | .75 .5 .25 .1 | never |
| Nightfall | T4 1–2, T6 1–2, T8 2 (+1) | T3 1–2, T5 2 (+1), T7 2–3 (+1), T9 2–3 (+2) | T3 2, T5 2–3 (+1), T7 2–3 (+1), T9 3 (+2) | .75 .5 .25 .1 | 4th wave, Act III+ |
| Black Sun | T3 1–2, T5 2, T7 2 (+1) | T3 2, T5 2–3 (+1), T7 2–3 (+1), T9 3 (+2) | T2 2–3, T4 2–3 (+1), T6 3 (+1), T8 3–4 (+2), T10 3–4 (+2) | .75 .5 .25 .1 0 | 4th wave on, Act III+ |

(These are `LADDERS.v2` in `sim/pacing.js`. `v1` is the heavier first prototype.)

- **It replaces the template's procedural `waves` and `extraWavesByDifficulty` on Dusk+
  rout maps.** It does not stack with them. Scripted waves stay: village bandits and
  authored maps. Templates opt out with `"ladder": false`. Seize and escape keep their
  current waves.
- **Ladder waves never raise par.** Today every arriving wave adds +1 par, which would
  cancel the pressure. Add `waveRaisesPar(spawn)` (false for `repeating` and `ladder`)
  to `ReinforcementScheduler` and use it in both the scene and the harness.
- **Escalation.** `+levels` are added to the copied template's level. On promoted waves
  the class is drawn from the act's `pools[act].promoted` (deterministically, from the
  spawn hash). The arrivals keep the copied template's affixes; they get no new rolls.
- **Where they spawn.** Wave 1 comes from the *front*, the map edge behind the enemy
  army. The front is computed once from the player-spawn and enemy-spawn centroids; if
  the horizontal gap is at least the vertical gap, the front is left or right, otherwise
  top or bottom. Later waves alternate [flank A + front] and [flank B + front], the
  flanks being the two edges across that axis. No tile within Manhattan distance 3 of a
  player unit is eligible, and neither is any tile next to an NPC or the caravan. If an
  edge runs out of tiles, the wave falls back to the front, and then to `blockedSpawns`.
  There are no rear spawns: the log rejects ambush spawns, and arrivals near the camp
  would only feed a turtle.
- **Telegraph.** The objective line reads, for example, "Reinforcements: 2 of 4 · next
  turn 6 · north flank". The schedule is deterministic, so this leaks nothing.
  Arrivals in fog stay unmarked (`ReinforcementPresenter.js:7,50`); the arrival band still
  counts them.
- **Finite, not open-ended.** A rout map must stay winnable by a weak army. An open-ended
  stream capped by the number of live reinforcements creates a stall equilibrium, where
  kills just keep pace with arrivals. The Eclipse and late pressure already price the
  time. XP falls to 0.1 and then 0, so waves cannot be farmed for XP or gold. Deeds still
  count those kills (`DeedSystem.js:205-214`); see the open questions.
- **Engine and scene.** `MapGenerator.cloneReinforcementConfig` builds the ladder (a pure
  helper in `ReinforcementScheduler`, `buildRoutLadder({ ladder, act, playerSpawns,
  enemySpawns })`). `scheduleReinforcementsForTurn` gains `avoid` and `minDistance` and
  passes `waveType: 'ladder'`, `levelBonus` and `promote` through on each spawn. Turn
  `buildReinforcementSpawnSpec` into a pure `engine/ReinforcementSpawnSpec.js` used by both
  BattleScene and the harness, and delete the harness copy. That copy is already out of
  parity: it skips `earlyEnemyAllowed` and `filterClassPoolByDifficulty`
  (`HeadlessBattle.js:691-750`). The BattleScene glue is 3 lines in
  `applyReinforcementsForTurn` (player positions, `waveRaisesPar`, the shared spec
  builder) plus the objective text.

**Dusk results (rout).**

| Configuration | Turns turtle / push | Turtle S/A/B/C | Push S/A/B/C | Shadow turtle / push (phases) |
|---|---|---|---|---|
| current | 6.3 / 5.1 | 79/17/4/1 | 92/7/1/0 | 3.9 (Pale 16) / 0.3 (Pale 16) |
| ladder | 8.0 / 6.0 | 57/15/19/9 | 77/7/12/4 | 29.3 (Waning 11) / 12.3 (Pale 15) |
| rout hold 25% only (2b) | 8.5 / 6.0 | 48/30/17/5 | 84/13/3/0 | 27.8 (Waning 9) / 1.4 (Pale 16) |
| **ladder + rout hold 20%** | **10.0 / 7.2** | **33/21/22/24** | **64/16/13/8** | **51.5 (Umbral+ 10/16) / 20.5 (Pale 10, Waning 6)** |

Reinforcements per rout battle with the ladder: turtle 3.9 (Act III 6.3), push 2.6. The
ladder on its own widens the gap between the styles from 1.2 turns to 2.0. But Act I maps
end before the first wave (0.2 waves per battle), so a turtle is still S-rank 57% of the time.

### 2b. Hold AI (seize and escape first; rout as an open question)

New `aiMode: 'hold'`, separate from `guard`. A holder does not move until its pack
wakes; once awake it hunts for the rest of the battle (no leash).

- **Wake rule** (pure, `engine/HoldActivation.js`, `wakeHolders(enemies, foes, ctx)`,
  called at the top of `AIController.processEnemyPhase`, so the scene needs no change). A
  pack wakes when any member:
  1. has a player or NPC unit on one of its threat tiles, from
     `ThreatForecast.enemyThreatTiles` (damage ∪ status) computed with true positions.
     These are the same tiles the Danger overlay draws for that unit, so "stepping into
     its red zone wakes it" is exactly the rule.
  2. is below full HP or carries a status condition (it was attacked, shoved or hexed).
  3. turn-pressure boss enrage is active (`isBossEnrageActive`), which punishes the clock.
  A pack is the set of holders linked within 3 tiles of each other at battle start,
  stored as `holdPack`. The wake state is a plain unit field and survives
  snapshots (`serializeBattleUnit` spreads the unit).
- **Anti-turtle `aggressiveMode` does not wake holders.** It still releases guard
  leashes and the throne clamp as it does today. If it woke holders, a turtle would only
  have to wait 3 turns.
- **Assignment** (`MapGenerator`, after `placeEnemies`): the RNG stream is derived from
  `battleSeed` and `'hold'`, so maps stay identical apart from this.
  - Seize: a share of the non-boss enemies, nearest the throne first. On Dusk+ it replaces
    the 15–25% guard roll.
  - Escape: enemies whose tile lies in the exit half.
  - Rout: the enemies farthest from the player's centroid. Never on fog maps, so nobody
    has to hunt holders they cannot see.

| Share | First Light | Dusk | Nightfall | Black Sun |
|---|---|---|---|---|
| Seize | guard 15–25% (unchanged) | 35% | 45% | 55% |
| Escape | 0 | 30% | 40% | 50% |
| Rout (open question) | 0 | 20% | 25% | 30% |

- **UI.** Holders keep their usual Danger zone. Inspect shows "Holding — wakes if you
  enter its range or strike its pack". This needs no PlayerKnowledge change: previews
  already read only seen units, and only execution and the AI see everything.
- **Cost.** Each sleeping holder costs one movement flood per enemy phase, the same cost
  as drawing its Danger zone; there are at most about 8 holders.
- **Evidence.** Rout hold at 25% is the most turtle-selective lever measured: the turtle
  loses 2.2 turns, the push player 0.9 (table above). It also makes the harness turtle
  stall more often (force-won battles: 3 → 21 on Dusk with hold alone, 10 with
  ladder + hold 20%). That is the reason for the fog exclusion and for the clear Inspect
  wording. Seize and escape holds are **not** simmed: both agents fall back to the
  charging `ScriptedAgent` there.

### 2c. Siege and status-staff ladder

First, fix Breachbolt. Enemy combat must spend a use (`spendPerBattleUse`). The AI picks
only a weapon that `canAttackWithWeapon` allows. A siege holder also carries the tier's
basic tome as a fallback, so it is not left inert once its shots are spent.

**Artillery AI.** A Breachbolt holder is a holder that never moves while it has shots
left. It fires from its post at the best target 3–10 tiles away, and it wakes into a
normal hunter once its shots are spent. ThreatForecast must draw its reach from its
current tile with `mov` 0 while shots remain, so the Danger overlay matches the AI. Danger
already shows Breachbolt and staff reach for seen units (`ThreatForecast.js:54-97`). The
result is a target the player has to go and kill, so a turtle eats a bolt every turn.

**Frequency.** Replace the per-spawn chance with a **per-battle chance, rolled only when
an eligible class is on the map**, on a stream derived from `battleSeed`. The table is
then the share of eligible maps, which is what the player actually feels. Measured today
(maps only, 40 seeds):

| Rung | Status staff, share of all battles (Act II / III / IV / final) | Siege, share of all battles (Act III / IV / final) |
|---|---|---|
| Dusk now | 0 / 0 / 0 | 0 / 0 |
| Nightfall now | 0 / 3% / 8% / 20% | 0 / 0 / 0 |
| Black Sun now | 5% / 10% / 15% / 35% | 4% / 10% / 13% |

Proposed per-battle chance, given an eligible caster (staves: Mage, Sage, Bishop on
about 40–75% of maps; siege: Sage, Warlock, Dark Knight, Grandmaster on 22–39%):

| Rung | Staff kinds | Staff chance II / III / IV / final, max | Siege chance III / IV / final, max, shots |
|---|---|---|---|
| Dusk | **Silence only** (the log rejects sleep-locking the carry) | 0 / .15 / .20 / —, 1 | 0 / .15 / —, 1, 2 |
| Nightfall | Silence + Sleep | .10 / .25 / .30 / .35, 1 | .25 / .30 / .35, 1, 2 |
| Black Sun | Silence + Sleep | .15 / .30 / .35 / .45, 2 | .35 / .40 / .45, 1, 3 |

Dusk keeps shop cures (`shopCureGating: null`). Black Sun's new numbers sit close to its
current *effective* shares once the eligibility gate is applied. The harness must mirror
enemy staves: today `HeadlessBattle` has no `onStatusStaff` callback, so the staff
decision is a no-op there (`HeadlessBattle.js:2107-2127`). Move the staff resolution into
an engine function used by both.

### 2d. Par and Eclipse

- **The Eclipse is unchanged** (grace 3, cap 6, gain ×1); it already prices time
  correctly (section 1).
- **Par.** No multiplier change for rout. The ladder already stops waves from inflating
  par. Re-rated on the ladder + hold runs:
  - Dusk inflation +2 instead of +3: turtle 60.1, push 26.9 (push mostly Waning).
  - Keeping +3: turtle 51.5, push 20.5.
  
  Recommendation: keep +3 and make `parInflation` a per-difficulty table, so that later
  tuning never touches First Light.
- **Seize par is loose** (S ≥ 94% everywhere up to Nightfall), but the only seize player
  we have is a protected, reckless charger. Re-measure once seize holds and a seize-aware
  agent exist (step 5 below), then consider `objectiveAdjustments.seize` per rung.

**Results with the ladder** (Nightfall and Black Sun use v2; "+hold" is rout hold 25%):

| Rung | Turns turtle / push (rout) | Push S+A (rout) | Turtle B+C (rout) | Shadow turtle / push |
|---|---|---|---|---|
| Dusk, ladder + hold 20% | 10.0 / 7.2 | 80% | 46% | 51.5 / 20.5 |
| Nightfall, ladder | 9.3 / 7.7 | 71% | 47% | 50.3 / 30.3 |
| Nightfall, ladder + hold | 11.8 / 8.7 | 59% | 61% | 71.6 / 45.3 |
| Black Sun, ladder | 13.6 / 12.1 | 49% | 69% | 83.0 / 63.9 |

The rungs stay well apart: on push, Dusk 20 < Nightfall 30–45 < Black Sun 64. On Black
Sun the ladder brings in *fewer* units than today (9.4 vs 10.1 per rout battle for push).
The extra difficulty comes entirely from par no longer rising with each wave (11.2 →
9.4). The army here is calibrated to a Dusk player, so the Black Sun row overstates the
pain. Ship it only after re-running with a Black Sun calibration.

## 3. Risks, targets, tests, rollout

**Balance targets** (`sim/pacing.js --edge 6`, 16 seeds, rout):
- Dusk push: ≥ 75% S+A and Pale or Waning at the end.
- Dusk turtle: ≥ 40% B+C and Umbral at the end in more than half the runs.
- Nightfall above Dusk on both styles, by at least 10 shadow.
- First Light: identical numbers (a regression gate).
- Force-won battles stay at or below 2× baseline.

**Risks.**
- XP falls on Dusk+ (fewer full-value kills); measure levels at each act's end before
  shipping.
- Holders could read as passive or buggy if the Inspect text and the Danger zone don't
  make the rule obvious.
- Flank arrivals in fog feel unfair; the telegraph line mitigates this.
- Deed kill counts inflate on long battles.
- Black Sun overshoot (above).

**Tests to write** (outcome-based; each catches one realistic failure):
1. `RoutLadder.test.js`:
   - A ladder rout map spawns exactly the schedule, with counts and levels per wave.
   - Par is unchanged after a ladder wave and still +1 after a scripted wave.
   - No arrival lands within 3 tiles of a player unit.
   - First Light configs are byte-identical to today.
   - Seed → identical spawns.
   - Clearing the field on turn N cancels the remaining waves (victory with the waves
     still pending).
2. `HoldActivation.test.js`:
   - A player unit outside the holder's Danger tiles leaves it asleep; one tile inside
     wakes it together with its pack.
   - Damage wakes it.
   - Anti-turtle `aggressiveMode` does not wake it; boss enrage does.
   - The wake state survives `serializeBattleUnit` round trips.
   - Preview parity with `PlayerKnowledgePreviews` worlds.
3. `SiegeUses.test.js`:
   - An enemy Breachbolt fires exactly `shots` times and then uses the fallback tome
     (this fails today).
   - The artillery Danger reach is drawn from the post.
4. `MapGenerator`: per-battle staff and siege shares within ±3 points of the table
   (400 seeds). Dusk never rolls Sleep.
5. Harness parity: the same map and actions under the scene and the harness give the
   same arrivals, levels and par (`GridParity`-style).

**Sims to re-run:**
- `sim/pacing.js` on all four rungs × both policies, with `--edge 6` and with the
  default army.
- `sim/eclipse.js --difficulty dusk|hard`.
- `npm run sim:fullrun:pr` and `test:harness:pr`. Threshold PR notes are likely, because
  shadow and turn counts move.

**Rollout, smallest safe slice first:**
1. Breachbolt use fix and `waveRaisesPar` (no tuning change on Dusk; Black Sun siege gets
   shorter). Add a harness mirror for anti-turtle and enrage (`engine/TurnPressure.js`,
   extracted from `BattleScene.js:2966-3107`) and for enemy staves.
2. Dusk rout ladder: data, the scheduler and the shared spawn spec, plus the telegraph
   text.
3. Hold AI on seize and escape (Dusk+), with a seize/escape-aware agent for the sims.
4. The status-staff and siege ladder.
5. Nightfall ladder, then the rout hold share (owner decision), then the Black Sun ladder
   after its own calibration. Seize par last.

**BattleScene and the open stability PRs (#171–#175** rewrite combat, death and
continuation code). All of the logic lives in engine modules: `ReinforcementScheduler`,
the new `ReinforcementSpawnSpec`, `HoldActivation`, `TurnPressure`, and `AIController`.
Scene glue is limited to:
- `applyReinforcementsForTurn` (about 3 lines);
- `updateObjectiveText` (the telegraph);
- enemy combat calling the shared use-spend;
- replacing `updateAntiTurtlePressure`'s body with the engine call.

None of these touch the death and continuation paths. Land after #175, or rebase on top
of it.

## 4. Open questions for the owner

1. **Rout hold share.** The ladder alone leaves the Dusk turtle S-rank on 57% of rout maps
   (shadow 29). Adding 20% rout holders raises turtle shadow to 51 at a cost of about 1.2
   turns to a push player. Accept it, or ship the ladder alone and re-measure with
   players?
2. **Deeds.** Should kills of zero-reward reinforcements count toward deed kill totals?
3. **Black Sun.** Adopt the v2 ladder (a big step up through par alone), or keep its
   current waves and only drop the par bump?
4. **Dusk staves.** Silence only (proposed), or also a low Sleep rate in Act IV?
5. **Breachbolt.** The fix ends Black Sun's de facto infinite artillery. Is 3 shots right
   there?
6. **Map size.** The evidence says bigger maps do not tax turtles. Keep sizes and get the
   flanking from the ladder's edges?
