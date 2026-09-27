// The shot list for "The Far Side of the Glass" (docs/specs/cutscene-far-side.md):
// one keyframe (Gemini image) and one Veo clip per shot. The clips are never shown:
// pixel.py redraws every frame at 480x270 in a fixed palette. So the sources are
// painted like a 1990s dark-fantasy anime OVA (flat cels, clean ink lines), which is
// what survives the pixel pass best, and everything important sits in the middle
// band of the frame, because the player letterboxes to 2.35:1.

export const LOOK =
  'A frame from a 1990s Japanese dark-fantasy anime OVA, hand-painted cel animation in ' +
  'the manner of Record of Lodoss War, Berserk (1997) and Vampire Hunter D: clean ' +
  'confident ink outlines, flat cel shading with one hard shadow tone and one highlight, ' +
  'painted backgrounds with atmospheric depth, a limited muted palette of dusk gold, ' +
  'crimson, slate blue and violet-black, a low warm key light from the upper left, deep ' +
  'shadows. Cinematic widescreen composition with everything important in the central ' +
  'band of the frame (the top and bottom eighth will be cropped). No text, letters, ' +
  'runes, writing, watermark, subtitles or border.';

export const MOTION =
  'Traditional 2D anime cel animation, limited animation, painted background, the ' +
  'characters keep exactly their designs. No dialogue, no text.';

export const NEGATIVE =
  'photorealistic, live action, 3D render, CGI, text, letters, subtitles, watermark, ' +
  'morphing faces, extra limbs, modern objects';

// the current portraits (the PC-98 set the game ships)
const P = 'public/assets/portraits/pc98/192';
const B = P;
export const CAST = {
  edric: {
    ref: `${P}/lord_edric.png`,
    look:
      'Edric: a lean young man of 22, shaggy chestnut-brown hair, grey-blue eyes, a ' +
      'deep teal cloak wrapped high round his neck and shoulders, a dark brown coat with ' +
      'brass buttons, one steel pauldron, a tired kind face',
  },
  edric16: {
    ref: `${P}/lord_edric.png`,
    look: 'Edric at sixteen: a thin boy with shaggy chestnut-brown hair and a teal scarf',
  },
  sera: {
    ref: `${P}/lord_sera.png`,
    look:
      'Sera: a young woman of 20, long wavy crimson-red hair, green eyes, a purple seer ' +
      'robe with a high gold-trimmed collar and a small gold cross, a calm, haunted face',
  },
  lieutenant: {
    ref: `${B}/boss_the_lieutenant.png`,
    look:
      'the Lieutenant: a pale young man of 29, black hair streaked with white, a face ' +
      'crossed by fine old scars, tired grey eyes, black plate armour lined with crimson, ' +
      'a crimson cloak',
  },
  emperor: {
    ref: `${B}/boss_the_emperor.png`,
    look:
      'the Emperor: a hard old soldier, steel-grey swept-back hair, a deeply lined face, ' +
      'gold plate armour over a dark blue coat, a crimson cloak',
  },
  marshal: {
    ref: `${B}/boss_the_emperor.png`,
    look:
      'the Lord Marshal, thirty years younger than the attached portrait: a broad man of ' +
      '45, dark hair greying at the temples, a hard lined face, a plain dark blue ' +
      "marshal's coat with brass buttons, no armour, no crown",
  },
  iron_captain: {
    ref: `${B}/boss_iron_captain.png`,
    look:
      'the Iron Captain: a weathered border captain of 50 in a steel kettle helm and ' +
      'plain plate with a crimson half-cloak',
  },
  knight_commander: {
    ref: `${B}/boss_knight_commander.png`,
    look:
      'the Knight Commander: a silver-haired paladin of 59, gold-trimmed plate, a black ' +
      'tabard with a gold sun, a crimson cloak',
  },
  archmage: {
    ref: `${B}/boss_archmage.png`,
    look:
      'the Archmage: a gaunt old sage with long white hair and beard, a dark violet robe ' +
      'with crimson embroidered bands, a staff topped with a red orb',
  },
  dark_rider: {
    ref: `${B}/boss_dark_rider.png`,
    look:
      'the Dark Rider: a pale knight in a black winged helm and black plate trimmed with ' +
      'gold, a ragged crimson cloak',
  },
  blade_lord: {
    ref: `${B}/boss_blade_lord.png`,
    look:
      'the Blade Lord: a pale swordsman of 40 with long black hair, a black and crimson ' +
      'long coat, a slender curved sword',
  },
  iron_wall: {
    ref: `${B}/boss_iron_wall.png`,
    look:
      'the Iron Wall: a huge knight in a flat-topped great helm and heavy plate with a ' +
      'crimson tabard and a red-and-white striped tower shield',
  },
  berserker: {
    ref: `${B}/boss_berserker_king.png`,
    look:
      'the Berserker King: a massive bare-chested warrior, wild crimson hair, red war ' +
      'paint across his eyes, a necklace of fangs, a great axe',
  },
  leofric: {
    ref: `${B}/boss_knight_commander.png`,
    look:
      'a household knight of 25, the Knight Commander as a young man: dark hair, a ' +
      'plain linen shirt',
  },
};

