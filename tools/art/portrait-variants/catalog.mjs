// Portrait variety catalogue (pure data): who the generic units are.
//
// Player side: each base class line (base class + its promotions) has five
// people ("identities"). An identity is drawn once per class of its line, so
// a unit keeps its face when it promotes: fighter_d is the same man as a
// Fighter, a Warrior and a Berserker. Cross promotions (Pegasus Knight ->
// Wyvern Lord, Wyvern Rider -> Falcon Knight) are just more classes of the
// line. `anchor` pins a class render to an existing portrait id: `keep` uses
// the approved art as is (the four rebuilt generics); `remaster` redraws the
// legacy 128 px portrait's design at the rebuilt quality; everything else is
// a new drawing. Base ids (`generic_<class>`) stay the class default face.
//
// Enemy side: enemies never promote, so each enemy class has four faces in
// the Empire's iron and crimson; face a remasters the legacy enemy portrait.
//
// Genders follow the recruit name pools (data/recruits.json): a Fighter is
// always named like a man, so all five Fighter-line people are men, while
// mixed pools get mixed lines. `names` lets the runtime match a named
// unit to a face of the same gender (unlisted names match any face).

export const PLAYER_CLASSES = Object.freeze({
  Fighter:
    'a rough dark-brown wool tunic, a brown leather harness with iron rivets across the chest, one dented steel pauldron on the far shoulder, the wooden haft of a hand axe over the shoulder',
  Warrior:
    'a heavy wolf-pelt mantle over both shoulders, dark iron and brown leather plates with bronze rivets, thick leather bracers on bare muscular arms, the haft of a great axe behind the shoulder',
  Berserker:
    'a bare, heavily muscled chest crossed by a single leather strap, a shaggy fur collar, an iron armband, faint ochre war-paint streaks on the shoulders, the head of a heavy two-handed axe behind the shoulder',
  Myrmidon:
    'a light swordsman outfit: a layered crimson and off-white wrap tunic with a wide cloth sash, the hilt of a slim curved sword at the shoulder',
  Swordmaster:
    'a dark indigo long coat with a high collar over cloth wraps, a pale grey scarf, the long hilt of a katana over the shoulder',
  Duelist:
    'a fitted steel-blue fencing doublet with silver buttons and a short dark cape over one shoulder, leather gloves, the swept hilt of a rapier at the shoulder',
  Knight:
    'full polished steel plate armour with a high gorget and rounded pauldrons, a dark blue gambeson collar showing, no helmet so the face and hair are visible',
  General:
    'massive heavy plate armour in dark blue-steel with huge rounded pauldrons, a tall gorget and gold rivets, no helmet so the face and hair are visible',
  'Great Knight':
    'heavy blue-steel plate armour with an embossed breastplate crest and a dark riding cloak on the shoulders, no helmet so the face and hair are visible',
  Cavalier:
    'a polished steel breastplate and pauldrons over a dark red gambeson, leather straps, the tip of a lance behind the shoulder',
  Paladin:
    'ornate steel plate with a royal blue tabard bearing a small white emblem and a long white cape on the shoulders',
  'Dark Knight':
    'blackened steel armour with deep plum cloth, a dark hooded cape pushed back off the head, no glow and no spikes',
  Archer:
    'a green hooded cloak with the hood down, a brown leather jerkin and bracers, a quiver of fletched arrows over the shoulder',
  Sniper:
    'a deep green hood up over the head, a brown leather harness with iron buckles, a quiver of arrows over the shoulder',
  'Bow Knight':
    'a light steel cuirass over a forest-green riding tunic, a short riding cloak, a bow and quiver over the shoulder',
  Mage: 'a deep purple hooded mage robe with the hood down and a high collar, a leather-bound spellbook held at the chest',
  Sage: 'long layered brown and burgundy scholar robes with an embroidered stole, a gnarled wooden staff at the shoulder',
  Warlock:
    'a dark teal robe with a high cream-trimmed collar, a dark plum scarf and a matching wrapped head cloth with a small green gem',
  Cleric:
    'a cream-white hooded robe with the hood up, a simple wooden pendant on a cord, soft linen layers',
  Bishop:
    'ornate white vestments with gold trim, a tall stiff collar and a gold-embroidered stole, a small sunburst clasp',
  'Battle Monk':
    'a white sleeveless martial gi with a blue sash across the chest, bare strong arms, a ringed monk staff over the shoulder',
  Thief:
    'a dark brown hooded leather jerkin with the hood down, a grey scarf at the neck, a dagger on a chest strap',
  Assassin:
    'a black-violet cowl pulled down around the neck, a high dark scarf, fitted dark leathers with small buckles',
  Trickster:
    'a charcoal doublet with a muted teal and maroon patchwork half-cape, a silver brooch, a playing card tucked in the collar',
  Dancer:
    'flowing dancer attire: a wine-red silk wrap with gold trim leaving the shoulders bare, delicate gold earrings, a light translucent shawl',
  Bard: 'a travelling bard coat in wine-red and gold with a high collar, a small lute strapped over the shoulder',
  'Pegasus Knight':
    'a light silver breastplate over a pale blue tunic, a short white cape, a slender lance behind the shoulder',
  'Falcon Knight':
    'polished silver armour with pale blue cloth, feather-shaped engraving on the pauldrons and a long white cape',
  'Wyvern Rider':
    'dark gunmetal scale armour, a crimson scarf wound around the neck, heavy leather riding gloves',
  'Wyvern Lord':
    'heavy dark gunmetal plate armour with gold trim and scale-textured pauldrons, a crimson half-cape',
  Mercenary:
    'bronze-brown leather armour with a steel collar and shoulder guard over a plain linen shirt',
  Hero: 'burnished bronze and steel half-plate over a brown leather coat, the hilt of a broadsword over the shoulder',
  Hunter:
    'a rugged green-brown hunter cloak with a fur collar, leather straps, a longbow and quiver over the shoulder',
});

