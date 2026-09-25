// Every combat effect animation, in atlas order.
import { WEAPON_ANIMS } from './families/weapons.mjs';
import { MAGIC_ANIMS } from './families/magic.mjs';
import { PROC_ANIMS } from './families/procs.mjs';
import { GROUND_ANIMS } from './families/ground.mjs';
import { SIGNATURE_ANIMS } from './families/signatures.mjs';

export const ALL_ANIMS = [
  ...WEAPON_ANIMS,
  ...MAGIC_ANIMS,
  ...PROC_ANIMS,
  ...GROUND_ANIMS,
  ...SIGNATURE_ANIMS,
];
