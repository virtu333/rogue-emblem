# Weapon uses per battle (durability)

Owner: Dave. Proposal and review: `/mnt/project-files/reviews/weapon-durability.md` (project files), agreed 2026-10-17 with these changes: 10 uses is the floor, counters spend a use, Smith's Oil refills a weapon completely, the Smith's Bracer stops its wearer's weapons spending uses.

## Rules (PR 1, as built)

- Every combat weapon a **player** unit holds has uses each battle by tier (`data/weaponUses.json` `byTier`: Iron 20, Steel 15, Silver 10, Rare 10, Legend 12, Epic 12). `enabled: false` turns the rule off everywhere.
- One use is one resolved combat in which the weapon struck: attacking or countering, hit or miss; a double (or a brave weapon's second blow) is still one use. A side that never struck spends nothing. A chosen-center area cast spends one.
- A spent weapon cannot attack (`AttackOptions.canAttackWithWeapon`) or counter (`Combat.canCounter`). Once the combat's deaths are settled the unit equips its next usable weapon (`PerBattleWeapons.swapSpentWeapons`, a banner says so); with none it keeps the spent one and a banner says it is spent for this battle (once).
- Everything refills at the victory commit (`RunManager.completeBattle`: roster, the fallen and the convoy) and at deploy (`resetUnitForBattle`), through `WeaponUses.refillBattleUses`.
- A weapon lock (Oathbound Steel's twist, Frightened Acclaim's own rule) lifts once the held weapon is spent for the battle (`WeaponSwapLock.weaponSwapLocked` reads `WeaponUses.isSpentForBattle`), so the unit takes up a spare as any unit does and Oathbound Steel then holds it to that one: a lock never leaves a unit unable to fight (Dave, 2026-10-17).
- Enemies, NPC allies and arena bouts never spend uses. Staves keep their own per-battle uses (MAG bonuses). A weapon whose catalog row says `perBattleUses` (Breachbolt, The Middle Pages) keeps its own counts for every faction.

## Save format

Nothing new is saved: a weapon holds only `_usesSpent` (already saved for Breachbolt and staves), and its count is read from the tier table (`WeaponUses.durabilityMaxUses`). So old saves need no migration, the run-format guard needs no capability (cloud sync of runs is unchanged), and an older client plays the same save with unlimited uses (it ignores `_usesSpent` on a weapon without `perBattleUses`). A suspended battle, a Vision rewind and Continue from Map carry `_usesSpent` with the item as they always have.

## Where it shows

- The forecast's attacker notes always give the planned weapon's count ("Silver Sword: 7/10 uses this battle", `ItemKeywords.plannedWeaponUsesNote`), so cycling weapons in the forecast shows each one's (the phone forecast puts it beside the weapon's name instead, "4/15 uses", so an upright phone keeps both sides in view); the battle's Equip menu shows it on every row ("Iron Sword 12/20", `weaponUsesShort`). No separate low-uses warning (Dave, 2026-10-17).
- The phone HUD's unit line ("Myrmidon · Iron Sword (12/20)"), the desktop inspect tooltip (`equippedWeaponUsesLine`), the unit detail weapon tooltip and the roster sheet ("Uses 12/20 this battle", `perBattleUsesText`).
- Help › Arms › Weapon Uses (numbers read from the data).

## Next (not built)

2. Weapon arts repricing: most arts cost weapon uses instead of HP; HP stays on legendary and scroll-only arts; Way of the Art, Bloodless Art, Mark of the Forge and Blood Gem cover uses.
3. More uses: a Reinforce forge step, Smith's Oil (refills one weapon), Armsthrift (skill), Smith's Bracer (accessory: the wearer's weapons spend no uses), Smith's Covenant +uses.
4. Balance pass from play and a sim.
