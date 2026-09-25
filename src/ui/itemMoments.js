// The moments around items (docs/art-direction/items/README.md): service vignettes
// behind the shop, forge, church, colosseum, ruins and caravan; blessing card paintings;
// the ember motes and candle flicker that animate them. Paintings are lazy CSS
// backgrounds (a layout shows either the phone pane or the desktop band, so exactly one
// vignette decodes), dithered at a native size and drawn at 1x or 2x.
//
// Motion is decoration only: it never changes game state, stops when the element leaves
// the DOM, and is off under the Reduce motion setting or the OS preference (the end
// state — the still painting — is what shows).
import manifest from './momentArtManifest.json';

export const MOMENT_MANIFEST = manifest;
export const SERVICE_VIGNETTES = Object.freeze(Object.keys(manifest.vignettes));

function base() {
  try {
    return import.meta.env?.BASE_URL ?? './';
  } catch {
    return './';
  }
}

function absolute(url) {
  try {
    return new URL(url, globalThis.document?.baseURI || globalThis.location?.href).href;
  } catch {
    return url;
  }
}

export function vignetteUrl(service) {
  const entry = manifest.vignettes[service];
  return entry
    ? absolute(`${base()}assets/ui/moments/vignettes/${service}.png?v=${entry.v}`)
    : null;
}

export function blessingCardUrl(blessingId) {
  const entry = manifest.cards[blessingId];
  return entry ? absolute(`${base()}assets/ui/moments/cards/${blessingId}.png?v=${entry.v}`) : null;
}

export function hasBlessingPainting(blessingId) {
  return Boolean(manifest.cards[blessingId]);
}

/** Reduce motion: the game setting or the OS preference. */
export function prefersStill(scene) {
  try {
    if (scene?.registry?.get?.('settings')?.getReduceMotion?.()) return true;
  } catch {
    /* settings unavailable: fall through to the OS preference */
  }
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/** Which vignette a service screen shows. Pure. */
export function serviceVignetteFor({
  caravan = false,
  ruins = false,
  tab = null,
  service = null,
} = {}) {
  if (service && manifest.vignettes[service]) return service;
  if (ruins) return 'ruins';
  if (caravan) return 'caravan';
  if (tab === 'forge') return 'forge';
  return 'shop';
}

/** The motion a vignette carries: forge sparks, church candles, or none. */
export function vignetteMotion(service) {
  if (service === 'forge') return 'sparks';
  if (service === 'church' || service === 'ruins') return 'candles';
  if (service === 'arena') return 'torches';
  return null;
}

const MOTES = 12;

/**
 * Attach a service vignette to a menu root: sets the --ia-vignette custom property (used
 * by the phone pane and the desktop band CSS) and returns the desktop header band.
 * @param {HTMLElement} root the menu surface root
 * @param {string} service one of SERVICE_VIGNETTES
 * @param {{title?:string, kicker?:string, still?:boolean}} [options]
 * @returns {HTMLElement} the band (insert it at the top of the menu body)
 */
export function applyServiceVignette(
  root,
  service,
  { title = '', kicker = '', still = false, backdrop = false } = {},
) {
  const url = vignetteUrl(service);
  root.classList.add('ia-has-vignette');
  root.dataset.vignette = service;
  root.classList.toggle('ia-still', still);
  if (url) root.style.setProperty('--ia-vignette', `url("${url}")`);
  // Phones: menus without a detail pane show the place behind the whole screen.
  if (backdrop) {
    root.classList.add('ia-has-backdrop');
    let back = root.querySelector(':scope > .ia-backdrop');
    if (!back) {
      back = document.createElement('div');
      back.className = 'ia-backdrop';
      back.setAttribute('aria-hidden', 'true');
      root.prepend(back);
    }
    back.replaceChildren();
    const motion = vignetteMotion(service);
    if (motion) back.append(motes(motion));
  }
  const band = document.createElement('div');
  band.className = 'ia-band';
  band.dataset.service = service;
  band.setAttribute('aria-hidden', 'true');
  const motion = vignetteMotion(service);
  if (motion) band.append(motes(motion));
  if (title || kicker) {
    const cap = document.createElement('div');
    cap.className = 'ia-band-caption';
    if (kicker) {
      const k = document.createElement('span');
      k.className = 'ia-band-kicker';
      k.textContent = kicker;
      cap.append(k);
    }
    if (title) {
      const t = document.createElement('span');
      t.className = 'ia-band-title';
      t.textContent = title;
      cap.append(t);
    }
    band.append(cap);
  }
  return band;
}

/**
 * A blessing card's painting (192x256, dithered): a lazily loaded CSS background the
 * card lays out behind its medallion and name. Returns null for a blessing without one
 * (the card keeps its Hollow Sun medallion alone).
 */
export function blessingCardArt(blessingId) {
  const url = blessingCardUrl(blessingId);
  if (!url) return null;
  const art = document.createElement('span');
  art.className = 'ia-card-art';
  art.dataset.blessing = blessingId;
  art.setAttribute('aria-hidden', 'true');
  art.style.setProperty('--ia-card', `url("${url}")`);
  return art;
}

const NUMERALS = ['', 'I', 'II', 'III', 'IV'];

/**
 * A blessing as a tarot card for a detail pane: the shrine painting in a tier frame
 * (tier IV adds a dotted ember inner frame) with the tier numeral on a Hollow Sun disc.
 * `turn` plays the card-turn once (the caller passes false under Reduce motion). Returns
 * null for a blessing without a painting.
 */
export function blessingTarot(blessing, { turn = false } = {}) {
  const url = blessing?.id ? blessingCardUrl(blessing.id) : null;
  if (!url) return null;
  const tier = Math.min(4, Math.max(1, Number(blessing.tier) || 1));
  const card = document.createElement('span');
  card.className = `ia-tarot${turn ? ' ia-tarot--turn' : ''}`;
  card.dataset.tier = String(tier);
  card.dataset.blessing = blessing.id;
  card.setAttribute('aria-hidden', 'true');
  const art = document.createElement('span');
  art.className = 'ia-tarot-art';
  art.style.setProperty('--ia-card', `url("${url}")`);
  const numeral = document.createElement('span');
  numeral.className = 'ia-tarot-numeral';
  numeral.textContent = NUMERALS[tier];
  card.append(art, numeral);
  return card;
}

/** A wax seal for a price: crimson with a cost, verdigris for a clean gift. */
export function costSeal(clean = false) {
  const seal = document.createElement('span');
  seal.className = `ia-seal${clean ? ' is-clean' : ''}`;
  seal.setAttribute('aria-hidden', 'true');
  return seal;
}

/** Motes for a phone pane behind which a vignette sits (null for a still place). */
export function vignetteMotes(service) {
  const motion = vignetteMotion(service);
  if (!motion) return null;
  const layer = motes(motion);
  layer.classList.add('ia-pane-motes');
  return layer;
}

/** A capped set of decorative motes (sparks rise, candles flicker, torches breathe). */
export function motes(kind) {
  const layer = document.createElement('span');
  layer.className = `ia-motes ia-motes--${kind}`;
  layer.setAttribute('aria-hidden', 'true');
  const count = kind === 'sparks' ? MOTES : kind === 'candles' ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const m = document.createElement('i');
    m.style.setProperty('--i', String(i));
    layer.append(m);
  }
  return layer;
}
