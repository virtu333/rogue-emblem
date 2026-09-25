import { historyDisplayEntries, groupHistoryEntries } from '../engine/BattleHistoryPresentation.js';
import { BattleHistorySession } from './BattleHistorySession.js';
import { InputAction } from '../utils/InputActions.js';
import { canRewindToEntry, resolveRewindGranularity } from '../engine/BattleTimeline.js';
import { bindCancelablePress } from '../utils/cancelablePress.js';
import { MenuSurface, element } from './MenuSurface.js';
import './battleTimeline.css';

const KIND_LABELS = {
  turn_start: 'Turn begins',
  player_action: 'Player action',
  enemy_action: 'Enemy action',
  event: 'Battle event',
  recovery: 'Action in progress',
  rewind: 'Rewound here',
};
const phaseName = (phase) => (phase === 'enemy' ? 'Enemy' : 'Player');
const strings = (values) =>
  Array.isArray(values) ? values.filter((value) => typeof value === 'string').slice(0, 256) : [];
export const eventTitle = (entry) => {
  const primary =
    entry.beats?.find((b) => ['defeated', 'fell'].includes(b.type)) ||
    entry.beats?.find((b) => b.type === 'visited the village') ||
    entry.beats?.find((b) => b.outcome?.miss || b.outcome?.critical) ||
    entry.beats?.find((b) => b.outcome) ||
    entry.beats?.find(
      (b) => entry.actorId && b.actorId === entry.actorId && !['moved', 'changed'].includes(b.type),
    ) ||
    entry.beats?.find((b) => entry.actorId && b.actorId === entry.actorId);
  if (primary?.label) return primary.label;
  const facts = strings(entry.facts);
  const generic = (line) =>
    Object.values(KIND_LABELS).includes(line.replace(/[.!]$/, '')) ||
    /^(?:turn \d+|player phase|enemy phase|player turn begins|player action completed|enemy action completed|action resolved|action completed|combat resolved|before enemy phase|recovery checkpoint)(?:$|[ .:·])/i.test(
      line,
    );
  return (
    facts.find((line) => /(?: fell| defeated .+)\.$/.test(line)) ||
    facts.find((line) => line.trim() && !generic(line)) ||
    KIND_LABELS[entry.kind] ||
    'Battle event'
  );
};
const coordinate = (value, size) => Number.isInteger(value) && value >= 0 && value < size;

/** Read-only presentation. Only event-time, visibility-filtered preview data is
 * rendered; eligibility belongs to BattleTimeline and commit belongs to the caller. */
