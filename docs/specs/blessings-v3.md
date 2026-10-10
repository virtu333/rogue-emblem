# Blessings v3: prices that mean something, more kinds of blessing, earned blessings

Status: proposal (2026-10-09), revised after the designer's first review (same day). Only §2
is built (the blessing-fixes PR). Everything else is for review: numbers marked
*provisional* are first estimates to validate (§9).

Settled in review: Debt is the gold price (its amounts come from `sim:debt`, §3.1);
Kingmaker's Oath stands as written; earned blessings are blessings, never start offers.

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
5. **Pause layout**: on a landscape phone, the burden and blessing lists shrink and scroll
   before the actions do, so Abandon Run never leaves the screen.

Left for this proposal (they need a design call): the deforge price that only rolls with
Honed Blades, art-cost prices taxing enemies, growth text not showing the rung's scale, and
the free re-roll by backing out of the offer.

## 3. Pricing model

Replace "a random price from the tier's pool" with **hand-picked prices per blessing, drawn
from one shared catalog of named prices, each with a point value, inside a band per tier.**

### 3.1 The price catalog

`data/blessings.json` gains `priceCatalog`: id → `{ label, points, effects, tags }`. Points
come from the conjoint and the economy numbers, on a 0.5-6 scale (*provisional*). As built
(#251) the catalog in `data/blessings.json` is the source of truth; where it moved from this
table, the row says so:

| Price | Points | Notes |
|---|---|---|
| Personal skills off until Act 3 | 6 | tier IV only |
| −10% XP | 5 | |
| Debt IV (Dusk 5,000) | 5 | about −15% battle gold (§3.1) |
| Debt III (Dusk 3,000) | 3.5 | about −10% battle gold |
| Debt II (Dusk 1,500) | 2 | about −5% battle gold |
| −1 Vision (until the next act) | 3 | base is 1, so this is every rewind for an act |
| −2 DEF all units, Act 1 | 3 | |
| −1 deploy, Act 1 | 1.5 | new; built at 1.5 (the strategy sim showed an Act 1 cost only) |
| All growths −5 | 2.5 | |
| Hunted, 2 battles | 2 | existing burden |
| Sworn Enemy | 2 | existing burden |
| +8 shadow now | 1.5 | new price type (event `shadow` effect) |
| Ill Omen, 3 battles | 1.5 | existing burden |
| Shops +15% | 1.5 | new |
| +20% forge costs | 1.5 | works since §2 |
| Staff healing −20% | 1 | |
| Lingering Injury on the commander | 2 | existing burden; drafted at 1, priced 3 after a strategy sim (commander KO 71.5% vs 57.7% with no price) whose battles never took a battle's stat deltas back, so the injury's −2 stayed on the commander for good. Re-priced to 2 once the sim cleared them (PR D4): commander KO 45.3% vs 39.3% with no price (First Light, 30 runs a row), next to Hunted 2 (2 pt, 45.8%) and well under −2 DEF Act 1 (3 pt, 51.8%). **The numbers before that fix are not comparable with these.** Nomad's Pact and Focused Curriculum, whose 3-point candidate it was alone, now pair it with −8 Hit Act 1 (2.5) |
| −1 DEF Act 1 / −8 Hit Act 1 / recruits −1 level / arts +2 HP | 0.5 | garnish only: never a II-IV card's whole price |

**Gold prices become Debt.** Debt is an existing burden: a fixed sum owed, half of each
victory's battle gold garnished until it's paid (a quarter on First Light), not cleansable.
It's finite, it bites early when gold matters most, and the held-blessings list and burden
chips already show what's left. Run-length percentage cuts go away. The two that make sense
as Act 1-only cuts can stay as garnish.

**How much Debt.** The first draft guessed 600 / 1,200 / 2,000; review said too low (Debt
600 should not sit beside staff healing −20%). A calibration exercise in the Blessing Ledger
did not give answers the designer trusted, so the amounts come from the economy instead:
`npm run sim:debt` (`sim/debt.js`).

Both prices act on the same number, each victory's battle gold (`completeBattle`
`finalGold`). A cut of X loses X of it every battle. A Debt of D takes the garnish (a half; a
quarter on First Light) from the first battle until D is paid. Gold is weighted by when it's
earned, because late gold is worth less (runs end with gold unspent). The sim finds the Debt
whose weighted cost equals each cut's:

- 40 invincible harness runs per rung;
- each victory's gold read exactly, the purse unchanged;
- four weightings (all gold equal; −3% or −7% a battle; by act 1 / 0.7 / 0.45 / 0.3).

Main reading: by act. The range is the −7% to −3% a battle readings.

