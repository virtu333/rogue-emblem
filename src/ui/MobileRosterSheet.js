import { rebuiltPortraitKey } from './RebuiltPortraits.js';
import { createHealthBar } from './healthBar.js';
import { STAT_COLORS } from '../utils/uiStyles.js';
import { textureImageSource } from './textureImageSource.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import {
  rosterItemAction,
  rosterItemBlock,
  rosterAccessoryAction,
} from '../engine/RosterInventory.js';
import { getStaffRemainingUses, getStaffMaxUses } from '../engine/Combat.js';
import { getConsumableDescription, formatUses } from '../utils/consumableText.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { pushInputScope, popInputScope, hasInputFocus } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { inputHint } from '../utils/inputHint.js';
import './mobileRoster.css';

export function canShowMobileRoster(scene) {
  return (
    typeof document !== 'undefined' &&
    !!document.getElementById('game-wrapper') &&
    inputHint(scene, false, true)
  );
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

// One presentation for read-only battle inspection and between-battle management.
export class MobileRosterSheet {
  constructor({
    scene,
    units,
    index = 0,
    gameData,
    run = null,
    onClose,
    onAdvanced = null,
    advancedLabel = 'Advanced management',
    advancedDescription = 'Promotion, scrolls and trading',
    portraitKey = null,
  }) {
    Object.assign(this, {
      scene,
      units,
      index,
      gameData,
      run,
      onClose,
      onAdvanced,
      advancedLabel,
      advancedDescription,
      portraitKey,
    });
    this.tab = 'stats';
    this.previousFocus = document.activeElement;
    this.root = el('section', null, 'mr-sheet');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', run ? 'Manage roster' : 'Inspect roster');
    this.root.tabIndex = -1;
    for (const type of ['pointerdown', 'pointerup', 'click', 'wheel'])
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onClose();
      }
      if (e.key === 'Tab') {
        const controls = [...this.root.querySelectorAll('button:not(:disabled), select')];
        const current = controls.indexOf(document.activeElement);
        if (e.shiftKey && current <= 0) {
          e.preventDefault();
          controls.at(-1)?.focus();
        } else if (!e.shiftKey && current === controls.length - 1) {
          e.preventDefault();
          controls[0]?.focus();
        }
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    pushInputScope(this, (action) => {
      if ([InputAction.CANCEL, InputAction.PAUSE, InputAction.ROSTER].includes(action))
        this.onClose();
      if ([InputAction.PREV_UNIT, InputAction.NEXT_UNIT].includes(action) && this.units.length) {
        this.index =
          (this.index + (action === InputAction.NEXT_UNIT ? 1 : -1) + this.units.length) %
          this.units.length;
        this.tab = 'stats';
        this.render();
      }
    });
    this.shutdown = () => this.destroy();
    scene.events.once('shutdown', this.shutdown);
    this.render();
    this.root.querySelector('button')?.focus();
  }
  button(label, action, reason = '') {
    const b = el('button', label);
    b.type = 'button';
    b.disabled = !!reason;
    if (reason) b.title = reason;
    let start = null;
    b.addEventListener('pointerdown', (e) => {
      start = [e.clientX, e.clientY];
    });
    b.addEventListener('click', (e) => {
      if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10 && e.detail) {
        start = null;
        return;
      }
      start = null;
      if (!this.destroyed && hasInputFocus(this)) action();
    });
    return b;
  }
  portrait(unit, className) {
    const normalize = (name) => name.toLowerCase().replace(/ /g, '_');
    const named = this.gameData.lords?.some((lord) => lord.name === unit.name);
    const base = this.gameData.classes?.find(
      (entry) => entry.name === unit.className,
    )?.promotesFrom;
    const prefix = unit.faction === 'enemy' ? 'portrait_enemy_' : 'portrait_generic_';
    const fallbackCandidates = named
      ? [`portrait_lord_${normalize(unit.name)}`]
      : [
          this.portraitKey?.(unit),
          prefix + normalize(unit.className),
          ...(typeof base === 'string' ? [prefix + normalize(base)] : []),
        ];
    const candidates = [rebuiltPortraitKey(this.scene, unit), ...fallbackCandidates];
    let source = '';
    for (const key of candidates.filter(Boolean)) {
      if (this.scene.textures.exists(key)) {
        source = textureImageSource(this.scene.textures.get(key));
      } else {
        const deferred = this.scene.registry.get('deferredAssets') || [];
        const asset = deferred.find((entry) => entry.key === key && entry.group === 'portraits');
        if (asset) source = `${import.meta.env.BASE_URL}${asset.src}`;
      }
      if (source) break;
    }
    if (!source) return null;
    const image = el('img', null, className);
    image.src = source;
    image.alt = '';
    image.addEventListener('error', () => image.remove(), { once: true });
    return image;
  }
  render(message = '') {
    if (this.destroyed) return;
    const oldScroll = this.root.querySelector('.mr-content')?.scrollTop || 0;
    const focusKey = document.activeElement?.dataset?.focusKey;
    this.root.replaceChildren();
    const head = el('header');
    head.append(el('h2', this.run ? 'Your roster' : 'Unit details'));
    head.append(this.button('Close', this.onClose));
    this.root.append(head);
    const layout = el('div', null, 'mr-layout');
    const nav = el('nav', null, 'mr-units');
    nav.setAttribute('aria-label', 'Units');
    this.units.forEach((unit, index) => {
      const b = this.button('', () => {
        this.index = index;

        this.render();
      });
      b.classList.add('mr-unit-card');
      const face = this.portrait(unit, 'mr-unit-face');
      if (face) b.append(face);
      const info = el('span', null, 'mr-unit-info');
      info.append(
        el('strong', unit.name),
        el('span', `${unit.className} · HP ${unit.currentHP}/${unit.stats.HP}`),
      );
      info.append(createHealthBar(unit));
      b.append(info);
      b.setAttribute('aria-pressed', String(index === this.index));
      nav.append(b);
    });
    if (!this.units.length) nav.append(el('p', 'No units in the roster.'));
    layout.append(nav);
    const pane = el('div', null, 'mr-pane');
    const tabs = el('nav', null, 'mr-tabs');
    tabs.setAttribute('aria-label', 'Roster views');
    for (const [id, label] of [
      ['stats', 'Stats'],
      ['gear', 'Equipment'],
      ...(this.run ? [['convoy', 'Convoy']] : []),
    ]) {
      const b = this.button(label, () => {
        this.tab = id;
        this.render();
      });
      b.setAttribute('aria-pressed', String(this.tab === id));
      tabs.append(b);
    }
    pane.append(tabs);
    const body = el('div', null, 'mr-content');
    this.body = body;
    const unit = this.units[this.index];
    if (unit) {
      const summary = el('div', null, 'mr-summary');
      const portrait = this.portrait(unit, 'mr-portrait');
      if (portrait) summary.append(portrait);
      summary.append(
        el('h3', unit.name),
        el(
          'p',
          `Level ${getDisplayLevel(unit)} ${unit.className} · HP ${unit.currentHP}/${unit.stats.HP}`,
        ),
      );
      summary.append(createHealthBar(unit));
      body.append(summary);
      if (this.tab === 'stats') this.stats(unit);
      if (this.tab === 'gear') this.gear(unit);
    }
    if (this.tab === 'convoy') this.convoy(unit);
    const status = el('p', message, 'mr-status');
    status.setAttribute('role', 'status');
    body.append(status);
    pane.append(body);
    layout.append(pane);
    this.root.append(layout);
    if (this.onAdvanced) {
      const foot = el('footer');
      foot.append(
        el('span', this.advancedDescription),
        this.button(this.advancedLabel, this.onAdvanced),
      );
      this.root.append(foot);
    } else {
      const foot = el(
        'footer',
        'Inspect only during battle. Change equipment through the unit’s battle actions.',
      );
      this.root.append(foot);
    }
    [...this.root.querySelectorAll('button')].forEach((b, i) => {
      b.dataset.focusKey = String(i);
    });
    body.scrollTop = oldScroll;
    if (focusKey)
      (this.root.querySelector(`[data-focus-key="${focusKey}"]`) || this.root).focus({
        preventScroll: true,
      });
  }
  card(title, description = '') {
    const c = el('article', null, 'mr-card');
    c.append(el('h4', title));
    if (description) c.append(el('p', description));
    this.body.append(c);
    return c;
  }
  stats(unit) {
    const grid = el('dl', null, 'mr-stats');
    for (const [key, value] of Object.entries(unit.stats || {})) {
      const valueText = el('dd', String(value));
      valueText.style.color = STAT_COLORS[key] || '#e0e0e0';
      grid.append(
        el(
          'dt',
          {
            HP: 'HP',
            STR: 'Strength',
            MAG: 'Magic',
            SKL: 'Skill',
            SPD: 'Speed',
            LCK: 'Luck',
            DEF: 'Defense',
            RES: 'Resistance',
            MOV: 'Move',
          }[key] || key,
        ),
        valueText,
      );
    }
    this.body.append(grid);
    this.card(
      'Proficiencies',
      (unit.proficiencies || []).map((p) => `${p.type} ${p.rank || ''}`).join(' · ') || 'None',
    );
    for (const id of unit.skills || []) {
      const skill = this.gameData.skills?.find((s) => s.id === id);
      this.card(skill?.name || id, skill?.description || '');
    }
    if (!(unit.skills || []).length) this.card('Skills', 'No skills learned yet.');
  }
  itemDescription(item, unit) {
    if (item.type === 'Consumable')
      return `${getConsumableDescription(item)} · ${formatUses(item)}`;
    if (item.type === 'Staff')
      return `Staff · Range ${item.range} · Uses ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)}`;
    return `${item.type} · Might ${item.might ?? '—'} · Hit ${item.hit ?? '—'} · Crit ${item.crit ?? '—'} · Weight ${item.weight ?? '—'} · Range ${item.range ?? '—'}`;
  }
  itemCard(item, unit) {
    const c = this.card(item.name, this.itemDescription(item, unit));
    if (item === unit.weapon) c.append(el('p', 'Equipped', 'mr-equipped'));
    if (item.special) c.append(el('p', item.special));
    if (item.description) c.append(el('p', item.description));
    if (item.lore) {
      const d = el('details');
      d.append(el('summary', 'About this item'), el('p', item.lore));
      c.append(d);
    }
    return c;
  }
  action(card, label, unit, item, action) {
    const reason = rosterItemBlock(this.run, unit, item, action);
    card.append(
      this.button(
        label,
        () => {
          const result = rosterItemAction(this.run, unit, item, action);
          if (!result && action === 'heal') this.scene.registry.get('audio')?.playSFX('sfx_heal');
          this.render(result || `${label}: ${item.name}`);
        },
        reason,
      ),
    );
    if (reason) card.append(el('small', reason));
  }
  gear(unit) {
    this.body.append(el('h3', `Equipment · ${unit.inventory?.length || 0}/5`));
    for (const item of unit.inventory || []) {
      const c = this.itemCard(item, unit);
      if (
        unit.weapon &&
        item !== unit.weapon &&
        item.type === unit.weapon.type &&
        item.type !== 'Staff'
      ) {
        c.append(
          el(
            'p',
            `Compared with ${unit.weapon.name}: ` +
              ['might', 'hit', 'crit', 'weight']
                .map(
                  (k) =>
                    `${k} ${Number(item[k] || 0) - Number(unit.weapon[k] || 0) >= 0 ? '+' : ''}${Number(item[k] || 0) - Number(unit.weapon[k] || 0)}`,
                )
                .join(' · '),
          ),
        );
      }
      if (this.run) {
        if (unit.weapon !== item) this.action(c, 'Equip', unit, item, 'equip');
        this.action(c, 'Store', unit, item, 'store');
      }
    }
    if (!unit.inventory?.length)
      this.card('No equipment', 'This unit is not carrying any weapons.');
    this.body.append(el('h3', `Consumables · ${unit.consumables?.length || 0}/3`));
    for (const item of unit.consumables || []) {
      const c = this.itemCard(item, unit);
      if (this.run) {
        if (['heal', 'healFull'].includes(item.effect)) this.action(c, 'Use', unit, item, 'heal');
        this.action(c, 'Store', unit, item, 'store');
      }
    }
    if (!unit.consumables?.length)
      this.card('No consumables', 'Withdraw supplies from the convoy between battles.');
    const a = this.card(
      'Accessory',
      unit.accessory
        ? `${unit.accessory.name} · ${formatAccessoryDetail(unit.accessory)}`
        : 'No accessory equipped.',
    );
    if (this.run) {
      if (unit.accessory)
        a.append(
          this.button('Unequip accessory', () =>
            this.render(rosterAccessoryAction(this.run, unit) || 'Accessory returned to the pool.'),
          ),
        );
      for (const item of this.run.accessories || []) {
        const c = this.card(item.name, formatAccessoryDetail(item));
        c.append(
          this.button('Equip accessory', () =>
            this.render(rosterAccessoryAction(this.run, unit, item) || `${item.name} equipped.`),
          ),
        );
      }
    }
  }
  convoy(unit) {
    const items = this.run.getConvoyItems();
    const counts = this.run.getConvoyCounts();
    const caps = this.run.getConvoyCapacities();
    this.card(
      'Shared convoy',
      `Weapons ${counts.weapons}/${caps.weapons} · Consumables ${counts.consumables}/${caps.consumables}`,
    );
    if (!unit) {
      this.card('No recipient', 'A roster unit is needed to withdraw items.');
      return;
    }
    this.body.append(
      el('p', `Withdraw to ${unit.name}. Select another unit on the left to change recipient.`),
    );
    for (const item of [...items.weapons, ...items.consumables]) {
      const c = this.itemCard(item, unit);
      this.action(c, 'Withdraw', unit, item, 'withdraw');
    }
    if (!items.weapons.length && !items.consumables.length)
      this.card('Convoy is empty', 'Store carried items here to share them with your roster.');
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    popInputScope(this);
    this.scene.events.off('shutdown', this.shutdown);
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}
