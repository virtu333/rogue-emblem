// AtmosphereFX — per-act mood as a camera post-process (WebGL only).
//
// The battlefield stays mid-value and readable; the grade adds a low warm key light
// from the upper-left, a split tone (violet shadows / warm highlights), a vignette that
// sinks the frame edges into ink, and fine grain. Chromatic split appears only where the
// story calls for corruption (late acts, the Deep).
//
// Presentation only: never touches game state. Canvas renderer, tests and
// "Atmosphere: Off" simply skip it.

import Phaser from 'phaser';

export const ATMOSPHERE_PIPELINE_KEY = 'AtmosphereFX';

// Grades are authored as intent, then converted to shader uniforms.
//   shadow / highlight: hue direction of the split tone
//   split: split-tone strength; sat / contrast / exposure: global trims
//   key: warm upper-left key light strength; vignette / grain / aberration: 0..1-ish
export const ATMOSPHERE_GRADES = Object.freeze({
  act1: {
    label: 'Ember Dusk',
    shadow: '#3b2a5c',
    highlight: '#ffb86a',
    split: 0.7,
    sat: 0.92,
    contrast: 1.06,
    exposure: 0.95,
    key: 0.22,
    vignette: 0.55,
    grain: 0.035,
    aberration: 0,
  },
  act2: {
    label: 'Iron Rain',
    shadow: '#23365c',
    highlight: '#d9e6f2',
    split: 0.5,
    sat: 0.78,
    contrast: 1.06,
    exposure: 0.93,
    key: 0.08,
    vignette: 0.6,
    grain: 0.04,
    aberration: 0,
  },
  act3: {
    label: 'Bleached Rite',
    shadow: '#4a3a5e',
    highlight: '#fff0c8',
    split: 0.45,
    sat: 0.7,
    contrast: 0.98,
    exposure: 1.02,
    key: 0.12,
    vignette: 0.5,
    grain: 0.035,
    aberration: 0,
  },
  act4: {
    label: 'Ashfall',
    shadow: '#4a1a2e',
    highlight: '#ff9a6a',
    split: 0.6,
    sat: 0.86,
    contrast: 1.1,
    exposure: 0.86,
    key: 0.2,
    vignette: 0.75,
    grain: 0.05,
    aberration: 0.6,
  },
  deep: {
    label: 'The Deep',
    shadow: '#2c1645',
    highlight: '#dcaaf0',
    split: 0.7,
    sat: 0.55,
    contrast: 1.12,
    exposure: 0.84,
    key: 0,
    vignette: 0.85,
    grain: 0.06,
    aberration: 1.4,
  },
});

function hexToRgb01(hex) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Hue direction of a color with its luminance removed, normalized to unit length. */
function chromaDirection(hex) {
  const [r, g, b] = hexToRgb01(hex);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = [r - l, g - l, b - l];
  const len = Math.hypot(c[0], c[1], c[2]) || 1;
  return c.map((x) => x / len);
}

/** Convert an authored grade into uniform values (pure; unit-testable). */
export function gradeToUniforms(grade, { reduced = false } = {}) {
  const g = grade || ATMOSPHERE_GRADES.act1;
  return {
    shadow: chromaDirection(g.shadow),
    highlight: chromaDirection(g.highlight),
    split: (g.split ?? 0.5) * 0.2,
    sat: g.sat ?? 1,
    contrast: g.contrast ?? 1,
    exposure: g.exposure ?? 1,
    key: g.key ?? 0,
    vignette: reduced ? (g.vignette ?? 0) * 0.6 : (g.vignette ?? 0),
    grain: reduced ? 0 : (g.grain ?? 0),
    aberration: reduced ? 0 : (g.aberration ?? 0),
  };
}

