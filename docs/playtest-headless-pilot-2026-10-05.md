# Headless playtest pilot — 2026-10-05

The first run played through headless play (`tools/play`). An agent played seed 7 on
First Light (`normal`), no invincibility. It used only the CLI, wrote a note for each
decision, and never used `auto`.

**Outcome:**

- **Act 1:** cleared with no losses. The boss (the Iron Captain) fell on turn 7 of
  par 9. Perrin (archer) and Astrid (lord) were recruited, and Voss was taken as the
  boss recruit.
- **Act 2:** three of four battles won. Sera fell in the third, when the agent moved
  Gaspar out of the wall that shielded her. It stopped on turn 12 of the elite seize
  `act2_3_2`. Edric was down to 7 HP, an elite Knight (DEF 18, 9 HP left) was
  almost immune to the all-physical army, and the boss enraged that turn.

**Effort:** 304 game commands, about 160 queries, 11 refusals and 9 notes, from about
250 CLI calls in about 35 minutes. Each call answered in about 0.3 s, so the agent's
thinking was the limit, not the game. The whole 304-command game replays in about
0.5 s.

## Reading this report (review, 2026-10-06)

This was a test of the adapter as much as of the game. Its game observations are
hypotheses. The raw record and a replayable copy are in `docs/playtests/2026-10-05-seed7/`.

- **The run was stopped, not lost.** The agent stopped mid-battle with Edric alive.
  The adapter of the day also lacked rules that shaped the game:
  - Gaspar's Measured Step.
  - Vision rewinds. The run ended holding **two unused charges**, either of which could
    have undone Sera's fall.
  - Binding weapon-art scrolls (`teach` refused them).
  - In-battle trade, Canto and fog ambushes.

  All of these are modelled now.
