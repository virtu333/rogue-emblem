// "The Ford" cut from generated takes (gen.js; boards/ford.json and boards/ford_edit.json).
import { makeGenPiece } from './gen.js';
import edit from './boards/ford_edit.json';

export { W, H } from './gen.js';
export { MUSIC_OFFSET, DURATION, FIRST_BAR, BAR, at } from './ford.js';
export const PieceClass = makeGenPiece('ford', edit);
export const SHOTS_OF = (p) => p.shots.map((s) => ({ name: s.name, from: s.from, to: s.to }));
