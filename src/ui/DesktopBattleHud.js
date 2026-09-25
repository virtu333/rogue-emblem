// DesktopBattleHud — Ink & Ember reliquary styling for the desktop battle's canvas HUD.
//
// BattleScene still owns the HUD text objects and every piece of logic that writes
// them (turn/par rating, Eye charges, objective, terrain hover, fog, command buttons);
// the phone DOM HUD reads the same objects. This controller only restyles them and
// lays them onto chamfered ink plates:
//
//   ┌ TURN / PAR (rating color) ┐                       ┌ objective (1–3 lines) ┐
//   │ Eye charges               │                       └───────────────────────┘
//   │ ◐ Shadow +N (Eclipse)     │
//   └───────────────────────────┘ ┌ par tooltip ┐        [ fog chip ]
//   ┌ terrain / unit hover ┐
//   ...
//   [D] Danger  [O] Roster  [E] End Turn   faint hint line          [X] Cancel
//
// Plates redraw only when the text content, visibility or size changes. Never used
// when the touch HUD is active (that HUD hides these labels and renders its own).

import { UI_HEX, UI_PALETTE, UI_FONT_FAMILIES, applyTextResolution } from '../utils/uiStyles.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';

const MARGIN = 6;
const PAD_X = 8;
const PAD_Y = 6;
const CUT = 4; // chamfer
const GAP = 4;
const ECLIPSE_GLYPH = 10; // px reserved left of the Eclipse projection

export const DESKTOP_HINT_TEXT =
  '[N] next ready · [R] Vision · [V]/right-click: details · Esc/off-map: cancel';

const pixel = (size, color) => ({
  fontFamily: UI_FONT_FAMILIES.pixel,
  fontSize: `${size}px`,
  color,
  fontStyle: 'normal',
  backgroundColor: null,
  padding: { x: 0, y: 0 },
});
const body = (size, color, weight = 'normal') => ({
  fontFamily: UI_FONT_FAMILIES.body,
  fontSize: `${size}px`,
  color,
  fontStyle: weight,
  backgroundColor: null,
  padding: { x: 0, y: 0 },
});

function restyle(text, style, { lineSpacing = 2 } = {}) {
  if (!text?.setStyle) return;
  const color = text.style?.color;
  text.setStyle({ ...style, color: color || style.color });
  text.setBackgroundColor?.(null);
  text.setPadding?.(0, 0, 0, 0);
  text.setLineSpacing?.(lineSpacing);
  applyTextResolution(text);
}

function bounds(text) {
  return {
    x: text.x - text.displayWidth * (text.originX ?? 0),
    y: text.y - text.displayHeight * (text.originY ?? 0),
    w: text.displayWidth,
    h: text.displayHeight,
  };
}

