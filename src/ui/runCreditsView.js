// runCreditsView — the grade and credits section of the run-end screen (DOM only).

import { element } from './MenuSurface.js';

// A row's helper tip: the label is a button that opens a note under its bar (a tap on a phone, a
// click or Enter with a keyboard), with the same words as a hover title on a desktop.
function helpToggle(bar) {
  const toggle = element('button', null, 're-credits-why');
  toggle.type = 'button';
  toggle.title = bar.help;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', `re-credits-tip-${bar.key}`);
  toggle.append(element('span', bar.label), element('span', '?', 're-credits-why-mark'));
  toggle.onclick = () => {
    const note = toggle.closest('li')?.querySelector('.re-credits-tip');
    if (!note) return;
    const open = note.hidden;
    note.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  return toggle;
}

function helpNote(bar) {
  const note = element('p', null, 're-credits-tip');
  note.id = `re-credits-tip-${bar.key}`;
  note.hidden = true;
  note.append(bar.help);
  if (bar.standing) note.append(element('b', `Your run: ${bar.standing}.`));
  return note;
}

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
      item.append(helpToggle(bar), element('small', `${bar.points} / ${bar.max}`));
      const track = element('i');
      track.style.setProperty('--re-fill', `${Math.round((bar.points / bar.max) * 100)}%`);
      item.append(track, helpNote(bar));
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
