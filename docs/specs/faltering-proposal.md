# Faltering: fair losses without save-scumming (proposal)

Status: **proposal, not built.** Nothing in `src/` or `data/` changes with this document.
Origin: playtester brief (Alex, 2026-09-25) and the earlier pitch "Faltering, then Hollowing".
Owner decision needed on the recommendation and on the open questions at the end.

## The brief, restated as three tests

A death system passes if players:

1. **want** to play with permadeath and without save-scumming, meaning the honest path is the attractive one, not only the enforced one;
2. **do** lose characters, and the losses feel fair: telegraphed, caused by decisions, not by a hidden coin flip;
3. **can keep going** after a loss without the run feeling pointless.

Alex's reference points are XCOM Long War 1.0 (bleed-out, stabilize, long recovery, small
permanent impairment) and Darkest Dungeon 1 (you can win on high difficulty while expecting to
lose good characters). His constraint: more systems are not better, so refine what exists.

---

## 1. Problem: what dying means in Emblem Rogue today

Measured from `origin/main` (data files, engine code, `sim:economy` 200 trials seed 7, and
400 generated node maps per act):

| Fact | Value | Source |
|---|---|---|
| Run ends when | the commander falls (Edric by default); fatal decision offers Vision or accept defeat | `BattleFatalDecision.js` |
| Other lords and recruits at 0 HP | removed at once, last words, gear to convoy, `fallenUnits` | `BattleScene.removeUnit`, `RunManager.completeBattle` |
| Church / pre-boss Ruins revive | `500 + 300 × level` G (× 2.5 promoted), **unlimited**, returns at 1 HP **with catch-up levels** to the living roster average (catch-up growths −10 pp) | `getReviveCost`, `RevivalCatchUp.js` |
| Revive price examples | L5 base 2,000 · L10 base 3,500 · promoted L5 5,000 · promoted L10 8,750 | constants |
| Battle income | ~20.5k G per run over ~19.8 battles (~1,000 G a battle); banked at Act II end 6.8k to 11.6k; the sim labels the economy "generous" | `sim:economy` |
| Where you can revive | every Church (0.4 per act on a random route in Act I, ~0.7 later) **plus the guaranteed Ruins before every boss** | node-map sample |
| Vision rewinds | 1 per run (+1/+2 meta), +1 per act boss; before any action on Normal/Hard, turn start on Lunatic | `getBaseVisionCharges`, `difficulty.json rewindGranularity` |
| Continue from Map | quitting a battle restarts it from entry (same seed) and refunds Vision; refused only for a fallen commander | `revertBattleInProgressToEntry` |
| Deploy / roster | 3–4, 4–5, 5–6, 6 by act; roster cap 12 (+3 meta) | `DEPLOY_LIMITS`, `ROSTER_CAP` |
| New bodies per act | ~0.9 recruit nodes on a random route (2.5 on the map) + 1 boss-recruit pick + occasional colosseum merc: **about 2 per act** | node-map sample |
| HP between battles | carries forward; Church and Ruins heal for free | `runReference.js` |

**Findings.**

- **Death is not permanent. It is a gold tax.** Any fallen unit can be bought back at the next
  Church or, at worst, at the Ruins before the boss, for about 2–9 battles of income. Catch-up
  levels mean a revived unit can come back *closer* to the army than when it fell. This fails
  test 2: nothing is really lost.
- **There are three undo buttons, and players use the cheapest.** Vision (1–3 charges),
  Continue from Map (free, costs replay time) and Church revive (gold). Playtest #27 (2026-09-22):
  a recruit died and the tester spent the only Vision charge to undo it. When undo is cheap and
  death is binary, undoing is the rational choice. This fails test 1 by design, not by player
  weakness.
- **There is no middle state.** At 0 HP a unit is gone, so there is no rescue on the field
  (the moment XCOM and Darkest Dungeon build their drama around) and no lasting mark on
  survivors. A unit either comes through clean or leaves the battle.
- **The pipeline is thin for real permadeath.** About two new bodies per act against a
  deploy of 4–6 leaves a bench of about 2–4. If deaths became final and frequent with nothing
  else changed, runs would spiral. That is the fear behind test 3.
