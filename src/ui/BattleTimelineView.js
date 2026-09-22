import { canRewindToEntry } from '../engine/BattleTimeline.js';
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
const eventTitle = (entry) => {
  const facts = strings(entry.facts);
  const generic = (line) =>
    Object.values(KIND_LABELS).includes(line.replace(/[.!]$/, '')) ||
    /^(?:turn \d+|player phase|enemy phase|player turn begins|player action completed|enemy action completed|action resolved|action completed|combat resolved|before enemy phase|recovery checkpoint)(?:$|[ .:·])/i.test(
      line,
    );
  return (
    facts.find((line) => line.trim() && !generic(line)) || KIND_LABELS[entry.kind] || 'Battle event'
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
      allowPlayerActions = false,
      onClose,
      onRewind,
      currentEntryId = null,
      fatal = false,
    },
  ) {
    Object.assign(this, {
      history,
      charges,
      difficulty,
      allowPlayerActions,
      onClose,
      onRewind,
      currentEntryId,
      fatal,
    });
    this.cleanups = [];
    this.rows = new Map();
    this.surface = new MenuSurface(scene, 'Battle timeline', () => this.close());
    this.root = this.surface.root;
    this.root.classList.add('bt-timeline');
    const destroySurface = this.surface.destroy.bind(this.surface);
    this.surface.destroy = () => {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const cleanup of this.cleanups.splice(0)) cleanup();
      destroySurface();
    };
    this.surface.header.querySelector('button').textContent = fatal ? 'Back to decision' : 'Back';
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
      const selected = this.history.entries.find((entry) => entry.id === this.selectedId);
      if (selected && !this.disabledReason(selected)) this.onRewind?.(selected.id);
    });
    this.rewindButton.classList.add('bt-rewind');
    this.footer.append(this.reason, this.rewindButton);
    this.surface.body.append(
      element(
        'p',
        history.policy === 'fixed-v1'
          ? 'Select an event to preview it. Reviewing history is free; repeating the same actions keeps the same outcomes.'
          : 'This older battle uses turn-start rewinds. Select an event to preview it for free.',
        'bt-help',
      ),
      this.layout,
      this.footer,
    );
    this.renderRows();
    const latest = this.history.entries.at(-1);
    const initial = this.rows.get(currentEntryId) || this.rows.get(latest?.id);
    if (initial) initial.focus();
    else this.showEmpty();
  }

  press(label, activate) {
    const control = element('button', label, 're-btn');
    control.type = 'button';
    this.cleanups.push(
      bindCancelablePress(control, activate, {
        enabled: () => !this.destroyed,
        context: () => this.selectedId,
        threshold: (event) => (event.pointerType === 'mouse' ? 10 : 24),
      }),
    );
    return control;
  }

  renderRows() {
    if (this.history.earlierHistoryUnavailable)
      this.list.append(element('p', 'Earlier history unavailable.', 'bt-history-note'));
    let group = null;
    for (const entry of this.history.entries) {
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
    if (entry.kind === 'player_action' && String(this.difficulty).toLowerCase() === 'lunatic')
      return 'Lunatic allows rewinding to turn starts only.';
    if (
      entry.kind === 'player_action' &&
      (this.history.policy === 'legacy-v1' || !this.allowPlayerActions)
    )
      return 'This battle allows rewinding to turn starts only.';
    return 'View only. This event is not an available rewind destination.';
  }

  select(entryId) {
    if (this.destroyed) return;
    const entry = this.history.entries.find((item) => item.id === entryId);
    if (!entry) return;
    this.selectedId = entryId;
    for (const [id, row] of this.rows) row.setAttribute('aria-pressed', String(id === entryId));
    const reason = this.disabledReason(entry);
    this.reason.textContent =
      reason ||
      (entry.preview?.enemiesActNext
        ? 'Enemies act next from this point. Rewinding costs 1 charge.'
        : 'Rewind opens a confirmation. It costs 1 charge.');
    this.rewindButton.disabled = Boolean(reason);
    this.previewPanel.replaceChildren(
      element('h3', `Preview · Turn ${entry.turnNumber} · ${phaseName(entry.phase)} phase`),
    );
    const preview = entry.preview;
    const summary = element('div', null, 'bt-summary');
    const facts = strings(entry.facts);
    const details = facts.length ? facts : [KIND_LABELS[entry.kind] || 'Battle event'];
    for (const line of details) summary.append(element('p', line));
    const context = strings(preview?.summary).filter(
      (line) => !details.includes(line) && !/^Turn \d+ · (Player|Enemy) phase$/.test(line),
    );
    for (const line of context) summary.append(element('p', line, 'bt-history-note'));
    this.renderBoard(preview);
    this.previewPanel.insertBefore(summary, this.previewPanel.querySelector('.bt-board-key'));
  }

  renderBoard(preview) {
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
