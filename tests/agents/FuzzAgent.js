// FuzzAgent — Random legal action selection (deterministic via seeded Math.random).

export class FuzzAgent {
  chooseAction(legalActions) {
    if (legalActions.length === 0) return null;
    return legalActions[Math.floor(Math.random() * legalActions.length)];
  }
}
