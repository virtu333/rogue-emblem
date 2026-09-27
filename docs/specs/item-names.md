# Item names: the Armoury Grammar

Status: shipped 2026-09-26. Owner direction: move off Fire Emblem's item names, and
keep weapons as easy to classify as FE's are. The brainstorm and the choices are in the
"Armoury Grammar" artifact; tags that state each rule are in
[item-keywords.md](item-keywords.md).

## The rule

- **Common gear: family word + type noun.** A family word means one rule on every
  weapon type. Iron, Steel and Silver stay as the tiers; Sunder and Adder already
  worked this way.

  | Family | Rule | Weapons |
  |---|---|---|
  | Keen | Crit | Keen Sword, Keen Lance, Keen Axe, Keen Bow (and Jian, the steel crit sword) |
  | Oath- | Strikes twice | Oathblade, Oathlance, Oathaxe, Oathbow |
  | -hook | Beats its own counter (names what it catches) | Bladehook (axe, beats swords), Lancehook (sword, beats lances), Axehook (lance, beats axes) |
  | -bane | Effective against | Mailbane (armour), Horsebane (cavalry) |
  | -brand | Magic sword | Thunderbrand |
  | Gust / Gale | Wind at range | Gust Blade, Gale Blade |
  | Adder | Poison | Adder Blade, Adder Bow |

- **Relics keep proper names.** Legend-tier weapons are one of a kind, and the lore
  keeps proper nouns scarce, so a name marks something rare: Twinsworn, Namethief,
  Tidebreaker, Hermit's Bow, Firstwind, Breachbolt, Endword (Ragnarok, Gae Bolg,
  Doomblade, Ruin, Starfall kept theirs). Their card's base line says "Legend Sword", matching the reward tier.
- **Tomes climb a ladder.** Fire → Wildfire → Conflagration; Glimmer → Brilliance →
  Crownlight (the sun's crown, the lore's name for the corona).
- **Imbues** follow the same one-word-one-rule idea: the crit imbue is **Cruel** (it was
  Keen, which now names the crit weapons) and the armour imbue is **Armorbane** (it was
  Sundering, which read as the Sunder family). Their ids (`keen`, `armorbane`) are unchanged.

The full old → new table is `ITEM_RENAMES` in `src/engine/ItemNameMigration.js`.

## Saves

Saves store whole item objects and a name is an item's identity (weapon-art gates,
siege lookups, icons, fx), so `RunManager.fromJSON` renames every item in an old save
before anything reads it: units, convoy, shops, rewards, colosseum mercenaries, the
battle checkpoint, its entry state and its rewind timeline (keyframes and patches), and
the siege-weapon name strings. Composed names keep their parts ("Keen Killing Edge +1"
became "Cruel Keen Sword +1"). A renamed item also takes the lore and rule text the
catalog changed with it; stats, forge levels, imbues and uses stay. Saves written since
carry `itemNamesRevision`, and the walk skips them. Cloud saves load through the same
path.

**Adding a rename:** add the pairs to `ITEM_RENAMES` (or a new table), bump
`ITEM_NAMES_REVISION`, and rename the icon/hero ids (`itemSlug`) and their files.
`tests/ItemNameMigration.test.js` fails if an old name is still in the catalog, a new
name isn't, or one rename could chain into another.

## Art

Five renames changed the concept, so their paintings and icons were redrawn: Jian
(straight, double-edged, tassel), Gust Blade (a sword that throws a gust, not a thrown
blade), Lancehook (a hooked quillon), Axehook (a bill hook) and Tidebreaker (a
breaking-wave back). The other renamed items kept their pictures under the new ids.

## Round two: supplies, gear, staves, skills and arts

Owner review of the naming ledger, 2026-09-27. The general note: a new name should be
at least as dramatic as the one it replaces, and it need not be a literal translation.

- **Stat boosters are lore objects that point at their stat**, and every booster card
  shows the stat as a tag (`+2 STR`; [item-keywords.md](item-keywords.md)): Mightroot
  (STR), Spellstone Dust (MAG), Drill Primer (SKL), Fleet Plume (SPD), Wyrmscale (DEF),
  Warding Cord (RES), Blessed Vestment (HP). Swiftsoles (MOV) was already ours.
- **Supplies and gear:** Poultice (was Vulnerary), Sovereign Seal (Master Seal; it joins
  Infantry Seal and Mounted Seal), Fatethread Pendant (Goddess Icon), Sisters' Mantle
  (Seraph Robe), Courier's Boots (Boots), Picket Buckler (Delphi Shield).
- **Staves are named for what they do:** Heal → Solace → Remembrance climb in power;
  Farcall (ranged heal), Canticle (heals everyone; Legend), Cleanse (cures status),
  Deliverance Staff (pulls an ally to you), Fold Staff (sends an ally away; Legend),
  Lullaby Staff and Hush Staff (enemy sleep and silence). The pixel icons pick a staff's
  look from its fields (`statusEffect`, `relocate`, `cureConditions`), never its name.
- **Skills and arts change display names only.** Ids are unchanged, so saved units,
  learned arts and meta assignments are untouched. Examples: Sol → Reclaim, Luna →
  Umbra, Astra → Constellation, Aether → Swallow, Desperation → Death's Door, Pavise →
  Shieldwall (Bulwark is the Knight's mastery perk), Colossus → Juggernaut, Flare →
  Immolation, Fiendish Blow → Hellfire Charge; Grounder → Sweep, Nosferatu → Grave
  Hunger, Galeforce Assault → Oathstorm. Canto keeps its name. The full lists are in
  `data/skills.json` and `data/weaponArts.json`; `tests/SkillArtNames.test.js` holds
  the retired names.
- **Scrolls follow what they teach:** "<skill or art name> Scroll", "Teaches <name>".
- **Names come from data.** Combat labels a proc with the skill's name from
  `skills.json` (`skillDisplayName`), an art's activation record carries the art's own
  name, and a weapon that grants a skill names it from data (`grantedSkillSpecial`).

`ITEM_NAMES_REVISION` 2 renames saved scrolls, arts, supplies, gear and staves, the
`recruitBlessingGrants` keys that name an item, and "Grants Sol to wielder" specials.
Old names that are plain words (Restore, Boots, Mend, …) are renamed only on items.

Six paintings changed subject with their names and were redrawn: Mightroot, Wyrmscale,
Warding Cord, Fatethread Pendant, Sovereign Seal and Poultice. Blessed Vestment and
Sisters' Mantle went back to the plain folded robes they had before the winged reroll
(owner's call). The rest kept their pictures under the new ids.

## Not renamed here

Class names are the next pass. The lore bible (`docs/lore/`, on its own branch) still
names some relics by their old names.
