# Lord recruit odds v2

Lords are the strongest units in a run, and a fully upgraded save collected nearly all of
them: on Nightfall with Hero's Call III and Power of Friendship, a player steering toward the
recruit cards that show a lord entered Act IV with all seven lords in 63% of runs
(`npm run sim:lords`, 1000 runs a profile, every battle won, nobody falls). v2 makes a fourth or
fifth lord a strong run, a sixth exceptional and a seventh rare, without a cap.

## The rule (`engine/LordRecruitChance.js`, pure)

- Chance = (base + Hero's Call) x the lord-count multiplier. Base: recruit node 15%, boss
  draft 25% (`constants.js`). Hero's Call is +5% a tier (was +8%).
- Multiplier by the lords the run has had (`countRunLords`: the army and the fallen or laid
  to rest, each name once, so a death never makes the next lord likelier): 2-3 lords x1,
  4 x0.5, 5 x0.25, 6 x0.1 (`LORD_COUNT_MULTIPLIERS`).
- Both rolls read it: `RecruitNodeSystem.planRecruitNodeSpawn` and
  `BossRecruitSystem.generateBossRecruitCandidates` (option `lordOdds`).

## Which count each roll reads

- **A recruit node** reads the lords at the act's start (`run.lordRecruitOdds.lordsAtActStart`,
  stamped by `startRun` and `advanceAct`) plus every recruit node ahead of it on the act's map
  (row, then column) that shows a lord, visited or not (`RunManager._recruitLordWalk`, the walk
  the lord claims already use). So the act's second lord card is rarer than its first, and no
  choice the player makes (taking a lord, losing one, the Power of Friendship arrival) ever
  changes a card already on the map.
- **The boss draft** reads the lords the run has had when it is rolled
  (`getLordRecruitOdds('boss')`); the draft is rolled once and saved, so a reload keeps it.
- Power of Friendship's arrival is untouched.

## Hidden recruits

A recruit node's route card names who waits there (name, class, stats, traits, "a lord") only
once the node is a next step or the party stands on it (`loomModel.RECRUIT_SHOWN_STATES`:
`live`, `current`; `recruitShownAt`). Further down the road, and on a road cut off, the card
says "A potential ally" and "Someone waits here. You will see who when it is your next step."
and `LoomPanels.renderLoomCard` does not build the unit. Nothing in the engine changes: the
unit is fixed per node as before, so a card shows the same recruit once it comes into view, and
an old save's previews read the same. Open Roll's second candidate shows with the first. Dave's
call (2026-10-15), on top of the odds, to stop routing a whole act toward the lord cards; the
sim's `near` policy (a lord seen only one step ahead) measured it.

## Old saves

`run.lordRecruitOdds = { v: 2, lordsAtActStart }`, saved (`RUN_FORMAT_FIELDS.run`: inert; an
older client rolls the flat chance). A run saved before v2 has no record and keeps the flat
chance, and its meta effects (Hero's Call's old +8%) were snapshotted at its start, so an
update never takes away a lord a route card already shows. `sanitizeLordRecruitOdds` reads only
a whole v2 record. The prologue rolls no lord (`null`).

## Measured (`npm run sim:lords`, Nightfall, 1000 runs a profile)

Seven lords entering Act IV (end of Act III), Hero's Call III + Power of Friendship:

| Route player | Before | v2 |
|---|---|---|
| Random route | 21% | 1% |
| Goes for recruit nodes | 50% | 6% |
| Goes for lord cards | 63% | 8% |

No Hero's Call, no Power of Friendship: 1% before, 0% after; mean lords after Act III 3.8 vs
3.6. Hiding which recruit card holds a lord (the "recruit nodes" row against "lord cards") was
measured as the other lever: 63% to 50% alone, because most lords come from simply visiting
recruit nodes and from boss drafts, whose lord is always shown.

Tests: `tests/LordRecruitChance.test.js`.
