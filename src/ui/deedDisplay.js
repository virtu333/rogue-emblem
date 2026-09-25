// deedDisplay — small renderers for Deeds & Epithets outside the ceremonies:
// the canvas fallback's clamped epithet line and the run end's "Deeds of the
// March". Presentation only.

import { unitEpithet } from '../engine/DeedTitles.js';

/** Shorten a Phaser text object with an ellipsis until it fits `maxWidth`. */
export function fitCanvasText(text, maxWidth) {
  if (!text || !(maxWidth > 0) || typeof text.setText !== 'function') return text;
  const full = String(text.text ?? '');
  if (!(text.width > maxWidth)) return text;
  let length = full.length;
  while (length > 1 && text.width > maxWidth) {
    length--;
    text.setText(`${full.slice(0, length).trimEnd()}…`);
  }
  return text;
}

/**
 * Rows for the run's end: every unit that earned a title, the living first
 * (roster order), then the fallen. `{name, epithet, className, level, fallen}`.
 */
export function deedsOfTheMarchRows(runManager) {
  const rows = [];
  const push = (unit, fallen) => {
    const epithet = unitEpithet(unit);
    if (!epithet || typeof unit?.name !== 'string') return;
    rows.push({
      name: unit.name,
      epithet,
      className: typeof unit.className === 'string' ? unit.className : '',
      level: Number.isFinite(Number(unit.level)) ? Math.trunc(Number(unit.level)) : null,
      fallen,
    });
  };
  for (const unit of runManager?.roster || []) push(unit, false);
  for (const unit of runManager?.fallenUnits || []) push(unit, true);
  return rows;
}

/** The "Deeds of the March" section (null when no unit earned a title). */
export function deedsOfTheMarchSection(runManager, doc = globalThis.document) {
  const rows = deedsOfTheMarchRows(runManager);
  if (!rows.length || !doc?.createElement) return null;
  const make = (tag, text, cls) => {
    const node = doc.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const section = make('section', null, 're-deeds-march');
  section.setAttribute('aria-label', 'Deeds of the March');
  section.append(make('h3', 'Deeds of the March'));
  const list = make('ul');
  for (const row of rows) {
    const item = make('li', null, row.fallen ? 'is-fallen' : '');
    const who = make('b');
    const appositive = ['who', 'bane', 'title'].includes(row.epithet.form);
    who.append(doc.createTextNode(`${row.name}${appositive ? ', ' : ' '}`));
    who.append(make('i', row.epithet.text));
    who.title = `${row.name}${appositive ? ', ' : ' '}${row.epithet.text}`;
    const meta = row.fallen
      ? 'Fell on the march'
      : [row.className, row.level ? `Lv ${row.level}` : ''].filter(Boolean).join(' · ');
    item.append(who, make('small', meta));
    list.append(item);
  }
  section.append(list);
  return section;
}
