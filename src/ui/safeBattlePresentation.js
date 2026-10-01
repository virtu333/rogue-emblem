// Call only with presentation work: model mutations and required effects stay
// outside this boundary so a destroyed renderer cannot interrupt resolution.
export function safeBattlePresentation(label, present) {
  const failed = (error) => {
    console.warn(`[BattleScene] ${label} presentation failed; continuing:`, error);
  };
  try {
    const result = present();
    return result && typeof result.catch === 'function' ? result.catch(failed) : result;
  } catch (error) {
    failed(error);
  }
}
