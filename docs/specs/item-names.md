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
  Doomblade, Ruin, Starfall kept theirs). Their card's base line says "Relic Sword".
- **Personal weapons keep proper names too.** Each lord has one (`signatureOf` in
  weapons.json, `engine/SignatureWeapons.js`): Rapier (Edric), Godsend (Rowan),
  Windward (Astrid), Holdfast (Cael), Endgame (Kira), Threadlight (Sera), Last Watch
  (Voss). Deadly Arsenal I gives the commander theirs in place of the Steel weapon; they
  never drop or sell, so no loot table lists them (`npm run validate:data` checks).
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

## Not renamed here

Accessories, supplies, staves, scrolls and class names are the next passes. The lore
bible (`docs/lore/`, on its own branch) still names some relics by their old names.
