// GrowthCeremonyController — the growth moments of a run as ceremonies
// (docs/art-direction/growth/README.md): the promotion rite, the level-up
// card, "joins your army" and small sealed beats.
//
// Same contract as CeremonyController: DOM over a frame, presentation only
// (never touches units, RNG, saves or checkpoints — callers commit first),
// reduced motion and Instant speed show the end state at once, blocking
// ceremonies own the overlay / input-focus stacks while they show, and
// everything (DOM, listeners, timers, input scopes) is torn down with the
// scene. Callers keep their canvas fallback when there is no DOM host.
//
// The rite and the level-up card are two-stage: the first tap / Enter /
// pad press completes the reveal, the next one continues. Instant speed and
// reduced motion open revealed (one press continues).
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { battleSpeed } from '../utils/combatTiming.js';
import {
  CeremonyClock,
  CeremonyLayer,
  bindCeremonySkip,
  canRenderCeremony,
  ceremonyPortrait,
  el,
  fitText,
  hairline,
} from './ceremonyDom.js';
import {
  deedCardContent,
  deedSchedule,
  growthTiming,
  levelSchedule,
  levelUpContent,
  recruitCardContent,
  riteSchedule,
  sealedBeats,
} from './growthContent.js';
import { unitDisplayName, unitEpithet } from '../engine/DeedTitles.js';
import { crestElement } from './crestArt.js';
import { projectedSpriteUnit, spriteElement, unitSpriteImage } from './growthSprites.js';
import { skillGlyph, weaponGlyph } from './growthGlyphs.js';
import { pc98FigureUrl, pc98PlateUrl, portraitFaction, portraitIdForUnit, usePc98 } from './portraitArt.js'; // prettier-ignore

const ms = (value) => `${Math.max(0, Math.round(value))}ms`;

/** The ember edge of the burn, with a few sparks (fixed offsets: no RNG). */
function burnEdge() {
  const edge = el('span', 'gr-burn-edge');
  for (let i = 0; i < 7; i++) {
    const spark = el('i', 'gr-spark');
    spark.style.setProperty('--x', `${(i * 37 + 9) % 100}%`);
    spark.style.setProperty('--d', `${(i * 53) % 260}ms`);
    spark.style.setProperty('--r', `${((i * 29) % 30) - 15}px`);
    edge.append(spark);
  }
  return edge;
}

/** A dismissed layer stops being a dialog and stops taking input at once. */
function releaseLayer(layer) {
  const root = layer?.root;
  if (!root) return;
  root.removeAttribute('role');
  root.removeAttribute('aria-modal');
  root.setAttribute('aria-hidden', 'true');
  root.classList.remove('is-blocking');
  root.inert = true;
}

/** Label a control and keep its accessible name in step (CSS adds decoration). */
function setLabel(button, text) {
  button.textContent = text;
  button.setAttribute('aria-label', text);
}

/**
 * The rite's figure size in a w×h frame: the 192px PC-98 figure at the
 * largest integer scale that fits (dither never resampled); a frame too
 * small for 1× (a compact phone) shrinks it to fit rather than overlap.
 */
export function figureSize(w, h) {
  const room = Math.min(h * 0.66, w * 0.4);
  const k = Math.floor(room / 192);
  return k >= 1 ? 192 * k : Math.max(96, Math.floor(room));
}

/** Integer display scale for a pixel image of natural width `w` in a `target` px box. */
export function spriteScale(w, target) {
  return Math.max(1, Math.round(target / Math.max(1, w)));
}

export class GrowthCeremonyController {
  constructor(scene) {
    this.scene = scene;
    this._layers = new Set();
    this._unbinders = new Set();
    this._releases = new Set();
    this._settlers = new Set();
    this._clock = new CeremonyClock(scene);
    this.destroyed = false;
    this._onShutdown = () => this.destroy();
    scene?.events?.once?.('shutdown', this._onShutdown);
  }

  static available() {
    return canRenderCeremony();
  }

  prefs() {
    const settings = this.scene?.registry?.get?.('settings');
    let speed;
    try {
      speed = battleSpeed(this.scene) || settings?.getBattleSpeed?.() || 'normal';
    } catch {
      speed = settings?.getBattleSpeed?.() || 'normal';
    }
    return {
      reducedMotion: Boolean(settings?.getReduceMotion?.()),
      speed,
      lowEffects: settings?.getEffectsQuality?.() === 'low',
    };
  }

  _audio(key) {
    try {
      this.scene?.registry?.get?.('audio')?.playSFX?.(key);
    } catch {
      /* sound is decoration */
    }
  }

