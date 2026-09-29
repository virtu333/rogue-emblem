# Gaspar implementation

Gaspar joins ordinary new runs by default, including Black Sun and the first-run fast path.
Tutorial rosters and existing saves are unchanged. The source definition is
`data/specialChars.json`; the agreed stat and growth lines are preserved.

Combat completion uses the existing saved action continuation to suppress his Canto.
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
uses the existing tile placement and sprite baker and is a static rest pose.

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