| Debt equal to | First Light | Dusk | Nightfall | Black Sun |
|---|---|---|---|---|
| −5% battle gold | 650 (500-800) | 1,300 (900-1,600) | 1,400 (1,000-1,750) | 1,850 (1,300-2,350) |
| −10% | 1,450 (1,200-1,700) | 2,700 (2,050-3,450) | 2,900 (2,200-3,700) | 4,050 (2,950-5,000) |
| −15% | 2,350 (2,150-2,750) | 4,500 (3,400-5,500) | 4,850 (3,600-5,900) | 6,700 (4,950-7,900) |
| −20% | 3,700 | 6,350 | 6,850 | 9,300 |
| −30% | none: a quarter garnish can't cost that much | 11,100 | 11,700 | 15,600 |

With all gold weighted equally, Debt runs about twice as high (Dusk −15% = 7,500). That
reading ignores the gold runs end with unspent, and the invincible agent's late gold reads
high (it is slow, so the Eclipse turns more of its late nodes into elite fights).

Battles to pay it off (median, by act): −5% about 5-6, −10% about 8-11, −15% about 11-14.
First Light takes longest, at a quarter garnish. So a tier II Debt is a felt Act 1 cost; a
tier IV one runs into Act 2.

**Tier amounts.** The conjoint put the old gold cuts at about 5 points, so 1 point is about
3% of battle gold. The tier bands then ask for:

| Tier | Points | Replaces | First Light | Dusk | Nightfall | Black Sun |
|---|---|---|---|---|---|---|
| Debt II | 2 | ≈ −5% | 850 | 1,500 | 1,600 | 2,200 |
| Debt III | 3.5 | ≈ −10% | 1,650 | 3,000 | 3,200 | 4,450 |
| Debt IV | 5 | ≈ −15% | 2,750 | 5,000 | 5,350 | 7,400 |

Built amounts (review: late gold still buys strong items, so they sit about 10% above the
by-act reading, between it and the −3% a battle reading). That is the old tier II price
(−15% gold) moved to tier IV, which matches the conjoint's finding that tier II was
overpriced. One Dusk amount per tier is stored in the catalog, with `debtScale` by rung
0.55 / 1 / 1.07 / 1.48, rounded to 50. The events' `costScale`
(1 / 1 / 1.25 / 1.5) prices event fees, a different thing, so keep it separate. Re-run
`sim:debt` when the battle-gold economy changes.

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
- A tier II-III card whose own boon *is* its cost (Slow Fuse's Act 1 dip, Gambler's Toss's
  bad tosses) carries an **intrinsic price** instead of `prices`: `intrinsicPrice` `{ label,
  points }`, validated against the same band, shown as "Price: …", spending one price draw like
  a pact so neighbouring offers do not move. It is never granted mid-run by an event.
- **Offer shape:** slot 1 stays a free tier I (the safe pick). Slots 2-3 draw tiers II-IV
  with weights II 1.0, III 0.8, IV 0.25, and **never share a tier**: every offer is a free
  pick, a smaller bet and a bigger one, shown in that order. A IV then shows in about 32%
  of offers (0.35 gave 40%).
- **Mid-run grants** (church vow, Twin Altar) stay boons-only and are limited to tier I
  and the "shape" cards (§5.1), so a church never hands out a IV's boon without its pact.
- Fix the free re-roll: the offered run's seed is kept in the game registry for each save
  slot (`{ [slot]: seed }`) until that slot's run begins, so backing out, or opening another
  slot's shrine in between, shows the same offer (a page reload still draws afresh).

## 4. The current 23