// Outfits drawn differently for women (the Berserker's bare chest).
export const PLAYER_CLASSES_F = Object.freeze({
  Berserker:
    'a sleeveless fur-trimmed leather chest wrap, a shaggy fur collar, an iron armband, faint ochre war-paint streaks on the bare shoulders and arms, the head of a heavy two-handed axe behind the shoulder',
});

// Five people per line. g = gender (m/f), look = face (age, skin, hair,
// features, expression). anchor: { <Class>: { id, mode: keep|remaster } }.
// sprite = the same person on the map (tools/art/sprite-trace bakes one sprite
// per class x person): skin and hair ramps (tools/art/sprite-trace/lib/ramps.mjs),
// picked against the drawn portraits, and `bald` (the crown shows skin; what hair
// the design has below the brow keeps the hair ramp: grey sides, a beard). A
// person's sprite design (A/B) follows `g` (roster.mjs DESIGN_GENDER).
// tests/TracedPersonSprites.test.js holds `sprite` to `look` and `g`.
export const LINES = Object.freeze({
  fighter: {
    classes: ['Fighter', 'Warrior', 'Berserker'],
    people: {
      fighter_a: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairGrey', bald: true },
        look: 'a man in his late fifties, weathered light-tan skin, bald crown with grey hair at the sides, a full grey beard, heavy brows, stern',
        anchor: { Fighter: { id: 'generic_fighter', mode: 'keep' } },
      },
      fighter_b: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairDarkBrown' },
        look: 'a rugged man in his thirties, fair skin, shoulder-length dark brown hair, heavy stubble, a hard squint',
        anchor: { Warrior: { id: 'generic_warrior', mode: 'remaster' } },
      },
      fighter_c: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairCopper' },
        look: 'a big man in his forties, ruddy skin, a wild mane of auburn hair and a thick auburn beard, a scar across the nose, a fierce scowl',
        anchor: { Berserker: { id: 'generic_berserker', mode: 'remaster' } },
      },
      fighter_d: {
        g: 'f',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a strong young woman of about twenty, deep brown skin, black hair in two short puffs, small gold earrings, a broad confident grin',
      },
      fighter_e: {
        g: 'f',
        sprite: { skin: 'skinWarm', hair: 'hairBlack' },
        look: 'a broad-shouldered East Asian woman in her thirties, long black hair tied in a low tail, a thin old scar across the bridge of the nose, calm narrow eyes',
      },
    },
  },
  myrmidon: {
    classes: ['Myrmidon', 'Swordmaster', 'Duelist'],
    people: {
      myrmidon_a: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairBlack' },
        look: 'a young woman, pale skin, very long straight black hair with a thin red ribbon, dark red eyes, cool focused expression',
        anchor: { Myrmidon: { id: 'generic_myrmidon', mode: 'remaster' } },
      },
      myrmidon_b: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairBlueBlack' },
        look: 'a young man, pale skin, long blue-black hair tied high, a sharp jaw, a faint scar under one eye, quiet and severe',
        anchor: { Swordmaster: { id: 'generic_swordmaster', mode: 'remaster' } },
      },
      myrmidon_c: {
        g: 'm',
        sprite: { skin: 'skinTan', hair: 'hairSandy' },
        look: 'a lanky young man, tan skin, messy sandy-brown hair, a small plaster on one cheek, a cocky smirk',
      },
      myrmidon_d: {
        g: 'f',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a woman in her late twenties, deep brown skin, black hair in tight cornrow braids, calm watchful eyes',
      },
      myrmidon_e: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairSilver' },
        look: 'an old swordsman in his sixties, fair skin, long white hair tied back and a short white beard, serene half-closed eyes',
      },
    },
  },
  knight: {
    classes: ['Knight', 'General', 'Great Knight'],
    people: {
      knight_a: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairGrey' },
        look: 'a veteran in his fifties, fair lined skin, short slicked-back grey hair, grey stubble, a tired stern look',
        anchor: { Knight: { id: 'generic_knight', mode: 'remaster' } },
      },
      knight_b: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'skinWarm', bald: true },
        look: 'a broad man in his forties, light-tan skin, shaved head, a heavy brow and a flattened nose, grim',
        anchor: { General: { id: 'generic_general', mode: 'remaster' } },
      },
      knight_c: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairCopper' },
        look: 'a sturdy woman in her thirties, fair freckled skin, copper hair in a short thick braid, a determined set jaw',
      },
      knight_d: {
        g: 'f',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a woman in her forties, deep brown skin, short natural black hair, a scar through one eyebrow, stoic',
      },
      knight_e: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairBlack' },
        look: 'an earnest young East Asian man, short neat black hair, a round face, a small determined frown',
      },
    },
  },
  cavalier: {
    classes: ['Cavalier', 'Paladin', 'Dark Knight'],
    people: {
      cavalier_a: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairDarkBrown' },
        look: 'a young man in his twenties, fair skin, short dark brown hair, a square jaw, composed',
        anchor: { Cavalier: { id: 'generic_cavalier', mode: 'remaster' } },
      },
      cavalier_b: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairBrown' },
        look: 'a man in his forties, light skin, shoulder-length brown hair, a neat moustache and goatee, dignified',
        anchor: { Paladin: { id: 'generic_paladin', mode: 'remaster' } },
      },
      cavalier_c: {
        g: 'f',
        sprite: { skin: 'skinOlive', hair: 'hairDarkBrown' },
        look: 'a young woman, olive skin, dark brown hair in a high ponytail, bright confident smile',
      },
      cavalier_d: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairGreyAuburn' },
        look: 'a woman in her forties, pale skin, greying auburn hair cut at the jaw, a thin scar on the chin, composed',
      },
      cavalier_e: {
        g: 'm',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a man in his thirties, deep brown skin, short twisted locks, a neatly trimmed beard, serious',
      },
    },
  },
  archer: {
    classes: ['Archer', 'Sniper', 'Bow Knight'],
    people: {
      archer_a: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairBlond' },
        look: 'a young man, fair skin, sandy blond hair with a thin braid and a cloth headband, gentle eyes',
        anchor: { Archer: { id: 'generic_archer', mode: 'remaster' } },
      },
      archer_b: {
        g: 'm',
        sprite: { skin: 'skinTan', hair: 'hairGrey' },
        look: 'a man in his fifties, tan skin, grey hair, a thick grey moustache, a hard squint',
        anchor: { Sniper: { id: 'generic_sniper', mode: 'keep' } },
      },
      archer_c: {
        g: 'f',
        sprite: { skin: 'skinTan', hair: 'hairBlack' },
        look: 'a young woman, brown skin, black hair in two long braids, freckles across the nose, keen eyes',
      },
      archer_d: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairAuburn' },
        look: 'a woman in her thirties, fair skin, auburn hair in a low bun, a notched ear and a faint scar on the cheek, wry smile',
      },
      archer_e: {
        g: 'f',
        sprite: { skin: 'skinTan', hair: 'hairGrey' },
        look: 'a woman in her fifties, tan skin, dark hair streaked with silver pulled back, crow feet, calm',
      },
    },
  },
  mage: {
    classes: ['Mage', 'Sage', 'Warlock'],
    people: {
      mage_a: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairPlum' },
        look: 'a young woman, pale skin, shaggy dark plum hair falling over one eye, round spectacles pushed up into the hair, bookish and wary',
        anchor: { Mage: { id: 'generic_mage', mode: 'remaster' } },
      },
      mage_b: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairSaltPepper' },
        look: 'a gaunt man in his fifties, light-tan skin, long dark hair going grey, a lined face and a short beard, knowing half smile',
        anchor: { Sage: { id: 'generic_sage', mode: 'remaster' } },
      },
      mage_c: {
        g: 'm',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a young man, dark brown skin, dark eyes, a serious sidelong look',
        anchor: { Warlock: { id: 'generic_warlock', mode: 'keep' } },
      },
      mage_d: {
        g: 'f',
        sprite: { skin: 'skinWarm', hair: 'hairBlack' },
        look: 'a young East Asian woman, straight black hair with blunt bangs, thin round spectacles, curious',
      },
      mage_e: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairSilver' },
        look: 'an elderly woman in her sixties, fair skin, white hair in a loose bun, sharp pale eyes, a faint smile',
      },
    },
  },
  cleric: {
    classes: ['Cleric', 'Bishop', 'Battle Monk'],
    people: {
      cleric_a: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairLightBrown' },
        look: 'a young woman, fair skin, light brown hair in two long braids, soft kind eyes, a small smile',
        anchor: { Cleric: { id: 'generic_cleric', mode: 'remaster' } },
      },
      cleric_b: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairSilver' },
        look: 'an elderly woman in her seventies, fair wrinkled skin, grey hair in a neat bun, warm smile',
        anchor: { Bishop: { id: 'generic_bishop', mode: 'remaster' } },
      },
      cleric_c: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairChestnut' },
        look: 'a young man, light-tan skin, spiky chestnut hair, an open determined look',
        anchor: { 'Battle Monk': { id: 'generic_battle_monk', mode: 'keep' } },
      },
      cleric_d: {
        g: 'm',
        sprite: { skin: 'skinDeep', hair: 'hairGrey', bald: true },
        look: 'a man in his forties, deep brown skin, shaved head, a short grey beard, kind patient eyes',
      },
      cleric_e: {
        g: 'f',
        sprite: { skin: 'skinTan', hair: 'hairDarkBrown' },
        look: 'a young woman, tan skin, dark wavy hair, freckles, gentle and shy',
      },
    },
  },
  thief: {
    classes: ['Thief', 'Assassin', 'Trickster'],
    people: {
      thief_a: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairBlack' },
        look: 'a young man, pale skin, messy black hair falling over one eye, a flat unreadable stare',
        anchor: { Assassin: { id: 'generic_assassin', mode: 'remaster' } },
      },
      thief_b: {
        g: 'm',
        sprite: { skin: 'skinOlive', hair: 'hairBlack' },
        look: 'a young man, olive skin, messy black curls, a small scar on the lip, a sly grin',
      },
      thief_c: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairCopper' },
        look: 'a young woman, fair freckled skin, short choppy copper hair, a mischievous smirk',
      },
      thief_d: {
        g: 'f',
        sprite: { skin: 'skinDeep', hair: 'hairChestnut' },
        look: 'a woman in her thirties, deep brown skin, hair wrapped in a dark head scarf, a cool level gaze',
      },
      thief_e: {
        g: 'm',
        sprite: { skin: 'skinTan', hair: 'hairGrey' },
        look: 'a wiry man in his forties, weathered tan skin, receding grey hair tied back, stubble, a crooked smile',
      },
    },
  },
  dancer: {
    classes: ['Dancer', 'Bard'],
    people: {
      dancer_a: {
        g: 'f',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a young woman, deep brown skin, long black box braids with small gold cuffs, a radiant smile',
      },
      dancer_b: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairBlack' },
        look: 'an East Asian woman in her twenties, black hair in an elegant updo with a long hairpin, serene',
      },
      dancer_c: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairBlond' },
        look: 'a young woman, fair skin, honey-blonde wavy hair to the shoulders, bright playful eyes',
      },
      dancer_d: {
        g: 'f',
        sprite: { skin: 'skinOlive', hair: 'hairDarkBrown' },
        look: 'a woman in her thirties, olive skin, long dark wavy hair, heavy-lidded confident eyes, a beauty mark',
      },
      dancer_e: {
        g: 'm',
        sprite: { skin: 'skinTan', hair: 'hairBlack' },
        look: 'a lithe young man, tan skin, tousled black hair with a fringe, a single gold earring, a cheeky grin',
      },
    },
  },
  pegasus: {
    classes: ['Pegasus Knight', 'Falcon Knight', 'Wyvern Lord'],
    people: {
      pegasus_a: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairSilver' },
        look: 'a young woman, fair skin, ash-white hair at chin length with a side braid, calm grey eyes',
        anchor: { 'Falcon Knight': { id: 'generic_falcon_knight', mode: 'remaster' } },
      },
      pegasus_b: {
        g: 'f',
        sprite: { skin: 'skinTan', hair: 'hairDarkBrown' },
        look: 'a young woman, brown skin, short dark curls, a bright open smile',
      },
      pegasus_c: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairBlack' },
        look: 'a young woman, fair skin, long straight black hair in a high ponytail, determined',
      },
      pegasus_d: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairDarkBrown' },
        look: 'a slender East Asian young man, chin-length dark brown hair, calm attentive eyes',
      },
      pegasus_e: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairLightBrown' },
        look: 'a teenage girl, freckled fair skin, light brown hair in two low pigtails, cheerful',
      },
    },
  },
  wyvern: {
    classes: ['Wyvern Rider', 'Wyvern Lord', 'Falcon Knight'],
    people: {
      wyvern_a: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairAuburn' },
        look: 'a burly man in his forties, fair ruddy skin, swept-back red-brown hair and a full red-brown beard, stern',
        anchor: { 'Wyvern Lord': { id: 'generic_wyvern_lord', mode: 'remaster' } },
      },
      wyvern_b: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairBlond' },
        look: 'a young man, fair skin, short tousled blond hair, blue eyes, an eager half smile',
        anchor: { 'Wyvern Rider': { id: 'generic_wyvern_rider', mode: 'remaster' } },
      },
      wyvern_c: {
        g: 'f',
        sprite: { skin: 'skinDeep', hair: 'hairBlack' },
        look: 'a woman in her thirties, deep brown skin, long black hair in one thick braid, a scar along the jaw, fierce',
      },
      wyvern_d: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairSaltPepper' },
        look: 'a grizzled man in his fifties, pale skin, short dark hair going grey at the temples, deep lines, stern',
      },
      wyvern_e: {
        g: 'f',
        sprite: { skin: 'skinTan', hair: 'hairAuburn' },
        look: 'a young woman, tan skin, short spiky auburn hair, a fierce grin',
      },
    },
  },
  mercenary: {
    classes: ['Mercenary', 'Hero', 'Hunter'],
    people: {
      mercenary_a: {
        g: 'm',
        sprite: { skin: 'skinFair', hair: 'hairLightBrown' },
        look: 'a young man, fair freckled skin, short light-brown hair, a boyish friendly grin',
        anchor: { Mercenary: { id: 'generic_mercenary', mode: 'remaster' } },
      },
      mercenary_b: {
        g: 'm',
        sprite: { skin: 'skinWarm', hair: 'hairDarkBrown' },
        look: 'a man in his late twenties, light-tan skin, swept-back dark brown hair, a strong jaw with stubble, steady gaze',
        anchor: { Hero: { id: 'generic_hero', mode: 'remaster' } },
      },
      mercenary_c: {
        g: 'm',
        sprite: { skin: 'skinDeep', hair: 'hairBlack', bald: true },
        look: 'a man in his forties, deep brown skin, shaved head, a thick black beard, a scar through one eyebrow',
      },
      mercenary_d: {
        g: 'f',
        sprite: { skin: 'skinFair', hair: 'hairSandy' },
        look: 'a woman in her thirties, fair skin, dark blonde hair in a practical braided crown, stern grey eyes',
      },
      mercenary_e: {
        g: 'f',
        sprite: { skin: 'skinWarm', hair: 'hairBlack' },
        look: 'a Southeast Asian woman in her thirties, black hair in a short tail, a calm, faintly amused look',
      },
    },
  },
});