- **Armour answers exist; this route offered none.** The data has these answers:
  - Mailbane: a sword, ×3 against armour, in the Act 1 and Act 2 pools. Edric, Gaspar
    and Voss could all wield it.
  - Hammer: an axe in the Act 2 pool. Shops only stock weapon types the army can use,
    so it appears only once someone wields axes; here that was Cael, recruited where
    Sera fell.
  - Thunderbrand: a magic sword, Act 3 and later.

  None of the route's shops offered an armour answer: two Act 1 shops (the second one
  restocked once) and an Act 2 caravan. Nor did any of its nine spoils.
  `docs/playtests/2026-10-05-seed7/shop-odds.mjs` measures how unusual that was. It
  replays the pilot and, at each shop, redraws the stock from exactly what it was
  drawn from: the army as it stood, the shop's count bonus, and the names stocked by
  earlier shops, which a shop avoids repeating.
  - Each Act 1 shop stocked an anti-armour weapon about 40% of the time (41.5% and
    39.9%). The caravan did 7.5% of the time.
  - Drawn in order, each shop's history taken from the shops drawn before it, **36.5%**
    of draws of these three shops stock none. This holds the army and the path fixed,
    and it does not draw the restock.

  An earlier figure here, "roughly a 16% event", multiplied three Act 1 shops as if
  they were independent. The shops are not independent (they avoid repeating each
  other's stock), and the third inventory was a caravan's. Missing an armour answer on
  this route is common, about one run in three.

  The "forced" elite was chosen two rows earlier. `act2_1_1` led only to the recruit
  node and then the elite. `act2_1_3` led to ordinary battles (`act2_2_4`, `act2_3_3`).

  So the question is not whether the game has counters. It is whether a counter shows
  up often enough, is recognisable early enough, and can be wielded by the army at
  hand. That calls for a look at offer variance and composition, not a new weapon.
- **Gaspar's low growth is by design.** He is a fixed special character: low growths,
  no further promotion or reclass, Measured Step. "Gains little XP" is a finding only
  if he stops pulling his weight earlier than intended. The pilot played him without
  his Measured Step.
- **Scroll spoils were judged without the means to use them.** Weapon-art scrolls could
  not be bound. "Gold + XP is almost always best" should be re-tested now that every
  offer can be used.
- **The Danger overlay shows possible reach, not intent.** A boss holding its throne is
  still a boss that could move. Any fix is to explain what Danger means, not to shrink
  it to predicted behaviour.

## What the forks showed (2026-10-06)

Two agents forked this run with the current adapter (Vision, Canto, Measured Step,
art binding and trade all modelled), each from a decision the pilot got wrong. Their
whole records are in `docs/playtests/2026-10-05-seed7/forks/`.

| Fork | From | Outcome |
|---|---|---|
| `elite` | Command 251: the elite seize `act2_3_2`, entered with Sera already fallen. | Won the elite in 8 turns (par 11) **with no permanent losses, using one Vision to undo a lethal outcome** (Cael's death). Then won the rest of Act 2, including the act boss in 8 turns (par 10), and revived Sera. Stopped voluntarily at the start of Act 3. |
| `sera` | Command 243: the last order before Sera fell in `act2_2_1`. | Kept Sera alive with one Vision. Won the elite in 7 turns (par 11), using a second Vision after a missed 82% shot. Cleared Act 2 and three Act 3 battles with nobody lost. Stopped at 520 commands on its call budget (`stop timeout`), with 1 charge left. |

A fork made by an informed agent proves a line exists. It does not measure how hard
the battle is to win at the first attempt. These results bound the pilot's claims; they
do not replace them with a difficulty estimate.

- **The elite was not an armour wall. The pilot misread its objective.**
  - The `elite` fork's army had no magic and no anti-armour weapon: Edric, Gaspar,
    Perrin, Voss and Cael, all physical.
  - It won by never fighting the DEF 18 Knight. A seize needs only the boss dead (a
    mage with DEF 4) and a lord on the throne. The Knight's MOV is 3, so the fork kept
    every unit out of its reach and baited the boss.
  - The pilot had spent its turns trying to kill the Knight.
  - The working hypothesis is now **objective comprehension and recovery literacy**
    (using Vision), ahead of armour stats.
  - The adapter now states each objective's whole rule in its text and its JSON
    (`objectiveRule`): "No other enemy need fall." The game's own words are "Defeat the
    boss, then capture the throne with a Lord" on the deploy screen. Whether the game
    should also say that the rest may live is a design decision.
- **With a mage, armour is easy.** Knights and Great Knights have RES 2–3.
  - Sera's Crownlight did 19×2 to the elite Knight, and Lucan did 24×2 to a Great
    Knight.
  - Physical attacks did 0–5.
  - Armorbane on a bow did 10×2 to the Knight but 1 to a Great Knight.

  So surviving armour leans on keeping a mage alive, which is exactly what the pilot
  lost.
- **Cael's death came from overriding Danger, not from trusting it.** The `elite`
  fork's command trace:
  1. Turn 5: Cael waited at 5,5 as bait. `threat 5,5` listed the boss, but reaching
     5,5 meant coming 4 tiles off the throne, and the boss stayed.
  2. Turn 6: from that one refusal, the agent noted "treat him as stationary".
  3. Turn 7: the agent wrote "treat as static guards (range only)". It moved Cael to
     9,6, 3 tiles from the throne, without asking `threat` about that tile.
  4. The boss stepped 1 tile off the throne and doubled Cael (19 + 19 against 30 HP).
     The agent spent a Vision charge, and baited the boss instead with Voss, whom the
     boss could not double.

  The AI's rule is in `AIController`: a boss on a seize map moves only to tiles within
  1 of its throne, until turn pressure enrages it. Danger drew the boss's whole reach,
  and 9,6 was in it. The agent generalised from a 4-tile non-move to "never moves".
  The game does not tell the player this rule; its help says "the boss guarding it".
  Saying so in-game is a design decision. The adapter keeps Danger as reach, and says
  what that means wherever it shows it, the JSON included (`dangerMeaning`).
- **Seize bosses can be baited.** A sturdy unit standing just inside a boss's reach
  (its range, plus the one tile it may step off the throne) draws it out. Both forks
  won all four of their Act 2 seize-boss fights this way: the elite and the act boss
  in each. The `sera` agent found it "flat, or
  exploitable".
- **Promoted units' kill XP falls off a cliff. This is the formula, not a bug.**
  - `getXpEffectiveLevel` counts a promoted unit as 12 levels higher.
  - `calculateCombatXP` pays 40 for a kill at equal effective level, 25 at 3 levels of
    advantage, 9 at 4, and 1 from 5 on. Those figures include the kill bonus, halved
    at 4 to 6 and gone from 7.
  - A newly promoted Lv1 unit therefore counts as Lv13. The `sera` fork saw it earn 1
    XP for a Lv8 Soldier, about 11 for a Lv9 Thief, and about 38 for a promoted Lv1
    Duelist.
  - Gaspar's "1 XP per kill" in the pilot is the same rule.

  Whether a fall from 25 to 1 across two levels is intended is a balance question.
- **Act 2 is hard through numbers and positioning more than stats.** The `sera`
  agent waited out the first turn in 3 of 4 Act 2 battles before striking first.
  Damage came only from a misread reach.
- **Gold piles up.** The `sera` fork held 12,775 G by the middle of Act 3, with thin
  shops to spend it in. That is a hypothesis from one run.

## The game, as the player saw it

- **Act 1 felt well tuned.** Chokepoints, the weapon triangle and "lure them in, then
  gang up" all mattered. The boss guarding its throne could be beaten once drawn off.
- **Spoils:** gold plus team XP was almost always the best pick, and item spoils rarely
  competed with it.
- **Act 2 is a big step.** Enemies are level 5–8, with affixes, three mages, a mage
  boss and a DEF 18 elite Knight. Once Sera (the army's only magic) fell, armoured
  units were nearly unkillable. There was no way to add a magic answer mid-run: the
  revive costs 2,600 G at a church several nodes away. A Hammer-type weapon, or a
  buyable tome for another class, would ease this.
- **A promoted Gaspar barely gains XP:** about 1 per kill, and still level 2 in
  Act 2.
- **Level-ups were often a single stat.** Lord growths of 45–65% felt stingy.
- **The real threat is speed.** Thieves and myrmidons that double the fragile units
  were the danger. Walling Sera and Perrin into corners worked until the player broke
  the formation.
- **Meaningful decisions:** route (recruit nodes against shops), the blessing, Mentor's
  Band against gold, and deploy picks.
- **Felt flat:** weapon-art and skill scrolls with no unit to use them, and forging
  (+1 or +2 might was fine, but it doesn't show in the shop list).
- **The Danger overlay overstates a boss that never leaves its throne.** It draws the
  boss's full movement reach (MOV 7), but the AI only engaged units within about two
  tiles. The adapter shows what the game shows; the player can't tell a guard from a
  chaser. (The forks found the rule: one tile off the throne, then its range. See
  "What the forks showed".)
- **A completed first battle shows "Fog" on the Loom.** `describeLoomNode` hides fog on
  the first battle only while `completedBattles` is 0. After that battle, its node keeps
  the generator's fog flag, which the battle never used (`RunManager.getBattleParams`
  ignores fog on a run's first battle). This is a small Loom bug in the game itself.

## Adapter friction, and what changed

| Pilot finding | Change |
|---|---|
| A refused query mid-chain dropped commands that had already played and printed. | The CLI saves whatever ran before a refusal and names the commands that did not run (`PlayCli.test.js`). |
| A trailing `end` skipped the next turn after the last unit's action had already ended the phase. | The adapter now says "Every unit has acted: the player phase ends." An `end` straight after that is refused; `end again` skips on purpose (`PlaySession.test.js`). |
| The shop renumbers after each purchase, so a Shortbow went to a lance user. | `buy <name> for <unit>` works. Buying a weapon its holder can't equip prints a note. |
| Venomous damage was unexplained ("hits 7" but 21→9). | The combat line names the cause ("Edric lost 5 more than the strikes dealt (Soldier's Venomous)"), and forecasts list both sides' affixes. |
| Enemy heals weren't reported. | The harness now passes the AI's `onHeal`, and the event log reports the heal. |
| `roster` in battle showed the pre-battle army. | It now says so ("look" shows the battle). |
| Danger digits drawn on walls; fog read as safe. | Danger shows `#` on impassable tiles and `?` in fog. |
| `forecast` accepted a tile the unit can't reach. | The forecast says so. |
| `options` was long and cut off the only melee tile. | One line per weapon, from that weapon's safest tile, followed by every other tile it can strike from with its danger. |
| XP lines showed wrong "before" values. | Each line now shows the values at that grant. |
| Par changed mid-battle with no explanation. | "Par is now N (was M): reinforcements raise it." |
| A recruit kept its NPC id. | It becomes the next P id, and the old id still works. |
| Scavenge, `take` and `use` didn't match the README or failed: `take 2 convoy`, and `use` on a convoy item. | The README is fixed; `take <n> <unit>` works without `to`; `use` works on convoy items. |
| The convoy listed items with no description, and scroll text carried UI-only directions. | Items are described; UI-only text is gone. |

The pilot also found a harness gap. An enemy walled in by temporary terrain chose to
break the wall (`AIController` emits `onBreak`), but `HeadlessBattle` didn't handle the
callback, so the wall stayed. The harness now clears it as
`BattleScene.executeEnemyBreak` does (`HeadlessBattleItemEquip.test.js`).
