import { presentationText } from '../utils/presentationText.js';
/**
 * ProcBannerController -- combat proc announcements.
 *
 * Three visual tiers, all color-coded via ProcVisualTheme:
 *  - showStrikeProcChips: per-strike name chips floating above the unit the
 *    proc belongs to (striker for offense/arts, target for defense procs)
 *  - showSkillBanner: full-width sliding banner for pre-combat 'skill'
 *    events (Astra, Vantage, Desperation)
 *  - showCutIn: diagonal cut-in for crits and Legendary weapon arts (DOM:
 *    the attacker's eyes strip, speed lines, the word in Cinzel; canvas
 *    strip as the no-DOM fallback), throttled so multi-strike exchanges
 *    can't chain them, skipped at Instant speed, static in reduced motion
 *
 * Banners and cut-ins are screen-anchored (depth >= 500 auto-pins to the UI
 * camera on mobile); chips live in world space above their unit. All awaited
 * tweens go through scene._awaitSceneTween so scene shutdown can't leak.
 */

import { themeFor, dominantCategory, classifySkillEventName } from './ProcVisualTheme.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { battleSpeed } from '../utils/combatTiming.js';
import { cutInContent } from './ceremonyContent.js';
import { CeremonyLayer, canRenderCeremony, ceremonyPortrait, el, fitText } from './ceremonyDom.js';
import { portraitCanvasFrame } from './portraitArt.js';

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
    return this.scene._reduceMotion();
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
        presentationText(this.scene, pos.x, pos.y + dy, entries.map((e) => e.name).join(', '), {
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
        y: reduced ? pos.y + dy : pos.y + dy - 14,
        alpha: 0,
        delay: 140,
        duration: 700,
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
    const text = presentationText(scene, w / 2, 0, `${event.unit} -- ${event.name}!`, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: theme.color,
      fontStyle: 'bold',
    }).setOrigin(0.5);
    const banner = this._track(
      scene.add.container(reduced ? 0 : -w, y, [bg, edgeTop, edgeBot, text]).setDepth(BANNER_DEPTH),
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
        duration: reduced ? 0 : 150,
        ease: 'Cubic.easeOut',
      },
      { label: 'proc_banner_in', onCancel: kill },
    );
    if (dead || !banner.scene) return;
    await scene._awaitSceneDelay(380, { label: 'proc_banner_hold' });
    if (dead || !banner.scene) return;
    await scene._awaitSceneTween(
      {
        targets: banner,
        x: reduced ? 0 : w,
        duration: reduced ? 0 : 150,
        ease: 'Cubic.easeIn',
        onComplete: kill,
      },
      { label: 'proc_banner_out', onCancel: kill },
    );
    kill();
  }

  /**
   * Portrait cut-in strip for a crit or Legendary weapon art. Awaited.
   * Static in reduced motion or low quality, and throttled to one per
   * CUTIN_THROTTLE_MS so multi-strike exchanges can't chain them.
   * `side` is 'left' (player) or 'right' (enemy).
   */
  async showCutIn({ unitName, portraitKey, label, category, side, unit = null, weaponName = '' }) {
    const scene = this.scene;
    // Instant speed resolves combat without punctuation: no cut-in at all.
    if (battleSpeed(scene) === 'instant') return;
    // Keep the readable crit/art identity at low quality; only its motion is omitted.
    const staticPresentation = this._reduced() || scene._effectsQuality?.() === 'low';
    const now = scene.time?.now ?? 0;
    if (now - this._lastCutInAt < CUTIN_THROTTLE_MS) return;
    this._lastCutInAt = now;
    if (canRenderCeremony()) {
      return this._showCutInDOM({
        unit,
        unitName,
        weaponName,
        label,
        category,
        side,
        staticPresentation,
      });
    }

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
    const face = portraitCanvasFrame(scene, portraitKey, 64);
    if (face) {
      parts.push(scene.add.image(px, 0, face.key, face.frame).setDisplaySize(64, 64));
    } else {
      textX = fromLeft ? 24 : w - 24;
    }
    const labelText = presentationText(scene, textX, -10, label, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: theme.color,
      fontStyle: 'bold',
    }).setOrigin(fromLeft ? 0 : 1, 0.5);
    const nameText = presentationText(scene, textX, 10, unitName || '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: UI_PALETTE.text,
    }).setOrigin(fromLeft ? 0 : 1, 0.5);
    parts.push(labelText, nameText);

    const slide = staticPresentation ? 0 : fromLeft ? -120 : 120;
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
        duration: staticPresentation ? 0 : 140,
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
        duration: staticPresentation ? 0 : 140,
        ease: 'Cubic.easeIn',
        onComplete: kill,
      },
      { label: 'proc_cutin_out', onCancel: kill },
    );
    kill();
  }

  /**
   * The diagonal DOM cut-in: the attacker's eyes strip, speed lines, the word
   * in Cinzel and "NAME · WEAPON" in pixel type. It runs on exactly the same
   * awaited tweens/delay (labels, durations, speed scaling, lifecycle guards)
   * as the canvas strip, driving CSS variables instead of a container, so
   * combat resolution waits no longer than it always has.
   */
  async _showCutInDOM({ unit, unitName, weaponName, label, category, side, staticPresentation }) {
    const scene = this.scene;
    const fromLeft = side !== 'right';
    const content = cutInContent({
      label,
      unitName: unitName || unit?.name,
      weaponName: weaponName || unit?.weapon?.name,
      isArt: category === 'art',
    });
    const layer = this._track(
      new CeremonyLayer(scene, {
        frame: 'map',
        className: `ce-cutin-layer ce-cutin-layer--${fromLeft ? 'player' : 'enemy'}${
          staticPresentation ? ' is-static' : ''
        }`,
        label: [content.word, content.small].filter(Boolean).join('. '),
      }),
    );
    const root = layer.root;
    const band = el('div', 'ce-cutin');
    const portrait = ceremonyPortrait(scene, unit);
    if (portrait?.src) {
      const eyes = el(
        'div',
        `ce-cutin-eyes${portrait.pc98 ? ' is-pc98' : portrait.rebuilt ? '' : ' is-legacy'}`,
      );
      eyes.style.backgroundImage = `url("${portrait.src}")`;
      eyes.style.setProperty('--ce-eye', String(portrait.framing.eye));
      eyes.style.setProperty('--ce-cx', String(portrait.framing.cx));
      band.append(eyes);
    } else band.classList.add('is-faceless');
    const word = el('div', 'ce-cutin-word');
    const big = el('div', 'ce-cutin-big', content.word);
    word.append(big);
    if (content.small) word.append(el('div', 'ce-cutin-small', content.small));
    band.append(word);
    root.append(el('div', 'ce-cutin-flash'), band);
    layer.addFitter(() => fitText(big, { min: 16 }));

    const motion = { in: staticPresentation ? 1 : 0, out: 0 };
    const paint = () => {
      root.style.setProperty('--ce-in', String(motion.in));
      root.style.setProperty('--ce-out', String(motion.out));
    };
    paint();

    let dead = false;
    const kill = () => {
      if (dead) return;
      dead = true;
      this._kill(layer);
    };

    await scene._awaitSceneTween(
      {
        targets: motion,
        in: 1,
        duration: staticPresentation ? 0 : 140,
        ease: 'Cubic.easeOut',
        onUpdate: paint,
        onComplete: paint,
      },
      { label: 'proc_cutin_in', onCancel: kill },
    );
    motion.in = 1;
    paint();
    if (dead || layer.destroyed) return;
    await scene._awaitSceneDelay(240, { label: 'proc_cutin_hold' });
    if (dead || layer.destroyed) return;
    await scene._awaitSceneTween(
      {
        targets: motion,
        out: 1,
        duration: staticPresentation ? 0 : 140,
        ease: 'Cubic.easeIn',
        onUpdate: paint,
        onComplete: kill,
      },
      { label: 'proc_cutin_out', onCancel: kill },
    );
    kill();
  }
}