| Blessing | Today | Verdict | Proposed |
|---|---|---|---|
| Steady Hands | I, +3 Hit | rework | **Keen Eye** (I): +10 Hit on the first strike of each combat you start. Under two-dice hit that matters for axes and low-SKL recruits. **Built.** |
| Coin of Fate | I, +750 gold | rework | **Advance Pay** (I): +500 now, +250 at the first node of each later act. **Built**, paid at act start (see as built). |
| Blessed Vigor | I, lords +2 HP | retune | I: lords +4 max HP. |
| Field Medic | I, a Vulnerary each | keep | I. |
| Swift Instinct | II, lords +1 SPD | reprice | II with curated prices: Debt II / staff healing −20%. |
| Iron Oath | II, lords +2 DEF | retier | III: Debt III / Ill Omen + garnish. |
| Rally Cry | II, +3 STR/MAG Act 1 | reprice | II with light prices only (staff healing −20% / +8 shadow). |
| War Veteran | II, +15% XP | retier | III: Debt III / −1 deploy Act 1 / shops +15%. |
| Frugal Smith | II, forge −30%, +1 forge | rework | **Smith's Mark** (II): each shop's first forge is free, +1 forge per shop. **Built.** |
| Terrain Mastery | II, Forest/Fort bonus | rework | **Hold the Line** (II): a unit that hasn't moved this turn gets +2 DEF and +10 avoid. A playstyle, not a terrain lottery. **Built**, renamed (see as built). |
| Quartermaster Cache | II, 1 Elixir per lord | rework | II: an Elixir in the convoy at the start of every act, Act 1 included (four over a Dusk run). Prices: staff healing −20% / shops +15%. **Built.** |
| Scout Blessing | III, deploy +1 | retier | II: deploy +1; prices Debt II / Hunted 2. |
| Scholar's Vow | III, all growths +5 | retier | IV, pact: recruits join −1 level and Debt III. The best card in the game. |
| Pilgrim Coin | III, shop +1 item, −15% | rework | **Pilgrim's Road** (II): each act's route gets one more shop (a keyed post-pass converts one non-combat node; the node-map stream is untouched). **Built.** |
| Merchant Bane | III, +15% battle gold | keep, rename lore | III: Hunted 2 / Sworn Enemy (no gold price). |
| Nomad's Pact | III, recruits +2 levels | widen | III: also boss recruits and mercenaries. Debt III / Sworn Enemy / Lingering Injury on the commander. **Built.** |
| Focused Curriculum | III, lords +12 SPD/SKL growth | keep the effect | III with a real III price (Debt III / all growths −5 / Lingering Injury on the commander), never garnish. Review: stronger numbers would need a much bigger price. |
| Arsenal Pact | IV, a Silver weapon | keep | IV, pact: Debt IV. |
| Forbidden Tome | IV, lords +12 growths | reprice | IV, pact: no church revives this run (the pact it has is near-free). |
| Blood Forge | IV, +2 Might on every non-staff weapon the two starting lords carry at the start (Edric's Iron and Steel Swords, Sera's tome) | rework | II: +2 Might on each starting lord's best weapon (highest Might), so it isn't spent on an Iron Sword that will be replaced. Later weapons are untouched. **Built.** |
| War Tutelage | IV, a skill per lord | keep | IV, pact: personal skills off until Act 3 (the new skills crowd out the old). |
| Armory Stash | IV, 2 random forges | cut | Folded into a gift (§7). |
| Scroll Archive | IV, 2 art scrolls | reprice | IV, pact: Debt IV (its pact is near-free). |

Ids never change (save data). A cut blessing stays in the catalog with weight 0 so old saves
load; a renamed one keeps its id and changes only `name`.

**As built (the reworks that needed code).**

- **Hold the Line, not Holdfast.** Terrain Mastery's id is unchanged; the card is named
  *Hold the Line* because Cael's signature axe is already called **Holdfast** (`weapons.json`),
  and item names are identity. `tests/BlessingReviewFixesA2.test.js` keeps a blessing from
  taking an item's name. A unit holds when it has not moved since its player phase began
  (`BlessingCombatMods.isHoldingGround`); the enemy phase that follows counts too.
- **Keen Eye** adds its Hit to the attacker's first rolled strike only, in `resolveCombat` and
  the forecast (`firstStrikeHitBonus`); counters, follow-ups and Brave strikes roll at the
  base Hit.
- **Advance Pay pays at act start**, inside `RunManager.advanceAct` after the new map is built
  (`_payActStartGrants`), on every act transition including the final boss's; the shrine's
  +500 covers the act it is taken in. `paidActs` is saved, so a reload never pays twice.
  Quartermaster Cache delivers through the same list (Act 1 now; a church take pays the
  current act now). The history record for Advance Pay's boon carries `recurringValue`
  (nothing is paid when it is taken).
- **Smith's Mark's free forge includes a repair.** A shop's first forge *use* (a forge or a
  Village repair) costs nothing; it never raises resale value (`applyForge` `{ free: true }`);
  Blood Forge's shrine forges use the same option. The engine decides `free`, never the UI.
