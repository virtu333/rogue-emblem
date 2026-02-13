// TitleScene — Animated pixel-art title screen

import Phaser from 'phaser';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { HowToPlayOverlay } from '../ui/HowToPlayOverlay.js';
import { HelpOverlay } from '../ui/HelpOverlay.js';
import { MUSIC } from '../utils/musicConfig.js';
import { signOut } from '../cloud/supabaseClient.js';
import { pushMeta } from '../cloud/CloudSync.js';
import { getSlotCount, getNextAvailableSlot, setActiveSlot, getMetaKey, clearAllSlotData } from '../engine/SlotManager.js';
import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { logStartupSummary, markStartup } from '../utils/startupTelemetry.js';
import { startDeferredAssetWarmup } from '../utils/assetWarmup.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';

// --- Constants ---
const W = 640, H = 480, PIXEL = 2;
const FONT = '"Press Start 2P", monospace';

// Colors
const GOLD = '#e8b849';
const GOLD_LIGHT = '#f5d77a';
const GOLD_DARK = '#a67c2e';
const TEXT_SUB = '#8888aa';
const BTN_BG = 0x12111f;
const BTN_BORDER = 0x3a3660;
const MORE_INFO_URL = 'https://github.com/virtu333/rogue-emblem';

// --- Background drawing helpers (all operate on a 2D canvas context) ---

function pixelRect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  const px = Math.round(x / PIXEL) * PIXEL;
  const py = Math.round(y / PIXEL) * PIXEL;
  const pw = Math.max(PIXEL, Math.round(w / PIXEL) * PIXEL);
  const ph = Math.max(PIXEL, Math.round(h / PIXEL) * PIXEL);
  ctx.fillRect(px, py, pw, ph);
}

function drawSky(ctx) {
  const bands = [
    { stop: 0,    color: [10, 12, 30] },
    { stop: 0.2,  color: [18, 14, 50] },
    { stop: 0.35, color: [35, 20, 65] },
    { stop: 0.45, color: [60, 28, 80] },
    { stop: 0.52, color: [90, 40, 70] },
    { stop: 0.56, color: [120, 55, 50] },
    { stop: 0.6,  color: [80, 35, 60] },
  ];
  const bandHeight = PIXEL * 3;
  for (let y = 0; y < H * 0.65; y += bandHeight) {
    const t = y / (H * 0.65);
    let c0, c1, lt;
    for (let i = 0; i < bands.length - 1; i++) {
      if (t >= bands[i].stop && t <= bands[i + 1].stop) {
        c0 = bands[i].color;
        c1 = bands[i + 1].color;
        lt = (t - bands[i].stop) / (bands[i + 1].stop - bands[i].stop);
        break;
      }
    }
    if (!c0) { c0 = bands[bands.length - 1].color; c1 = c0; lt = 0; }
    const r = Math.round(c0[0] + (c1[0] - c0[0]) * lt);
    const g = Math.round(c0[1] + (c1[1] - c0[1]) * lt);
    const b = Math.round(c0[2] + (c1[2] - c0[2]) * lt);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, y, W, bandHeight + 1);
  }
}

function drawStars(ctx, time, stars) {
  stars.forEach(s => {
    const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * s.twinkleSpeed * 0.06 + s.phase));
    const alpha = s.brightness * twinkle;
    ctx.fillStyle = `rgba(220, 210, 255, ${alpha})`;
    const sz = Math.round(s.size / PIXEL) * PIXEL;
    ctx.fillRect(
      Math.round(s.x / PIXEL) * PIXEL,
      Math.round(s.y / PIXEL) * PIXEL,
      sz, sz
    );
  });
}

