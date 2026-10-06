// Prompts for the route-map Event medal and its Dark Omen (eclipsed) variant
// (docs/specs/event-art.md item 1). The style reference is the weathered nodes sheet the
// other medals were cut from (assets/sprites/nodes/weathered-nodes.png).

export const STYLE =
  'Use the reference sheet as the exact style guide: chunky pixel-art game icon, thick near-black ' +
  'pixel outline, the same large pixel size, the same flat cel shading with a few dithered ' +
  'highlights, the same muted earthy palette (stone grey, weathered brown wood, moss green, ' +
  'faded red and teal cloth, warm gold light), key light from the upper left. Draw ONE new icon ' +
  'framed and scaled like a single cell of the sheet: one object group, centred, filling most of ' +
  'the square, sitting on a small patch of mossy earth like the church, shop and ruins icons do. ' +
  'Background: flat pure white (#FFFFFF), nothing else, no cast shadow beyond the base patch. ' +
  'No text, no letters, no runes, no frame, no border, no UI, no skulls.';

/** Concept takes for the Event medal: what waits on the road. */
export const EVENT_CONCEPTS = {
  signpost:
    'A leaning wooden crossroads signpost with two blank arrow boards pointing different ways, an ' +
    'iron lantern hanging from a crook on top of the post with a small lit gold flame, a faded teal ' +
    "traveller's cloth tied round the post, and a coil of rope at its foot",
  cairn:
    'A roadside waystone: a tall leaning post of dark wood with a lit hanging lantern, a faded red ' +
    'ribbon, a small cairn of stacked pale stones at its foot and a closed leather satchel resting ' +
    'against the cairn',
  lantern:
    'A single tall iron lantern on a wooden hook-post at a fork in the road, warm gold flame inside ' +
    'glass, a folded sealed letter with a red wax seal pinned to the post, two small stones at its base',
};

/** The Dark Omen: the same medal once the Eclipse has taken the road. */
export const DARK_OMEN =
  'Now draw the Dark Omen version of the FIRST reference image (the event medal): exactly the same ' +
  'objects, silhouette, outline weight, pixel size and framing, but the Eclipse has taken it. The ' +
  'wood is blackened and splintered, the iron is dark and pitted, the lantern flame has turned a ' +
  'cold unlight violet, the sealed letter is scorched ash-grey with its wax seal cracked and ' +
  'glowing ember-orange, and a small black eclipse disc with a thin gold corona sits behind the top ' +
  'of the post. A few hairline cracks leak ember light. Colours: ink violet-black, dim steel, bone, ' +
  'with only the corona gold, the ember cracks and the violet flame bright. The second reference ' +
  'is the style sheet. Same flat pure white background (#FFFFFF), no text, no frame.';
