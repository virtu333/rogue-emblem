// Prompt text for portrait variant generations (pure).
//
// Reference images, in order:
//   1. style sheet: four approved rebuilt portraits (the house style)
//   2. identity: the same person in another class, or the legacy portrait
//      being remastered
//   3. costume: the class default portrait (outfit only)

export const STYLE = [
  'Pixel art character portrait for a dark-fantasy tactics RPG, drawn exactly in the style of the first reference image:',
  '16-bit JRPG pixel art, crisp square pixels on a grid of about 110 by 110 art pixels, a bold near-black outline around the silhouette and the features,',
  'cel shading with two or three tones per material, warm key light from the upper left with cool, slightly violet shadows, muted earthy colours.',
  'Composition, matching the reference portraits exactly: a head-and-shoulders bust in three-quarter view, the body angled and the face turned toward the right side of the image,',
  'the top of the head just below the top edge, the eyes about 36% down from the top, and the shoulders and upper chest filling the whole width of the bottom edge.',
  'One single character. Background: flat solid pure white, nothing else - no scenery, no floor, no cast shadow, no frame, no border, no text, no signature.',
  'No glowing eyes, no skulls, no spikes, no magic glow or particles, nothing covering the face.',
].join(' ');

const EMPIRE =
  "recoloured for the Empire's army: iron grey and crimson lacquer, dark leather and blood-red cloth";

/** @param {object} job from plan.mjs  @param {{identity:boolean, costume:boolean}} refs */
export function promptFor(job, refs) {
  const lines = [STYLE, ''];
  const outfit = job.side === 'enemy' ? `${job.costume}, ${EMPIRE}` : `${job.costume}`;
  if (job.mode === 'remaster') {
    lines.push(
      job.side === 'enemy'
        ? `Redraw the enemy soldier shown in the second reference image in this style: the same ${job.className}, the same face, hair, age and expression, the same outfit design in the same crimson and iron colours, but drawn at the quality, scale and framing of the first reference image. Keep them an ordinary grim human: no glowing eyes, no skull face, no spikes.`
        : `Redraw the character shown in the second reference image in this style: the same person (${job.look}), the same hair, the same outfit design and colours (${outfit}), but drawn at the quality, scale and framing of the first reference image.`,
    );
  } else if (refs.identity) {
    lines.push(
      `Character: the exact same person as in the second reference image - keep the face, skin tone, eye colour, hair, age, facial hair, scars and expression identical - now equipped as a ${job.className}.`,
      `(This person is ${job.look}.)`,
      `Outfit: ${outfit}.`,
    );
  } else {
    lines.push(
      job.side === 'enemy'
        ? `Character: an enemy ${job.className} of the Empire, a new original person unlike anyone in the reference images: ${job.look}.`
        : `Character: a ${job.className}, a new original person unlike anyone in the reference images: ${job.look}.`,
      `Outfit: ${outfit}.`,
    );
  }
  if (refs.costume)
    lines.push(
      `The last reference image shows the ${job.className} outfit to follow: use it for the outfit only, never for the face.`,
    );
  return lines.join('\n');
}