// Enemy classes with portraits. Monsters (Dragon, Dragon Lord, Zombie,
// Revenant) and the Entity keep their single portrait.
export const ENEMY_CLASSES = Object.freeze([
  'Archer',
  'Assassin',
  'Battle Monk',
  'Berserker',
  'Bishop',
  'Bow Knight',
  'Cavalier',
  'Cleric',
  'Dancer',
  'Dark Knight',
  'Duelist',
  'Falcon Knight',
  'Fighter',
  'General',
  'Great Knight',
  'Hero',
  'Hunter',
  'Knight',
  'Mage',
  'Mercenary',
  'Myrmidon',
  'Paladin',
  'Pegasus Knight',
  'Sage',
  'Sniper',
  'Swordmaster',
  'Thief',
  'Trickster',
  'Warlock',
  'Warrior',
  'Wyvern Lord',
  'Wyvern Rider',
]);

// Enemy faces beyond the remastered one: drawn from this library, three per
// class, rotated so neighbouring classes do not share the same trio.
export const ENEMY_LOOKS = Object.freeze([
  {
    g: 'm',
    look: 'a hard-faced man in his forties, pale skin, cropped black hair, a hooked nose, cold eyes',
  },
  {
    g: 'f',
    look: 'a young woman, olive skin, dark hair scraped into a tight bun, a thin cruel smile',
  },
  { g: 'm', look: 'a young man, fair skin, short blond hair, a sneer, a fresh cut on the cheek' },
  {
    g: 'm',
    look: 'a scarred man in his fifties, brown skin, grey stubble on a shaved head, a heavy frown',
  },
  {
    g: 'f',
    look: 'a woman in her thirties, pale skin, short black hair, a scar across the lips, unblinking stare',
  },
  {
    g: 'm',
    look: 'a man in his thirties, tan skin, long greasy dark hair, a broken nose, a snarl',
  },
  {
    g: 'f',
    look: 'a woman in her forties, deep brown skin, close-cropped grey hair, a stern commanding look',
  },
  {
    g: 'm',
    look: 'a gaunt man in his sixties, sallow skin, thin white hair, sunken eyes, a sour mouth',
  },
  {
    g: 'm',
    look: 'a burly man in his thirties, ruddy skin, a red beard and shaved head, an angry glare',
  },
  {
    g: 'f',
    look: 'a young woman, fair skin, straight ash-brown hair to the jaw, flat emotionless eyes',
  },
  {
    g: 'm',
    look: 'an East Asian man in his forties, a black topknot, a thin moustache, narrowed eyes',
  },
  { g: 'm', look: 'a young man, deep brown skin, short twists, a cold arrogant smirk' },
]);

