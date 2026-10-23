# Achievements — spec draft (2026-10-17)

Status: approved by Dave 2026-10-17 05:01Z (bragging only, cosmetic rewards maybe later; shared across all slots; 69 is the right size; secrets stay hidden; app-store achievements scoped later). Building. Thread: "Achievements".

## What it is

Steam-style achievements: a fixed list of named feats, each with an icon, a one-line rule
and a tier. Some come naturally on a first few runs; some take a dedicated attempt; a few
are for the very best players. A small card slides in when one unlocks, and a new
**Achievements** tab in Records lists them all.

How they differ from Deeds: a Deed belongs to a unit inside one run and gives it a title.
An Achievement belongs to the player, lasts forever and never changes play. Several
achievements simply point at Deeds ("earn your first epithet", "earn every Deed").

## Principles

1. **Bragging only.** No Valor, no items, no unlocks. An achievement never makes the
   player play worse to get it (the Deeds rule). Proposed exception for Dave to decide:
   cosmetic only (a frame on the slot card or a title-screen banner at 100%).
2. **Earned only at commit points.** Battle feats are judged at the victory commit
   (`RunManager.completeBattle` / `PostCombatController.onVictory`), run feats at run end
   (`recordRunEnd`), Home Base feats at the purchase. A Vision rewind or Continue from Map
   can therefore never award one and then take it back. The card appears right after the
   commit (on the victory band or the route map), never mid-combat.
3. **Pure engine module.** `engine/Achievements.js` (pure): the catalog lives in
   `data/achievements.json`; `evaluateAchievements(event, context)` returns newly met ids.
   Scene and harness both call it, so the sims can report unlock rates per rung.
   RNG-free (never `Math.random`).