- **The scripted sim cannot measure any of this yet.** `sim:fullrun` (200 trials, seed 11)
  loses in 2.9 battles on average with a 0% win rate. The design log (Deeds entry) records the
  same limitation. Tuning must use battle-slice fixtures and the invincible-commander harness
  (see §4).

---

## 2. What other games teach

| Game | At 0 HP | Rescue | Lasting cost | How a loss is survivable | Right / wrong for fairness |
|---|---|---|---|---|---|
| **XCOM EU/EW** | dies, or is *critically wounded* (more likely with high Will/rank, less with overkill) | bleeds out in ~3 turns; any medikit **stabilizes** (out for the mission); Savior/Revive returns them at 33% HP | long infirmary stay; **permanent −10 Will** (−15 Classic/Impossible) | winning the mission saves the bleeding | Right: rescue drama, winning as a save. Wrong: death versus wound is decided by a hidden roll |
| **Long War 1.0** | same, bleed-out 2–4 turns (Respirator Implant / Dual Heart extend it), ticking at the start of XCOM's turn, so "2" often means 1 | medikit stabilizes; Medic: **Field Medic** (free medikit use, items used twice), **Savior** (+2 item-free charges, +4 healing), **Revive** (33% HP) | injury ≈ 4 days + %HP lost × 60 days, cap growing 22 → 55 days over the campaign; 3–5 days **fatigue** after *every* mission, and sending a fatigued soldier returns them wounded; permanent Will loss when gravely wounded | **large roster by design**: rotation is mandatory, so the bench is always trained; Officer Training upgrades unlock on *total* ranks, not one hero | Right: losses are expected and absorbed; injuries make the bench play. Wrong: opaque timer (the 2-turn bleed), grindy recovery |
| **Darkest Dungeon 1** | **Death's Door**: −10 ACC, −25% DMG, −5 SPD, +33% stress; each further hit rolls **deathblow** (67% base resist, cap 87%, −15% per resisted blow) | healing lifts them off the Door | "Death's Door Recovery" (−2 ACC, −5% DMG, −1 SPD, +10% stress) until the expedition ends; stress/afflictions (25% virtue at 100 stress, heart attack at 200); quirks | weekly **stagecoach** recruits, barracks up to 28, Experienced Recruits upgrade; Stygian mode *budgets* deaths (lose at 12) | Right: danger is visible and escalating, replacements are cheap, the designers say to expect losses. Wrong: the deathblow roll can feel arbitrary; grind |
| **Fire Emblem** | Classic: dead. Casual: retreats and returns after the chapter. Fates **Phoenix**: back next turn. Tellius: story units **retreat** instead of dying | none on the field | Thracia 776 **fatigue**: an overused unit sits out the next chapter | rewinds: Divine Pulse (3 per battle, up to 13), Mila's Turnwheel (3–12), Engage's crystal (unlimited on Normal, 10 per battle on Hard/Maniac) | Right: Classic's stakes; Tellius retreat is an FE precedent for a middle state. Wrong: resets and rewinds make permadeath optional in practice, and Casual removes the stakes (Awakening's Casual split its own dev team) |
| **Into the Breach** | pilot dies with a destroyed mech (unless Medical Supplies) | none | pilot and skills lost | the **Artificial Pilot** keeps the mech fighting; one turn reset per battle | Right: losing a person is not losing capability. Wrong: little attachment to lose |
| **Battle Brothers** | 33% chance (90% with Survivor) to be *struck down* and live, unless killed outright | retreat off the map edge | permanent injuries, a few with upsides | cheap mercenaries to hire | Right: injuries tell stories. Wrong: survival is a coin flip the player cannot influence |
| **Wildermyth** | **mortal choice**: die now (the party gets a boon or a blaze of glory) or be maimed and withdraw | the hero withdraws | lost limb → hook hand (Hook Gouge, no weapon) or peg leg (speed); at most one per chapter, then death | legacy heroes and a generous design | Right: agency, and injuries change the character. Wrong: low dread |

**Lessons we adopt:**

1. **A visible state between alive and dead** (XCOM, DD, Tellius, Wildermyth) turns a death
   into a decision the player makes.
2. **The survivor leaves the fight.** Stabilized is out for the mission. Revive-into-combat is
   the part that breaks balance, which is why LW gates it behind a Medic perk.
