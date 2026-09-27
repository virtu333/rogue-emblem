# Playtest patch handoff — September 26, 2026

## Version and scope
**Tested main: `b8e13bf`; combined portrait integration: `7689a2c8840cd73707b561f03ee6debe8d87f47a`.** Includes #99, #122, #124–126, #128 and #129. Not a review of subsequent merges: reproduce against current main before patching, and record any already-fixed findings.

Visible gameplay, isolated localhost:3099, music/SFX off. Mostly 390×844; initial checks also 375×667 and 844×390. Desktop-hosted phone presentation with a temporary coarse-pointer presentation adapter, not physical iPhone acceptance. No gameplay state injection. Normal reached Act 2 elite Hilltop Fortress; all five party members alive. Normal completion, progression purchases and Hard are still pending. No crash or blocked progression observed in this coverage.

This is an investigation/patch handoff, not a claim of code-confirmed root causes. Preserve intentionally punishing combat and anti-cheese boss behavior. Keep reproduction fixtures separate from the ongoing playtest save.

## Recommended patch queue

### P2 — End turn clips on small portrait screens (observed layout defect)
- Reproduce at 375×667: idle battle rail after terrain details appear; End turn's bottom falls below the scrolling region near the more cue/fixed utilities. Fits at 390×844. Wait remains pinned in unit-action state.
- Expected: primary idle action remains fully visible; terrain bonuses remain available (explicit user preference).
- Suggested approach: pin End turn in idle state, analogous to Wait, or reserve adequate command height. Check `MobileBattleHUD.js` pinnedRailCommand and `battleRail.css`.
- Verify: terrain on/off, objective variants, selection/back transitions, 375×667 and 390×844, landscape. Keep hit targets clear of fixed utilities.
- Existing evidence: `end-turn-clipped-375.png` alongside the original report.

### P2 — Battle Equip omits the speed cost of a weapon (observed information gap)
- Reproduce: select unit → Equip when preparing to wait rather than attacking. Choices list Might/Hit/Crit/Range, but not weight or resulting attack speed.
- Impact: Iron Sword repeatedly doubled when forged Steel did not. A defensive equipment decision needs this information even without a target/forecast.
- Suggested patch: show resulting Attack speed (and weight if space permits), with current-versus-choice difference. Reuse the same calculation as forecast/roster; do not equip merely to preview.
- Verify light/heavy weapons, stat modifiers, cancelling selection, and actual equipped weapon after Wait/reload. Compact portrait layout must remain legible.

### P2 — Wounded merchant cannot clearly be healed (investigate eligibility before mechanics change)
- Act 2 elite Hilltop Fortress with caravan: Fighter hit Merchant for18 on enemy turn1 and killed them on enemy turn2. Rewind to start turn2 restored correctly and consumed one charge.
- Sera carried Physic2/2 and moved to column8,row6; wounded Merchant was column8,row4 (zero-based). No Heal action appeared at distance2. Physic had successfully healed Astrid at distance2 in the prior battle.
- Unknown: intended merchant faction/eligibility, line-of-sight/target restrictions, or actual defect. Review these rather than assuming every NPC should be healable.
- If eligible, repair target/action discovery and add a focused regression. If intentionally ineligible, state it in staff/NPC details so rescue planning is informed. Check other neutral/recruitable NPCs too.
- Timeline correctly reported hit/death. I did not continuously observe the animation, so there is **no claim that a transient death notification was absent**.

### P2 — Recruit instruction sits below route-preview fold (observed clarity gap)
- Select Cael recruit node in portrait: title/badges/stat card precede the essential “Reach them with a lord and Talk”; Travel is visible before that instruction.
- Put the short action instruction above stats; retain detailed stats and provide an overflow cue. The in-battle hint already explains Talk and mitigates this for first-time players.
- Verify long recruit names/badges and repeated visits after hints are marked seen.
- Evidence: `recruit-preview-clipped.png` in the previous continuation.

### P3 — Contextual hint survives its selected unit/action (observed once)
- Disabled-Attack teaching hint referred to Edric after selection had moved to Sera and Edric had waited; Back/choose a closer tile advice was stale.
- Investigate queue invalidation keyed to unit and interaction context; do not burn an unseen hint as dismissed when cancelling stale queued work.
- Verify rapidly switching units and action completion while a hint is queued; persistent general tutorials must still display.

### P3 — Archer-role draft guidance does not match starting loadout (confirmed UI/loadout mismatch)
- Act1 boss draft offered Voss Ranger and said army lacked an archer. Chose Voss for that role; roster showed only Steel Sword (1/5 equipment), although Bow-proficient. Longbow reward later filled the gap.
- Decide whether role advice should describe potential proficiency or whether the ranged recruit should arrive with a usable bow. Prefer making draft equipment visible; don't silently infer a universal equipment buff from one case.
- Verify draft preview and received inventory agree, including recruitment inventory limits and save/reload.

### P3 — Service map uses combat copy (observed)
- Village → View map: current village says “Current battle” / “The party fights here” with no battle or ambush active.
- Use service-neutral current-location text; retain combat copy for actual encounters. Close correctly returns to shop.
- Evidence: `village-map-battle-copy.png` in prior continuation.

### P3 — Disabled Attack range does not explain carried weapons (observed)
- Edric equips Iron Sword (range1), carries Wind Sword (range1–2); disabled action says “No target in range1–2”. Mechanics correctly allow carried-weapon choices.
- Suggested wording: “No carried weapon can reach.” Preserve weapon-specific range in details/forecast.

