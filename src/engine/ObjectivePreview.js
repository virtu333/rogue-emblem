// ObjectivePreview.js - the objective of a battle that has no config yet (docs/specs/act-v-descent.md
// §9.4). The deploy screen (it opens before the map is built), the route map's node card and
// tooltip read a node's battleParams, whose `objective` is only the legacy family ('rout' for a
// defeat map). A node that carries an objectives model, or names a set piece that does, is read
// from it instead, so the words match what the battle will show. Pure: no Phaser, no RNG.
//
// What it knows is what the data says before any foe is placed: the target slots' names, and the
// boss slot's (the gate names its boss in the params, `bossName`). Never a tile, never a class or
// a level, so the route map reveals nothing the strip does not.
import { findSetPiece } from './SetPieces.js';
import { objectivesOf, statusView } from './BattleObjectives.js';

/** One pseudo-unit per authored slot a ref can name; the first variant that has it wins. */
function previewUnits(setPiece) {
  const units = [];
  const seen = new Set();
  let seated = false;
  for (const variant of Array.isArray(setPiece?.variants) ? setPiece.variants : []) {
    for (const slot of Array.isArray(variant?.enemies) ? variant.enemies : []) {
      const isBoss = slot?.boss === true || Boolean(slot?.captain);
      if (isBoss) {
        if (seated) continue;
        seated = true;
      } else if (typeof slot?.id !== 'string' || seen.has(slot.id)) continue;
      if (slot.id) seen.add(slot.id);
      units.push({
        faction: 'enemy',
        authoredId: slot.id,
        name: slot.name || slot.captain?.name,
        isBoss,
      });
    }
  }
  return units;
}

/**
 * The objectives model a node's battle will play, with its words as the strip will first read
 * them: `{ kind, objectives, view }` for a node that names a set piece carrying a model, else null
 * (a template map, a legacy set piece, a set piece this build lacks).
 * @param {object} params a node's battleParams (or the scene's)
 * @param {object} setPieces gameData.setPieces
 */
export function previewObjectives(params, setPieces) {
  const piece = findSetPiece(setPieces, params?.setPiece);
  // A node's own model (the Descent's gate fights the Glass as a defeat of its boss) is the one
  // the battle plays, over its set piece's.
  const objectives = objectivesOf(params) || objectivesOf(piece);
  if (!objectives) return null;
  const units = previewUnits(piece);
  const bossName = typeof params?.bossName === 'string' ? params.bossName : undefined;
  return {
    kind: objectives.primary[0].kind,
    objectives,
    view: statusView(objectives, { enemyUnits: units, spawns: units, bossName }),
  };
}

/** The kind a node's battle is played as: its set piece's first objective kind, else the params'. */
export function paramsObjectiveKind(params, setPieces) {
  return previewObjectives(params, setPieces)?.kind ?? params?.objective ?? null;
}