4. **Player-wide, not per slot.** Stored in each slot's meta (`achievements: { <id>:
   { at, slot } }`, grow-only, unioned on the local adopt and the cloud merge through
   `MetaProgressionManager._commit`) and mirrored into a device-wide key
   (`emblem_rogue_achievements`) so deleting a slot never loses one. Records shows the
   union, as the Compendium does. Older builds keep the unknown key (#368).
5. **Lifetime counters** for progress achievements (kills, steals, events seen) go in the
   same field (`achievementStats`), counted at the victory commit only.
6. **Retroactive.** On first load, award what the save already proves (milestones,
   `storyFlags.bossSlain`, victory records, deeds earned, lords met, prologue state)
   silently, with one note: "12 achievements recognised from your past runs."
7. **Not in the prologue's teaching**, except the prologue's own achievement, shown after
   its ending.
8. **Stable ids** so they can map to Game Center / Google Play Games later.

## Tiers

| Tier | Meaning | Rim |
|---|---|---|
| Bronze | Comes naturally in the first runs | bronze |
| Silver | Takes commitment or a deliberate try | silver |
| Gold | Hard: a strong run or a real plan | gold |
| Black Sun | Very hard, few players will see it | black with a violet eclipse ring |

**Secret** achievements show as "???" with their tier until earned (the Compendium's
locked look), except the count.

## The list (69)

### The March (progress)
| Name | Rule | Tier |
|---|---|---|
| Banner at Dawn | Finish the Prologue | Bronze |
| First Blood | Win a battle in a real run | Bronze |
| Past the First Gate | Defeat an Act I boss | Bronze |
| Deeper Roads | Reach Act III | Bronze |
| First Light | Win a run on First Light | Silver |
| Down the Stair | Reach the Descent (Act V) | Silver |
| Into the Dusk | Win a run on Dusk | Gold |
| The Glass Breaks | Defeat the Lieutenant at the Descent's gate | Gold |
| The Sleeper Falls | Defeat the Entity | Gold |
| Black Sun | Win a run on Black Sun | Black Sun |
| Every Rung | Win on all four difficulties | Black Sun |
| Kingslayer's Ledger | Slay all 11 bosses at least once (0/11) | Gold |
| Who Rides Again | Bring a veteran into an NG+ run | Gold |

### The Field (battle feats, judged at victory)
| Name | Rule | Tier |
|---|---|---|
| Seize the Day | Win a seize map | Bronze |
| Ahead of the Dark | Win a battle 3 turns under par | Silver |
| Not a Scratch | Win a battle against 6+ foes where no ally took damage | Silver |
| All Out | Win an escape map with every deployed unit escaping | Silver |
| Heavy Hand | Deal 50+ damage in one strike | Silver |
| Red Harvest | One unit kills 10 foes in one battle | Gold |
| Shatter | Break every Revival Stone of a boss and kill it in one player phase | Gold |
| Dawn Strike | Win a battle on turn 1 | Gold |
| Encore | Refresh 3 allies with one Goddess Dance | Silver |
| Light Fingers | Steal a carried item | Bronze |
| Cutpurse | Steal 15 items (lifetime, 0/15) | Silver |
| Bolt from the Blue | Kill a boss with a ballista | Silver (secret) |
| Rink | Push a foe 4+ tiles with one ice slide | Silver (secret) |
| Bone Dry | Kill a Necromancer before it raises a Skeleton | Silver (secret) |
| Silent Vigil | Win the Vigil with no circle calling a Hollowed | Gold |
| Root and Branch | Kill the Entity on Nightfall or Black Sun with no Grasping Limb ever sprouting | Black Sun |

### The Company (units and lords)
| Name | Rule | Tier |
|---|---|---|
| Talked Down | Recruit a unit by Talk | Bronze |
| New Colours | Promote a unit | Bronze |
| A Name to Remember | A unit earns an epithet | Bronze |
| Sworn | Promote a unit who takes an Oath | Silver |
| Spoils of War | Recruit a defeated boss | Silver |
| Marked | Recruit a unit with a Mark | Silver |
| Five Marks | See all 5 Marks (lifetime, 0/5) | Gold |
| Perfect Year | A level-up that raises every stat | Silver |
| Living Legend | One unit holds 5 Deeds at once | Gold |
| Full Banner | All 7 lords in one run | Gold |
| Lone Lord | Win an Act III+ battle with only your commander deployed | Gold |
| Nobody Left Behind | Win a Nightfall or Black Sun run with no ally ever falling | Black Sun |
| Every Deed | Earn every Deed at least once | Black Sun |
| Seven Banners | Win a run with each lord as commander (0/7) | Black Sun |

### The Road (route, events, economy)
| Name | Rule | Tier |
|---|---|---|
| A Vow Taken | Take a church blessing | Bronze |
| A Price Paid | Take an act boss's card | Bronze |
| Not Today | Rewind a fall with Vision | Bronze |
| Cleansed | Cleanse a burden at a church | Bronze |
| Paid in Full | Collect a contract's reward | Bronze |
| Dark Omen | Finish a Dark Omen event | Silver |
| Old Stones | Find an Old Sanctum | Silver |
| Under the Dark | Win an eclipsed elite battle | Silver |
| Crowd Pleaser | Win a gold Colosseum bout | Silver |
| Champion of the Pit | Win a platinum Colosseum bout | Gold |
| Deep Pockets | Hold 10,000 gold at once | Silver |
| Masterwork | Forge a weapon to its limit | Silver |
| One of a Kind | Find an epic weapon | Silver |
| Trophy Hunter | Claim a boss trophy weapon | Gold |
| Every Road a Tale | See every Event but the fallback A Quiet Road (lifetime, 0/24) | Gold |
| Armory of Legends | Own every epic weapon at least once (0/23) | Black Sun |

### The Challenge (very hard)
| Name | Rule | Tier |
|---|---|---|
| Self-Reliant | Win a run without buying from a shop | Gold |
| Clear Sight | Win a Nightfall or Black Sun run without using Vision | Gold |
| Few and Proud | Win a run holding The Chosen Few | Gold |
| On Schedule | Win a Nightfall or Black Sun run at or under par in every battle | Black Sun |
| No Blessing | Win Black Sun after choosing No blessing at the shrine | Black Sun |
| The Unbroken Thread | Win Black Sun with no ally falling and no Vision used | Black Sun |

### Secrets (more, all hidden)
| Name | Rule | Tier |
|---|---|---|
| Not This Thread | A protected unit falls in the Prologue | Bronze |
| Third Time | Beat a boss that has beaten you three times | Silver |
| Unfathomed | Land a critical hit on the Entity | Silver |
| The Herald's Ear | Hear the Herald's words at the finale | Silver |

### Waiting on open PRs (added when they merge)
- Run grades (#441): **Top Marks** (an S grade, Gold), **Black Sun S** (S on Black Sun,
  Black Sun), **Swift** (win in under 75 minutes on the run clock, Gold).
- Knots / Echo (#444): **Tied Down** (win with 3 Knots, Gold), **Gordian** (win with every
  Knot, Black Sun), **Echoes** (win at Echo 10, Black Sun).
- Weapon uses (#443): **Last Use** (kill with a weapon's last use of the battle, Silver,
  secret).
- Accessories (#440): **Galeforce** (act again twice in one battle, Silver).

## Where they live

- **Records** (title screen) gets two tabs: **Victories** (today's list) and
  **Achievements**. L1/R1 and a tap switch them, as the Compendium's tabs.
- The tab: a header with "23 / 69" and a tier strip (bronze 9/14 …); filters All /
  Earned / Locked; one row per achievement: icon, name, rule, tier rim, date and slot when
  earned, a progress bar for counted ones (Cutpurse 7/15). Secrets read "???". Sorted by
  section, earned first inside a section (or newest first under "Earned").
- Home Base gets a small "Achievements 23/69" chip that opens the same tab. The pause menu
  does not (keeps it out of battle).
- The slot card may show the count; the title screen nothing.

## The unlock card

- A small DOM card (`ui/AchievementToast.js`, the `UpdateToast` pattern), top-right in
  landscape, top-centre upright, under the HUD's safe area; never over a blocking note,
  a ceremony, the rally or a boss card (it queues behind them).
- Content: the achievement icon in its tier rim, the word "Achievement" small, the name,
  the rule in one line. About 4 seconds, slide in / fade out; a hold on tap opens Records
  at that row (only outside battle). Several queue one at a time, max three, then
  "+N more".
- Sound: one short chime composed for it (bronze/silver share one, gold and Black Sun get
  a fuller one), keyed to the current track like the stingers, ducking the music lightly.
- Reduced motion: a fade, no slide. Never takes input focus, never blocks a tap on the
  board (click-through except the card itself).
- Icons: the item atlas is full (360 cells), so achievements get their own small sheet
  (69 cells, 32x32, same palette), or reuse existing icons where one fits. Art pass is its
  own step.

## Build plan (proposed)

1. Engine + data + storage + retroactive pass + tests (catalog validation, each rule
   fires at its commit point and never on a rewind, union merge, slot deletion keeps them).
2. Records tab and Home Base chip, with screenshots for review.
3. The card, the chime, the icon sheet.
4. Sim report: unlock rate per achievement per rung, to check the tiers.

## Open questions for Dave

1. Bragging only, or a cosmetic reward at milestones?
2. Achievements shared across all slots (proposed) or per save slot?
3. Is 69 the right size, and anything missing or unwanted?
4. Hidden "Secrets": keep, or show every rule?
5. Later: Game Center / Google Play Games achievements too?
