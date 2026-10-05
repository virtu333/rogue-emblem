// Prologue-only presentation: reserve space for the modal lesson and show its
// actual forecast fields above it. No input or combat state changes here.
export function syncPrologueForecastLayout(modal, scene, active) {
  if (!modal) return;
  const note = active ? document.querySelector('.re-tutorial-note') : null;
  const lesson = scene._prologue?.activeLessonId;
  const enabled = Boolean(note && ['battle_forecast', 'battle_doubling'].includes(lesson));
  modal.classList.toggle('mb-tutorial-forecast', enabled);
  if (!enabled) {
    modal.style.removeProperty('--mb-tutorial-note-top');
    return;
  }
  modal.style.setProperty('--mb-tutorial-note-top', `${note.getBoundingClientRect().top}px`);
  const fields =
    lesson === 'battle_doubling'
      ? ['speed', 'damage']
      : lesson === 'battle_forecast'
        ? ['damage', 'hit']
        : [];
  for (const pair of modal.querySelectorAll('.mb-stats > div'))
    pair.classList.toggle('mb-tutorial-subject', fields.includes(pair.dataset.stat));
  const scroller = modal.querySelector('.mb-forecast-sides');
  const subject = modal.querySelector('.mb-tutorial-subject');
  if (scroller && subject) {
    const top = subject.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (top < 0 || top + subject.offsetHeight > scroller.clientHeight) scroller.scrollTop += top;
  }
}