const DAWN =
  'the Dawn: a tall woman made of soft white-gold light, seen from behind or with her ' +
  'face lost in glare (her face is never visible), long hair that drifts like threads ' +
  'of gold';

// id, cast, key (keyframe prompt), motion (Veo), dur (s), model ('veo' | 'veoFast'),
// refKey (another keyframe as a continuity reference)
export const SHOTS = [
  // ------------------------------------------------------------ I. The Morning
  {
    id: 'weave',
    key:
      `Endless black void. ${DAWN}, floating, arms outstretched, draws long threads of ` +
      'gold light across the dark from her fingertips like a weaver laying weft; where ' +
      'the threads cross, faint glimpses of a landscape (hills, a river) appear in the ' +
      'black. Seen from behind, small in the frame, centred.',
    motion:
      'She sweeps her arms slowly; the gold threads spread outward across the black and ' +
      'the glimpses of landscape between them grow. Slow push in.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'dragons',
    key:
      'The first morning of the world: three immense dragons, pale gold and pearl, fly ' +
      'in a slow line over a bright young valley of green hills and a winding silver ' +
      'river, under a whole white-gold sun (a normal bright sun, not dark). Clean air, ' +
      'soft clouds. Wide shot, low horizon.',
    motion:
      'The dragons glide across the frame with slow wingbeats; clouds drift; the camera pans to follow.',
    dur: 8,
    model: 'veoFast',
  },
  {
    id: 'first_names',
    key:
      'A reed hall at the edge of a lake at sunrise, the sun whole and bright. A young ' +
      'mother in simple undyed clothes lifts her newborn toward the light, her family ' +
      'around her; fisher-folk on reed-islands. Warm and hopeful. Medium wide shot.',
    motion: 'The mother slowly raises the baby to the light; reeds sway; gold light grows.',
    dur: 6,
    model: 'veoFast',
  },
  // ------------------------------------------------------------ II. The Spending
  {
    id: 'turning',
    key:
      'Cataclysm: the land heaves as if something vast beneath it is rolling over. A ' +
      'mountain range splits open along a glowing violet-black crack, forests tilt, a ' +
      'storm wall of black cloud and lightning. A tiny village in the foreground. Wide, ' +
      'violent, dark violet and slate.',
    motion:
      'The ground rolls like a wave toward the camera, the crack widens, trees topple, ' +
      'lightning flickers. Camera shake.',
    dur: 6,
    model: 'veoFast',
  },
  {
    id: 'kneel',
    key:
      'Night, a storm-lashed lowland fen. A tall woman wrapped in a long hooded mantle ' +
      'that glows soft white-gold, her face hidden in the shadow of the hood, kneels alone ' +
      'in the reeds, head bowed, ' +
      'hands open on her knees, the only light in the world. Rain, wind flattening the ' +
      'reeds. Seen from a little behind and to the side.',
    motion:
      'The hooded figure slowly lifts her head and the glow of her mantle swells; wind and rain whip the reeds around her.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'starfall',
    key:
      `${DAWN} dissolves upward into thousands of small gold sparks, like coins of light, ` +
      'which rise into a dark sky and then fall across the whole land like a meteor ' +
      'shower. Where she knelt the ground is opening into a pool of perfectly black, ' +
      'perfectly still water. Wide shot of the fen at night.',
    motion:
      'Her figure comes apart into rising gold sparks; they arc high and rain down over ' +
      'the land as falling stars; the black water spreads where she was.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'dragons_lie',
    key:
      'Dusk. A ring of great dragons lies down around a black, mirror-still mere in the ' +
      'fens, curled nose to tail, eyes closing; the nearest are already turning to grey ' +
      'standing stone, moss creeping over their scales. High angle, the ring centred.',
    motion:
      'The dragons lower their heads and close their eyes; stone and moss spread over ' +
      'them as if ages pass; light fades from day to night and back.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'hollow',
    key:
      'Sunrise over the fens and a ring of leaning standing stones around a black mere. ' +
      'The rising sun is a perfect black disc with a thin bright gold corona, casting a ' +
      'dim dusky gold light. Wide, symmetrical, awe and loss.',
    motion:
      'The black sun rises slowly over the horizon; mist moves over the water; very slow push in.',
    dur: 8,
    model: 'veo',
  },
  // ------------------------------------------------------------ III. The Unsworn Night
  {
    id: 'oath',
    key:
      'Long ago, at a river ford at dawn: a lord with no crown stands knee-deep in the ' +
      'water holding a horn, and armoured barrow-lords with torches kneel on both banks, ' +
      'right hands raised, swearing. Teal and gold banners. Epic, reverent. Wide shot.',
    motion:
      'The lord lifts the horn to his lips; the kneeling lords raise their hands; banners stir.',
    dur: 8,
    model: 'veoFast',
  },
  {
    id: 'list',
    cast: ['marshal'],
    key:
      "Close-up at night by one candle: {marshal}'s hand writes with a quill in red ink at " +
      'the top of a long parchment scroll of names (the writing is illegible scrawl). His ' +
      'hard face above, half in shadow.',
    motion: 'The quill scratches a line in red; he pauses, then keeps writing. Candle flickers.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'stair',
    cast: ['marshal'],
    key:
      'Deep inside a mountain: an enormous spiral stair carved into the living rock ' +
      'descends into darkness. {marshal} leads a procession of twelve hooded mages in ' +
      'crimson robes down it, each carrying a torch and a scroll. Seen from high above, ' +
      'looking down the well of the stair; torches spiral away into the black.',
    motion:
      'The procession winds down the stair; the camera slowly descends with them into the dark.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'hearth',
    cast: ['marshal'],
    key:
      'A vast cavern at the roots of a mountain, the stone warm and veined with dull red ' +
      'light like embers: the Hearthstone, a great dark stone in the middle. {marshal} ' +
      'kneels before it, head tilted, listening. Hooded mages stand in a ring reading ' +
      'from scrolls; faint red motes of light stream from their mouths into the dark ' +
      'above the stone. Wide, low angle.',
    motion:
      'The red veins in the stone pulse slowly like a heartbeat; red motes stream from ' +
      'the mages into the dark; the kneeling man closes his eyes. Slow push in.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'unsworn',
    cast: ['leofric'],
    key:
      'Midnight in a castle barracks: rows of knights asleep on cots. {leofric} sits bolt ' +
      'upright, eyes wide and empty, staring at his open hands as if they belong to ' +
      'someone else. Cold moonlight through a high window, deep blue shadow.',
    motion:
      'He jolts awake and sits up; he stares at his trembling hands; around him other knights stir and sit up.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'wall',
    cast: ['emperor'],
    key:
      '{emperor}, bareheaded, stands on the battlements of a black stone fortress on a ' +
      'mountain shoulder. Low angle from below. Behind him the sky is dusk-gold and in ' +
      'it hangs a black sun with a thin gold corona. Crimson banners, ranks of soldiers ' +
      'with spears below the wall in silhouette.',
    motion:
      'He looks down at his soldiers; crimson banners unfurl in the wind; the ranks raise their spears. Slow push in.',
    dur: 8,
    model: 'veo',
  },
  // ------------------------------------------------------------ IV. The Roll
  {
    id: 'siege',
    key:
      'Night: a walled old city in a river valley burns under siege. At its great east ' +
      'gate a line of defenders holds against a crimson tide of soldiers with ladders; ' +
      'fire arrows arc overhead; a cathedral burns behind. Wide, chaotic, orange and ' +
      'crimson against black.',
    motion:
      'Fire arrows streak across; the crimson army surges at the gate; flames roar. Camera pushes forward.',
    dur: 6,
    model: 'veoFast',
  },
  {
    id: 'king',
    key:
      'Moonlight at a wide shallow river ford. A young man stands waist-deep in the river ' +
      "holding a dying old king with a grey beard in his arms, an arrow in the king's " +
      "side. A plain gold crown is slipping from the young man's hand into the water. " +
      'Grief. Medium shot.',
    motion:
      "The old king's head falls back; the crown slips out of the young man's fingers and drops into the river with a splash.",
    dur: 6,
    model: 'veo',
  },
  {
    id: 'crown',
    key:
      'Underwater in a dark river: a plain gold crown sinks slowly through green-black ' +
      'water toward the pebbled riverbed, a trail of tiny bubbles, a faint shaft of ' +
      'moonlight from above.',
    motion:
      'The crown turns slowly as it sinks and settles on the gravel; silt puffs up; the light wavers.',
    dur: 6,
    model: 'veoFast',
  },
  {
    id: 'ledger',
    key:
      'A grey imperial registry hall: a clerk in a crimson robe and black hood writes ' +
      'names in red ink in a huge ledger (illegible scrawl). A long line of frightened ' +
      'villagers waits. Behind them a stone statue of a goddess whose face has been ' +
      'chipped away. Cold, orderly, oppressive.',
    motion:
      'The clerk dips the pen and writes; the line shuffles forward one step; the next villager bows his head.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'read',
    key:
      'A black cathedral-like chamber: robed cantors in crimson stand at the edge of a ' +
      'round pit of absolute darkness, reading aloud from long red scrolls; the words ' +
      'leave their mouths as streams of red light and pour down into the pit. The pit ' +
      'swallows all light.',
    motion:
      'Red light streams from the cantors down into the pit, faster and faster; the darkness in the pit ripples.',
    dur: 6,
    model: 'veo',
  },
  // ------------------------------------------------------------ V. The officers
  {
    id: 'o_captain',
    cast: ['iron_captain'],
    key:
      'Close shot: {iron_captain} brings a heavy iron stamp down onto a document on a ' +
      'rough table, grim and weary. Lantern light.',
    motion: 'He slams the iron stamp down hard; dust jumps; he looks up at the camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'o_commander',
    cast: ['knight_commander'],
    key:
      '{knight_commander} on a white warhorse lowers his lance, charging; behind him a ' +
      'hall burns at night and lances pour over its wall.',
    motion: 'He lowers the lance and spurs the horse into a charge toward the camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'o_archmage',
    cast: ['archmage'],
    key:
      '{archmage} writes in a small leather notebook by the light of the red orb on his ' +
      'staff, in a dark library; he glances up with a curious, amused smile.',
    motion: 'He stops writing and looks up with a slow, knowing smile; the red orb pulses.',
    dur: 4,
    model: 'veo',
  },
  {
    id: 'o_rider',
    cast: ['dark_rider'],
    key:
      '{dark_rider} gallops a black horse down an empty moonlit road, a sealed leather ' +
      'satchel at his hip, cloak streaming. Low side angle.',
    motion: 'The black horse gallops past at full speed; the cloak streams; dust flies.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'o_blade',
    cast: ['blade_lord'],
    key:
      '{blade_lord} stands still with his sword just sheathed, eyes closed; around him ' +
      'falling autumn leaves hang in the air, each cut cleanly in two. Pale dawn.',
    motion:
      'He clicks the sword home into its sheath; the falling leaves split in half around him.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'o_wall',
    cast: ['iron_wall'],
    key:
      '{iron_wall} slams his tower shield down into the ground in a castle breach, ' +
      'rubble and smoke around him. Low angle.',
    motion: 'He slams the shield down; the ground cracks; smoke bursts outward.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'o_berserker',
    cast: ['berserker'],
    key: '{berserker} roars at the sky with his axe raised, red mist around him, on a battlefield at dusk.',
    motion: 'He throws his head back and roars; the red mist swirls; he swings the axe down.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'o_emperor',
    cast: ['emperor'],
    key:
      '{emperor}, wearing a gold crown, sits on a black stone throne in a vast dark hall ' +
      'hung with captured crimson standards, an eagle shield at his side. His eyes are ' +
      'closed. Symmetrical, low angle, cold gold light.',
    motion: 'His eyes open slowly and fix on the camera. Very slow push in.',
    dur: 6,
    model: 'veo',
  },
  // ------------------------------------------------------------ VI. The one who counts
  {
    id: 'wendhall',
    cast: ['edric16'],
    key:
      'Night: a timber border hall burns. Out of its back door a huge old smith with a ' +
      'grey beard carries {edric16} over his shoulder; the struggling boy clutches a ' +
      'furled teal banner and a small clay pot glowing with a live ember. Sparks, smoke, ' +
      'orange firelight.',
    motion:
      'The smith runs out of the burning hall carrying the boy; the boy reaches back toward the flames; the roof collapses behind them.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'counting',
    cast: ['edric'],
    key:
      'Night, a small campfire on a hill above a river ford. {edric} sits alone by the ' +
      'fire, a furled teal banner beside him, his lips moving silently as he counts, ' +
      'eyes wet. Close medium shot, firelight on his face, dark around.',
    motion:
      'His lips move silently, counting names; he closes his eyes; the fire flickers; slow push in to his face.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'glass',
    cast: ['sera'],
    key:
      'Night in a fen. {sera} kneels at the edge of a black mere so still it is a perfect ' +
      'mirror, a ring of ancient leaning standing stones around it. She leans over the ' +
      'water, looking down into it. Side-on, her figure in the upper half of the frame, ' +
      'the black water filling the lower half (no reflection visible yet).',
    motion:
      'She leans slowly over the water; her hair slides forward over her shoulder; her eyes widen at what she sees. Mist drifts. Static camera.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'below',
    cast: ['lieutenant'],
    key:
      'Seen from directly above through dark, still water: {lieutenant} lies on his back ' +
      'far below the surface as if in a black mirror, looking straight up at the viewer. ' +
      'His face and shoulders fill the centre of the frame. Dark green-black water, a ' +
      'faint gold shimmer on his face.',
    motion: 'His eyes open and look straight up at the camera; the water above him shivers.',
    dur: 6,
    model: 'veo',
  },
  // ------------------------------------------------------------ VII. Every way it ends
  {
    id: 'd_ford',
    cast: ['edric'],
    key:
      '{edric} in battle in a river ford at dusk, arrows in his shoulder, falling ' +
      'backward into the water, sword slipping from his hand. Crimson soldiers on the bank.',
    motion: 'He staggers and falls back into the river with a great splash; the sword spins away.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'd_bridge',
    cast: ['edric'],
    key:
      "{edric} on a stone bridge in the rain at night, struck by a crimson knight's " +
      'sword, dropping to his knees. Lightning.',
    motion: 'The blow lands; he drops to his knees and slumps forward; lightning flashes.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'd_fens',
    cast: ['edric'],
    key:
      '{edric} sinking into black still fen water among dead reeds, one hand reaching up ' +
      'toward a hollow black sun. Grey, drained colours.',
    motion: 'He sinks slowly under the black water; his reaching hand goes under last.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'd_feet',
    cast: ['edric'],
    key:
      '{edric} lies fallen on dark stone stairs, looking up; in the foreground a black ' +
      'armoured boot and the hem of a crimson-lined black cloak, out of focus. Violet ' +
      'darkness.',
    motion: 'His eyes slowly close; the boot steps closer.',
    dur: 4,
    model: 'veo',
  },
  {
    id: 'rewind',
    cast: ['sera'],
    key:
      'Night by a campfire. {sera} holds a single thread of gold light taut between her ' +
      'hands, her eyes glowing faintly gold, strain on her face; sparks from the fire ' +
      'hang in the air. Medium close shot.',
    motion:
      'She pulls the gold thread tight with effort; the sparks above the fire stop and drift back down into it.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'camp',
    cast: ['edric', 'sera'],
    key:
      'The night before a march: a camp on a hill above a river ford, a fire in a ring of ' +
      'stones, a furled teal banner planted beside it. {edric} (the only one in a teal cloak) and {sera} sit by the fire ' +
      'with five companions: a young knight with auburn hair and a cream scarf, a bearded ' +
      'ranger in a moss-green mantle with a bow, a woman with a platinum ponytail tied ' +
      'with a blue ribbon beside a pale pegasus, a big sentinel in a kettle helm with a ' +
      'crimson scarf, a silver-haired tactician in a plum coat. Stars and a thin gold ' +
      'rim of light. Wide, warm, still.',
    motion: 'The fire crackles; the companions sit quietly; the banner stirs; slow pull back.',
    dur: 8,
    model: 'veo',
  },
  // ------------------------------------------------------------ VIII. The far side
  {
    id: 'sink',
    key:
      'Sinking through black water: faint gold motes drift upward past the viewer, and ' +
      'far below, upside down, the carved stone steps of an enormous stair beneath a ' +
      'mountain come into view in dim crimson light.',
    motion:
      'The camera sinks down through the water toward the upside-down stair; gold motes stream upward past it.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'reveal',
    cast: ['lieutenant'],
    key:
      'A stone landing on a vast stair deep beneath a mountain, dim crimson light from ' +
      'below and black water dripping from the rock above. {lieutenant} sits alone on ' +
      'the steps, forearms on his knees, head bowed. Medium shot, centred, symmetrical.',
    motion:
      'He slowly lifts his head and looks straight into the camera, then gives a faint, tired smile. Very slow push in.',
    dur: 8,
    model: 'veo',
  },
];
