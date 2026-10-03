// "The Night Before" cut from generated takes (gen.js; boards/camp.json and boards/camp_edit.json).
import { makeGenPiece } from './gen.js';
import edit from './boards/camp_edit.json';

export { W, H } from './gen.js';
export { MUSIC_OFFSET, DURATION, FIRST_BAR, BAR, at } from './camp.js';
export const PieceClass = makeGenPiece('camp', edit);
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