  _open({ frame, className, label, depth, animate, dialog = true }) {
    if (this.destroyed || !canRenderCeremony()) return null;
    const layer = new CeremonyLayer(this.scene, {
      frame,
      className,
      blocking: true,
      label,
      depth: depth ?? DOM_UI_DEPTHS.CEREMONY,
    });
    layer.root.classList.toggle('is-static', !animate);
    // Effects quality Low: the sequence stays, the sparks and glows go.
    layer.root.classList.toggle('is-low-fx', this.prefs().lowEffects);
    if (dialog) {
      layer.root.setAttribute('role', 'dialog');
      layer.root.setAttribute('aria-modal', 'true');
    }
    this._layers.add(layer);
    return layer;
  }

  async _close(layer, exitMs = 0) {
    if (!layer || layer.destroyed) return;
    if (exitMs > 0 && !this.destroyed) {
      layer.root.style.setProperty('--ce-exit', `${exitMs}ms`);
      layer.root.classList.add('is-leaving');
      await this._clock.wait(exitMs);
    }
    layer.destroy();
    this._layers.delete(layer);
  }

  /** Lock the battle's story input (rail inert, grid ignored) while shown. */
  _holdSceneInput() {
    const release = this.scene?._getCeremonies?.()?.holdInput?.();
    if (!release) return () => {};
    this._releases.add(release);
    return () => {
      this._releases.delete(release);
      release();
    };
  }