function drawHorizonGlow(ctx) {
  const y = H * 0.5;
  const grad = ctx.createRadialGradient(W * 0.5, y, 0, W * 0.5, y, W * 0.4);
  grad.addColorStop(0, 'rgba(120, 50, 40, 0.15)');
  grad.addColorStop(0.5, 'rgba(80, 30, 60, 0.08)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, y - W * 0.3, W, W * 0.6);
}

function drawClouds(ctx, clouds) {
  clouds.forEach(c => {
    c.x += c.speed;
    if (c.x > W + c.w) c.x = -c.w * 2;
    const bw = PIXEL * 4;
    const numBlobs = Math.floor(c.w / bw);
    for (let i = 0; i < numBlobs; i++) {
      const bx = c.x + i * bw;
      const heightMod = Math.sin((i / numBlobs) * Math.PI);
      const bh = c.h * heightMod;
      pixelRect(ctx, bx, c.y - bh / 2, bw, bh + PIXEL, `rgba(80, 50, 120, ${c.opacity})`);
    }
  });
}

function drawMountainLayer(ctx, baseY, height, color, seed, jaggedness) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += PIXEL) {
    const n1 = Math.sin(x * 0.003 + seed) * height * 0.5;
    const n2 = Math.sin(x * 0.008 + seed * 2.3) * height * 0.25;
    const n3 = Math.sin(x * 0.02 + seed * 5.1) * height * jaggedness;
    const y = baseY - Math.abs(n1 + n2 + n3);
    ctx.lineTo(x, Math.round(y / PIXEL) * PIXEL);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
}

function drawCastle(ctx, time) {
  const cx = W * 0.5;
  const baseY = H * 0.52;
  const p = PIXEL;
  const c = '#1c1838';
  const cDark = '#14112a';

  // Main keep
  pixelRect(ctx, cx - p * 12, baseY - p * 28, p * 24, p * 28, c);
  // Top battlement
  for (let i = 0; i < 6; i++) {
    pixelRect(ctx, cx - p * 12 + i * p * 4, baseY - p * 32, p * 3, p * 4, c);
  }

  // Left tower
  pixelRect(ctx, cx - p * 20, baseY - p * 36, p * 10, p * 36, c);
  pixelRect(ctx, cx - p * 22, baseY - p * 40, p * 14, p * 4, c);
  pixelRect(ctx, cx - p * 18, baseY - p * 44, p * 6, p * 4, c);
  pixelRect(ctx, cx - p * 16, baseY - p * 47, p * 2, p * 3, c);

  // Right tower
  pixelRect(ctx, cx + p * 10, baseY - p * 36, p * 10, p * 36, c);
  pixelRect(ctx, cx + p * 8, baseY - p * 40, p * 14, p * 4, c);
  pixelRect(ctx, cx + p * 12, baseY - p * 44, p * 6, p * 4, c);
  pixelRect(ctx, cx + p * 14, baseY - p * 47, p * 2, p * 3, c);

  // Center spire
  pixelRect(ctx, cx - p * 3, baseY - p * 38, p * 6, p * 10, c);
  pixelRect(ctx, cx - p * 2, baseY - p * 44, p * 4, p * 6, c);
  pixelRect(ctx, cx - p * 1, baseY - p * 50, p * 2, p * 6, c);

  // Gate
  pixelRect(ctx, cx - p * 4, baseY - p * 10, p * 8, p * 10, cDark);
  pixelRect(ctx, cx - p * 3, baseY - p * 9, p * 6, p * 9, '#0a0918');

  // Window lights
  const windows = [
    [-16, -30], [-16, -22], [-16, -14],
    [15, -30], [15, -22], [15, -14],
    [-6, -20], [5, -20],
    [-6, -14], [5, -14],
    [0, -42],
  ];
  windows.forEach(([wx, wy]) => {
    const flicker = 0.7 + 0.3 * Math.sin(time * 0.003 + wx * 0.5 + wy);
    pixelRect(ctx, cx + wx * p, baseY + wy * p, p * 2, p * 2,
      `rgba(245, 215, 122, ${0.6 * flicker})`);
    ctx.fillStyle = `rgba(245, 200, 100, ${0.15 * flicker})`;
    ctx.fillRect(cx + wx * p - p, baseY + wy * p - p, p * 4, p * 4);
  });

  // Walls
  pixelRect(ctx, cx - p * 45, baseY - p * 8, p * 25, p * 12, c);
  pixelRect(ctx, cx + p * 20, baseY - p * 8, p * 25, p * 12, c);
  for (let i = 0; i < 6; i++) {
    pixelRect(ctx, cx - p * 45 + i * p * 4, baseY - p * 11, p * 3, p * 3, c);
    pixelRect(ctx, cx + p * 20 + i * p * 4, baseY - p * 11, p * 3, p * 3, c);
  }

  // Small wall towers
  pixelRect(ctx, cx - p * 48, baseY - p * 16, p * 6, p * 20, c);
  pixelRect(ctx, cx - p * 49, baseY - p * 19, p * 8, p * 3, c);
  pixelRect(ctx, cx + p * 42, baseY - p * 16, p * 6, p * 20, c);
  pixelRect(ctx, cx + p * 41, baseY - p * 19, p * 8, p * 3, c);
}

