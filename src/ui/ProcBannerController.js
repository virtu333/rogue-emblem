/**
 * ProcBannerController -- combat proc announcements.
 *
 * Three visual tiers, all color-coded via ProcVisualTheme:
 *  - showStrikeProcChips: per-strike name chips floating above the unit the
 *    proc belongs to (striker for offense/arts, target for defense procs)
 *  - showSkillBanner: full-width sliding banner for pre-combat 'skill'
 *    events (Astra, Vantage, Desperation)
 *  - showCutIn: portrait cut-in strip for crits and Legendary weapon arts,
 *    throttled so multi-strike exchanges can't chain them
 *
 * Banners and cut-ins are screen-anchored (depth >= 500 auto-pins to the UI
 * camera on mobile); chips live in world space above their unit. All awaited
 * tweens go through scene._awaitSceneTween so scene shutdown can't leak.
 */

import { themeFor, dominantCategory, classifySkillEventName } from './ProcVisualTheme.js';

const CHIP_DEPTH = 301; // world-space, just above floating damage text (300)
const BANNER_DEPTH = 500; // screen-space; >= 500 auto-pins to the mobile UI camera
const CUTIN_THROTTLE_MS = 1500;

export class ProcBannerController {
  constructor(scene) {
    this.scene = scene;
    this._lastCutInAt = -Infinity;
    this._live = new Set(); // containers still on screen (for destroy())
  }

  _reduced() {
    return this.scene._isReducedEffects();
  }

  _track(obj) {
    this._live.add(obj);
    return obj;
  }

  _kill(obj) {
    this._live.delete(obj);
    if (obj?.scene) obj.destroy();
  }

  destroy() {
    for (const obj of this._live) {
      if (obj?.scene) obj.destroy();
    }
    this._live.clear();
  }

  /**
   * Floating name chips for a strike's procs. `split` comes from
   * splitStrikeActivations: striker-side chips sit above the striker,
   * defense chips above the target (higher, clear of the damage number).
   * Fire-and-forget.
   */
  showStrikeProcChips(split, striker, target) {
    const reduced = this._reduced();
    const sides = [
      { entries: split?.striker, unit: striker, dy: -26 },
      { entries: split?.target, unit: target, dy: -44 },
    ];
    for (const { entries, unit, dy } of sides) {
      if (!entries?.length || !unit) continue;
      const theme = themeFor(dominantCategory(entries));
      const pos = this.scene.grid.gridToPixel(unit.col, unit.row);
      const chip = this._track(
        this.scene.add
          .text(pos.x, pos.y + dy, entries.map((e) => e.name).join(', '), {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: theme.color,
            fontStyle: 'bold',
            backgroundColor: '#000000cc',
            padding: { x: 4, y: 2 },
          })
          .setOrigin(0.5)
          .setDepth(CHIP_DEPTH)
          .setScale(reduced ? 1 : 0.7),
      );
      if (!reduced) {
        this.scene.tweens.add({
          targets: chip,
          scale: 1,
          duration: 110,
          ease: 'Back.easeOut',
        });
      }
      this.scene.tweens.add({
        targets: chip,
        y: pos.y + dy - 14,
        alpha: 0,
        delay: reduced ? 0 : 140,
        duration: reduced ? 260 : 700,
        onComplete: () => this._kill(chip),
      });
    }
  }

