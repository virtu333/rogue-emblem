// A rendering-only driver for the Event page: the real EventController, EventMenu and
// engine commands over a real run, with JourneyPresentation standing in for the DOM
// (import tests/harness/JourneyTestSetup.js first). It drives the shipping callbacks
// (a choice's onclick, the picker's apply, Continue, the header button) and reads the
// saved slot back; it holds no event logic of its own. Like RunDriver, `reload()` reads
// only what a refresh would: the saved slot.
import { vi } from 'vitest';
import { loadRun, saveRun } from '../../src/engine/RunManager.js';
import { EventController } from '../../src/ui/EventController.js';
import { arriveAs, baseData, newRun } from '../eventKit.js';

// A control's text as a browser names it (aria-hidden content is left out).
export const nodeText = (node) =>
  node.attributes?.['aria-hidden'] === 'true'
    ? ''
    : [node.textContent, ...(node.children || []).map(nodeText)].filter(Boolean).join(' ');

export class EventDriver {
  /**
   * @param {object} options
   * @param {object} [options.run] - a run (default: a fresh seeded standard run)
   * @param {string} [options.eventId] - the event the node holds (arrived, not yet chosen)
   * @param {object} [options.hints] - the slot's HintManager stand-in (default: nothing seen)
   * @param {string} [options.guidance] - the Guidance setting
   */
  constructor({ run = null, eventId = null, hints = null, guidance = 'full' } = {}) {
    this.run = run || newRun({ seed: 101, gold: 1000 });
    this.guidance = guidance;
    this.seen = hints?.seen || new Set();
    this.node = eventId ? arriveAs(this.run, eventId) : null;
    this.bind();
    saveRun(this.run, null, 1);
  }

  bind() {
    const seen = this.seen;
    const hints = { hasSeen: (id) => seen.has(id), markSeen: vi.fn((id) => seen.add(id)) };
    const settings = { getHints: () => true, getGuidance: () => this.guidance };
    const meta = { runsCompleted: 0 };
    this.hints = hints;
    this.scene = {
      runManager: this.run,
      gameData: this.run.gameData,
      registry: { get: (key) => ({ activeSlot: 1, hints, settings, meta })[key] ?? null },
      events: { once() {}, off() {} },
      checkActComplete: vi.fn(),
      drawMap: vi.fn(),
      handleBattle: vi.fn(async () => true),
      _showNodeFlavor: vi.fn(),
      _sceneLifecycleGeneration: 1,
      input: { enabled: true },
      eventOverlay: null,
    };
    this.controller = new EventController(this.scene);
  }

  /** Click the node: the route map's event branch (arrive, save, open the page). */
  open() {
    return this.controller.handleEvent(this.run.nodeMap.nodes.find((n) => n.id === this.node.id));
  }

  get menu() {
    return this.controller.nativeMenu;
  }
  get body() {
    return this.menu.surface.body;
  }
  get nodeNow() {
    return this.run.nodeMap.nodes.find((n) => n.id === this.node.id);
  }
  nodes() {
    return this.menu ? this.menu.surface.root.all() : [];
  }
  /** The page's buttons (the header's close button is `menu.closeButton`). */
  buttons() {
    return this.menu ? this.body.all().filter((n) => n.tag === 'button') : [];
  }
  /** The page's text (the whole body), joined with " | ". */
  text() {
    return this.body
      .all()
      .map((n) => n.textContent)
      .filter(Boolean)
      .join(' | ');
  }
  choice(id) {
    return this.buttons().find((b) => b.dataset?.choice === id);
  }
  button(label) {
    const found = this.buttons().filter((b) =>
      label instanceof RegExp ? label.test(nodeText(b)) : nodeText(b) === label,
    );
    if (found.length !== 1) throw new Error(`Expected one button ${label}, found ${found.length}`);
    return found[0];
  }
  press(label) {
    const b = typeof label === 'string' || label instanceof RegExp ? this.button(label) : label;
    if (b.disabled) throw new Error('Disabled button');
    return b.onclick();
  }
  /** The open picker's options (the ChoicePicker stand-in records them). */
  get picker() {
    return this.menu?.child?.options || null;
  }
  /** Confirm the picker on choice `index` (as ChoicePicker.confirm does: apply, then close). */
  confirm(index = 0) {
    const child = this.menu?.child;
    if (!child) throw new Error('No pending picker');
    const { choices, blocked, apply } = child.options;
    const choice = choices[index];
    if (choice === undefined) throw new Error('Missing choice');
    const reason = blocked?.(choice);
    if (reason) throw new Error(reason);
    const result = apply(choice);
    if (result?.ok !== false) child.close();
    return result;
  }
  /** Choose `choiceId` through the page: its button, then the picker's confirm. */
  choose(choiceId, { target = 0 } = {}) {
    this.press(this.choice(choiceId));
    return this.confirm(this.picker.confirmation ? 0 : target);
  }
  /** ESC, as MenuSurface routes it: the page's close handler (a picker closes first). */
  esc() {
    if (this.menu?.child) this.menu.child.close();
    else this.menu.surface.onClose();
  }
  /** Fight, win and carry the won run home: what the battle scene does (it saves the win). */
  fightAndWin({ gold = 100 } = {}) {
    this.press('Fight');
    this.run.completeBattle(this.run.getRoster(), this.node.id, gold, { turnCount: 5, turnPar: 5 });
    saveRun(this.run, null, 1);
  }
  /** The saved slot, as a refresh would read it. */
  saved() {
    return loadRun(baseData, 1);
  }
  /** A refresh: nothing live survives; the run, scene and controller come from the slot. */
  reload() {
    const run = loadRun(this.run.gameData, 1);
    if (!run) throw new Error('No persisted run to reload');
    this.run = run;
    this.bind();
  }
}