- **Pilgrim's Road converts an event or church** (`ExtraShopPass`, keyed stream). The final
  boss act has only two battle rows, the Ruins and the boss, so it has no event or church to
  convert and gains no extra shop; every other act does. Pacing preferences keep the new shop
  off a shop's parent or sibling when they can. Taken mid-run (the card is tier II, so a church
  never offers it; a future source may), it converts only a node the party can still reach
  from where it stands (a walk forward along the route's edges), never one on a lane already
  closed to it. A converted node keeps its `pilgrimShop` mark even if the Eclipse later makes
  it a battle: a burned shop is not handed back.
- **Nomad's Pact reaches boss recruits and Colosseum mercenaries** by raising the finished
  unit on its own keyed stream (`RecruitJoinLevel`), so classes and names are the same with
  and without it. It never goes below 0: the Scholar's Vow's −1 keeps its recruit-node reach.
- **Old saves** are converted once by `engine/BlessingBoonMigration.js` (revision-gated; see
  `docs/blessings_contract.md` §8): Steady Hands, Frugal Smith, Terrain Mastery and Pilgrim
  Coin lose their old numbers (the amounts come from the blessing's own logged records, so a
  save from before Feb 19 2026 converts exactly) and gain the new boon; Pilgrim Coin's extra shop
  is stamped on the current map ahead of the party, not only from the next act; Coin of Fate and
  Quartermaster Cache keep what they paid and start their recurring grant with the next act. The old
  `terrain_combat_bonus` boon type is retired.

## 5. New starting blessings

Twenty, across the axes the catalog doesn't reach. "Hook" names the system it rides on;
**new** marks a new boon type with a handler in `_applySingleRunStartBlessingEffect` and,
where it acts in battle, a read in the combat-mod builder (`BattleScene` and
`HeadlessBattle`, or better an extracted pure module).

### 5.1 Shape over time

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Late Bloom | every unit +1 in its two strongest growths at each act cleared (re-tuned from +1 to every stat but Move: see as built); **Built** | `act_clear_army_stats` `{ value: 1, stats: 2 }`: an act-start grant (`kind: 'army_stats'`) | III | Debt III / Ill Omen + −1 DEF + −8 Hit Act 1 |
| Slow Fuse | starting lords −1 to HP and the seven combat stats (never Move) in Act 1, +1 from Act 2 (built at +1, not +2: +2 to eight stats per lord for the rest of the run is far above a tier II bet; `lord_stat_arc` params are data) | `lord_stat_arc`, `engine/LordStatArc.js`: a dip reverted at the act's end and a rise at the next act's start | II | intrinsic (2 pt): the Act 1 dip is the price |
| Dawn Tithe | +100 gold per turn under par at each victory; **Built** | `under_par_gold`, paid with the turn bonus | II | +8 shadow / staff healing −20% |

### 5.2 Build-arounds

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Lone Banner | deploy cap −1; every unit +25% XP from battles; **Built** | `deploy_cap_delta` + `xp_multiplier_delta` (both exist) | III | intrinsic (3 pt): the cap is the price |
| Phalanx Rite | +2 DEF per ally on a cardinal neighbour tile (never a diagonal), up to +3 (so +2 with one, +3 with two or more; was +1 per ally); **Built** | `adjacent_ally_def_bonus`: `SkillSystem.countAdjacentAllies` (the accessory condition `adjacent_ally`'s rule), read in `BlessingCombatMods` | III | Debt III / Sworn Enemy + −8 Hit Act 1 |
| Duelist's Creed | +15 avoid, +10 crit while no ally is within 2 tiles (Manhattan); **Built** | `isolated_combat_bonus`: `SkillSystem.hasAllyWithin` (the accessory condition `no_ally_within_2`'s rule), read in `BlessingCombatMods` | III | Debt III / Hunted 2 + −1 DEF Act 1 (was: −1 deploy Act 1; see as built) |
| Cavalier's Hour | mounted units +1 MOV; foot soldiers (Infantry) +1 DEF; Armored nothing; **Built** | `move_type_battle_stats`: battle-start deltas | III | Debt III / Sworn Enemy + −8 Hit Act 1 |

**As built (the formation cards).** Both are player-faction combat bonuses read in
`BlessingCombatMods.blessingCombatModsFor` (the one place a blessing reaches a combat's mods),
on both sides of an exchange, from `side.allies`, the unit's own side as the scene and the
harness pass it (the player's army: green NPCs and foes never count, the unit itself and the
fallen never count). Boon params are positive integers; a boon that would do nothing is refused
by `validateBoonParams` and skipped by the handler (`engine/FormationBlessings.js` is the one
reading). Held as `blessingRuntimeModifiers.adjacentAllyDefBonuses` / `isolatedCombatBonuses`
(one entry per grant, saved, sanitised on load) and handed to combat in the profile as
`adjacentAllyDef` / `isolated`.

- **Phalanx Rite** counts allies at distance 1 (the four cardinal tiles, as the `adjacent_ally`
  accessory condition does). The DEF counts against any physical blow; a magical blow reads RES,
  as every DEF mod does. `max` caps the bonus, not the ally count. Tuned to `{ perAlly: 2, max: 3 }`
  (the review found +1 per ally too small for a tier III card): one neighbour
  pays +2, two or more pay the +3 cap, so the third and fourth neighbour add nothing.
- **Where the formation cards apply.** They are combat mods for DEF, Avoid and Crit in a combat
  exchange, on the attacker's side or the defender's, and nowhere else. The things that ignore
  every DEF mod ignore them too: an area or line art's blows on victims other than the primary
  target, rams, the ballista and Deathburst. The enemy AI's target scoring does not see
  blessing mods (as for every blessing), so a foe does not weigh a Phalanx or a duelist when it
  picks whom to strike. Arena bouts get no blessing, so neither card acts there.
- **Duelist's Creed** counts any living ally within `radius` (Manhattan, so 2 reaches a
  diagonal neighbour and a tile two steps away). Foes within the radius do not break the duel.
  A lone unit (an army of one) is always isolated.
- **Prices.** The brief's pair for Duelist's Creed (Debt III / −1 deploy Act 1) became Debt III /
  Hunted + −1 DEF Act 1: a deploy-cap price on a card that rewards fewer units standing together
  is a gift, not a cost. Phalanx Rite keeps the spec's Sworn Enemy, with the Act 1 −8 Hit dip
  beside it so the pair sits in the tier III band.
- **Events** may grant either (`SAFE_BLESSING_BOON_TYPES`): the boons carry no price of their own.
- **The strategy sim** (`sim/strategy.js`, blessings section) now gives each battle its run (`runManager` in `HeadlessBattle`'s options, so it is present from `init()`), so combat blessings (Keen Eye, Hold the Line, these two, the act Hit price) show in its numbers; before, only stat and gold effects did. Setting `runManager` also turns on the run-level battle effects the harness reads from it: the staff heal multiplier price, the weapon-art price and Bloodless Art, village rewards to the convoy and the consumables a recruit battle uses in-battle. Strategy-layer blessing numbers from before this change are not comparable with those after it.
- **Icons** reuse the Phalanx Band's and the Duelist's Glove's cells (`BLESSING_ICON_REUSE`: the
  atlas is full); both cards wait for a painting (`PAINTING_PENDING`).

### 5.3 Systems the catalog never touches

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Bloodless Art | player units' weapon arts −1 HP (floor 1) and +1 use per map (only arts that have a limit); foes get nothing | `player_weapon_art_boon`: `WeaponArtSystem.weaponArtRunOptions` / `getEffectiveWeaponArtHpCost` / `getEffectiveWeaponArtMapLimit`, read by `canUseWeaponArt` and the menus | II | staff healing −20% / Debt II |
| Saint's Reserve | every staff +1 use per battle; **Built** | `staff_uses_bonus`: `StaffBlessings.staffRunOptions` | II | Debt II / Ill Omen |
| Cutpurse's Luck | twice as many carriers; Steal skips its speed check; **Built** | `carrier_luck`: a second carry pass, `Steal` `ignoreSpeed` | III | Hunted 2 + −8 Hit Act 1 / Sworn Enemy + −1 DEF Act 1 |
| Open Roll | recruit nodes offer two candidates; **Built** | `recruit_alternate`: `RecruitNodeSystem.ensureRecruitAlternates` | III | recruits −1 level + Debt II / Debt III |
| Watcher's Grace | +1 Vision on every boss map, unspent it fades; **Built** | `boss_battle_vision`: `beginBattleInProgress` / `completeBattle` | II | +8 shadow / Debt II |
| Patient Dawn | +2 par turns on every map; **Built** | `par_turn_delta`: `battleParams.blessingParTurns` | III | Act 1 −1 deploy + Ill Omen / Ill Omen + Debt II |
| Twin Chapel | each church accepts two different vows; **Built** | `church_extra_vows`: `ChurchVow` | II | Debt II |
| Omen Reader | the route map marks the next two falls; falls spare recruit nodes; **Built** | `eclipse_omen`: `EclipseSystem` `spareTypes` / `foretold` | II | +8 shadow |

Cut in review: **Veteran's Road** (recruits join at the commander's level −1). A recruit node
already sets the level from the army: the floor of the average effective level of its
strongest units (as many as the act deploys, at most 6), plus any recruit-level bonus, never
below the act's floor (`RecruitNodeSystem.resolveRecruitNodeLevel`). The commander is
usually among those units, so "commander −1" is about what already happens; Home Base's
recruit upgrades (growths, flat stats, Marked Blood) don't touch level.

