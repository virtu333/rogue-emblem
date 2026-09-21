import { MenuSurface, element, button } from './MenuSurface.js';
import { XP_STAT_NAMES } from '../utils/constants.js';

// Display only: gains are already applied by the caller. Never award XP here.
export function progressionResult(scene, unit, result, promotion, skills, growths, close) {
  const surface = new MenuSurface(scene, promotion ? 'Promotion' : 'Level up', close, {
    modal: true,
  });
  surface.root.classList.add('re-progression');
  surface.header.querySelector('button').textContent = 'Continue';
  const level = result.isExtended ? `20+${result.extendedLevel}` : result.newLevel;
  const heading = element('h3', `${unit.name} · ${unit.className} · Lv ${level}`);
  const table = element('dl', null, 're-gain-grid');
  for (const stat of XP_STAT_NAMES) {
    const gain = result.gains?.[stat] || 0;
    table.append(
      element('dt', stat),
      element('dd', `${unit.stats[stat]}${gain ? ` (+${gain})` : ''}`, gain ? 're-gain' : ''),
    );
  }
  surface.body.append(heading, table);
  if (growths && Object.keys(growths).length) {
    surface.body.append(element('h3', 'Growth bonuses'));
    for (const [stat, bonus] of Object.entries(growths))
      surface.body.append(element('p', `${stat} ${bonus >= 0 ? '+' : ''}${bonus}%`));
  }
  if (skills.length) {
    surface.body.append(element('h3', 'Learned skills'));
    for (const name of skills) surface.body.append(element('p', name));
  }
  surface.body.append(button('Continue', close, 're-btn re-btn--primary'));
  surface.focusContent();
  return surface;
}

export function promotionMenu(panel) {
  const surface = new MenuSurface(panel.scene, 'Choose promotion', () => panel._finish(null));
  surface.header.querySelector('button').textContent = 'Cancel';
  surface.root.classList.add('re-progression');
  surface.body.append(element('h3', `${panel.unit.name} · ${panel.unit.className}`));
  const columns = element('div', null, 're-promotion-options');
  let selected = panel.targets[0] || null;
  const confirm = button(
    'Confirm promotion',
    () => {
      if (selected) panel._finish(selected);
    },
    're-btn re-btn--primary',
  );
  confirm.disabled = !selected;
  const rows = [];
  for (const cls of panel.targets) {
    const card = element('section', null, 're-card');
    // Use the existing comparison builder so class bonuses, growths, skills and
    // proficiencies retain the same rules and coverage as the canvas chooser.
    for (const line of panel._buildColumnData(cls).lines) {
      if (line.text.trim()) card.append(element(line.bold ? 'h3' : 'p', line.text));
    }
    const select = button(`Select ${cls.name}`, () => {
      selected = cls;
      for (const row of rows) row.button.setAttribute('aria-pressed', String(row.cls === cls));
    });
    select.setAttribute('aria-pressed', String(cls === selected));
    rows.push({ cls, button: select });
    card.append(select);
    columns.append(card);
  }
  surface.body.append(columns, confirm);
  if (!selected) surface.body.prepend(element('p', 'No available promotion classes.'));
  surface.focusContent();
  return surface;
}
