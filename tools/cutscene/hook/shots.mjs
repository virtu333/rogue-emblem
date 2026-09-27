// The shot list for "The Roll" (docs/specs/cutscene-the-roll.md): one keyframe and
// one Veo clip per shot. The clips are never shown. They are traced into drawings
// (trace.py) and redrawn by the player, so the sources are lit for the tracer: one
// hard key light, deep black falloff, a rim, nothing busy in the background.

export const LOOK =
  'Cinematic film still, 35mm, anamorphic. Chiaroscuro: one hard warm key light, ' +
  'deep pure-black shadows and background, a thin rim light separating the figure ' +
  'from the dark. High contrast, simple uncluttered composition, strong readable ' +
  'silhouettes. Medieval low fantasy, practical costumes, no modern objects. ' +
  'No text, no letters, no watermark, no border.';

const P = 'public/assets/portraits';
export const CAST = {
  edric: {
    ref: `${P}/lord_edric.png`,
    look:
      'Edric: a lean young man of 22, shaggy teal-green hair, a thin silver circlet, a ' +
      'faded teal scarf, a patched brown travelling tunic and cloak, a tired, kind face',
  },
  sera: {
    ref: `${P}/lord_sera.png`,
    look:
      'Sera: a young woman of 20, long straight crimson-red hair, green eyes, a purple ' +
      'robe with a gold-trimmed high collar, a calm and haunted face',
  },
  rowan: {
    ref: `${P}/lord_rowan.png`,
    look: 'Rowan: a cocky young knight, copper-orange hair, steel plate armour over a blue tabard',
  },
  astrid: {
    ref: `${P}/lord_astrid.png`,
    look:
      'Astrid: a fierce woman with a long silver-blue ponytail in pale blue scale armour ' +
      'with feathered pauldrons',
  },
  voss: {
    ref: `${P}/lord_voss.png`,
    look:
      'Voss: a weathered ranger in his forties, brown hair tied back, a scar across his ' +
      'face, a green fur-trimmed mantle',
  },
  cael: {
    ref: `${P}/lord_cael.png`,
    look: 'Cael: a grizzled grey-haired veteran in heavy dented steel plate',
  },
  kira: {
    ref: `${P}/lord_kira.png`,
    look: 'Kira: a sharp young woman with a short silver bob and a plum-purple coat',
  },
};

const NEG =
  'text, captions, subtitles, watermark, logo, modern clothing, cartoon, blurry, ' +
  'extra fingers, deformed hands, camera shake';

/**
 * id, key (keyframe prompt), cast (identity refs for the keyframe), motion (Veo
 * prompt), dur (clip seconds), model ('veo' | 'veoFast').
 */
