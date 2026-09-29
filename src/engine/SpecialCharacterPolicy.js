// Stable identities keep special-unit rules across roster, battle and saved snapshots.
export function isVeteranKnight(unit) {
  return unit?.specialCharId === 'old_knight';
}

export function contributesToTeamLevel(unit) {
  return !isVeteranKnight(unit);
}

export function skipsClassProgression(unit) {
  return isVeteranKnight(unit);
}

export function combatBlocksCanto(unit) {
  return isVeteranKnight(unit);
}
