// SurvivorsMenus.js — the DOM of Darkest Before Dawn: the HUD over the field (clock, EXP bar,
// level, kills, what the lord holds, the boss bar, the stick under the thumb) and the panels
// (choose a lord, a level-up's choices, pause, the night's end). Words come from
// survivorsModel.js; the scene owns the rules and calls in here to draw.
import { itemIcon } from '../itemIcons.js';
import { hasPc98, pc98PortraitElement, usePc98 } from '../portraitArt.js';
import portraitManifest from '../RebuiltPortraitManifest.json';
import { choiceView, clockText, gainsLine, heldView } from './survivorsModel.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function button(label, onClick, className = '') {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return b;
}

/** A lord's face: the PC-98 portrait when there is one, else the rebuilt one. */
export function lordPortrait(name, size = 64) {
  const id = `lord_${name.toLowerCase()}`;
  if (usePc98() && hasPc98(id))
    return pc98PortraitElement({ id, size, faction: 'ember', className: 'dbd-face', alt: name });
  const img = el('img', 'dbd-face');
  img.alt = name;
  img.width = size;
  img.height = size;
  const file = portraitManifest[id]?.file;
  if (file) img.src = `${import.meta.env.BASE_URL}assets/portraits/rebuilt/${file}`;
  return img;
}

export class SurvivorsMenus {
  /**
   * @param {HTMLElement} host  where the HUD lives (the game wrapper)
   * @param {{ config: object, onStick: (x: number, y: number) => void, onPause: () => void }} opts
   */
  constructor(host, { config, onStick, onPause }) {
    this.config = config;
    this.onStick = onStick;
    this.onPause = onPause;
    this.root = el('div', 'dbd-root');
    this.root.dataset.testid = 'survivors-root';
    this.hud = el('div', 'dbd-hud');
    this.xpBar = el('div', 'dbd-xp');
    this.xpFill = el('div', 'dbd-xp-fill');
    this.xpBar.append(this.xpFill);
    const row = el('div', 'dbd-row');
    this.levelText = el('span', 'dbd-level', 'Lv 1');
    this.clock = el('span', 'dbd-clock', clockText(config.durationSec));
    this.killText = el('span', 'dbd-kills', '0');
    this.pauseButton = button('Pause', () => this.onPause(), 'dbd-pause');
    this.pauseButton.setAttribute('aria-label', 'Pause');
    row.append(this.levelText, this.clock, this.killText, this.pauseButton);
    this.slots = el('div', 'dbd-slots');
    this.boss = el('div', 'dbd-boss');
    this.boss.hidden = true;
    this.bossName = el('span', 'dbd-boss-name');
    this.bossTrack = el('div', 'dbd-boss-track');
    this.bossFill = el('div', 'dbd-boss-fill');
    this.bossTrack.append(this.bossFill);
    this.boss.append(this.bossName, this.bossTrack);
    this.hud.append(this.xpBar, row, this.slots, this.boss);
    this.hud.hidden = true;
    this.stick = el('div', 'dbd-stick');
    this.knob = el('div', 'dbd-knob');
    this.stick.append(this.knob);
    this.stick.hidden = true;
    this.banner = el('div', 'dbd-banner');
    this.banner.hidden = true;
    this.panel = el('div', 'dbd-panel');
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.root.append(this.hud, this.stick, this.banner, this.panel);
    host.append(this.root);
    this.slotKey = '';
    this.stickEnabled = false;
    this._bindStick();
  }

  // --- the stick ---------------------------------------------------------------------------