function drawForeground(ctx) {
  const baseY = H * 0.72;

  // Mid-ground hills
  ctx.fillStyle = '#111a14';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += PIXEL) {
    const y = baseY + Math.sin(x * 0.004) * H * 0.04 + Math.sin(x * 0.01) * H * 0.015;
    ctx.lineTo(x, Math.round(y / PIXEL) * PIXEL);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Near foreground
  const fgY = H * 0.82;
  ctx.fillStyle = '#0d150f';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += PIXEL) {
    const y = fgY + Math.sin(x * 0.006 + 1) * H * 0.03 + Math.sin(x * 0.015 + 3) * H * 0.01;
    ctx.lineTo(x, Math.round(y / PIXEL) * PIXEL);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  // Closest ground
  ctx.fillStyle = '#0a100c';
  ctx.fillRect(0, H * 0.92, W, H * 0.1);

  // Grass tufts
  const grassColor = '#1a2e1a';
  for (let x = 0; x < W; x += PIXEL * 6) {
    const hash = Math.sin(x * 123.456) * 43758.5453;
    if ((hash - Math.floor(hash)) > 0.5) {
      const gy = H * 0.82 + Math.sin(x * 0.006 + 1) * H * 0.03 - PIXEL * 2;
      pixelRect(ctx, x, gy, PIXEL, PIXEL * 3, grassColor);
      pixelRect(ctx, x + PIXEL, gy - PIXEL, PIXEL, PIXEL * 2, grassColor);
    }
  }

  // Tree silhouettes
  const trees = [
    { x: 0.08, h: 18 }, { x: 0.12, h: 22 }, { x: 0.15, h: 16 },
    { x: 0.25, h: 14 }, { x: 0.28, h: 20 },
    { x: 0.7, h: 24 }, { x: 0.73, h: 18 }, { x: 0.76, h: 22 },
    { x: 0.85, h: 16 }, { x: 0.88, h: 20 }, { x: 0.92, h: 14 },
  ];
  trees.forEach(t => {
    const tx = W * t.x;
    const hillY = baseY + Math.sin(tx * 0.004) * H * 0.04 + Math.sin(tx * 0.01) * H * 0.015;
    const treeColor = '#0e1610';
    const p = PIXEL;
    const h = t.h;
    pixelRect(ctx, tx, hillY - h * p * 0.4, p * 2, h * p * 0.4, treeColor);
    for (let i = 0; i < 4; i++) {
      const w = (4 - i) * 2;
      pixelRect(ctx, tx - w * p / 2 + p, hillY - h * p * 0.4 - i * p * 3, w * p, p * 3, treeColor);
    }
  });
}

function drawParticles(ctx, time, particles) {
  particles.forEach(p => {
    p.life += p.speed;
    if (p.life > 1) {
      p.life = 0;
      p.x = Math.random() * W;
      p.y = H * 0.6 + Math.random() * H * 0.3;
    }
    p.x += p.vx + Math.sin(time * 0.001 + p.x) * 0.2;
    p.y += p.vy;

    const alpha = Math.sin(p.life * Math.PI) * 0.6;
    const glow = PIXEL * 3;
    ctx.fillStyle = `rgba(200, 220, 120, ${alpha * 0.15})`;
    ctx.fillRect(p.x - glow, p.y - glow, glow * 2, glow * 2);
    ctx.fillStyle = `rgba(230, 240, 150, ${alpha})`;
    const sz = Math.round(p.size / PIXEL) * PIXEL;
    ctx.fillRect(
      Math.round(p.x / PIXEL) * PIXEL,
      Math.round(p.y / PIXEL) * PIXEL,
      sz, sz
    );
  });
}

// --- State factory functions ---