  /**
   * Two-stage dismissal: `reveal()` shows the end state, `close()` ends.
   * Resolves once closed (or when the controller is destroyed).
   */
  _runStaged(layer, { name, reveal, isRevealed, onClose, button }) {
    return new Promise((resolve) => {
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        this._settlers.delete(settle);
        unbind();
        resolve();
      };
      settle.layer = layer;
      this._settlers.add(settle);
      const unbindSkip = bindCeremonySkip(
        this.scene,
        layer.root,
        () => {
          if (!isRevealed()) {
            reveal();
            return;
          }
          // Dismissed: the dialog and its input end now (the flow moves on);
          // the layer fades out on its own.
          releaseLayer(layer);
          settle();
          void onClose();
        },
        { name },
      );
      const unbind = () => {
        this._unbinders.delete(unbind);
        unbindSkip();
      };
      this._unbinders.add(unbind);
      button?.focus?.({ preventScroll: true });
    });
  }

  // ── Promotion rite ─────────────────────────────────────────────────────

  /**
   * The rite. `content` is promotionPathContent(unitBefore, cls) computed
   * before the promotion was applied (so it carries the before values);
   * `unit` is the promoted unit. Resolves when dismissed.
   */
  async showPromotionRite({ unit, content, frame = 'map', beforeUnit = null }) {
    if (!unit || !content || this.destroyed || !canRenderCeremony()) return false;
    const prefs = this.prefs();
    const timing = growthTiming('rite', prefs);
    const schedule = riteSchedule(content, timing);
    const layer = this._open({
      frame,
      className: 'gr-rite-layer',
      label: 'Promotion',
      depth: DOM_UI_DEPTHS.RITE,
      animate: timing.animate,
    });
    if (!layer) return false;
    const root = layer.root;
    root.style.setProperty('--gr-burn-at', ms(schedule.burnAt));
    root.style.setProperty('--gr-burn', ms(timing.burn));
    root.style.setProperty('--gr-name-at', ms(schedule.nameAt));
    root.style.setProperty('--gr-stats-at', ms(schedule.statsAt));
    root.style.setProperty('--gr-stat', ms(timing.stat));
    root.style.setProperty('--gr-seals-at', ms(schedule.sealsAt));
    root.style.setProperty('--gr-seal', ms(timing.seal));
    const before = beforeUnit || { ...unit, className: content.fromClass, tier: 'base' };
    const view = buildRite(this.scene, { unit, before, content });
    root.append(el('div', 'gr-veil'), view.card);
    // The 192px PC-98 figure at the largest integer scale the frame allows.
    layer.addFitter(() => {
      const w = parseFloat(root.style.width) || 0;
      const h = parseFloat(root.style.height) || 0;
      root.style.setProperty('--gr-fig', `${figureSize(w, h)}px`);
    });
    layer.addFitter(() => fitText(view.nameTo, { min: 16 }));
    layer.addFitter(() => fitText(view.nameFrom, { min: 14 }));
    const releaseInput = this._holdSceneInput();
    const levelSfx = this.scene?._playLevelUpSfx;
    if (typeof levelSfx === 'function') levelSfx.call(this.scene);
    else this._audio('sfx_levelup');
    let revealed = !timing.animate;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      root.classList.add('is-static', 'is-done');
      setLabel(view.button, 'Continue');
    };
    if (revealed) {
      root.classList.add('is-done');
      setLabel(view.button, 'Continue');
    } else {
      setLabel(view.button, 'Skip');
      // Ember ticks as the stat bonuses ignite (sound only; never the RNG).
      content.stats.forEach((_, i) => {
        void this._clock.wait(schedule.statsAt + i * timing.stat).then((r) => {
          if (r === 'elapsed' && !revealed) this._audio('sfx_cursor');
        });
      });
      void this._clock.wait(schedule.done).then((r) => {
        if (r !== 'elapsed' || revealed) return;
        revealed = true;
        root.classList.add('is-done');
        setLabel(view.button, 'Continue');
      });
    }
    try {
      await this._runStaged(layer, {
        name: 'Promotion rite',
        reveal,
        isRevealed: () => revealed,
        onClose: () => this._close(layer, timing.animate ? 280 : 0),
        button: view.button,
      });
    } finally {
      this.scene?._stopLevelUpSfx?.();
      releaseInput();
      if (!layer.destroyed && !layer.root.classList.contains('is-leaving'))
        await this._close(layer, 0);
    }
    return true;
  }

  // ── Level-up card ──────────────────────────────────────────────────────

  /**
   * One level-up (gains already applied). Resolves when dismissed. `handle`
   * (optional object) receives `cancel()` to close it from outside.
   */
  async showLevelUp({ unit, result, learnedNames = [], frame = 'map', handle = null }) {
    if (!unit || !result || this.destroyed || !canRenderCeremony()) return false;
    const content = levelUpContent(unit, result, learnedNames);
    const timing = growthTiming('level', this.prefs());
    const schedule = levelSchedule(content, timing);
    const layer = this._open({
      frame,
      className: `gr-level-layer gr-level-layer--${content.kind}`,
      label: 'Level up',
      animate: timing.animate,
    });
    if (!layer) return false;
    const root = layer.root;
    root.style.setProperty('--gr-pips-at', ms(schedule.pipsAt));
    root.style.setProperty('--gr-pip', ms(timing.pip));
    root.style.setProperty('--gr-beat-at', ms(schedule.beatAt));
    root.style.setProperty('--gr-seals-at', ms(schedule.sealsAt));
    root.style.setProperty('--gr-seal', ms(timing.seal));
    const view = buildLevelCard(this.scene, unit, content, layer);
    root.append(el('div', 'gr-veil gr-veil--soft'), view.card);
    const releaseInput = this._holdSceneInput();
    let revealed = !timing.animate;
    const finishReveal = () => {
      revealed = true;
      root.classList.add('is-done');
      setLabel(view.button, 'Continue');
      view.status.textContent = 'Gains revealed. Continue when ready.';
    };
    const reveal = () => {
      if (revealed) return;
      root.classList.add('is-static');
      finishReveal();
    };
    if (revealed) finishReveal();
    else {
      setLabel(view.button, 'Reveal gains');
      let i = 0;
      for (const row of content.rows) {
        if (!row.gain) continue;
        const at = schedule.pipsAt + i++ * timing.pip;
        void this._clock.wait(at).then((r) => {
          if (r === 'elapsed' && !revealed) this._audio('sfx_cursor');
        });
      }
      void this._clock.wait(schedule.done).then((r) => {
        if (r === 'elapsed' && !revealed) finishReveal();
      });
    }
    if (handle) {
      handle.cancel = () => {
        layer.destroy();
        this._layers.delete(layer);
        for (const settle of [...this._settlers]) if (settle.layer === layer) settle();
      };
    }
    try {
      await this._runStaged(layer, {
        name: 'Level up',
        reveal,
        isRevealed: () => revealed,
        onClose: () => this._close(layer, timing.animate ? 140 : 0),
        button: view.button,
      });
    } finally {
      releaseInput();
      if (!layer.destroyed && !layer.root.classList.contains('is-leaving'))
        await this._close(layer, 0);
    }
    return true;
  }

  // ── Joins your army ────────────────────────────────────────────────────

  /**
   * The recruit card: portrait breaking the band, crest, NAME, one line.
   * kind: 'recruit' (Talk), 'boss' (boss recruit), 'lord' (lord arrival).
   * Skippable; leaves by itself after the reading window.
   */
  async showRecruit({ unit, kind = 'recruit', line = null, frame = 'map' }) {
    if (!unit || this.destroyed || !canRenderCeremony()) return false;
    const gameData = this.scene?.gameData || {};
    const content = recruitCardContent(unit, {
      dialogue: gameData.dialogue,
      classes: gameData.classes,
      traits: gameData.traits,
      kind,
      line,
    });
    const timing = growthTiming('join', this.prefs());
    const layer = this._open({
      frame,
      className: `gr-join-layer gr-join-layer--${kind}`,
      label: `${content.name} joins your army`,
      animate: timing.animate,
    });
    if (!layer) return false;
    const view = buildJoinCard(this.scene, unit, content);
    layer.root.append(el('div', 'ce-dim ce-dim--soft'), view.card);
    layer.addFitter(() => fitText(view.name, { min: 16 }));
    const releaseInput = this._holdSceneInput();
    this._audio('sfx_confirm');
    try {
      let release;
      const skipped = new Promise((resolve) => {
        release = resolve;
      });
      const unbindSkip = bindCeremonySkip(this.scene, layer.root, () => release('skipped'), {
        name: 'Recruit joins',
      });
      const unbind = () => {
        this._unbinders.delete(unbind);
        unbindSkip();
      };
      this._unbinders.add(unbind);
      const settle = () => release('cancelled');
      this._settlers.add(settle);
      try {
        await Promise.race([this._clock.wait(timing.enter + timing.hold), skipped]);
      } finally {
        this._settlers.delete(settle);
        unbind();
      }
      await this._close(layer, timing.exit);
    } finally {
      releaseInput();
      if (!layer.destroyed && !layer.root.classList.contains('is-leaving'))
        await this._close(layer, 0);
    }
    return true;
  }

  // ── Sealed beat (non-blocking) ─────────────────────────────────────────

  /**
   * A small band that stamps one gain in: a skill learned from a scroll, a
   * class mastered. Never blocks; leaves by itself.
   * @param {{title:string, detail?:string, skillId?:string, weapon?:string, frame?:string}} o
   */
  showSealed({ title, detail = '', skillId = null, weapon = null, frame = 'screen' }) {
    if (!title || this.destroyed || !canRenderCeremony()) return null;
    const timing = growthTiming('sealed', this.prefs());
    const layer = this._open({
      frame,
      className: 'gr-sealed-layer',
      label: [title, detail].filter(Boolean).join('. '),
      depth: DOM_UI_DEPTHS.RITE,
      animate: timing.animate,
      dialog: false,
    });
    if (!layer) return null;
    layer.root.classList.remove('is-blocking');
    const band = el('div', 'gr-sealed');
    band.append(
      weapon ? weaponGlyph(weapon, 'gr-seal-glyph') : skillGlyph(skillId, 'gr-seal-glyph'),
    );
    const text = el('div', 'gr-sealed-text');
    text.append(el('div', 'gr-sealed-kicker', 'Sealed'), el('div', 'gr-sealed-title', title));
    if (detail) text.append(el('div', 'gr-sealed-detail', detail));
    band.append(text);
    layer.root.append(band);
    void this._clock.wait(timing.enter + timing.hold).then(() => this._close(layer, timing.exit));
    return { root: layer.root, destroy: () => void this._close(layer, 0) };
  }

  // ── Deeds (title cards) ────────────────────────────────────────────────

  /**
   * The deed rite: one anime-style title card per deed earned this battle
   * (commitBattleDeeds announcements, already committed and saved). The
   * band cuts across the map, the unit stands in it, the epithet slams in
   * Cinzel over a brush stroke and the ember seal stamps it. One press
   * reveals a card, the next moves on; "Skip all" ends the batch. Instant
   * speed and reduced motion open each card revealed. Resolves when done.
   */
  async showDeeds({ entries, frame = 'map' } = {}) {
    const list = (Array.isArray(entries) ? entries : []).filter((e) => e?.epithet);
    if (!list.length || this.destroyed || !canRenderCeremony()) return false;
    const skills = this.scene?.gameData?.skills || [];
    const deeds = this.scene?.gameData?.deeds || null;
    const timing = growthTiming('deed', this.prefs());
    const schedule = deedSchedule(timing);
    const layer = this._open({
      frame,
      className: 'gr-deed-layer',
      label: 'Deed',
      depth: DOM_UI_DEPTHS.RITE,
      animate: timing.animate,
    });
    if (!layer) return false;
    const root = layer.root;
    root.style.setProperty('--gr-deed-slash', ms(timing.slash));
    root.style.setProperty('--gr-deed-name-at', ms(schedule.nameAt));
    root.style.setProperty('--gr-deed-epithet-at', ms(schedule.epithetAt));
    root.style.setProperty('--gr-deed-epithet', ms(timing.epithet));
    root.style.setProperty('--gr-deed-brush-at', ms(schedule.brushAt));
    root.style.setProperty('--gr-deed-brush', ms(timing.brush));
    root.style.setProperty('--gr-deed-seal-at', ms(schedule.sealAt));
    root.style.setProperty('--gr-deed-seal', ms(timing.seal));
    root.style.setProperty('--gr-deed-lore-at', ms(schedule.loreAt));
    const stage = el('div', 'gr-deed-stage');
    root.append(el('div', 'gr-deed-veil'), stage);
    const releaseInput = this._holdSceneInput();
    let index = 0;
    let view = null;
    let revealed = false;
    let card = null; // token: stale timers of an earlier card do nothing
    let bindSkip = null; // wires each card's "Skip all" once the batch is running
    layer.addFitter(() => view && fitText(view.epithet, { min: 15 }));
    layer.addFitter(() => view && fitText(view.name, { min: 13 }));
    const nextLabel = () => (index + 1 < list.length ? 'Next deed' : 'Continue');
    const finishReveal = () => {
      revealed = true;
      root.classList.add('is-done');
      if (view) setLabel(view.button, nextLabel());
    };
    const show = (i) => {
      const token = {};
      card = token;
      const content = deedCardContent(list[i], { skills, deeds, index: i, total: list.length });
      view = buildDeedCard(this.scene, list[i].unit, content, { skipAll: list.length - i > 1 });
      bindSkip?.(view.skip);
      root.classList.remove('is-done');
      root.classList.toggle('is-static', !timing.animate);
      stage.replaceChildren(view.card);
      root.setAttribute('aria-label', content.label);
      layer.applyFrame();
      // Refit once the display face has landed (a cold start measures the fallback).
      try {
        globalThis.document?.fonts?.ready?.then?.(() => {
          if (card === token && !layer.destroyed) layer.applyFrame();
        });
      } catch {
        /* optional */
      }
      revealed = !timing.animate;
      if (revealed) {
        finishReveal();
        return;
      }
      setLabel(view.button, 'Skip');
      const at = (msAt, fn) =>
        void this._clock.wait(msAt).then((r) => {
          if (r === 'elapsed' && card === token && !revealed) fn();
        });
      at(schedule.epithetAt, () => this._audio('sfx_cursor'));
      at(schedule.sealAt, () => this._audio('sfx_hit'));
      at(schedule.done, finishReveal);
    };
    const reveal = () => {
      if (revealed) return;
      root.classList.add('is-static');
      finishReveal();
    };
    show(0);
    this._audio('sfx_confirm');
    try {
      await new Promise((resolve) => {
        let done = false;
        const settle = () => {
          if (done) return;
          done = true;
          this._settlers.delete(settle);
          unbind();
          resolve();
        };
        settle.layer = layer;
        this._settlers.add(settle);
        const end = () => {
          // Dismissed: the dialog and its input end now; the layer fades.
          releaseLayer(layer);
          settle();
          void this._close(layer, timing.exit);
        };
        const advance = () => {
          if (done) return;
          // Enter / pad confirm on the focused "Skip all" ends the batch.
          if (view?.skip && globalThis.document?.activeElement === view.skip) return end();
          if (!revealed) return reveal();
          if (index + 1 >= list.length) return end();
          index++;
          show(index);
          view.button?.focus?.({ preventScroll: true });
        };
        const unbindSkip = bindCeremonySkip(this.scene, root, advance, { name: 'Deed' });
        const unbind = () => {
          this._unbinders.delete(unbind);
          unbindSkip();
        };
        this._unbinders.add(unbind);
        // "Skip all" is its own control: its press never reaches the layer.
        bindSkip = (skip) => {
          skip?.addEventListener('pointerdown', (event) => event.stopPropagation());
          skip?.addEventListener('click', () => end());
        };
        bindSkip(view?.skip);
        view.button?.focus?.({ preventScroll: true });
      });
    } finally {
      releaseInput();
      if (!layer.destroyed && !layer.root.classList.contains('is-leaving'))
        await this._close(layer, 0);
    }
    return true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    for (const unbind of [...this._unbinders]) unbind();
    this._unbinders.clear();
    for (const release of [...this._releases]) release();
    this._releases.clear();
    this._clock.cancelAll();
    for (const layer of [...this._layers]) layer.destroy();
    this._layers.clear();
    for (const settle of [...this._settlers]) settle();
    this._settlers.clear();
    if (this.scene?._growthCeremonies === this) this.scene._growthCeremonies = null;
    this.scene = null;
  }
}

