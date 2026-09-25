# App icon for Rogue Dawn (spec, built)

## Ask

The iOS icon (a gold winged sword over a shield on navy) is generic. With the game
being renamed to Rogue Dawn (the text rename is on another branch), design a new icon
from the art direction (`docs/art-direction/ART_BIBLE.md`, Ink & Ember, the Hollow Sun).
The tone is Dark Souls, and the image is dawn breaking against an eclipse, a lone
thread of light. It should have SNES / PC-98 pixel heritage but read as a premium modern
iOS icon.

- 4–6 distinct concepts, not recolours. Each is 1024 × 1024, full-bleed, opaque, with no
  text. It must read at 60 and 29 px on light and dark home screens, and avoid
  Fire Emblem–adjacent imagery (no winged sword, no crest shapes).
- Deliver the candidates, a comparison sheet (1024 / 180 / 60 / 29 on light and dark,
  plus a mock home-screen row next to generic tiles) and a README with a ranking and a
  recommendation.
- Wire the pick: replace `tools/icon-src/app-icon-pixel.png` (keeping the old file as
  `app-icon-winged-sword-legacy.png`), run `npm run gen:icons`, regenerate the iOS
  AppIcon set with the same file names, and make swapping candidates a single command.

## Built

See [`docs/art-direction/app-icon/README.md`](../art-direction/app-icon/README.md).

- Six procedural candidates (`tools/art/app-icon/`). Pick: **Hollow Dawn**.
- `npm run gen:icons -- --from <candidate.png>` adopts a candidate and regenerates the PWA
  icons and the iOS 1024 icon in one step.

## Deviations

- **Maskable icon is full-bleed.** It used to be padded to 80%, which showed as a frame
  under squircle masks. The candidates keep their focal shape inside Android's
  centre-80% safe circle, so padding isn't needed.
- **Launch screen replaced** (the coordinator asked for this during the work).
  `Splash.imageset` still held Capacitor's placeholder (a blue X on white). It's now the
  Hollow Dawn mark on the palette void, centre-safe in portrait and landscape, 6 KB,
  with the same file names. `LaunchScreen.storyboard`'s background changed from the
  system white to the void.
- **No generated imagery.** The Gemini/Imagen quota wasn't used. Procedural drawing from
  the key art's own palette and dither kept every candidate on the Ink & Ember ramps and
  one pixel grid, and made the set reproducible.
