// PromotionPathChooser — the choice between promotion paths, as a rite's
// threshold rather than a stat list (docs/art-direction/growth/README.md).
//
// One card per path: the class crest, the promoted portrait and the map
// sprite before → after, the stat bonuses, weapon-rank changes, new skills
// and growth/move changes, all readable at 844×390. Used by the battle
// Master Seal (PromotionChoicePanel), the church and the roster seal.
// Presentation and selection only: `apply` (optional) is the caller's
// command, run on Confirm; eligibility is revalidated there.
import { MenuSurface, element, button } from './MenuSurface.js';
import { crestElement } from './crestArt.js';
import { promotionPathContent, rankChipText, statChipText } from './growthContent.js';
import { projectedSpriteUnit, spriteElement, unitSpriteImage } from './growthSprites.js';
import { ceremonyPortrait } from './ceremonyDom.js';
import { skillGlyph } from './growthGlyphs.js';

function portraitImg(scene, unit, className) {
  const shown = className
    ? { ...projectedSpriteUnit(unit, className), name: unit.name, isLord: unit.isLord }
    : unit;
  const portrait = ceremonyPortrait(scene, shown);
  if (!portrait?.src) return null;
  const img = document.createElement('img');
  img.className = `gr-path-portrait${portrait.pc98 ? ' pc98-portrait' : ''}`;
  img.src = portrait.src;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.setAttribute('aria-hidden', 'true');
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

/** Card for one path (exported for review tooling and tests). */
export function buildPathCard({ scene, unit, cls, content, selected, onSelect }) {
  const card = button(null, onSelect, 're-btn gr-path');
  card.setAttribute('aria-pressed', String(Boolean(selected)));
  card.setAttribute('aria-label', `Select ${cls.name}`);
  card.dataset.path = cls.name;
  const head = element('span', null, 'gr-path-head');
  const crest = crestElement(cls.name, { className: 'gr-path-crest' });
  if (crest) head.append(crest);
  const title = element('span', null, 'gr-path-title');
  title.append(element('strong', cls.name));
  const sub = [cls.moveType, content?.role && content.role.length <= 42 ? content.role : null]
    .filter(Boolean)
    .join(' · ');
  if (sub) title.append(element('small', sub));
  head.append(title);
  const figures = element('span', null, 'gr-path-figures');
  const portrait = scene ? portraitImg(scene, unit, cls.name) : null;
  if (portrait) figures.append(portrait);
  if (scene) {
    const from = spriteElement(unitSpriteImage(scene, unit), 'gr-sprite--from');
    const to = spriteElement(
      unitSpriteImage(scene, projectedSpriteUnit(unit, cls.name)),
      'gr-sprite--to',
    );
    if (to) {
      const sprites = element('span', null, 'gr-path-sprites');
      if (from) sprites.append(from, element('span', '›', 'gr-path-arrow'));
      sprites.append(to);
      figures.append(sprites);
    }
  }
  if (figures.childElementCount) head.append(figures);
  card.append(head);
  if (!content) {
    card.append(element('span', 'Promotion data unavailable for this path.', 'gr-path-note'));
    return card;
  }
  const stats = element('span', null, 'gr-chips gr-chips--stats');
  stats.setAttribute('aria-label', 'Stat bonuses');
  for (const row of content.stats) {
    const chip = element('span', null, `gr-chip${row.stat === 'MOV' ? ' is-move' : ''}`);
    chip.append(element('span', row.stat, 'gr-chip-k'), element('b', `+${row.bonus}`));
    chip.title = `${row.stat} ${row.before} → ${row.after}`;
    chip.setAttribute('aria-label', `${statChipText(row)} (${row.before} to ${row.after})`);
    stats.append(chip);
  }
  card.append(stats);
  const ranks = element('span', null, 'gr-chips gr-chips--ranks');
  for (const rank of content.ranks) {
    const chip = element('span', rankChipText(rank), `gr-chip gr-rank is-${rank.change}`);
    ranks.append(chip);
  }
  card.append(ranks);
  for (const skill of content.skills) {
    const line = element('span', null, 'gr-path-skill');
    line.append(skillGlyph(skill.id, 'gr-glyph'), element('b', skill.name));
    if (skill.description) line.append(element('span', ` — ${skill.description}`));
    card.append(line);
  }
  // A deed's Oath rides every path (it belongs to the unit, not the class).
  if (content.oath?.learned) {
    const line = element('span', null, 'gr-path-skill gr-path-oath');
    line.append(
      skillGlyph(content.oath.skillId, 'gr-glyph'),
      element('b', `${content.oath.name} · ${content.oath.skillName}`),
    );
    if (content.oath.description) line.append(element('span', ` — ${content.oath.description}`));
    card.append(line);
  }
  const notes = [];
  if (content.growths.length)
    notes.push(`Growth ${content.growths.map((g) => `${g.stat} +${g.bonus}%`).join(', ')}`);
  if (content.moveType) notes.push(`${content.moveType.from} → ${content.moveType.to}`);
  if (content.grants.length) notes.push(`Receives ${content.grants.join(', ')}`);
  if (content.dropped.length) notes.push(`Skill limit: cannot learn ${content.dropped.join(', ')}`);
  if (notes.length) card.append(element('span', notes.join(' · '), 'gr-path-note'));
  return card;
}

export class PromotionPathChooser {
  /**
   * @param {{scene, unit, targets: object[], gameData, title?: string,
   *   closeLabel?: string, confirmLabel?: (cls) => string, note?: string,
   *   blocked?: (cls) => string, apply?: (cls) => any, onClose?: (cls|null) => void}} o
   */
  constructor({
    scene,
    unit,
    targets,
    gameData,
    title = 'Choose promotion',
    closeLabel = 'Cancel',
    confirmLabel = () => 'Confirm promotion',
    note = '',
    blocked = () => '',
    apply = null,
    onClose = null,
  }) {
    Object.assign(this, {
      scene,
      unit,
      gameData,
      confirmLabel,
      note,
      blocked,
      apply,
      onClose,
    });
    this.targets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    this.selected = this.targets[0] || null;
    this.contents = new Map(
      this.targets.map((cls) => {
        let content = null;
        try {
          content = promotionPathContent(unit, cls, gameData);
        } catch (error) {
          console.warn('[PromotionPathChooser] preview failed:', error);
        }
        return [cls, content];
      }),
    );
    this.surface = new MenuSurface(scene, title, () => this.close(null));
    this._onShutdown = () => this.destroy();
    scene?.events?.once?.('shutdown', this._onShutdown);
    this.surface.root.classList.add('gr-chooser');
    this.surface.header.querySelector('button').textContent = closeLabel;
    this.render();
    this.surface.body
      .querySelector('.gr-path[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
  }

  /** Resolves with the confirmed class (after `apply` succeeded) or null. */
  get result() {
    return (this._result ||= new Promise((resolve) => {
      this._resolve = resolve;
    }));
  }

  render(message = '') {
    if (this.closed) return;
    const body = this.surface.body;
    const scroll = body.querySelector('.gr-paths')?.scrollTop || 0;
    body.replaceChildren();
    const lead = element('p', null, 'gr-chooser-lead');
    lead.append(
      element('strong', this.unit?.name || ''),
      element('span', ` · ${this.unit?.className || ''} · Lv ${this.unit?.level ?? ''}`),
    );
    if (this.note) lead.append(element('span', ` · ${this.note}`, 'gr-chooser-note'));
    body.append(lead);
    const paths = element('div', null, 're-scroll gr-paths');
    paths.dataset.count = String(this.targets.length);
    for (const cls of this.targets) {
      paths.append(
        buildPathCard({
          scene: this.scene,
          unit: this.unit,
          cls,
          content: this.contents.get(cls),
          selected: cls === this.selected,
          onSelect: () => {
            if (this.busy) return;
            this.selected = cls;
            this.render();
            this.surface.body
              .querySelector('.gr-path[aria-pressed="true"]')
              ?.focus({ preventScroll: true });
          },
        }),
      );
    }
    if (!this.targets.length) paths.append(element('p', 'No available promotion classes.'));
    body.append(paths);
    const status = element('p', message, 'gr-chooser-status');
    status.setAttribute('role', 'status');
    const reason = this.selected ? this.blocked(this.selected) : '';
    if (!message && reason) status.textContent = reason;
    const confirm = button(
      this.selected ? this.confirmLabel(this.selected) : 'Confirm promotion',
      () => this.confirm(),
      're-btn re-btn--primary gr-chooser-confirm',
    );
    confirm.disabled = !this.selected || Boolean(reason) || Boolean(this.busy);
    const footer = element('div', null, 'gr-chooser-footer');
    footer.append(status, confirm);
    body.append(footer);
    paths.scrollTop = scroll;
  }

  async confirm() {
    if (this.busy || this.closed || !this.selected) return;
    const cls = this.selected;
    const reason = this.blocked(cls);
    if (reason) {
      this.render(reason);
      return;
    }
    if (!this.apply) {
      this._finish(cls);
      return;
    }
    this.busy = true;
    for (const b of this.surface.root.querySelectorAll('button')) b.disabled = true;
    try {
      const outcome = await this.apply(cls);
      if (this.closed) return;
      this.busy = false;
      if (outcome?.ok === false) {
        this.render(outcome.reason || 'Promotion unavailable.');
        this.surface.header.querySelector('button').disabled = false;
        return;
      }
      this._finish(cls, outcome);
    } catch (error) {
      console.error('[PromotionPathChooser] apply failed', error);
      this.busy = false;
      if (!this.closed) {
        this.render('Could not promote. Please try again.');
        this.surface.header.querySelector('button').disabled = false;
      }
    }
  }

  close(value = null) {
    if (this.busy || this.closed) return;
    this._finish(value);
  }

  _finish(value, outcome) {
    if (this.closed) return;
    void this.result; // the promise exists before anything settles it
    const resolve = this._resolve;
    this._resolve = null;
    this.destroy();
    resolve?.(value);
    this.onClose?.(value, outcome);
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    this.surface?.destroy();
    this.surface = null;
    // An unresolved chooser (scene shutdown) settles as cancelled.
    void this.result;
    const resolve = this._resolve;
    this._resolve = null;
    resolve?.(null);
  }
}