/** The scene's growth ceremonies (created on demand, gone with the scene). */
export function growthCeremonies(scene) {
  if (!scene || !canRenderCeremony()) return null;
  if (!scene._growthCeremonies || scene._growthCeremonies.destroyed)
    scene._growthCeremonies = new GrowthCeremonyController(scene);
  return scene._growthCeremonies;
}

// ── Builders (exported for review tooling and tests) ─────────────────────

function portraitImage(scene, unit, className) {
  const portrait = ceremonyPortrait(scene, unit);
  if (!portrait?.src) return null;
  const img = el('img', `${className}${portrait.pc98 ? ' pc98-portrait' : ''}${portrait.rebuilt ? '' : ' is-legacy'}`); // prettier-ignore
  img.src = portrait.src;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

function spriteFor(scene, unit, cls, target = 112) {
  const image = unitSpriteImage(scene, unit);
  const node = spriteElement(image, cls);
  if (!node) return null;
  const k = spriteScale(image.width, target);
  node.style.width = `calc(${image.width * k}px * var(--ce-px, 1))`;
  node.style.height = `calc(${image.height * k}px * var(--ce-px, 1))`;
  return node;
}

export function buildRite(scene, { unit, before, content }) {
  const card = el('div', 'gr-rite');
  // Figure: the Hollow Sun behind the portrait; the old portrait/sprite
  // burn away into the new ones.
  const figure = el('div', 'gr-rite-figure');
  const sun = el('div', 'gr-sun');
  sun.append(el('span', 'gr-sun-corona'), el('span', 'gr-sun-ring'), el('span', 'gr-sun-disc'));
  figure.append(sun);
  const bust = el('div', 'gr-rite-bust');
  const fromPortrait = portraitImage(scene, before, 'gr-rite-portrait gr-burn-from');
  const toPortrait = portraitImage(scene, unit, 'gr-rite-portrait gr-burn-to');
  if (fromPortrait && toPortrait && fromPortrait.src === toPortrait.src) {
    toPortrait.classList.remove('gr-burn-to');
    toPortrait.classList.add('is-constant');
    bust.append(toPortrait);
  } else {
    if (fromPortrait) bust.append(fromPortrait);
    if (toPortrait) bust.append(toPortrait);
    if (fromPortrait && toPortrait) bust.append(burnEdge());
  }
  figure.append(bust);
  const plinth = el('div', 'gr-rite-plinth');
  const fromSprite = spriteFor(scene, before, 'gr-burn-from');
  const toSprite = spriteFor(scene, projectedSpriteUnit(unit, unit.className), 'gr-burn-to');
  if (toSprite) {
    if (fromSprite) plinth.append(fromSprite);
    plinth.append(toSprite);
    plinth.append(burnEdge());
    figure.append(plinth);
  }
  card.append(figure);

  const text = el('div', 'gr-rite-text');
  const titled = unit?.name === content.unitName ? unitDisplayName(unit, { epithet: true }) : '';
  const kicker = el('div', 'gr-kicker', `Promotion · ${titled || content.unitName}`);
  const classRow = el('div', 'gr-rite-class');
  const crests = el('div', 'gr-crest-stack');
  const fromCrest = content.fromCrest ? crestElement(content.fromCrest, { className: 'gr-burn-from' }) : null; // prettier-ignore
  const toCrest = content.toCrest ? crestElement(content.toCrest, { className: 'gr-burn-to', label: true }) : null; // prettier-ignore
  if (fromCrest) crests.append(fromCrest);
  if (toCrest) crests.append(toCrest);
  crests.append(burnEdge());
  const names = el('div', 'gr-name-stack');
  const nameFrom = el('div', 'gr-name gr-name--from gr-burn-from', content.fromClass);
  const nameTo = el('div', 'gr-name gr-name--to gr-burn-to', content.toClass);
  nameFrom.setAttribute('aria-hidden', 'true');
  names.append(nameFrom, nameTo, burnEdge());
  classRow.append(crests, names);
  const lv = el('div', 'gr-rite-sub', `${content.fromClass} → ${content.toClass} · Lv ${content.levelTo}`); // prettier-ignore
  text.append(kicker, classRow, lv, hairline('gold'));

  const stats = el('dl', 'gr-rite-stats');
  stats.setAttribute('aria-label', 'Stat bonuses');
  content.stats.forEach((row, i) => {
    const cell = el('div', 'gr-stat');
    cell.style.setProperty('--i', String(i));
    const dd = el('dd');
    dd.append(el('span', 'gr-stat-val', String(row.after)), el('b', 'gr-stat-gain', `+${row.bonus}`)); // prettier-ignore
    cell.append(el('dt', '', row.stat), dd);
    cell.setAttribute('aria-label', `${row.stat} ${row.before} to ${row.after}, plus ${row.bonus}`);
    stats.append(cell);
  });
  text.append(stats);

  const beats = sealedBeats(content);
  if (beats.length) {
    const seals = el('ul', 'gr-seals');
    if (beats.length > 3) seals.classList.add('is-dense');
    beats.forEach((beat, i) => {
      const li = el('li', `gr-seal gr-seal--${beat.kind}`);
      li.style.setProperty('--i', String(i));
      li.append(
        beat.kind === 'skill' || beat.kind === 'oath'
          ? skillGlyph(beat.skillId, 'gr-seal-glyph')
          : weaponGlyph(beat.weapon, 'gr-seal-glyph'),
      );
      const words = el('span', 'gr-seal-words');
      words.append(el('b', '', beat.title), el('small', '', beat.detail));
      li.append(words);
      seals.append(li);
    });
    text.append(seals);
  }
  const notes = [];
  if (content.growths.length)
    notes.push(`Growth ${content.growths.map((g) => `${g.stat} +${g.bonus}%`).join(', ')}`);
  if (content.moveType) notes.push(`${content.moveType.from} → ${content.moveType.to}`);
  if (content.dropped.length) notes.push(`Skill limit: could not learn ${content.dropped.join(', ')}`); // prettier-ignore
  if (notes.length) text.append(el('p', 'gr-rite-note', notes.join(' · ')));
  card.append(text);

  const button = el('button', 'gr-continue', 'Continue');
  button.type = 'button';
  card.append(button);
  return { card, button, nameFrom, nameTo };
}

function levelPortrait(scene, unit, layer) {
  // PC-98 figure over its plate at an integer scale of the 96 dialogue size.
  if (usePc98()) {
    const id = portraitIdForUnit(unit, scene?.gameData || {});
    if (!id) return null;
    const k = Number(layer?.root?.style?.getPropertyValue?.('--ce-px')) || 1;
    const size = k >= 2 ? 192 : 96;
    const img = el('img', 'gr-level-portrait pc98-portrait has-plate');
    img.src = pc98FigureUrl(id, size);
    img.style.setProperty('--pc98-plate', `url("${pc98PlateUrl(portraitFaction(unit, id), size)}")`); // prettier-ignore
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => img.remove(), { once: true });
    return img;
  }
  return portraitImage(scene, unit, 'gr-level-portrait');
}

