// Painted hero pictures (direction B, "PC-98 painted") for items shown large: the item
// detail panels of the shop, forge, rewards, convoy and unit details. One subject line
// per item id (catalog ids, tools/art/icons/lib/catalog.mjs). Scrolls, blessings and
// upgrades keep their pixel icon at 2x (the glyph on a scroll's seal is the point, and
// blessings have their own card paintings).

export const STYLE =
  'Single game item icon, 1990s Japanese PC-98 computer game art: hand-painted pixel art with a ' +
  'limited palette, clean dark ink outlines, flat cel shading with a little ordered-dither texture, ' +
  'warm low key light from the upper left, cool violet-blue shadows, muted dusk colours (ink violet, ' +
  'ember gold, crimson, verdigris green, steel blue, bone white). One object only, centred, fully ' +
  'visible, filling about 80% of the frame, no text, no letters, no runes, no border, no frame, no ' +
  'hands, no pedestal. Background: perfectly flat solid pure magenta (#FF00FF) with no shadow, ' +
  'gradient or floor.';

const DIAG = 'shown diagonally with the tip pointing to the upper right';
const BOOK = 'a closed book seen at a slight three-quarter angle, cover facing the viewer';
const STAFF = 'a magic staff shown diagonally with its head at the upper right';

export const HERO_SUBJECTS = {
  // Swords
  'iron-sword': `a plain iron arming sword, dull grey iron blade, simple iron crossguard, brown cord-wrapped grip, ${DIAG}`,
  'steel-sword': `a steel longsword with a cold blue-grey blade, steel crossguard and a dark cord grip, ${DIAG}`,
  rapier: `a slender steel rapier with a thin needle blade and a swept steel basket guard, ${DIAG}`,
  'silver-sword': `a bright silver longsword with a plain mirror-polished white-silver blade with no colour on it, silver crossguard, grip wrapped in grey cloth, ${DIAG}`,
  'killing-edge': `a silver sword with a crimson gem set in the crossguard and a thin red line along the edge, ${DIAG}`,
  'wo-dao': `a curved single-edged steel blade with a wavy temper line, small round guard and dark wrapped grip, ${DIAG}`,
  'wind-sword': `a short light steel throwing sword with a sky-blue wrapped grip, ${DIAG}`,
  'tempest-blade': `a short silver throwing sword with a sky-blue gem in the guard and a faint blue gleam along the edge, ${DIAG}`,
  lancereaver: `a steel sword with a notched, hooked back edge for catching lances, ${DIAG}`,
  'brave-sword': `a legendary broadsword with a gilded crossguard and an ember-gold glow along its fuller, ${DIAG}`,
  'levin-sword': `a silver sword with a crackling sky-blue lightning line along its fuller, ${DIAG}`,
  gemini: `a legendary sword with two slender parallel blades rising from one gilded hilt, ${DIAG}`,
  armorslayer: `a heavy steel sword with a broad thick blade and a green gem in the guard, ${DIAG}`,
  ragnarok: `a legendary great sword, bright silver blade with a glowing ember-gold core line, gilded guard, crimson grip, ${DIAG}`,
  soulreaver: `a legendary black-steel sword with a violet glow along its edge and a gilded hilt, ${DIAG}`,
  'venin-blade': `a silver sword whose blade is stained with dripping green poison, ${DIAG}`,
  'sunder-sword': `a blackened iron sword with jagged saw teeth along the blade and a faint violet glint, ${DIAG}`,
  'eldritch-grasp': `a legendary sword of black metal whose blade bends like folded space, violet-black light at its edge, ${DIAG}`,
  // Lances
  'iron-lance': `an iron-headed lance with a leaf-shaped point on a long ash-wood shaft, ${DIAG}`,
  'steel-lance': `a steel lance with a cold blue-grey leaf point on a dark wood shaft, ${DIAG}`,
  'silver-lance': `a silver lance with a bright polished point and a small crossbar on a dark wood shaft, ${DIAG}`,
  javelin: `a short iron throwing javelin with a narrow point and a leather grip, ${DIAG}`,
  swordreaver: `a steel lance with a barbed hooked head for catching swords, ${DIAG}`,
  'brave-lance': `a legendary lance with a broad gilded double-edged head and a crimson tassel, ${DIAG}`,
  doomblade: `a legendary lance with a long dark sword-like head, a gilded collar and a black shaft, ${DIAG}`,
  'gae-bolg': `a legendary crimson-and-gold spear with many hooked barbs along its head, ${DIAG}`,
  horseslayer: `a steel lance with a long hooked head and a green ribbon tied below it, ${DIAG}`,
  'killer-lance': `a barbed silver lance head on a dark wooden shaft with a crimson tassel, ${DIAG}`,
  'short-spear': `a short steel throwing spear, ${DIAG}`,
  spear: `a silver throwing spear with a long slim head, ${DIAG}`,
  'sunder-lance': `a blackened iron lance with a jagged serrated head and a faint violet glint, ${DIAG}`,
  // Axes
  'iron-axe': `a single-bit iron bearded axe with bark still on its wooden haft, ${DIAG}`,
  'steel-axe': `a heavy steel bearded axe with a cold blue-grey head on a dark wood haft, ${DIAG}`,
  'silver-axe': `a polished silver war axe with a broad crescent head and silver bands on a dark haft, ${DIAG}`,
  'short-axe': `a short steel throwing axe, ${DIAG}`,
  'killer-axe': `a silver axe with a thin, razor-ground edge and a crimson gem at the socket, ${DIAG}`,
  hammer: `a steel war hammer with a heavy square head and a spike on the back, ${DIAG}`,
  axereaver: `a steel double-bit axe with hooked horns on both heads, ${DIAG}`,
  'brave-axe': `a legendary double-bladed battle axe with gilded heads, ${DIAG}`,
  stormbreaker: `a legendary great axe with a gilded head, a storm-blue gem and wind curling around it, ${DIAG}`,
  ruin: `a legendary great axe of dark iron with gilded edges and an ember glow, ${DIAG}`,
  'hand-axe': `a small well-used iron hand axe with a nicked edge, ${DIAG}`,
  tomahawk: `a silver throwing hatchet with a short curved blade and a leather-wrapped handle, ${DIAG}`,
  'sunder-axe': `a blackened iron axe with a jagged saw-toothed edge and a faint violet glint, ${DIAG}`,
  // Bows
  'iron-bow':
    'a simple strung longbow of pale yew wood, shown diagonally across the frame with an arrow nocked',
  'steel-bow':
    'a dark wood bow with steel fittings at the grip and tips, strung, shown diagonally across the frame with an arrow nocked',
  'silver-bow':
    'an elegant strung bow with silver-inlaid limbs, shown diagonally across the frame with an arrow nocked',
  'killer-bow':
    'a silver bow with a crimson grip and a crimson-fletched arrow nocked, shown diagonally across the frame with an arrow nocked',
  longbow:
    'a very tall strung yew longbow with a leather grip, shown diagonally across the frame with an arrow nocked',
  'brave-bow':
    'a legendary gilded recurve bow with two arrows nocked together, shown diagonally across the frame with an arrow nocked',
  starfall:
    'a legendary gilded longbow with small star sparks along its string, shown diagonally across the frame with an arrow nocked',
  'venin-bow':
    'a blackened bow with a green poison-dripping arrow nocked, shown diagonally across the frame with an arrow nocked',
  'sunder-bow':
    'a blackened bow with a jagged broad-headed arrow nocked, faint violet glint, shown diagonally across the frame with an arrow nocked',
  shortbow:
    'a short compact strung bow of dark wood, shown diagonally across the frame with an arrow nocked',
  'recurve-bow':
    'a horn-and-sinew recurve bow with double-curved limbs and silver fittings, shown diagonally across the frame with an arrow nocked',
  doublebow:
    'a legendary double-curved gilded bow with an ember-gold string, shown diagonally across the frame with an arrow nocked',
  // Tomes
  fire: `${BOOK}: a red leather spellbook with a gold flame emblem and iron corners`,
  elfire: `${BOOK}: a red spellbook with a flame emblem, steel corners and ember light from its pages`,
  bolganone: `${BOOK}: a thick crimson spellbook with a large flame emblem, silver corners, smoke curling from it`,
  witchfire: `${BOOK}: a crimson spellbook with a pale blue flame emblem, silver corners`,
  excalibur: `${BOOK}: a green spellbook with a gold spiral wind emblem, gilded corners, wind swirling around it`,
  bolting: `${BOOK}: a sky-blue spellbook with a lightning-bolt emblem, gilded corners, sparks`,
  'twisting-vortex': `${BOOK}: a violet-black spellbook with a spiral void emblem, gilded corners`,
  lightning: `${BOOK}: a pale parchment-bound prayer book with a small gold four-pointed star`,
  shine: `${BOOK}: a white prayer book with a gold star emblem and steel corners, soft glow`,
  aura: `${BOOK}: a thick white prayer book with a radiant gold star and silver corners`,
  sunflare: `${BOOK}: a white prayer book with a crimson radiant sunburst emblem and hot light`,
  luce: `${BOOK}: a legendary white-and-gold prayer book with a radiant gold star, gilded corners, bright light`,
  // Staves
  heal: `${STAFF}: a wooden healing staff topped with a bronze ring holding a green gem`,
  mend: `${STAFF}: a dark wood healing staff with a steel ring holding a green gem`,
  physic: `${STAFF}: a long healing staff with a silver ring holding a green gem`,
  recover: `${STAFF}: a dark wood staff with a silver crook holding a large green gem`,
  restore: `${STAFF}: a staff with a silver crescent head holding a pearl-white gem`,
  fortify: `${STAFF}: a legendary gilded staff with a green gem ringed by a golden halo`,
  'sleep-staff': `${STAFF}: a black staff with a crescent-moon head and a violet gem`,
  'silence-staff': `${STAFF}: a plain black staff with a closed crescent head holding a dark violet gem, no rings`,
  'rescue-staff': `${STAFF}: a dark wood staff with small silver wings around a sky-blue gem`,
  'warp-staff': `${STAFF}: a legendary gilded staff with golden wings around a sky-blue gem`,
  // Consumables
  vulnerary: 'a small glass vial of green healing salve with a cork stopper',
  elixir: 'a round glass flask of glowing golden elixir with a gold cap',
  'master-seal': 'a crimson wax seal medallion stamped with a gold star, with grey ribbons',
  'energy-drop': 'a crimson teardrop-shaped gem glowing faintly from inside',
  'spirit-dust': 'a small violet cloth pouch spilling sparkling lilac dust',
  'secret-book': 'a small pale leather book with a gold clasp',
  speedwing: 'a single pale sky-blue feather',
  dracoshield: 'a small steel-blue dragon-scale shield with a diamond emblem',
  talisman: 'a silver leaf-shaped pendant with a lilac gem on a fine chain',
  'angelic-robe': 'a neatly folded green robe with gold trim',
  swiftsoles: 'a pair of light leather boots with small green wings at the ankles',
  'infantry-seal': 'a steel-blue wax seal stamped with a silver boot emblem, with ribbons',
  'mounted-seal': 'an earth-brown wax seal stamped with a silver horseshoe, with ribbons',
  herb: 'a sprig of fresh green medicinal herb',
  remedy:
    'a small round pewter tin of salve, the lid painted with a small red cross, grey metal all over',
  // Accessories
  'power-ring': 'a gold ring set with a round crimson gem',
  'magic-ring': 'a gold ring set with a round violet gem',
  'speed-ring': 'a gold ring set with a round sky-blue gem',
  'shield-ring': 'a plain polished gold ring set with a round steel-blue gem, a smooth plain band',
  'barrier-ring': 'a plain polished gold ring set with a round lilac gem, a smooth plain band',
  'skill-ring': 'a plain polished gold ring set with a round pearl-white gem, a smooth plain band',
  'goddess-icon': 'a small gold winged pendant with a rose-red gem',
  'seraph-robe': 'a folded white robe with green trim',
  boots: 'a pair of sturdy brown leather boots with green trim',
  'delphi-shield': 'a lilac round shield with a gilded rim and a pearl diamond emblem',
  'veterans-crest': 'a bronze shield-shaped medal with a gold star, hanging from a blue ribbon',
  'wrath-band': 'a blackened metal bracer band with a crimson inlay',
  'counter-seal':
    'a round silver medal engraved with two short crossed blades, hanging from a grey ribbon',
  'pursuit-ring': 'a silver ring set with a marquise-cut sky-blue gem',
  'nullify-ring': 'a silver ring set with a square dark slate stone',
  'life-ring': 'a gold ring set with a marquise-cut green gem',
  'forest-charm': 'a green leaf-shaped wooden charm with a small green gem, on a cord',
  'blood-gem': 'a faceted crimson gem in a gold setting',
  'vampires-bloodshard': 'a jagged crimson crystal shard',
  'soothing-stone': 'a smooth green teardrop-shaped stone',
  'phoenix-brooch': 'an ember-gold winged brooch with a crimson gem',
  'recoil-guard':
    'a small crimson kite shield with a silver rim and a round silver boss in the centre',
  'bounty-hunters-mark':
    'a bronze diamond-shaped medal with a crimson eye emblem on a crimson ribbon',
  'moontide-amulet': 'a silver crescent-moon amulet on a chain',
  'gamblers-coin':
    'a gold coin whose face is split between a golden sun and a violet crescent moon',
  'vanguard-crest':
    'a silver shield-shaped medal with a crimson spearhead emblem, hanging from a crimson ribbon',
  'diamond-medallion':
    'a silver diamond-shaped medal with a sky-blue diamond emblem, on a blue ribbon',
  'hunters-cloak': 'a hooded green cloak with a bronze clasp, folded',
  'duelists-glove': 'a crimson leather gauntlet with a gold cuff',
  'warding-charm': 'an oval silver charm with a lilac gem',
  'mentors-band': 'a gold arm band inlaid with pearl',
  'mercury-sandals': 'a pair of silver winged sandals with sky-blue straps',
  'phalanx-band': 'a steel arm band inlaid with sky-blue enamel',
  // Forge
  'silver-whetstone': 'a grey whetstone bar with a bright silver streak along its top',
  'might-whetstone': 'a grey whetstone bar with a crimson streak along its top',
  'crit-whetstone': 'a grey whetstone bar with an ember-gold streak along its top',
  'hit-whetstone': 'a grey whetstone bar with a pearl-white streak along its top',
  'weight-whetstone': 'a grey whetstone bar with a sky-blue streak along its top',
  'vampiric-imbuing-stone': 'a cluster of crimson crystals growing from a grey stone base',
  'sundering-imbuing-stone': 'a cluster of steel-blue crystals growing from a grey stone base',
  'keen-imbuing-stone': 'a cluster of ember-gold crystals growing from a grey stone base',
  'venomous-imbuing-stone': 'a cluster of green crystals growing from a grey stone base',
  'binding-imbuing-stone':
    'a cluster of dull olive-green and muddy brown crystals, like dark moss agate, growing from a grey stone base',
  'warded-imbuing-stone': 'a cluster of lilac crystals growing from a grey stone base',
  'prismatic-stone':
    'a cluster of crystals in six colours (crimson, blue, gold, green, brown, lilac) on a grey stone base',
  gold: 'a small heap of gold coins',
};

export function heroPrompt(id, take = 1) {
  const subject = HERO_SUBJECTS[id];
  if (!subject) return null;
  return `${STYLE}\nThe item: ${subject}.${take > 1 ? ` Alternative rendering ${take}.` : ''}`;
}
