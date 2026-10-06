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

  The route's three Act 1 shop inventories, the Act 2 caravan and the nine spoils
  offered no armour answer. A Monte Carlo of shop generation for this army puts
  Mailbane in about 45% of Act 1 shops and 24% of Act 2 shops. That makes "none in
  three Act 1 inventories" roughly a 16% event.

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
  chaser.
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
