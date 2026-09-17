// Development-only encounter: a wide river crossing for testing phone composition.
// Terrain indices are resolved by name; combat and movement use the normal engine.
export function createBattlefieldLabFixture(base, terrain) {
  const id = (name) => terrain.findIndex((entry) => entry.name === name);
  const characterReview =
    new URLSearchParams(globalThis.location?.search || '').get('characterReview') === '1';
  const cols = 24;
  const rows = 8;
  const mapLayout = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      if (col === 15 || col === 16) return id(row === 3 ? 'Bridge' : 'Water');
      if (row === 3) return id('Sand');
      if ((row === 0 || row === 7) && (col < 4 || col > 20)) return id('Mountain');
      if ((col * 3 + row * 7) % 13 < 3 && row !== 2 && row !== 5) return id('Forest');
      return id('Plain');
    }),
  );
  mapLayout[3][20] = id('Fort');
  const enemyPositions = [
    [10, 3],
    [18, 5],
    [20, 3],
  ];
  return {
    ...base,
    cols,
    rows,
    mapLayout,
    biome: 'grassland',
    objective: 'rout',
    playerSpawns: base.playerSpawns.map((spawn, i) => ({
      ...spawn,
      col: 6 - Math.floor(i / 4),
      row: 2 + (i % 4),
    })),
    enemySpawns: enemyPositions.map(([col, row], i) => ({
      col,
      row,
      className: ['Fighter', 'Archer', 'Myrmidon'][i],
      level: 1,
      ...(characterReview && i === 2
        ? { className: 'Fighter', name: 'Warchief', isBoss: true }
        : {}),
    })),
    npcSpawn: null,
    caravanSpawn: null,
    villageTile: null,
    ballistas: [],
  };
}
