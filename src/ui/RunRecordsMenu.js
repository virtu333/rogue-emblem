import { MenuSurface, element, button } from './MenuSurface.js';
import { MAX_SLOTS, getMetaKey } from '../engine/SlotManager.js';
import { mergeRunRecords } from '../engine/RunRecords.js';
import { withUnitFace, unitPortrait } from './unitPortrait.js';
import { itemIcon } from './itemIcons.js';
import { baseItemName } from './itemIconIds.js';
import { InputAction } from '../utils/InputActions.js';
import {
  fellAtText,
  isDetailedRecord,
  lordsFirst,
  plainUnitLine,
  recordDate,
  recordDeeds,
  recordDifficulty,
  recordFacts,
  recordGear,
  recordListLabel,
  recordListMeta,
  recordLordNames,
  recordSkills,
  recordStatRows,
  recordTallyText,
  unitClassLine,
  unitTitle,
} from './runRecordsContent.js';

/** Every slot's records, newest first (a corrupt slot never hides the others). */
function readRecords() {
  const rows = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    try {
      const saved = JSON.parse(localStorage.getItem(getMetaKey(slot)) || '{}');
      for (const record of mergeRunRecords(saved.runRecords || [])) rows.push({ record, slot });
    } catch {
      /* A corrupt slot must not hide the other archives. */
    }
  }
  return rows.sort((a, b) => b.record.endedAt - a.record.endedAt);
}

function modeChip(gameData, difficultyId) {
  const mode = recordDifficulty(gameData, difficultyId);
  const chip = element('span', mode.label, 'rr-mode');
  chip.dataset.mode = mode.id;
  if (mode.color) chip.style.setProperty('--rr-mode', mode.color);
  return chip;
}

function face(scene, gameData, unit, className) {
  try {
    return unitPortrait(scene, gameData, unit, className);
  } catch {
    return null; // a face is decoration: the card works without it
  }
}

/**
 * The catalog entry a recorded name stands for (its type and tier pick the icon's
 * fallback and rim); the name itself when the data no longer has it.
 */
function catalogItem(gameData, name) {
  const base = baseItemName(name);
  for (const pool of [gameData.weapons, gameData.consumables, gameData.accessories]) {
    const found = Array.isArray(pool) ? pool.find((item) => item?.name === base) : null;
    if (found) return { ...found, name };
  }
  return name;
}

function list(items, className, render) {
  const ul = element('ul', null, className);
  for (const item of items) ul.append(render(item));
  return ul;
}

function unitCard(scene, gameData, unit, { fallen = false } = {}) {
  const card = element('article', null, `rr-unit${fallen ? ' is-fallen' : ''}`);
  if (unit.isLord) card.dataset.lord = 'true';
  const head = element('div', null, 'rr-unit-head');
  const portrait = face(scene, gameData, unit, 'rr-face');
  if (portrait) head.append(portrait);
  const id = element('div', null, 'rr-unit-id');
  const name = element('h4', unit.name, 'rr-unit-name');
  const title = unitTitle(unit);
  if (title !== unit.name)
    name.append(element('span', title.slice(unit.name.length), 'rr-epithet'));
  const cls = element('p', unitClassLine(unit), 'rr-unit-class');
  if (unit.isLord) cls.append(' ', element('span', 'Lord', 'rr-lord'));
  id.append(name, cls);
  if (fallen) id.append(element('p', fellAtText(unit.fellAt), 'rr-fell'));
  head.append(id);
  card.append(head);

  const stats = recordStatRows(unit);
  if (stats.length) {
    const strip = element('dl', null, 'rr-stats');
    for (const { label, value } of stats) {
      const cell = element('div', null, 'rr-stat');
      cell.append(element('dt', label), element('dd', String(value)));
      strip.append(cell);
    }
    card.append(strip);
  }
  const gear = recordGear(unit);
  if (gear.length)
    card.append(
      list(gear, 'rr-gear', ({ name: itemName, kind }) => {
        const li = element('li', null, `rr-chip rr-gear-${kind}`);
        try {
          li.append(itemIcon(catalogItem(gameData, itemName), { size: 16, kind: 'item' }));
        } catch {
          /* the name alone still reads */
        }
        li.append(element('span', itemName));
        return li;
      }),
    );
  const skills = recordSkills(unit, gameData.skills);
  if (skills.length)
    card.append(
      list(skills, 'rr-skills', (skill) => {
        const li = element('li', skill.name, 'rr-chip rr-skill');
        if (skill.description) li.title = skill.description;
        return li;
      }),
    );
  const deeds = recordDeeds(unit, gameData.deeds);
  if (deeds.length)
    card.append(
      list(deeds, 'rr-deeds', (deed) => {
        const li = element('li', deed.name, 'rr-chip rr-deed');
        if (deed.lore) li.title = deed.lore;
        return li;
      }),
    );
  const tally = recordTallyText(unit.tally);
  card.append(
    element('p', tally || (fallen ? 'No deeds tallied' : 'No kills tallied'), 'rr-tally'),
  );
  return card;
}

function sectionTitle(text, count) {
  const h = element('h3', text, 'rr-section-title');
  h.append(' ', element('span', String(count), 'rr-count'));
  return h;
}

