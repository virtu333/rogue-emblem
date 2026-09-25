# Strategy layer — proposals (measured, not built)

Status: proposal (2026-09-25). Companion to [`strategy-layer.md`](strategy-layer.md),
which covers what shipped (recruit previews, elite recruit fights, spawn safety, the
recruit beacon, blessing pacts). Numbers come from `sim/strategy.js`; the method and its
limits are in the spec's "How the numbers were measured". Commander-KO rates are the
share of battles in which the commander fell (casual-mode runs), ±3 points of noise.

## 1. What makes the recruit route dominant

Three measurements, all current code (elite recruit fights on):

| Measure | Result |
|---|---|
| One more unit, act 1 early (3 of 4 slots) | commander-KO battles 20.7% → 10% (**−11**) |
| One more unit, act 2 / act 3 (slots mostly full) | 0 to −3 |
| +2 levels on everyone, act 2 | −11 to −13 |
| A weapon tier up for everyone, act 1 early / act 2 | −9 / −3 to −9 |
| The recruit-node fight (+1 foe, one affixed captain), acts 1–2 | **+12 to +17** |
| Recruit-first vs battle-first route, end of act 2 | roster 6.7 vs 5.0; empty deploy slots 0.5 vs 1.2; commander-KO battles 45% vs 54% |

Recruits are worth most while deploy slots are empty (act 1, early act 2). A route that
takes 1–2 recruit nodes per act fills them a node or two sooner than any other route, and
that compounds (more units share XP and kills, the commander is exposed less). After the
slots are full, a recruit is depth: it matters for permadeath, not for the next fight.
The elite fight now charges for the unit up front — act 1 recruit-first and battle-first
routes are level (18.3% vs 17.5%) — and act 2 is where the premium remains.

## 2. Guaranteed mid-act joins ("a couple of glup shittos")

**Measured:** `--muster 4`: after the 4th node of acts 1 and 2 an unseasoned recruit from
the act's pool joins for free (Edric-anchored level, full growth range, no trait
guarantee), on every route. 20 runs per policy:

| Policy | A1 cmdrKO | A2 cmdrKO | A3 cmdrKO | Roster end A2 | Empty slots A2 |
|---|---|---|---|---|---|
| recruit-first | 18.3 → 12.7 | 45.0 → 35.8 | 55.6 → 62.1 | 6.7 → 8.4 | 0.5 → 0.0 |
| battle-first | 17.5 → 15.8 | 53.5 → 44.5 | 58.3 → 69.7 | 5.0 → 6.8 | 1.2 → 0.3 |
| church-first | 17.8 → 19.6 | 49.6 → 49.1 | 70.6 → 70.5 | 5.2 → 7.0 | 1.2 → 0.3 |

