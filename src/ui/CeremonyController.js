// CeremonyController — Souls staging for the story beats of a scene.
//
// Owns the DOM ceremonies a scene shows: the boss encounter card, the
// FOE VANQUISHED / objective / defeat bands, the phase banner, act title
// cards and the end of a run. Every ceremony
//  - is presentation only (never touches units, RNG, saves or checkpoints);
//  - covers the map area (phones keep the command rail) or, for act and run
//    titles, the whole screen;
//  - honors reduced motion and Instant speed through ceremonyTiming();
//  - is skippable by tap / Enter / Space / Esc / gamepad when it blocks;
//  - is torn down with the scene (DOM, listeners, timers, input scopes).
// Callers fall back to their canvas presentation when there is no DOM host.

import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import {
  actCardContent,
  bossCardContent,
  ceremonyTiming,
  defeatContent,
  felledContent,
  phaseContent,
  runEndContent,
  victoryContent,
} from './ceremonyContent.js';
import {
  CeremonyClock,
  CeremonyLayer,
  bindCeremonySkip,
  canRenderCeremony,
  ceremonyPortrait,
  el,
  fitText,
  hairline,
  skipHint,
} from './ceremonyDom.js';

export class CeremonyController {
  constructor(scene) {
    this.scene = scene;
    this._layers = new Set();
    this._unbinders = new Set();
    this._blocking = 0;
    this._clock = new CeremonyClock(scene);
    this.destroyed = false;
    this._onShutdown = () => this.destroy();
    scene?.events?.once?.('shutdown', this._onShutdown);
  }

  static available() {
    return canRenderCeremony();
  }

  /** True while a ceremony owns input (the scene treats it like story dialogue). */
  isBlocking() {
    return this._blocking > 0;
  }

  prefs() {
    const settings = this.scene?.registry?.get?.('settings');
    return {
      reducedMotion: Boolean(settings?.getReduceMotion?.()),
      speed: settings?.getBattleSpeed?.() || 'normal',
    };
  }

  timing(kind) {
    return ceremonyTiming(kind, this.prefs());
  }

