// All class recipes, merged.
import { CLASSES as SWORD } from './classes.mjs';
import { INFANTRY } from './infantry.mjs';
import { MOUNTED } from './mounted.mjs';

export const RECIPES = { ...SWORD, ...INFANTRY, ...MOUNTED };