function createStars() {
  const arr = [];
  for (let i = 0; i < 80; i++) {
    arr.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.45,
      size: Math.random() < 0.3 ? PIXEL * 1.5 : PIXEL,
      brightness: Math.random(),
      twinkleSpeed: 0.005 + Math.random() * 0.02,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return arr;
}

function createClouds() {
  const arr = [];
  for (let i = 0; i < 5; i++) {
    arr.push({
      x: Math.random() * W * 1.5 - W * 0.25,
      y: H * 0.15 + Math.random() * H * 0.2,
      w: 60 + Math.random() * 120,
      h: 15 + Math.random() * 20,
      speed: 0.08 + Math.random() * 0.15,
      opacity: 0.06 + Math.random() * 0.1,
    });
  }
  return arr;
}

function createParticles() {
  const arr = [];
  for (let i = 0; i < 15; i++) {
    arr.push({
      x: Math.random() * W,
      y: H * 0.6 + Math.random() * H * 0.35,
      size: PIXEL * 0.8,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -0.1 - Math.random() * 0.3,
      life: Math.random(),
      speed: 0.003 + Math.random() * 0.005,
    });
  }
  return arr;
}

// --- Menu button builder ---

function createMenuButton(scene, x, y, label, onClick, delay, options = {}) {
  const btnW = options.width || 240;
  const btnH = options.height || 42;
  const fontSize = options.fontSize || '11px';
  const letterSpacing = options.letterSpacing !== undefined ? options.letterSpacing : 2;

  const container = scene.add.container(x, y).setDepth(20).setAlpha(0);

  // Background
  const bg = scene.add.graphics();
  bg.fillStyle(BTN_BG, 1);
  bg.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);
  bg.lineStyle(2, BTN_BORDER, 1);
  bg.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH);
  container.add(bg);

  // Label
  const text = scene.add.text(0, 0, label, {
    fontFamily: FONT, fontSize: fontSize, color: '#cccccc',
    letterSpacing: letterSpacing,
  }).setOrigin(0.5);
  container.add(text);

  // Cursor arrow (hidden)
  const cursor = scene.add.text(-btnW / 2 + 12, 0, '\u25b6', {
    fontFamily: FONT, fontSize: options.fontSize || '10px', color: GOLD,
  }).setOrigin(0, 0.5).setAlpha(0);
  if (btnW < 150) cursor.setVisible(false); // Hide arrow on small buttons
  container.add(cursor);

  // Corner accents (hidden)
  const corners = scene.add.graphics();
  corners.setAlpha(0);
  // Top-left L
  corners.lineStyle(2, 0xa67c2e, 1);
  corners.beginPath();
  corners.moveTo(-btnW / 2, -btnH / 2 + 6);
  corners.lineTo(-btnW / 2, -btnH / 2);
  corners.lineTo(-btnW / 2 + 6, -btnH / 2);
  corners.strokePath();
  // Bottom-right L
  corners.beginPath();
  corners.moveTo(btnW / 2, btnH / 2 - 6);
  corners.lineTo(btnW / 2, btnH / 2);
  corners.lineTo(btnW / 2 - 6, btnH / 2);
  corners.strokePath();
  container.add(corners);

  // Hit zone
  const hitZone = scene.add.rectangle(0, 0, btnW, btnH, 0x000000, 0)
    .setInteractive({ useHandCursor: true });
  container.add(hitZone);

  // Hover
  hitZone.on('pointerover', () => {
    bg.clear();
    bg.fillStyle(0xe8b849, 0.06);
    bg.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);
    bg.lineStyle(2, 0xe8b849, 1);
    bg.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH);
    text.setColor(GOLD_LIGHT);
    cursor.setAlpha(1);
    corners.setAlpha(1);
    scene.tweens.add({ targets: container, scaleX: 1.02, scaleY: 1.02, duration: 80 });
  });

  hitZone.on('pointerout', () => {
    bg.clear();
    bg.fillStyle(BTN_BG, 1);
    bg.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);
    bg.lineStyle(2, BTN_BORDER, 1);
    bg.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH);
    text.setColor('#cccccc');
    cursor.setAlpha(0);
    corners.setAlpha(0);
    scene.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 80 });
  });

  hitZone.on('pointerdown', () => {
    // Fire action immediately; don't gate scene transitions on tween completion.
    onClick();
    scene.tweens.add({
      targets: container, scaleX: 0.98, scaleY: 0.98, duration: 60,
      yoyo: true,
    });
  });

  // Entry animation: fade + slide from left
  scene.tweens.add({
    targets: container,
    alpha: { from: 0, to: 1 },
    x: { from: x - 20, to: x },
    duration: 400,
    ease: 'Power2',
    delay: delay,
  });

  return container;
}

