// The encounter check over a bare list of enemies, as AIController runs it without a battle's
// source: the groups are the hold packs among them and the state is read from them
// (EncounterGroups). Returns the members woken.
import { battleEncounterGroups, checkEncounters } from '../../src/engine/EncounterGroups.js';

export function wakeCheck({ enemyUnits = [], ...rest }) {
  return checkEncounters({ groups: battleEncounterGroups(null, enemyUnits), enemyUnits, ...rest })
    .woken;
}