Later, for effort: **Cartographer's Thread** (redraw one road per act). `RouteEdit` is pure
and exists, but the route map needs a new interaction to pick the road.

### 5.4 Variance

| Blessing | Effect | Hook | Tier | Prices |
|---|---|---|---|---|
| Gambler's Toss (was Gambler's Coin: an accessory has that name) | each victory's battle gold is doubled or cut to a third on an even toss, seeded by run and node (expected +17%; even double-or-halve, +25%, out-earned Merchant Bane in the strategy sim) | `battle_gold_gamble`, `engine/BattleGoldGamble.js`, in `completeBattle` after the elite, Merchant Bane and rung multipliers and before a Debt garnishes | III | intrinsic (3 pt): the variance is the price; never granted by an event |
| Lottery Loot | one loot card per battle comes from the next act's table; **Built** | `next_act_loot_card`: `engine/LotteryLoot.js` | III | Debt III / Sworn Enemy + −8 Hit Act 1 |

**As built (the rest of §5, PR D4).** Twelve cards, one module for their boons
(`engine/ShrineBoons.js`: params, run state, load defaults; the validator and the handler read
the params the same way, so a malformed card is refused rather than shipped doing nothing, and
the totals held are capped the same on take and on load: Dawn Tithe 500 gold a turn, Saint's
Reserve +3 uses, Watcher's Grace +3 charges, Patient Dawn +5 turns).
Prices are re-paired where the brief's pair fell outside the tier band (Late Bloom's Ill Omen
pair takes the two Act 1 garnishes, Cavalier's Hour, Cutpurse's Luck and Lottery Loot take an
Act 1 garnish beside their burden, Patient Dawn's −1 deploy takes an Ill Omen). Every boon but
Lone Banner's (an intrinsic price) is on the event allow-list; none is tier I, so no church altar
offers one. Each icon reuses an existing cell (`BLESSING_ICON_REUSE`); every card waits for a
painting (`PAINTING_PENDING`).

- **Late Bloom** pays as each later act begins (`_payActStartGrants`, after the act's rest), to
  the roster and the fallen (a revived ally has kept pace); never on the take; `paidActs` is
  saved, so a reload never pays twice. Each unit gains +1 in its two highest growths
  (`ShrineBoons.lateBloomStats`: the unit's own `growths`, else its class's, the middle of each
  range, a promoted class through its base plus its `growthBonuses`; a tie goes to the earlier
  stat in HP, STR, MAG, SKL, SPD, DEF, RES, LCK; never Move; no randomness). A living unit's HP
  gain raises its current HP through `UnitHealth.setUnitHP`; the fallen gain none (a revival sets
  it). A grant saved without its `stats` count (only before the re-tune) reads as all eight.
  **Re-tune (review, decided).** As first built (+1 to every stat but Move) the strategy sim put
  it far above tier III (Δsquad A3 +76 against single digits for the other tier III cards, the
  best commander KO of the set), and it contradicted §5.1's Slow Fuse reasoning (+1 to eight stats
  for every unit for the rest of the run is not a tier II-III bet). Re-tuned to the two strongest growths
  (`{ value: 1, stats: 2 }`). `sim:strategy --section blessings --only
  late_bloom,iron_oath,merchant_bane --seeds 12 --difficulty dusk`, each against its own base row:
  as first built Δsquad A3 +76, Δlords A3 +64, commander KO 40.3% (base 57.2%); re-tuned Δsquad
  A3 +30, Δlords A3 +16, commander KO 53.9% (base 57.4%), between Iron Oath (45.7%) and no
  blessing, as the target asked. Its squad gain is still the largest of the three (Iron Oath +9,
  Merchant Bane +11), so it remains the strongest growth card of tier III.
- **Dawn Tithe** pays with the turn bonus in `prepareBattleRewards`, after the victory commit, so
  a Debt never garnishes it, and counts turns under the map's OWN par (Patient Dawn's turns taken
  off: holding both never pays for stretched turns). Nothing on a battle without par. The reward
  header names it ("Dawn Tithe: +N gold"). The strategy sim pays no turn gold, so it cannot see it.
