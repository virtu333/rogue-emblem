# Gaspar implementation

Gaspar joins ordinary new runs by default, including Black Sun and the first-run fast path.
Tutorial rosters keep their own units; existing Gaspar saves migrate their rules without changing stats. The source definition is
`data/specialChars.json`; the agreed stat and growth lines are preserved.

Combat completion uses the existing saved action continuation and the data-owned Measured Step skill to suppress post-combat movement.
Noncombat actions retain the normal remaining-movement rules. There is no additional
per-turn flag that can become stale across Dance, rewind or suspend/resume.

His class curriculum and mastery are disabled at both progression and save-migration
boundaries. Reclass and repeat promotion mutations are guarded. Earned scrolls and other
in-run investments use the ordinary rules. Explicit no-meta victories receive a cosmetic
badge in the result screen and victory archive; the record keeps its difficulty and his
portrait identity through cloud/local merging.

## Art and lines

Unique transparent portrait and mounted sprite generated with the built-in image tool.
Sources: `docs/art/rebuilt-portrait-sources/special_old_knight.png` and
`docs/art/rebuilt-sprite-sources/special_old_knight.png`. Shipped art lives in
`assets/portraits/{rebuilt,pc98}` and `assets/sprites/rebuilt`, mirrored under `public/assets`.
The portrait uses the existing PC-98 renderer and lazy texture path. The mounted sprite
now uses the shared tracer and atlas: four idle frames, windup and strike. The rebuilt rest pose remains available for comparison.

Regenerate the shipped assets with `node tools/bakeSpecialCharacters.mjs`, then
`npm run sync-assets`. The ordinary `check:sprites` also verifies his baked sprite.

Prompt set: an elderly silver-haired, grey-bearded Paladin in worn steel plate and a navy
cloak with brass trim; crisp retro tactical-RPG pixel clusters and transparent background.
Portrait: three-quarter right-facing bust, calm experienced expression. Sprite: the same
knight on a brown horse with navy saddle blanket, steel lance upright, three-quarter
map view, full silhouette inside the canvas. Existing portrait and cavalry art were style
references. Portrait and mounted figure were generated separately.

Personal dialogue lives in separate `specialChars.old_knight` namespaces, covering intro,
level-ups, crits, kills, low HP, death, revival, final rally and victory.

## Validation

`tests/Gaspar.test.js` covers new-run/tutorial behavior, all four difficulty lines,
meta rounding and exemptions, in-run investments, class mutation guards, save preservation,
recruit/revival averages, promoted XP and Mentor sharing, saved combat continuations,
personal art/voice routing, record merging and idempotent no-meta settlement.

The implementation re-run reproduces the analytical report exactly (6,000 trials per scenario).
The comparison source explicitly sets both Rapier might values so the historical might-7
column stays reproducible after the canonical weapon changes to 6.

The analytical report remains in `veteran-knight-calculations-results.md`. Its limitations
still apply: local exchange calculations and automated play are balance evidence, and
human run testing remains necessary for positioning and deliberate kill feeding.


## Review follow-ups (2026-09-30)

Gaspar’s temperament is **wry**. His two descriptive special traits are **Campaign Veteran**
(`old_campaigner`) and **Set in His Ways**. The first display name avoids the pre-existing
`woodsman` trait’s “Old Campaigner” name. The descriptions respect the 85-character budget.
They never roll and confer no additional stats. Biography, traits and temperament appear
in the desktop and phone roster; mastery is hidden independently of those rows. Canvas
fallback detail also exposes the biography and trait tooltips at 640×480.

The policy fields live in `specialChars.json`. `SpecialCharacterPolicy` reads them, and
`CantoRule` resolves movement from skills. Ordinary Canto wins when both skills are present;
root still wins. Versioned migration replaces legacy Canto only once, so a Canto scroll
learned afterward survives reload. Class innate repair skips the fixed kit. Route saves,
fallen units, suspend checkpoints and Vision restores normalize the same rules.

Reclass and promotion refusal pools use his voice without spending seals or gold. Low-HP
speech uses a per-unit battle latch and its own cooldown; a blocked attempt can retry.
Sword kills, surviving lance targets and substantial level-ups have personal lines. Result
badge text follows the persisted victory record rather than the live run flag.

`sim/strategy.js` explicitly defaults to including him. Pass `--includeVeteran false` for a
comparison roster. Full-run deployment retains lords first and compares remaining units
using forecast damage, hit, doubling and defenses instead of raw level. This is a deployment
heuristic, not the deliberate feeding policy required for the outstanding balance study.

### Traced sprite revision

The original large sprite traced at scale 0.251. A chunky redraw traces at 0.879, within
0.55–0.9. Source: `docs/art/sprite-candidates-2026-09-30/sources/special_old_knight.png`.
The source is separate from the rebuilt comparison sprite. The tracer roster includes the
mounted body, silver hair, head region and lance slot overrides, plus an explicit bake entry.
Regenerate with `node tools/art/sprite-trace/cli.mjs bake`. Traced art is the default,
`?spriteArt=rebuilt` uses his rebuilt source, and classic mode uses the Paladin fallback.

Review sheets in the same directory compare idle/windup/strike beside Rowan and an enemy
Paladin, plus PC-98 portraits beside Rowan, Edric and Sera. The dusk/night sheets use simple
review grades; actual atmosphere behavior is covered by browser tests. Portraits retain all
six PC-98 sizes and the rebuilt 512 cap. Atlas pages remain two; decoded texture bytes change
from 25,951,464 to 26,008,752 (+57,288 bytes, 0.055 MiB).

The redraw used the built-in image generator with Gaspar’s original sprite as the identity
reference and the approved chunky Cavalier as the scale/style reference. Prompt intent:
elderly silver-haired Paladin, navy cloak, worn steel plate, brown horse and upright steel
lance; transparent background; compact tactical-map pixel clusters and a clearly separated
mounted silhouette. No gameplay stats were changed during the art pass.

Additional checks cover scene-level combat and item Canto, weapon arts, serialized level-up
continuations, old checkpoint units in every group, traits, real meta run-start rounding,
alternate commander plus Vanguard, roster/revival boundary averages, seal refusals, explicit
Rapier damage, numeric Mentor sharing, and result/archive badge agreement. The 200 paired
runs and deliberate feeding/Sera-bait balance study remain outstanding.
