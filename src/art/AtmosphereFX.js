// AtmosphereFX — per-act mood as a camera post-process (WebGL only).
//
// The battlefield stays mid-value and readable; the grade adds a low warm key light
// from the upper-left, a split tone (violet shadows / warm highlights), a vignette that
// sinks the frame edges into ink, and fine grain. Chromatic split appears only where the
// story calls for corruption (late acts, the Deep).
//
// Presentation only: never touches game state. Canvas renderer, tests and
// "Atmosphere: Off" simply skip it. The pipeline class is defined lazily so importing
// this module never needs a real Phaser (unit tests mock it).

import Phaser from 'phaser';
import { ATMOSPHERE_GRADES, gradeToUniforms } from './atmosphereConfig.js';

export { ATMOSPHERE_GRADES, gradeToUniforms };
export const ATMOSPHERE_PIPELINE_KEY = 'AtmosphereFX';

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
uniform vec4 uFrame; // focus rect in texture UV (min.xy, max.xy): the visible battlefield
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
  // Vignette and key light hug the visible battlefield, not the whole canvas, so a
  // small map centered on a desktop frame still gets edges and a light direction.
  vec2 fSize = max(uFrame.zw - uFrame.xy, vec2(0.001));
  vec2 fc = (uv - (uFrame.xy + uFrame.zw) * 0.5) / fSize;
  float fAspect = (fSize.x * uResolution.x) / (fSize.y * uResolution.y);
  float d = length(fc * vec2(fAspect, 1.0));
  float outside = max(abs(fc.x), abs(fc.y)) - 0.5;
  vec3 col;
  // Corruption split lives only in the darkened rim: the battlefield interior (and every
  // unit on it) keeps clean pixels. At most ~uAberration framebuffer pixels.
  float rim = max(smoothstep(0.62, 1.0, d), smoothstep(0.0, 0.08, outside));
  if (uAberration > 0.0 && rim > 0.0) {
    vec2 dir = length(fc) > 0.0001 ? normalize(fc) : vec2(0.0);
    vec2 off = dir * uAberration * rim / uResolution;
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
  float keyT = clamp(0.5 + (-fc.x + fc.y) * 0.9, 0.0, 1.0);
  vec3 keyTint = mix(vec3(0.88, 0.9, 1.04), vec3(1.12, 1.0, 0.84), keyT);
  col *= vec3(1.0) + (keyTint - vec3(1.0)) * uKey * 3.0;
  // Vignette sinks edges toward the shadow hue, never to pure black.
  // Inside the battlefield the vignette is capped so units in corners stay readable;
  // beyond its edge (desktop margins) it sinks fully into ink.
  float v = max(smoothstep(0.45, 1.1, d) * 0.55, smoothstep(0.0, 0.06, outside)) * uVignette;
  vec3 ink = vec3(0.035, 0.03, 0.05) + uShadow * 0.02;
  col = mix(col, ink, v);
  // Fine luminance-weighted grain.
  if (uGrain > 0.0) {
    float n = hash(uv * uResolution + fract(uTime * 0.0007) * 91.0) - 0.5;
    col += n * uGrain * (1.1 - l);
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

let PipelineClass = null;

/** The pipeline class, built on first use against the real Phaser WebGL renderer. */
function getPipelineClass() {
  if (PipelineClass) return PipelineClass;
  const Base = Phaser?.Renderer?.WebGL?.Pipelines?.PostFXPipeline;
  if (!Base) return null;
  PipelineClass = class AtmospherePipeline extends Base {
    constructor(game) {
      super({ game, name: ATMOSPHERE_PIPELINE_KEY, fragShader: FRAG });
      this._u = gradeToUniforms(ATMOSPHERE_GRADES.act1);
      this.frameProvider = null;
    }

    setGrade(grade, opts) {
      this._u = gradeToUniforms(grade, opts);
      return this;
    }

    onPreRender() {
      const u = this._u;
      // Still grain (Reduced motion) keeps one fixed noise pattern instead of crawling.
      this.set1f('uTime', u.animatedGrain ? this.game.loop.time : 0);
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
      const f = this.frameProvider?.() || null;
      if (f) this.set4f('uFrame', f[0], f[1], f[2], f[3]);
      else this.set4f('uFrame', 0, 0, 1, 1);
    }

    onDraw(renderTarget) {
      this.set2f('uResolution', renderTarget.width, renderTarget.height);
      this.bindAndDraw(renderTarget);
    }
  };
  return PipelineClass;
}

/** True when the game renders through WebGL with post-pipeline support. */
export function atmosphereSupported(game) {
  const renderer = game?.renderer;
  const pipelines = renderer?.pipelines;
  if (!renderer || !pipelines || typeof pipelines.addPostPipeline !== 'function') return false;
  if (!renderer.gl) return false;
  return Boolean(Phaser?.Renderer?.WebGL?.Pipelines?.PostFXPipeline);
}

/** Register once per game; returns false on the Canvas renderer or without WebGL. */
export function registerAtmosphere(game) {
  if (!atmosphereSupported(game)) return false;
  const pipelines = game.renderer.pipelines;
  if (!pipelines.postPipelineClasses?.has?.(ATMOSPHERE_PIPELINE_KEY)) {
    const Cls = getPipelineClass();
    if (!Cls) return false;
    pipelines.addPostPipeline(ATMOSPHERE_PIPELINE_KEY, Cls);
  }
  return true;
}

function pipelineOf(camera) {
  const pipe = camera?.getPostPipeline?.(ATMOSPHERE_PIPELINE_KEY);
  return (Array.isArray(pipe) ? pipe[0] : pipe) || null;
}

/** Remove only our post pipeline from a camera (other post effects stay). */
export function clearAtmosphere(camera) {
  if (!camera || !pipelineOf(camera)) return;
  camera.removePostPipeline?.(ATMOSPHERE_PIPELINE_KEY);
}

/**
 * Apply a grade object to a camera. `mode`: 'full' | 'reduced' | 'off'.
 * Returns the pipeline instance (or null when unavailable/off).
 */
export function applyAtmosphere(
  camera,
  grade,
  { mode = 'full', animatedGrain = true, frameProvider = null } = {},
) {
  if (!camera || mode === 'off') {
    clearAtmosphere(camera);
    return null;
  }
  const game = camera.scene?.sys?.game;
  if (!registerAtmosphere(game)) return null;
  const resolved = typeof grade === 'string' ? ATMOSPHERE_GRADES[grade] : grade;
  let inst = pipelineOf(camera);
  if (!inst) {
    camera.setPostPipeline(ATMOSPHERE_PIPELINE_KEY);
    inst = pipelineOf(camera);
  }
  inst?.setGrade?.(resolved || ATMOSPHERE_GRADES.act1, {
    reduced: mode === 'reduced',
    animatedGrain,
  });
  if (inst) inst.frameProvider = frameProvider;
  return inst;
}