- **Lone Banner** is two existing boons behind an intrinsic price ("Deploy one fewer unit in every
  battle", 3 points); `resolveDeployLimits` never takes the cap below an act's minimum, and a
  recruit node's join level averages the squad that rule fields
  (`RecruitNodeSystem.resolveRecruitNodeLevel`), so Lone Banner with Act 1's deploy price on top
  (−2 in all) still averages Act 1's three.
- **Cavalier's Hour** writes uid-keyed deltas into `battleParams.battleDebuffs` by each unit's move
  type at battle time (Cavalry and Flying +1 MOV, Infantry +1 DEF, Armored nothing; the card says
  "foot soldiers +1 DEF (not Armored)"), beside a Lingering Injury's delta, applied once
  at a fresh start by `BattleStatDeltas.applyBattleStartDebuffs` in the scene and the harness and
  taken back with every battle delta. A recruit who joins mid-battle (Talk) takes none.
- **Saint's Reserve**: `engine/StaffBlessings.staffRunOptions(run, unit)` gives a PLAYER unit's
  staves `bonusUses`; `Combat.getStaffMaxUses` / `getStaffRemainingUses` take it, and so does
  `StaffSettlement.validateStaffAction` (`staffOptions`). Every caller (the battle menu, the heal,
  the roster and unit sheets, trade panes, the reward card, the shop comparison, the harness)
  passes it (`tests/StaffBlessingBoundary.test.js`); the enemy AI never does.
- **Cutpurse's Luck** sets `battleParams.carryPasses` (2): `EnemyCarry.assignEnemyCarry` runs the
  carry roll again on its own stream over the spawns still empty-handed, so the first pass is the
  roll without the card and the expected carriers double (a pass at 0.3 with one slot each gives
  0.6 a battle). Each pass has its own `maxPerBattle`, so a battle can hold twice as many
  carriers. It is written into the map at generation, so a locked map keeps its carriers.
  A player thief's Steal skips the speed check (`ShrineBoons.stealRunOptions` → Steal's
  `ignoreSpeed`); room is still checked, and a foe thief never gains it.
- **Open Roll**: every open recruit node gains `node.recruitAlternate`, drawn on its own stream
  (`recruit-preview-alt:`) and preferring another class; its name is promised like the preview's.
  The loom card shows the second candidate and a "Meet X instead" button
  (`RunManager.swapRecruitCandidate`, saved at once) until the encounter is set; the node's unit
  stream builds whichever candidate the player meets. A node whose lord roll hits shows no choice
  (both candidates would be the same lord).