// Recruit name -> presentation, from the data/recruits.json name pools (and
// the names of earlier pools, which legacy saves still carry). `n` lists
// names that read as either: they match any face. Every pool name must be
// listed (tests/PortraitVariants.test.js), so a new name is a conscious call.
export const NAME_GENDERS = Object.freeze({
  m: [
    'Galvin',
    'Bram',
    'Halvar',
    'Oswin',
    'Brogan',
    'Tolly',
    'Horst',
    'Barnaby',
    'Grig',
    'Magnus',
    'Otho',
    'Tarvek',
    'Hob',
    'Colm',
    'Perrin',
    'Garran',
    'Mott',
    'Lowen',
    'Theron',
    'Ansel',
    'Corin',
    'Tobiah',
    'Vaelan',
    'Castor',
    'Lucan',
    'Faustin',
    'Aldric',
    'Cyrus',
    'Garrick',
    'Benet',
    'Tancred',
    'Godric',
    'Bertrand',
    'Clovis',
    'Lothar',
    'Hugo',
    'Wilmot',
    'Caelen',
    'Anselm',
    'Tobin',
    'Aurel',
    'Clement',
    'Oswald',
    'Piran',
    'Lucius',
    'Soren',
    'Kael',
    'Teo',
    'Oren',
    'Dobbin',
    'Silas',
    'Maro',
    'Duvik',
    'Gareth',
    'Brandt',
    'Valen',
    'Ottar',
    'Rennick',
    'Dante',
    'Corwin',
    'Aldous',
    'Ivo',
    'Garret',
    'Tomas',
    'Radek',
    'Evin',
    'Emeric',
    'Osric',
    'Gunther',
    'Baldric',
    'Aldo',
    'Wendel',
    'Hamond',
    'Nico',
    'Jaro',
    'Draven',
    'Hakon',
    'Ulf',
    'Stig',
    'Drakon',
    'Hrolf',
    'Eirik',
    'Orm',
    'Bjarke',
    // earlier pools
    'Tormund',
    'Roderick',
    'Bjorn',
    'Lysander',
    'Corvus',
    'Marcus',
    'Percival',
    'Zephyr',
    'Thane',
    'Roland',
    'Sigurd',
    'Ajax',
    'Hector',
    'Leonidas',
    'Merric',
  ],
  f: [
    'Hedda',
    'Maud',
    'Gerd',
    'Jorun',
    'Dagna',
    'Ulrike',
    'Runa',
    'Wren',
    'Talia',
    'Ada',
    'Linnet',
    'Tamsin',
    'Edda',
    'Faye',
    'Vera',
    'Isra',
    'Bodil',
    'Ansa',
    'Lira',
    'Elara',
    'Isolde',
    'Maren',
    'Sabeth',
    'Ottoline',
    'Beneda',
    'Hesper',
    'Ismay',
    'Oriane',
    'Helena',
    'Rowena',
    'Leona',
    'Marisse',
    'Emmeline',
    'Amara',
    'Genevra',
    'Miriel',
    'Iona',
    'Althea',
    'Brynn',
    'Hilde',
    'Constance',
    'Benedetta',
    'Agathe',
    'Honora',
    'Vivia',
    'Hana',
    'Yara',
    'Ilse',
    'Mirel',
    'Daska',
    'Sefa',
    'Nyx',
    'Mags',
    'Tess',
    'Vesna',
    'Nell',
    'Senna',
    'Sigrid',
    'Jessa',
    'Mathea',
    'Branwen',
    'Ysabel',
    'Elysia',
    'Aerin',
    'Iris',
    'Ilka',
    'Neve',
    'Sabine',
    'Coralie',
    'Maelis',
    'Celeste',
    'Adela',
    'Liane',
    'Orla',
    'Vianne',
    'Kestra',
    'Solenne',
    'Rhosyn',
    'Ingrid',
    'Helga',
    'Brunna',
    'Petra',
    'Sylvie',
    'Aria',
    'Liesl',
    'Zora',
    'Mira',
    'Anouk',
    'Esme',
    'Pia',
    'Ragna',
    'Torvi',
    'Ysolt',
    'Brenna',
    'Asta',
    'Sunniva',
    'Thyra',
    'Grisel',
    'Vigdis',
    // earlier pools
    'Ashara',
    'Vesper',
    'Lunara',
    'Soleil',
    'Melodia',
    'Cadence',
    'Lyric',
    'Rhapsody',
    'Seraphina',
    'Valkyrie',
    'Artemis',
    'Lumina',
    'Grace',
  ],
  n: [
    'Ren',
    'Vell',
    'Pell',
    'Io',
    'Aurin',
    'Oriel',
    'Aldis',
    'Keffa',
    'Wicker',
    'Sparrow',
    'Rook',
    'Pim',
    'Fen',
    'Lark',
    'Shade',
    'Kiran',
    'Tavi',
    'Riss',
    'Kestrel',
    'Hollis',
    'Morrow',
    'Tarin',
    'Kari',
    'Varga',
    'Ardis',
  ],
});
