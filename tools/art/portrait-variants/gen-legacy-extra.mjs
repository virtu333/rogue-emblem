#!/usr/bin/env node
// Portraits for units that are not a recruit class: the caravan Merchant (an NPC the engine
// builds outside the unit factories) and the enemy-only Necromancer, Skeleton, Circle Adept, Hollowed and Iron Guardian. Like
// gen-legacy-base.mjs these are 128 px legacy-style portraits (assets/portraits/<id>.png)
// that the PC-98 build (tools/art/pc98) treats as the unit's default id. They are single
// portraits (no variants, like the Zombie and Revenant): there is one Merchant design, a
// battle has at most one Necromancer, and a Skeleton is a monster.
//
//   node tools/art/portrait-variants/gen-legacy-extra.mjs --id generic_merchant [--takes 3] [--model pro]
//   node tools/art/portrait-variants/gen-legacy-extra.mjs --id generic_merchant --choose 2
//
// Raw takes go to References/portrait-variants/legacy-extra/ (gitignored); --choose writes the
// 128 px portrait into assets/portraits/ and records the prompt, references and take in
// tools/art/portrait-variants/legacy-extra.json, so the asset can be regenerated.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateAll, MODELS } from '../gen/geminiImage.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const WORK = 'References/portrait-variants/legacy-extra';
const RECORD = 'tools/art/portrait-variants/legacy-extra.json';
const SHEETS = 'docs/art/class-sprite-review-2026-09-22/sheets';

export const STYLE =
  'A 128 by 128 pixel art character portrait for a dark-fantasy tactics RPG, drawn exactly in the style of the first ' +
  'two reference images (the same game): crisp square pixels, a dark outline, three-tone cel shading lit from the ' +
  'upper left, a head-and-shoulders bust in three-quarter view facing right, the shoulders filling the bottom edge, ' +
  'on a flat dark navy (#1b1d33) background. One character, no text, no frame, no glow.';