- **Watcher's Grace** grants its charge in `beginBattleInProgress` AFTER the entry snapshot (so
  Continue from Map takes it back) on every boss node (the final boss and the Entity included),
  recorded as `battleInProgress.bossVisionGranted`; the victory takes back what the battle's
  rewinds did not spend. The scene calls it at a fresh start only, so a resume never grants twice.
  A battle that never reached its first checkpoint (a refresh or Save & Exit on the boss card, or a
  `beginBattle` that threw) gives the grant back: `fromJSON` restores the flag's entry Vision when
  it drops a checkpoint-less flag that granted one, and `beginBattleInProgress` does the same for
  a checkpoint-less flag still in memory, so neither path can farm charges.
- **Patient Dawn**: `battleParams.blessingParTurns`, added last by `calculatePar` (after the seize
  floor), through `TurnBonusCalculator.battleParMapParams`, the one builder BattleScene and the
  harness share. The boss enrage turn, the Eclipse's shadow and a contract's "under par" read the
  raised par; a chapter without par has none. So the enrage can land past turn 12 (intended): a
  map whose own par is 10 has par 12, and the enrage floor (`bossEnrageMinOverPar`, one turn past
  par) puts the enrage on turn 13.
- **Twin Chapel**: `churchVowByNodeId[node]` is a string for one vow (every save before) and the
  list of distinct vows once a second is made; a vow already made stays open (promotions), the
  same vow never counts twice, and a third is refused. The church names both vows made, and its
  vow line counts the vows from `extraChurchVows` ("two different vows per church"). The altar
  stays open after a promotion or a cleansing (`ChurchMenu.renderBlessings` hides it only once the
  blessing vow is made).
