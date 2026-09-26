// The player -> NPC colour swap (pure). An NPC is the same drawing as the player sprite
// with the faction cloth in verdigris instead of steel blue (lib/treat.mjs FACTIONS), so
// the runtime can derive a person's NPC sprite from their player frames by swapping the
// few colours the faction touches (src/ui/TracedSprites.js npcTexture) instead of baking
// a second copy of every person. The table is learnt at bake time from both renders of
// every person sprite, and the bake reports how many pixels it would get wrong.

const pack = (d, i) => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
const hex = (v) => v.toString(16).padStart(6, '0');

export function swapAccumulator() {
  return { votes: new Map(), pixels: 0, frames: [] };
}

/** Record one frame pair (same size Rasters: player render, NPC render). */
export function addSwapPair(acc, player, npc) {
  if (player.w !== npc.w || player.h !== npc.h) throw new Error('swap pair size mismatch');
  const a = player.d,
    b = npc.d;
  for (let i = 0; i < a.length; i += 4) {
    if (!a[i + 3] || !b[i + 3]) continue;
    const from = pack(a, i),
      to = pack(b, i);
    let v = acc.votes.get(from);
    if (!v) acc.votes.set(from, (v = new Map()));
    v.set(to, (v.get(to) || 0) + 1);
    acc.pixels++;
  }
  acc.frames.push([player, npc]);
}

/**
 * The swap table [[fromHex, toHex]] (majority vote per player colour; only colours the
 * NPC render changes) and how many opaque pixels it gets wrong.
 */
export function finishSwap(acc) {
  const map = new Map();
  for (const [from, votes] of acc.votes) {
    let best = from,
      n = -1;
    for (const [to, c] of votes) if (c > n || (c === n && to < best)) [best, n] = [to, c];
    if (best !== from) map.set(from, best);
  }
  let wrong = 0;
  for (const [player, npc] of acc.frames) {
    const a = player.d,
      b = npc.d;
    for (let i = 0; i < a.length; i += 4) {
      if (!a[i + 3] || !b[i + 3]) continue;
      const from = pack(a, i);
      if ((map.get(from) ?? from) !== pack(b, i)) wrong++;
    }
  }
  const table = [...map].sort((x, y) => x[0] - y[0]).map(([f, t]) => [hex(f), hex(t)]);
  return { table, wrong, pixels: acc.pixels };
}
