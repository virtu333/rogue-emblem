// runCreditsView — the grade and credits section of the run-end screen (DOM only).

import { element } from './MenuSurface.js';

/** The section for `runCreditsModel`'s result, with the rung beside the letter. */
export function runCreditsSection({ grade, details }, difficultyLabel = '') {
  const section = element('section', null, 're-credits');
  section.setAttribute('aria-label', 'Run credits');
  if (grade) {
    const head = element('div', null, 're-credits-grade');
    const letter = element('b', grade.letter, `re-credits-letter is-${grade.letter}`);
    letter.setAttribute(
      'aria-label',
      `Grade ${grade.letter}, ${grade.score} of 100${difficultyLabel ? `, on ${difficultyLabel}` : ''}`,
    );
    head.append(
      letter,
      element('span', `${grade.score} / 100${difficultyLabel ? ` · on ${difficultyLabel}` : ''}`),
    );
    section.append(head);
    const bars = element('ul', null, 're-credits-bars');
    for (const bar of grade.bars) {
      const item = element('li');
      item.append(element('span', bar.label), element('small', `${bar.points} / ${bar.max}`));
      const track = element('i');
      track.style.setProperty('--re-fill', `${Math.round((bar.points / bar.max) * 100)}%`);
      item.append(track);
      bars.append(item);
    }
    section.append(bars);
  }
  if (details.length) {
    const list = element('dl', null, 're-credits-details');
    for (const row of details) list.append(element('dt', row.label), element('dd', row.value));
    section.append(list);
  }
  return section;
}