/** id -> { prompt, refs } */
export const EXTRA = {
  generic_merchant: {
    prompt:
      `${STYLE} The character: a travelling Merchant who owns a caravan, a friendly, shrewd man in his forties, ` +
      'weathered tan skin, a short dark beard with a little grey, warm crinkled eyes and a small knowing smile, a brown ' +
      'felt travelling cap. Outfit: a deep green wool cloak with a broad hood folded back on the shoulders, a leather ' +
      'bandolier with a coin pouch and a brass scale hanging from it, a cream linen shirt, a heavy pack strap across ' +
      'the chest. An unarmed civilian: no weapon, no armour. Green is his colour (an ally NPC).',
    refs: ['assets/portraits/generic_mercenary.png', 'assets/portraits/generic_cavalier.png'],
  },
  enemy_necromancer: {
    prompt:
      `${STYLE} The character: an enemy Necromancer of the Empire's unlight, a gaunt dark-robed caster, a pale ` +
      'hollow-cheeked man of indeterminate age with sunken dark eyes and thin colourless lips, his face fully visible ' +
      'under a deep hood of plum-violet cloth with a crimson inner lining. Outfit: ragged plum-violet robes with a ' +
      'narrow crimson tabard panel down the front and a bone-white sash, a tarnished silver clasp at the throat, bony hands holding a closed black tome bound ' +
      'with a chain against the chest. Cold and still, a menacing scholar, not a skeleton: a living human face. ' +
      'No glowing eyes, no magic particles. The third reference image is the class map sprite (the robed caster): ' +
      'follow its costume. Palette: violet-black, crimson, bone white.',
    refs: [
      'assets/portraits/enemy_mage.png',
      'assets/portraits/enemy_zombie.png',
      `${SHEETS}/necromancer.png`,
    ],
  },
  enemy_skeleton: {
    prompt:
      `${STYLE} The character: an enemy Skeleton, an animated human skeleton raised by a necromancer: a bare bone-white ` +
      'skull with deep empty eye sockets (a faint dull red pinprick deep in each), a cracked cranium, missing teeth, ' +
      'visible collarbones and the top of a ribcage, a few rags of grey cloth hanging from one shoulder and a rusted ' +
      'iron cap fragment. It must read as clean bleached BONE (ivory, grey and shadow-violet), not rotting flesh: ' +
      'no skin, no hair, no gore. The third reference image is the class map sprite: follow it. Not the same as the ' +
      'second reference (the Zombie is green rotting flesh; this is bare bone).',
    refs: [
      'assets/portraits/enemy_revenant.png',
      'assets/portraits/enemy_zombie.png',
      `${SHEETS}/skeleton.png`,
    ],
  },
  // Act V "The Descent" (docs/specs/act-v-descent.md §5): single portraits like the Necromancer.
  enemy_circle_adept: {
    prompt:
      `${STYLE} The character: an enemy Circle Adept, a ritualist of the Empire's court circle: a composed, ` +
      'ceremonial figure, calm and unhurried, not a grave-priest. A deep ash-grey hood, the lower half of the face ' +
      'covered by a plain grey cloth veil so that only the shadowed, steady, tired eyes of a living middle-aged ' +
      'person show. Outfit: an ash-grey wool surplice with a stiff squared crimson lacquer mantle and high crimson ' +
      'collar, bone-white cuffs, and a thick closed book held against the chest, wrapped many times in grey cord ' +
      'with knotted ends and tassels. Cold and still, a formal officiant. No skull, no glowing eyes, no magic ' +
      'particles. The third reference image is the class map sprite: follow its costume. Palette: ash grey, ' +
      'crimson, bone white.',
    refs: [
      'assets/portraits/enemy_mage.png',
      'assets/portraits/enemy_sage.png',
      `${SHEETS}/circle-adept.png`,
    ],
  },
  enemy_hollowed: {
    prompt:
      `${STYLE} The character: an enemy Hollowed, an imperial levy soldier the rite has emptied out: the uniform ` +
      'is still on and the person has gone out of it. A kettle helmet sitting a little crooked over a mail ' +
      'aventail, a crimson padded coat hanging open with loose straps, and a pale ash-grey slack face: blank, dark, ' +
      'empty eyes with no pupils and no glow, a slightly open mouth, a head tilted a little to one side. It must ' +
      'read as a living-looking man with nobody home: NOT a skull, NOT a skeleton, NOT green rotting flesh (the ' +
      'Zombie), no wounds, no gore. The third reference image is the class map sprite: follow it. Palette: ash ' +
      'grey, crimson, steel.',
    refs: [
      'assets/portraits/enemy_soldier.png',
      'assets/portraits/enemy_zombie.png',
      `${SHEETS}/hollowed.png`,
    ],
  },
  // The Iron Guardian: a boss-tier keeper with a 2x2 body. A single portrait like the Adept.
  enemy_iron_guardian: {
    prompt:
      `${STYLE} The character: an enemy Iron Guardian, a colossal animated keeper of BLACK IRON that has guarded ` +
      'a buried hall under an old imperial mine for centuries: not a man in armour, there is no one inside. A ' +
      'small featureless great helm of pitted blue-black iron sunk low between huge rounded riveted pauldrons, a ' +
      'narrow visor slit with only a faint dull ember glow deep inside, a little tarnished gold trim on the helm. ' +
      'Thick layered iron plates like scales across the chest, a few hanging loose and cracked, a frayed old ' +
      'crimson imperial sash across one shoulder, and the top of the iron haft of a huge war maul rising beside ' +
      'it with both massive gauntlets resting on it. Heavy, patient, utterly still. The iron must not sink into ' +
      'the dark: clearly lighter cold grey highlights on every plate edge and rivet. No face, no skull, no ' +
      'runes, no particles. The third reference image is the class map sprite: follow it. Palette: blue-black ' +
      'iron, cold grey, crimson, a touch of tarnished gold.',
    refs: [
      'assets/portraits/enemy_general.png',
      'assets/portraits/enemy_revenant.png',
      `${SHEETS}/iron-guardian.png`,
    ],
  },
};

const id = flag('id');
const job = EXTRA[id];
if (process.argv[1]?.endsWith('gen-legacy-extra.mjs')) {
  if (!job) throw new Error(`--id must be one of ${Object.keys(EXTRA).join(', ')}`);
  mkdirSync(WORK, { recursive: true });
  const choose = flag('choose');
  if (choose) {
    const raw = ['png', 'jpg'].map((e) => `${WORK}/${id}-${choose}.${e}`).find(existsSync);
    if (!raw) throw new Error(`no take ${choose}`);
    // The model paints on a ~1024 px canvas; the legacy set is 128 px pixel art.
    await sharp(raw)
      .resize(128, 128, { kernel: 'lanczos3' })
      .png()
      .toFile(`assets/portraits/${id}.png`);
    const record = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
    record[id] = {
      ...job,
      take: Number(choose),
      model: flag('model', 'pro'),
      generator: 'gen-legacy-extra.mjs',
    };
    writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`${raw} -> assets/portraits/${id}.png`);
  } else {
    const takes = Number(flag('takes', 3));
    const list = Array.from({ length: takes }, (_, k) => ({
      name: `${id}-${k + 1}`,
      prompt: k ? `${job.prompt} Alternative take ${k + 1}.` : job.prompt,
      refs: job.refs,
      aspectRatio: '1:1',
      imageSize: '1K',
      model: MODELS[flag('model', 'pro')] || MODELS.pro,
      out: `${WORK}/${id}-${k + 1}`,
    }));
    const results = await generateAll(list, { concurrency: 2 });
    results.forEach((r, i) => console.log(list[i].name, r?.files?.[0] || r?.error));
  }
}