export const SHOTS = [
  {
    id: 'hearth',
    key:
      'Interior of a poor stone cottage at night. A mother in her thirties with very long ' +
      'dark auburn hair sits on a low stool at the LEFT of frame in profile, facing left, ' +
      'eyes closed, peaceful. Her daughter, about ten, kneels behind her at the RIGHT of ' +
      'frame, both small hands in her mother’s hair, braiding it. A hearth fire off-frame ' +
      'left lights them warm orange; the rest of the room falls to black. Medium shot, ' +
      'eye level, static.',
    motion:
      'The girl slowly braids her mother’s long hair, crossing the strands over. The mother ' +
      'breathes and smiles faintly with her eyes closed. Firelight flickers gently across ' +
      'them. Static locked-off camera. Quiet, intimate, slow.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'hearth_empty',
    // made by editing the hearth keyframe, so the framing matches exactly
    edit: 'hearth',
    key:
      'Remove the mother completely. The girl kneels in exactly the same place and pose, ' +
      'her small hands raised in the air, holding nothing, braiding nothing. The empty stool ' +
      'is still there. Keep the lighting, framing and everything else identical.',
    motion:
      'The girl’s hands slowly stop moving in the empty air. She lowers them and looks at ' +
      'her palms, puzzled, then looks at the empty stool. Firelight flickers. Static ' +
      'locked-off camera. Slow.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'door',
    key:
      'A cottage doorway at night, seen from inside. The door stands open. In it stands an ' +
      'imperial clerk, a thin pale man in a long dark crimson robe and a close black hood, holding a thick ' +
      'leather ledger against his chest; a lantern held low lights him from beneath so his ' +
      'eyes are in shadow. Behind him in the dark, two soldiers with spears in silhouette. ' +
      'Symmetrical, low angle.',
    motion:
      'The clerk steps over the threshold and slowly opens the ledger with both hands. The ' +
      'lantern light sways. The soldiers behind him do not move. Slow push in.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'quill',
    key:
      'Extreme close-up from above at an angle: an old ledger page ruled in columns, filled ' +
      'with rows of dense handwritten entries in dark red ink, and a pale clerk’s hand ' +
      'holding a long black quill, its nib touching the page at the bottom of a column. A ' +
      'single candle lights the page from the side; everything beyond the page is black.',
    motion:
      'The hand writes a new entry at the bottom of the column with the quill in steady ' +
      'strokes, wet red ink glistening, then lifts the quill. Very slow push in. Static light.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'wren',
    refKey: 'hearth',
    key:
      'Close-up of the same girl as in the reference image (about ten, light-brown hair in ' +
      'two braids, a grey-brown wool dress), lit warm from the left ' +
      'by firelight, pure black background. She looks down at her own open hands.',
    motion:
      'She looks down at her empty hands, then slowly raises her head and looks around the ' +
      'dark room, confused, as if she has forgotten something she cannot name. Static camera.',
    dur: 6,
    model: 'veo',
  },
  {
    id: 'capital',
    key:
      'Epic aerial view at dusk over a vast dark walled imperial city built in concentric ' +
      'rings of black stone around an enormous perfectly round pit at its centre, a stepped ' +
      'amphitheatre descending into darkness. In the sky above hangs a black sun ringed by a ' +
      'thin blazing gold corona, an eternal eclipse. Long shadows, thin smoke, tiny lit ' +
      'windows. No people and no figures anywhere. Wide, high angle.',
    motion:
      'Slow majestic aerial push forward and down toward the pit at the centre of the city. ' +
      'Smoke drifts. The gold ring of the black sun shimmers.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'edric_hand',
    cast: ['edric'],
    key:
      '{edric}, sits alone by a small campfire on a stony riverbank at night, holding his ' +
      'right hand up in front of his face and staring at it in dread. Firelight from below; ' +
      'behind him the black river with faint glints. Medium close-up, three-quarter view.',
    motion:
      'He turns his raised hand slowly, staring at it in dread, flexing the fingers as if they ' +
      'feel wrong. The fire crackles and flickers on his face; the river flows behind. Very ' +
      'slow push in.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'grab',
    key:
      'Live-action photograph, extreme close-up on hands only, no faces: a young woman’s ' +
      'slender hand coming out of a purple wool sleeve with a gold-embroidered cuff grips a ' +
      'young man’s bare wrist hard from the left; his hand, from a patched brown sleeve on ' +
      'the right, is open with fingers spread. Warm firelight from below, pure black ' +
      'background, realistic skin texture.',
    motion:
      'Her hand clamps tight around his wrist and holds it; his fingers clench into a fist. ' +
      'Firelight flickers. Static camera.',
    dur: 4,
    model: 'veo',
  },
  {
    id: 'sera_eyes',
    cast: ['sera'],
    key:
      'Close-up portrait of {sera}, lit by warm firelight from below and a thin cold rim light ' +
      'from behind, pure black background, her eyes closed, face straight to camera.',
    motion:
      'She opens her eyes slowly and looks directly into the lens. A wind rises and lifts her ' +
      'red hair around her face. Her eyes catch the light. Very slow push in.',
    dur: 8,
    model: 'veo',
  },
  {
    id: 'kira',
    cast: ['kira'],
    key:
      '{kira}, leans over a war table covered with a large map and carved wooden pieces, lit ' +
      'by one lantern hanging above; she looks up sharply at the camera. Black background.',
    motion:
      'She slams a carved piece down onto the map and looks up sharply. The lantern above ' +
      'swings, shadows sweeping across the table. Static camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'rowan',
    cast: ['rowan'],
    key:
      '{rowan}, charges on a galloping black warhorse straight at the camera, horse and ' +
      'rider filling most of the frame, lance couched, very low angle near the ground, backlit by a low sun at dusk, dust flaring. Dramatic, dynamic.',
    motion:
      'The warhorse gallops straight at the camera in slow motion, the lance lowering, dust ' +
      'and clods of earth flying, the rider shouting. Low tracking camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'astrid',
    cast: ['astrid'],
    key:
      '{astrid}, rides a white winged horse diving steeply through torn clouds at dusk, lance ' +
      'forward, wings half-folded, seen from the side against a bright sky rim.',
    motion:
      'The winged horse dives past the camera, wings snapping open, her silver ponytail ' +
      'streaming. The camera whips to follow. Fast, dynamic.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'cael',
    cast: ['cael'],
    key:
      '{cael}, braces behind a tall iron tower shield in the rain at night, torchlight from the ' +
      'side, arrows sticking out of the shield. Medium shot.',
    motion:
      'Arrows thud into the shield one after another, sparks flying; he braces and roars. Rain ' +
      'falls. Static camera with small impacts.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'voss',
    cast: ['voss'],
    key:
      '{voss}, in profile draws a longbow to full draw, backlit by distant fire at night, embers ' +
      'in the air. Medium shot, side view.',
    motion:
      'He holds the full draw, breathes out and looses; the arrow flies out of frame; the bow ' +
      'string snaps forward. Embers drift. Static camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'sera_light',
    cast: ['sera'],
    key:
      '{sera}, stands on a dark battlefield at night holding a small book in one hand and raising ' +
      'the other open palm, from which a blazing white-gold light erupts; imperial soldiers ' +
      'in silhouette recoil. Full body, low angle.',
    motion:
      'The light in her palm blooms outward into a blinding burst; her hair and robe blow ' +
      'back; the soldiers stagger away shielding their eyes. Static camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'edric_clash',
    cast: ['edric'],
    key:
      '{edric}, locks swords with an imperial soldier in a crimson surcoat and a faceless ' +
      'steel helm at night, sparks at the blades, fire behind. Medium close-up, side view.',
    motion:
      'The blades grind together and throw sparks; Edric shoves forward, breaks the bind and ' +
      'swings. Fast, dynamic. Static camera.',
    dur: 4,
    model: 'veoFast',
  },
  {
    id: 'helmet',
    key:
      'A dented steel helmet lying on its side in shallow river water at first light, a torn ' +
      'teal banner floating beside it, mist on the water, black trees beyond. Low angle, close.',
    motion:
      'Water flows gently around the helmet; the torn banner drifts slowly; mist rolls. ' +
      'Completely still camera.',
    dur: 6,
    model: 'veoFast',
  },
  {
    id: 'march',
    key:
      'A long column of soldiers and riders with tall banners marching along a high ridge in ' +
      'silhouette, toward an enormous black sun ringed by a thin gold corona sitting low on ' +
      'the horizon at dusk. Very wide shot, the ridge a black line across the lower third.',
    motion:
      'The column marches steadily left to right along the ridge; banners stream in the wind. ' +
      'Slow lateral tracking shot.',
    dur: 8,
    model: 'veo',
  },
];

export const NEGATIVE = NEG;
