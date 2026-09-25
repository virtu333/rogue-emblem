// SlotPickerView — the save-select shrine (DOM). Three candle cards over the
// dimmed Hollow Sun, with a slow ember drift. Copy and state come from
// slotCardModel.js; routing stays in SlotPickerScene (selectSlot/confirmDelete).
//
// Presentation only: deterministic (no RNG), tokens only (slotPicker.css), and
// reduced motion (the in-game setting or the OS) freezes the art and the embers
// and skips the kindle beat.

import { element, button } from './MenuSurface.js';
import { pc98PortraitElement, portraitFaction } from './portraitArt.js';
import { mountKeyArtBackdrop } from '../art/keyart/keyArtBackdrop.js';
import { readSlotMilestones, selectTitleVariant } from '../art/keyart/titleVariant.js';

const EMBER_COUNT = 9;
/** How long the chosen candle flares before the scene moves on. */
export const KINDLE_MS = 420;

function systemReducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Reduced motion from the in-game setting, falling back to the OS preference. */
export function slotPickerReducedMotion(scene) {
  try {
    if (scene?.registry?.get?.('settings')?.getReduceMotion?.()) return true;
  } catch {
    /* settings unavailable */
  }
  return systemReducedMotion();
}

function candle(lit) {
  const el = element('span', null, `sp-candle${lit ? ' is-lit' : ''}`);
  el.setAttribute('aria-hidden', 'true');
  el.append(
    element('i', null, 'sp-flame'),
    element('i', null, 'sp-wick'),
    element('i', null, 'sp-wax'),
  );
  return el;
}

function crest(model) {
  const frame = element('div', null, 'sp-crest');
  frame.setAttribute('aria-hidden', 'true');
  const id = model.commander?.portraitId;
  if (id) {
    frame.classList.add('has-portrait');
    frame.append(
      pc98PortraitElement({
        id,
        size: 64,
        faction: portraitFaction({ faction: 'player', isLord: true }, id),
        className: 'sp-portrait',
        media: [['(min-height: 600px) and (min-width: 900px)', 96]],
      }),
    );
  } else if (model.state === 'empty') frame.append(candle(false));
  else frame.append(element('i', null, 'sp-sun'));
  return frame;
}

function thread(model) {
  if (!model.thread) return null;
  const row = element('div', null, 'sp-thread');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', model.threadLabel);
  for (let i = 0; i < model.thread.count; i++) {
    const knot = element(
      'i',
      null,
      `sp-knot${i < model.thread.index ? ' is-past' : i === model.thread.index ? ' is-here' : ''}`,
    );
    row.append(knot);
  }
  return row;
}

function seals(model) {
  if (!model.seals?.length) return null;
  const row = element('div', null, 'sp-seals');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', model.sealsLabel);
  for (const seal of model.seals) {
    const mark = element(
      'i',
      null,
      `sp-seal${seal.lit ? ' is-lit' : ''}${seal.crown ? ' is-crown' : ''}`,
    );
    mark.title = seal.lit ? seal.label : `${seal.label} — not yet`;
    row.append(mark);
  }
  return row;
}

/**
 * One candle card.
 * @param {object} model  slotCardModel()
 * @param {{ onPrimary: (card: HTMLElement) => void, onDelete: () => void }} handlers
 */
export function buildSlotCard(model, { onPrimary, onDelete }) {
  const card = element('section', null, `sp-card is-${model.state}`);
  card.dataset.slot = String(model.slot);
  card.dataset.grade = model.grade || 'act1';
  if (model.tone) card.dataset.tone = model.tone;
  const headingId = `sp-slot-${model.slot}-title`;
  card.setAttribute('aria-labelledby', headingId);

  const top = element('div', null, 'sp-top');
  top.append(candle(model.state !== 'empty'), element('span', model.kicker, 'sp-kicker'));
  if (model.saved) {
    // "Saved 42 min ago": the verb drops on narrow cards; the tooltip keeps the full stamp.
    const saved = element('span', null, 'sp-saved');
    const [verb, ...rest] = model.saved.text.split(' ');
    if (verb === 'Saved' && rest.length)
      saved.append(element('span', 'Saved ', 'sp-saved-verb'), rest.join(' '));
    else saved.textContent = model.saved.text;
    if (model.saved.title) saved.title = model.saved.title;
    top.append(saved);
  }

  const head = element('div', null, 'sp-head');
  const titles = element('div', null, 'sp-titles');
  if (model.actKicker) titles.append(element('p', model.actKicker, 'sp-act'));
  const title = element('h3', model.title, 'sp-title');
  title.id = headingId;
  titles.append(title);
  if (model.gradeName) titles.append(element('p', model.gradeName, 'sp-grade'));
  const threadRow = thread(model);
  if (threadRow) titles.append(threadRow);
  head.append(crest(model), titles);

  const lines = element('div', null, 'sp-lines');
  if (model.commander) {
    const who = element('p', null, 'sp-who');
    who.append(element('strong', model.commander.name), ` ${model.commander.line}`);
    lines.append(who);
  }
  const status = element('p', model.status, 'sp-status');
  status.id = `sp-slot-${model.slot}-status`;
  lines.append(status);
  if (model.note) {
    const note = element('p', model.note, 'sp-note');
    note.setAttribute('role', 'note');
    lines.append(note);
  }

  const foot = element('div', null, 'sp-foot');
  const sealRow = seals(model);
  if (sealRow) foot.append(sealRow);
  const tally = [model.battles, model.tally].filter(Boolean).join(' · ');
  if (tally) foot.append(element('span', tally, 'sp-tally'));
  if (model.currency) foot.append(element('span', model.currency, 'sp-currency'));

  const primary = button(
    model.primary.label,
    () => onPrimary(card),
    're-btn re-btn--primary sp-primary',
  );
  primary.setAttribute('aria-label', model.primary.ariaLabel);
  primary.setAttribute('aria-describedby', status.id);

  card.append(top, head, lines, foot, primary);
  if (model.canDelete) {
    const del = button('', () => onDelete(), 'sp-delete');
    del.setAttribute('aria-label', `Delete Slot ${model.slot}`);
    del.title = `Delete Slot ${model.slot}`;
    del.append(element('span', null, 'sp-delete-glyph'));
    card.append(del);
  }
  return card;
}

/**
 * The shrine's backdrop: dimmed Hollow Sun key art, a veil and the ember drift.
 * Returns a handle with destroy().
 */
export function mountSlotPickerArt(root, { reducedMotion }) {
  const art = element('div', null, 'sp-art');
  art.setAttribute('aria-hidden', 'true');
  const embers = element('div', null, 'sp-embers');
  for (let i = 0; i < EMBER_COUNT; i++) embers.append(element('i'));
  art.append(element('div', null, 'sp-veil'), embers);
  root.prepend(art);
  root.classList.toggle('is-still', Boolean(reducedMotion()));
  let backdrop = null;
  try {
    backdrop = mountKeyArtBackdrop(art, {
      variant: selectTitleVariant(readSlotMilestones()),
      reducedMotion,
      maxCrop: 1.3,
      fps: 20,
    });
  } catch {
    backdrop = null; // decoration only: the ink background stays
  }
  return {
    art,
    refresh() {
      root.classList.toggle('is-still', Boolean(reducedMotion()));
      backdrop?.refreshMotion?.();
    },
    setPaused(value) {
      backdrop?.setPaused?.(value);
    },
    destroy() {
      backdrop?.destroy?.();
      backdrop = null;
      art.remove();
    },
  };
}
