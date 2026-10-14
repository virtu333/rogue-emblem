# Epic weapons

Status: owner-approved concepts, 2026-10-14 (the "unique weapons" thread). Built in two PRs (#410 and the second batch).

Between a plain Silver Sword and a relic there was nothing with a personality, and nothing
named before Act III. **Epic** is a new weapon tier: one of a kind, a proper name, one rule of
its own (usually with a catch), at Steel or Silver strength. The brainstorm and the owner's
notes are in the project's `reviews/unique-weapons-brainstorm.md`.

## 0. Decisions (owner, 2026-10-14)

1. Boss trophies go into the **loot pools**, not the act boss's reward screen.
2. A trophy enters the pools only once its boss has been beaten **ever on this save**
   (`storyFlags.bossSlain`). Wyverns count as dragons.
3. Proof of the Halls: Vantage, but only at full HP (no "never doubles").
4. Tallyblade starts weak and grows without a cap: every 4 kills, +1 Mt, +5 Crit or +5 Hit.
5. Haulhook is heavy (weight 13). Gorgemaw costs 15% max HP. Mirrorglass hits with at least 5 Might.
6. Cut: Gravedigger's Spade, Kindling. New relic sword (Daybreak, below).

Defaults picked while building (not owner calls; change freely):

- A trophy can drop from its boss's **own act on** (the Warchief's from Act I), so every
  trophy can turn up on every rung. "The act after" would keep Act III trophies off First
  Light for good and the Emperor's off every road.
- Epic weapons are **never sold** in shops and never handed out by events, gifts or start
  blessings; they can be sold for gold like any weapon.
- No new icons yet: each borrows an existing cell (`WEAPON_ICON_REUSE`); the atlas is at its
  360-cell budget. New art is a follow-up.
- "Last Ember" was already a trait, so that bow is **Cinderstring**. Rook's Bow reads "the
  wielder hasn't moved this turn" (Hold the Line's rule): "the foe hasn't moved" is true of
  every foe on the player phase. Thornwood Bow's forest bonus is Hit and Might (a range change
  would touch every reach preview). Unrelieved Line's catch is −2 Mt after moving (a Move
  penalty from a weapon has no clean place to live; MOV is written in place).
- Second batch: Second Push moves 2 tiles after a fight even with no movement left. Frightened
  Acclaim locks once it is the held weapon (a unit may still take it up from its bag). Futuresold's
  upkeep counts every copy the army carries, convoy included, and never takes gold below 0.
  Hollowsong costs its shadow only for a battle it struck in (carrying it is free). Gorgemaw takes
  nothing on turn 1. Wakelight's mark lasts the phase it was made in (a contact, cleared as the
  enemy phase starts; one made on the enemy phase lasts into the player phase). Holder of the
  Breach's slow is a timed buff, so a foe's own stronger MOV buff wins over it.

## 1. The tier

- `tier: "Epic"` (schema enum). The card's base line is "Epic Sword" (`ItemKeywords.itemBaseLine`).
- Every tier list leaves Epic out on purpose, so nothing picks one up by tier: enemy, recruit,
  mercenary and secondary gear (`getWeaponByTier`), Lucky Finds' tier climb
  (`LOOT_WEAPON_TIER_UPGRADE_ORDER`), innate arts (`META_INNATE_TIERS`), events
  (`EVENT_WEAPON_TIERS`), start gifts (`GIFT_WEAPON_TIERS`), Arsenal Pact.
