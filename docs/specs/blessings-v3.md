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
- Fix the free re-roll: the offered run's seed is kept for each save slot until that slot's
  run begins, so backing out, opening another slot's shrine in between, or reloading the page
  shows the same offer (and the same gift, §7.1). As built (PR D5): the slot's localStorage key
  `emblem_rogue_slot_<n>_pendingSeed` holds `{ seed, runsStarted }` (`utils/pendingRunSeed.js`;
  the game registry holds it when storage refuses), read as none once the save's run count has
  moved (a run began since), cleared when the run begins and when the slot is deleted.

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
  taken back with every battle delta. A recruit who joins mid-battle (Talk: a recruit node's, an
  event's `battle.recruit`) is a mounted unit or a foot soldier too, so it takes its own as it
  joins, by the same rule (`ShrineBoons.unitMoveTypeBattleDeltas`, which the start reads per roster
  unit): `BattleRecruits.settleRecruitJoin`, the one join both the scene's Talk and the harness's
  call, gives the recruit its run identity first and then applies `engine/BattleJoinBoons.js`
  (`applyBattleJoinBoons`), as battle deltas (`_battleDeltas`), so the victory's
  `clearBattleScopedDeltas` takes them back and the roster unit keeps its own stats. Each landed
  battle-start source is recorded on the unit (`_battleDeltaSources`, dropped with the deltas and
  by `serializeUnit`), so a unit already carrying Cavalier's Hour is never given it twice. A
  suspend keeps both on the checkpoint's units and a resume joins nobody again; a Vision rewind to
  before the Talk puts the recruit back without them, and the Talk again gives them once. A
  Lingering Injury is one named unit's and never a joiner's (`tests/BattleJoinBoons.test.js`).
- **A joiner and the act's stat cards** (`act_stat_delta_all_units`: Rally Cry, the "−1 / −2 DEF to
  all units in Act 1" prices, Armory Stash's catch). They are permanent stats until the act ends,
  not battle deltas, so a joiner takes them through `RunManager.grantRecruitBlessingConsumables`
  (`_applyActStatDeltasToRecruit`) and the tracker lists its uid for the act's end. Whether the
  unit holds one is read from the unit (`recruitBlessingGrants` gains
  `actStatDeltaGrantKey(tracker, index)`), never from the tracker alone: the tracker is run state
  a battle checkpoint does not hold, so after a Vision rewind to before a Talk it still lists the
  recruit's uid while the recruit stands without the delta, and the Talk again must give it once
  (or the act's end would take back what it never had). A uid the tracker lists for a unit already
  in the roster or the fallen is held. A tracker from before holders were tracked reverts the
  whole roster at the act's end, so a joiner takes it too.
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

### 6.4 As built: the act-boss pick and the first four

Slice 4 of §9 ships the `earned` flag, the act boss's pick and the four pure blessings Unbroken
Banner, Second Dawn, Ember Lantern and Captain's Whistle. The other sources (eclipsed elites,
the special church, events) and the twisted blessings wait for slice 5.

**Data.** An earned row has `earned: true` and no `tier`, `prices` or `pact`; its `costs` are
empty and its `weight` is its draw weight among the earned blessings. `earnedOffer`
(`{ actBoss: 2, weightByHeld: [1, 0.85, 0.7] }`) sets how many cards an act boss offers and the
snowball guard. Earned blessings never reach a start offer, a church vow or an event grant;
`addBlessingMidRun(id, { earned: true })` is their only way in. The contract version stays 3
(the flag is additive). The pause list and the Compendium say "Earned" where a tier would be.

**When a pick is owed.** Every act boss but the one that ends the run, in a real run:

| Rung | Acts | Bosses that offer a pick |
|---|---|---|
| First Light | act1-3, then the Lieutenant | Acts I-III |
| Dusk | act1-4 | Acts I-III (the Emperor ends the run) |
| Nightfall, Black Sun | act1-4, then the Entity | Acts I-IV |

Never the prologue (Varro), an elite, an event fight or a seize map's elite captain: the
predicate is `isActBossVictory` (the node is the act's `bossNodeId` and a `boss` node), the one
`completeBattle` already reads for the boss's Vision.

**The roll** (`engine/EarnedBlessings.js`, pure). `RunManager.completeBattle` prepares the pick at
the victory commit, so it is in the victory's own save. It draws from its own stream
(`earned-pick:<run seed>:<act>`), never `Math.random`, so the battle and node-map streams never
move. The first draw is the odds roll (decision D4: the chance the boss offers anything at all
is 1, 0.85 or 0.7 as the run holds 0, 1 or 2+ earned blessings; one function,
`earnedOfferChance`). It is always spent, so the pair does not depend on the odds. Then two
unheld cards are drawn by weight. A miss, or nothing left to offer, is stored as `none`. The
ledger `run.earnedBlessingPicks` keeps one entry per act (`offered`, `status: owed | taken |
skipped | none`, `chosen`). An act with an entry is never rolled again: a reload shows the same
pair, and a pick taken or skipped is never offered again. A save from before the feature,
sitting between a boss and the act advance, is prepared on the route map from the same seed
(the same pair).

**When it is shown.** After the boss's reward, its recruit and the third lord, and before
`advanceAct`, on both paths. A blessing taken there belongs to the act just won: Second Dawn's
act-start grant (`_payActStartGrants`) is stamped with that act and pays from the next one.

- The battle scene: `PostCombatController.transitionAfterBattle`, after the rewards are claimed.
  A kept contract's reward owed at the boss goes to the route map first, act unadvanced (the
  map's order below). A pick that cannot be shown (no document, an error) goes to the route map
  with the act unadvanced. The post-loot fallback holds while it is open
  (`scene._earnedPickActive`, cleared on close, on scene shutdown and in `BattleScene.init`), and
  its clock (8 s, or 30 s while story input is locked) starts again when the pick closes, so the
  act card and story that follow are never cut off. A save the device refuses says so (a minor
  hint); the act advance's save tries again.
- The route map, after a reload or rewards left with View map: `NodeMapScene.checkActComplete`,
  in the order rewards, contract reward, pick, Act Complete, advance. `_maybeOpenEarnedPick` is
  single-flight and never opens over a finished run: the scene's finalize chain also opens an owed
  pick (one left from an earlier act too). A pick the map could not open because the Roster, the
  pause menu or Settings stood in front of it is tried again when that closes
  (`_retryOwedEarnedPick`, through `checkActComplete` when the act is complete, so a contract
  reward owed at the boss still comes first). A node tap also opens an owed pick when nothing
  holds it; with a contract reward owed where the party stands, the tap opens that page instead.
  A save the device refuses says so (`saveServiceRun`'s warning, a minor hint).

The act never advances over an owed pick on either path. (The sims leave an owed pick through
`skipEarnedBlessing` before they call `advanceAct`, so their ledgers stay whole and they measure
no earned blessing yet; the debug overlay's advance leaves it owed, and the route map offers it.)

**The menu** (`ui/EarnedBlessingPick.js`, `ui/earnedBlessingPickModel.js`). A modal "An earned
blessing" with the two cards as the shrine draws them (`choiceCards.blessingTarotCard`, shared
with `RunSetupMenu`). An earned card has a gold rim and a star in the Hollow Sun: a clipped CSS
shape sized from the sun, because Cinzel has no star glyph. Its foot reads "Earned: No cost:
won, never bought". The footer shows the chosen card's lore, or its terms when the boon names
Vision. Take stays disabled until a card is chosen. Skip, Escape and a controller's Cancel all
open the same confirmation ("Leave them?": Leave them / Back), so a stray Escape never skips;
Pause is swallowed. A busy guard makes Take one-shot, and the engine refuses a second take
anyway. The take or skip is saved before anything follows: the battle's run save
(`_persistBattleRunState`), or `saveServiceRun` on the route map. Upright, the cards are rows
like every draft.

**The battle effects** (`engine/BattleBlessings.js`; the battle's state is
`{ lastStand, firstKillHeal, firstTurnMov, spent }`, and its spent list rides the suspend
checkpoint and the Vision rewind):

- **Unbroken Banner.** `UnitHealth.absorbLethal(unit, hp, { blessings })`: Miracle first, then a
  Revival Stone, then the banner, which holds a player unit (never an NPC ally or a foe) at
  1 HP once per battle. A hold ends the exchange, like a broken stone (Adept and Aether bonus
  strikes included). Every floor-0 damage path passes it: strikes, area and line arts, rams,
  Deathburst, the ballista and the Entity's splash. Decision D5, as built: a held unit cannot
  fall again in this combat (its post-combat effects take it no lower than 1 HP, and a floor-1
  poison number shows only what the bar lost). Status and debuff effects (an imbue's status,
  Grievous, Corrosive, Intimidate, an art's status or debuff) still land, as after a broken
  stone. A later death trigger is not covered: a Deathburst raised by a fall meets the banner
  already spent and can fell the unit. The forecast reads "1 HP (Unbroken Banner)", and its
  teaching hint never calls a held counter lethal.
- **Ember Lantern.** The army's first combat kill heals the killer 10 HP (`healUnit`, so a Wounded
  killer heals nothing). It is spent even at 0 healed (decision D6). Counter-kills and the
  unit's own area and ram kills count; a stone's refilled bar, Deathburst, terrain and poison
  do not.
- **Captain's Whistle.** A turn-1 timed MOV buff from the turn-start pipeline (decision D8). It
  keeps the strongest per stat, so it does not stack with Mark of the Road, and a resumed turn 1
  keeps it without applying it again. "Every unit has +1 Move on turn 1": a recruit who joins on
  turn 1 (Talk) takes the same keyed buff as it joins (`engine/BattleJoinBoons.js`), ending with
  the army's as turn 1's enemy phase starts; a join on a later turn takes nothing.
- **Second Dawn.** A `{ kind: 'vision' }` act-start grant: +1 Vision at every act start while held,
  never on the take.

### 6.5 As built: the other sources and six more cards (PR D1)

PR D1 ships the eclipsed elite's drop, the Old Sanctum, an event's grant and six pure cards:
Standard of the Sun, Hollow Hourglass, Chronicle, Tithe Box, Lantern of the Road and Crest of the
Road. The twisted cards, the Colosseum's card, the rest of §6.1 and the start gifts come later.

**Sources are data.** Every earned row names `sources: [{ kind, acts? }]` (kinds `act_boss`,
`eclipsed_elite`, `sanctum`, `colosseum`, `event`; `acts` limits a source to some acts), and may
carry a `twist` (`{ label, effects }`, a twisted card's price, offered by an act boss only) and
`requires` (`{ eclipse }`). The validator refuses an earned row without sources and these fields
on any other row. A twist's effects come from a small explicit list (`BlessingEngine.TWIST_EFFECT_TYPES`:
a burden, shadow, Vision, XP, shop and forge prices), never a price fixed to an act
(`act_stat_delta_all_units`, `act_deploy_cap_delta`, `act_hit_bonus`,
`disable_personal_skills_until_act`: a twist is taken mid-run); D3 extends the list with its own
types. Whether a twist's burden can be lifted by the Cleanse vow is D3's decision (§6.6: never). PR C's cards were re-sourced: Second Dawn is an eclipsed elite's (as §6.1's table
says), Unbroken Banner, Ember Lantern and Captain's Whistle stay act bosses'. Standard of the Sun is
Act I's boss's and Chronicle Act II's, so an act boss's pair for a given seed differs from PR C's.

**One ledger, keyed** (`engine/EarnedBlessings.js`, version 2). An act boss keeps its act key and
PR C's entry shape; the others file under `elite:<node>`, `sanctum:<node>`, `event:<node>` and
`colosseum`. Take and skip go by ledger key (`ledgerKeyOf`). `open` is the sanctum's status: never
owed, so the route map never asks about a sanctum the party walked past. Each source draws from
`earnedPoolFor(run, kind)` (earned, weight above 0, unheld, `excludes` either way, `requires` met,
won from that kind and act), on its own stream keyed by the run seed and the source's node, so no
other stream moves. A pair holds at most one twisted card (D-3). The PR C odds (1 / 0.85 / 0.7)
stay on the act boss only. An owed or open offer never shows a card the run holds: when a card
joins the run (a take, an event's grant) it leaves every other owed or open offer, and one left
empty is `none` (`pruneHeldOffers`; a load does the same). The Colosseum's offer files `none` when
no card is left, so it is never rolled again.

**The eclipsed elite's drop** (D-4, D-7). At the victory commit of a battle node the Eclipse took
(`node.battleParams.isEclipsed`; never a Dark Omen's event fight, an ordinary elite or the
prologue), `completeBattle` rolls a flat third (`earnedOffer.eclipsedEliteChance` 0.3333) for one
pure `eclipsed_elite` card (Second Dawn, Hollow Hourglass, Lantern of the Road), on
`earned-elite:<seed>:<node>` (the chance draw always spent). Owed, or `none`. It is offered by the
route map host PR C built (`NodeMapScene._maybeOpenEarnedPick`): on arrival from the battle, after
the loot screen (its `onComplete` now ends with the pick), an event's spoils and a contract reward,
before the caravan; a page that held the map closing on it (a contract's Continue) opens it too.
A node tap opens it instead of travelling on. The menu shows one card ("Won
from an eclipsed elite. Take it, or leave it."; Skip asks "Leave it?"). No new BattleScene flow.
A save from before PR D1 gets no drop for an elite already won.

**The Old Sanctum** (D-5, D-6). From the run's second act each act's map may hold one:
`RunManager.advanceAct` calls `_stampSanctum` right after Pilgrim's Road's shops
(`engine/SanctumPass.js`): two draws on `sanctum:<seed>:<act>` (the chance, `earnedOffer.sanctum.chance`
0.5, always spent; then one of the act's unfinished, un-eclipsed churches sorted by id). The node
gains `sanctum: true` and the map `sanctumRolled: true`; never on load (an old save gets one from
its next act), never in Act I, the run's last act (the final boss's act, or Dusk's Act IV: the
act boss's pick follows the same rule) or the prologue. Pilgrim's Road never turns it into a shop
and a route edit (the Cartographer, A Bad Map) never redraws it (`RouteEdit.isRedrawable`; a
rebuilt node drops the flag); the Eclipse may take it like any church (then it is a battle). The route map calls it
"Old sanctum" (label SANCTUM in gilt, the inspect line "An old sanctum: its vow offers an earned
blessing.", which follows it once settled: "its vow gave you an earned blessing", "its vow is
made", "no earned blessing is left on its altar"; `ChurchVow.sanctumStatus`). When its door first opens (`ChurchController.handleChurch`) `openSanctum` rolls its
pair on `earned-sanctum:<seed>:<node>`: up to two `sanctum` cards, filled from the pure act-boss and
eclipsed-elite cards, saved at once. The menu is titled "Old Sanctum"; its blessing section reads
"Earned blessing · Free" and lists the pair (`Name · description · Earned`) **in place of** the tier
I offers, behind the same confirmation; the take is the church's vow (`ChurchVow.takeSanctumBlessing`).
Leaving keeps the pair open; re-entering shows it again; after the take the altar "has already
blessed you". With nothing left to offer the entry is `none` and the tier I offers return.

**The Tithe Box** pays 200 gold the first time the party enters each church of an act
(`engine/ChurchTithe.js`, `run.churchTitheByNodeId`, saved, reset in `advanceAct`), never the Ruins.
Taken at a sanctum it pays that church at once. The church's status line says so.

**An event's grant** (D-9). The effect `earnedBlessing { id }` grants a named earned card whose
sources include `event` (`EarnedBlessings.grantEarnedBlessing`, a `taken` entry under
`event:<node>`, the node's key when the caller names none); strict in a choice ("You already
carry it."), skipped with a note in a won fight's spoils. The requirement `earnedAvailable: <id>`
greys a choice once the card is held; the validator requires it on a choice whose own outcome
grants a card. A grant rolled back with its step (a later step failing) leaves no ledger entry,
so Try again grants it. Old Faces'
`ride` gains Crest of the Road in its spoils. The result line is "Earned blessing: Crest of the
Road". The Wandering Smith's covenant and the Collectors' lantern wait for their cards (PR D2,
§6.7).

**The six cards.**

| Card | Source | Boon | Where it acts |
|---|---|---|---|
| Standard of the Sun | Act I boss | `commander_aura { radius: 2, hitBonus: 5, avoidBonus: 5 }` | `BlessingCombatMods` (scene and harness): a player unit within 2 tiles (Manhattan) of the living commander (the unit flagged `isCommander`; one who escaped takes the banner along), never the commander, an NPC or a foe |
| Hollow Hourglass | eclipsed elite | `reinforcement_delay { value: 1 }` | `battleParams.reinforcementDelay` (saved with the battle): every wave, template, scripted, pursuit, ladder and Hunted, a turn later, added after the turn-1 clamp (a wave Black Sun pulls to turn 1 comes on turn 2); the ladder's line names the new turn; the template validator reads the delay against the hybrid arenas' walls |
| Chronicle | Act II boss | `xp_per_act_cleared { value: 0.05 }` | `getXpMultiplierDelta` adds 5% × `actIndex` (the acts cleared); never the arena |
| Tithe Box | Old Sanctum | `church_entry_gold { value: 200 }` | `payChurchTithe`, once a church |
| Lantern of the Road | eclipsed elite | `fog_opening_reveal { radius: 4 }` | `battleParams.fogOpeningRadius`: at a fresh fog battle's start, `engine/FogOpening.js` reveals radius 4 around each unit as a contact (turn 1 only, saved with the fog, never applied again on a resume) |
| Crest of the Road | event (Old Faces) | `recruit_mark_chance { value: 1 }` | `getEffectiveMetaEffects().markChance`, read by every recruit source (recruit node, event join, boss recruit, mercenary, Vanguard Cadre); the Mark stream keeps its two draws |

Each new boon type has a handler (`engine/EarnedBoons.js`), a validator rule, the handler-coverage
walk and no place on the event-safe list. The sims never take an earned card (D-25): they skip owed
picks after every node, and their event policies leave a choice that grants one alone unless
`eventPolicy: 'earned'`.

### 6.6 As built: the twisted cards (PR D3)

PR D3 ships §6.2's four twisted cards. Each is an act boss's card only (`sources: [{ kind:
'act_boss' }]`, weight 0.6, so a twisted card shows up in a pair a little less often than a pure
one), at most one to a pair (D-3, PR D1's rule), and taken knowingly: its `twist` (`{ label,
effects }`) is applied after its boons (`addBlessingMidRun`'s `price`, kind `twist`) and held as
its price, so the pause list reads "Twist: ..." and a load never charges it again. The pick's
footer explains the twist's words too (Hunted, Ill Omen, shadow), with the twist's own numbers for
a burden that does not count down (`BlessingTerms` reads the price's effects).

| Card | Boon | Twist |
|---|---|---|
| Darkened Dawn (§6.2's "Second Dawn (dark)") | `vision_delta { 1 }` now and `act_start_vision_delta { 1 }` (a `vision` act-start grant from the next act) | `eclipse_shadow_delta { 8 }` and `eclipse_gain_multiplier_delta { 0.25 }` |
| Blood Covenant | `army_stat_bonus { 1 }` | `burden { id: 'ill_omen', permanent: true, extraShadow: 1 }` |
| Kingmaker's Oath | `kingmaker_promotion { bonus: 2, stats: 2 }` | `master_seals_forbidden {}` |
| Hollow Sun's Favor (tag `gold`) | `battle_gold_multiplier_delta { 0.5 }` and `loot_gold_multiplier_delta { 0.5 }` | `burden { id: 'hunted', actsAhead: 1, wave: { turn: 3, count: [2, 2], xpMultiplier: 0.5 } }` |

The new effect types live in `engine/TwistedBoons.js` (one parser per type for the validator, the
handler and the save's sanitizer; a malformed set is refused by `npm run validate:data` and skipped
as `invalid_<type>_params`; none is on the event-safe list). `TWIST_EFFECT_TYPES` gains the two twist
types.

- **Darkened Dawn** `excludes: ['second_dawn']` (either way: neither is offered while the other is
  held, and an owed or open offer already drawn drops the one the other shuts: `takeableOffered`
  and `pruneHeldOffers`, after every take and on load) and `requires: { eclipse: true }` (with the Eclipse off its twist costs nothing). Each
  victory's shadow gain (`computeShadowGain`, after its per-battle cap) grows by the share in exact
  quarters: `extra = floor((gain × quarters + carry) / 4)`, the remainder carried
  (`blessingRuntimeModifiers.eclipseGainDelta`, `eclipseGainCarry` 0-3, saved and written at every
  commit, 0 included, so a remainder spent is never paid twice), so four victories of 1 gather 5. `TwistedBoons.scaledShadowGain` is the one reading: the HUD's
  `projectShadowGain` and the victory's `_commitBattleShadow` both call `_scaledShadowGain`, so the
  projection is the commit. An Ill Omen's shadow is added after, unscaled. The commit record names
  the card's share (`blessingShadow`). The +8 shifts the act's start too (as every
  `eclipse_shadow_delta`), so nothing falls on the take.
- **Blood Covenant** `requires: { eclipse: true }`. +1 to every stat but Move (`XP_STAT_NAMES`), once
  per unit (`unit.recruitBlessingGrants` gains `blood_covenant:army_stat_bonus`): the roster and the
  fallen at the take, every later joiner through `grantRecruitBlessingConsumables` (recruit nodes,
  event joins, boss recruits, mercenaries, a Talk recruit, the third lord), and a revival checks
  again (`_grantHeldArmyStatBonuses`). A living unit's HP gain raises its current HP through
  `UnitHealth.setUnitHP`; a fallen unit's does not (a revival sets it). The key makes a reload, a
  second call and a revival a no-op. Its Ill Omen is `permanent`: +1 shadow every victory, never
  counted down. An event's Ill Omen (the Twin Altar's dark face: +2 for the rung's battles), or a
  shrine price's, taken before or after it, is held in the same record as its `event` part (see
  "A twist's burden and a passing one" below).
- **Kingmaker's Oath**: `ChurchCommands.churchPromoteCost(unit, run)` is 0 while held (the church
  heading reads "Promote · Free (Kingmaker's Oath)"); after `promoteUnit`, `promoteAtChurch` adds
  +2 to the two stats with the highest values in the target class's canonical
  `promotionBonuses` (a lord's own bonuses only when the class has none), ties in the order HP, STR,
  MAG, SKL, SPD, DEF, RES, LCK, never Move or a stat the class does not raise (D-13). The promotion
  is still the church's vow. Its twist: `TwistedBoons.classChangeItemBlock(run, item)` refuses a
  Master Seal (a `promote` consumable) on every path: the roster sheet's bag and convoy cards
  (`RosterCommands.rosterClassChangeBlock`, which `applyRosterClassChange` and the desktop overlay
  read), the battle's Promote command and item menu (`BattleScene.getPromotionConsumable`; the row
  names the ban) and the promotion itself (`PromotionController._executePromotion`, for a seal
  handed in directly). The reclass seals (Infantry Seal, Mounted Seal) are never caught.
  `tests/MasterSealBanBoundary.test.js` lists every file that reads a `promote` consumable with its
  gate; `RosterCommands.rosterClassChangeBlock` reads the run's ban before a special character's
  own refusal. Shops still sell Master Seals and loot still offers them (the twist is taken
  knowingly; filtering them from a draw would move the loot stream), marked: the shop's buy row and
  the loot card read "Can't be used: Kingmaker's Oath" (`TwistedBoons.classChangeItemTag`, from
  `classChangeItemBlock`). The church's path chooser and the rite show the +2 the altar adds:
  `promotionPathContent(unit, cls, gameData, { churchRun })` applies `applyKingmakerBonus` to its
  projection exactly as `promoteAtChurch` does (ChurchMenu hands the run to the chooser and to the
  rite's content; a Master Seal's or a battle's path passes none).
- **Hollow Sun's Favor**: +50% battle gold (`getBattleGoldMultiplier`, additive with the other gold
  boons, before a Debt garnishes) and +50% on gold loot cards: `rewardDrawParams` saves
  `lootGoldMultiplier` in the reward's `draw` (absent without the card, so every other draw and
  every older record is unchanged), and `rollBattleRewardChoices` applies it after the late-pressure
  multiplier, so a Branching Threads reroll pays the same and a card rolled before the take is not
  raised. Its Hunted runs "through the next act" (D-11): `actsAhead: 1` resolves at the take to
  `untilAct = actSequence[actIndex + 2]` (taken at Act I's boss: all of Act II, ending as Act III
  begins), or `permanent` when the run has no such act. It never counts down; `advanceAct` (and a
  load, once the act sequence is final) ends it as its act begins (`Burdens.expireActBurdens`). An
  event's Hunted meeting it is the record's `event` part (below). The chips read "Never ends" and
  "Until Act III" (the act card's own names, `utils/actNames.js` `actLabel`: "Until Final Act",
  "until the Final Act begins"); merged, "Never ends; +2 for 3 more battles" and "Until Act III;
  2 more battles". The held list reads the live record: once the act has begun it says the hunt has
  ended.

**A twist's burden and a passing one (review fix).** One record per burden id still holds, in two
parts. The **twist part** is the record's own fields: `permanent` or `untilAct`, the twist's own
`extraShadow` or `wave`, and `battles: 0`; never cleansable. The **event part** is `event`:
`{ battles, extraShadow }` for an Ill Omen, `{ battles, wave }` for a Hunted, the countdown's own
values (an event's, or a shrine price's), counted down exactly as it would be alone (every victory
for an omen; a victory in a battle that carried the wave for a hunt) and dropped when spent; a
countdown taken again refreshes it by the countdown's own rule. While the event part lasts the
record acts with the larger of the two: an omen's shadow per victory is `max(twist, event)`
(`Burdens.illOmenShadowOf`, which `burdenEffectsOnVictory` and the HUD projection read), a hunt's
wave the bigger one (`huntedWaveFor`, `largerHuntedWave`: more foes at most, then at least, then
the earlier turn). After it, only the twist's values. Both orders of taking them make the same
record (`addBurden` puts a held countdown into `event` when the twist arrives, and an arriving
countdown into `event` when the twist is held). A Hollow Sun span that ends with the event part
still counting leaves it a plain record. The sanitizer reads the part back; a spent or malformed
part is dropped, a plain record never carries one, and a save without one reads as before. The
event's result line, the chips and the pick say both parts: the result reads the merged record
("never ends: +1 shadow each victory, +2 for 3 more battles while a passing omen lasts ..."), and
the earned pick's terms say what the twist merges with when the run already carries the countdown
("You carry a passing Ill Omen (+2, 3 more battles): it keeps its own count, and until it ends each
victory takes the larger."). An event choice never shows its burden before it is made (its outcomes
are hidden, docs/specs/event-nodes.md), so the twist-first order is told by the result line.

**The cleansing decision (owner-level, decided in D3): a twist's burden is never cleansable.** A
twist is the price of a strong earned card, taken knowingly; a free church vow lifting it would
make the card free. One rule, `Burdens.isCleansable`: a burden that never ends or ends with an act
(`isTwistBurden`: `permanent` or `untilAct`) is refused like Debt; the church's Cleanse is not
offered for it, its refusal says "A twisted blessing's price: no altar lifts it.", and the church
menu lists it greyed whenever the run holds one, even when nothing else can be lifted. Only a twist
may write those fields: the validator refuses `permanent` / `actsAhead` / `untilAct` on a shrine
price (a v3 catalog price, a v2 rolled cost, an object pact) or an event's burden. An event's own
Hunted or Ill Omen stays cleansable, alone or as a twist record's event part: Cleanse
(`Burdens.cleanseBurden`) lifts that part only, exactly as it would lift it alone, and the twist's
part stays (the church's row names the part it lifts, "Ill Omen · 3 left", beside the greyed
"Ill Omen · Never ends").

The sims never take an earned pick, so `sim:fullrun:pr` is unchanged.

### 6.7 As built: the rest of the pure cards (PR D2)

PR D2 ships the five remaining pure cards of §6.1, the Colosseum's source and the two event edits
D1 left waiting. Each card's boon has a parser, a handler and a load default in
`engine/EarnedBoons.js` (validator rule, `invalid_<type>_params` skip, handler-coverage walk, never
on the event-safe list), like D1's.

| Card | Source | Boons | Where it acts |
|---|---|---|---|
| Saint's Reliquary | Old Sanctum | `staff_heal_range_bonus { heal: 5, range: 1 }` | `StaffBlessings.staffRunOptions(run, unit)` (a player unit's only): `healBonus` is added to the staff's output before the heal multiplier (Combat.calculateStaffHealOutput), `rangeBonus` to its longest reach (getEffectiveStaffRange), a Warp's radius and a Rescue's pull included; uses unchanged |
| Mercenary Ledger | Colosseum | `arena_terms { feeMultiplier: 0.5, visitBouts: 1 }` | `ColosseumEngine.arenaEntryFee(tier, run)` (the fee the tiers and the forecast show, the bout pays, a win or a draw hands back and a loss forfeits) and `arenaVisitCap` (read live: a Ledger taken mid-visit opens its bout at once) |
| Smith's Covenant | event: the Wandering Smith's `covenant` | `shop_first_forge_free { value: 1 }` + `weapons_never_wear { value: 1 }` | Smith's Mark's free forge (two cards, two free forges); `EventEffects.planWear` is empty, so a `wear`'s fallback stands in (the botched temper: "the sparks find the hand") |
| Thief's Lantern | event: the Collectors' `fight` spoils | `route_scout { level: 'carriers' }` + `carrier_luck { stealIgnoresSpeed: true }` | the route preview lists the foes that carry items; a player thief's Steal skips its speed check (Cutpurse's Luck's waiver, `stealRunOptions`; never a foe's) |
| Seer's Eye | eclipsed elite | `route_scout { level: 'foes' }` + `foes_shown { value: 1 }` | the route preview lists every foe with its affixes and what it carries; fog never hides a foe on its maps |

**Decisions as built.**
- **Smith's Covenant covers every weapon.** A forged weapon already never wears
  (`WeaponWear.wearBlock`), so "forged weapons never take wear" would do nothing: the boon keeps
  every weapon the army carries from an event's wear. An item granted already worn stays as it is.
- **The Colosseum's offer** (D-8): the run's first win in a gold or platinum bout
  (`EarnedBlessings.colosseumOfferDue`; gold opens in Act II) rolls `prepareColosseumOffer` inside
  the bout's settlement, so the offer is in the bout's own save; once a run (taken, skipped or
  empty, never rolled again; never the prologue). The colosseum's menu opens the one-card pick
  (`ColosseumOverlay._openOwedEarnedPick`, the same `EarnedBlessingPick`, saved by the service
  save) in place of its menu, which comes back after Take or Leave it. A pick still owed when the
  party leaves (or an Escape closed the colosseum) is the route map's, like an elite's drop.
- **The Wandering Smith's covenant** costs `{ base: 150, perAct: 100 }` gold, sits before Leave and
  requires `earnedAvailable: smiths_covenant`. Outcomes roll per choice (`choiceSeedKey`), so the
  new choice moves no other choice's outcome; the sims never take it (D-25).
- **The Collectors' fight** appends `earnedBlessing: thiefs_lantern` to its `afterVictory` (a held
  card is skipped with a note; the strongbox still pays).

**Seer's Eye in battle.** `RunManager.getBattleParams` writes `battleParams.foesShown` while the
card is held (saved with the battle, so a resume keeps it); BattleScene and the harness call
`BattleInformation.markFoesShown(grid, battleParams)` as they build the grid. **One rule** then
answers "does the player see this unit" for every presentation and preview reader:
`BattleInformation.isUnitTileSeen(grid, unit, col, row)` (a tile of its body: no fog, the player's
own, a foe under the Eye, else the tile's sight), `isUnitSeenAt(grid, unit, col?, row?)` (its body
standing there, an Entity's 3×3 footprint) and `canInspectUnit` (where it stands, plus the waiting
recruit). Nothing else reads `grid.foesShown`, and no reader in `src/ui` or `src/scenes` decides a
unit's visibility from a tile's sight alone (`tests/SeersEyeReaders.test.js` holds both, with an
allowlist of tile reads that are never a foe's: terrain, the ballista, the prologue, the caravan's
last tile, zombie remains as ground). So the Eye reaches, with the same words: the sprites
(`updateEnemyVisibility`), attack targets, inspection, PlayerKnowledge's previews (Danger, the blue
range, Threat Sight), the fog ambush (a shown foe never ambushes), the heal and staff banners, the
enemy's walk (drawn in full: `animateEnemyMove` asks `isUnitSeenAt` at each step), the boss bar
(never concealed), the history and the timeline (names, walks, and the history viewer's board:
`battleTimelinePreview` reads the saved fog through `savedFogView` with the live grid's Eye), the
Necromancer's raise and crumble, a Zombie's remains (a fall in the fog is a fall the player saw:
its pile keeps its marker and countdown, and its rise has its banner) and an area art's aim (a
fogged body tile counts). The fog's teaching hint waits for a map whose fog hides foes
(`fogHidesFoes`), so a later run without the Eye still learns it. The terrain stays fogged, a
green caravan stays hidden, and the enemy AI never reads the fog. Each reader has a paired test
(the same fogged foe, the Eye on and off): without the Eye every reader behaves as before.

**The route preview's scout** (D-21, `engine/BattleScout.js`). For a battle, boss or recruit node
still ahead (a `live` or `future` node on the loom, never where the party stands, a cut road or a
walked node), while Thief's Lantern or Seer's Eye is held, the route map's card shows a panel:
the scout's name, what it assumed ("Scouted for N in the field.", or "The map is set: these foes
wait here." for a locked node) and the foes, alike ones (class, level, affixes, what they carry)
counted together, the boss first by its name ("Boss · Warchief, Fighter Lv 7"; the Entity's name
is never told), then by class and level (the Lantern: the carriers alone, no affixes). The Eye
also says what arrives later: "More arrive: N waves of reinforcements." (the map's template,
scripted, ladder and Hunted waves, `reinforcementsOf`), or that pursuers keep coming on an escape
map; the turns are not told (jitter and the rung's offsets make them the battle's). It **never
locks the node**: a locked node is exempt from
the Eclipse's falls (`nodeFallExemption` 'locked'), so locking what it showed would change the
Eclipse for every holder. A node not yet locked is generated as the battle will generate it:
`getBattleParams(node)` (copied: the params share the run's used-name ledger, which a recruit
battle's generation writes to), `applyGenerationFields` (the deploy count and the boss flag),
`battleGenerationSeed` and `generateSeededBattle` (Math.random is a stream of the battle's seed for
the generation only, and is put back even on a throw), the same four calls BattleScene.beginBattle
makes. The deploy count is the deploy screen's (the roster up to the act's cap and bonus, never
past a lock's spawns; the act's limits are `BattleDeployCount.deployLimitsForParams`, which the
scene reads too). The result is cached in memory by everything the map is generated from (never
saved). A locked node is read as stored. What can differ from the fight is only its inputs: fewer
units deployed than assumed, or the run changing before arrival (the Eclipse's phase, a burden).
The scout writes nothing to the run: getBattleParams's battle-entry preparation of the roster
(duplicate names repaired and tracked, uids, portrait variants) runs on a view of the run whose
roster, fallen and used-name ledger are copies (`scoutParams`), so the params are the battle's own
and the live roster is untouched.

**Smaller fixes in review.** The roster's trade pane says a staff's "MAG+N" and range with the
Reliquary counted (`Combat.getStaffHealBase`, the rule the heal itself reads, and
`getEffectiveStaffRange`); the colosseum's "Requires N gold." names the Ledger's fee; the
Wandering Smith's intro offers his three jobs ("One job a customer").

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
| Marked Blade | a Silver weapon with a random imbue for the commander | Sworn Enemy on the Act 1 boss |
| Pilgrim's Wager | a random tier IV blessing, its pact waived | +15 shadow now; one Act 1 node falls at once |
| Armory Stash | three random whetstones in the convoy | −2 DEF all units, Act 1 |

### 7.1 As built (PR D5)

**Data.** The gifts are a top-level `gifts` block in `data/blessings.json`, never rows of `blessings[]`:
a gift is never a held blessing and takes no icon cell (each borrows an atlas icon for its card:
`generic-blessing`, `generic-accessory`, `generic-art-scroll`, `silver-sword`,
`gamblers-coin`, `blessing-armory_stash`; a gift wears another blessing's own cell only when it
`replaces` that blessing). `offer: { fromRunsStarted: 1, chance: 0.5 }`
(the owner's call on open question 2: about half the runs, from the save's second). Each gift has a
`grant` and a `catch` (`{ label, prices | effects }`); the validator (`BlessingEngine.validateGifts`)
holds text to 90/85 characters, refuses a Debt catch (a gift is not a loan), requires the Eclipse for a
catch of shadow or a fall, holds each catch effect to its costly sign (`GIFT_CATCH_SIGNS`: a positive
Vision delta is a boon), a `prices` catch's label to the catalog labels it names, a weapon grant's tier
to `GIFT_WEAPON_TIERS` and a scrolls grant to its `artScrollAct`, and lets a gift share a blessing's name only when it `replaces` a blessing
out of the offer (the Armory Stash, whose tier IV card stays at weight 0 with no migration: open
question 4).

| Gift | As built | Catch as built |
|---|---|---|
| Sealed Reliquary | a random tier III card (never earned, never one whose boon is its price: Gambler's Toss, Lone Banner; weight above 0, unheld), held with no price but the catch | −1 Vision charge now (`vision_down`) |
| Fallen Hoard | two different accessories from the next act's table (`accessoryPoolFor(run, 1)`); the first that can bear a skill (a legendary never does, so a legendary first pick passes it on) binds one at 50% on the gift's stream (`bindAccessorySkill`'s `chance`), the other never | Hunted for the next 3 battles |
| Stranger's Scroll | two different weapon-art scrolls the lords can learn, of arts that unlock by Act II (`grant.artScrollAct`; the `starting_scroll` handler with `maxUnlockAct` and `distinct`), and one Act II skill scroll, to the team scrolls | Lingering Injury on the commander for 5 battles (the stat from the run seed) |
| Marked Blade | a Silver weapon of the commander's best proficiency (Mastery first; never a staff or a personal weapon), with a random imbue, in their bag (else the convoy) | Sworn Enemy on the Act 1 boss (it ends at the first boss victory) |
| Pilgrim's Wager | a random tier IV card, its pact waived (`addBlessingMidRun`'s `waivePact`) | +15 shadow; one Act 1 node falls now (any node the Eclipse could take: never the start, the boss or the Ruins; a recruit node can fall, as it can to the Eclipse), made by `eclipseNode` with `RunManager._eclipseNodeContext()`, the Eclipse's own terms; offered only with the Eclipse on |
| Armory Stash | three whetstone forges on the lords' combat weapons (the `starting_whetstones` handler: whetstones never enter a bag or the convoy) | −2 DEF to all units in Act 1 |

**Streams.** `startRun({ runsStarted })` rolls the offer: one draw on `gift-offer:<seed>` (always
spent), then a weighted pick on `gift-pick:<seed>` among the gifts this run can take (its `requires`, a
grant that hands something out, a catch that costs something: no Reliquary without a Vision charge, no
Wager with the Eclipse off). What a gift holds is rolled at the take on `gift:<seed>:<id>`, inside a
seeded `Math.random` swap (the handlers it reuses draw on their own keys, hashed from the run seed and
`gift:<id>`). The shrine's blessing offer, the node map, the roster and `Math.random` are the same for
a seed whether or not a gift is offered or taken. The prologue, the sims and the dev routes start runs
with no count, so they are never offered one.

**The take.** `RunManager.chooseStartGift(id)` (`engine/StartGifts.js`) is planned first: the
eligibility check runs again before anything is chosen (something to draw, room for it: a weapon's bag
or convoy slot; a blessing gift's every card addable with its catch as the price,
`RunManager.canAddBlessingMidRun`; a catch that costs something; nodes left to fall), so a refusal
leaves the run exactly as it was. It then takes no blessing (the selection is recorded as skipped,
with a `gift` history event), applies the grant and the catch once and saves `run.startGift`
(`{ id, granted, catchLabel, fell? }`). A grant that still comes up empty past the plan returns
`{ ok: false, reason: 'grant_failed', dirty: true }` and records no gift; the shrine rolls any failed
or throwing take back (`_rollbackBlessingCommit`: the run rebuilt from the slot's seed, the same
cards and gift offered again). It is refused once anything was chosen at the shrine (a saved
selection record included), and asking again for the gift taken changes nothing. A load reads
`startGift` and applies nothing. A blessing gift holds its catch as the card's price (kind `gift`:
the held list reads "Catch: ..."); any other gift leads the pause list with its own entry ("Fallen
Hoard · Gift": "Gave: ..." and its catch beneath with the catch's live state read from the burden
record, "Hunted: 2 battles left", then "Hunted: ended"; the terms on a tap). Analytics count a gift run
as a gift (`runsWithGift`, per-gift offers, picks and outcomes), never as a skipped blessing, and a
card a gift handed out as that card's `giftGrants`, never a pick. A burden catch (the Fallen Hoard's
Hunted, Stranger's Scroll's Lingering Injury, Marked Blade's Sworn Enemy) is an ordinary burden, as an
event's: a twisted card's Hunted taken later (§6.6) merges with it as the record's `event` part, counted
down and lifted by Cleanse exactly as it would be alone, and the pause entry reads that part (the
twist's own span is the twisted card's).

**The shrine.** The gift is the fourth card, after the blessings and before No blessing (still the last
choice): the shrine's tarot card with `data-tier="gift"`, the dark's violet rim, its icon in the Hollow
Sun and its foot named "Catch". The footer always says what the chosen gift gives ("Gives: ..."), then
spells out the catch's terms (a Lingering Injury's sentence reads the catch's own five battles; a count
belongs to its own clause, never the next price after a "·"); a blessing's boon is said there too while
its card clips its lines (`RunSetupMenu.watchLeadBoon`). On a short landscape phone (568×320, `max-height:
340px`) four cards take a compact layout (choice.css: the sun beside the name, the boon a row that keeps
two lines and scrolls, the cost inside the card); three cards keep theirs. The canvas fallback (no DOM
host) compacts four cards the same way so they fit above Skip. Touch, the arrows and a controller reach
it like any card. Backing out or reloading keeps the slot's pending seed (§3.2), so the same gift
returns; a failed start rebuilds a fresh run (the gift is offered again, nothing it gave remains) and
the save counts the run only once it begins. A dev-routes-only `?runSeed=` (`devRoutesEnabled`, as
`?devScene=`) fixes the offered run for the browser specs (`start-gift.spec.js`, run-flow, with a
568×320 case; `portrait-start-gift.spec.js`, portrait: on 375×667 every chosen or focused card is whole
in view).

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
   Banner, Second Dawn, Ember Lantern, Captain's Whistle). Built (§6.4).
5. The special church, the twisted earned blessings, the gifts with a catch, and the rest of
   §5. Built: the rest of §5 (PR D4), the Old Sanctum and six earned cards (PR D1, §6.5), the
   twisted cards (PR D3, §6.6), the rest of the pure cards and the Colosseum's source (PR D2,
   §6.7), the gifts with a catch (PR D5, §7.1).

## Open questions

1. Debt amounts (§3.1): playtest the tier II amount (Dusk 1,300, about 5 battles of half
   your gold). Is it felt in Act 1?
2. Gifts with a catch: offered every run from the second, or only sometimes (a ~50% chance
   per run)? Decided: about half the runs, from the second (§7.1).
3. Should earned blessings ever be offered in a shop, as Slay the Spire's shop relics are, or
   only won?
4. Cut cards (Armory Stash): keep the id at weight 0 forever, or retire it through a
   `RETIRED_BLESSINGS` migration like `RETIRED_UPGRADES`? Decided: weight 0 forever, no migration (§7.1).
