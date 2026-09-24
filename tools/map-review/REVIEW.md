# Map field trials — first review

## Scope
30 playable rout-map cases: ten existing lab templates, seeds 42 / 137 / 908. Actual game is embedded at 844×390, 667×375 or 640×480. Review page scales the frame to fit; use the separate-battle link for direct play. Native safe areas require simulator/device verification.

Generator code and gameplay rules are unchanged. The playable roster remains the two-unit smoke-test roster, not an act-balanced party. Later-act encounters are suitable for layout testing rather than difficulty judgments.

## Automated diagnostics
- 60 configurations generated: 30 with two deployment slots, 30 with eight requested slots. All passed the existing engine validator.
- All 30 two-slot configurations reproduced exactly on a second generation with the same RNG used by BattleScene.
- No enemy tile was disconnected from all allied spawns for terrain-only infantry travel in the two-slot sample.
- Nearest enemy-tile travel costs ranged from 3 to 19. Longest samples: Castle ruins seed 42 and Mire crossing seed 137 (19), Castle ruins seed 908 (18).
- Route cost is not time to first combat. It ignores attack range, enemy movement, blockers, hazards/damage and reinforcements. Narrow-cell counts do not establish tactical chokepoints.

## Visual observations
- Chokepoint seed 42: map and rail fit; fort occupants remain difficult to separate visually from the fort art.
- Corridor siege seed 42: stone-floor texture is busy behind small sprites. Consider reducing floor contrast before enlarging all units.
- Magma flow seed 42 at compact phone size: the default camera displays a subsection. Overview exposes the full enemy formation, but reduces unit size. Prioritize a deployment-aware starting camera and a clear way to return to the selected unit.

## Proposed next fixes to review
1. Deployment-aware starting frame, with a minimum readable zoom and a selected-unit recenter action.
2. Consistent silhouette separation for units standing on structures.
3. Quieter castle floor texture and clearer hazard edges.
4. Playtest the long-approach seeds before changing distances or generator rules.

## Limits
This is a bounded sample of ten rout templates, not every campaign template/objective. Seize, escape, defense, reinforcement-heavy battles and the multi-tile final boss need additional cases. Eight-slot density currently has generator diagnostics only; it needs an appropriate playable roster before interaction conclusions.

## Reproduce
Run `node tools/map-review/generate.mjs`, then `npm run dev` and open `/tools/map-review/index.html`. The battle links use the existing Vite development server on port 3000.
