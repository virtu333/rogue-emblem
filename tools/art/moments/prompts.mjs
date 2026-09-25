// Prompts for the generated "moments": blessing card paintings and service vignettes.
// Subjects are taken from each blessing's shrine lore (data/blessings.json) and each
// service's place. Pure data; tools/art/moments/generate.mjs sends them.

export const WORLD =
  '1990s Japanese PC-98 computer game illustration: painted pixel art with a limited palette, visible ' +
  'ordered dithering in gradients, clean dark ink linework, flat cel shading. A dusk-lit, melancholy ' +
  'fantasy world going dark; the only warm light is candle, forge and ember gold. Palette: deep ink ' +
  'violet-black, ember gold, crimson, verdigris green, cold steel blue, bone white. Low warm key light ' +
  'from the upper left, shadows lean violet. No text, no letters, no runes, no logo, no border, no ' +
  'frame, no UI, no skulls.';

// Cards are cropped to a square window (phone) or a tall window (desktop), so the
// subject sits in the centre with calm space around it. The study's Field Medic kept an
// inner panel (a doorway framing the figure): compositions avoid door and window frames
// around the subject and ask for a painting that runs to every edge.
export const CARD =
  `${WORLD} Tarot-like card painting, art only (the card frame is drawn later). One clear subject ` +
  'with a strong silhouette, centred in the middle of the image, with quiet dark space around it so ' +
  'the picture still reads when cropped to a square. Where sky shows, a black eclipse sun with a thin ' +
  'gold corona (the Hollow Sun). Full-bleed: the painting runs edge to edge on all four sides; no ' +
  'white margin, no inner panel, no picture-in-picture, no doorway or window framing the subject, no ' +
  'card border.';

export const SCENE =
  `${WORLD} Wide establishing vignette of a place, no people facing the viewer, the subject in the ` +
  'right half with darker, quieter space on the left for menu text, strong depth, one warm focal light.';

/** Blessing card subjects, by blessing id (all 23). */
export const CARDS = {
  steady_hands:
    "an archer's gloved hands drawing a bowstring, the arrow perfectly steady, over a still shrine pool that mirrors the eclipse sun",
  coin_of_fate:
    'a worn stone shrine altar with a small heap of offered coins in candlelight, one gold coin spinning in the air above an open pilgrim hand',
  blessed_vigor:
    "a pair of worn marching boots set neatly before a small roadside shrine, a green levy soldier's cloak folded beside them, one lit candle",
  swift_instinct:
    "a courier's pale blue feather drifting down past a shrine lantern while a hooded runner's silhouette sprints down the stone steps behind it",
  field_medic:
    "close-up of a hooded shrine sister's hands pressing a small clay jar of green salve into a soldier's open palm, votive candles glowing softly behind them",
  iron_oath:
    'an armoured gauntlet laid palm-down on a black anvil stone, sworn, warm ember light rising from below',
  scout_blessing:
    'a warden with a hooded lantern stepping out from between dark forest trees onto a shrine path, the eclipse sun above the treetops',
  scholar_vow:
    "a novice's desk in a candlelit shrine library: an open book, a quill, a tall stack of books, a single candle",
  rally_cry:
    'a crimson war banner planted at a shrine door, a curved war horn raised against the eclipse sky, sparks drifting',
  war_veteran:
    'a dented bronze helmet with an ember-red plume hung on a shrine wall beside a notched old sword, votive candles beneath',
  frugal_smith:
    "a smith's hammer stamping a maker's mark into a glowing blade on an anvil, a few coins stacked at the anvil's foot",
  arsenal_pact:
    'a gleaming silver sword laid across a stone shrine altar on a pale cloth, cold moonlit silver against the dark',
  pilgrim_coin:
    'a scallop-shell pilgrim token on a knotted cord, held above a roadside stall with coins and brass scales',
  merchant_bane:
    'a small cursed pouch of gold coins spilling across a shrine counter, the robed seller turned away into shadow',
  nomad_pact:
    'a lone banner on a travelling staff planted beside a roadside milestone, an open road winding away into dusk hills',
  terrain_mastery:
    'an old fort wall of mossy stone grown through with the roots of a sacred grove, a lantern and a mason trowel resting on the wall',
  quartermaster_cache:
    'a row of golden elixir flasks packed in straw on a tithe-barn shelf beside an open ledger, candlelight',
  forbidden_tome:
    'an ancient book bound in iron chains on a crypt shelf, faint violet light leaking from between its pages, dust',
  blood_forge:
    'a sword blade being quenched in a stone basin of dark red blood at a black forge, a hiss of steam and sparks',
  war_tutelage:
    'a war-college lectern with an open manual of sword forms, two practice blades crossed on the wall behind, one candle',
  armory_stash:
    'an open wooden crate of grey whetstones packed in straw in a shrine cellar, relic shelves above, a hanging lantern',
  scroll_archive:
    "a hidden stone niche stacked with rolled scrolls sealed in ember wax, a seer's hand drawing one out",
  focused_curriculum:
    'a wooden practice sword and a quill laid across a training-hall floor whose boards are worn smooth in one repeated footwork pattern, dawn light',
};

/** Service vignettes (six places). */
export const VIGNETTES = {
  forge:
    'a village forge at dusk: a heavy anvil with a glowing orange blade on it, sparks in the air, a hammer, bellows, racks of swords and axes on the wall, embers in the hearth',
  church:
    'a small stone chapel: rows of votive candles before a worn goddess statue whose face is chipped away, a round stained window showing a black eclipse sun with a thin gold corona',
  shop: 'a frontier village shop counter under a canvas awning at dusk: shelves of potion vials, a weapon rack, brass scales, a coin tray, a hanging lantern',
  arena:
    'a colosseum gate seen from the tunnel: an iron portcullis half raised, sand arena beyond under a dusk sky, torches in brackets, crimson banners',
  ruins:
    'overgrown shrine ruins at night, broken columns and a collapsed dome, a few lanterns and relic goods laid out on a cloth, violet mist',
  caravan:
    'a covered merchant caravan wagon stopped on a dusk road, lanterns hanging from the canopy, open crates of goods, a tethered horse in silhouette',
};

/** Prompt text for one moment; `take` > 1 asks for another composition of the same subject. */
export function momentPrompt(kind, subject, take = 1) {
  const head = kind === 'card' ? CARD : SCENE;
  const variant = take > 1 ? ` Alternative composition ${take}.` : '';
  return `${head}\nSubject: ${subject}.${variant}`;
}
