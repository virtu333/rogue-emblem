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

// ── Event vignettes (docs/specs/event-art.md item 2): one wide header illustration per
// story Event in data/events.json, prompted from the event's intro. The Event page
// (src/ui/EventMenu.js) shows it as a band, so the scene is composed for a very wide crop:
// the subject sits right of centre, and the left third is quieter ink for the page's edge.
export const EVENT =
  `${WORLD} Ultra-wide cinematic header illustration of a roadside scene, one story moment, ` +
  'composed for a very wide short crop: the subject sits right of centre at a readable size, the ' +
  'left third is quieter and darker, a low horizon, strong depth, one warm focal light. Any ' +
  'people are small, anonymous figures seen from behind, from the side or in silhouette, never ' +
  'facing the viewer, never recognisable real people; signs, books and banners carry no writing ' +
  'at all. Full-bleed to every edge.';

/** Event vignette subjects, by event id (all ten in data/events.json). */
export const EVENTS = {
  old_swordmaster:
    'a woodyard at dusk: a very old woman with a white braid, seen from the side in a plain brown ' +
    'cloak, splitting a log on a chopping block with a wooden practice sword; neat stacks of split ' +
    'firewood, a small cottage with one lit window behind her, chips of wood in the air',
  abandoned_armory:
    'a garrison armoury left in a hurry, seen from the yard at dusk: the heavy door ajar, a pair of ' +
    'boots by the step, a cold iron pot on dead embers, racks of spears and swords visible inside, ' +
    'and deep in the dark a barred inner door with a thin line of violet light under it',
  twin_altar:
    'a standing stone with two faces carved back to back, one face turned to a gold sunrise glow, ' +
    'the other turned to deep violet shadow beneath a black eclipse sun with a thin gold corona; ' +
    'small offerings of candles, bread, ribbons and coins at the foot of both faces, many more ' +
    'before the dark face',
  wounded_courier:
    'an imperial courier in crimson lacquered armour slumped against a mossy stone milestone beside ' +
    'a road at dusk, an arrow through his thigh, one gloved fist tightly clutching a sealed letter ' +
    'with a red wax seal, his horse standing in silhouette behind; no gore',
  deserters_fire:
    'six imperial deserters sitting close around a campfire too small for them in a dusk clearing, ' +
    'crimson lacquered armour pieces dropped in the grass, hands open and empty, wary faces turned ' +
    'toward the dark road, long firelit shadows, nobody holding a weapon',
  the_echo:
    'a crossroads at dusk with a cairn of stacked stones, a battered soldier helmet resting on top, ' +
    'and beside it a faint translucent pale-violet ghostly figure of a young soldier seen from ' +
    'behind, half dissolved into mist, ghost light fading into the road',
  toll_bridge:
    'a rope bridge across a deep river gorge at dusk, a small timber toll hut at the near end with ' +
    'a hanging lantern, and a lone man in silhouette beside it holding a crossbow across his arm ' +
    'and an open ledger book, mist over the water',
  moneylender:
    'a gilded merchant cart on a dusk road with four armoured guards standing at its sides, an ' +
    'ornate chest open on the cart showing gold, a thin man in a long dark coat and very fine pale ' +
    'gloves seen in profile holding a ledger, lanterns on poles, a small cold smile in the lamplight',
  drill_yard:
    'an empty, abandoned military drill yard at dusk with nobody in it, no people at all: straw ' +
    'training dummies slumped on posts, a raked ' +
    'sand pit, a rack of blunted practice blades, a blank wooden signboard on two posts with no ' +
    'writing, a low barracks building with shuttered windows behind',
  quiet_road:
    'an empty country road winding between low hills at dusk, an old stone well with a wooden ' +
    'bucket beside the road, a few small birds perched on the rim of the well and on a hawthorn ' +
    'tree, peaceful and still, soft gold light low on the horizon',
};

/** Prompt text for one moment; `take` > 1 asks for another composition of the same subject. */
export function momentPrompt(kind, subject, take = 1) {
  const head = kind === 'card' ? CARD : kind === 'event' ? EVENT : SCENE;
  const variant = take > 1 ? ` Alternative composition ${take}.` : '';
  return `${head}\nSubject: ${subject}.${variant}`;
}
