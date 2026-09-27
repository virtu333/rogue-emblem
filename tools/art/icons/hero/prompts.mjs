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
  'keen-sword': `a katana-like sword made for killing strokes: a long, gently curved, single-edged mirror-silver blade with a wavy crimson temper line along the cutting edge, a small round black-iron disc guard, a long two-handed grip wrapped in black cord over crimson diamonds, a short blood-red tassel at the pommel, ${DIAG}`,
  jian: `a Chinese jian: a perfectly straight, slim, double-edged steel sword with a raised central ridge running to a fine point, a small bronze guard with gently upturned wings, a grip wrapped in dark cord, a round bronze pommel with a long crimson silk tassel hanging from it, ${DIAG}`,
  'gust-blade': `a steel short sword just swung, its plain straight steel blade trailing a pale sky-blue crescent gust of wind that curls off the edge and away toward the upper right, a plain steel crossguard, a grip wrapped in sky-blue cloth, ${DIAG}`,
  'gale-blade': `a short silver throwing sword whose blade sweeps in a curve like a gust of wind frozen in steel, pale sky-blue wind streaks spiralling around the blade, a sky-blue gem in a swept guard, a pale blue ribbon streaming from the pommel as if in a gale, ${DIAG}`,
  lancehook: `a steel sword made to catch lances: a plain straight double-edged blade, and one arm of its crossguard curving up alongside the blade into a long steel hook that could trap a lance shaft, the other arm short and straight, a dark leather grip, ${DIAG}`,
  oathblade: `a legendary broadsword with a gilded crossguard and an ember-gold glow along its fuller, ${DIAG}`,
  thunderbrand: `a silver magic sword whose blade is forged in the zig-zag shape of a lightning bolt, jagged stepped edges ending in a sharp point, crackling sky-blue electric arcs leaping from it, a storm-grey crossguard with a glowing sky-blue gem, ${DIAG}`,
  twinsworn: `a legendary sword with two slender parallel blades rising from one gilded hilt, ${DIAG}`,
  mailbane: `a deadly curved steel blade like a slim falchion, its back thick and ridged for strength, the curved edge razor-honed and narrowing to a hardened needle point made to slip between armour plates, a small steel crossguard, a grip wrapped in dark leather, a green gem pommel, ${DIAG}`,
  ragnarok: `a legendary Norse Viking sword: a broad pattern-welded blade with dark wavy damascus patterning and a wide fuller glowing ember-gold, a short thick straight guard and a heavy five-lobed gilt-bronze pommel both carved with interlaced knotwork, a grip bound in crimson leather and gold wire, ${DIAG}`,
  namethief: `a legendary black-steel sword with a violet glow along its edge and a gilded hilt, ${DIAG}`,
  'adder-blade': `a silver sword whose blade is stained with dripping green poison, ${DIAG}`,
  'sunder-sword': `a blackened iron sword with jagged saw teeth along the blade and a faint violet glint, ${DIAG}`,
  'eldritch-grasp': `a legendary sword of black metal whose blade bends like folded space, violet-black light at its edge, ${DIAG}`,
  // Lances
  'iron-lance': `an iron-headed lance with a leaf-shaped point on a long ash-wood shaft, ${DIAG}`,
  'steel-lance': `a steel lance with a cold blue-grey leaf point on a dark wood shaft, ${DIAG}`,
  'silver-lance': `a silver lance with a bright polished point and a small crossbar on a dark wood shaft, ${DIAG}`,
  javelin: `a short iron throwing javelin with a narrow point and a leather grip, ${DIAG}`,
  axehook: `a steel lance made to catch axes: a leaf-shaped point on a long dark wood shaft, and just below the point a curved steel bill hook sweeping out to one side and curling back toward the shaft, made to hook an axe by its beard and pull, ${DIAG}`,
  oathlance: `a legendary lance with a broad gilded double-edged head and a crimson tassel, ${DIAG}`,
  doomblade: `a legendary lance with a long dark sword-like head, a gilded collar and a black shaft, ${DIAG}`,
  'gae-bolg': `a legendary crimson-and-gold spear with many hooked barbs along its head, ${DIAG}`,
  horsebane: `a steel lance with a long hooked head and a green ribbon tied below it, ${DIAG}`,
  'keen-lance': `a barbed silver lance head on a dark wooden shaft with a crimson tassel, ${DIAG}`,
  'short-spear': `a light steel throwing spear made to be hurled: a slim barbless leaf-shaped head, a short thin ash shaft about an arm long, a leather throwing loop tied at its balance point, and three small grey feathers bound near the butt, ${DIAG}`,
  spear: `a silver throwing spear with a long slim head, ${DIAG}`,
  'sunder-lance': `a blackened iron lance with a jagged serrated head and a faint violet glint, ${DIAG}`,
  // Axes
  'iron-axe': `a single-bit iron bearded axe with bark still on its wooden haft, ${DIAG}`,
  'steel-axe': `a heavy steel bearded axe with a cold blue-grey head on a dark wood haft, ${DIAG}`,
  'silver-axe': `a polished silver war axe with a broad crescent head and silver bands on a dark haft, ${DIAG}`,
  hatchet: `a short steel throwing axe, ${DIAG}`,
  'keen-axe': `a silver axe with a thin, razor-ground edge and a crimson gem at the socket, ${DIAG}`,
  hammer: `a steel war hammer with a heavy square head and a spike on the back, ${DIAG}`,
  bladehook: `an unorthodox nimble steel axe made for fighting swordsmen: a light slender haft, a small crescent blade with a long curved hook-beard sweeping down to catch and wrench away sword blades, a short parrying spike on the back, a steel-blue finish, ${DIAG}`,
  oathaxe: `a legendary double-bladed battle axe with gilded heads, ${DIAG}`,
  tidebreaker: `a legendary mountain-clan great axe: a broad crescent head of dark blue-grey steel whose back is forged into a curling breaking wave, gilt bands where the head meets a long dark haft bound in deep-blue leather, an ember-gold glow along the cutting edge, ${DIAG}`,
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
  'keen-bow':
    'a silver bow with a crimson grip and a crimson-fletched arrow nocked, shown diagonally across the frame with an arrow nocked',
  longbow:
    'a very tall strung yew longbow with a leather grip, shown diagonally across the frame with an arrow nocked',
  oathbow:
    'a legendary gilded recurve bow with two arrows nocked together, shown diagonally across the frame with an arrow nocked',
  starfall:
    'a legendary gilded longbow with small star sparks along its string, shown diagonally across the frame with an arrow nocked',
  'adder-bow':
    'a blackened bow with a green poison-dripping arrow nocked, shown diagonally across the frame with an arrow nocked',
  'sunder-bow':
    'a blackened bow with a jagged broad-headed arrow nocked, faint violet glint, shown diagonally across the frame with an arrow nocked',
  shortbow:
    'a short compact strung bow of dark wood, shown diagonally across the frame with an arrow nocked',
  'recurve-bow':
    'a horn-and-sinew recurve bow with double-curved limbs and silver fittings, shown diagonally across the frame with an arrow nocked',
  'hermits-bow':
    'a legendary double-curved gilded bow with an ember-gold string, shown diagonally across the frame with an arrow nocked',
  // Tomes
  fire: `${BOOK}: a red leather spellbook with a gold flame emblem and iron corners`,
  wildfire: `${BOOK}: a red spellbook with a flame emblem, steel corners and ember light from its pages`,
  conflagration: `${BOOK}: a thick crimson spellbook with a large flame emblem, silver corners, smoke curling from it`,
  witchfire: `${BOOK}: a crimson spellbook with a pale blue flame emblem, silver corners`,
  firstwind: `${BOOK}: a green spellbook with a gold spiral wind emblem, gilded corners, wind swirling around it`,
  breachbolt: `${BOOK}: a sky-blue spellbook with a lightning-bolt emblem, gilded corners, sparks`,
  'twisting-vortex': `${BOOK}: a violet-black spellbook with a spiral void emblem, gilded corners`,
  glimmer: `${BOOK}: a pale parchment-bound prayer book with a small gold four-pointed star`,
  brilliance: `${BOOK}: a white prayer book with a gold star emblem and steel corners, soft glow`,
  crownlight: `${BOOK}: a thick white prayer book with a radiant gold star and silver corners`,
  sunflare: `${BOOK}: a white prayer book with a crimson radiant sunburst emblem and hot light`,
  endword: `${BOOK}: a legendary white-and-gold prayer book with a radiant gold star, gilded corners, bright light`,
  // Staves
  heal: `${STAFF}: a wooden healing staff topped with a bronze ring holding a green gem`,
  solace: `${STAFF}: a dark wood healing staff with a steel ring holding a green gem`,
  farcall: `${STAFF}: a long healing staff with a silver ring holding a green gem`,
  remembrance: `${STAFF}: a dark wood staff with a silver crook holding a large green gem`,
  cleanse: `${STAFF}: a staff with a silver crescent head holding a pearl-white gem`,
  canticle: `${STAFF}: a legendary gilded staff with a green gem ringed by a golden halo`,
  'lullaby-staff': `${STAFF}: a black staff with a crescent-moon head and a violet gem`,
  'hush-staff': `${STAFF}: a plain black staff with a closed crescent head holding a dark violet gem, no rings`,
  'deliverance-staff': `${STAFF}: a dark wood staff with small silver wings around a sky-blue gem`,
  'fold-staff': `${STAFF}: a legendary gilded staff with golden wings around a sky-blue gem`,
  // Consumables
  poultice: 'a field poultice: a folded pad of pale linen bandage soaked green with crushed healing herbs, a few fresh green leaves tucked in its folds, tied with a short length of brown twine',
  elixir: 'a round glass flask of glowing golden elixir with a gold cap',
  'sovereign-seal': 'a royal wax seal: a thick round medallion of deep crimson wax stamped with a gold crown, a thin gilded rim, two long regal ribbons of purple and gold trailing from it',
  mightroot: 'a single gnarled knobbly root, thick as a thumb, dark earthy brown bark split to show pale ember-orange flesh inside, a few fine rootlets at its tip, a faint warm ember glow from the split',
  'spellstone-dust': 'a small violet cloth pouch spilling sparkling lilac dust',
  'drill-primer': 'a small pale leather book with a gold clasp',
  'fleet-plume': 'a single pale sky-blue feather',
  wyrmscale: 'one single large dragon scale, shaped like a broad rounded shield, glossy steel-blue with an iridescent green sheen, a raised central ridge and fine growth lines, its rough base edge still ragged where it was torn free',
  'warding-cord': 'a short protective cord of braided red and white thread, tied in three tight decorative knots along its length, a small lilac glass bead threaded on the middle knot, loose frayed tassels at both ends',
  'blessed-vestment':
    'a neatly folded white-and-gold vestment of luminous cloth, a pair of small white feathered wings stitched at its shoulders, gold feather embroidery and rows of tiny gold stitching along the hem, crisp dark outline, no glow or halo around it',
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
  'fatethread-pendant': 'a small worn gold sun-disc pendant with a hollow centre, its face rubbed smooth and blank by thumbs, hung on a fine crimson thread tied in a loop',
  'sisters-mantle':
    'a flowing white hooded mantle laid open, embroidered with three pairs of pale gold feathered wings rising up its back, a pale gold clasp, radiant soft light spilling from its folds',
  'couriers-boots': 'a pair of sturdy brown leather boots with green trim',
  'picket-buckler': 'a lilac round shield with a gilded rim and a pearl diamond emblem',
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
  'armorbane-imbuing-stone': 'a cluster of steel-blue crystals growing from a grey stone base',
  'cruel-imbuing-stone': 'a cluster of ember-gold crystals growing from a grey stone base',
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