(Act-3 rows move within noise; the agent's act 3 is dominated by promotion timing.)

**Reading:** free joins raise every route's floor by about one filled slot, but the
recruit route's act-2 lead over the battle route is unchanged (8.5 → 8.7 points): it
gets the free join too. Guaranteed joins answer "my army is too small", not "I must
always route recruits". They also cost variety (the same body every run) and remove a
decision.

**Alternatives considered:**

| Option | Effect on the recruit premium | Cost |
|---|---|---|
| A. Guaranteed joins at mid act 1 and 2 | none (above) | homogenises runs, less agency |
| B. **Muster camp node** (below): a choice of two previewed, unseasoned recruits *or* supplies, one per act in acts 1–2, placed on the rows the recruit nodes are not | fills a slot for routes that skipped recruits, and costs a service slot, so the recruit route gains least | a new node type (engine exists: `buildRecruitNodeUnit(..., { seasoned: false })`) |
| C. Short-handed spoils: +25% battle gold and XP per empty deploy slot | converts empty slots into catch-up | invisible, gameable (deploy fewer on purpose) |
| D. Colosseum mercs more often in act 1 | slots fillable for gold | gold is scarce in act 1 (end of act 1 ≈ 2.5k G) |
| E. Village rescue: some villages add a caged recruit you must reach | recruit value spread over more node types | fights get busier |

**Recommendation: B (Muster camp), not A.** It gives non-recruit routes the slot they
lack, it is a choice with a visible preview (Player A's second ask), and it cannot be
stacked by the recruit route because it sits on service rows. Build it on the recruit
preview machinery: one knot per act in acts 1–2, row 3–5, never adjacent to a recruit
knot; offers two unseasoned recruits (class, level, traits shown) or a supply crate
(3 Vulneraries + 500 G). Eclipse: it falls to "Abandoned camp" (supplies only). Deeds:
none.

## 3. New node types

Six designs, each with its rule, risk, reward and interaction with the Eclipse and
Deeds. All reuse existing engine pieces; none needs new art beyond a node medallion.

### 3.1 Muster camp (see §2)

- **Rule:** choose one of two previewed recruits (unseasoned) or supplies. Once per act,
  acts 1–2.
- **Risk:** none in the node; the cost is the route slot.
- **Reward:** fills a deploy slot for a route that skipped recruit nodes.
- **Eclipse:** falls to *Abandoned camp* (supplies only).

### 3.2 Wayside shrine (mid-run blessing)

- **Rule:** two tier 2–4 blessings with their prices (pacts included); take one or leave.
  One per act from act 2. (Improvement-opportunities #7; the engine and cost pools exist.)
- **Risk:** the price. Pacts make the good ones a real decision.
- **Reward:** blessings go from 1 per run to ~3–4.
- **Eclipse:** at Umbral+ the shrine offers only pacted blessings ("the dark bargains").
  An eclipsed shrine becomes an elite fight whose spoils include one pact-free blessing.
- **Deeds:** none.

### 3.3 Prisoner convoy (a moving recruit)

- **Rule:** an escape-style map in reverse: a guarded wagon carries a seasoned recruit
  (preview shown) toward the far edge at 2 tiles a turn; reach it with a lord and Talk
  before it leaves (turn 6–8).
- **Risk:** a clock you must chase; the escort is 1 captain + the act's pool.
- **Reward:** a seasoned recruit with a promotion roll one act early (act 2 → act-3 pool).
- **Eclipse:** the wagon starts one tile further per phase above Pale.
- **Deeds:** a lord who makes the Talk under fire could earn *the Lord's Shield*; a new
  battle deed *Who Broke the Chains* (rescued a convoy) fits the epithet grammar.

### 3.4 Bounty (a named hunt)

- **Rule:** one named elite (two affixes, a legendary-tier weapon, a name and a line of
  lore) on a small map with a few guards; rout objective, the bounty must fall.
- **Risk:** the hardest single fight of the act outside the boss.
- **Reward:** 1.5× gold, the bounty's weapon (usable), an accessory roll.
- **Eclipse:** eclipsed battle knots can become bounties instead of generic elites.
- **Deeds:** *Giantslayer* and *Bane of {boss}* already key on bosses; let bounties count,
  so the epithet names the bounty.

### 3.5 Smithy (forge services, including an honest deforge)

- **Rule:** forge at −20% price, deforge for a refund (the ForgeSystem refund already
  exists), move one imbue to another weapon for 800 G, repair one staff's uses.
- **Risk:** none; a gold sink competing with the shop.
- **Reward:** gives the forge economy a place on the map (today forging lives in the
  convoy menu with no route decision attached).
- **Eclipse:** a *cold forge* (eclipsed) forges one weapon +2 for free but the weapon
  gains the *Ashen* flag (−5 hit) — the dark's bargain in miniature.
- **Deeds:** *{weapon}* (Weapon Sworn) epithets gain weight if a unit keeps a
  smithed weapon.

### 3.6 Scriptorium (arts for blood)

- **Rule:** buy one act-appropriate weapon-art scroll at half price, or learn an art
  directly by paying its HP cost ×3 from the unit's **max HP until the next act**.
- **Risk:** a weaker unit for the rest of the act.
- **Reward:** arts without the shop's 2500–3000 G.
- **Eclipse:** an eclipsed scriptorium offers act+1 arts, blood price only.
- **Deeds:** none directly; ties Scroll Archive's pact theme into the map.

### 3.7 Watchtower (information)

- **Rule:** reveal the next two rows: every recruit preview, every template name, fog
  flags, elite loot. The next battle starts without fog.
- **Risk:** +2 shadow (the Eclipse advances while you climb).
- **Reward:** planning; directly serves "let you see who the guy is".
- **Eclipse:** the reveal also shows each node's fall countdown.

### 3.8 Ossuary (a darker revive)

- **Rule:** revive a fallen unit for free, but they return *Haunted*: growths −10 until
  the next act and they cannot be healed by staves in their first battle.
- **Risk:** a weak unit for an act.
- **Reward:** permadeath without gold (the church revive costs 300 G per level).
- **Eclipse:** at Totality the ossuary is the only revive left on the map (churches fall).
- **Deeds:** *Who Would Not Fall* is a natural title for a unit revived twice.

## 4. An early church

`route` (church-first vs other policies) shows what a church gives today: act 1 **0.8
visits restoring 14 HP** (39% of the army's HP was missing), no revives, no promotions
(nobody is level 10 yet). The Kindle (Eclipse) costs 400 G in act 1 for 8 shadow. The
church-first route is no safer than battle-first in act 1 (17.8% vs 17.5%) and worse in
act 3. In act 1 a church is a free heal the player rarely needs.

Options (all church-only, so the node earns its spawn weight early):

| Option | Rule | Early value | Late value |
|---|---|---|---|
| **Acolyte** | Hire a novice Cleric (act 1) or Troubadour/Cleric (act 2) at the weakest squad member's level, 600 / 900 G, once per church | fills a slot *and* adds healing (the thing act-1 armies lack) | falls off, as intended |
| **Absolution** | Lift a blessing's *rolled* price for 1000 G × tier − 1 (pacts cannot be lifted: they are the deal) | turns a bad roll into a gold decision | same |
| **Vigil** | Lords start the next battle *Warded* (+2 DEF/RES for two turns), 200 G | real in act 1, where commander KOs are 18% of battles | small |
| Last rites (price) | Revive in act 1 at half price | rarely used: nobody has fallen yet | — |

**Recommendation: Acolyte + Absolution.** Acolyte is the cheapest fix for "my army is
too small and cannot heal" and gives non-recruit routes a paid way to fill a slot
(complementing the Muster camp). Absolution makes the church the place where blessing
prices are negotiated, which ties the two systems together. Both reuse existing engine
pieces (`buildRecruitNodeUnit`, `activeBlessings[i].rolledCost`). Expected effect from
`unitvalue`: a filled act-1 slot is worth about −11 points of commander-KO battles.

## 5. Other outliers found

- The tier-4 price **"+35% forge costs"** measures as ±0 and the sim never forges; for a
  real player it is small next to "−30% battle gold" or "personal skills disabled until
  Act 3". Consider moving it to tier 3 and pricing tier 4 with something felt (e.g.
  "Staff healing −35%", or "Recruits join −1 level").
- **Scholar's Vow** (tier 2, +5 all growths) measures between −4 and +1 points of
  commander KO across three seed sets and +4 to +48 squad points by act 3: a solid tier 2,
  and the reference the reworked Tome now sits near.
- The agent cannot measure XP, forge, heal or art prices (they read as 0); a playtest
  pass on those prices is the next step.