export function showRunRecords(scene) {
  if (scene.nativeMenu) return scene.nativeMenu;
  const gameData = scene.gameData || {};
  const rows = readRecords();
  const menu = new MenuSurface(scene, 'Victory records', () => {
    menu.destroy();
    scene.nativeMenu = null;
  });
  scene.nativeMenu = menu;
  menu.root.classList.add('re-run-flow', 'rr-records');
  let view = 'list';
  let listScroll = 0;

  const renderList = (focusRow = null) => {
    view = 'list';
    menu.root.dataset.view = 'list';
    menu.body.replaceChildren(
      element(
        'p',
        'Victories recorded from this update onward. Each save slot keeps its latest 50 wins.',
        'rr-intro',
      ),
    );
    if (!rows.length)
      menu.body.append(
        element(
          'p',
          'No victories recorded yet. Complete a run to preserve your final roster here.',
          'rr-empty',
        ),
      );
    let focusTarget = null;
    for (const row of rows) {
      const { record, slot } = row;
      const entry = button('', () => renderDetail(row), 're-btn rr-entry');
      entry.setAttribute('aria-label', recordListLabel(record, gameData, slot));
      const faces = element('span', null, 'rr-entry-faces');
      for (const lord of record.roster.filter((u) => u.isLord).slice(0, 3)) {
        const img = face(scene, gameData, lord, 'mr-unit-face');
        if (img) faces.append(img);
      }
      const main = element('span', null, 'rr-entry-main');
      const top = element('span', null, 'rr-entry-top');
      top.append(modeChip(gameData, record.difficulty));
      if (record.noMetaMode === true) top.append(element('span', 'No Meta', 'rr-badge'));
      top.append(element('span', `${recordDate(record)} · Slot ${slot}`, 'rr-entry-date'));
      main.append(
        top,
        element('strong', recordLordNames(record) || 'A nameless company', 'rr-entry-lords'),
        element('small', recordListMeta(record), 'rr-entry-meta'),
      );
      entry.append(faces, main);
      menu.body.append(entry);
      if (row === focusRow) focusTarget = entry;
    }
    if (focusTarget) {
      menu.body.scrollTop = listScroll;
      focusTarget.focus({ preventScroll: true });
      focusTarget.scrollIntoView?.({ block: 'nearest' });
    } else menu.focusContent();
  };

  const renderDetail = (row) => {
    const { record, slot } = row;
    listScroll = menu.body.scrollTop;
    view = 'detail';
    menu.root.dataset.view = 'detail';
    const back = button('Back to victories', () => renderList(row), 're-btn rr-back');
    menu.body.replaceChildren(back);
    menu.body.scrollTop = 0;

    const hero = element('section', null, 'rr-hero re-bracket');
    hero.setAttribute('aria-label', 'Victory');
    const top = element('div', null, 'rr-hero-top');
    top.append(modeChip(gameData, record.difficulty));
    if (record.noMetaMode === true) top.append(element('span', 'No Meta Victory', 'rr-badge'));
    top.append(element('span', `Won ${recordDate(record)} · Slot ${slot}`, 'rr-hero-date'));
    hero.append(top, element('h3', recordLordNames(record) || 'Victory', 'rr-hero-title'));
    const facts = element('dl', null, 'rr-facts');
    for (const fact of recordFacts(record, gameData)) {
      const cell = element('div', null, `rr-fact rr-fact-${fact.key}`);
      if (fact.phase) cell.dataset.phase = fact.phase;
      cell.append(element('dt', fact.label), element('dd', fact.value));
      facts.append(cell);
    }
    hero.append(facts);
    menu.body.append(hero);

    if (!isDetailedRecord(record)) {
      // Records from before v2 hold only who survived: the plain rows they always had.
      if (record.noMetaMode === true) menu.body.append(element('p', 'Badge: No Meta Victory'));
      for (const unit of record.roster)
        menu.body.append(
          withUnitFace(element('p', plainUnitLine(unit), 'rr-plain'), scene, gameData, unit),
        );
      back.focus();
      return;
    }
    const survivors = lordsFirst(record.roster);
    menu.body.append(sectionTitle('Survivors', survivors.length));
    const grid = element('div', null, 'rr-units');
    for (const unit of survivors) grid.append(unitCard(scene, gameData, unit));
    if (!survivors.length) grid.append(element('p', 'No one came home.', 'rr-empty'));
    menu.body.append(grid);

    const fallen = record.fallen || [];
    menu.body.append(sectionTitle('Fallen', fallen.length));
    if (fallen.length) {
      const fallenGrid = element('div', null, 'rr-units rr-fallen');
      for (const unit of fallen)
        fallenGrid.append(unitCard(scene, gameData, unit, { fallen: true }));
      menu.body.append(fallenGrid);
    } else menu.body.append(element('p', 'No one fell on this march.', 'rr-empty'));
    back.focus();
  };

  // The detail view is mostly reading: up/down scroll it until an edge, then move focus.
  const scrollDetail = (direction, page = false) => {
    const body = menu.body;
    const room =
      direction > 0
        ? body.scrollTop + body.clientHeight < body.scrollHeight - 1
        : body.scrollTop > 0;
    if (!room) return false;
    const step = Math.max(48, Math.round(body.clientHeight * (page ? 0.9 : 0.4)));
    body.scrollTop += direction * step;
    return true;
  };
  menu.onKey = (event) => {
    if (view !== 'detail' || event.metaKey || event.ctrlKey || event.altKey) return false;
    if (event.key === 'Escape') {
      menu.body.querySelector('.rr-back')?.click();
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      return scrollDetail(event.key === 'ArrowDown' ? 1 : -1);
    if (event.key === 'PageDown' || event.key === 'PageUp')
      return scrollDetail(event.key === 'PageDown' ? 1 : -1, true) || true;
    return false;
  };
  menu.onAction = (action, payload) => {
    if (view !== 'detail') return false;
    if (action === InputAction.CANCEL) {
      menu.body.querySelector('.rr-back')?.click();
      return true;
    }
    if (action === InputAction.NAVIGATE && payload?.dy) return scrollDetail(Math.sign(payload.dy));
    return false;
  };

  renderList();
  return menu;
}