export function buildLevelCard(scene, unit, content, layer = null) {
  const card = el('div', `gr-level gr-level--${content.kind}`);
  const portrait = levelPortrait(scene, unit, layer);
  if (portrait) card.append(portrait);
  const main = el('div', 'gr-level-main');
  const head = el('div', 'gr-level-head');
  const who = el('div', 'gr-level-who');
  who.append(el('div', 'gr-kicker', 'Level up'));
  const nameRow = el('h3', 'gr-level-name');
  nameRow.append(el('span', null, content.unitName));
  who.append(nameRow);
  const epithet = unit?.name === content.unitName ? unitEpithet(unit) : null;
  if (epithet) who.append(el('div', 're-epithet gr-level-epithet', epithet.text));
  const cls = el('div', 'gr-level-class');
  const crest = crestElement(content.className, { className: 'gr-level-crest' });
  if (crest) cls.append(crest);
  cls.append(el('span', null, content.className));
  who.append(cls);
  const lv = el('div', 'gr-level-lv');
  lv.append(
    el('span', 'gr-lv-k', 'Lv'),
    el('span', 'gr-lv-from', content.levelFrom),
    el('span', 'gr-lv-arrow', '→'),
    el('span', 'gr-lv-to', content.levelTo),
  );
  lv.setAttribute('aria-label', `Level ${content.levelFrom} to ${content.levelTo}`);
  head.append(who, lv);
  main.append(head);
  const grid = el('dl', 'gr-level-stats re-gain-grid');
  let order = 0;
  for (const row of content.rows) {
    const cell = el('div', `gr-level-row${row.gain ? ' is-gain' : ''}`);
    if (row.gain) cell.style.setProperty('--i', String(order++));
    const dd = el('dd');
    const val = el('span', 'gr-level-val');
    val.append(el('span', 'gr-val-before', String(row.before)), el('span', 'gr-val-after', String(row.after))); // prettier-ignore
    dd.append(val);
    const pips = el('span', 'gr-pips');
    const count = Math.max(1, row.gain);
    for (let i = 0; i < count; i++) pips.append(el('i', `gr-pip${row.gain ? ' is-lit' : ''}`));
    dd.append(pips);
    if (row.gain) dd.append(el('b', 'gr-level-gain re-gain', `+${row.gain}`));
    cell.append(el('dt', '', row.stat), dd);
    cell.setAttribute(
      'aria-label',
      `${row.stat} ${row.after}${row.gain ? `, plus ${row.gain}` : ''}`,
    );
    grid.append(cell);
  }
  main.append(grid);
  if (content.beat) {
    const beat = el('div', `gr-level-beat gr-level-beat--${content.kind}`);
    beat.append(el('b', 'gr-beat-word', content.beat.word), el('span', 'gr-beat-line', content.beat.line)); // prettier-ignore
    main.append(beat);
  }
  if (content.skills.length) {
    const seals = el('ul', 'gr-seals gr-seals--level');
    content.skills.forEach((name, i) => {
      const li = el('li', 'gr-seal gr-seal--skill');
      li.style.setProperty('--i', String(i));
      li.append(skillGlyph(name, 'gr-seal-glyph'));
      const words = el('span', 'gr-seal-words');
      words.append(el('b', '', name), el('small', '', 'New skill'));
      li.append(words);
      seals.append(li);
    });
    main.append(seals);
  }
  const foot = el('div', 'gr-level-foot');
  const status = el('p', 'gr-level-status', 'Revealing stat gains…');
  status.setAttribute('role', 'status');
  const button = el('button', 'gr-continue re-btn re-btn--primary', 'Continue');
  button.type = 'button';
  foot.append(status, button);
  main.append(foot);
  card.append(main);
  return { card, button, status };
}

