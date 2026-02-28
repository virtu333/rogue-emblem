# Nano Banana 2 Sprite Generation Tests

**Date:** Feb 26, 2026
**Model:** Nano Banana 2 (Gemini 3.1 Flash Image) — `gemini-3.1-flash-image-preview`

## Background

Tested Google's Nano Banana 2 image generation model for producing game sprite assets. The existing pipeline uses Imagen 4 (`imagen-4.0-generate-001`) via the predict endpoint. NB2 uses a different API format (Gemini `generateContent` endpoint).

## API Differences from Imagen 4

| | Imagen 4 (current) | Nano Banana 2 |
|---|---|---|
| Model ID | `imagen-4.0-generate-001` | `gemini-3.1-flash-image-preview` |
| Endpoint | `:predict` | `:generateContent` |
| Request format | `instances[].prompt` | `contents[].parts[].text` |
| Response format | `predictions[].bytesBase64Encoded` | `candidates[].content.parts[].inlineData` |
| Batch per call | `sampleCount: 4` | 1 image per call |
| Resolution | Standard | `imageSize: "512px" / "1K" / "2K" / "4K"` |
| Input images | No | Yes (for variations/style reference) |

## Test Scripts

- `tools/imagen-test-nb2.js` — Quick test with 6 prompts (terrain, sprites, portrait, icon). Mirrors `imagen-test.js` prompts for direct comparison.
- `tools/nb2-class-roster.js` — Full class roster generation (57 entries). Supports `--tier`, `--filter`, `--variants` flags.

## Results

### Individual sprite quality (good)
- **Portraits**: Excellent. Strong FE GBA vibes, clean pixel art, detailed faces. Best asset type tested.
- **Weapon icons**: Clean, centered, white background ready for transparency removal.
- **Character sprites**: High detail quality, good prompt adherence (blue palette, correct weapons).

### Style consistency problem (needs work)
Generating each class individually produces major style variance:
- Proportions differ wildly (chibi vs. full-detail vs. tactical illustration scale)
- Pixel density inconsistent across classes
- Mounted/flying units (wyvern rider, cavalier) tend toward much larger, more detailed output than infantry

### Comparison with existing pipeline
The current in-game sprites were extracted from **batch sprite sheets** (4-8 characters per image) generated via Gemini, then split and downscaled to 32x32. This batch approach naturally enforces style consistency within each generation.

## Sprite & Portrait Refresh Experiments (Feb 27, 2026)

**Script:** `tools/nb2-sprite-refresh.js`
**Usage:** `node tools/nb2-sprite-refresh.js [--experiment A|B|C|all] [--variants N] [--size 512px|1K] [--dry-run] [--reference PATH]`

Three experiments to solve style consistency and refresh weak portraits.

### Experiment A — Batch Sheet Generation (4 API calls)

Generate 3 classes per image on one canvas, then auto-split. Tests whether batch generation enforces consistent proportions (like the original sheet1-sheet6 approach).

- **batch1_infantry:** Myrmidon + Knight + Mage
- **batch2_mounted:** Cavalier + Wyvern Rider + Edric
- Splitting uses sharp extract + white bg removal + trim (adapted from `tools/split-sheets.js`)
- Raw splits preserved (not resized to 64x64 yet)

### Experiment B — Reference Image Anchoring (10 API calls)

Feed one good existing sprite (`nb2-roster/base/knight.png`) as `inline_data` style reference when generating each new class. Tests whether NB2's image input can enforce cross-generation consistency.

- **5 classes:** Myrmidon, Cavalier, Wyvern Rider, Mage, Edric
- Reference image sent as first `parts[]` entry with `inline_data.mime_type`
- Override anchor with `--reference PATH`

### Experiment C — Portrait Refresh + Coherence (30 API calls)

**C1 — Portrait refresh (6 targets x 2 methods = 24 calls):**
Targets: Hunter, Battle Monk, Wyvern Rider, Wyvern Lord, Sera, Cleric

Each portrait generated two ways:
- **Text-only** (baseline) — detailed mood-driven prompt in legacy manifest style (weathering details, negative prompts, asymmetric composition)
- **Reference-anchored** — same prompt + Swordmaster portrait fed as style reference

Style prefix follows Fire Emblem Echoes (Hidari) direction: naturalistic, understated, NOT performing for viewer.

**C2 — Portrait-to-sprite coherence (3 tests x 2 variants = 6 calls):**
Feed existing good portrait as reference when generating corresponding map sprite. Tests: Myrmidon, Knight, Mage.

### Evaluation Criteria

| Criterion | Exp A | Exp B | Exp C |
|-----------|-------|-------|-------|
| Proportional consistency across classes | Primary | Primary | - |
| Pixel density / resolution match | Primary | Primary | - |
| Style adherence to reference | - | Primary | C1: Primary |
| Portrait quality vs existing weak set | - | - | C1: Primary |
| Portrait-to-sprite visual coherence | - | - | C2: Primary |
| Downscale quality (64x64 / 32x32) | Secondary | Secondary | - |

### API Call Budget

| Experiment | Formula | Calls (2 variants) |
|------------|---------|-------------------|
| A | 2 batches x N | 4 |
| B | 5 classes x N | 10 |
| C1 | 6 portraits x 2 methods x N | 24 |
| C2 | 3 tests x N | 6 |
| **Total** | | **44** |

At 2s rate limit per call: ~90 seconds of API time.

## Output Locations

- `References/imagen-output/nb2-test/` — Initial 6-prompt quality test (12 images)
- `References/imagen-output/nb2-roster/` — Full class roster (base + promoted + lords + enemies)
- `References/imagen-output/nb2-refresh/` — Refresh experiments (compare.html for visual review)
