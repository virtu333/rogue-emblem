// choiceCards — the draft: every "choose one" moment of a run as cards laid
// side by side (docs/art-direction/choice-screens/README.md).
//
// Structure is built with MenuSurface's element()/button() so the scripted
// service journeys (tests/harness) can render the same menus with their
// presentation substitutes; art (PC-98 portraits, crests, idling map
// sprites, item art, weapon seals) is added only when a real document
// exists and is dropped cleanly when an asset is missing. Presentation
// only: cards call back into their screen's existing commands and never
// touch the run, the RNG or saves.
import { element, button } from './MenuSurface.js';
import { crestElement } from './crestArt.js';
import { weaponGlyph, skillGlyph } from './growthGlyphs.js';
import { ceremonyPortrait } from './ceremonyDom.js';
import { pc98PortraitElement, portraitFaction, portraitIdForUnit, usePc98 } from './portraitArt.js';
import { battleUnitSpriteKey } from './BattleUnitVisuals.js';
import { unitSpriteImage } from './growthSprites.js';
import { ROSTER_DESKTOP_QUERY } from './unitPortrait.js';

export const CHOICE_SMALL_QUERY = '(max-width: 700px)';

const hasDocument = () => typeof document !== 'undefined' && !!document.createElement;

function setVar(node, name, value) {
  node?.style?.setProperty?.(name, String(value));
}

function span(text, className) {
  return element('span', text, className);
}

// ── Art ──────────────────────────────────────────────────────────────────

