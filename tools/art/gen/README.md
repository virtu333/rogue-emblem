# tools/art/gen — generated art references

`geminiImage.mjs` is the one client every art pipeline uses for generated references
(portrait sources, sprite references, vignettes, cards, motion references).

- **Auth:** in the cloud environment the egress proxy adds the API key header for
  `generativelanguage.googleapis.com`; nothing is stored in the repo. Locally, set
  `GEMINI_API_KEY` (or `GOOGLE_API_KEY`).
- **Transport:** curl (honours `HTTPS_PROXY` and the proxy CA). Node's `fetch` ignores the
  proxy unless started with `NODE_USE_ENV_PROXY=1`.
- **Models:** `MODELS.pro` (`gemini-3-pro-image`, best quality and reference following),
  `MODELS.flash` (`gemini-3.1-flash-image`, fast iteration), `MODELS.veo` / `MODELS.veoFast`
  (Veo 3.1 motion references). Imagen is not enabled on this key.
- **Cache and provenance:** each output has a `<out>.gen.json` record keyed by a hash of
  model, prompt, reference bytes and config; re-runs reuse it. Every generation is also
  appended to `generations.jsonl` beside the output.

```js
import { generateImage, generateAll, generateVideo, MODELS } from './geminiImage.mjs';
await generateImage({ prompt, refs: ['style.png'], aspectRatio: '21:9', imageSize: '2K', out: 'out/church' });
```

Generated images are references, not shipped art: they go through a code treatment
(`tools/art/pc98`, `tools/art/sprite-trace`, ...) so everything shares one palette and
pixel grid. Keep raw generations out of `assets/` (see `docs/mobile-memory-budget.md`).