  /**
   * Full-width sliding banner for a pre-combat 'skill' event
   * ({ name, unit }). Awaited: slides in from the left, holds, exits right.
   */
  async showSkillBanner(event, skillsData) {
    const scene = this.scene;
    const cam = scene.cameras.main;
    const w = cam.width;
    const y = cam.centerY - 80;
    const reduced = this._reduced();
    const theme = themeFor(classifySkillEventName(event.name, skillsData));

    const bg = scene.add.rectangle(w / 2, 0, w, 26, 0x000000, 0.82);
    const edgeTop = scene.add.rectangle(w / 2, -13, w, 2, theme.accent, 0.9);
    const edgeBot = scene.add.rectangle(w / 2, 13, w, 2, theme.accent, 0.9);
    const text = scene.add
      .text(w / 2, 0, `${event.unit} -- ${event.name}!`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: theme.color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const banner = this._track(
      scene.add.container(-w, y, [bg, edgeTop, edgeBot, text]).setDepth(BANNER_DEPTH),
    );
    scene._pinToScreen(banner);

    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      this._kill(banner);
    };

    await scene._awaitSceneTween(
      {
        targets: banner,
        x: 0,
        duration: reduced ? 90 : 150,
        ease: 'Cubic.easeOut',
      },
      { label: 'proc_banner_in', onCancel: kill },
    );
    if (dead || !banner.scene) return;
    await scene._awaitSceneDelay(reduced ? 180 : 380, { label: 'proc_banner_hold' });
    if (dead || !banner.scene) return;
    await scene._awaitSceneTween(
      {
        targets: banner,
        x: w,
        duration: reduced ? 90 : 150,
        ease: 'Cubic.easeIn',
        onComplete: kill,
      },
      { label: 'proc_banner_out', onCancel: kill },
    );
    kill();
  }

  /**
   * Portrait cut-in strip for a crit or Legendary weapon art. Awaited.
   * Skipped entirely in reduced-effects mode and throttled to one per
   * CUTIN_THROTTLE_MS so multi-strike exchanges can't chain them.
   * `side` is 'left' (player) or 'right' (enemy).
   */
  async showCutIn({ unitName, portraitKey, label, category, side }) {
    const scene = this.scene;
    if (this._reduced()) return;
    const now = scene.time?.now ?? 0;
    if (now - this._lastCutInAt < CUTIN_THROTTLE_MS) return;
    this._lastCutInAt = now;

    const cam = scene.cameras.main;
    const w = cam.width;
    const y = cam.centerY - 86;
    const theme = themeFor(category);
    const fromLeft = side !== 'right';

    const strip = scene.add.rectangle(w / 2, 0, w, 72, 0x000000, 0.6);
    const edgeTop = scene.add.rectangle(w / 2, -36, w, 3, theme.accent, 0.95);
    const edgeBot = scene.add.rectangle(w / 2, 36, w, 3, theme.accent, 0.95);
    const parts = [strip, edgeTop, edgeBot];

    const px = fromLeft ? 70 : w - 70;
    let textX = fromLeft ? px + 46 : px - 46;
    if (portraitKey && scene.textures.exists(portraitKey)) {
      parts.push(scene.add.image(px, 0, portraitKey).setDisplaySize(64, 64));
    } else {
      textX = fromLeft ? 24 : w - 24;
    }
    const labelText = scene.add
      .text(textX, -10, label, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: theme.color,
        fontStyle: 'bold',
      })
      .setOrigin(fromLeft ? 0 : 1, 0.5);
    const nameText = scene.add
      .text(textX, 10, unitName || '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
      })
      .setOrigin(fromLeft ? 0 : 1, 0.5);
    parts.push(labelText, nameText);

    const slide = fromLeft ? -120 : 120;
    const cutIn = this._track(
      scene.add
        .container(slide, y, parts)
        .setDepth(BANNER_DEPTH + 1)
        .setAlpha(0),
    );
    scene._pinToScreen(cutIn);

    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      this._kill(cutIn);
    };

    await scene._awaitSceneTween(
      {
        targets: cutIn,
        x: 0,
        alpha: 1,
        duration: 140,
        ease: 'Cubic.easeOut',
      },
      { label: 'proc_cutin_in', onCancel: kill },
    );
    if (dead || !cutIn.scene) return;
    await scene._awaitSceneDelay(240, { label: 'proc_cutin_hold' });
    if (dead || !cutIn.scene) return;
    await scene._awaitSceneTween(
      {
        targets: cutIn,
        x: -slide / 3,
        alpha: 0,
        duration: 140,
        ease: 'Cubic.easeIn',
        onComplete: kill,
      },
      { label: 'proc_cutin_out', onCancel: kill },
    );
    kill();
  }
}