/**
 * One deed title card (exported for review tooling and tests). The unit's
 * portrait stands in a slashed ink band; kicker, NAME, the epithet over a
 * brush stroke, the lore; an ember seal stamps the band's end.
 */
export function buildDeedCard(scene, unit, content, { skipAll = false } = {}) {
  const card = el('div', `gr-deed gr-deed--p${content.prestige}`);
  card.dataset.deed = content.deedId;
  const slash = el('div', 'gr-deed-slash');
  slash.append(el('span', 'gr-deed-streak'));
  card.append(el('div', 'gr-deed-lines'), slash);
  const bust = el('div', 'gr-deed-bust');
  bust.append(el('span', 'gr-deed-ray'));
  const portrait = portraitImage(scene, unit, 'gr-deed-portrait');
  if (portrait) bust.append(portrait);
  else card.classList.add('is-faceless');
  card.append(bust);

  const text = el('div', 'gr-deed-text');
  text.append(el('div', 'gr-kicker gr-deed-kicker', content.kicker));
  const name = el('div', 'gr-deed-name', content.appositive ? `${content.name},` : content.name);
  const epithetRow = el('div', 'gr-deed-epithet');
  const epithet = el('span', 'gr-deed-epithet-text', content.epithet);
  const brush = el('i', 'gr-deed-brush');
  brush.setAttribute('aria-hidden', 'true');
  epithetRow.append(epithet, brush);
  text.append(name, epithetRow);
  if (content.lore) text.append(el('p', 'gr-deed-lore', `“${content.lore}”`));
  if (content.note) text.append(el('p', 'gr-deed-note', content.note));
  const foot = el('div', 'gr-deed-foot');
  if (content.oath) foot.append(el('span', 'gr-deed-oath', content.oath));
  if (content.count) foot.append(el('span', 'gr-deed-count', content.count));
  if (foot.childElementCount) text.append(foot);
  card.append(text);

  const seal = el('div', 'gr-deed-seal');
  seal.setAttribute('aria-hidden', 'true');
  seal.append(
    el('span', 'gr-deed-seal-wax'),
    el('b', 'gr-deed-seal-mark', content.seal),
    el('small', 'gr-deed-seal-rank', content.ordinal),
  );
  card.append(seal, el('div', 'gr-deed-flash'));

  const controls = el('div', 'gr-deed-controls');
  let skip = null;
  if (skipAll) {
    skip = el('button', 'gr-deed-skip re-btn', 'Skip all');
    skip.type = 'button';
    controls.append(skip);
  }
  const button = el('button', 'gr-continue re-btn re-btn--primary gr-deed-next', 'Continue');
  button.type = 'button';
  controls.append(button);
  card.append(controls);
  return { card, button, skip, name, epithet };
}

