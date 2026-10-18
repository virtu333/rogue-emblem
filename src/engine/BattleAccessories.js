// BattleAccessories.js — the accessories that keep a per-battle state, readied together at a
// fresh battle's start (BattleScene.resetUnitForBattle and its fresh-start pass, the harness):
// the Warden's Buckler's ward (engine/AccessoryWard.js) and the Galeforce Charm's uses and
// proc (engine/GaleforceCharm.js). A resume never calls it: the checkpoint holds both.

import { readyWard } from './AccessoryWard.js';
import { readyGaleforce } from './GaleforceCharm.js';

export function readyBattleAccessories(unit) {
  readyWard(unit);
  readyGaleforce(unit);
}
