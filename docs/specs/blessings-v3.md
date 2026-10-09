# Blessings v3: prices that mean something, more kinds of blessing, earned blessings

Status: proposal (2026-10-09). Only §2 is built (the blessing-fixes PR). Everything else is
for review: numbers marked *provisional* are first estimates to validate (§9).

Sources: a code audit of the blessing system (`BlessingEngine.js`, `RunManager.js`
blessing logic, `ChurchVow.js`, `EventEffects.js`), the economy figures from the harness
and `sim/strategy.js`, and 49 best-worst rounds the designer played in the Blessing Ledger
(a choice exercise over real offers, judged for Dusk).

## Why

Designer:

> some choice combinations are too weak (upside vs downside), and some are probably just
> too strong

> the current existing blessings seem like we're missing some variety

> some choices like coin of fate vs -20% battle gold are clearly too asymmetric

> elixir is just too weak early game, esp if it's single use

And on legendary blessings: think Slay the Spire relics. Passive, all run, often pure upside,
earned in the run rather than picked at the start. They stay **blessings** (one system, one
list), not a separate relic system.

## 1. What we found

### 1.1 How offers work today

- A run start offers 3 cards. Slot 1 is always a free tier I; slots 2-3 are weighted draws
  from every tier (tier IV weight 0.2 each, so a IV shows in ~17% of offers). Skip is allowed.
- Each tier II-IV card rolls **one price uniformly from its tier's pool** (minus prices that
  share an effect type with the boon); Forbidden Tome and Scroll Archive carry fixed pacts.
- Mid-run, a church's blessing vow offers 3 free tier I; the Twin Altar event gives a tier I
  (for gold) or a tier III (with Ill Omen). Mid-run blessings apply their boons only.
- Backing out to Difficulty Select and starting again re-rolls the offer (new seed).

### 1.2 Prices

The tier pools mix prices that cost almost nothing with prices that cost a great deal, and
the roll decides which a card gets. Conjoint values (logit units against "No blessing" = 0;
about ±1):