export class DesktopBattleHud {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.plates = null;
    this._signature = '';
  }

  create() {
    const s = this.scene;
    if (s._mobileBattleHud || !s.add?.graphics || !s.turnCounterText) return this;
    withPresentationRandom(() => {
      this.plates = s.add.graphics().setDepth(UI_DEPTHS.SCREEN_UI);
    });
    s._pinToScreen?.(this.plates);
    // Boss reading (name · HP · enrage) under the objective: the map shows only its bar.
    if (s.add?.text) {
      withPresentationRandom(() => {
        this.bossText = applyTextResolution(
          s.add.text(0, 0, '', body(11, UI_PALETTE.bad, 'bold')).setOrigin(1, 0),
        ).setVisible(false);
      });
      s._pinToScreen?.(this.bossText);
    }
    const muted = UI_PALETTE.muted;
    restyle(s.turnCounterText, pixel(8, UI_PALETTE.text), { lineSpacing: 4 });
    restyle(s.visionHudText, body(11, UI_PALETTE.info));
    restyle(s.objectiveText, body(11, UI_PALETTE.accentText, 'bold'), { lineSpacing: 3 });
    restyle(s.infoText, body(11, UI_PALETTE.text), { lineSpacing: 3 });
    restyle(s.parTooltipText, body(10, UI_PALETTE.text), { lineSpacing: 2 });
    restyle(s.fogOfWarLabel, pixel(8, UI_PALETTE.warn));
    for (const btn of [s.dangerButton, s.rosterButton, s.endTurnButton, s.cancelButton]) {
      restyle(btn, body(11, UI_PALETTE.text, 'bold'));
      btn?.setOrigin?.(0, 0.5);
    }
    if (s.instructionText2) {
      restyle(s.instructionText2, body(10, muted));
      s.instructionText2.setText(DESKTOP_HINT_TEXT);
      s.instructionText2.setColor(UI_PALETTE.muted);
      s.instructionText2.setOrigin(0.5, 0.5);
    }
    // Text sits one step above its plate.
    for (const t of this._texts()) t.setDepth?.(UI_DEPTHS.SCREEN_UI + 1);
    // Same ink ground as the phone battlefield (one battlefield, two layouts).
    const cam = s.cameras?.main;
    if (cam?.setBackgroundColor) {
      this._background = cam.backgroundColor?.rgba ?? null;
      cam.setBackgroundColor(UI_PALETTE.sunken);
    }
    this.active = true;
    this._onPostUpdate = () => this.layout();
    s.events?.on?.('postupdate', this._onPostUpdate);
    this.layout();
    return this;
  }

  _texts() {
    const s = this.scene;
    return [
      s.turnCounterText,
      s.visionHudText,
      s.eclipseHudText,
      s.objectiveText,
      s.infoText,
      s.parTooltipText,
      s.fogOfWarLabel,
      this.bossText,
      s.dangerButton,
      s.rosterButton,
      s.endTurnButton,
      s.cancelButton,
      s.instructionText2,
    ].filter(Boolean);
  }

  _sig() {
    const s = this.scene;
    const cam = s.cameras?.main;
    let sig = `${cam?.width}x${cam?.height}|${s._bossPresence?.summaryLine?.() || ''}`;
    for (const t of this._texts()) {
      sig += `|${t.visible ? 1 : 0}:${t.text}:${t.scaleX}`;
    }
    return sig;
  }

  /** Position the HUD text and redraw plates (cheap no-op when nothing changed). */
  layout(force = false) {
    if (!this.active) return;
    const sig = this._sig();
    if (!force && sig === this._signature) return;
    this._signature = sig;
    const s = this.scene;
    const cam = s.cameras.main;
    const W = cam.width;
    const H = cam.height;
    const g = this.plates;
    g.clear();

    // Status plate: turn/par over Eye charges.
    const turn = s.turnCounterText;
    const eye = s.visionHudText;
    turn.setOrigin(0, 0).setPosition(MARGIN + PAD_X, MARGIN + PAD_Y + 1);
    let statusBottom = turn.y + turn.displayHeight;
    let statusRight = turn.x + turn.displayWidth;
    if (eye?.visible !== false && eye) {
      eye.setOrigin(0, 0).setPosition(MARGIN + PAD_X, statusBottom + 4);
      statusBottom = eye.y + eye.displayHeight;
      statusRight = Math.max(statusRight, eye.x + eye.displayWidth);
    }
    // The Eclipse projection: a small eclipsed-sun glyph, then "Shadow +N".
    const shadow = s.eclipseHudText;
    let glyph = null;
    if (shadow?.visible && shadow.text) {
      shadow.setOrigin(0, 0).setPosition(MARGIN + PAD_X + ECLIPSE_GLYPH + 3, statusBottom + 5);
      glyph = { x: MARGIN + PAD_X + ECLIPSE_GLYPH / 2, y: shadow.y + shadow.displayHeight / 2 };
      statusBottom = shadow.y + shadow.displayHeight;
      statusRight = Math.max(statusRight, shadow.x + shadow.displayWidth);
    }
    const status = {
      x: MARGIN,
      y: MARGIN,
      w: statusRight - MARGIN + PAD_X,
      h: statusBottom - MARGIN + PAD_Y,
    };
    if (turn.visible) this._plate(status, { gilt: true });
    if (glyph && turn.visible) this._eclipseGlyph(glyph, s._eclipseHud?.tone?.());

    // Par tooltip (hover): to the right of the status plate.
    const tip = s.parTooltipText;
    if (tip?.visible && tip.text) {
      tip.setOrigin(0, 0).setPosition(status.x + status.w + GAP + PAD_X, MARGIN + PAD_Y);
      this._plate(this._pad(bounds(tip)));
    }

    // Terrain / unit hover under the status plate.
    const info = s.infoText;
    if (info?.visible && info.text) {
      info.setOrigin(0, 0).setPosition(MARGIN + PAD_X, status.y + status.h + GAP + PAD_Y);
      this._plate(this._pad(bounds(info)));
    }

    // Objective: top-right.
    const obj = s.objectiveText;
    let rightBottom = MARGIN;
    if (obj?.visible && obj.text) {
      obj.setOrigin(1, 0).setPosition(W - MARGIN - PAD_X, MARGIN + PAD_Y);
      const b = this._pad(bounds(obj));
      this._plate(b, { gilt: true });
      rightBottom = b.y + b.h;
    }
    const boss = this.bossText;
    if (boss) {
      const line = s._bossPresence?.summaryLine?.() || '';
      if (boss.text !== line) boss.setText(line);
      boss.setVisible(Boolean(line) && obj?.visible !== false);
      if (boss.visible) {
        boss.setPosition(W - MARGIN - PAD_X, rightBottom + GAP + PAD_Y);
        const b = this._pad(bounds(boss));
        this._plate(b, { tone: 'danger' });
        rightBottom = b.y + b.h;
      }
    }
    const fog = s.fogOfWarLabel;
    if (fog?.visible) {
      fog.setOrigin(1, 0).setPosition(W - MARGIN - PAD_X, rightBottom + GAP + PAD_Y - 2);
      this._plate(this._pad(bounds(fog), 4), { tone: 'warn' });
    }

    // Bottom: one faint command/hint line.
    const y = H - 12;
    const strip = { x: MARGIN, y: y - 10, w: W - MARGIN * 2, h: 20 };
    const hasBottom = [s.dangerButton, s.instructionText2].some((t) => t?.visible);
    if (hasBottom) this._plate(strip, { faint: true });
    let x = MARGIN + PAD_X;
    for (const btn of [s.dangerButton, s.rosterButton, s.endTurnButton]) {
      if (!btn) continue;
      btn.setPosition(x, y);
      x += btn.displayWidth + 12;
    }
    const cancel = s.cancelButton;
    if (cancel) cancel.setPosition(W - MARGIN - PAD_X - cancel.displayWidth, y);
    const hint = s.instructionText2;
    if (hint) {
      const left = x;
      const right = (cancel ? cancel.x : W - MARGIN) - 12;
      hint.setPosition(Math.round((left + right) / 2), y);
      hint.setVisible(hint.displayWidth <= right - left || !s.dangerButton?.visible);
    }
    // Remember the state this layout produced, so its own tweaks never re-trigger it.
    this._signature = this._sig();
  }

  _pad(b, padX = PAD_X, padY = PAD_Y) {
    return { x: b.x - padX, y: b.y - padY, w: b.w + padX * 2, h: b.h + padY * 2 };
  }

  // The Hollow Sun in miniature: a gold disc bitten by ink. The bite deepens with the
  // projection's tone (held → rising → dark).
  _eclipseGlyph({ x, y }, tone) {
    const g = this.plates;
    const r = ECLIPSE_GLYPH / 2 - 1;
    const bite = tone === 'dark' ? 0.25 : tone === 'rising' ? 0.9 : 1.7;
    g.fillStyle(UI_HEX.accent, 0.35);
    g.fillCircle(x, y, r + 1);
    g.fillStyle(UI_HEX.accentText, 1);
    g.fillCircle(x, y, r);
    g.fillStyle(UI_HEX.void, 1);
    g.fillCircle(x + bite * r * 0.62, y - bite * 0.4, r);
  }

  // Chamfered ink plate with a line border; gilt hairline on primary plates.
  _plate({ x, y, w, h }, { gilt = false, faint = false, tone = null } = {}) {
    const g = this.plates;
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    const c = Math.min(CUT, Math.floor(h / 3));
    const pts = [
      { x: x + c, y },
      { x: x + w - c, y },
      { x: x + w, y: y + c },
      { x: x + w, y: y + h - c },
      { x: x + w - c, y: y + h },
      { x: x + c, y: y + h },
      { x, y: y + h - c },
      { x, y: y + c },
    ];
    g.fillStyle(UI_HEX.panel, faint ? 0.72 : 0.9);
    g.fillPoints(pts, true);
    g.lineStyle(
      1,
      tone === 'warn' ? UI_HEX.warn : tone === 'danger' ? UI_HEX.dangerLine : UI_HEX.line,
      faint ? 0.6 : 0.95,
    );
    g.strokePoints(pts, true);
    if (gilt) {
      g.lineStyle(1, UI_HEX.accent, 0.55);
      g.lineBetween(x + c + 2, y + 1.5, x + w - c - 2, y + 1.5);
    }
  }

  destroy() {
    if (this._onPostUpdate) this.scene?.events?.off?.('postupdate', this._onPostUpdate);
    this._onPostUpdate = null;
    this.plates?.destroy();
    this.plates = null;
    this.bossText?.destroy?.();
    this.bossText = null;
    if (this._background) this.scene?.cameras?.main?.setBackgroundColor?.(this._background);
    this._background = null;
    this.active = false;
  }
}
