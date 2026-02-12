# Imagen Asset Pipeline Prompt (Tracked)

Use this prompt when generating tactical RPG assets with Imagen for Emblem Rogue.

## Context

- Game: Emblem Rogue (Phaser tactical RPG)
- Style: SNES-inspired pixel art
- Common sizes: 32x32 map sprites, 64x64 FX icons, 128x128 portraits
- Source of truth: `assets/`
- Deploy output: `public/`

## Generation Rules

1. Use model `imagen-4.0-generate-001`.
2. Read API key from `GEMINI_API_KEY`.
3. Build full prompt as:
   - global style
   - category style prefix
   - per-asset prompt
4. Generate 4 variants per asset (`sampleCount: 4`) unless explicitly overridden.
5. Save raw outputs as:
   - `tools/imagen-pipeline/output/raw/{category}/{asset}_v{n}.png`
6. Use a dry-run mode for prompt validation before paid calls.

## Processing Rules

1. Optional background removal by dominant edge color.
2. Resize with nearest-neighbor to target size.
3. Optional palette reduction or palette mapping.
4. Save processed outputs as:
   - `tools/imagen-pipeline/output/processed/{category}/{asset}.png`

## Operational Guardrails

1. Prefer category-scoped generation for cost control.
2. Run dry-run first for every manifest update.
3. Keep prompts and manifest changes in git.
4. If an output is promoted into game content, move/copy into `assets/` and sync.
