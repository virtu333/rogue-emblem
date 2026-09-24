import { button } from './MenuSurface.js';

// Explicit controls make long reference/setup text reachable with every input device.
export function appendDetailScrollControls(parent, detail) {
  for (const [direction, label] of [
    [-1, 'Details ↑'],
    [1, 'Details ↓'],
  ]) {
    const control = button(label, () => {
      detail.scrollTop += direction * Math.max(48, detail.clientHeight * 0.75);
    });
    control.setAttribute('aria-label', `Scroll details ${direction < 0 ? 'up' : 'down'}`);
    control.dataset.focus = direction < 0 ? 'detail-up' : 'detail-down';
    parent.append(control);
  }
}