export class BattleTimelineView {
  constructor(
    scene,
    {
      history,
      charges = 0,
      difficulty = 'normal',
      granularity = undefined,
      allowPlayerActions = false,
      backLabel = null,
      onClose,
      onRewind,
      currentEntryId = null,
      fatal = false,
      session = null,
      selectedId = null,
    },
  ) {
    Object.assign(this, {
      history,
      charges,
      difficulty,
      granularity,
      allowPlayerActions,
      onClose,
      onRewind,
      currentEntryId,
      fatal,
    });
    this.scene = scene;
    this.entries = groupHistoryEntries(historyDisplayEntries(history));
    this.session =
      session ||
      (this.entries.some((e) => e.preview?.version === 2) && scene.game?.scene
        ? new BattleHistorySession(scene)
        : null);
    this.ownsSession = !session;
    this.cleanups = [];
    this.renderCleanups = [];
    this.rows = new Map();
    this.surface = new MenuSurface(scene, 'Battle timeline', () => this.close());
    this.root = this.surface.root;
    this.root.classList.add('bt-timeline');
    if (this.session) this.root.classList.add('bt-battlefield');
    const destroySurface = this.surface.destroy.bind(this.surface);
    this.surface.destroy = () => {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const cleanup of [...this.cleanups.splice(0), ...this.renderCleanups.splice(0)])
        cleanup();
      if (this.ownsSession) this.session?.destroy();
      destroySurface();
    };
    this.surface.header.querySelector('button').textContent =
      backLabel || (fatal ? 'Back to decision' : 'Back');
    this.surface.header.append(
      element('span', `${charges} ${charges === 1 ? 'charge' : 'charges'}`, 'bt-charges'),
    );
    this.layout = element('div', null, 'bt-layout');
    this.previewPanel = element('section', null, 'bt-preview');
    this.previewPanel.setAttribute('aria-label', 'Recorded board preview');
    this.list = element('div', null, 'bt-history');
    this.list.setAttribute('aria-label', 'Battle history');
    this.list.setAttribute('role', 'group');
    this.layout.append(this.previewPanel, this.list);
    this.footer = element('footer', null, 'bt-footer');
    this.reason = element('p', null, 'bt-reason');
    this.reason.setAttribute('role', 'status');
    this.rewindButton = this.press('Rewind… · 1 charge', () => {
      const selected = this.entries.find((entry) => entry.id === this.selectedId);
      if (selected && !this.busy && !this.disabledReason(selected)) this.onRewind?.(selected.id);
    });
    this.rewindButton.classList.add('bt-rewind');
    this.footer.append(this.reason, this.rewindButton);
    this.surface.body.append(
      element(
        'p',
        history.policy === 'fixed-v1'
          ? 'Select an event to preview it. Reviewing history is free; repeating the same actions keeps the same outcomes.'
          : 'This older battle rerolls outcomes after a rewind. Select an event to preview it for free.',
        'bt-help',
      ),
      this.layout,
      this.footer,
    );
    if (this.session) {
      this.help = this.surface.body.querySelector?.('.bt-help');
      if (this.help) this.help.textContent = 'Viewing history · reviewing is free';
      this.navigation = element('nav', null, 'bt-navigation');
      for (const [label, fn] of [
        ['Previous turn', () => this.stepTurn(-1)],
        ['Previous action', () => this.step(-1)],
        ['Next action', () => this.step(1)],
        ['Next turn', () => this.stepTurn(1)],
        [
          'History',
          () => {
            this.list.hidden = !this.list.hidden;
            this.session.layout();
            if (!this.list.hidden) this.revealSelected();
          },
        ],
      ])
        this.navigation.append(this.press(label, fn));
      this.list.hidden = true;
      this.surface.body.insertBefore(this.navigation, this.footer);
      this.surface.focusNext = (delta) => {
        const controls = [...this.root.querySelectorAll('button:not(:disabled),summary')].filter(
          (el) => el.getClientRects().length,
        );
        const at = controls.indexOf(document.activeElement);
        controls[(at + delta + controls.length) % controls.length]?.focus();
      };
      this.surface.onKey = (e) => {
        if (e.key === 'PageUp' || e.key === 'PageDown') {
          this.stepTurn(e.key === 'PageUp' ? -1 : 1);
          return true;
        }
        if (this.mapMode && e.key === 'Escape') {
          this.mapMode = false;
          return true;
        }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && this.mapMode) {
          this.session.pan(
            e.key === 'ArrowLeft' ? -32 : e.key === 'ArrowRight' ? 32 : 0,
            e.key === 'ArrowUp' ? -32 : e.key === 'ArrowDown' ? 32 : 0,
          );
          return true;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          this.step(e.key === 'ArrowLeft' ? -1 : 1);
          return true;
        }
        return false;
      };
      this.surface.onAction = (action, payload) => {
        if (action === InputAction.PREV_UNIT || action === InputAction.NEXT_UNIT) {
          this.stepTurn(action === InputAction.PREV_UNIT ? -1 : 1);
          return true;
        }
        if (this.mapMode && action === InputAction.CANCEL) {
          this.mapMode = false;
          return true;
        }
        if (this.mapMode && action === InputAction.NAVIGATE) {
          this.session.pan((payload?.dx || 0) * 32, (payload?.dy || 0) * 32);
          return true;
        }
        return false;
      };
    }
    this.renderRows();
    if (this.session?.returnUi) {
      this.list.hidden = !this.session.returnUi.historyOpen;
      this.list.scrollTop = this.session.returnUi.scrollTop;
      this.session.returnUi = null;
    }
    const latest = this.entries.at(-1);
    const initial =
      this.rows.get(selectedId) || this.rows.get(currentEntryId) || this.rows.get(latest?.id);
    if (initial) {
      if (this.session)
        this.select(
          this.rows.has(selectedId)
            ? selectedId
            : this.rows.has(currentEntryId)
              ? currentEntryId
              : latest?.id,
        );
      else initial.focus();
    } else this.showEmpty();
  }

  revealSelected() {
    if (!this.list.hidden) this.rows.get(this.selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }

  press(label, activate, ephemeral = false) {
    const control = element('button', label, 're-btn');
    control.type = 'button';
    (ephemeral ? this.renderCleanups : this.cleanups).push(
      bindCancelablePress(control, activate, {
        enabled: () => !this.destroyed,
        context: () => this.selectedId,
        threshold: (event) => (event.pointerType === 'mouse' ? 10 : 24),
      }),
    );
    return control;
  }

  renderRows() {
    if (this.history.earlierHistoryUnavailable || this.history.presentation?.earlierUnavailable)
      this.list.append(element('p', 'Earlier history unavailable.', 'bt-history-note'));
    let group = null;
    for (const entry of this.entries) {
      const heading = `Turn ${entry.turnNumber} · ${phaseName(entry.phase)} phase`;
      if (heading !== group) {
        group = heading;
        this.list.append(element('h3', heading));
      }
      const title = eventTitle(entry);
      const row = this.press(null, () => this.select(entry.id));
      row.classList.add('bt-entry');
      row.setAttribute('aria-pressed', 'false');
      row.append(
        element('span', title, 'bt-entry-title'),
        element(
          'span',
          entry.id === this.currentEntryId
            ? 'Now'
            : entry.destination && entry.preview?.enemiesActNext
              ? 'Before enemy phase'
              : KIND_LABELS[entry.kind] || 'Event',
          'bt-entry-kind',
        ),
      );
      row.addEventListener('focus', () => this.select(entry.id));
      this.rows.set(entry.id, row);
      this.list.append(row);
    }
  }

  disabledReason(entry) {
    if (entry.id === this.currentEntryId) return 'You are already here.';
    if (!Number.isFinite(this.charges) || this.charges < 1)
      return 'No rewind charges remaining. You can still review every retained event.';
    if (canRewindToEntry(this.history, entry.id, this)) return '';
    if (
      entry.kind === 'player_action' &&
      resolveRewindGranularity(this.difficulty, this.granularity) === 'turn'
    )
      return 'This difficulty rewinds to turn starts only.';
    if (entry.kind === 'player_action' && !this.allowPlayerActions)
      return 'This battle allows rewinding to turn starts only.';
    if (entry.reviewOnly && entry.kind === 'player_action')
      return 'Review only. Rewind state is no longer retained.';
    return 'View only. This event is not an available rewind destination.';
  }

  select(entryId) {
    if (this.destroyed) return;
    const entry = this.entries.find((item) => item.id === entryId);
    if (!entry) return;
    if (this.session && entry.preview?.version !== 2) {
      this.session.hide();
      this.busy = false;
    }
    if (this.session)
      this.previewPanel.classList.toggle('bt-legacy-preview', entry.preview?.version !== 2);
    const before = this.entries.find((e) => e.id === this.selectedId);
    const beforeIndex = this.entries.indexOf(before),
      index = this.entries.indexOf(entry);
    const settings = this.session ? this.scene.registry?.get?.('settings') : null;
    this.transition = {
      from: before?.preview?.version === 2 ? before.preview : null,
      beats: index < beforeIndex ? before?.beats || [] : entry.beats || [],
      reverse: index < beforeIndex,
      label: index < beforeIndex ? `Undoing: ${eventTitle(before)}` : '',
      animate:
        !this.busy &&
        !(index < beforeIndex
          ? before?.gap || before?.endpointOnly
          : entry.gap || entry.endpointOnly) &&
        Math.abs(index - beforeIndex) === 1 &&
        before?.preview?.version === 2 &&
        settings?.getBattleSpeed?.() !== 'instant' &&
        settings?.getReduceMotion?.() !== true,
    };
    this.selectedId = entryId;
    for (const [id, row] of this.rows) row.setAttribute('aria-pressed', String(id === entryId));
    this.revealSelected();
    const reason = this.disabledReason(entry);
    this.reason.textContent =
      reason ||
      (entry.preview?.enemiesActNext
        ? 'Enemies act next from this point. Rewinding costs 1 charge.'
        : 'Rewind opens a confirmation. It costs 1 charge.');
    this.rewindButton.disabled = Boolean(reason);
    for (const cleanup of this.renderCleanups.splice(0)) cleanup();
    this.previewPanel.replaceChildren(
      element(
        'h3',
        `${this.session ? 'Viewing history' : 'Preview'} · Turn ${entry.turnNumber} · ${phaseName(entry.phase)} phase`,
      ),
    );
    const preview = entry.preview;
    const summary = element('div', null, 'bt-summary');
    const facts = strings(entry.facts);
    const details = [...new Set([eventTitle(entry), ...facts])];
    for (const line of details) summary.append(element('p', line));
    if (this.session) {
      const heading = element('summary', `After: ${eventTitle(entry)}`);
      const disclosure = element('details', null, 'bt-details');
      disclosure.append(heading, summary);
      this.previewPanel.append(disclosure);
    }
    const context = strings(preview?.summary).filter(
      (line) => !details.includes(line) && !/^Turn \d+ · (Player|Enemy) phase$/.test(line),
    );
    for (const line of context) summary.append(element('p', line, 'bt-history-note'));
    this.renderBoard(preview);
    if (!this.session)
      this.previewPanel.insertBefore(summary, this.previewPanel.querySelector('.bt-board-key'));
  }

  step(delta) {
    const index = this.entries.findIndex((e) => e.id === this.selectedId);
    const entry = this.entries[Math.max(0, Math.min(this.entries.length - 1, index + delta))];
    if (entry && entry.id !== this.selectedId) this.select(entry.id);
  }

  stepTurn(delta) {
    const index = this.entries.findIndex((e) => e.id === this.selectedId);
    const candidates = this.entries.filter(
      (e, i) => e.kind === 'turn_start' && (delta < 0 ? i < index : i > index),
    );
    const entry = delta < 0 ? candidates.at(-1) : candidates[0];
    if (entry) this.select(entry.id);
  }

  renderBoard(preview) {
    if (this.session && preview?.version === 2) {
      const map = element('div', null, 'bt-map-viewport');
      map.setAttribute(
        'aria-label',
        'Historical battlefield. Drag to pan; select a unit to inspect recorded information.',
      );
      this.previewPanel.append(map);
      const controls = element('div', null, 'bt-map-controls');
      for (const [label, fn] of [
        [
          'Map',
          () => {
            this.mapMode = !this.mapMode;
            this.inspection.textContent = this.mapMode
              ? 'Map controls: directions pan; Cancel returns to history.'
              : '';
          },
        ],
        ['Zoom in', () => this.session.zoom(1.25)],
        ['Zoom out', () => this.session.zoom(0.8)],
        ['Focus action', () => this.session.focus(this.transition.beats)],
      ])
        controls.append(this.press(label, fn, true));
      this.inspection = element('p', '', 'bt-inspection');
      this.inspection.setAttribute('role', 'status');
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel'])
        controls.addEventListener(type, (e) => e.stopPropagation());
      map.append(controls);
      this.previewPanel.append(this.inspection);
      if (preview.tiles.some((t) => !t.known && t.fog === 'explored'))
        this.inspection.textContent = 'Earlier terrain appearance unavailable on shaded tiles.';
      this.session.onInspect = (text) => {
        if (!this.destroyed) this.inspection.textContent = text;
      };
      if (this.transition.animate && this.transition.reverse)
        this.inspection.textContent = this.transition.label;
      this.session.attach(map);
      this.busy = true;
      this.rewindButton.disabled = true;
      this.session.show(preview, this.transition, (ok) => {
        if (this.destroyed) return;
        this.busy = false;
        if (this.inspection.textContent === this.transition.label) this.inspection.textContent = '';
        const entry = this.entries.find((e) => e.id === this.selectedId);
        this.rewindButton.disabled = !ok || Boolean(this.disabledReason(entry));
        if (!ok)
          this.inspection.textContent =
            'The map preview could not load. Return to the battle and try again.';
      });
      return;
    }
    if (
      !preview ||
      !Number.isInteger(preview.cols) ||
      !Number.isInteger(preview.rows) ||
      preview.cols < 1 ||
      preview.rows < 1 ||
      preview.cols > 128 ||
      preview.rows > 128
    ) {
      this.previewPanel.append(element('p', 'No recorded board preview for this event.'));
      return;
    }
    const board = element('div', null, 'bt-board');
    board.setAttribute('aria-hidden', 'true');
    board.style.setProperty('--bt-cols', preview.cols);
    board.style.setProperty('--bt-rows', preview.rows);
    const tiles = new Map();
    for (const tile of (Array.isArray(preview.tiles) ? preview.tiles : []).slice(0, 16384)) {
      if (!tile || !coordinate(tile.col, preview.cols) || !coordinate(tile.row, preview.rows))
        continue;
      const label = typeof tile.label === 'string' ? tile.label : 'Terrain';
      if (label === 'Unknown') continue;
      tiles.set(`${tile.col},${tile.row}`, label);
      const cell = element('span', label.slice(0, 2), 'bt-tile');
      cell.title = label;
      cell.style.gridColumn = tile.col + 1;
      cell.style.gridRow = tile.row + 1;
      board.append(cell);
    }
    const units = element('ul', null, 'bt-unit-list');
    let index = 0;
    for (const unit of (Array.isArray(preview.units) ? preview.units : []).slice(0, 512)) {
      if (!unit || !coordinate(unit.col, preview.cols) || !coordinate(unit.row, preview.rows))
        continue;
      const faction = ['player', 'enemy', 'npc'].includes(unit.faction) ? unit.faction : 'npc';
      const side = { player: 'Ally', enemy: 'Enemy', npc: 'Neutral' }[faction];
      const marker = element('span', String(++index), `bt-unit bt-unit-${faction}`);
      marker.style.gridColumn = unit.col + 1;
      marker.style.gridRow = unit.row + 1;
      board.append(marker);
      const hp =
        Number.isFinite(unit.hp) && Number.isFinite(unit.maxHP)
          ? `${unit.hp}/${unit.maxHP} HP`
          : 'HP unknown';
      units.append(
        element(
          'li',
          `${index}. ${unit.name || 'Unit'} · ${side} · ${hp} · Column ${unit.col + 1}, row ${unit.row + 1} · ${tiles.get(`${unit.col},${unit.row}`) || 'Unknown terrain'}`,
        ),
      );
    }
    this.previewPanel.append(
      board,
      element(
        'p',
        'Numbered markers match the units below. Hatched tiles were unknown.',
        'bt-board-key',
      ),
      units,
    );
    if (!index) units.append(element('li', 'No visible units recorded.'));
  }

  showEmpty() {
    this.previewPanel.append(
      element('p', 'History begins when the next battle event is recorded.'),
    );
    this.reason.textContent = 'No retained events to rewind to.';
    this.rewindButton.disabled = true;
  }

  close() {
    if (this.destroyed) return;
    this.destroy();
    this.onClose?.();
  }

  destroy() {
    this.surface.destroy();
  }
}
