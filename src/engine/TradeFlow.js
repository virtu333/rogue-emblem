export function shouldCommitTradeExit(tradeMutatedThisSession) {
  return Boolean(tradeMutatedThisSession);
}

export function shouldAllowUndoMove(preMoveLoc, tradeMutatedThisSession) {
  return Boolean(preMoveLoc) && !Boolean(tradeMutatedThisSession);
}
