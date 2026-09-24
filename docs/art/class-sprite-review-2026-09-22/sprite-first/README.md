# Sprite-first reduction study

## Question
Can artwork designed around coarse, connected pixel clusters survive the current map scale better than a detailed illustration reduced afterward?

## Hypothesis and controls
- Archer: open bright bow curve separated from torso; exposed cream sleeves.
- Mage: triangular robe, bent cap and broad ivory book.
- Knight: square shield/armor silhouette and upright white lance.
- Broad blue faction cloth; two-shade material target; minimal decoration.
- Original class identities preserved. No production replacements.
- Compare at identical map positions using existing renderer placement rules; prior Archer is player-set-3, Mage/Knight player-set-2. Lord/Sera/Pegasus anchors unchanged.
- Sources are generated large images depicting coarse pixels, not guaranteed native 32×32 grids or indexed palettes. Runtime nearest-neighbor fitting may still disturb clusters.

## Review
Use index.html: new vs previous grass captures, stone terrain, grayscale and silhouette diagnostics. These are staged textures in the live game renderer, not a played battle. Source PNGs, extracted transparent textures, exact prompts (catalog.json) and capture scripts are retained.

## Next experiment
If the broad shapes help but the coarse style loses too much character, apply the same pose/weapon/color-block discipline to an intermediate-detail sprite. Keep silhouette and size fixed while changing interior detail. Standardize body height separately from weapon extent before a full roster rollout. Do not decide from enlarged art alone.

## Observations from map captures
- Archer's ivory bow and Knight's blue/ivory shield are more conspicuous than the prior versions on grass. The bow opening survives reduction and is also visible in silhouette.
- Mage's bent cap is recognizable, but the book could be broader. Current mage placement makes its body small relative to the other samples.
- Coarse faces and saturated blue make this a noticeably different style from the unchanged lord anchors. This is evidence for stronger shape/value design, not yet a decision to replace the roster with this style.
- Generated sources still contain slight gradients and nonuniform block geometry despite the prompt; true grid consistency would require further asset preparation.
- Three assets extracted successfully, with no boundary clipping warnings. These are qualitative visual observations, not a measured player-recognition study.