const FRAG = `
#define SHADER_NAME ATMOSPHERE_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 uResolution;
uniform float uTime;
uniform vec3 uShadow;
uniform vec3 uHighlight;
uniform float uSplit;
uniform float uSat;
uniform float uContrast;
uniform float uExposure;
uniform float uKey;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
varying vec2 outTexCoord;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = outTexCoord;
  vec2 c = uv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  float d = length(c * vec2(aspect, 1.0));
  vec3 col;
  if (uAberration > 0.0) {
    vec2 off = c * (uAberration * 2.0) / uResolution * d * 2.0;
    col.r = texture2D(uMainSampler, uv + off).r;
    col.g = texture2D(uMainSampler, uv).g;
    col.b = texture2D(uMainSampler, uv - off).b;
  } else {
    col = texture2D(uMainSampler, uv).rgb;
  }
  col *= uExposure;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  col = (col - 0.5) * uContrast + 0.5;
  l = clamp(dot(col, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  // Split tone keeps luminance: shadows lean one hue, highlights another.
  float ws = (1.0 - l) * (1.0 - l);
  float wh = l * l;
  col += (uShadow * ws + uHighlight * wh) * uSplit;
  // Low warm key from the upper-left (texture v runs bottom-to-top in framebuffers).
  float keyT = clamp(0.5 + (-c.x + c.y) * 0.9, 0.0, 1.0);
  vec3 keyTint = mix(vec3(0.88, 0.9, 1.04), vec3(1.12, 1.0, 0.84), keyT);
  col *= vec3(1.0) + (keyTint - vec3(1.0)) * uKey * 3.0;
  // Vignette sinks edges toward the shadow hue, never to pure black.
  float v = smoothstep(0.42, 1.0, d) * uVignette;
  vec3 ink = vec3(0.035, 0.03, 0.05) + uShadow * 0.02;
  col = mix(col, ink, v);
  // Fine luminance-weighted grain.
  float n = hash(uv * uResolution + fract(uTime * 0.0007) * 91.0) - 0.5;
  col += n * uGrain * (1.1 - l);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export class AtmospherePipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  constructor(game) {
    super({ game, name: ATMOSPHERE_PIPELINE_KEY, fragShader: FRAG });
    this._u = gradeToUniforms(ATMOSPHERE_GRADES.act1);
  }

  setGrade(grade, opts) {
    this._u = gradeToUniforms(grade, opts);
    return this;
  }

  onPreRender() {
    const u = this._u;
    this.set1f('uTime', this.game.loop.time);
    this.set3f('uShadow', u.shadow[0], u.shadow[1], u.shadow[2]);
    this.set3f('uHighlight', u.highlight[0], u.highlight[1], u.highlight[2]);
    this.set1f('uSplit', u.split);
    this.set1f('uSat', u.sat);
    this.set1f('uContrast', u.contrast);
    this.set1f('uExposure', u.exposure);
    this.set1f('uKey', u.key);
    this.set1f('uVignette', u.vignette);
    this.set1f('uGrain', u.grain);
    this.set1f('uAberration', u.aberration);
  }

  onDraw(renderTarget) {
    this.set2f('uResolution', renderTarget.width, renderTarget.height);
    this.bindAndDraw(renderTarget);
  }
}

/** Register once per game; returns false on the Canvas renderer. */
export function registerAtmosphere(game) {
  const pipelines = game?.renderer?.pipelines;
  if (!pipelines || typeof pipelines.addPostPipeline !== 'function') return false;
  if (!pipelines.postPipelineClasses?.has?.(ATMOSPHERE_PIPELINE_KEY)) {
    pipelines.addPostPipeline(ATMOSPHERE_PIPELINE_KEY, AtmospherePipeline);
  }
  return true;
}

/**
 * Apply a grade to a camera. `mode`: 'full' | 'reduced' | 'off'.
 * Returns the pipeline instance (or null when unavailable/off).
 */
export function applyAtmosphere(camera, gradeKey, { mode = 'full' } = {}) {
  if (!camera || mode === 'off') {
    camera?.resetPostPipeline?.();
    return null;
  }
  const game = camera.scene?.sys?.game;
  if (!registerAtmosphere(game)) return null;
  const grade = ATMOSPHERE_GRADES[gradeKey] || ATMOSPHERE_GRADES.act1;
  camera.setPostPipeline(ATMOSPHERE_PIPELINE_KEY);
  const pipe = camera.getPostPipeline(ATMOSPHERE_PIPELINE_KEY);
  const inst = Array.isArray(pipe) ? pipe[0] : pipe;
  inst?.setGrade?.(grade, { reduced: mode === 'reduced' });
  return inst || null;
}
