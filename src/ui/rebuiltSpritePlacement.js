// Pure layout math shared by the runtime and tools/bakeRebuiltSprites.mjs: where a
// sprite's bounds land inside its tile-centred 64px (128px entity) texture.
export function spritePlacement(bounds, kind = 'infantry') {
  const canvas = kind === 'entity' ? 128 : 64;
  const maxWidth = kind === 'entity' ? 94 : kind === 'flyer' ? 40 : kind === 'mounted' ? 46 : 38;
  const maxHeight =
    kind === 'entity'
      ? 90
      : kind === 'mage'
        ? 30
        : kind === 'heavy'
          ? 36
          : kind === 'mounted'
            ? 40
            : 34;
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const footY = kind === 'entity' ? 106 : 44;
  return { canvas, x: Math.round((canvas - width) / 2), y: footY - height, width, height };
}
