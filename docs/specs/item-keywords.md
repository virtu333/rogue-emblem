# Item keywords

Status: shipped 2026-09-26. Part of the naming pass. Owner direction: the lore names are
good but illegible; players need a fast way to classify weapons the way Fire Emblem's
names do.

## The rule

A weapon card says two things beside the name:

- **What it is:** the base line. `Silver Lance`, `Steel Axe`, `Relic Sword`, `Rare Bow`,
  `Tome`, `Light Tome`, `Staff`. It is left out when the name already says it
  (`Iron Sword +2`, `Vampiric Steel Axe`).
- **What it does:** one tag per rule. `Crit 30`, `Strikes twice`, `Beats Axes`,
  `x3 vs Armored`, `Uses MAG`, `Halves DEF`, `Poison 5`, `Drains HP`, `Thrown`,
  `Wind gust`, `Close range`, `Range 2-3`, `No triangle penalty`, `+5 STR on counter`, `+5 DEF`,
  `Alone: +4 STR, +4 SPD`.

Names carry flavour; tags carry rules. This is the Diablo and Slay the Spire split.
Relics get their proper names (the lore keeps proper nouns scarce, so a name marks
something rare), and the base line says `Relic` instead of a tag.

## Where it lives

- `src/engine/ItemKeywords.js` (pure) reads the same `special` text and fields
  `Combat.js` reads. `tests/ItemKeywords.test.js` checks the tags against combat:
  a `Beats X` tag has the triangle advantage against X, an effectiveness tag has
  the multiplier `getEffectivenessMultiplier` returns, and any weapon whose special
  changes play has a tag.
- `src/ui/itemKeywordChips.js` draws the row (`span.re-item-keys`: `.re-item-base`,
  `.re-item-tag.is-<tone>`, each with the full rule as its `title`).
- The help glossary page "Weapon Tags" (Arms tab) explains every tag once.

## Surfaces

| Surface | Shows |
|---|---|
| Shop detail | The kicker is the base line; tags under the name |
| Shop stock (buy) | Tag text after the price and type |
| Battle rewards | Base line and tags under the name; the card's lines drop the type and the raw special they repeat |
| Roster and convoy cards | Base line and tags under the name; the raw special paragraph is dropped when tags state it |
| Battle trade | Tag text after the numbers |
| Compendium (Arms) | List summary `Silver Sword · Crit 30`; tags under the name in the detail |

The phone battle rail keeps its one-line brief (36 characters, the numbers that decide
a pick) with its `✦` mark and full text on a long press; the tags don't fit on that line.
Canvas fallbacks keep their text.
