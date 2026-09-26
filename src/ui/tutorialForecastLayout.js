// Tutorial-only presentation: reserve space for the modal lesson and show its
// actual forecast fields above it. No input or combat state changes here.
export function syncTutorialForecastLayout(modal, scene, active) {
  if (!modal) return;
  const note = active ? document.querySelector('.re-tutorial-note') : null;
  const lesson = scene._tutorialController?.activeLessonId;
  const enabled = Boolean(
    note && ['battle_forecast', 'battle_triangle', 'battle_doubling'].includes(lesson),
  );
  modal.classList.toggle('mb-tutorial-forecast', enabled);
  if (!enabled) {
    modal.style.removeProperty('--mb-tutorial-note-top');
    return;
  }
  modal.style.setProperty('--mb-tutorial-note-top', `${note.getBoundingClientRect().top}px`);
  const fields =
    lesson === 'battle_doubling'
      ? ['Attack speed', 'Planned hits']
      : lesson === 'battle_forecast'
        ? ['Damage per hit', 'Hit chance']
        : [];
  for (const pair of modal.querySelectorAll('.mb-stats > div'))
    pair.classList.toggle(
      'mb-tutorial-subject',
      fields.includes(pair.querySelector('dt')?.textContent),
    );
  for (const notice of modal.querySelectorAll('.mb-notice'))
    notice.classList.toggle(
      'mb-tutorial-subject',
      lesson === 'battle_triangle' && notice.textContent.startsWith('Triangle '),
    );
  const scroller = modal.querySelector('.mb-forecast-sides');
  const subject = modal.querySelector('.mb-tutorial-subject');
  if (scroller && subject) {
    const top = subject.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (top < 0 || top + subject.offsetHeight > scroller.clientHeight) scroller.scrollTop += top;
  }
}
