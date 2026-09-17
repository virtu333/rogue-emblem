// Camera composition only; no movement or battle rules.
export function deploymentFrame(points, { width, height, tileSize, cssHeight, minZoom, maxZoom }) {
  const tactical = Math.min(maxZoom, Math.max(minZoom, (34 * height) / (cssHeight * tileSize)));
  if (!points.length) return null;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs);
  const top = Math.min(...ys),
    bottom = Math.max(...ys);
  // Two tiles of breathing room around the deployment for silhouettes and approach.
  const fit = Math.min(
    width / (right - left + tileSize * 4),
    height / (bottom - top + tileSize * 4),
  );
  const readable = Math.max(minZoom, (30 * height) / (cssHeight * tileSize));
  if (fit < readable) return { ...points[0], zoom: tactical, wholeParty: false };
  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    zoom: Math.min(tactical, fit),
    wholeParty: true,
  };
}