## Design/polish follow-ups, not established defects
- **Secondary objective status:** village/merchant survival is easy to lose track of when compact header shows only Rout/Seize. Consider a compact persistent status (alive/rescued/lost), without disclosing hidden aggression rules. Merchant also appeared with a RECRUIT label; review whether that accurately describes its interaction.
- **Class silhouette readability:** repeatedly misidentified Myrmidon/Thief/Mage/Archer before inspection at small portrait scale. Not proof of wrong assets. Evaluate class/weapon cues and accessible inspect labels before changing art.
- **Compendium height:** filters consume roughly half of 375×667 view, leaving around five entries; navigation works. Consider compact filters.
- **Recruit urgency:** Astrid's hunters wording implied pressure, but this Mire Crossing layout put her safely behind the party for turn1 Talk. Single layout observation; review distribution before tuning difficulty.
- **Overlapping services:** Village → Church → Ruins supplied repeated healing/revival functions; ruins market remained useful but marked up25%. Consider functional overlap in route generation, not just identical node types.
- **Dominated fallback:** one roll offered700gold+25teamXP alongside271 fallbackgold. Gold fallback is intentionally a backup; hide/de-emphasize a strictly dominated duplicate rather than buffing it globally.

## Gameplay impressions to preserve
Normal has felt demanding but recoverable. Edric dropping to3HP followed poor positioning against a SteelLanceKnight; Mend allowed recovery. Cael tanks physical hits but accuracy/terrain limits his offense. Longbow, Physic and flying mobility delivered distinct value; basic Iron stayed useful because of speed. HelmSplitter's explicit4HP cost, limited uses and loss of standard followup made risk legible; I declined an exposed attack with five enemies able to reach. No broad difficulty reduction is supported by this sample.

## Verified positive paths / regression guardrails
- Act1 boss seized with defenders alive; act transition replenished rewind to1.
- Two genuine rewind restores returned units to expected prior state and spent exactly one charge each.
- Weapon rewards reached intended inventory; purchase/forge and route gold survived autosave reload in prior continuation.
- Staffs refilled after battle; roster Vulnerary healed and decremented uses, with HP-full explanation afterward.
- Physic healed player unit at distance2. HelmSplitter binding consumed one team scroll and showed success.
- Cael and Astrid acted on their recruitment turn; party reached current elite without casualties.

## Supporting reports
See `review.md` and `continuation.md` in this report directory for earlier evidence/screenshots. `normal-act2-session.md` contains chronological continuation notes. Patch agents should report current-main reproduction and tests separately from this historical baseline.

## Follow-up observations during continued Normal run
Same baseline: main b8e13bf plus portrait stack7689a2c.

### P2/P3 — Shop comparison hides a critical upgrade
At Act2 Ruins, Witchfire3306G compared with Ottoline Elfire as Attack20->20 andAS3->3 only. Witchfire actually adds30crit and Mire while matching might/hit/weight. Roster comparison correctly showedcrit+30. Extend the shop comparison to show meaningful crit/range/art differences, without making every row noisy. Verify against two equal-Mt/weight weapons with differentcrit and an addedart.

### Balance observations, not automatic changes
- Healing Light reward:7HP upfront,30%damage healing,+10Hit,2uses/battle,no normalfollowup. A20damagehit heals6, losing1HPoverall. Unattractive besideWardingCharm for this party; examine intended highdamage niche before changing.
- Promoted Ottoline Sage cost1052G, with13MAG, Elfire, Hungry/LastEmber andSpellHarmony/QuickRiposte. Strong immediate value compared with1500GShine earlier;deploymentcap5 is a meaningfulconstraint. Sampletoo small for blankethire nerf.
- Talisman reward recommends highestRESgrowth Ottoline, whereas lowRESfrontlinerCael was more useful recipient. Consider whether growth-based advice should be framed as growth information rather than an implied best recipient.
- Mire proved useful:5HP bought safeextendedrange and avoidedVantagecounter. Costs/useswereclear. Preserve thatdistinct tacticalbenefit.

### Recovery observation
Unexpected page reload around2026-09-27 03:25:52UTC duringVossmove atRiverCrossingTurn4. Capturedlogs showVite reconnect, noerror;sourceHEADunchanged. Resume restoredcompletedactions,oneenemy,oneunitready. Causeunknown; do not call this a confirmedgamecrash withoutreproduction.

### Clarifications / small polish
- Elite victory explicitly displayed Caravan destroyed; casualty feedback does exist at victory.
- Arena preview offered no obviousweaponselector; hadtoleave andchangeweapon inRoster to improve matchup. Confirm latestbehaviorbeforepatching.
- Sera gained+1SPD on a leanlevel butquote said Nothing gained. Lowpriority flavor mismatch.

### P2 — “The Last” deed awarded with the entire deployment alive (confirmed)
- Act 2 Great Hall victory: Edric, Sera, Cael, Voss and Ottoline all survived, but Ottoline received “The Last”: “Came back alone, carrying the names of the rest.” Screenshot: `ottoline-last-deed.png`.
- On the tested checkout, `src/engine/DeedSystem.js:574–588` filters living units to non-lords, then sets `lastStanding = deployedCount` when exactly one non-lord survives. Four living lords plus Ottoline therefore qualify. `data/deeds.json:230–247` awards `last_of_them` when `lastStanding >= 4`.
- Align the condition with actual survivor/casualty semantics. Regression: four lords and one non-lord, all alive, must not earn this deed. Also retain a test for the intended genuine last-survivor case.
- This is a narrative/state accuracy bug; no crash or stat corruption observed. Reproduce on current main before patching.

## Continuation milestone
Normal Act 2 cleared at turn 8, rank S, with no player casualties. Entered Act 3 with 8 living units and 8,415 G after recruiting Adela and selecting Hexblade. Normal completion, progression purchases and Hard Act 1 remain in progress. Baseline remains main `b8e13bf` + portrait stack `7689a2c`.
