# The roads

Draft. See `README.md` for what the marks mean.

A run is one thread: the same morning, taken down a different road. The four difficulty rungs are four roads, and each ends somewhere different. This file says what each road is in the story, what lies below the capital, and what each ending means.

## 1. Four rungs, four roads

| Rung | Acts | Ends at | In the story |
|---|---|---|---|
| First Light | I, II, III, then below | The Lieutenant, on his seat in the Glass | The army never reaches the capital. It goes down by the stair under the consecrated stones and cuts the Emperor's sight, not his head. |
| Dusk | I to IV, then below | The Lieutenant, on his seat in the Glass | The Emperor falls first. His seer has gone below to finish the work without him. |
| Nightfall | I to IV, then below | The sleeper | The Emperor falls, the Lieutenant holds the last door and falls there, and the army meets what both of them served. |
| Black Sun | I to IV, then below | The sleeper | The same road, at its worst. |

All **[in game]**: the act lists are `difficulty.json` `actsIncluded`, the two finales are `descent.json` `routeByRung`.

**Two ways down, one stair.** First Light goes down from the sacred ground: "There is a stair under the consecrated stones. The old kings went down it. So did he." The other three go down from the capital: "A stair under the throne room, older than the empire." Both join the Old Kings' Stair. **[both lines in game; that they join is new]**

**What the rung names mean.** Each rung is a later hour of the same day: how much of the sun the thread has already lost when it begins. First Light is a thread pulled early. Black Sun is the morning Sera has pulled most often. **[new]**

## 2. The surface

The regions are `data/regions.json`. **[in game]** The readings beside them are drawn from boss lore and route-map lines already in the game.

| Act | Region | Who holds it | What the army learns there |
|---|---|---|---|
| I | Border Marches | The Iron Captain, twenty years unrelieved, or the Warchief of the border clans | Both sides of the border were abandoned by their own. |
| II | Old Kingdom Roads | The Knight Commander, the Archmage who keeps the ritual's middle pages, or the Dark Rider who carries its sealed orders | The court circle is at work on the old kingdom's ground, and at least one of its own thinks it "can still be steered". |
| III | Imperial Heartland | The Blade Lord, the Iron Wall, or the Berserker King | What the Empire is proud of. On any road that goes on to Act IV, Sera has her vision of the Lieutenant in this act's boss battle. |
| IV | Ashen Frontier | The Emperor | The capital, emptied. Curfew at noon. The paving hums. |

The rule for writing these: names get more frequent the further east the army goes (see `00-canon.md` section 3).

## 3. Below: the Descent

The final act is one authored road (`data/descent.json`, `docs/specs/act-v-descent.md`). **[in game]** Its places, top to bottom:

**The Old Kings' Stair.** The first flight. Every tenth step is worn hollow where someone stopped to rest, and one step is carved WE CAME THIS FAR ALSO. **[in game]** These are the kings' own steps: each went down once, at his crowning. **[new]**

**The Mortuary Column.** A colonnade of niches, floor to vault, "all of them full, all of them labelled", with a clerk's chalk on a pillar: COUNT AGAIN, and under it in another hand, WHY. **[in game]** The game does not say whose niches they are. Proposed: this is the court's ledger in stone. Every person whose years were taken has a niche, and the keepers the army routs here are its clerks. **[new]**

**A Side Stair** and **The Landing.** Two places with no fight, where something was left to be read. One of them can hold the seers' last page. **[in game]** The game's wording of that page stands: AND WHEN THE LAST WORD IS SPOKEN, THE. The older draft's different wording is retired.

**The Vigil.** Four platforms over an abyss, four Voices of the court circle on their sigils: the Calling, the Binding, the Feeding and the Waking. They have been speaking for nine years. Each phase they stand, the Rite gains words, and their circles call up the Hollowed. **[in game]**

**The Ruins.** A fallen chapel on the stair, its altar still level. **[in game]**

**The Glass.** A long hall of mirrors, "each of them a little late", and a man at the end of it. On First Light and Dusk he sits a seat "nobody was meant to sit in" and the army takes it. On Nightfall and Black Sun he stands in front of a shut door, and it opens when he falls. **[in game]** The mirrors run late because he has spent thirty years looking at mornings before they happen. **[new]**

**The Sanctum Below.** The stone is warm and has a pulse. Carved above the last door: WHAT SLEEPS HERE WAS NOT MEANT TO BE FED. **[in game]**

## 4. The Rite

The Rite is the waking spoken aloud, counted in words. **[in game]**

- It starts higher the further the Eclipse has gone when the army starts down: 3 words under a Pale sun, up to 9 under a Hollow one.
- The Voices add to it each phase they stand in the Vigil. Winning the Mortuary Column quickly, and some choices on the way down, take words away.
- 0 to 5 words is **Broken**, 6 to 9 **Spoken**, 10 or more **Answered**. The tier changes what waits at the Glass and in the Sanctum.

In the story, the Rite is the court's half of the feeding: the call that tells the sleeper its meal is laid. A Broken Rite is an army that reached the Voices in time. **[new as a statement; the Voices' own lines support it: "The stone is laid.", "Take what we brought."]**

The Rite is also the key to the special ending (section 6).

## 5. What each ending means

| Ending | What the game says today | What it means |
|---|---|---|
| First Light: the Lieutenant | "For the first time since the visions began... I see an unwritten page." Then: "There is a harder road, and it runs to the Emperor's door." | Sera is free of his sight. The Emperor still sits. The debt is still being paid. |
| Dusk: the Emperor, then the Lieutenant | "Master and seer are gone, and still something below turns over. It is not finished." | The payments have stopped. The thing they were paying is still there, and now nobody is paying it. |
| Nightfall and Black Sun: the sleeper | "It's going back to sleep. The cycle is broken." | It sleeps. She believes the cycle is broken. It is not. **[the last sentence is sealed]** |

All three quoted endings are **[in game]**. Proposed change **[new]**: Sera's line at the sleeper's fall should change with the number of times the save has seen it, from certainty to doubt, so that the special ending is prepared in every player.

## 6. The special ending (on hold)

Design lives in `reviews/ascension-true-ending.md` in the project files ("The Last Thread") and in the story direction proposal. In brief, and all **[new, sealed]**:

- A Black Sun win at high Heat with the Rite Broken does not end at the sleeper's fall. One more map follows: the Loom.
- Sera must reach the knot while the army holds the sleeper off. Each rewind on this map costs a path.
- At the knot the player chooses: weave again, or let it be morning.
- Letting it be morning costs Sera her sight. The fallen of that thread stay fallen. The sun comes up whole.

Nothing in the game may state the premise of this ending until it is built.
