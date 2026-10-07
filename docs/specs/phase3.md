# Phase 3: skills, Marks, the Necromancer, bosses with more than one bar, Steal

Status: **draft for owner review** (2026-10-07). It turns the direction in
`docs/specs/event-nodes.md` §14–§15 into a build plan. Every hook named below was read
in the code on main at `7e133a252`. Line numbers drift, so the function names are the
reference.

What the owner has already decided (2026-10-06):

- **More skills and more ways to learn them.**
- **Marks** (crest-style procs) go on **recruits only**, at a low base rate that a Home Base
  upgrade raises.
- A **late-game Necromancer** raises Skeletons.
- **Bosses with more than one bar** (Revival Stones).
- **Blink Strike** is added.
- **Accessories that roll a skill.**
- **Steal**, paired with enemies that carry items on higher rungs and in later acts.
- Weapon-art awakening is **on hold**.
- **Skipped:** Breaks, adjutants, chains.
- **Don't add too many systems.**
- **Art** for the new units and skills goes through the image-gen and trace pipeline
  (`docs/specs/event-art.md` items 5–9).

The rules from Phase 2 hold. The engine comes first and is pure, and its tests land with it;
the UI only draws. Anything shown before a commit reads what the player knows
(`engine/PlayerKnowledge.js`). HP changes go through `engine/UnitHealth.js`. A rule the
harness needs lives in an engine module, never as a second copy in `HeadlessBattle`.

**Decisions for the owner** are marked **[Q]** and gathered at the end. Each one carries a
recommendation, so building can start with it.

## Build order

| Step | What | Why it goes here |
|---|---|---|
| **3A** | One `effectiveSkills(unit)` read | Accessory skills, and any skill that does not come from the unit's own list, need it. It also fixes legendary weapons' skills going unread on several paths. |
| **3B** | The on-kill trigger and the passive and opening skills (Lifetaker, Speedtaker, Uncanny Blow, Warding Blow, Defiant) | Mostly data. The on-kill step is reused by the Marks. |
| **3C** | Marks | Needs the 3B on-kill step and a turn-start buff. |
| **3D** | Revival Stones | Engine only, independent. |
| **3E** | Action skills (Great Sacrifice, Goddess Dance, Blink Strike) and Pass | The action-to-attack chain is the one new flow. |
| **3F** | Weapon arts (Lunar Brace, Override) | Combat mods plus the area-push extension. |
| **Fix** | Contract reward recovery (owner review P2, below) | An earned reward must stay owed until it is delivered or given up. It goes before any new reward-bearing or inventory mechanic. |
| **3G** | Steal and enemies that carry items | A new ability kind plus a generation roll. Waits on the contract fix. |
| **3H** | Existing accessories can roll a bound skill, rarely (owner, 2026-10-07; replaces Bond Rings) | Needs 3A. Wants 3B and 3E so the skill pools are wider. |
| **3I** | The Necromancer and Skeletons | Art first: `tests/TracedSprites.test.js` refuses a class without traced keys. |

Art runs alongside, starting at once. The Necromancer and Skeleton references and the
caravan Merchant portrait come first because 3I waits on them. Proc visuals and stone pips
follow their steps.

Each step is one PR, merged when CI is green. A large step gets a review pass first.