  _bindStick() {
    const radius = 46;
    let origin = null;
    let pointerId = null;
    const move = (event) => {
      if (event.pointerId !== pointerId || !origin) return;
      let dx = event.clientX - origin.x;
      let dy = event.clientY - origin.y;
      const d = Math.hypot(dx, dy);
      if (d > radius) {
        dx = (dx / d) * radius;
        dy = (dy / d) * radius;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.onStick(dx / radius, dy / radius);
    };
    const end = (event) => {
      if (event.pointerId !== pointerId) return;
      origin = null;
      pointerId = null;
      this.stick.hidden = true;
      this.knob.style.transform = '';
      this.onStick(0, 0);
    };
    this.root.addEventListener('pointerdown', (event) => {
      if (!this.stickEnabled || pointerId !== null || event.target !== this.root) return;
      pointerId = event.pointerId;
      origin = { x: event.clientX, y: event.clientY };
      const box = this.root.getBoundingClientRect();
      this.stick.style.left = `${origin.x - box.left}px`;
      this.stick.style.top = `${origin.y - box.top}px`;
      this.stick.hidden = false;
      try {
        this.root.setPointerCapture(pointerId);
      } catch {
        /* capture is a nicety: move and up still arrive on the root */
      }
      event.preventDefault();
    });
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    this.releaseStick = () => {
      if (pointerId !== null) end({ pointerId });
    };
  }

  setStickEnabled(enabled) {
    this.stickEnabled = enabled;
    if (!enabled) this.releaseStick?.();
  }

  // --- the HUD -----------------------------------------------------------------------------

  showHud(show) {
    this.hud.hidden = !show;
  }

  updateHud(world, { timeLeft, boss }) {
    const pl = world.player;
    this.xpFill.style.width = `${Math.min(100, (pl.xp / pl.xpNext) * 100).toFixed(1)}%`;
    this.levelText.textContent = `Lv ${pl.level}`;
    this.clock.textContent = clockText(timeLeft);
    this.clock.classList.toggle('is-dawn', timeLeft <= 60);
    this.killText.textContent = String(world.kills);
    const held = heldView(this.config, pl);
    const key = held.map((h) => `${h.id}${h.level}`).join(',');
    if (key !== this.slotKey) {
      this.slotKey = key;
      this.slots.replaceChildren(
        ...held.map((h) => {
          const slot = el('span', `dbd-slot is-${h.kind}`);
          slot.title = `${h.name} ${h.level}`;
          slot.append(itemIcon(h.icon, { size: 16, socket: false }), el('b', '', String(h.level)));
          return slot;
        }),
      );
    }
    if (boss) {
      this.boss.hidden = false;
      this.bossName.textContent = boss.name;
      this.bossFill.style.width = `${Math.max(0, (boss.hp / boss.maxHp) * 100).toFixed(1)}%`;
    } else this.boss.hidden = true;
  }

  /** A line across the field for a moment ("The Iron Captain rides in"). */
  flashBanner(text, ms = 2200) {
    this.banner.textContent = text;
    this.banner.hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      this.banner.hidden = true;
    }, ms);
  }

  // --- panels -------------------------------------------------------------------------------

  _openPanel(kind, children) {
    this.panel.dataset.kind = kind;
    this.panel.replaceChildren(...children);
    this.panel.hidden = false;
    this.setStickEnabled(false);
    const first = this.panel.querySelector('button:not(:disabled)');
    first?.focus({ preventScroll: true });
  }

  closePanel() {
    this.panel.hidden = true;
    this.panel.replaceChildren();
    delete this.panel.dataset.kind;
  }

  get panelKind() {
    return this.panel.hidden ? null : this.panel.dataset.kind || null;
  }

  /** Move focus among the open panel's buttons (keys and the pad). */
  moveFocus(delta) {
    const buttons = [...this.panel.querySelectorAll('button:not(:disabled)')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + delta + buttons.length) % buttons.length].focus({ preventScroll: true });
  }

  /** Press the focused button of the open panel. */
  confirmFocus() {
    if (this.panel.contains(document.activeElement)) document.activeElement.click();
  }

  /**
   * Choose a lord. `lords`: [{ name, className, weaponName, available, best }].
   */
  showLordPicker({ lords, selected, onBegin, onBack, title }) {
    let chosen = selected;
    const list = el('div', 'dbd-lords');
    const render = () => {
      list.replaceChildren(
        ...lords.map((lord) => {
          const b = button(
            '',
            () => {
              if (!lord.available) return;
              chosen = lord.name;
              render();
              list.querySelector(`[data-lord="${lord.name}"]`)?.focus({ preventScroll: true });
            },
            'dbd-lord',
          );
          b.dataset.lord = lord.name;
          b.disabled = !lord.available;
          b.setAttribute('aria-pressed', String(lord.name === chosen));
          const words = el('span', 'dbd-lord-words');
          words.append(
            el('strong', '', lord.name),
            el('span', '', `${lord.className} · ${lord.weaponName}`),
            el('span', 'dbd-muted', lord.available ? lord.best : 'Meet them in a run first'),
          );
          b.append(lordPortrait(lord.name, 48), words);
          return b;
        }),
      );
    };
    render();
    const head = el('header', 'dbd-head');
    head.append(
      el('h1', '', title),
      el('p', 'dbd-muted', 'Hold until dawn. Your weapons strike on their own; you only move.'),
    );
    const actions = el('div', 'dbd-actions');
    const begin = button('Begin the night', () => onBegin(chosen), 'dbd-primary');
    begin.dataset.testid = 'survivors-begin';
    actions.append(button('Home Base', onBack), begin);
    this._openPanel('lords', [head, list, actions]);
    begin.focus({ preventScroll: true });
  }

  /** A level-up (or a chest): the gains, then the choices. `onChoose(index)`. */
  showOffer({ offer, onChoose }) {
    const head = el('header', 'dbd-head');
    const title = offer.source === 'chest' ? 'A chest' : `Level ${offer.level}`;
    head.append(el('h1', '', title));
    const gains = gainsLine(offer.gains);
    if (gains) head.append(el('p', 'dbd-gains', gains));
    const list = el('div', 'dbd-choices');
    offer.choices.forEach((choice, index) => {
      const view = choiceView(this.config, choice);
      const b = button('', () => onChoose(index), 'dbd-choice');
      b.dataset.testid = `survivors-choice-${index}`;
      const words = el('span', 'dbd-choice-words');
      words.append(el('strong', '', view.title), el('em', '', view.tag), el('span', '', view.note));
      b.append(itemIcon(view.icon, { size: 32 }), words);
      list.append(b);
    });
    this._openPanel('offer', [head, list]);
  }

  showPause({ onResume, onGiveUp, onHome }) {
    const head = el('header', 'dbd-head');
    head.append(el('h1', '', 'Paused'));
    const actions = el('div', 'dbd-actions is-column');
    actions.append(
      button('Resume', onResume, 'dbd-primary'),
      button('Give up the night', onGiveUp),
      button('Home Base', onHome),
    );
    this._openPanel('pause', [head, actions]);
  }

  showResult({ view, onAgain, onLords, onHome }) {
    const head = el('header', 'dbd-head');
    head.append(el('h1', view.won ? 'is-dawn' : '', view.title));
    const lines = el('div', 'dbd-lines');
    for (const line of view.lines) lines.append(el('p', '', line));
    const damage = el('ul', 'dbd-damage');
    for (const row of view.damage) {
      const li = el('li');
      li.append(el('span', '', row.name), el('b', '', row.amount.toLocaleString()));
      damage.append(li);
    }
    const actions = el('div', 'dbd-actions');
    const again = button('Again', onAgain, 'dbd-primary');
    again.dataset.testid = 'survivors-again';
    actions.append(button('Home Base', onHome), button('Change lord', onLords), again);
    this._openPanel('result', [head, lines, damage, actions]);
    again.focus({ preventScroll: true });
  }

  /** A line under the panel area while the field is painted. */
  showLoading(text) {
    this._openPanel('loading', [el('p', 'dbd-loading', text)]);
  }

  destroy() {
    clearTimeout(this._bannerTimer);
    this.releaseStick?.();
    this.root.remove();
  }
}
