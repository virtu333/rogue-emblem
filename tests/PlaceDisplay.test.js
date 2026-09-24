import { it, expect } from 'vitest';
import { battlePlace, regionName } from '../src/ui/placeDisplay.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { loadGameData } from './testData.js';
it('gives every battlefield a concise place description and tolerates old configs', () => {
  const data = loadGameData();
  expect(validateMapTemplatesConfig(data.mapTemplates).valid).toBe(true);
  for (const template of Object.values(data.mapTemplates).flat()) {
    const place = battlePlace(data, { templateId: template.id }, 'act2');
    expect(place.title).toContain(template.name);
    expect(place.lore.length).toBeGreaterThan(10);
    expect(place.lore.length).toBeLessThanOrEqual(140);
  }
  expect(battlePlace({}, {}, 'unknown')).toEqual({ title: '', lore: '' });
  expect(regionName('act1')).toBe('Border Marches');
});