/** Settings' Reduce Motion (the OS preference is honoured by CSS as well). */
export function choiceReducedMotion(scene) {
  try {
    const settings = scene?.registry?.get?.('settings');
    if (typeof settings?.getReduceMotion === 'function') return Boolean(settings.getReduceMotion());
  } catch {
    /* settings are optional */
  }
  return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

/**
 * The unit's portrait at an integer scale of its PC-98 variant: 96 px on
 * phones in landscape, 64 px on small phones, 192 px on desktop (one
 * <picture>, so rotation and resize never resample the dither). Classic
 * art falls back to the ceremony portrait. Null when there is none.
 */
export function choicePortrait(scene, gameData, unit) {
  if (!hasDocument() || !unit) return null;
  try {
    if (usePc98()) {
      const id = portraitIdForUnit(unit, gameData || scene?.gameData || {});
      if (!id) return null;
      const node = pc98PortraitElement({
        id,
        size: 96,
        faction: portraitFaction(unit, id),
        className: 'ch-portrait',
        media: [
          [ROSTER_DESKTOP_QUERY, 192],
          [CHOICE_SMALL_QUERY, 64],
        ],
      });
      const img = node.tagName === 'PICTURE' ? node.querySelector('img') : node;
      img?.addEventListener('error', () => node.remove(), { once: true });
      return node;
    }
    const portrait = ceremonyPortrait(scene, unit);
    if (!portrait?.src) return null;
    const img = document.createElement('img');
    img.className = 'ch-portrait is-classic';
    img.src = portrait.src;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener('error', () => img.remove(), { once: true });
    return img;
  } catch {
    return null;
  }
}

const stripCache = new Map();

/**
 * The unit's map sprite, idling: traced strips (idle0..idle3) become a
 * four-frame CSS strip stepped at the battlefield's own cadence (260 ms);
 * other sprites show their first frame. Reduced motion holds frame 0.
 */
export function choiceSprite(scene, unit) {
  if (!hasDocument() || !scene?.textures || !unit?.className) return null;
  let strip = null;
  try {
    const key = battleUnitSpriteKey(scene, unit);
    const texture = key && scene.textures.exists?.(key) ? scene.textures.get(key) : null;
    const frames = ['idle0', 'idle1', 'idle2', 'idle3'];
    if (texture && frames.every((f) => texture.has?.(f))) {
      if (stripCache.has(key)) strip = stripCache.get(key);
      else {
        const first = texture.get('idle0');
        const w = first.cutWidth;
        const h = first.cutHeight;
        const canvas = document.createElement('canvas');
        canvas.width = w * frames.length;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        frames.forEach((name, i) => {
          const f = texture.get(name);
          const src = f.source?.image || texture.getSourceImage?.();
          ctx.drawImage(src, f.cutX, f.cutY, w, h, i * w, 0, w, h);
        });
        strip = { src: canvas.toDataURL('image/png'), frames: frames.length, key };
        if (stripCache.size > 48) stripCache.delete(stripCache.keys().next().value);
        stripCache.set(key, strip);
      }
    }
  } catch {
    strip = null;
  }
  const node = document.createElement('span');
  node.className = 'ch-sprite';
  node.setAttribute('aria-hidden', 'true');
  if (strip) {
    node.classList.add('is-idle');
    node.style.setProperty('--ch-sprite', `url("${strip.src}")`);
    node.style.setProperty('--ch-frames', String(strip.frames));
    node.dataset.spriteKey = strip.key;
    return node;
  }
  const still = unitSpriteImage(scene, unit);
  if (!still?.src) return null;
  node.style.setProperty('--ch-sprite', `url("${still.src}")`);
  node.style.setProperty('--ch-frames', '1');
  node.dataset.spriteKey = still.key;
  return node;
}

// Existing item art (assets/sprites/ui/icon_*.png). The items/icons study
// will fill `[data-item-art-hook]` (by item id / name / category) without
// touching these screens; until then these icons, else the category glyph.
const ITEM_ICONS = new Set([
  'sword', 'axe', 'lance', 'bow', 'tome', 'staff', 'potion', 'gold', 'scroll', 'light',
  'energy_drop', 'spirit_dust', 'secret_book', 'speedwing', 'dracoshield', 'talisman',
  'angelic_robe', 'whetstone', 'master_seal', 'elixir', 'power_ring', 'magic_ring',
  'speed_ring', 'shield_ring', 'barrier_ring', 'skill_ring', 'goddess_icon', 'seraph_robe',
  'boots', 'delphi_shield', 'veterans_crest', 'wrath_band', 'counter_seal', 'pursuit_ring',
  'nullify_ring', 'life_ring', 'forest_charm',
]); // prettier-ignore
const TYPE_ICONS = { Sword: 'sword', Axe: 'axe', Lance: 'lance', Bow: 'bow', Tome: 'tome', Staff: 'staff', Light: 'light', Scroll: 'scroll', Whetstone: 'whetstone' }; // prettier-ignore

/** Icon key for a reward, or '' (pure; exported for tests). */
export function itemIconKey(choice) {
  const item = choice?.item;
  if (!item) return choice?.type === 'gold' || choice?.type === 'skip' ? 'gold' : '';
  const own = String(item.name || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  if (ITEM_ICONS.has(own)) return own;
  if (item.teachesWeaponArtId || item.type === 'Scroll') return 'scroll';
  if (item.effect === 'promote' || item.effect === 'reclass') return 'master_seal';
  if (item.type === 'Consumable') return item.effect === 'healFull' ? 'elixir' : 'potion';
  if (item.type === 'Accessory' || choice.type === 'accessory') return 'goddess_icon';
  return TYPE_ICONS[item.type] || '';
}

function assetBase() {
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

/** The art slot of a reward card: existing item art, else the category glyph. */
export function itemArtSlot(choice, category) {
  const slot = span(null, 'ch-item-art');
  slot.dataset.itemArtHook = 'item-icon';
  slot.dataset.itemCategory = category || '';
  if (choice?.item?.id != null) slot.dataset.itemId = String(choice.item.id);
  if (choice?.item?.name) slot.dataset.itemName = String(choice.item.name);
  if (!hasDocument()) return slot;
  slot.setAttribute('aria-hidden', 'true');
  const key = itemIconKey(choice);
  if (key) {
    const img = document.createElement('img');
    img.className = 'ch-item-icon';
    img.src = `${assetBase()}assets/sprites/ui/icon_${key}.png`;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.addEventListener(
      'error',
      () => {
        img.remove();
        slot.classList.add('is-glyph');
      },
      { once: true },
    );
    slot.append(img);
  } else slot.classList.add('is-glyph');
  return slot;
}

/**
 * Soft fade edges on a scroll region: top/bottom masks appear only while
 * there is more to read that way (never hard-sliced text).
 */
export function fadeScroll(node) {
  if (!hasDocument() || !node?.addEventListener) return node;
  const update = () => {
    const more = node.scrollHeight - node.clientHeight > 1;
    node.classList.toggle('has-more', more);
    node.classList.toggle('at-start', node.scrollTop <= 1);
    node.classList.toggle('at-end', node.scrollTop + node.clientHeight >= node.scrollHeight - 1);
  };
  node.addEventListener('scroll', update, { passive: true });
  requestAnimationFrame(update);
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(node);
  return node;
}

// ── Pieces ───────────────────────────────────────────────────────────────

/**
 * A card button. Its accessible name is `label` (aria-label); the rich face
 * is appended by the caller. Without a document (the scripted journeys'
 * presentation nodes) the label is also the node's own text, which is what
 * those drivers read and press.
 */
export function choiceButton(label, action, className) {
  const card = button(hasDocument() ? null : label, action, className);
  card.type = 'button';
  if (label) card.setAttribute('aria-label', label);
  return card;
}

function statCell(row) {
  const cell = span(null, `ch-stat${row.best ? ' is-best' : ''}${row.grows ? ' is-grows' : ''}`);
  const bar = span(null, 'ch-bar');
  const fill = span(null, 'ch-bar-fill');
  setVar(fill, '--ch-fill', row.ratio.toFixed(3));
  bar.append(fill);
  cell.append(span(row.stat, 'ch-stat-k'), element('b', String(row.value)), bar);
  cell.setAttribute?.(
    'title',
    `${row.stat} ${row.value}${row.best ? ' · best of the draft' : ''}${row.grows ? ' · grows fast' : ''}`,
  );
  return cell;
}

function weaponRow(marks) {
  const row = span(null, 'ch-weapons');
  for (const mark of marks) {
    const w = span(null, `ch-weapon is-${mark.rank === 'M' ? 'master' : 'prof'}`);
    if (hasDocument()) w.append(weaponGlyph(mark.type, 'ch-weapon-glyph'));
    w.append(span(mark.rank, 'ch-weapon-rank'));
    w.setAttribute('title', mark.label);
    row.append(w);
  }
  return row;
}

function lineNode(line) {
  const node = span(null, `ch-line is-${line.kind}`);
  if (hasDocument() && line.kind === 'skill') node.append(skillGlyph(line.id, 'ch-line-glyph'));
  node.append(element('b', line.name));
  if (line.text) node.append(span(` ${line.text}`, 'ch-line-text'));
  return node;
}

/** A thin cue strip ("Your army lacks a healer"): verdigris, never a command. */
export function cueStrip(text, tone = 'good') {
  const cue = span(null, `ch-cue is-${tone}`);
  cue.append(span(null, 'ch-cue-mark'), span(text, 'ch-cue-text'));
  return cue;
}

/**
 * One candidate card. `content` comes from choiceContent.candidateCards.
 * `label` is the card's accessible name (and its text in the scripted
 * journeys); `seal` adds a price seal, `stamp` a state stamp (Hired).
 */
export function unitChoiceCard({
  scene,
  gameData,
  unit,
  content,
  selected = false,
  onSelect,
  label,
  kicker = '',
  seal = null,
  stamp = '',
  disabled = false,
  interactive = true,
  harnessLabel = '',
}) {
  let card;
  if (interactive) {
    card = choiceButton(harnessLabel || label, onSelect, 'ch-card ch-unit');
    card.setAttribute('aria-pressed', String(Boolean(selected)));
  } else {
    // A card on display (the contract screen): chosen, not a control.
    card = element('div', null, `ch-card ch-unit is-static${selected ? ' is-chosen' : ''}`);
    card.setAttribute('role', 'group');
  }
  card.setAttribute('aria-label', label);
  // Without a document (the scripted journeys' presentation nodes) a card
  // is its labelled button, exactly as those drivers read and press it.
  if (interactive && !hasDocument()) return card;
  card.dataset.choiceCard = content.name;
  if (content.isLord) card.dataset.lord = 'true';
  if (disabled) card.setAttribute('aria-disabled', 'true');
  const plate = span(null, 'ch-plate');

  const head = span(null, 'ch-head');
  const figure = span(null, 'ch-figure');
  const portrait = choicePortrait(scene, gameData, unit);
  if (portrait) figure.append(portrait);
  else figure.classList.add('is-empty');
  const crest = hasDocument() ? crestElement(unit?.className, { className: 'ch-crest' }) : null;
  if (crest) figure.append(crest);
  const sprite = choiceSprite(scene, unit);
  if (sprite) figure.append(sprite);
  head.append(figure);

  const id = span(null, 'ch-id');
  // Kicker: lord, how it moves (infantry is the default, left unsaid) and,
  // for recruits, the per-run temperament. Wraps only between its parts.
  const parts = kicker
    ? [kicker]
    : [
        content.isLord ? 'Lord' : null,
        content.moveType && content.moveType !== 'Infantry' ? content.moveType : null,
        content.temperament,
      ].filter(Boolean);
  if (parts.length) {
    const node = span(null, 'ch-kicker');
    parts.forEach((part, i) => node.append(span(i ? `· ${part}` : part, 'ch-kicker-part')));
    if (content.temperament) node.setAttribute('title', `Temperament · ${content.temperament}`);
    id.append(node);
  }
  id.append(element('strong', content.name, 'ch-name'));
  const epithet = span(content.epithet || '', 'ch-epithet');
  epithet.dataset.epithetHook = 'deeds';
  if (!content.epithet) epithet.hidden = true;
  id.append(epithet);
  id.append(span(content.className, 'ch-class'));
  const hp = span(null, `ch-hp${content.board.hp.best ? ' is-best' : ''}`);
  const hpBar = span(null, 'ch-hp-bar');
  const hpFill = span(null, 'ch-bar-fill');
  setVar(hpFill, '--ch-fill', Math.max(0, Math.min(1, content.board.hp.fill)).toFixed(3));
  hpBar.append(hpFill);
  hp.append(
    span(`Lv ${content.level ?? '?'}`, 'ch-level'),
    span('HP', 'ch-stat-k'),
    element('b', `${content.board.hp.current}/${content.board.hp.max}`),
    hpBar,
  );
  id.append(hp);
  const meta = span(null, 'ch-meta');
  meta.append(weaponRow(content.weapons), span(`MOV ${content.board.mov}`, 'ch-mov'));
  id.append(meta);
  head.append(id);
  plate.append(head);

  const stats = span(null, 'ch-stats');
  for (const row of content.board.stats) stats.append(statCell(row));
  plate.append(stats);

  const lines = fadeScroll(span(null, 'ch-lines'));
  if (content.role) lines.append(span(content.role, 'ch-role'));
  for (const line of content.lines) lines.append(lineNode(line));
  plate.append(lines);
  if (content.cue) plate.append(cueStrip(content.cue.text));
  card.append(plate);
  if (seal) card.append(priceSeal(seal));
  if (stamp) card.append(span(stamp, 'ch-stamp'));
  return card;
}

/**
 * The spoken summary of a candidate card: name, class, level, HP, the
 * stats it leads the draft in, and the roster cue.
 */
export function unitCardLabel(content, suffix = '') {
  const best = [content.board.hp, ...content.board.stats].filter((r) => r.best).map((r) => r.stat);
  return [
    content.name,
    `${content.className} · Lv ${content.level ?? '?'}`,
    `HP ${content.board.hp.current}/${content.board.hp.max}`,
    best.length ? `Best ${best.join(', ')}` : '',
    content.cue?.text || '',
    suffix,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Fit each ceremonial name to its card: shrink (down to `min` px) until no
 * word overflows its box; a single-line name that still does not fit may
 * then wrap. Runs after the display face has loaded and whenever the row
 * resizes. Returns a stop function.
 */
export function fitDraft(root, selector = '.ch-name', { min = 12 } = {}) {
  if (!hasDocument() || !root?.querySelectorAll) return () => {};
  let frame = 0;
  const fit = () => {
    frame = 0;
    if (!root.isConnected) return;
    for (const node of root.querySelectorAll(selector)) {
      node.style.fontSize = '';
      node.style.whiteSpace = '';
      const start = parseFloat(getComputedStyle(node).fontSize) || 16;
      let size = start;
      let guard = 24;
      while (node.scrollWidth > node.clientWidth + 1 && size > min && guard-- > 0) {
        size -= 1;
        node.style.fontSize = `${size}px`;
      }
      if (node.scrollWidth > node.clientWidth + 1) node.style.whiteSpace = 'normal';
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(fit);
  };
  schedule();
  document.fonts?.ready?.then(schedule).catch(() => {});
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(schedule);
    observer.observe(root);
  }
  return () => {
    observer?.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}

/** A gold wax seal with a price: { amount, after, short } */
export function priceSeal({ amount, after = null, short = false }) {
  const seal = span(null, `ch-seal${short ? ' is-short' : ''}`);
  seal.append(element('b', `${amount} G`));
  if (after != null) seal.append(span(`${after} G after`, 'ch-seal-after'));
  return seal;
}

/** The row cards sit in (`count` sizes the columns). */
export function draftRow(count, className = '') {
  const row = element('div', null, `ch-draft ${className}`.trim());
  row.dataset.count = String(count);
  setVar(row, '--ch-n', count);
  return row;
}

/** Footer: a quiet legend/status on the left, actions on the right. */
export function draftFooter(...actions) {
  const footer = element('div', null, 'ch-footer');
  const lead = element('p', null, 'ch-footer-lead');
  footer.append(lead, ...actions);
  return { footer, lead };
}

/** The legend line: gold marks the draft's best, the chevron the fastest growth. */
export function statLegend() {
  const legend = span(null, 'ch-legend');
  legend.append(
    span(null, 'ch-legend-best'),
    span('Best in draft', 'ch-legend-text'),
    span(null, 'ch-legend-grows'),
    span('Grows fastest', 'ch-legend-text'),
  );
  return legend;
}

/**
 * The confirm beat: the chosen card seals (a short ember flare) before the
 * screen hands off to the join ceremony. Instant under reduced motion.
 */
export function sealChoice(root, card, reduced, done) {
  if (!card || reduced || !hasDocument()) {
    done();
    return;
  }
  root?.classList?.add('is-sealing');
  card.classList.add('is-sworn');
  setTimeout(done, 260);
}
