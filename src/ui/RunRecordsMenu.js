import { MenuSurface, element, button } from './MenuSurface.js';
import { MAX_SLOTS, getMetaKey } from '../engine/SlotManager.js';
import { mergeRunRecords } from '../engine/RunRecords.js';
import { titledName } from '../engine/DeedTitles.js';
import { shadowSummary } from './eclipseContent.js';

export function showRunRecords(scene) {
  if (scene.nativeMenu) return scene.nativeMenu;
  const rows = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    try {
      const saved = JSON.parse(localStorage.getItem(getMetaKey(slot)) || '{}');
      for (const record of mergeRunRecords(saved.runRecords || [])) rows.push({ ...record, slot });
    } catch {
      /* A corrupt slot must not hide the other archives. */
    }
  }
  rows.sort((a, b) => b.endedAt - a.endedAt);
  const menu = new MenuSurface(scene, 'Victory records', () => {
    menu.destroy();
    scene.nativeMenu = null;
  });
  scene.nativeMenu = menu;
  menu.root.classList.add('re-run-flow');
  const list = () => {
    menu.body.replaceChildren(
      element(
        'p',
        'Victories recorded from this update onward. Each save slot keeps its latest 50 wins.',
      ),
    );
    if (!rows.length)
      menu.body.append(
        element(
          'p',
          'No victories recorded yet. Complete a run to preserve your final roster here.',
        ),
      );
    for (const record of rows)
      menu.body.append(
        button(
          `${new Date(record.endedAt).toLocaleDateString()} · ${record.difficulty} · Slot ${record.slot} · ${record.roster
            .filter((u) => u.isLord)
            .map((u) => u.name)
            .join(' & ')}`,
          () => detail(record),
        ),
      );
    menu.focusContent();
  };
  const detail = (record) => {
    menu.body.replaceChildren(
      button('Back to victories', list),
      element(
        'p',
        `${record.difficulty} · ${record.actsCleared} acts cleared${record.totalTurns == null ? '' : ` · ${record.totalTurns} turns`}${record.shadow == null ? '' : ` · ${shadowSummary(record.shadow, scene.gameData?.eclipse)}`} · Seed ${record.seed ?? 'unknown'}`,
      ),
    );
    for (const unit of record.roster) {
      const title = unit.epithet
        ? titledName(unit.name, { text: unit.epithet, form: unit.epithetForm })
        : unit.name;
      menu.body.append(
        element(
          'p',
          `${title} · ${unit.className} · Lv ${unit.level}${unit.isLord ? ' · Lord' : ''}`,
        ),
      );
    }
    menu.focusContent();
  };
  list();
  return menu;
}