// =============================================
// TitleScene
// =============================================

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  init(data) {
    this.gameData = data.gameData || data;
    this.isTransitioning = false;
  }

  create() {
    markStartup('title_scene_create');
    requestAnimationFrame(() => {
      markStartup('first_interactive_frame');
      logStartupSummary({ reason: 'title_first_interactive' });
      startDeferredAssetWarmup(this);
    });

    const cx = W / 2;

    // --- Music ---
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.title, this);

    // --- Cleanup on scene exit ---
    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
      // NOTE: Do NOT remove textures here — shutdown fires BEFORE Phaser
      // destroys display objects. Removing textures while Images still
      // reference them crashes the scene transition silently.
      // Stale textures are cleaned up in create() on re-entry instead.
      this.bgCtx = null;
      this.bgTexture = null;
      this.howToPlayOverlay = null;
      this.helpOverlay = null;
    });

    // --- Animated background ---
    // Remove stale textures if scene is re-entered
    ['titleBg', 'titleVignette', 'titleScanlines'].forEach(key => {
      if (this.textures.exists(key)) this.textures.remove(key);
    });

    this.bgTexture = this.textures.createCanvas('titleBg', W, H);
    this.bgCtx = this.bgTexture.getContext();
    this.add.image(cx, H / 2, 'titleBg').setDepth(0);

    this.stars = createStars();
    this.clouds = createClouds();
    this.particles = createParticles();

    // Draw first frame immediately so there's no flash of empty background
    this._drawBackground(0);

    // --- Vignette overlay (static) ---
    const vigTex = this.textures.createCanvas('titleVignette', W, H);
    const vigCtx = vigTex.getContext();
    const vigGrad = vigCtx.createRadialGradient(cx, H / 2, H * 0.3, cx, H / 2, H * 0.75);
    vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad.addColorStop(1, 'rgba(0,0,0,0.5)');
    vigCtx.fillStyle = vigGrad;
    vigCtx.fillRect(0, 0, W, H);
    vigTex.refresh();
    this.add.image(cx, H / 2, 'titleVignette').setDepth(1);

    // --- Scanlines overlay (static) ---
    const scanTex = this.textures.createCanvas('titleScanlines', W, H);
    const scanCtx = scanTex.getContext();
    scanCtx.fillStyle = 'rgba(0,0,0,0.03)';
    for (let y = 2; y < H; y += 4) {
      scanCtx.fillRect(0, y, W, 2);
    }
    scanTex.refresh();
    this.add.image(cx, H / 2, 'titleScanlines').setDepth(2);

    // --- Title block ---
    // Shadow text (3D emboss)
    this.add.text(cx, 70 + 4, 'ROGUE EMBLEM', {
      fontFamily: FONT, fontSize: '28px', color: '#7a5520',
    }).setOrigin(0.5).setDepth(9).setAlpha(0);

    // Main title
    const titleText = this.add.text(cx, 70, 'ROGUE EMBLEM', {
      fontFamily: FONT, fontSize: '28px', color: GOLD,
      shadow: { offsetX: 0, offsetY: 0, color: 'rgba(232,184,73,0.5)', blur: 20, fill: true },
    }).setOrigin(0.5).setDepth(10).setAlpha(0);

    // Subtitle
    const subtitleText = this.add.text(cx, 110, 'TACTICAL ROGUELIKE', {
      fontFamily: FONT, fontSize: '10px', color: TEXT_SUB,
      letterSpacing: 4,
      shadow: { offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.8)', blur: 8, fill: true },
    }).setOrigin(0.5).setDepth(10).setAlpha(0);

    // Alpha Testing tag
    const alphaTag = this.add.text(cx, 132, 'ALPHA TESTING', {
      fontFamily: FONT, fontSize: '8px', color: '#ff6666',
      letterSpacing: 2,
      backgroundColor: '#220000aa',
      padding: { x: 8, y: 3 },
    }).setOrigin(0.5).setDepth(10).setAlpha(0);

    // Sword divider
    const divider = this.add.graphics().setDepth(10).setAlpha(0);
    const divW = 200;
    divider.lineStyle(1, 0xa67c2e, 1);
    // Left line
    divider.beginPath();
    divider.moveTo(cx - divW / 2, 154);
    divider.lineTo(cx - 15, 154);
    divider.strokePath();
    // Right line
    divider.beginPath();
    divider.moveTo(cx + 15, 154);
    divider.lineTo(cx + divW / 2, 154);
    divider.strokePath();

    const swordIcon = this.add.text(cx, 154, '\u2694', {
      fontFamily: FONT, fontSize: '12px', color: GOLD_DARK,
      shadow: { offsetX: 0, offsetY: 0, color: 'rgba(232,184,73,0.3)', blur: 8, fill: true },
    }).setOrigin(0.5).setDepth(10).setAlpha(0);

    // Title shadow (get ref)
    const titleShadow = this.children.list.find(
      c => c.type === 'Text' && c.text === 'ROGUE EMBLEM' && c.depth === 9
    );

    // Entry animations
    this.tweens.add({
      targets: [titleText, titleShadow],
      alpha: 1, y: { from: 50, to: titleText.y },
      duration: 1500, ease: 'Power2',
    });
    this.tweens.add({
      targets: subtitleText, alpha: 1,
      duration: 1000, ease: 'Power2', delay: 500,
    });
    this.tweens.add({
      targets: alphaTag, alpha: 1,
      duration: 1000, ease: 'Power2', delay: 650,
    });
    this.tweens.add({
      targets: [divider, swordIcon], alpha: 1,
      duration: 1000, ease: 'Power2', delay: 800,
    });

    // --- Menu buttons ---
    let menuY = 190;
    const btnDelay = 1000;
    const btnGap = 42;
    const hasSlots = getSlotCount() > 0;

    createMenuButton(this, cx, menuY, 'NEW GAME', () => this.runMenuTransition(() => this.handleNewGame()), btnDelay);
    menuY += btnGap;

    let delayIdx = 1;

    // CONTINUE button (if slots exist)
    if (hasSlots) {
      createMenuButton(this, cx, menuY, 'CONTINUE', () => this.runMenuTransition(
        () => transitionToScene(this, 'SlotPicker', { gameData: this.gameData }, { reason: TRANSITION_REASONS.CONTINUE }),
      ), btnDelay + delayIdx * 150);
      menuY += btnGap;
      delayIdx++;
    }

    // HOW TO PLAY button
    const htpBtn = createMenuButton(this, cx, menuY, 'HOW TO PLAY', () => {
      if (this.howToPlayOverlay?.visible) return;
      this.howToPlayOverlay = new HowToPlayOverlay(this, () => {
        this.howToPlayOverlay = null;
        try { localStorage.setItem('emblem_rogue_seen_how_to_play', '1'); } catch (_) {}
      });
      this.howToPlayOverlay.show();
    }, btnDelay + delayIdx * 150);
    menuY += btnGap;
    delayIdx++;

    createMenuButton(this, cx, menuY, 'MORE INFO', () => {
      if (this.helpOverlay?.visible) return;
      this.helpOverlay = new HelpOverlay(this, () => {
        this.helpOverlay = null;
      });
      this.helpOverlay.show();
    }, btnDelay + delayIdx * 150);
    menuY += btnGap;
    delayIdx++;

    // First-run "NEW" badge
    try {
      if (!localStorage.getItem('emblem_rogue_seen_how_to_play')) {
        const newBadge = this.add.text(135, 0, 'NEW', {
          fontFamily: FONT, fontSize: '8px', color: '#ff6666',
          backgroundColor: '#330000', padding: { x: 4, y: 2 },
        }).setOrigin(0, 0.5).setDepth(21);
        htpBtn.add(newBadge);
        this.tweens.add({
          targets: newBadge, alpha: { from: 1, to: 0.3 },
          duration: 800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }
    } catch (_) {}

    createMenuButton(this, cx, menuY, 'SETTINGS', () => {
      if (this.settingsOverlay?.visible) return;
      this.settingsOverlay = new SettingsOverlay(this, null);
      this.settingsOverlay.show();
    }, btnDelay + delayIdx * 150);
    menuY += btnGap;
    delayIdx++;

    const cloud = this.registry.get('cloud');
    if (cloud) {
      // Small Log Out button in top-right
      createMenuButton(this, W - 70, 30, 'LOG OUT', async () => {
        try { await signOut(); } catch (_) {}
        try {
          clearAllSlotData();
          localStorage.removeItem('emblem_rogue_settings');
        } catch (_) {}
        location.reload();
      }, btnDelay + delayIdx * 150, { width: 110, height: 28, fontSize: '8px', letterSpacing: 1 });

      // User name near Log Out
      this.add.text(W - 132, 30, cloud.displayName, {
        fontFamily: FONT, fontSize: '7px', color: 'rgba(136,136,170,0.6)',
      }).setOrigin(1, 0.5).setDepth(30);
    }

    // --- Footer ---
    this.add.text(12, H - 16, 'v0.1.0', {
      fontFamily: FONT, fontSize: '7px', color: 'rgba(136,136,170,0.3)',
    }).setDepth(30);

    // Desktop notice
    this.add.text(W / 2, H - 56, 'Best played on desktop | Not optimized for mobile', {
      fontFamily: FONT, fontSize: '9px', color: 'rgba(100,100,120,0.4)',
    }).setOrigin(0.5, 0).setDepth(30);

    const moreInfoText = this.add.text(W - 12, H - 16, 'GITHUB', {
      fontFamily: FONT, fontSize: '7px', color: 'rgba(136,136,170,0.75)',
    }).setOrigin(1, 0).setDepth(30).setInteractive({ useHandCursor: true });
    moreInfoText.on('pointerover', () => moreInfoText.setColor(GOLD_LIGHT));
    moreInfoText.on('pointerout', () => moreInfoText.setColor('rgba(136,136,170,0.75)'));
    moreInfoText.on('pointerdown', () => {
      try {
        window.open(MORE_INFO_URL, '_blank', 'noopener,noreferrer');
      } catch (_) {}
    });
  }

  _drawBackground(time) {
    if (!this.bgCtx) return;
    const ctx = this.bgCtx;
    ctx.clearRect(0, 0, W, H);

    drawSky(ctx);
    drawStars(ctx, time, this.stars);
    drawHorizonGlow(ctx);
    drawClouds(ctx, this.clouds);
    drawMountainLayer(ctx, H * 0.55, H * 0.12, '#141028', 1.0, 0.15);
    drawMountainLayer(ctx, H * 0.58, H * 0.1, '#110e22', 3.5, 0.12);
    drawCastle(ctx, time);
    drawMountainLayer(ctx, H * 0.62, H * 0.06, '#0f0e1e', 7.0, 0.1);
    drawForeground(ctx);
    drawParticles(ctx, time, this.particles);

    this.bgTexture.refresh();
  }

  update(time) {
    this._drawBackground(time);
  }

  async handleNewGame() {
    const nextSlot = getNextAvailableSlot();
    if (!nextSlot) {
      this.showMessage('All 3 save slots are full.\nDelete a slot from Continue to free space.');
      return false;
    }

    const meta = new MetaProgressionManager(this.gameData.metaUpgrades, getMetaKey(nextSlot));
    const cloud = this.registry.get('cloud');
    if (cloud) {
      meta.onSave = (payload) => pushMeta(cloud.userId, nextSlot, payload);
    }
    meta._save();
    this.registry.set('meta', meta);
    setActiveSlot(nextSlot);
    this.registry.set('activeSlot', nextSlot);

    await transitionToScene(this, 'HomeBase', { gameData: this.gameData }, { reason: TRANSITION_REASONS.NEW_GAME });
    return true;
  }

  async runMenuTransition(action) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    if (this.input) this.input.enabled = false;

    try {
      // First click can be both "unlock audio" + "transition". Give unlock a moment.
      await this.ensureAudioUnlocked();

      // Hard-stop title music before scene change; avoids race with unlock/load.
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
      const transitioned = await action();
      if (transitioned === false) {
        this.isTransitioning = false;
        if (this.input) this.input.enabled = true;
        const audio = this.registry.get('audio');
        if (audio) audio.playMusic(MUSIC.title, this);
      }
    } catch (err) {
      console.error('[TitleScene] transition failed', err);
      this.isTransitioning = false;
      if (this.input) this.input.enabled = true;
      this.showMessage('Transition failed. Please click again.');

      // Restore title music when transition fails and we remain in this scene.
      const audio = this.registry.get('audio');
      if (audio) audio.playMusic(MUSIC.title, this);
    }
  }

  async ensureAudioUnlocked(timeoutMs = 200) {
    const sound = this.sound;
    if (!sound?.locked) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      if (typeof sound.once === 'function') {
        sound.once('unlocked', finish);
      }
      try {
        if (typeof sound.unlock === 'function') sound.unlock();
      } catch (_) {}
      this.time.delayedCall(timeoutMs, finish);
    });
  }

  showMessage(text) {
    if (this.msgText) this.msgText.destroy();
    const cx = W / 2;
    this.msgText = this.add.text(cx, 440, text, {
      fontFamily: FONT, fontSize: '9px', color: '#ff8888',
      align: 'center', backgroundColor: '#000000cc', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(50);

    this.time.delayedCall(3000, () => {
      if (this.msgText) { this.msgText.destroy(); this.msgText = null; }
    });
  }

}
