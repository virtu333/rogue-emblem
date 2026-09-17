import { getHPBarColor } from '../utils/uiStyles.js';

export function createHealthBar(unit) {
  const max = Math.max(1, Number(unit.stats?.HP) || 1);
  const current = Math.max(0, Math.min(max, Number(unit.currentHP) || 0));
  const ratio = current / max;
  const bar = document.createElement('span');
  bar.className = 're-health';
  bar.setAttribute('role', 'meter');
  bar.setAttribute('aria-label', `${unit.name} HP`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(max));
  bar.setAttribute('aria-valuenow', String(current));
  bar.setAttribute('aria-valuetext', `${current} of ${max} HP`);
  const fill = document.createElement('span');
  fill.className = 're-health-fill';
  fill.style.width = `${ratio * 100}%`;
  fill.style.backgroundColor = `#${getHPBarColor(ratio).toString(16).padStart(6, '0')}`;
  bar.append(fill);
  return bar;
}
