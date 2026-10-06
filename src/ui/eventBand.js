// The Event page's header band (docs/specs/event-art.md item 2): one painted scene per
// story Event (assets/ui/moments/events/<eventId>.png, the "moments" pipeline), shown
// across the top of the page. Art never gates play:
//   - the band is drawn at once as a plain ink strip, with the page under it;
//   - the painting loads lazily (an Image probe) and fades in when it is ready;
//   - a missing file (an event without a painting, a failed fetch, an old build) leaves
//     the plain strip, and nothing is retried or reported;
//   - Reduce motion (the game setting or the OS preference) shows the end state: no fade.
// Decoration only: aria-hidden, never focusable, never changes game state.
import { element } from './MenuSurface.js';
import { eventVignetteFocus, eventVignetteUrl, prefersStill } from './itemMoments.js';

// Per-session memory of what the browser has already answered, so a page that re-renders
// (a choice, a roster close) paints the band straight away instead of flashing the strip.
const loaded = new Set();
const missing = new Set();

/** Forget what the session has learned about event paintings (tests). */
export function resetEventBandCache() {
  loaded.clear();
  missing.clear();
}

function paint(band, url, focus) {
  band.style.setProperty('--ev-art', `url("${url}")`);
  if (focus) band.style.setProperty('--ev-focus', focus);
  band.classList.add('has-art');
}

/**
 * @param {string|null} eventId the event's id (eventView().eventId)
 * @param {object} [scene] the scene, for the Reduce motion setting
 * @returns {HTMLElement} the band (insert it at the top of the page body)
 */
export function createEventBand(eventId, scene = null) {
  const band = element('div', null, 'ev-band');
  band.setAttribute('aria-hidden', 'true');
  if (eventId) band.dataset.event = eventId;
  const url = eventId ? eventVignetteUrl(eventId) : null;
  const focus = eventId ? eventVignetteFocus(eventId) : null;
  if (!url || missing.has(eventId)) return band;
  if (loaded.has(eventId)) {
    band.classList.add('is-ready');
    paint(band, url, focus);
    return band;
  }
  if (prefersStill(scene)) band.classList.add('is-still');
  if (typeof Image === 'undefined') return band;
  const probe = new Image();
  probe.onload = () => {
    loaded.add(eventId);
    paint(band, url, focus);
  };
  probe.onerror = () => {
    missing.add(eventId);
  };
  probe.src = url;
  return band;
}