export function buildJoinCard(scene, unit, content) {
  const card = el('div', `gr-join gr-join--${content.kind}`);
  const band = el('div', 'gr-join-band');
  const bust = el('div', 'gr-join-bust');
  const portrait = portraitImage(scene, unit, 'gr-join-portrait');
  if (portrait) bust.append(portrait);
  band.append(bust);
  const text = el('div', 'gr-join-text');
  text.append(el('div', 'gr-kicker', content.kicker));
  const name = el('div', 'gr-join-name', content.name);
  text.append(name);
  const meta = el('div', 'gr-join-meta');
  if (content.crest) {
    const crest = crestElement(content.crest, { className: 'gr-join-crest' });
    if (crest) meta.append(crest);
  }
  meta.append(el('span', null, content.meta));
  text.append(meta);
  if (content.line) text.append(el('p', 'gr-join-line', `“${content.line}”`));
  if (content.legendary) {
    const seal = el('div', 'gr-join-legend');
    seal.append(
      skillGlyph(content.legendary.id, 'gr-seal-glyph'),
      el('b', '', `Legendary · ${content.legendary.name}`),
      el('span', '', content.legendary.description),
    );
    text.append(seal);
  }
  text.append(hairline('gold'));
  band.append(text);
  card.append(band);
  const hint = el('div', 'ce-skip', 'Tap to continue');
  hint.setAttribute('aria-hidden', 'true');
  card.append(hint);
  return { card, name };
}
