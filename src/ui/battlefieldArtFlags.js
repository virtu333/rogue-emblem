// battlefieldArtFlags — which battlefield presentation is active (pure, no Phaser).
//
// One game, not two (ART_BIBLE "Desktop"): phones and desktop present the same
// battlefield art — painted terrain, traced unit sprites (tools/art/sprite-trace) and the
// contrast pass. The phone-only side-pane layout is a separate switch
// (battlefieldLabEnabled).
//
// Development escape hatches (ignored in production builds):
//   ?battlefieldArt=classic  everything classic
//   ?terrainArt=classic      classic terrain tiles (?terrainArt=<id> picks a renderer)
//   ?spriteArt=classic       classic unit sprites
//   ?spriteArt=rebuilt       the previous rebuilt 64 px sprite set instead of the traced one
//   ?battleContrast=original no contour / palette lift / grass softening

function readSearch(search) {
  if (typeof search === 'string') return search;
  return globalThis.location?.search || '';
}

/** Resolve all flags from a query string (pure; `dev` mirrors import.meta.env.DEV). */
export function resolveBattlefieldArtFlags(search = '', { dev = false } = {}) {
  const query = new URLSearchParams(search || '');
  const devValue = (name) => (dev ? query.get(name) : null);
  const all = devValue('battlefieldArt') !== 'classic';
  const terrainChoice = devValue('terrainArt');
  const terrain = all && terrainChoice !== 'classic';
  const sprites = all && devValue('spriteArt') !== 'classic';
  const contrast = sprites && devValue('battleContrast') !== 'original';
  // traced sprites are the default whenever the sprite presentation is on
  const traced = sprites && devValue('spriteArt') !== 'rebuilt';
  return {
    terrain,
    sprites,
    contrast,
    traced,
    terrainRenderer: terrain && terrainChoice ? terrainChoice : null,
  };
}

function flags(search) {
  return resolveBattlefieldArtFlags(readSearch(search), { dev: Boolean(import.meta.env?.DEV) });
}

/** The shared battlefield presentation is on (terrain or sprites). */
export function battlefieldArtEnabled(search) {
  const f = flags(search);
  return f.terrain || f.sprites;
}

export function battlefieldTerrainArtEnabled(search) {
  return flags(search).terrain;
}

export function battlefieldSpriteArtEnabled(search) {
  return flags(search).sprites;
}

/** Traced map sprites (default; dev ?spriteArt=rebuilt shows the rebuilt set instead). */
export function battlefieldTracedSpritesEnabled(search) {
  return flags(search).traced;
}

export function battlefieldContrastEnabled(search) {
  return flags(search).contrast;
}

/** Dev-only renderer id requested with ?terrainArt=<id> (null = default renderer). */
export function requestedTerrainRenderer(search) {
  return flags(search).terrainRenderer;
}
