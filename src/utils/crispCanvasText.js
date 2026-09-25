// crispCanvasText — smooth downsampling for supersampled Phaser text.
//
// The game renders into a 640x480 canvas with pixelArt (NEAREST) sampling, and most
// HUD text is rasterized at TEXT_RESOLUTION 2 for sharpness. With NEAREST filtering
// that 2x texture is downsampled by dropping every other texel, so strokes vanish
// or double at random ("Par: 10" read as "Par: J0") — the broken, chunky canvas
// text players saw on large desktop windows (a Retina Mac shows the 640x480 image
// at 3.75 device pixels per game pixel, magnifying every dropped texel).
//
// Text rendered above 1x now uploads with LINEAR filtering, so the 2x texture is
// box-filtered into the framebuffer like a normal antialiased glyph. Text at 1x
// (pixel-exact labels) and every sprite keep NEAREST. Presentation only.

const LINEAR = 0; // Phaser.Textures.FilterMode.LINEAR

let installed = false;

export function installCrispCanvasText(Phaser) {
  const Text = Phaser?.GameObjects?.Text;
  if (installed || !Text?.prototype?.updateText) return false;
  installed = true;
  const updateText = Text.prototype.updateText;
  Text.prototype.updateText = function crispUpdateText(...args) {
    const supersampled = Number(this.style?.resolution) > 1;
    const config = supersampled ? this.renderer?.config : null;
    const previous = config?.antialias;
    if (config) config.antialias = true; // canvasToTexture -> LINEAR min/mag
    try {
      return updateText.apply(this, args);
    } finally {
      if (config) config.antialias = previous;
      if (supersampled && this.frame?.source) this.frame.source.scaleMode = LINEAR;
    }
  };
  return true;
}