3. **Make the price lasting but small** (LW's −10 Will, DD's recovery debuff, BB's injuries),
   and make recovery put the bench on the field (LW fatigue, Thracia fatigue).
4. **Deterministic chances, random hits.** The least fair parts of the references are hidden
   coin flips: XCOM's overkill roll, BB's 33% and DD's deathblow. Our bleed timer must be a
   number on screen.
5. **Replacement must be designed in** (LW roster, DD stagecoach, ItB's AI pilot).
6. **Undo competes with permadeath.** The cheapest undo becomes the real rule. We have three
   undo paths, and the fix is to make undo *unnecessary* more than to forbid it.

---

## 3. Options

All three share the core rule, called **Faltering**. B and C add to A.

### Option A — Faltering & Wounds (smallest: replaces Church revive)

**Rules.**

1. **Falter.** A non-commander player unit at 0 HP (after Miracle, which still fires first)
   does not die. It **falters**: it leaves the grid and leaves a **fallen marker** on its tile
   showing a number *T*. The commander is unchanged: 0 HP is the fatal decision, as today.
2. **Bleed.** `T = falteringTurns(difficulty) − scars carried`. When you **end your turn**,
   every marker loses 1. At 0 the unit **dies** (existing death funnel: last words, fallen
   band, `fallenUnits`). If T would start at 0, the unit dies at once. A death only ever
   happens when you press End Turn, so the End Turn confirmation lists who will die.
3. **Stabilize.** Any of these stabilizes a marker:
   - an ally ends its move adjacent to (or on) the marker and chooses **Stabilize**, which
     takes its action;
   - any ally-targeting staff in range: Heal/Mend/Recover at range 1, Physic 2, Rescue 2–3,
     Fortify's area. This spends one use and grants staff XP;
   - a healing item used on an adjacent ally (the existing cure/heal ally-item path).

   A stabilized unit is **carried off**: it joins the survivors list the Escape objective
   already merges back (`scene.escapedUnits`).
4. **Victory saves.** Markers still standing at victory survive, as in XCOM. Escape maps carry
   them out with the last lord.
5. **Markers are not units.** They do not block movement, cannot be attacked and are invisible
   to AI scoring. **Enemies do not finish faltering units** in Option A (see the AI section).
6. **Wound** (committed at victory, like Deeds and Eclipse shadow):
   - **Scar:** a permanent −1 to one stat (−2 max HP for the HP scar), never below the class
     base. Scars are `traits.json` entries of `kind: "scar"` that are never rolled at
     recruitment: Torn Sinew (−1 attack stat, resolved via Traits v2 `ATTACK`), Bad Knee
     (−1 Spd), Cracked Ribs (−1 Def), Shaking Hand (−1 Skl), Scorched (−1 Res), Deep Scar
     (−2 HP). The pick is deterministic: a hash of `runSeed` + unit + fall count, among
     scars not already held, weighted toward Scorched when magic caused the fall. It uses no
     battle RNG.
   - **Recovery:** the unit cannot deploy for *R* completed battles and rejoins at full HP
     when rested. The pre-boss Ruins rest takes 1 off every recovery. The Church's
     **Tend wounds** clears one unit's recovery for gold.
   - **Unready:** if deployable units would fall below the deploy minimum, recovering units
     may deploy at half HP.
7. **Comebacks are finite.** Because each scar lowers T, a unit has exactly
   `falteringTurns` comebacks, shown as ember pips on its card. Its last fall is a real death.
   The escalation keys off a unit's *history of falls*, never off how strong it is, as the
   2026-07-04 principles require.
8. **Church revive is retired.** A unit that bled out is gone. `fallenUnits` remains the
   memorial for records, narrative and run-end Deeds.

**Numbers (new `difficulty.json` keys).**

| Key | Normal | Hard | Lunatic | **Classic** (toggle, overlays any mode) |
|---|---|---|---|---|
| `falteringTurns` (= comebacks per unit) | 3 | 2 | 1 | 0: dies at once, today's rule |
| `woundRecoveryBattles` | 1 | 2 | 3 | — |
| `scarStatLoss` | 1 | 1 | 1 | — |
| `tendPrice` by act (× `shopPriceMultiplier`) | 300 / 500 / 700 / 900 | same | same | — |
| `mapRevertAfterDeath` | true | true | true | **false**: after a bleed-out, the battle can only be resumed |

Scale check: Traits v2 measured +1 in a stat at about +3 to +5 pp duel win (`sim:traits`). A
scar is therefore a felt but small cost, about LW's −10 Will. Two scars on a carry are a real
decline. Recovery of 1–3 battles in a ~20-battle run is roughly LW's weeks out on a ~52-week
campaign.

**Reuses / replaces.**

| Existing piece | Role in Faltering |
|---|---|
| Zombie tombstones (`_zombieTombstones`: tile, countdown, serialized in checkpoint and rewind) | model for markers (`scene._falteringUnits`) |
| `escapedUnits` survivor merge | carried-off units |
| Staff targeting, ally-item use | stabilize |
| Traits v2 (baked mods, `ATTACK` resolution, reclass re-bake, `traitContent` lines, migration) | scars |
| Deploy screen / `PartyMenus` availability | Recovering badge |
| Church menu | Tend replaces Revive (`reviveFallenUnit`, `getReviveCost`, `REVIVE_*` and `RevivalCatchUp` retire) |
| Deeds | *Would Not Fall* also triggers on a stabilization (no new deed); *Avenger* stamps the enemy that felled the ally |
| Vision picker chips | Faltered / Stabilized / Bled out |
| `completeBattle` victory commit | wounds, as for Deeds and shadow |
| Tutorial copy (`TutorialController` lines 344, 371) | taught by doing: Sera stabilizes |

**AI.** Base rule: enemies ignore markers. Letting the current AI finish them would make
Faltering permadeath with one turn of delay, because `_scoreAttackTarget` adds +12 for a kill
and every fall happens inside enemy reach. It would also re-create the "AI cleanup" feel the
brief calls unfair. Enemies may stand on or around a marker, so the tension becomes "can I
clear a way to her?", which is FE's own bodyguard play. For Hard and Lunatic the only
finishing threat is telegraphed through the affix engine (Option B §3).

**UI moments.** (1) Falter beat: the unit kneels into ink and ember, the band reads "Kira
falters · ②", the marker shows a kneeling silhouette and a number. (2) Unit selection:
**Stabilize** appears in the action menu. The forecast states "She leaves the field and lives.
Wound: out 2 battles, 1 scar." (3) **End Turn warning**, the only new confirm: "Kira will
bleed out. End turn?" (4) Victory band: "Kira lives, wounded." After the save, a wound card
in the Deed-rite style shows the scar name, −1 Spd, "Out 2 battles" and the pips left.
(5) Roster and deploy: "Recovering · 2" and scar lines ("Bad Knee: −1 Spd, fell at the Bridge,
Act II"). (6) Church: "Tend wounds". Loom copy: "Heal, tend the wounded and promote units."
(7) Help: a `runReference` entry "Faltering & wounds".

**Save / rewind.** Markers and bleed counters are battle-scene state captured like tombstones
(checkpoint adapter, Vision snapshot, `BattleStateDelta` keyed by `battleEntityId`), so
rewind and suspend stay exact. Wounds commit only at victory. Continue from Map therefore
discards falls for free on Normal/Hard, and on Classic it is refused after a bleed-out, the
way a fallen commander refuses it today (`recoveryKind`-style lock). Save fields:
`unit.wounds = { scars: [{ id, act, battle }], recovery, falls }`, absent on legacy saves.
Migration **grandfathers** units already in `fallenUnits` of an in-progress run: they stay
revivable at the old price until that run ends, so no save loses an option mid-run (the
Traits v2 precedent: saves only ever gain).

**Risks.** Normal could become death-free with 3 turns and no finishing, which fails test 2.
The dial is `falteringTurns` 3 → 2. Lunatic with one comeback and a thin pipeline could spiral,
which fails test 3; the dials are recovery 3 → 2 and recruit count. Retiring revive also removes
a gold sink from an economy the sim already calls generous; Tend and Kindle partly replace it.
Players may still use Continue from Map to erase a scar. On Normal/Hard that is accepted: the
goal is that a scar is cheaper than replaying a battle. Classic enforces it.

### Option B — A plus field medicine (the Long War medic layer)

Adds four rules to A, each independently shippable:

1. **Revive** (LW Revive/Savior): a staff user with MAG ≥ 14 (the existing second
   staff-use threshold) spends **2 uses** on an adjacent marker. The unit stands at 33% max HP
   and can act next turn. It still takes its Wound at victory, and **a second fall in the same
   battle is death** (Wildermyth's once-per-chapter rule, which also stops revive loops).
2. **Chosen scar** (Wildermyth agency): the wound card offers 2 deterministic scars and the
   player picks one, using the choice-card kit.
3. **Executioner affix** (`affixes.json`, tier 2, Hard and Lunatic gating only): its holder
   treats markers in reach as kill targets (+12, like any kill). The affix icon is shown and
   the danger overlay marks markers it can reach. This is the only way an enemy finishes a
   faltering unit: DD's Death's Door threat, but telegraphed on a specific enemy.
4. **Grave wound:** a crit that fells a unit adds +1 recovery (LW scales recovery with harm;
   the crit cut-in already announces it).

Cost: an AI hook (the Executioner scoring), a new staff mode, a choice screen, and roughly
twice A's tests. Risk: Revive makes a MAG-14 healer mandatory on Hard, and Executioner density
decides whether Lunatic is fair or a coin flip. Both need sim numbers before shipping.

### Option C — Faltering, then Hollowing (the Souls pitch)

Adds to A: a unit that bleeds out becomes **Hollow**. Later in the same act, an eclipsed battle
(the Eclipse already transforms nodes) fields it as a red-palette enemy with its class, level,
weapon and epithet. Defeating it **lays it to rest**: the Oath of its greatest deed drops as an
"Ember" item that teaches the skill, and its gear returns. A Church Kindle can instead call it
back as a Hollowed ally: no growth, no deeds, dies outright if it falls.

- For: the most memorable version. Losses create content, which serves test 3, and it ties
  Deeds and the Eclipse together.
- Against: it is a new system (enemy generation from the roster, narrative, art); your dead
  fighting you piles punishment onto a loss; it is hostile to FE purists (Alex's own worry);
  and **"Hollow" already names the Eclipse's final phase** (shadow 100), so the word would mean
  two things.

---

## 4. Recommendation

**Build Option A, keep B3 (Executioner) ready as the Hard/Lunatic dial, and do not build C.**
Keep "Faltering" as the name: it reads as FE (Tellius retreat, a Casual mode with teeth), not
as Souls. The "Hollow" vocabulary stays with the Eclipse.

How A meets the three tests:

1. **Want:** most falls become a scar and a short absence, so spending Vision on a recruit
   knockdown or restarting the battle stops being the rational play. Vision is left for
   disasters and the commander, which is what it is for.
2. **Lose, fairly:** every death is preceded by a visible number, a rescue window and an End
   Turn warning, and it lands on a unit whose pips already said it was on borrowed time. No
   coin flip decides who lives. RNG decides hits, as FE always has.
3. **Keep going:** losses arrive gradually (scars, then death), recovery puts the bench on the
   field before a death, and gear still passes to the convoy. If post-death runs collapse in
   sims, the first lever is data (`targetRecruits`), then reusing `RevivalCatchUp` for the next
   recruit after a death, before any new mechanic.

**System ledger.** Faltering adds one battle state (markers) and one unit record (wounds). It
removes Church revive, its catch-up path and one of the three undo incentives. It is built from
the tombstone, escape, staff, trait, deed, affix, church and deploy code listed in §3A. The net
count of player-facing systems is unchanged, and the one rule players must learn ("fallen allies
bleed for N turns; reach them") is the most familiar rule in the genre.

### Phased build

| Phase | Scope | Exit criterion |
|---|---|---|
| **0 · Baseline** (no gameplay change) | Add fall, death, revive-gold, Vision-after-death and map-revert telemetry to `HeadlessBattle` and the full-run driver. Build battle-slice fixtures (Act I–IV, deploy vs pool) that run with an invincible commander. Alex plays one self-imposed "no revive, no rewind for recruits" run as a baseline. | today's deaths per battle and per run, by act and difficulty |
| **1 · Engine** behind `faltering.enabled` (data, default off) | Pure `FalteringSystem.js` (falter, bleed tick, stabilize, victory resolution, deterministic scar pick, recovery tick, Tend); `difficulty.json` keys + schema; scar entries in `traits.json`; wound serialization + migration; `completeBattle` commit; HeadlessBattle mirror with a "stabilize if reachable, else fight" agent rule | unit and integration tests green; the sim runs both rule sets |
| **2 · Tune** | `node sim/faltering.js` on slices × difficulty × `falteringTurns` 1–3 (below) | targets met or keys changed |
| **3 · Presentation** | markers, Stabilize, staff/item targets, End Turn warning, rewind chips, wound card, roster/deploy badges, Church Tend, help, tutorial, Classic toggle on DifficultySelect (+ badge in records) | e2e at 1280×800, 844×390, 640×480 |
| **4 · Playtest and dial** | Alex runs Normal and Hard. Decide on Executioner (B3), Normal's `falteringTurns`, and whether Revive (B1) is wanted | owner sign-off |

**Tests.** Bleed arithmetic per difficulty including scars and the T = 0 case; the End Turn
death list; stabilize by adjacency, each staff range and an item; victory and escape saves;
commander exemption; Miracle precedence; scar pick deterministic with no `Math.random` and no
battle-RNG draws (Traits v2 draw-budget style); `BattleSnapshotContracts` (rewind before and
after a falter, suspend and resume, exact); Continue from Map discards (and is refused on
Classic after a death); legacy save loads and grandfathered revive; recovery countdown, Ruins
rest, Tend pricing, the Unready fallback; Deeds hooks (Would Not Fall, Avenger).

**Sim targets** (starting points to confirm with Alex, not promises):

| | Normal | Hard | Lunatic |
|---|---|---|---|
| falls stabilized or saved by victory | ≥ 80% | 65–75% | 50–60% |
| true deaths per winning run | 0.3–0.8 | 1–2 | 2–4 |
| winning runs that lose a unit at or above roster-average level | ~15% | ~35% | ~50% (the DD target) |
| win-rate change vs today's revive rules | within ±5 pp | within ±5 pp | ≤ −5 pp accepted |

Scar value is measured with `sim:traits` (a scar is a negative trait). Economy is re-checked
with `sim:economy` because revive spending is gone.

### Open questions for the owner and Alex

1. Should **Classic** also switch off Vision? FE's own Classic modes have kept rewinds since
   Echoes. Recommendation: no. Vision is Sera's story and Lunatic already limits it.
2. Retire revive on **Normal** too? Recommendation: yes. The alternative is keeping it on
   Normal only, at twice today's price and without catch-up.
3. Should the **commander** falter? Recommendation: no. One hard FE rule keeps the run's
   stakes and the existing fatal-decision flow.
4. Is Normal's bleed of 3 too soft? Decide from Phase 2 numbers.

---

## Sources

The research environment could not open ufopaedia.org, the Fandom and wiki.gg wikis, Substack
or gamedeveloper.com directly. The figures below come from search-engine extracts of the
cited pages. Spot-check them before quoting them in player-facing text.

- Long War medic, bleed-out and perks: [Medic (Long War), UFOpaedia](https://www.ufopaedia.org/Medic_(Long_War)) ·
  [Abilities List (Long War), UFOpaedia](https://www.ufopaedia.org/index.php/Abilities_List_(Long_War)) ·
  [Long War Class Builds: Medic](https://xcom.substack.com/p/long-war-class-build-medic)
- Long War injury, recovery and fatigue: [Soldiers (Long War), UFOpaedia](https://www.ufopaedia.org/index.php/Soldiers_(Long_War)) ·
  [Recovery time, UFOpaedia](https://www.ufopaedia.org/index.php/Recovery_time) ·
  [Injury and Fatigue (LWR), UFOpaedia](https://www.ufopaedia.org/index.php/Injury_and_Fatigue_(LWR)) ·
  [Fatigue wound time, Pavonis forums](https://www.pavonisinteractive.com/phpBB3/viewtopic.php?t=18) ·
  [Officer Training School (Long War), UFOpaedia](https://www.ufopaedia.org/index.php/Officer_Training_School_(Long_War)) ·
  [Long War (mod), Wikipedia](https://en.wikipedia.org/wiki/Long_War_(mod))
- XCOM EU/EW critical wounds: [Critical Wounds (EU2012), UFOpaedia](https://www.ufopaedia.org/index.php/Critical_Wounds_(EU2012)) ·
  [Bleeding out, XCOM Wiki](https://xcom.fandom.com/wiki/Bleeding_out) ·
  [Soldier (XCOM: EU), XCOM Wiki](https://xcom.fandom.com/wiki/Soldier_(XCOM:_Enemy_Unknown)) ·
  [Secondary Heart, XCOM Wiki](https://xcom.fandom.com/wiki/Secondary_Heart) ·
  [Tired or shaken (War of the Chosen), XCOM Wiki](https://xcom.fandom.com/wiki/Tired_or_shaken_(War_of_the_Chosen)) (the "Shaken" state is XCOM 2's, not LW1's)
- Darkest Dungeon: [Death's Door, official wiki](https://darkestdungeon.wiki.gg/wiki/Death's_Door_(Darkest_Dungeon)) ·
  [Status Effects, official wiki](https://darkestdungeon.wiki.gg/wiki/Status_Effects_(Darkest_Dungeon)) ·
  [Stress, official wiki](https://darkestdungeon.wiki.gg/wiki/Stress) ·
  [Virtue, official wiki](https://darkestdungeon.wiki.gg/wiki/Virtue) ·
  [Stage Coach, official wiki](https://darkestdungeon.wiki.gg/wiki/Stage_Coach) ·
  [Game Modes, official wiki](https://darkestdungeon.wiki.gg/wiki/Game_Modes) ·
  [Designing for despair, Game Developer](https://www.gamedeveloper.com/business/-i-darkest-dungeon-i-designing-for-despair-and-kicking-you-when-you-re-down) ·
  [Red Hook development interview, 80.lv](https://80.lv/articles/red-hook-studios-talks-about-the-creation-of-darkest-dungeon) ·
  [A Mechanical Critique of Darkest Dungeon, The Gemsbok](https://thegemsbok.com/art-reviews-and-articles/darkest-dungeon-red-hook-critique-mechanics-design/)
- Fire Emblem: [Gameplay modes (Classic, Casual, Phoenix), Fire Emblem Wiki](https://fireemblemwiki.org/wiki/Gameplay_modes) ·
  [Phoenix Mode](https://fireemblem.fandom.com/wiki/Phoenix_Mode) ·
  [Divine Pulse](https://fireemblemwiki.org/wiki/Divine_Pulse) ·
  [Mila's Turnwheel](https://fireemblemwiki.org/wiki/Mila's_Turnwheel) ·
  [Draconic Time Crystal](https://fireemblemwiki.org/wiki/Draconic_Time_Crystal) ·
  [Fatigue (Thracia 776)](https://fireemblemwiki.org/wiki/Fatigue) ·
  [Tellius retreat discussion, ResetEra](https://www.resetera.com/threads/it-bugs-me-that-most-modern-fire-emblem-characters-dont-actually-die-in-permadeath-mode.83633/) ·
  [Awakening's Casual mode debate, Nintendo Life](https://www.nintendolife.com/news/2013/04/talking_point_fire_emblem_awakening_the_big_casual_mode_debate) ·
  [Casual mode and the developers, Arcade Sushi](https://arcadesushi.com/fire-emblem-awakenings-casual-mode-stirred-up-developer-arguments/)
- Into the Breach: [Pilots](https://intothebreach.fandom.com/wiki/Pilots) ·
  [Artificial Pilot](https://intothebreach.fandom.com/wiki/Artificial_Pilot) ·
  [Medical Supplies](https://intothebreach.fandom.com/wiki/Medical_Supplies)
- Battle Brothers: [Dev Blog #79: Injury Mechanics](https://battlebrothersgame.com/dev-blog-79-progress-update-injury-mechanics/) ·
  [Permanent Injuries, wiki](https://battlebrothers.fandom.com/wiki/Permanent_Injuries)
- Wildermyth: [Mortal Choice, Wildermyth Wiki](https://wildermyth.com/wiki/Mortal_Choice) ·
  [Hero, Wildermyth Wiki](https://wildermyth.com/wiki/Hero)
- Emblem Rogue internals: `docs/design-log.md` (2026-07-04 principles; 2026-09-25 Eclipse, Deeds,
  Traits v2, Rewind), `docs/specs/eclipse.md`, `docs/specs/traits-v2.md`,
  `docs/specs/deeds-epithets.md`, `docs/specs/rewind-any-action.md`,
  `docs/playtest-2026-09-22.md` #27.