**Progress (2026-10-07).**
- Merged:
  - the art batch (#222);
  - 3A (#221), 3B (#223), 3F (#224), 3C (#225), 3H (#226), 3I (#228), 3D (#229), 3G (#231),
    3E (#232): every Phase 3 step;
  - the Lingering Injury rename (#227);
  - the contract fix (#230).
- What each step changed from the plan is in "As built" at the end.

## Shared boundaries (acceptance criteria)

Owner review, 2026-10-07: organise acceptance around the boundaries the features share, not
only around the feature names. Each step's tests must hold the rows that touch it.

### One effective-skill model

`effectiveSkills(unit)` (3A, as built) is the only battle read of a unit's skills. It
combines four kinds of source:

- learned, class and personal skills, from the equipped list `unit.skills`;
- the weapon in use's `_grantedSkill`;
- the equipped accessory's `_boundSkill` (3H: an existing accessory that rolled one).

How it treats them:

- **Duplicates:** counted once, in that order.
- **Benched skills:** never effective.
- **Removable vs fixed:** a bound skill is removable with its item. A learned skill is
  removable only by benching, under `SkillLoadout`'s lock rules.
- **What reads it:** every surface that names or uses a skill. That is the forecast, the
  action menu, the Ability picker, Canto, auras, turn-start effects, range, terrain cost and
  the harness. So a lent skill that shows in the UI also works everywhere.
  `tests/EffectiveSkillsBoundary.test.js` holds this line.
- **Per-battle limits:** usage is recorded on the unit by skill id
  (`_battleAbilityUsage.map[id]`), never on the item. Unequipping an accessory and equipping it
  again, or trading it to another unit, does not reset a limit the unit has spent.
  - 3H tests this for an accessory-lent Blink.
  - A second unit that receives the accessory has its own count. That is intended: the limit
    belongs to the user.

### Death versus defeat

| Event | Kill credit and weapon kill count | XP | Gold | Victory and objective checks | On-kill (skills, Ember) | Death-triggered effects (Deathburst, crumble) | Deeds |
|---|---|---|---|---|---|---|---|
| A boss's bar breaks (a stone spent, 3D) | no | damage XP only, no kill bonus | none | no | no | no | no kill |
| A boss's last bar falls | yes | kill XP | kill gold and boss bonus | yes | yes | yes | yes |
| A Skeleton is killed (3I) | yes (weapon count) | a quarter of kill XP | none | yes (it is an ordinary foe until it falls) | yes, once per combat as always | no | no kill (`isZeroRewardUnit`) |
| Skeletons crumble with their Necromancer | no (no killer) | none | none | yes: removed before `checkBattleEnd` | no | no | no |
| A risen Zombie is killed | as today (`_noXP`) | none | none (the harness now agrees) | yes | yes | no | no kill |

**The default.** An intermediate bar is never a separate kill.

**Repeatable summons are never an unlimited reward source.**
- A Necromancer raises at most 2 standing Skeletons.
- It raises at most **6 Skeletons per battle in all**: a lifetime count on the Necromancer,
  which suspend and rewind keep.
- Each Skeleton pays a quarter of the XP and no gold.
- So the reward is bounded at 6 × a quarter of the XP, and the late-pressure decay past par
  still applies.

### Identity and ownership

- **Marks: who can roll one** (3C, as built). The roll lives in
  `UnitManager.createRecruitUnit`, and each entry path is tested:
  - recruit nodes;
  - event joins;
  - boss recruits;
  - Colosseum mercenaries;
  - the Vanguard Cadre.

  These never bear one: lords, the third lord, the veteran and prologue units.
- **A summon's owner** is `_raisedBy`, the Necromancer's `battleEntityId`, which survives
  saves and rewind. Rewards and crumbling read it, never a position or a name.
- **Steal** (3G) is one atomic operation:
  - It checks capacity first (bag, then convoy).
  - It moves the **same item instance**, keeping its uid, uses and forge or wear fields, out
    of the carrier and into one destination, under one checkpoint.
  - A refused Steal changes nothing.
  - Rewind and resume restore both sides from one snapshot, so the item can never exist
    twice or vanish. Tests read item uids across a suspend, a resume and a rewind.

### Earned rewards: one lifecycle

There is one meaning of "earned but not yet delivered". It is the event-spoils lifecycle:

- the outcome is judged once and persisted;
- delivery is retried until it succeeds;
- only an explicit, confirmed give-up ends it.

Contracts move onto that lifecycle in the fix step. Any later mechanic that pays a reward
reuses it, never a "No room" note that closes the claim. Steal is a transfer, not a reward,
and is refused when there is no room. A carried item is lost with its carrier ([Q4]), as
the carry chip says.

---

## 3A. One read of a unit's skills

**Today.** A legendary weapon's bound skill (`weapon._grantedSkill`, written only by
`LootSystem.generateRandomLegendary`, pool sol/luna/vantage/wrath/adept) is read by four
paths:

- `SkillSystem.getSkillCombatMods`
- `SkillSystem.rollStrikeSkills`
- `SkillSystem.rollDefenseSkills`
- `SkillSystem.checkAstra`

Combat.js's forecast proc warnings also read it.

Every other battle path reads `unit.skills` directly, so a bound skill is invisible to it:

- **Auras:** `getSkillCombatMods`' ally and enemy aura loops.
- **Turn start:** `getTurnStartEffects`.
- **Range:** `getWeaponRangeBonus`.
- **Terrain cost:** `getTerrainCostReduction`, read by BattleScene and by six AIController
  sites.
- **Action abilities:** `ActionAbilitySystem.getActionAbilities`.
- **Canto:** `CantoRule.cantoRuleFor`.
- **Action menu:** Shove, Pull and Dance (BattleScene, `MovementActionController`,
  `findDanceTargets`).
- **Display:** the forecast and HUD skill lists.

None of the five legendary skills lives on those paths today, so nothing is broken yet. A
bound skill of any other kind would be.

**Rule.** Add `engine/EffectiveSkills.js`:

- **`effectiveSkills(unit, { weapon })`** returns `unit.skills`, then the equipped weapon's
  `_grantedSkill`, then the equipped accessory's bound skill (3H). The list is de-duplicated
  and keeps that order. `weapon` defaults to the equipped weapon. A combat read passes the
  weapon in use, as `getSkillCombatMods` already honours `context.weapon`.
- **`hasEffectiveSkill(unit, id, opts)`** is the boolean form.
- Benched skills are never effective. A bound skill is not "known": `knowsSkill` stays the
  test for learning and teaching, so a scroll can still teach a skill an accessory lends.

Every battle read in the list above moves to it. A grep test holds the line, as
`HpWriteBoundary` does: `unit.skills` may be read in battle code only by `EffectiveSkills`,
`SkillLoadout`, `learnSkill` and the roster and loadout UI. The test also checks that its own
allow-list cannot go stale.

**Tests:**

- Pin today's behaviour first: a legendary Sol or Luna procs and a Vantage weapon's opening
  applies. These tests pass before and after the change.
- Then, for each of the paths above, a unit whose only source of the skill is a bound one
  gets the effect. Use a test-only bound Renewal, Charisma, Foresight, Pathfinder, Blink,
  Canto and Shove.
- A benched skill is never effective.
- A bound duplicate of a known skill does not count twice: two auras of the same id from one
  unit are one aura.

---

## 3B. On-kill, and the passive and opening skills

### The on-kill trigger

Nothing in the game fires on a kill today. The closest precedent is the weapon-art
`killBuff`: it is a post-combat step (`art_kill_buff`) in
`WeaponArtPostCombat.getPostCombatPipelineSteps`, applied in `PostCombatEffects` only if the
target's `currentHP <= 0` when the step runs.

**Rule:**

- Add the trigger `on-kill` to `schemas/skills.schema.json`.
- Add one pipeline step, `skill_on_kill`, built from the effective skills of each side in
  that combat. The side that killed gets the step.
- A counter that kills counts. So does a kill by the actor's own area strike in the same
  combat (a line or area art).
- **Once per combat:** killing two foes in one action fires each on-kill skill once.
- The step runs after `art_kill_buff`. It reads `world.skillsData`, which the scene's
  `_postCombatWorld` and the harness's world both gain, so the scene and the harness share
  the step.
- Kills that are not a combat do not fire it: Deathburst, terrain, hazards, poison ticks.
  Neither does a kill by a unit that is itself down after the exchange.

### Lifetaker and Speedtaker

**Lifetaker** heals 25% of max HP (floored, minimum 1) on a kill.

- The heal goes through `UnitHealth.healUnit`, so Wounded still blocks it.
- The presentation beat is `hp` with the hint "Lifetaker".

**Speedtaker** gives +1 SPD for the rest of the battle on a kill, up to +5.

- The bonus goes through `BattleStatDeltas.applyBattleDebuff(unit, 'SPD', +1)`. That function
  accepts a positive value and reverts at battle end. `_battleDeltas` is shared with debuffs
  and Intimidate, so the stack count is kept in its own field, `_speedtakerStacks`.
- `RunManager.serializeUnit` deletes `_speedtakerStacks` at battle end, next to
  `_battleAbilityUsage`.
- The field rides suspend and rewind through `serializeBattleUnit`'s spread.

### Uncanny Blow, Warding Blow and Defiant

- **Uncanny Blow:** on-combat-start, `condition: "initiating"`, `hitBonus: 30`.
- **Warding Blow:** on-combat-start, `condition: "initiating"`, `resBonus: 6`.
- Both are data only: the generic on-combat-start path already applies `hitBonus` and
  `resBonus`.
- **Defiant:** on-combat-start with a new condition, `below25` (`currentHP <= floor(HP/4)`,
  beside `isBelow50`), giving `defBonus: 4` and `resBonus: 4`.

### How they are learned

Each skill gets a scroll in `weapons.json`: `type: "Scroll"`, `tier: "Rare"`, price 2500, and
an icon from the icon grammar (art item 5). The scrolls join the act 2–4 `skillScroll` loot
pools. Act 1 keeps none.

Event teachers widen their pools:

- **The Old Swordmaster:** Sword gains Uncanny Blow; Lance gains Warding Blow.
- **The Chained Shelf:** gains Lifetaker.

No deed gains an Oath for these skills. An Oath skill is one that nothing else teaches
(`docs/specs/deeds-epithets.md`; `tests/DeedSystem.test.js` holds it), and all five have
scrolls. The Last Dance and The Last keep swearing nothing (fixed in 3B review).

Enemies keep their own fixed skill list (`UnitManager.assignEnemySkills`). None of the new
skills is added to it in Phase 3: enemy Lifetakers would change act balance, and enemy
skills are sim work of their own.

**Tests:**

- An on-kill fires on a kill, a counter-kill and an area kill, and never on a non-kill.
- Two kills in one action fire it once.
- Lifetaker's heal is blocked by Wounded.
- Speedtaker caps at +5, its bonus is reverted at battle end, and its stacks survive a
  suspend and a rewind.
- `below25` holds at the boundary: HP 10 → 2 holds, 3 does not.
- Every on-kill test runs through the real generator in both the scene world and the harness
  world.

---

## 3C. Marks

A Mark is a rare second roll at recruitment, next to traits. It is shown beside the traits
and fires in battle like a proc skill.

### Data, storage and the roll

- **Data:** `data/marks.json`, validated by a schema: `[{ id, name, description, trigger,
  chance, effect }]`.
- **Storage:** a unit stores `unit.markId` (one or none). It does not use `unit.mark`,
  because `classCrests.js` and `crestArt.js` already use `spec.mark` for class crest art.
- **Saves:** `serializeUnit` has no field whitelist, so the id saves and loads as it is. An
  unknown id is ignored when read, as `getUnitTraits` filters unknown trait ids. Old saves
  have none.

The roll happens once, in the common builder:

- **Where:** `UnitManager.createRecruitUnit`, right after `rollAndApplyTraits`.
- **Who reaches it:** recruit nodes, event joins, boss recruits, colosseum mercenaries and
  the Vanguard Cadre's extra starting unit all pass through it.
- **Who never reaches it:** lords (`createLordUnit`, `createBossLordUnit`, the third lord),
  the veteran (`createVeteranKnight`) and prologue units. So "recruits only" holds by
  construction, and a test asserts it for each source.
- **Its own stream:** `createSeededRng(hashStringToUint32(`mark:${runSeed}:${unit.name}`))`,
  following `_lordTraitRng`. Names are unique within a run (`getTakenUnitNames`). Drawing
  from the caller's stream instead would shift everything the seeded recruit-node stream
  rolls after the traits (`ensureOneTrait`, gear, forges).
- **The rate:** `metaEffects.markChance`. Its default is set in
  `MetaProgressionManager.getActiveEffects`, it is snapshotted into the run like every meta
  effect, and it reaches `createRecruitUnit` through `options.metaEffects`.

### The Home Base upgrade

| | |
|---|---|
| Base rate | 10% (1 recruit in 10) |
| Upgrade | **Marked Blood** (`marked_blood`), category `recruit_stats` (supply) |
| Tiers | 2: 1 in 6 (`markChance: 0.1667`), then 1 in 4 (`markChance: 0.25`) |
| Costs | 250 / 400 (proposal; set against the other recruit_stats upgrades) |
| Requires | beatAct1 |

### The five Marks

They are named for the Hollow Sun. Each rolls on the battle RNG (the battle's `Math.random`
stream, which the checkpoint restores).

| Mark | Fires | Effect | Hook |
|---|---|---|---|
| **Mark of the Forge** | 20% when a weapon art's HP cost is paid | the cost is not taken | `WeaponArtSystem.applyWeaponArtCost` (scene and `AreaTargetingController`); affordability (`canUseWeaponArt`) is unchanged |
| **Mark of the Hunt** | 15% per strike | +5 damage on that strike | `Combat.rollStrike`, beside the on-attack procs, as a strike-level `atkBonus` (no `mightBonus` key exists, and +5 Mt and +5 damage are the same number before DEF) |
| **Mark of the Ember** | 20% on a kill | restores 5 HP | the 3B `skill_on_kill` step, through `healUnit` |
| **Mark of the Veil** | 15% when a magic strike lands on the bearer | halves its damage | `SkillSystem.rollDefenseSkills`, beside Aegis; it does not stack with Aegis (one halving) |
| **Mark of the Road** | 25% at the bearer's player-phase start | +1 MOV this turn | a new turn-start effect type, `buff`, from `getTurnStartEffects` into `TimedWeaponArtBuffs.applyTimedBuffEntry` (MOV is a timed core stat), expiring at the end of that player phase |

### How a Mark shows

- **Proc banner:** a fifth category, `mark`, in `ProcVisualTheme.classifyActivation`, with
  its own colour. An unknown id would otherwise show as neutral cyan.
- **Forecast:** Hunt and Veil are listed as possible procs, as Luna and Aegis are. The
  projection hides HP outcomes it cannot promise, using the list `Combat.js` keeps for
  Miracle and the like.
- **Unit card:** one "Mark" line under the traits wherever `traitLines` is read: the unit
  detail overlay, the roster, the mobile roster sheet, recruit cards (`choiceContent`), the
  party menus and the Loom panels.
- **Where the Mark lives in code:** marks are not traits, so they never touch
  `masteryPerkMultiplier`, creation mods or `migrateUnitTraits`.

### Tests

- Every recruit source rolls a Mark at the configured rate (statistically, over seeds).
- Lords, the veteran and prologue units never bear one.
- The same run seed and name give the same Mark, and the Mark roll leaves the recruit-node
  stream untouched: the unit is identical with Marks on or off apart from `markId`.
- Each Mark fires at its chance on a stubbed battle RNG, and never at 0.
- Forge never makes an unaffordable art usable.
- Veil and Aegis together halve once.
- Road's +1 MOV expires at the end of the phase and is gone after `serializeUnit`.
- The upgrade's tiers reach the run's snapshot.
- An old save loads with no Mark.

---

## 3D. Bosses with more than one bar (Revival Stones)

A boss with stones refills to full HP when a blow would drop it to 0, once per stone. The
bar shows a pip for each remaining stone. The forecast says "2 bars".

### Where the rule lives

The whole exchange is computed before anything is drawn (`Combat.resolveCombat`): HP lives
in locals, and each strike carries `targetHPAfter`. Both the scene and the harness apply the
result through `UnitHealth.applyStrikeHP` and `UnitHealth.applyCombatHP`. So the combat rule
goes into the exchange itself:

- **The rule:** in `rollStrike`, after on-defend skills, Miracle and affixes have run, a
  strike whose `targetHPAfter` would be 0 on a unit with `revivalStones > 0` sets
  `targetHPAfter = stats.HP`, spends a stone and marks the event `stoneBroken: true`.
- **Everything else follows from that one write:** `applyStrikeHP`, the deed weapon-kill
  count (`DeedSystem.recordCombat` bumps `_kills` only when `targetHPAfter <= 0`), the
  strike loop's gating and the animation all read `targetHPAfter`.
- **[Q1] The exchange ends when a stone breaks.** The rest of that combat's strikes are not
  rolled. Recommended, because it keeps a doubling, brave or Astra attacker from tearing
  through two bars in one exchange, and it keeps the forecast readable: "breaks a bar"
  rather than a second projection. §15.4 proposed letting the combat continue.

Lethal damage that is not combat goes through `UnitHealth.damageUnit`:

- area and line arts (`PostCombatEffects`)
- Deathburst
- the ballista
- the Entity's splash
- terrain

`damageUnit` applies the same rule through one shared function,
`UnitHealth.absorbLethal(unit, hp)`, which `rollStrike` calls too. `setUnitHP` is untouched,
so a debug set or a revive is never absorbed.

### What follows from HP never reaching 0

While stones remain, a boss's HP never reaches 0, so `removeUnit` is never called for it.
Everything keyed to a fall therefore runs only at the last bar, with no extra guards:

- kill gold
- deeds' `recordKill`
- the FOE VANQUISHED band
- `_bossPresence.onBossDefeated`
- the seize objective change
- Vision and boss relief at victory
- the boss recruit
- loot

A broken bar pays the striker ordinary damage XP: `BattleXp` already pays damage-ratio XP
for a combat without a kill. It pays no kill bonus.

### Interactions

| Thing | Rule |
|---|---|
| **Miracle** | Checked first, as now: a Miracle that leaves 1 HP spends no stone. Bosses rarely have it. |
| **Enrage and turn pressure** | Unchanged: a refill never resets them. `isBossEnrageActive` reads the turn, not HP. |
| **The boss's half-HP line** | Still once per boss (`boss_half_<name>`), on the first bar. |
| **The Entity** | **[Q2] Takes no stones.** Its finale is already its second act: `_checkEntity` starts the finale on its first wound, the hum follows its HP ratio and its footprint is bespoke. A refill would raise the hum again, and "first wound" would need redefining. |
| **Sworn Enemy** | Unchanged: its affix and the stones are separate. |
| **Suspend and rewind** | `revivalStones` and `revivalStonesMax` are unit fields. `serializeBattleUnit` is a full spread plus `structuredClone`, so both survive. A test proves it. |
| **The arena** | Mercenaries and arena foes have none. |

### Who has stones

The table is `revivalStones` per rung in `difficulty.json`. It is written into the boss's
spawn at generation (`MapGenerator`, beside `bossLevelBonus`), so a locked map keeps it.
Every rung needs the key.

| Rung | Act bosses I–III | The Emperor (Act IV) | The Lieutenant | Elite captains |
|---|---|---|---|---|
| First Light | 0 | n/a (the run ends at the Lieutenant) | 0 | 0 |
| Dusk | 0 | 1 (Dusk's last boss) | n/a | 0 |
| Nightfall | 1 | 1 | n/a | 0 |
| Black Sun | 1 | 2 | n/a | 1 |

The elite affix `twice_born` from §15.4 is dropped. Affixes never reach a unit with
`isBoss`: elite captains hold the throne and are skipped by `assignRolledAffixes`, so the
only units an affix could stone are rank-and-file foes, which is a different and heavier
change. Elite captains on Black Sun take a stone from the table instead.

### UI (art item 8)

- **Pips:** drawn beside the boss bar (`BossPresenceController`, the reducer
  `ceremonyContent.reduceBossBar` gains `stones`), and beside the unit's map HP bar, as the
  affix pips are drawn.
- **A break:** the bar fills back over about 400 ms with the `sealed` cue's SFX, and the line
  "The stone breaks." That needs a `stoneBroken` beat in the strike animation.
- **Forecast:** `getCombatForecast` gains `defender.stones`. The projection says "Breaks a
  bar" where it would say KO. Both the canvas forecast and the mobile HUD read it.
- **Inspect:** the unit detail overlay reads "Revival Stones: 2".

### Tests

- A lethal strike breaks a stone, and the exchange ends ([Q1]).
- The last bar falls for real, and every fall consequence fires once, only then.
- Area, ballista, terrain and Deathburst damage break a stone too.
- Miracle takes precedence.
- The weapon's kill count is not bumped by a break.
- XP is the damage-ratio award.
- A suspend after a break resumes with the stone spent, and a rewind brings it back.
- `HealthPresentationInvariance` gains a stoned boss: strikes shown, not shown and bars never
  drawn give identical state.
- The harness and the scene give the same result.

---

## 3E. Action skills and Pass

### Great Sacrifice

- **What it does:** a once-per-battle action. The user pays up to 10 HP (never below 1). Each
  ally within 2 tiles heals that amount.
- **Rules:** a new `actionAbility` kind, `sacrifice_heal`, with `perMapLimit: 1`. Its
  settlement follows `settleTransfuse`, which pays HP through `damageUnit` with floor 1, and
  `settleHealingCircle`, which does an area heal through `healUnit`.
- **Wounded:** a Wounded ally heals nothing, as with Transfuse.
- **Usable:** only when the user has more than 1 HP and someone hurt is in range, so the
  ability never wastes the turn.
- **How it is learned:** a scroll.

### Goddess Dance

- **What it does:** a once-per-battle action. Every ally next to the dancer (the four
  neighbouring tiles) that has acted is refreshed.
- **Rules:** a new kind, `refresh_adjacent`. Its targets reuse `findDanceTargets`' rule
  (allies who have acted, who are not dancers themselves). The refresh is the same as
  `MovementActionController.executeDance`: `hasMoved`, `_movementCommitted` and `hasActed`
  are reset. Each refresh is recorded as a deed (`onRefresh`) and earns Dance XP.
- **`_movementSpent`:** not reset. Dance does not reset it today, though the Gambit and
  Galeforce refreshes do. Leave this alone here.
- **Who learns it:** the **Bard**, Dance's promotion, at level 5 (`learnableSkills`). A Dancer
  promoted before Phase 3 gets it through `migrateClassLearnableSkills`. There is no scroll,
  because a refresh-many from any unit is too strong.

### Blink Strike

- **What it does:** a once-per-battle action. The user warps to a free tile next to a seen
  enemy within 4 tiles of where it stands, then attacks that enemy.
- **Where it differs from Blink:** Blink spends the action. Blink Strike is the first action
  that leads into an attack: today every ability ends the action
  (`BattleActionSettlement.settleAndPresent` always calls `finishUnitAction`).

The flow commits once:

1. **Ability → Blink Strike.**
2. **Pick a destination.** The choices are the free tiles adjacent to a seen enemy that the
   equipped weapon reaches from that tile. They are within 4 tiles of the user (Blink's
   diamond, through `getBlinkTiles`' tile rules: in bounds, passable for the move type,
   unoccupied as the player knows it).
3. **Pick the target**, among the enemies that destination reaches.
4. **The ordinary attack forecast,** computed from the destination tile.
5. **Confirm** settles the warp and the combat as one action, with one checkpoint. **Cancel**
   at any step undoes everything; nothing has moved.

- **The kind:** `warp_strike`. The engine's planner (`planWarpStrike`) validates the whole
  pair again at commit, then the scene runs the ordinary combat resolution from the new
  tile.
- **Hidden occupant:** if a unit hidden in fog stands on the destination, the warp fails as
  Blink's does, and the ability is spent. The rule is `seenTileOccupant` at choice time and
  the real board at execution.
- **No Canto afterwards:** it is an attack.
- **How it is learned:** a scroll. It is innate to no class.

### Pass

- **What it does:** a passive. The unit moves through enemy units, but cannot stop on them.
- **Where:** `Grid.computeMovementRange` skips enemy tiles today (the `continue` for a
  different faction). With Pass, an enemy tile is entered and marked `stoppable: false`, the
  rule same-faction tiles already follow. `findPath` mirrors it.
- **Ice:** an occupied tile still ends a slide.
- **Previews:** read the occupants the player knows (`buildOccupiedSet(u, { seenOnly: true })`).
- **Fog:** at execution, a hidden enemy on the path does not stop a Pass unit, because it
  passes through the enemy as it would a seen one. A hidden enemy on the *last* tile backs
  the walk off, as now (`FogAmbush` `blockedAt`).
- **Enemies:** Pass is not in the enemy skill list, so the AI's movement code is untouched.
- **How it is learned:** a scroll. It is also innate to the **Trickster**, beside Darting
  Blow (**[Q3]**). A skill's `classInnate` may name several classes, and a class may have
  several innates. Tricksters already in a save gain it on load through
  `migrateClassInnateSkills`, benched if their slots are full.

### The harness

`HeadlessBattle` runs no action ability today (no Ability, Shove or Trade case), and the sims
never use one. That stays so. These abilities are tested through `AbilityController` against
the mock scene, as `tests/BattleAbilities.test.js` and `tests/SmiteTransfuse.test.js` do,
plus one browser spec each for Blink Strike's flow and Goddess Dance.

### Tests

- **Great Sacrifice:** the HP floor, heals capped at max, Wounded allies, the once-per-battle
  limit.
- **Goddess Dance:** only allies who acted, never another dancer, and refreshed allies can
  act again.
- **Blink Strike:**
  - The destinations and targets read player knowledge: a world pair that differs only by a
    hidden unit gives the same choices.
  - Cancel at each step leaves the state identical.
  - Confirm is one checkpoint.
  - A hidden occupant fails the warp and spends the ability.
  - A bow user sees only destinations its weapon reaches.
- **Pass:**
  - The range includes the tiles past an enemy, never the enemy's own tile.
  - The preview and execution agree on a seen board.
  - A hidden enemy on the path does not stop the walk.
  - The AI's ranges are unchanged.

---

## 3F. Weapon arts

### Lunar Brace (Lance)

- **What it does:** adds 30% of the foe's DEF, floored, as damage. It rewards hitting armour.
- **Rules:** a new combat-mod key, `foeDefShare`. It is added to `normalizeCombatMods` and
  `mergeCombatMods`; both whitelist their keys, so an unlisted key is dropped silently. It is
  applied in `strikeDamage` after `calculateDamage`, reading the defender's effective DEF
  after its mods, and repeated in `artFollowUpStrike` and the forecast.
- **Magic:** ignored on a magic strike. It is a lance art.
- **The numbers:** `hpCost` 3, `perMapLimit` 2, `requiredRank` `Prof`, `unlockAct` act2.

### Override (Lance)

- **What it does:** strikes the target and every foe in the 2 tiles behind it in a line (the
  `lineTiles` shape Skewer uses), then pushes each foe hit 1 tile away from the attacker.
- **What is new:** today only the primary target is moved (`tier2_move`'s side is the
  opposing side, and `resolvePostCombatMove` moves one unit). Doom Thrust's push is the
  primary's alone.
- **The rule:** a new afterCombat move mode, `pushAreaVictims`. The farthest victim is pushed
  first, so a near victim never blocks on a far one that is about to move. Each push goes
  through `ForcedMovement.traceForcedMove`, so Ice slides apply. A push that cannot move
  leaves the unit in place.
- **Boundaries:** bosses, the Entity, Anchored and rooted units are not pushed, as with Smite.
- **The numbers:** line damage ×0.6 per landed strike, as Skewer. `hpCost` 5,
  `perMapLimit` 1, `requiredRank` `Mast`, `unlockAct` act3, `noFollowUp`.

### Tests

- Lunar Brace's damage is derived by hand against a DEF 20 Knight. A magic strike is
  unchanged.
- The forecast equals the resolved damage.
- Override:
  - pushes the farthest victim first;
  - leaves units it cannot push in place (a wall, a boss, Anchored);
  - slides a victim pushed onto Ice;
  - never moves the primary twice.

---

## 3G. Steal, and enemies that carry items

**Today.** An enemy carries weapons only. `createEnemyUnit` sets `consumables: []`, and the
spare weapons Nightfall gives (`grantSecondaryWeapons`) are the only spares. Nothing drops
when an enemy dies, and the AI never uses an item. No Steal skill exists, and no code reads
the Thief class.

### Carried items

- **The table:** `carryConfig` in `difficulty.json`, per rung: `{ perBattle: true, act1..act4,
  finalBoss, maxPerBattle }`.
- **The roll:** `engine/EnemyCarry.js`, at generation, on its own stream. It follows
  `CasterGear` exactly (a hash of act, rung, template and spawns → mulberry32, never
  `Math.random`), so the node-map and battle streams are unchanged.
- **On the spawn:** the roll writes `spawn.carries: "<item name>"`. A locked map keeps it
  across leave and return, resume and rewind.
- **Who carries:** the boss and elite captains never carry. Nor do Skeletons (3I) or units
  with `_noXP`.
- **On the unit:** `EnemySpawnGear` turns the flag into `unit.carriedItem`, a whole item made
  from `run.getConsumableTemplate` or the weapon catalog. It is kept apart from
  `inventory` and `consumables`, so the AI never uses it and combat never reads it.
- **Saves:** `serializeBattleUnit` keeps it.
- **The pool:** `carryPool` per act in `lootTables.json`, weighted:
  - Vulnerary
  - an Elixir from Act III
  - a stat booster at low weight from Act II
  - a Master Seal at low weight in Act IV
  - a **Gold Pouch** (a new consumable worth 300 / 500 / 800 G by act, sold or used for gold;
    `consumables.json`)

Carry rates (a proposal, tuned by sim):

| Rung | Act I | Act II | Act III | Act IV | Max per battle |
|---|---|---|---|---|---|
| First Light | 0 | 0.15 | 0.2 | 0.25 | 1 |
| Dusk | 0.1 | 0.25 | 0.3 | 0.35 | 1 |
| Nightfall | 0.2 | 0.35 | 0.45 | 0.5 | 2 |
| Black Sun | 0.3 | 0.45 | 0.55 | 0.6 | 3 |

**[Q4] A carrier killed before its item is stolen loses the item.** Recommended, because it
keeps Steal the only way to an item and the economy predictable. The alternative is to drop
it into the victory loot, which makes the carried items a plain loot increase on higher
rungs.

**How a carrier shows:**

- A small sack pip beside the affix pips on the sprite, shown only while the unit is
  visible.
- "Carrying: Vulnerary" in the unit detail Gear tab. Use the `statusStaff` row as the
  template, in `UI_PALETTE.good`.
- The same line in the mobile HUD's inspect panel and the inspection tooltip.

### Steal

- **What it does:** an action. It takes the adjacent enemy's carried item. It never takes an
  equipped weapon or any other item.
- **Usable:** only when the user's attack speed is at least the target's
  (`Combat.calculateEffectiveSpeed`, the FE rule). Otherwise the row reads "Too slow".
- **Rules:** a new targeted kind, `steal_item`. The target finder scans the four
  neighbouring tiles through `unitCovering`, as Smite and Transfuse do. The targeting UI is
  `AbilityTargetingController`: a branch each in `find`, `begin` and `execute`.
- **Where the item goes:** to the user's bag if there is room, else to the convoy if there is
  room, else Steal is refused ("Bag and convoy full"). The convoy route follows the village
  visit's: a uid is assigned first, so a rewind removes it with `removeFromConvoyByUid`.
- **Saves:** a stolen item in the bag rolls back with the unit's state on rewind. Victory
  carries the bag into the roster, as for any item.
- **Limits:** no per-map limit, but one Steal per target, since there is one item.
- **Fog:** reads player knowledge. A carrier seen through fog shows its pip only while seen.
- **Who learns it:**
  - **Innate to the Thief** (its innate list is empty today), so an Act II Thief recruit can
    steal.
  - Kept on promotion to Assassin or Trickster: `promoteUnit` only adds the new class's
    innates and never removes a skill.
  - Anyone else, through a Steal scroll (Act II+ loot and shops).
- **Enemy Thieves** never steal from the player in Phase 3. That needs AI work, and the owner
  asked for few systems.

### Tests

- The carry roll leaves `Math.random` untouched (cursor equality).
- The same seed and template give the same carriers.
- Rates match the table over seeds.
- Bosses never carry.
- Steal's eligibility reads attack speed (equal speed allowed, one slower refused).
- The bag → convoy → refused order holds.
- A rewind returns the item to the carrier and removes it from the convoy.
- A resume keeps it.
- A dead carrier's item is gone ([Q4]).
- The pip never shows for a carrier in fog.

---

## 3H. Accessories that roll a bound skill (rare)

Owner, 2026-10-07: no new ring family. **The existing accessories can roll a skill, and it is
quite rare.** This replaces the Bond Ring plan (a new C/B/A/S family), which is dropped.

**What happens.** When a non-legendary accessory instance is created, it rolls once. With a
small chance by act, it carries a bound skill. That covers:

- loot, including boss rewards from Act II on;
- shop stock;
- an event accessory grant.

**The skill:**

- is effective while the accessory is equipped (3A, `_boundSkill`);
- does not count toward `MAX_SKILLS`;
- leaves with the accessory;
- is never "known", so it cannot be benched or taught from the item.

**What never rolls:** legendary accessories, starting kits, and accessories granted by meta
upgrades or blessings.

**Data:** `accessorySkills` in `lootTables.json`, with `chanceByAct` and `poolByAct`.

Chance by act (a proposal, tuned by sim):

| Act I | Act II | Act III | Act IV |
|---|---|---|---|
| 3% | 5% | 6% | 8% |

Pools by act:

- **Acts I–II:** Uncanny Blow, Warding Blow, Armored Blow, Darting Blow, Death Blow,
  Pathfinder, Vantage, Wrath, Defiant, Guard, Skirmisher, Foresight, Canto.
- **Act III:** the Act II pool's stronger half, plus Luna, Sol, Lifetaker, Speedtaker,
  Pavise, Aegis and Renewal.
- **Act IV:** that tier, plus Astra, Aether, Miracle, Pass and Blink.

**Never bound:**

- personal skills;
- class innates whose lock rules matter (Dance, Shove, Pull, any `classInnate`);
- enemy-only skills;
- Steal and Goddess Dance;
- Lethality.

**The roll's stream.** It never shifts another draw. For a fixed seed, every loot, shop and
event result is the same as before, apart from the bound skill.

**Price.** An accessory with a bound skill costs and sells for 50% more.

**Display.** The identity name never changes; the display reads "Power Ring · Vantage".
Loot, shop and roster text name the skill and its description. A unit that already knows
the skill reads "Already known". The per-battle limit belongs to the user (see Shared
boundaries).

---

## 3I. The Necromancer and Skeletons

### The classes

The **Necromancer** is a new promoted caster class, enemy only:

- **Weapons:** `Tomes (M)`. There is no Dark weapon type, and adding one is out of scope.
- **AI:** it holds back. See Raising.
- **Dark class:** it joins `DARK_CLASSES` (constants), so Endword's "Effective vs dark"
  reaches it.
- **Its weapon:** a new Steel-tier tome, **Gravesong**, enemy only. It never enters loot.

The **Skeleton** is a new base class, enemy only:

- low growth;
- Infantry movement;
- `Swords (P), Lances (P), Bows (P)` (ranks are only P and M);
- a plain Iron weapon, chosen on the raise's keyed stream.

**Enemy only, in every list.** Both classes join `ENEMY_ONLY_CLASS_NAMES` and
`RECLASS_TARGET_EXCLUDED_CLASSES`. That one set is read by reclass seals, event joins,
`EventSystem` and `EventValidation`. They also join `DIFFICULTY_GATED_CLASSES`. A test checks
each list. This also fixes a stale comment in the trace roster (`roster.mjs`): it says reclass
seals can turn a recruit into an enemy-only class, but `UnitManager` forbids it.

**Where the Necromancer appears.**

- It is in the Act IV `promoted` pool on Dusk and above.
- It is in the Act III pool on Black Sun only, through `enemyClassEarliestAct`
  (`{ "Necromancer": "act4" }` on Dusk and Nightfall; Black Sun lists Act III).
- First Light never sees it: `DIFFICULTY_GATED_CLASSES`.
- **At most one per battle.** `MapGenerator` replaces any further Necromancer pick with the
  pool's next class, with no extra draw: the pick is mapped, not re-rolled. This keeps the
  node and battle streams stable.

### Raising

**The rule.** It is an enemy-phase-start step, placed right after `processZombieRevival`, in
both the scene's `enemy_phase_turn_start_pipeline` and the harness's `_processEnemyPhase`.
The Zombie rise is the working template: no RNG, placement through `ZombieRemains.riseTile`,
then `enemyUnits.push`, `addUnitGraphic`, `updateEnemyVisibility`,
`observeHistoryAction('revived')`, and a banner only when the tile is visible.

**What it does:**

- For each living Necromancer with fewer than 2 living Skeletons of its own, raise one,
  until it has raised **6 in this battle** (a lifetime count on the Necromancer, kept across
  suspend and rewind; see Shared boundaries).
- It goes onto the first free passable tile among the Necromancer's four neighbours, in the
  order `riseTile` uses. If there is none, nothing is raised.
- The Skeleton is created with `hasActed: false`, so it acts in that phase.
  `AIController.processEnemyPhase` copies the unit list after the pipeline.
- The Necromancer's own turn is not spent. Raising is part of the phase's start, which is
  simpler than the "first beat" in §15.4 and reads the same to the player.

**Building the Skeleton.**

- **Engine:** `engine/Necromancy.js`, pure, shared by the scene and the harness.
- **Level:** the Necromancer's level − 4, minimum 1.
- **Stream:** its own keyed stream, `keyedBattleRandom(battleSeed,
  'raise:<necro battleEntityId>:<turn>:<n>')`, used for the weapon pick and the level-ups.
  It does **not** use `createEnemyUnit` on the battle's `Math.random`, as reinforcements do,
  so a raise never shifts the battle stream. A resume before the raise replays it
  identically.
- **Links:** it records `_raisedBy: <necro battleEntityId>`. `battleEntityId` survives saves
  and rewind.

**The rewards rule.**

- A Skeleton pays no gold.
- It gives a quarter of the XP.
- It counts for no kill deed.
- It is never recruitable.
- It carries nothing.

All of this goes through one predicate, `isRaisedUnit(unit)`:

- `ReinforcementSpawns.enemyRewardMultiplier` reads it (gold 0).
- `enemyXpMultiplier` reads it (0.25).
- `isZeroRewardUnit` reads it, so deeds skip the kill.

The harness's `_applyKillRewards` lacks the `_noXP` check the scene has, so risen Zombies
pay gold in sims today. That parity bug is fixed in this step, with a test.

**Crumbling.** When a Necromancer falls, its Skeletons crumble.

- **Where:** the enemy branch of `removeUnit` in the scene and `_removeUnit` in the harness,
  through `Necromancy.crumbleFor(necro, enemyUnits)`.
- **What a crumble is:** a removal with no killer, so no gold and no XP. It happens before
  `checkBattleEnd`, so a rout completes when the last living foe was the Necromancer.
- **Rout rule:** unchanged (`RoutObjective`). Skeletons are ordinary enemies until they
  crumble.

**The Necromancer's AI.** It uses the existing `guard` mode: it returns to its post when the
nearest foe is more than 3 tiles away. No new profile is needed. The player's answer is to
dive for it.

**Fog.** Every arrival and crumble reads what the player knows:

- a Skeleton raised in fog is not marked;
- the banner is shown only if the tile is visible;
- the arrival count is not leaked. `ReinforcementPresenter` already skips fogged arrivals,
  and raises do not use it.

**Saves.** Skeletons are ordinary enemy units, so `serializeBattleUnit` keeps `_raisedBy`. A
rewind rebuilds them, and `registerBattleEntity` keeps the links.

### Art (event-art items 6–7; first, because the tests gate on it)

- **Map sprites:** generated references, then the trace, then the bake, as in
  `docs/specs/traced-sprites.md`.
  - The class sheet comes from `tools/art/sprite-trace/gen-class-sheet.mjs`.
  - The `ENEMY_ONLY_CLASSES` entries go in `roster.mjs`.
  - The three keys each enemy-only class bakes (`<cls>`, `enemy_<cls>`, `enemy_<cls>-corrupt`)
    are what `tests/TracedSprites.test.js` requires.
  - Poses: idle, windup, strike, dodge, death. Red palette. A Skeleton's sheet reads as bone,
    not a recoloured Zombie.
- **Portraits:** PC-98 portraits, `enemy_necromancer` and `enemy_skeleton`, in the unlight
  faction. They follow the legacy route of `Pc98PortraitManifest.json`.
  `tests/PortraitVariants.test.js` asks for 4 faces per listed enemy class, so either list
  both classes with 4 faces or exclude Skeletons with a reason.
- **Raise and crumble fx:** procedural, in `src/art/combatFx`: a rising ember column, then a
  fall into dust.
- **In the same batch:** the **caravan Merchant portrait** the owner asked for
  (`generic_merchant`; `CaravanSystem.createCaravanUnit` sets none today), then the scroll
  icons (item 5) and the proc visuals (item 9).

### Tests

- A raise happens only below 2 Skeletons, onto `riseTile`'s tile, or not at all.
- A raise leaves `Math.random`'s cursor where it was.
- Skeletons crumble with their own Necromancer only, when two Necromancers are on the map
  (constructed; generation never makes two).
- Rewards follow the rule, through both the scene and the harness.
- The harness parity fix pays a risen Zombie no gold.
- Rout completes on the Necromancer's fall.
- A suspend after a raise resumes with it, and a rewind undoes it.
- Previews are identical in a world pair that differs only by a fogged Skeleton.
- Generation never makes two Necromancers in a battle.
- The class gates hold by rung and act.
- Neither class appears in any recruit, reclass or event-join list.

---

## Sims

### The plan

`npm run sim:fullrun` covers every step that changes balance:

- **3B, 3C:** new skills and Marks on player units only.
- **3D:** stones. They lengthen boss fights, so watch the boss-turn and loss rates on
  Nightfall and Black Sun.
- **3G:** carried Gold Pouches feed the economy. Measure them against
  `progression_invincible --max-avg-gold`.
- **3I:** Act IV loss rates on Dusk+.

A threshold change follows the threshold-note rule (`check:threshold-pr-notes`), with
triage attribution. Skeleton XP is checked by a dedicated sim slice: a Necromancer battle
fought to the last turn must not pay more XP than the same battle without one.

### What the evidence is, by level

Two different kinds of sim run, and they prove different things:

- **The PR gate slices** (`npm run sim:fullrun:pr`, `tests/sim/RunSimulationDriver.js`)
  play whole runs through `HeadlessBattle`, so every Phase 3 rule the harness shares with
  the scene acts there: Marks on rolled recruits, on-kill skills a unit carries, Revival
  Stones on bosses, carried items, Necromancers and their raises. The gate proves these runs
  still finish inside their thresholds. It is a **stability** check, not a balance
  measurement: the driver's party rarely carries the new skills, never steals, and several
  slices are invincible.
- **The legacy standalone sims** (`npm run sim:fullrun` = `sim/fullrun.js`, `sim:progression`,
  `sim:matchups`) resolve combat with their own contexts. Marks do not act there, and they
  say nothing about Phase 3.
- **Dedicated slices** answer one question each: `sim:carry` (the Gold Pouch upper bound,
  if every carrier is robbed) and the Necromancer XP slice (`tests/sim/NecromancerXp.test.js`).

What we do **not** have yet: a measurement of ordinary-party survival against stoned
bosses. The one stone figure below (`ambush_hard_invincible`: average turns 804 → 979, still
100% wins) is an invincible run: it shows boss fights got longer, not that a mortal party
survives them at the old rate. Playtests on Nightfall and Black Sun are the evidence for
that, and a mortal Nightfall slice is the next sim to add if they disagree.

## Decisions for the owner

Every step was built on the recommendation below; the owner may still revisit any of them.
Two questions came up while building and are open: see "Open after the build".

| | Question | Recommendation |
|---|---|---|
| **Q1** | When a Revival Stone breaks, does the exchange end, or do the remaining strikes hit the new bar? | **End the exchange.** One bar per exchange, a readable forecast, no brave or Astra shred. |
| **Q2** | Does the Entity take stones on Black Sun? | **No.** Its finale is its second bar. The Emperor takes 2 on Black Sun instead. |
| **Q3** | Is Pass innate to the Trickster (beside Darting Blow), or scroll only? | **Trickster innate.** It gives the class an identity. A scroll covers everyone else. |
| **Q4** | Is a carried item lost when its carrier is killed, or dropped into the victory loot? | **Lost.** Steal stays meaningful and the economy stays predictable. |
| **Q5** | Study the Boss (§14: the unit that lands an act boss's killing blow may learn one of its skills, or take gold): build it in Phase 3, or not? | **Not now.** Phase 3 already adds several ways to learn: new scrolls, wider event teachers, accessories that roll a skill, and Marks. Bosses carry few skills worth teaching (the enemy list is six). |
| **Q6** | Mark of the Hunt reads "+5 damage" (the same as +5 Mt before DEF). Keep the "+5 Mt" wording, or say "+5 damage"? | **"+5 damage"**: it is what happens, and there is no Mt key to hang the other on. |

## Not in Phase 3

- **Weapon-art awakening:** on hold (owner, §15.1).
- **Skipped:** Breaks, adjutants, chains (§15).
- **Enemies using new skills, carried items or Steal:** later; needs AI and sim work.
- **Skill ranks from use, bonds:** later (§14).
- **A player-side Invoke** (calling a throwaway phantom): later, maybe (§15.3).
- **Other actives from §14:** Hook, Leap, Reposition, Mark Target, Flare, Charge!,
  Barricade, Taunt, Second Wind, Thaw/Quench. They wait until Phase 3's three actives have
  been played.

## Phase 2 review edits

Owner review of #218 and #219 (2026-10-07). #219's HUD stays.

| Finding | Fix | PR |
|---|---|---|
| P2: a contract reward could be lost without the player choosing to. It happened two ways: a "No room" note closed the contract, and a failed delivery could not restore the obligation, because `run.contract` was cleared before the snapshot. | Judge once and persist the verdict and its terms (`run.contractOwed`). Deliver with a strict plan under the same seed key, so the payout is deterministic. An owed reward holds the party, with a page offering Claim, Roster and a confirmed Give up. A penalty is retried and never holds the party. | #230 |
| P3: "Wounded" named two mechanics. | The burden is shown as **Lingering Injury**. Its id stays `wounded`, and the status condition keeps its name. | #227 |

## As built (2026-10-07)

Each step's PR body has the full account. This section records where a step departed from
the plan above, and why.

- **3A** (#221). One deliberate difference: `getWeaponRangeBonus(unit, weapon)` counts the
  grant of the weapon whose range is asked, not the equipped weapon's. Range asks about a
  weapon the unit may not be holding yet.
- **3B** (#223).
  - The on-kill step runs last in the post-combat pipeline, after every area step, not just
    after `art_kill_buff`. That way a blast's victims have left their `areaCredits` before
    the step reads them.
  - No deed gained an Oath. An Oath skill is one nothing else teaches.
- **3C** (#225).
  - **The roll:** a bearer gets one of the five Marks, uniformly. The roll uses its own
    stream, keyed by run seed and name.
  - **Hunt** adds +5 only to a strike that already deals damage.
  - **Silence** does not stop Marks, because they are not skills.
  - **Road** rolls on turn 1 too.
  - **Where Marks act:** they do not act in arena bouts or in the legacy standalone sims.
- **3D** (#229). Built on Q1 and Q2.
  - A broken bar pays damage XP for the HP it held (`BattleXp.combatHpLost`).
  - A multi-blow area art stops striking a unit once one of its stones breaks.
  - After-combat poison skips a bar that just broke.
  - The gems share the affix pip row.
  - Terrain floors at 1 HP, so it never reaches a stone.
  - Sim: Nightfall `ambush_hard_invincible` average turns rose from 804 to 979, still a
    100% win rate. That is an invincible slice: evidence that fights got longer, not of
    survival balance (see "What the evidence is, by level").
- **3E** (#232). Pass is innate to the Trickster (Q3).
  - **Blink Strike:**
    - It offers destinations within the equipped weapon's reach of a seen foe, so a bow
      user is offered tiles two away.
    - It is a plain attack only: no art.
    - Its warp is settled inside the attack's intent checkpoint.
    - A hidden unit on the destination spends the use and ends the action.
  - **Great Sacrifice** pays `min(10, HP − 1, the most any hurt ally in range is missing)`.
  - **Enemy Tricksters** are stripped of Pass, because the AI never reads it.
- **3F** (#224).
  - Override pushes only when its user stands next to the target. It is a player-only
    Silver art that needs Master rank.
  - Lunar Brace has a scroll, because every Steel art needs one.
  - Lunar Brace's share does not apply on a counterattack.
- **3G** (#231). Built on Q4.
  - The final boss uses Act IV's carry rate.
  - The Gold Pouch is worth 300, 300, 500 and 800 G in Acts I to IV, and 800 G at the
    final boss.
  - The carry-pool weights are new.
  - A carried item's uid is a hash of the battle seed, tile and name.
  - **Upper bound on Gold Pouch income** per run, if every carrier is robbed
    (`npm run sim:carry`):

    | Rung | Gold Pouch income |
    |---|---|
    | First Light | 478 G |
    | Dusk | 1,008 G |
    | Nightfall | 2,410 G |
    | Black Sun | 3,753 G |
- **3H** (#226). Owner redesign: no Bond Ring family; existing accessories can roll a skill,
  rarely.
  - Legendary accessories are now marked in the data.
  - Ten class or personal skills in the pools are lent on purpose (`lentInnates`).
  - The roll uses a keyed stream, so loot, shop and event results are unchanged apart from
    the skill and its price.
- **3I** (#228).
  - Raises are capped at 6 per Necromancer per battle.
  - A Skeleton's level is the Necromancer's XP-effective level − 4.
  - The Necromancer `promotesFrom` Mage, but no player can promote into it.
  - A class field `enemyWeapon` gives it Gravesong.
  - A Skeleton pays no survival XP.
  - The Necromancer keeps its guard post on maps with hold packs.

### Review fixes after the build

An outside review of main at 29f27033 (2026-10-07) found no P0/P1 and two P2 interaction
bugs. Both were missed for the same reason: each mechanic was tested alone (Wounded with
on-kill, Pass with Ice, Pass with fog) and the failures sit at the intersections. Each fix
lands with a small interaction matrix rather than more isolated tests.

| Finding | Fix | PR |
|---|---|---|
| P2: Lifetaker and Speedtaker fired while their unit was Silenced (learned or lent). Every other skill trigger respects Silence. | `PostCombatEffects.skillOnKill` reads Silence at application and fires no skill; Mark of the Ember still fires (a Mark is not a skill), and stacks already earned stay. Tests: learned and lent skills under Silence, Ember under Silence, stacks kept; plus bar breaks against kills (a refilled bar fires nothing, the last bar does, directly and by a blast). | (pending) |
| P2: a Pass unit slid through a hidden unit on Ice. The fog cut let Pass ignore a hidden unit on every intermediate tile, slid ones included, so the slide the seen-only plan drew was kept on the real board. | Execution enforces both Ice rules against the real board for a Pass unit: a hidden occupant inside a slide interrupts it, and one on the Ice entry tile is met as a seen one would be; previews stay seen-only. Tests: Pass × fog × Ice, with the hidden unit inside the slide and on its entry tile, and the non-Pass equivalents pinned. | (pending) |

### Open after the build

- **No way to discard an item.** An owed contract reward that is a weapon can't be claimed
  when every bag and the convoy are full of weapons: a held party can't reach a shop to sell
  one, so only Give up is left. **Approved by the owner:** a confirmed **Discard** in the
  roster (bag and convoy items, between battles; a lord's personal weapon and the prologue
  run are blocked). In progress on `claude/roster-discard`.
- **The Gold Pouch economy on Nightfall and Black Sun.** The upper bounds above are high;
  real income is far lower, because a Thief must reach the carrier and outpace it.
  **Accepted by the owner as is:** no change to `carryConfig` or `carryPool`.