| Real prices | | Near-free prices | |
|---|---|---|---|
| Personal skills off until Act 3 (IV) | −2.8 | −1 DEF all units, Act 1 (III) | ≈0 |
| −10% XP (II) | −2.7 | −8 Hit, Act 1 (III) | ≈0 |
| Battle gold −15/−20/−30% (II/III/IV) | −2.0 to −2.5 | Recruits join −1 level (III) | ≈0 |
| −2 DEF all units, Act 1 (IV) | −1.4 | Weapon arts +2 HP (III, and Scroll Archive's pact) | ≈0 |
| All growths −5 (III) | −1.1 | Forbidden Tome's pact (recruit growths −10) | ≈0 |
| Staff healing −20% (II) | −0.5 | +20% / +35% forge costs (II/IV) | no effect (bug, §2) |
| | | Lords' forged weapons lose a forge (IV) | only rolls with Honed Blades |

The sim agrees on the heavy end: "All growths −5" took the commander-KO rate from 39% to
54%; −2 DEF in Act 1 to 51%.

**Gold prices dwarf what they're paired with.** On First Light, −20% battle gold is about
−650 gold in Act 1 and −4,100 over the run (Dusk pays 1.3-1.6× more per battle and runs
longer). Coin of Fate is +750 once. A percentage gold cut is a run-length multiplier; most
boons are not.

### 1.3 Blessings

Card value by tier (median, conjoint): I +0.9, II −2.0, III +2.4, IV −0.3. The tiers are
out of order. Tier II is overpriced (three of its four prices are real, its blessings are the
weakest); tier III is underpriced (its pool is mostly near-free prices).

- **Strongest:** Scholar's Vow, War Veteran, War Tutelage, Forbidden Tome, Merchant Bane.
- **Weakest:** Quartermaster Cache, Terrain Mastery, Pilgrim Coin, Coin of Fate, Rally Cry,
  Swift Instinct, Frugal Smith, Blood Forge, Armory Stash.

What the numbers say about specific cards:

- **Steady Hands** (+3 Hit): hit uses two dice, so this is +0.2 to +1.2 true hit for the
  starting three. It does almost nothing.
- **Iron Oath** (+2 DEF lords): −26% damage taken in Act 1, about 3.5× the survival of
  Blessed Vigor's +2 HP. Strong for tier II.
- **Swift Instinct** (+1 SPD lords): Edric doubles 53% of Act 1 foes instead of 34%. A real
  effect, sunk by its tier II price.
- **Arsenal Pact**: a Silver Sword takes Edric's Act 1 hits-to-kill from 4.1 to 2.2, and
  shops don't sell Silver until Act 3. Fine in Act 1, ordinary by Act 3.
- **Armory Stash**: two random forges on the lords' weapons; Edric's sword gains one only
  about half the time (+0.13 Might on average). The weakest IV.
- **Quartermaster Cache**: one Elixir per lord. An Elixir is one use, 1,500 gold, and no Act
  1 shop sells it, but a one-shot doesn't compound.
- **Scout Blessing**: the army starts at 3 and Act 1 deploys 3-4, so +1 deploy rarely binds
  before Act 2; from Act 2 each extra unit deployed brings one more enemy.

The designer values **effects that compound over the run** (XP, growths, gold) and passes on
one-shot items and situational effects. That is the variety problem: most of the catalog is
a number on one of a few axes, and the compounding axes win.

### 1.4 Card text that overpromises

- Nomad's Pact: only recruit nodes and event joins; boss recruits and Colosseum
  mercenaries are not raised.
- Pilgrim Coin: the 15% is off everything in every shop, not only the extra item.
- Armory Stash: no whetstones arrive; forges are applied directly.
- Growth cards: scaled by rung (Dusk ×0.9, Nightfall ×0.8, Black Sun ×0.5); the text shows
  the full number.
- Weapon-art +2 HP prices also tax enemies' weapon arts.

## 2. Fixes first (built: the blessing-fixes PR)

1. **Forge prices charge what they say.** `forge_cost_multiplier` +20% / +35% became a
   negative forge discount that the shop clamped to 0 and `shopForgeBlock` refused. One
   rule now, `ShopCommands.shopForgeDiscount(run, { ambushDiscount })`, reads the run's
   discount in [−1, 0.95] (a surcharge is negative) and composes a liberated village's
   20% off; forging and repair both use it.
2. **A blessing taken mid-run never grows a price.** A church or event blessing is held as
   `{ id, rolledCost: null, midRun: true }`. Before, a load re-rolled a display-only price
   for any tier II+ blessing without one, so the Twin Altar's tier III showed a price it
   never charged. A save from before the flag is read through the run-start selection
   record: a held blessing that wasn't picked at the start is mid-run.
3. **The pause menu lists held blessings** (`ui/heldBlessingsModel.js`,
   `MobilePauseMenu.pauseBlessingList`): name, tier, what it does, and what it cost when
   taken (Cost or Pact). It sits under the burdens on the route map and in battle.
4. **Card text**: Nomad's Pact, Pilgrim Coin and Armory Stash now say what they do.

Left for this proposal (they need a design call): the deforge price that only rolls with
Honed Blades, art-cost prices taxing enemies, growth text not showing the rung's scale, and
the free re-roll by backing out of the offer.

## 3. Pricing model

Replace "a random price from the tier's pool" with **hand-picked prices per blessing, drawn
from one shared catalog of named prices, each with a point value, inside a band per tier.**

### 3.1 The price catalog

`data/blessings.json` gains `priceCatalog`: id → `{ label, points, effects, tags }`. Points
come from the conjoint and the economy numbers, on a 0.5-6 scale (*provisional*):

| Price | Points | Notes |
|---|---|---|
| Personal skills off until Act 3 | 6 | tier IV only |
| −10% XP | 5 | |
| Debt 2,000 | 5 | replaces −30% gold |
| Debt 1,200 | 3.5 | replaces −20% gold |
| Debt 600 | 2 | replaces −15% gold |
| −1 Vision (until the next act) | 3 | base is 1, so this is every rewind for an act |
| −2 DEF all units, Act 1 | 3 | |
| −1 deploy, Act 1 | 2.5 | new |
| All growths −5 | 2.5 | |
| Hunted, 2 battles | 2 | existing burden |
| Sworn Enemy | 2 | existing burden |
| +8 shadow now | 1.5 | new price type (event `shadow` effect) |
| Ill Omen, 3 battles | 1.5 | existing burden |
| Shops +15% | 1.5 | new |
| +20% forge costs | 1.5 | works since §2 |
| Staff healing −20% | 1 | |
| Lingering Injury on the commander | 1 | existing burden |
| −1 DEF Act 1 / −8 Hit Act 1 / recruits −1 level / arts +2 HP | 0.5 | garnish only: never a II-IV card's whole price |

**Gold prices become Debt.** Debt is an existing burden: a fixed sum owed, half of each
victory's battle gold garnished until it's paid (a quarter on First Light), not cleansable. A
600-gold Debt is paid off within the first few Act 1 battles. It's finite, it bites early when
gold matters most, and the held-blessings list and burden chips already show what's left.
Run-length percentage cuts go away. The two that make sense as Act 1-only cuts can stay as
garnish.

Never pair a gold price with a gold boon (the existing "same effect type" exclusion, kept).

### 3.2 Bands and the offer

| Tier | Meaning | Price points | Boon points (target) |
|---|---|---|---|
| I | free gift | 0 | 1-2 |
| II | small bet | 1-2 | 2.5-3.5 |
| III | big bet | 2.5-3.5 | 4-5 |
| IV | pact | a fixed pact, 4-6 | 5.5-7.5 |

Every tier nets about +1.5. A tier says how big the bet is, not how good the deal is: the
same expected value with a bigger swing. That's what makes a IV exciting without making it
a trap.

- Each tier II-III blessing names **2-3 candidate prices** (`prices: [...]`) from the catalog.
  The engine rolls one (seeded, as now). `npm run validate:data` refuses a candidate outside
  its tier's band and a gold price on a gold boon.
- Each tier IV carries a **fixed pact** that fits its story.
- **Offer shape:** slot 1 stays a free tier I (the safe pick). Slots 2-3 draw tiers II-IV
  with weights II 1.0, III 0.8, IV 0.35, and **never share a tier**: every offer is a free
  pick, a smaller bet and a bigger one. A IV then shows in about 30% of offers.
- **Mid-run grants** (church vow, Twin Altar) stay boons-only and are limited to tier I
  and the "shape" cards (§5.1), so a church never hands out a IV's boon without its pact.
- Fix the free re-roll: the offer's seed is the run seed, kept from the first time the
  shrine is shown.

## 4. The current 23

| Blessing | Today | Verdict | Proposed |
|---|---|---|---|
| Steady Hands | I, +3 Hit | rework | **Keen Eye** (I): +10 Hit on the first strike of each combat you start. Under two-dice hit that matters for axes and low-SKL recruits. |
| Coin of Fate | I, +750 gold | rework | **Advance Pay** (I): +500 now, +250 at the first node of each later act. |
| Blessed Vigor | I, lords +2 HP | retune | I: lords +4 max HP. |
| Field Medic | I, a Vulnerary each | keep | I. |
| Swift Instinct | II, lords +1 SPD | reprice | II with curated prices: Debt 600 / staff healing −20%. |
| Iron Oath | II, lords +2 DEF | retier | III: Debt 1,200 / Ill Omen + garnish. |
| Rally Cry | II, +3 STR/MAG Act 1 | reprice | II with light prices only (staff healing −20% / Lingering Injury on the commander). |
| War Veteran | II, +15% XP | retier | III: Debt 1,200 / −1 deploy Act 1 / shops +15%. |
| Frugal Smith | II, forge −30%, +1 forge | rework | **Smith's Mark** (II): each shop's first forge is free, +1 forge per shop. |
| Terrain Mastery | II, Forest/Fort bonus | rework | **Holdfast** (II): a unit that hasn't moved this turn gets +2 DEF and +10 avoid. A playstyle, not a terrain lottery. |
| Quartermaster Cache | II, 1 Elixir per lord | rework | II: an Elixir in the convoy at the start of every act, Act 1 included (four over a Dusk run). |
| Scout Blessing | III, deploy +1 | retier | II: deploy +1; prices Debt 600 / Hunted 2. |
| Scholar's Vow | III, all growths +5 | retier | IV, pact: recruits join −1 level and Debt 1,200. The best card in the game. |
| Pilgrim Coin | III, shop +1 item, −15% | rework | **Pilgrim's Road** (II): each act's route gets one more shop (a keyed post-pass converts one non-combat node; the node-map stream is untouched). |
| Merchant Bane | III, +15% battle gold | keep, rename lore | III: Hunted 2 / Sworn Enemy (no gold price). |
| Nomad's Pact | III, recruits +2 levels | widen | III: also boss recruits and mercenaries. Debt 1,200 / Sworn Enemy. |
| Focused Curriculum | III, lords +12 SPD/SKL growth | retune | III: +20 SPD/SKL and the class's attack stat. |
| Arsenal Pact | IV, a Silver weapon | keep | IV, pact: Debt 2,000. |
| Forbidden Tome | IV, lords +12 growths | reprice | IV, pact: no church revives this run (the pact it has is near-free). |
| Blood Forge | IV, +2 Might on lords' weapons | rework | II: +1 Might on each lord's equipped weapon, outside the forge limit. |
| War Tutelage | IV, a skill per lord | keep | IV, pact: personal skills off until Act 3 (the new skills crowd out the old). |
| Armory Stash | IV, 2 random forges | cut | Folded into a gift (§7). |
| Scroll Archive | IV, 2 art scrolls | reprice | IV, pact: Debt 2,000 (its pact is near-free). |

Ids never change (save data). A cut blessing stays in the catalog with weight 0 so old saves
load; a renamed one keeps its id and changes only `name`.

## 5. New starting blessings

Twenty, across the axes the catalog doesn't reach. "Hook" names the system it rides on;
**new** marks a new boon type with a handler in `_applySingleRunStartBlessingEffect` and,
where it acts in battle, a read in the combat-mod builder (`BattleScene` and
`HeadlessBattle`, or better an extracted pure module).

### 5.1 Shape over time

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Late Bloom | every unit +1 to all stats at each act cleared | `advanceAct`; new | III | Debt 1,200 / −1 DEF Act 1 + Ill Omen |
| Slow Fuse | lords −1 all stats in Act 1, +2 all stats from Act 2 | act-scoped stat delta (exists) | II | none: the Act 1 dip is the price |
| Veteran's Road | recruits join at the commander's level −1 | `RecruitScaling`; new | III | Debt 1,200 / recruits join unarmed |
| Dawn Tithe | +100 gold per turn under par at each victory | turn bonus; new | II | +8 shadow / staff healing −20% |

### 5.2 Build-arounds

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Lone Banner | deploy cap −1; every deployed unit +25% XP | deploy delta (exists) + conditional XP; new | III | none: the cap is the price |
| Phalanx Rite | +1 DEF per adjacent ally, up to +3 | accessory condition `adjacent_ally` | III | Debt 1,200 / Sworn Enemy |
| Duelist's Creed | +15 avoid, +10 crit with no ally within 2 tiles | accessory condition `no_ally_within_2` | II | Lingering Injury on the commander / Debt 600 |
| Cavalier's Hour | mounted units +1 MOV; infantry +1 DEF | move types in classes.json; new | II | Debt 600 / staff healing −20% |

### 5.3 Systems the catalog never touches

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Bloodless Art | weapon arts −1 HP and +1 use per map | `WeaponArtSystem` cost and `perMapLimit` | II | staff healing −20% / Debt 600 |
| Saint's Reserve | every staff +1 use per battle | staff use table | II | Debt 600 / Ill Omen |
| Cutpurse's Luck | twice as many carriers; Steal skips its speed check | `carryConfig`, `Steal.js` | III | Hunted 2 / Sworn Enemy |
| Open Roll | recruit nodes offer two candidates | `RecruitNodeSystem` | III | recruits −1 level + Debt 600 / Debt 1,200 |
| Watcher's Grace | +1 Vision on every boss map | Vision grant at battle start | II | +8 shadow / Debt 600 |
| Patient Dawn | +2 par turns on every map | `TurnBonusCalculator` offset | III | Act 1 −1 deploy / Ill Omen + Debt 600 |
| Cartographer's Thread | redraw one road per act | `RouteEdit` (pure), route-map entry | II | +8 shadow |
| Twin Chapel | churches offer two vows per visit | `ChurchVow` | II | Debt 600 |
| Omen Reader | the Eclipse's next fall shows two nodes early; falls spare recruit nodes | `EclipseSystem` thresholds | II | +8 shadow |

### 5.4 Variance

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Gambler's Coin | each victory's battle gold is halved or doubled, seeded by run and node | battle gold; new | II | none: the variance is the price (expected value +25%) |
| Lottery Loot | one loot card per battle comes from the next act's table | `LootSystem` tier offset (exists for event accessories) | III | Debt 1,200 / Sworn Enemy |

## 6. Earned blessings

Blessings flagged `earned: true`: never in a start offer, granted by the run. Most are pure
upside (Slay the Spire's relics); a few carry a twist the player opts into (its boss relics).
They join the same held list, show "Earned" in place of a tier, and the Compendium lists them
under their own heading.

### 6.1 Pure upside

| Blessing | Effect | Source |
|---|---|---|
| Unbroken Banner | once per battle, the first ally who would fall survives at 1 HP | act boss |
| Second Dawn | +1 Vision at the start of each act | eclipsed elite |
| Standard of the Sun | the commander's personal aura reaches 1 tile further, +5 Hit | Act I boss |
| Ember Lantern | the first kill each battle heals the killer 10 HP | act boss |
| Hollow Hourglass | enemy reinforcements arrive one turn later | eclipsed elite |
| Chronicle | +5% XP for every act cleared | Act II boss |
| Captain's Whistle | every unit +1 MOV on turn 1 | act boss |
| Tithe Box | 200 gold each time you enter a church | special church |
| Saint's Reliquary | a church's Heal all also restores every staff's uses and lifts a Lingering Injury | special church |
| Mercenary Ledger | Colosseum fees halved, +1 bout per visit | Colosseum |
| Smith's Covenant | each shop's first forge is free; forged weapons never take wear | Wandering Smith event |
| Thief's Lantern | carriers show on the route map preview; Steal skips its speed check | the Collectors event |
| Lantern of the Road | fog maps open revealed within 4 tiles of each ally | eclipsed elite |
| Crest of the Road | every recruit rolls a Mark | event |

### 6.2 With a twist (taken knowingly)

| Blessing | Effect | Twist |
|---|---|---|
| Second Dawn (dark) | +1 Vision each act, and +1 now | +8 shadow now; the Eclipse fills 25% faster |
| Blood Covenant | every unit, recruits included, +1 to all stats | Ill Omen never ends (+1 shadow each victory) |
| Kingmaker's Oath | promotions are free and add +2 to the class's two best stats | Master Seals can't be used: promote only at a church, with its vow |
| Seer's Eye | no fog; the route map shows every node's contents; one road redraw per act | enemies +1 level |
| Hollow Sun's Favor | +50% battle gold and loot gold | Hunted until Act 3 (waves of 2) |

The Unbroken Banner and Blood Covenant were drafted with weaker twists (Edric −3 max HP; a
Lingering Injury). Both scale badly: −3 max HP is nothing late, and a Lingering Injury is one
unit −2 to one stat for three battles.

### 6.3 Sources and cadence

- **Act boss:** after the boss reward, offer 2 earned blessings (pick 1 or skip). The
  pair is drawn from the run seed. Twisted ones only appear here.
- **Eclipsed elite fights:** their spoils include 1 earned blessing (pure) a third of the
  time. The Eclipse gets a reason to run late.
- **A special church** (an "old sanctum"): a keyed hash stamps at most one church per act
  from Act 2, as recruit previews and Dark Omens are stamped, so the node-map stream never
  moves. Its vow offers 2 earned blessings in place of the tier I three.
- **Events:** the named events above grant theirs as an outcome.

That's about 3-4 earned blessings on First Light and 4-5 on Dusk+.

**Snowball guards:**
- Offer weight falls with each one already held (1, 0.6, 0.35).
- No id twice.
- A run holds at most one blessing tagged `growth` and one tagged `xp` from any source, start
  or earned (an `excludes` by tag).
- On Black Sun, growth is halved, which makes stat blessings relatively stronger, so offer at
  most one stat-tagged earned blessing per run there.

## 7. Gifts with a catch (run start)

Slay the Spire's Neow offers "a random rare relic, lose something". The analogue: from the
second run on, the start offer adds a fourth card, a gift drawn (seeded) from this list. Each
is random in what it gives and clear about what it takes.

| Gift | What you get | The catch |
|---|---|---|
| Sealed Reliquary | a random tier III blessing, no price | −1 Vision until Act 2 |
| Gilded Chest | +1,200 gold now | Debt 1,800 |
| Stranger's Scroll | two random weapon-art scrolls and a random skill scroll | Lingering Injury on the commander for 5 battles |
| Marked Blade | a Silver weapon with a random imbue for the commander | Sworn Enemy on the Act I boss |
| Pilgrim's Wager | a random tier IV blessing, its pact waived | +15 shadow now; one Act 1 node falls at once |
| Armory Stash | three random whetstones in the convoy | −2 DEF all units, Act 1 |

## 8. Data and engine changes

- `data/blessings.json` v3:
  - `priceCatalog`;
  - per blessing: `prices` (ids) or `pact`, plus `points`, `tags` and `earned`;
  - `costPools` stays for old saves only;
  - `schemas/blessings.schema.json` and `docs/blessings_contract.md` bump with it.
- `BlessingEngine`: tier bands, the "never share a tier" rule, roll from `prices`, validator
  rules (band, gold-on-gold, tag excludes).
- `RunManager.addBlessingMidRun(id, { price })`: apply and store a price when a source names
  one (the twisted earned blessings, a gift's catch). Burden prices go through `addBurden`.
- A `describeBlessing(blessing, rung)` so card and list text show rung-scaled numbers; the
  validator refuses a hard-coded number in a scaled effect's description.
- New boon types (§5), each with a handler, a `createBlessingRuntimeModifiers` field with a
  load default, and combat reads in one shared pure module (not a second copy in
  `HeadlessBattle`).
- UI:
  - the offer card shows its price kind (Cost / Pact / Debt) and its band ("small bet",
    "big bet");
  - the held list shows Debt remaining;
  - the boss reward and the special church get the earned-blessing pick;
  - the Compendium gets an Earned section.
- The prologue holds no blessings (unchanged).

## 9. Measuring it, and the order to build it

**Validate the points before tuning further.** Update the Blessing Ledger to the v3 catalog
(curated prices, Debt, the new cards) and play another 50 rounds. The model already separates
blessing value from price value. Then check `sim:strategy -- --section blessings` for the
growth, XP and gold cards it can see.

**Watch after release:**
- pick rate per card and per price (`blessingSelectionTelemetry`);
- start-offer skip rate;
- commander-KO rate by held blessing;
- gold unspent at run end (it should fall once Debt replaces percentage cuts);
- deployed-unit XP share with Lone Banner.

**Risks:**
- **Compounding cards stacking.** Scholar's Vow, War Veteran, Late Bloom and Chronicle
  together on a small army (Lone Banner) is the obvious runaway. The tag cap and the
  per-deploy enemy rule from Act 2 push back.
- **Rung scaling.** Black Sun halves growth, so growth cards are weak there and flat stats
  strong.
- **Legibility.** Debt prices only read if the held list and the burden chips show what's
  owed (they do after §2).

**Build order (each slice playable):**

1. Fixes (§2). Built.
2. Price catalog, curated prices, Debt as the gold price, bands and the validator; retier and
   reprice the existing 23 (§4: data and small handler changes). Re-run the Ledger.
3. Five new cards that reuse existing hooks most directly: Slow Fuse, Phalanx Rite,
   Duelist's Creed, Bloodless Art, Gambler's Coin.
4. Earned blessings: the `earned` flag, the act-boss pick, and four pure ones (Unbroken
   Banner, Second Dawn, Ember Lantern, Captain's Whistle).
5. The special church, the twisted earned blessings, the gifts with a catch, and the rest of
   §5.

## Open questions

1. Debt as the gold price: does garnishing half of each victory feel like a price, or a tax
   you forget? Alternative: a flat "pay N gold now" for prices on tier II.
2. Kingmaker's Oath: a path meets about 0.4-0.6 churches per act. Is "promote only at a
   church" too tight? Alternative: a Master Seal costs 1,500 gold as well as the seal.
3. Gifts with a catch: offered every run from the second, or only sometimes (a ~50% chance
   per run)?
4. Should earned blessings ever be offered in a shop, as Slay the Spire's shop relics are, or
   only won?
5. Cut cards (Armory Stash): keep the id at weight 0 forever, or retire it through a
   `RETIRED_BLESSINGS` migration like `RETIRED_UPGRADES`?