- **Omen Reader**: `nodeFallExemption` takes `spareTypes` (recruit), threaded through
  `applyEclipse` (in play and on load) and `buildEclipseView`; the view marks the next two falls
  among nodes that can fall now `foretold`. A fall is every node at one threshold (they fall
  together), so ranks are distinct thresholds, lowest first: every node at a marked threshold takes
  its rank (`omenRank`) and `omenShared` (how many fall with it), and marking stops once two ranks
  are filled (review: about a fifth of maps tie the two lowest nodes, and a quarter leave an
  unmarked node on #2's threshold). The route map rings them with their number, and the card says
  "Omen: the dark takes this knot next" (", with one other" for a tie). With the Eclipse off (no
  run today) the card and its price would do nothing yet could be offered: a TODO for D3's
  `requires`.
- **Lottery Loot**: the battle's own draw is made first, unchanged (the same cards before the
  last, the same Math.random cursor); then its last card is drawn from the next act's table under
  a seeded stream `lottery-loot:${seed}:${node}:${round}` (round n for the n-th Branching Threads
  reroll). A table with no positive non-gold weight is never drawn (the final boss's pays only
  gold): the act then draws its own table (First Light Act III, Nightfall and Black Sun Act IV,
  Dusk's last act), and a gold-only act has no lottery. When every attempt repeats a card already
  on offer, the battle's own card stays. `draw.lotteryActId` is saved with the reward, so a reroll
  draws from the same table. Authored (prologue) loot is untouched. A card from the next act reads
  "Lottery: from the next act's spoils"; one from the act's own table says nothing
  (`LotteryLoot.lotteryCardLine`).
- **Known limitation: an older build re-saving a newer save.** Two new save shapes are dropped by
  a build from before this PR when it loads and re-saves the run: a Late Bloom act-start grant
  (`kind: 'army_stats'`; the old grant sanitiser keeps only gold and items, so the card stops
  paying) and a church's list of vows (Twin Chapel; the old reader keeps a string vow only, so the
  church's vows are forgotten). Nothing else is lost; a run is only affected when a player moves a
  save back to an older client (a cached tab, or the cloud copy read by one).

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
| Standard of the Sun | allies within 2 tiles of your commander +5 Hit and +5 Avoid | Act I boss |
| Ember Lantern | the first kill each battle heals the killer 10 HP | act boss |
| Hollow Hourglass | enemy reinforcements arrive one turn later | eclipsed elite |
| Chronicle | +5% XP for every act cleared | Act II boss |
| Captain's Whistle | every unit +1 MOV on turn 1 | act boss |
| Tithe Box | 200 gold each time you enter a church | special church |
| Saint's Reliquary | staves heal 5 more HP and reach 1 tile further | special church |
| Mercenary Ledger | Colosseum fees halved, +1 bout per visit | your first win in a Gold-tier bout (Act II on) |
| Smith's Covenant | each shop's first forge is free; forged weapons never take wear | Wandering Smith event |
| Thief's Lantern | carriers show on the route map preview; Steal skips its speed check | the Collectors event |
| Lantern of the Road | fog maps open revealed within 4 tiles of each ally | eclipsed elite |
| Crest of the Road | every recruit rolls a Mark | event |
| Seer's Eye | fog never hides foes on your maps; a battle's preview lists its enemy classes, affixes and carriers | eclipsed elite |

### 6.2 With a twist (taken knowingly)

| Blessing | Effect | Twist |
|---|---|---|
| Second Dawn (dark) | +1 Vision each act, and +1 now | +8 shadow now; the Eclipse fills 25% faster |
| Blood Covenant | every unit, recruits included, +1 to all stats | Ill Omen never ends (+1 shadow each victory) |
| Kingmaker's Oath | promotions are free and add +2 to the class's two best stats | Master Seals can't be used: promote only at a church, with its vow |
| Hollow Sun's Favor | +50% battle gold and loot gold | Hunted until Act 3 (waves of 2) |

Fact checks from review:

- **Standard of the Sun** was drafted as "the commander's aura +1 tile". Only Edric's
  Charisma is an aura. The other lords' personal skills are Foresight (+1 tome range),
  Resolve, Renewal Aura (adjacent heal), Ride Down, Skyward and Intimidate. It is now an aura
  any commander carries.
- **Saint's Reliquary** drafted "restores staff uses". Staves already refill after every
  battle (`perBattleUses`, reset in `completeBattle`), so it now strengthens staves instead.
- **Mercenary Ledger**: the Colosseum has bout tiers (bronze, silver, gold from Act II,
  platinum from Act III), not a ladder. A first gold-tier win offers it once per run.
- **Seer's Eye**: the route map already shows a battle's objective, foe levels, fog,
  village, caravan and map, and a recruit node's recruit. It doesn't show which event an
  event node holds (picked on arrival), a shop's stock, or a battle's enemy classes, affixes
  and carriers. Seer's Eye is now a pure earned blessing over that gap, with no price.

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

**Snowball guards** (loosened in review; start light, tighten only if playtests show
runaways):
- No id twice.
- Offer weight falls gently with each earned blessing already held (1, 0.85, 0.7).
- Watch, don't cap: track runs holding two or more `growth` / `xp` tagged blessings and
  their commander-KO rate. Add a tag cap only if those runs run away.

## 7. Gifts with a catch (run start)

Cut in review: Gilded Chest (gold now, a bigger Debt later) read as a loan, not a gift.

Slay the Spire's Neow offers "a random rare relic, lose something". The analogue: from the
second run on, the start offer adds a fourth card, a gift drawn (seeded) from this list. Each
is random in what it gives and clear about what it takes.

| Gift | What you get | The catch |
|---|---|---|
| Sealed Reliquary | a random tier III blessing, no price | −1 Vision until Act 2 |
| Fallen Hoard | two random accessories from the next act's table (one may carry a skill) | Hunted for the next 3 battles |
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
- **Terms explained where they appear** (`engine/BlessingTerms.js`). A price that names a
  burden or rule (Debt, Hunted, Sworn Enemy, Ill Omen, Lingering Injury, Pact, shadow,
  Vision) gets its sentence. The burdens' sentences come from their catalog (`events.json`
  `burdens`) with the rung's numbers (Debt's garnish, Ill Omen's battles).
  - The shrine's cards are buttons, so a nested ⓘ is out. The chosen card spells its price's
    terms out in the footer in place of its lore (three lines at most). That line is itself a
    button: a tap, Enter or a click opens the whole price in a help dialog, and pressing and
    holding a priced card opens that card's. An ⓘ beside the line was tried and dropped: its
    column pushed the line to a third row, and a 375×667 phone then showed no whole card.
  - The held list in the pause menu: a price that names a term is a `<details>` that opens
    on a tap or Enter. The burden list beside it already shows what's owed.
  - Later surfaces (church and event pages, the boss pick, the Compendium, Home Base) use the
    same table, through `ui/infoAffordance.js` where the surface isn't a button.
  - A test fails if a burden in the catalog has no sentence, or a price that is a burden,
    shadow or Vision doesn't name its term.

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
   Duelist's Creed, Bloodless Art, Gambler's Toss. Built: the intrinsic price, Slow Fuse,
   Gambler's Toss, Bloodless Art, Phalanx Rite and Duelist's Creed.
4. Earned blessings: the `earned` flag, the act-boss pick, and four pure ones (Unbroken
   Banner, Second Dawn, Ember Lantern, Captain's Whistle).
5. The special church, the twisted earned blessings, the gifts with a catch, and the rest of
   §5. Built: the rest of §5 (PR D4).

## Open questions

1. Debt amounts (§3.1): playtest the tier II amount (Dusk 1,300, about 5 battles of half
   your gold). Is it felt in Act 1?
2. Gifts with a catch: offered every run from the second, or only sometimes (a ~50% chance
   per run)?
3. Should earned blessings ever be offered in a shop, as Slay the Spire's shop relics are, or
   only won?
4. Cut cards (Armory Stash): keep the id at weight 0 forever, or retire it through a
   `RETIRED_BLESSINGS` migration like `RETIRED_UPGRADES`?