- Forge cost multiplier 1.5 (Silver's).
- Epic weapons are listed in a loot table's `epicWeapons` (never `weapons`, which shops read).

## 2. Rules (`rules` on the weapon; `engine/EpicWeapons.js`, pure)

`special` stays the sentence the card shows; the engine reads only `rules`, so no text can
trip an old `special` regex. Every rule is validated (`validateWeaponRules`, `npm run
validate:data`): an unknown kind, condition or key is refused.

| Kind | Fields | Where it acts |
|---|---|---|
| `mods` | `mods` (combat mods), `when` (conditions, all must hold), `per` + `cap` | `SkillSystem.getSkillCombatMods`, beside the Hermit's Bow bonus |
| `mirrorMight` | `min` | `getSkillCombatMods`: Might = the foe's weapon Might, at least `min` |
| `afterCombat` | `effect` (`push`, `pull`, `status`, `selfDamage`, `selfHeal`), `onlyWhen` | `WeaponArtPostCombat.getPostCombatPipelineSteps` |
| `killGold` | `gold` | `LootSystem.calculateKillReward` (scene and harness) |
| `effective` | `classNames`, `multiplier` | `Combat.getEffectivenessMultiplier` |

Conditions (`when`): `initiating`, `defending`, `foeFullHp`, `fullHp`, `below50`,
`holdingGround` (`isHoldingGround`, needs the battle's turn in the combat context), `moved`,
`onForest`, `foeWields` (with `weaponTypes`). `per`: `adjacentAlly`.

The second batch adds:

| Kind | Fields | Where it acts |
|---|---|---|
| `canto` | `tiles` | `CantoRule.cantoAllowance`: after a fight, that many tiles whatever movement is left (a root still stops it); `cantoRuleFor` reads it as `any` |
| `vision` | `bonus` | `Grid.unitVisionRange` (scene and harness grids alike) |
| `lockedInHand` | — | `WeaponSwapLock.weaponSwapLocked`, only while the unit carries the battle's mark (`_inBattle`, stamped by `TradeBoons.stampArmyBattleRules`, dropped by `serializeUnit`), so the roster never sees it |
| `slowAdjacentFoes` | `mov` (< 0) | `SkillSystem.getTurnStartEffects`' `foes`: each foe beside a wielder as its phase starts takes a timed MOV buff until the wielder's side's next phase |
| `turnStartToll` | `percent` | `getTurnStartEffects`: the wielder's own phase start from turn 2, unless it killed in the turn before (`_epicFedTurn`); never below 1 HP |
| `grows` | `every`, `gains` | `PostCombatEffects` `epic_combat_record`: kills counted on the instance (`_tally`), a gain every `every`th kill keyed by uid and kill number |
| `battleShadow` | `shadow` | the same step stamps the weapon used (`_epicBattleUsed`) when its side struck; `RunManager.completeBattle` adds the shadow and clears the stamp |
| `victoryUpkeep` | `gold` | `completeBattle`, after the gold: paid for each carried (roster bags and convoy), never below 0 gold |

A `mods` rule's `per` may also be `battleKill` (`_epicBattleKills`, the same step's count).
`afterCombat`'s `reveal` effect (Wakelight) shows the foe hit for the rest of the phase
(`Grid.revealContact`, through the post-combat world's `revealContact`). The victory band reads
`run.lastEpicVictory.lines` ("Hollowsong +1 shadow", "Futuresold −200 G").

## 3. The weapons

### Boss trophies (`trophyOf`: the boss's name as `bossSlain` keys it)

| Weapon | Boss | Type | Rule | Catch |
|---|---|---|---|---|
| Treatybreaker | Warchief | Axe | +5 Atk against a foe at full HP | −15 Hit when defending |
| Unrelieved Line | Iron Captain | Lance | +4 DEF/RES when attacked having held its ground | −2 Atk after moving |
| Second Push | Knight Commander | Lance | Moves 2 tiles after a fight (Canto) | −10 Avoid |
| The Middle Pages | Archmage | Tome | Range 1–3 | 6 casts per battle |
| Sealed Orders | Dark Rider | Tome | A hit Silences the foe for a phase | 3 HP after each combat it starts |
| Proof of the Halls | Blade Lord | Sword | Vantage at full HP | — |
| Holder of the Breach | Iron Wall | Axe | Adjacent foes −2 Move on their phase | Weight 15 |
| Frightened Acclaim | Berserker King | Axe | +3 Atk per kill this battle, up to +9 | Locked in hand for the battle |
| Futuresold | The Emperor | Sword | +2 Atk/DEF/RES/AS, +5 Hit/Avoid | 200 gold each victory while carried |

### Finds (`epicWeapons` in the act tables)

| Weapon | Type | Rule | Catch | Acts |
|---|---|---|---|---|
| Prodding Spear | Lance | Pushes the foe 1 tile after a hit it starts | — | I–II |
| Parrying Blade | Sword | +15 Avoid against swords and lances | — | I–II |
| Rook's Bow | Bow | +15 Hit, +5 Atk when the wielder hasn't moved | — | I–II |
| Pilgrim's Lamp | Light | Heals the wielder 3 after a combat it hit in | — | I–II |
| Tollkeeper's Knife | Sword | +150 gold per kill | Low Might | I–III |
| Thornwood Bow | Bow | From a forest: +15 Hit, +3 Atk | — | I–III |
| Haulhook | Axe 1–2 | Pulls the foe 1 tile closer after a hit it starts | Weight 13, low Hit | II–IV |
| Phalanx Pike | Lance | +1 Atk, +2 DEF per adjacent ally (up to 2) | — | II–IV |
| Mirrorglass | Tome | Strikes with the foe's weapon Might (at least 5) | — | II–IV |
| Cinderstring | Bow | +30 Crit below half HP | −10 Avoid | III–IV |
| Tallyblade | Sword | Every 4 kills: +1 Mt, +5 Crit or +5 Hit, uncapped | Starts Iron-weak | II–IV |
| Gorgemaw | Axe | 15 Mt | −15% max HP each turn start after a turn without a kill | III–IV |
| Hollowsong | Tome | Conflagration + 3 | +1 Eclipse shadow per battle it struck in | III–IV |
| Wakelight | Light | +2 fog vision; a foe it hits stays shown for the phase | Low Might | II–IV |

### Daybreak (relic sword, Act III+ `legendaryWeapon`)

13 Mt, 90 Hit, 10 Crit, weight 6, range 1. ×3 against dragons (Wyvern Rider, Wyvern Lord,
Dragon, Dragon Lord) and the undead (Zombie, Revenant, Skeleton); ×2 against the Entity.
Art **Dawnwave** (`legend_dawnwave`): the blade's light strikes from 2 tiles, and the wave
catches the two tiles beside the target on that ring (`arc`, Fan Shot's shape).

## 4. Trophies in the loot draw

`PendingBattleRewards.rewardDrawParams` freezes the save's unlocked trophies for the run's act
into the reward's saved `draw` (`epicTrophies`, only when non-empty), so a reroll and a reload
draw from the same pool; `generateLootChoices` appends `epicWeapons` and those names to the
weapon category's pool, where the roster filter and the de-dupe apply as to any weapon. The
unlocked list comes from the live meta (`ctx.bossSlain`), never the run's meta snapshot, so a
boss beaten this run counts from the next reward on.