  _open({ frame = 'map', className = '', blocking = false, label = '', animate = true, depth }) {
    if (this.destroyed || !canRenderCeremony()) return null;
    const layer = new CeremonyLayer(this.scene, {
      frame,
      className,
      blocking,
      label,
      depth: depth ?? DOM_UI_DEPTHS.CEREMONY,
    });
    layer.root.classList.toggle('is-static', !animate);
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

  _bindSkip(layer, onSkip, name) {
    const unbind = bindCeremonySkip(this.scene, layer.root, onSkip, { name });
    this._unbinders.add(unbind);
    return () => {
      this._unbinders.delete(unbind);
      unbind();
    };
  }

  _block(delta) {
    this._blocking = Math.max(0, this._blocking + delta);
  }

  // ── Boss encounter ─────────────────────────────────────────────────────

  /**
   * Card before the pre-battle lines: dark band across the map, the bust
   * breaking the frame, NAME + epithet, crimson hairline. The Entity gets
   * no name card — only "· · ·" while its image splits and drains.
   * Resolves once dismissed (tap or timeout). Returns false when not shown.
   */
  async showBossIntro({ unit, actId }) {
    if (!unit || !canRenderCeremony() || this.destroyed) return false;
    const content = bossCardContent({ unit, enemiesData: this.scene.gameData?.enemies, actId });
    if (!content) return false;
    const t = this.timing('bossIntro');
    const entity = content.kind === 'entity';
    const layer = this._open({
      className: `ce-boss-layer${entity ? ' ce-boss-layer--entity' : ''}`,
      blocking: true,
      label: entity ? 'Something stirs' : `${content.name}, ${content.epithet}`,
      animate: t.animate,
    });
    if (!layer) return false;
    const portrait = ceremonyPortrait(this.scene, unit);
    layer.root.append(el('div', 'ce-dim'), buildBossCard(content, portrait), skipHint());
    const name = layer.root.querySelector('.ce-boss-name');
    const epithet = layer.root.querySelector('.ce-boss-epithet');
    if (!entity) {
      layer.addFitter(() => fitText(name, { min: 16 }));
      if (epithet) layer.addFitter(() => fitText(epithet, { min: 11 }));
    }
    this._block(1);
    try {
      await this._holdUntilSkip(layer, t.enterMs + t.holdMs, 'Boss encounter');
      await this._close(layer, t.exitMs);
    } finally {
      this._block(-1);
    }
    return true;
  }

  async _holdUntilSkip(layer, ms, name) {
    let release;
    const skipped = new Promise((resolve) => {
      release = resolve;
    });
    const unbind = this._bindSkip(layer, () => release('skipped'), name);
    try {
      return await Promise.race([this._clock.wait(ms), skipped]);
    } finally {
      unbind();
    }
  }

  // ── Bands ──────────────────────────────────────────────────────────────

  _band({ kind, tone, word, sub, dim = null, blocking = false, frame = 'map', label = '' }) {
    const t = this.timing(kind);
    const layer = this._open({
      frame,
      className: `ce-band-layer ce-band-layer--${kind}`,
      blocking,
      label: label || [word, sub].filter(Boolean).join('. '),
      animate: t.animate,
    });
    if (!layer) return null;
    if (dim) layer.root.append(el('div', `ce-dim ce-dim--${dim}`));
    const band = el('div', `ce-band ce-band--${tone}`);
    const wordEl = el('div', 'ce-band-word', word);
    band.append(wordEl);
    if (sub) band.append(el('div', 'ce-band-sub', sub));
    band.append(hairline(tone === 'gold' ? 'gold' : 'crimson'));
    layer.root.append(band);
    layer.addFitter(() => fitText(wordEl, { min: 18 }));
    const sublineEl = band.querySelector('.ce-band-sub');
    if (sublineEl) layer.addFitter(() => fitText(sublineEl, { min: 11 }));
    return { layer, timing: t };
  }

  /**
   * FOE VANQUISHED: a boss fell and the battle goes on. Non-blocking —
   * the map stays live underneath — and it leaves by itself.
   */
  showBossFelled({ objective, remaining = 0 } = {}) {
    if (!canRenderCeremony() || this.destroyed) return null;
    const content = felledContent({ objective, remaining });
    const built = this._band({ kind: 'bossFelled', tone: 'felled', ...content });
    if (!built) return null;
    const { layer, timing } = built;
    void this._clock
      .wait(timing.enterMs + timing.holdMs)
      .then(() => this._close(layer, timing.exitMs));
    return { destroy: () => this._close(layer, 0) };
  }

  /**
   * The objective's word (ROUTED / SEIZED / ESCAPED / DEFENDED) with turn,
   * par and rank. `onSkip` lets a tap move the victory flow on early; the
   * band stays until the flow `release()`s it.
   */
  showVictory({ objective, turn, par, rating }, { onSkip = null } = {}) {
    if (!canRenderCeremony() || this.destroyed) return null;
    const content = victoryContent({ objective, turn, par, rating });
    const built = this._band({
      kind: 'victory',
      tone: 'gold',
      dim: 'soft',
      blocking: typeof onSkip === 'function',
      ...content,
    });
    if (!built) return null;
    const { layer, timing } = built;
    let unbind = null;
    if (typeof onSkip === 'function') {
      layer.root.append(skipHint());
      unbind = this._bindSkip(
        layer,
        () => {
          unbind?.();
          onSkip();
        },
        'Victory',
      );
    }
    const release = () => {
      unbind?.();
      return this._close(layer, timing.exitMs);
    };
    return { release, destroy: () => void release() };
  }

  /** In-battle defeat: the flow to the run's end is unchanged. */
  showDefeat({ commanderName } = {}) {
    if (!canRenderCeremony() || this.destroyed) return null;
    const built = this._band({
      kind: 'defeat',
      tone: 'crimson',
      dim: 'heavy',
      ...defeatContent({ commanderName }),
    });
    if (!built) return null;
    const { layer, timing } = built;
    return { destroy: () => void this._close(layer, timing.exitMs) };
  }

  /** Player / Enemy Phase: thin band, never blocks, leaves by itself. */
  showPhase({ phase, turn, place = '' }) {
    if (!canRenderCeremony() || this.destroyed) return null;
    const t = this.timing('phase');
    const content = phaseContent({ phase, turn, place });
    const layer = this._open({
      className: `ce-phase-layer ce-phase-layer--${content.tone}`,
      label: [content.kicker, content.word, content.sub].filter(Boolean).join('. '),
      animate: t.animate,
    });
    if (!layer) return null;
    const band = el('div', `ce-phase ce-phase--${content.tone}`);
    if (content.kicker) band.append(el('div', 'ce-phase-kicker', content.kicker));
    const word = el('div', 'ce-phase-word', content.word);
    band.append(word);
    if (content.sub) band.append(el('div', 'ce-phase-sub', content.sub));
    layer.root.append(band);
    layer.addFitter(() => fitText(word, { min: 14 }));
    const sub = band.querySelector('.ce-phase-sub');
    if (sub) layer.addFitter(() => fitText(sub, { min: 10 }));
    const hold = place ? t.placeHoldMs : t.holdMs;
    let closed = false;
    const close = (exitMs) => {
      if (closed) return Promise.resolve();
      closed = true;
      return this._close(layer, exitMs);
    };
    void this._clock.wait(t.enterMs + hold).then(() => close(t.exitMs));
    return {
      get visible() {
        return !closed && !layer.destroyed;
      },
      root: layer.root,
      destroy: () => void close(0),
    };
  }

  // ── Act titles and the end of a run ───────────────────────────────────

  _storyCard({ kind, className, frame = 'screen', build, label, withLines }) {
    const t = this.timing(kind);
    const layer = this._open({
      frame,
      className: `ce-story-layer ${className}${withLines ? ' has-lines' : ''}`,
      label,
      animate: t.animate,
    });
    if (!layer) return null;
    build(layer);
    // Let the title land before the first line of dialogue shows over it.
    if (t.animate && withLines) {
      layer.root.classList.add('is-revealing');
      void this._clock.wait(t.enterMs).then(() => layer.root.classList.remove('is-revealing'));
    }
    const shownAt = Date.now();
    let finished = null;
    const finish = () => {
      finished ||= (async () => {
        const elapsed = Date.now() - shownAt;
        const remaining = t.enterMs + t.holdMs - elapsed;
        if (!layer.destroyed && remaining > 0) {
          // No lines came (none, or already seen): the title holds alone, centred.
          layer.root.classList.remove('has-lines', 'is-revealing');
          layer.root.classList.add('is-blocking');
          this._block(1);
          try {
            layer.root.append(skipHint());
            await this._holdUntilSkip(layer, remaining, label);
          } finally {
            this._block(-1);
          }
        }
        await this._close(layer, t.exitMs);
      })();
      return finished;
    };
    return {
      root: layer.root,
      /** Hold for the rest of the reading window (skippable), then leave. */
      finish,
      /** Leave now (the dialogue over it already gave the reading time). */
      close: () => this._close(layer, t.exitMs),
      destroy: () => void this._close(layer, 0),
    };
  }

  /** ACT n · region · grade · hairline — then the existing story lines. */
  showActCard({ actId, withLines = false }) {
    if (!canRenderCeremony() || this.destroyed) return null;
    const content = actCardContent(actId);
    if (!content.title && !content.kicker) return null;
    return this._storyCard({
      kind: 'act',
      className: 'ce-act-layer',
      label: [content.kicker, content.title, content.grade].filter(Boolean).join(' · '),
      withLines,
      build: (layer) => {
        const card = el('div', 'ce-act');
        if (content.kicker) card.append(el('div', 'ce-act-kicker', content.kicker));
        const title = el('div', 'ce-act-title', content.title);
        card.append(title);
        if (content.grade) card.append(el('div', 'ce-act-grade', content.grade));
        card.append(hairline('gold'));
        layer.root.append(card);
        layer.addFitter(() => fitText(title, { min: 16 }));
      },
    });
  }

  /** THE THREAD IS CUT — or its gold counterpart — with where and when. */
  showRunEnd(args, { withLines = false } = {}) {
    if (!canRenderCeremony() || this.destroyed) return null;
    const content = runEndContent(args);
    return this._storyCard({
      kind: 'runEnd',
      className: `ce-runend-layer ce-runend-layer--${content.tone}`,
      label: [content.word, content.sub, content.meta].filter(Boolean).join('. '),
      withLines,
      build: (layer) => {
        const card = el('div', `ce-runend ce-runend--${content.tone}`);
        const word = el('div', 'ce-runend-word', content.word);
        const thread = el('div', 'ce-thread');
        thread.append(el('span', 'ce-thread-a'), el('span', 'ce-thread-b'));
        card.append(word, thread);
        if (content.sub) card.append(el('div', 'ce-runend-sub', content.sub));
        if (content.meta) card.append(el('div', 'ce-runend-meta', content.meta));
        layer.root.append(card);
        layer.addFitter(() => fitText(word, { min: 16 }));
        for (const line of card.querySelectorAll('.ce-runend-sub, .ce-runend-meta'))
          layer.addFitter(() => fitText(line, { min: 11 }));
      },
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    for (const unbind of [...this._unbinders]) unbind();
    this._unbinders.clear();
    this._clock.cancelAll();
    for (const layer of [...this._layers]) layer.destroy();
    this._layers.clear();
    this._blocking = 0;
    this.scene = null;
  }
}

/** Boss card DOM (exported for review tooling and tests). */
export function buildBossCard(content, portrait) {
  const entity = content.kind === 'entity';
  const card = el('div', `ce-boss${entity ? ' ce-boss--entity' : ''}`);
  const band = el('div', 'ce-boss-band');
  const bust = el('div', 'ce-boss-bust');
  if (portrait?.src) {
    const copies = entity
      ? ['ce-split ce-split--base', 'ce-split ce-split--a', 'ce-split ce-split--b']
      : [''];
    for (const extra of copies) {
      const img = el('img', `ce-boss-portrait ${extra}`.trim());
      img.alt = '';
      img.decoding = 'async';
      img.src = portrait.src;
      if (!portrait.rebuilt) img.classList.add('is-legacy');
      bust.append(img);
    }
  }
  band.append(bust);
  const text = el('div', 'ce-boss-text');
  if (entity) {
    text.append(el('div', 'ce-boss-mark', content.name));
  } else {
    if (content.kicker) text.append(el('div', 'ce-kicker', content.kicker));
    text.append(el('div', 'ce-boss-name', content.name));
    if (content.epithet) text.append(el('div', 'ce-boss-epithet', content.epithet));
    text.append(hairline('crimson'));
  }
  band.append(text);
  card.append(band);
  return card;
}
