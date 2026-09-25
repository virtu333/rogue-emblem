// VisionRewindPicker — the Rewind surface: "Before <unit>'s <action>" points,
// newest first, one tap to preview on the map, one to spend the charge.
//
// Presentation only. Rows come from RewindDestinations.listRewindDestinations,
// eligibility from BattleTimeline, and the commit (charge, save, restore) from
// VisionRewindController. Map previews are drawn by the shared
// BattleHistorySession (a separate, paused-safe Phaser scene); nothing here
// touches the live battle, its RNG or the save.

import { MenuSurface, element } from './MenuSurface.js';
import { bindCancelablePress } from '../utils/cancelablePress.js';
import { InputAction } from '../utils/InputActions.js';
import { pc98PortraitElement, portraitFaction, portraitIdForUnit, usePc98 } from './portraitArt.js';
import { textureImageSource } from './textureImageSource.js';
import './visionRewind.css';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export class VisionRewindPicker {
  /**
   * @param {object} scene BattleScene (DOM host, textures, gameData)
   * @param {object} options
   * @param {{rows: Array, currentTurn: number, granularity: string, earlierUnavailable: boolean}} options.listing
   * @param {number} options.charges remaining Vision charges
   * @param {'fixed-v1'|'legacy-v1'} [options.policy]
   * @param {boolean} [options.fatal] opened from the fallen-commander decision
   * @param {object|null} [options.session] BattleHistorySession for map previews
   * @param {(row) => object|null} [options.frameFor] preview frame for a row
   * @param {(id) => object|null} [options.unitFor] actor data for a portrait
   * @param {number|null} [options.selectedId]
   * @param {() => void} options.onClose
   * @param {(id: number) => void} options.onConfirm
   * @param {(() => void)|null} [options.onHistory]
   */
  constructor(scene, options) {
    this.scene = scene;
    this.options = options;
    this.listing = options.listing;
    this.rows = this.listing.rows;
    this.charges = Math.max(0, Math.trunc(options.charges || 0));
    this.session = options.session || null;
    this.cleanups = [];
    this.rowElements = new Map();
    this.selectedId = null;
    this.previewGeneration = 0;

    const surface = new MenuSurface(scene, 'Rewind', () => this.close());
    this.surface = surface;
    this.root = surface.root;
    this.root.classList.add('vr-picker');
    if (this.session) this.root.classList.add('vr-with-map');
    const destroySurface = surface.destroy.bind(surface);
    surface.destroy = () => {
      if (this.destroyed) return;
      this.destroyed = true;
      this.previewGeneration++;
      for (const cleanup of this.cleanups.splice(0)) cleanup();
      destroySurface();
    };

    // Header: title, charges, History, Back.
    const back = surface.header.querySelector('button');
    back.textContent = options.fatal ? 'Back to decision' : 'Back';
    back.classList.add('vr-back');
    const charges = element('span', null, 'vr-charges');
    charges.setAttribute('aria-label', `${plural(this.charges, 'charge')} left this run`);
    const pips = element('span', null, 'vr-pips');
    pips.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < Math.min(this.charges, 5); i++) pips.append(element('i', null, 'vr-pip'));
    if (!this.charges) pips.append(element('i', null, 'vr-pip vr-pip--spent'));
    charges.append(pips, element('span', `${this.charges} left`, 'vr-charges-count'));
    surface.header.insertBefore(charges, back);
    if (options.onHistory) {
      this.historyButton = this.press(
        element('button', 'History', 're-btn re-btn--quiet vr-history'),
        () => options.onHistory(),
      );
      surface.header.insertBefore(this.historyButton, back);
    }

    // Body: map preview | list + footer.
    this.layout = element('div', null, 'vr-layout');
    this.map = element('div', null, 'vr-map');
    this.map.setAttribute(
      'aria-label',
      'Preview of the battlefield at the selected moment. Drag to pan, pinch or scroll to zoom.',
    );
    this.ribbon = element('p', '', 'vr-ribbon');
    this.ribbon.setAttribute('aria-hidden', 'true');
    this.map.append(this.ribbon);
    this.side = element('section', null, 'vr-side');
    this.list = element('div', null, 'vr-list');
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Rewind points, newest first');
    this.footer = element('footer', null, 'vr-footer');
    this.status = element('p', '', 'vr-status');
    this.status.setAttribute('role', 'status');
    this.confirm = this.press(
      element('button', 'Rewind here · 1 charge', 're-btn re-btn--primary vr-confirm'),
      () => this.confirmSelected(),
    );
    this.footer.append(this.status, this.confirm);
    this.side.append(this.list, this.footer);
    this.layout.append(this.map, this.side);
    surface.body.append(this.layout);

    this.renderRows();
    if (this.session) this.session.attach(this.map);
    else this.map.classList.add('vr-map--text');

    surface.onKey = (event) => this.onKey(event);
    surface.onAction = (action, payload) => this.onAction(action, payload);
    surface.focusNext = (delta) => this.focusNext(delta);

    const initial =
      this.rows.find((row) => row.id === options.selectedId) ||
      this.rows.find((row) => row.available) ||
      this.rows[0];
    if (initial) {
      this.select(initial.id);
      this.rowElements.get(initial.id)?.focus({ preventScroll: true });
      this.list.scrollTop = 0;
      this.reveal(initial.id);
    } else this.showEmpty();
  }

  press(control, activate, context = () => this.selectedId) {
    control.type = 'button';
    this.cleanups.push(
      bindCancelablePress(control, activate, {
        enabled: () => !this.destroyed,
        context,
        threshold: (event) => (event.pointerType === 'mouse' ? 10 : 24),
      }),
    );
    return control;
  }

  portrait(row) {
    const face = element('span', null, 'vr-face');
    face.setAttribute('aria-hidden', 'true');
    if (row.kind === 'turn_start' || !row.action) {
      face.classList.add('vr-face--turn');
      face.append(element('b', row.kind === 'turn_start' ? `T${row.turnNumber}` : '◆'));
      return face;
    }
    const unit = this.options.unitFor?.(row.action.actorId) || {
      name: row.action.actor,
      className: row.action.className,
      faction: 'player',
    };
    try {
      const pc98Id = usePc98() ? portraitIdForUnit(unit, this.scene.gameData || {}) : null;
      if (pc98Id) {
        face.append(
          pc98PortraitElement({
            id: pc98Id,
            size: 48,
            faction: portraitFaction(unit, pc98Id),
            className: 'vr-portrait',
          }),
        );
        return face;
      }
      const key = this.scene._getPortraitKey?.(unit);
      if (key && this.scene.textures?.exists?.(key)) {
        const src = textureImageSource(this.scene.textures.get(key));
        if (src) {
          const img = element('img', null, 'vr-portrait');
          img.src = src;
          img.alt = '';
          face.append(img);
          return face;
        }
      }
    } catch {
      /* portraits are decoration */
    }
    face.classList.add('vr-face--initial');
    face.append(element('b', (row.action.actor || '?').slice(0, 1)));
    return face;
  }

  renderRows() {
    if (!this.rows.length) return;
    let group = null;
    for (const row of this.rows) {
      if (row.turnNumber !== group) {
        group = row.turnNumber;
        const heading = element(
          'h3',
          row.currentTurn ? `Turn ${row.turnNumber} · this turn` : `Turn ${row.turnNumber}`,
          'vr-turn',
        );
        this.list.append(heading);
      }
      const button = element('button', null, 're-btn vr-row');
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', 'false');
      button.dataset.rewindId = String(row.id);
      if (!row.available) button.classList.add('vr-row--unavailable');
      if (row.kind === 'turn_start') button.classList.add('vr-row--turn');
      const text = element('span', null, 'vr-text');
      const title = row.kind === 'turn_start' ? `Start of turn ${row.turnNumber}` : row.title;
      text.append(element('span', title, 'vr-title'));
      const sub = !row.available
        ? row.reason
        : row.kind === 'turn_start'
          ? row.title.replace(/^Before/, 'before')
          : [row.action?.className, row.currentTurn ? '' : `Turn ${row.turnNumber}`]
              .filter(Boolean)
              .join(' · ') || `Turn ${row.turnNumber}`;
      text.append(element('span', sub, 'vr-sub'));
      const chips = element('span', null, 'vr-chips');
      for (const chip of row.chips || [])
        chips.append(element('span', chip.text, `vr-chip vr-chip--${chip.tone}`));
      button.append(this.portrait(row), text, chips);
      button.setAttribute(
        'aria-label',
        [title, row.kind === 'turn_start' ? sub : '', ...(row.chips || []).map((c) => c.text)]
          .concat(row.available ? [] : [row.reason])
          .filter(Boolean)
          .join('. '),
      );
      this.press(
        button,
        () => this.select(row.id),
        () => null,
      );
      button.addEventListener('focus', () => this.select(row.id));
      this.rowElements.set(row.id, button);
      this.list.append(button);
    }
    if (this.listing.earlierUnavailable)
      this.list.append(element('p', 'Earlier moments are no longer stored.', 'vr-note'));
  }

  showEmpty() {
    this.list.append(
      element(
        'p',
        'Nothing to rewind yet. Each action you complete becomes a moment you can return to.',
        'vr-empty',
      ),
    );
    this.status.textContent = this.listing.earlierUnavailable
      ? 'Earlier moments are no longer stored.'
      : 'Review is free.';
    this.confirm.disabled = true;
    this.ribbon.textContent = '';
    this.session?.hide?.();
  }

  reason(row) {
    if (!row) return 'Select a moment to preview it.';
    if (!row.available) return row.reason;
    if (this.charges < 1) return 'No rewind charges left. You can still preview.';
    return '';
  }

  select(id) {
    if (this.destroyed) return;
    const row = this.rows.find((item) => item.id === id);
    if (!row) return;
    const changed = this.selectedId !== id;
    this.selectedId = id;
    for (const [rowId, button] of this.rowElements)
      button.setAttribute('aria-selected', String(rowId === id));
    const reason = this.reason(row);
    this.confirm.disabled = Boolean(reason);
    this.confirm.textContent = reason ? 'Rewind here' : 'Rewind here · 1 charge';
    this.status.textContent = reason || `${this.undoSummary(row)} ${this.outcomeRule()}`;
    this.ribbon.textContent = `Turn ${row.turnNumber} · ${row.kind === 'turn_start' ? 'start of your turn' : row.title.replace(/^Before/, 'before')}`;
    this.reveal(id);
    if (changed) this.preview(row);
  }

  /** What confirming undoes, in the player's terms. */
  undoSummary(row) {
    if (!row.currentTurn) return `Returns to turn ${row.turnNumber}; everything after is undone.`;
    const undone = this.rows.filter((item) => item.currentTurn && item.id >= row.id).length;
    return undone <= 1 ? 'Undoes the last action.' : `Undoes the last ${undone} actions.`;
  }

  outcomeRule() {
    return this.options.policy === 'legacy-v1'
      ? 'This older battle rerolls outcomes after a rewind.'
      : 'Same moves, same outcomes.';
  }

  reveal(id) {
    this.rowElements.get(id)?.scrollIntoView?.({ block: 'nearest' });
  }

  preview(row) {
    const generation = ++this.previewGeneration;
    if (!this.session) return;
    let frame;
    try {
      frame = this.options.frameFor?.(row) || null;
    } catch {
      frame = null;
    }
    if (!frame) {
      this.session.hide();
      this.map.classList.add('vr-map--missing');
      return;
    }
    this.map.classList.remove('vr-map--missing');
    const beats = row.action
      ? [{ type: 'focus', actorId: row.action.actorId, targetId: null, label: '' }]
      : [];
    this.session.show(frame, { beats, animate: false }, (ok) => {
      if (this.destroyed || generation !== this.previewGeneration) return;
      if (!ok) {
        this.map.classList.add('vr-map--missing');
        return;
      }
      // Fit the board once; later pinch/scroll zoom is the player's.
      if (!this.fitted) {
        this.fitted = true;
        this.session.fit?.(beats);
      }
    });
  }

  confirmSelected() {
    const row = this.rows.find((item) => item.id === this.selectedId);
    if (!row || this.reason(row) || this.destroyed || this.confirming) return;
    this.confirming = true;
    this.options.onConfirm?.(row.id);
  }

  rowIndex() {
    return this.rows.findIndex((row) => row.id === this.selectedId);
  }

  moveSelection(delta) {
    if (!this.rows.length) return;
    const index = Math.max(0, Math.min(this.rows.length - 1, this.rowIndex() + delta));
    const row = this.rows[index];
    this.rowElements.get(row.id)?.focus({ preventScroll: true });
    this.select(row.id);
  }

  jumpTurn(delta) {
    const index = this.rowIndex();
    const turn = this.rows[index]?.turnNumber;
    const target =
      delta > 0
        ? this.rows.find((row, i) => i > index && row.turnNumber !== turn)
        : [...this.rows].reverse().find((row) => row.turnNumber > turn);
    if (target) {
      // Land on the newest point of that turn.
      const first = this.rows.find((row) => row.turnNumber === target.turnNumber);
      this.rowElements.get(first.id)?.focus({ preventScroll: true });
      this.select(first.id);
    }
  }

  focusNext(delta) {
    const controls = [...this.root.querySelectorAll('button:not(:disabled)')].filter(
      (el) => el.getClientRects().length,
    );
    const at = controls.indexOf(document.activeElement);
    controls[(at + delta + controls.length) % controls.length]?.focus();
  }

  onKey(event) {
    const onRow = document.activeElement?.classList?.contains('vr-row');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!onRow && this.selectedId != null) {
        this.rowElements.get(this.selectedId)?.focus();
        return true;
      }
      this.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'PageDown' || event.key === 'PageUp') {
      this.jumpTurn(event.key === 'PageDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!this.rows.length) return true;
      const row = event.key === 'Home' ? this.rows[0] : this.rows.at(-1);
      this.rowElements.get(row.id)?.focus();
      return true;
    }
    if (event.key === 'Enter' && onRow) {
      // A row previews; spending always takes the explicit Rewind button.
      if (!this.confirm.disabled) this.confirm.focus();
      return true;
    }
    return false;
  }

  onAction(action, payload) {
    if (action === InputAction.NAVIGATE && (payload?.dy || 0) !== 0) {
      this.moveSelection(payload.dy > 0 ? 1 : -1);
      return true;
    }
    if (action === InputAction.PREV_UNIT || action === InputAction.NEXT_UNIT) {
      this.jumpTurn(action === InputAction.NEXT_UNIT ? 1 : -1);
      return true;
    }
    if (action === InputAction.CONFIRM && document.activeElement?.classList?.contains('vr-row')) {
      if (!this.confirm.disabled) this.confirm.focus();
      return true;
    }
    return false;
  }

  close() {
    if (this.destroyed) return;
    this.destroy();
    this.options.onClose?.();
  }

  destroy() {
    this.surface.destroy();
  }
}
