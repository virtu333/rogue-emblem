// Presentation only: terrain IDs, passability, spawn cells and RNG are never changed.
export const WEATHERED_TILE_SIZE = 48;
export const WEATHERED_TERRAINS = new Set([
  'Ice',
  'Lava Crack',
  'Swamp',
  'Bog',
  'Acidic Swamp',
  'Acidic Bog',
  'Plain',
  'Forest',
  'Mountain',
  'Water',
  'River',
  'Bridge',
  'Fort',
  'Wall',
  'Floor',
  'Sand',
  'Village',
  'Ballista',
  'Throne',
  'Pillar',
]);
export async function loadWeatheredArt(base) {
  const entries = await Promise.all(
    [
      'meadow-weathered',
      'structures-weathered',
      'fort-compact',
      'hazards-weathered',
      'meadow-tundra',
      'meadow-volcano',
    ].map(
      (name) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve([name, image]);
          image.onerror = () => reject(new Error(`Could not load weathered terrain: ${name}`));
          image.src = `${base}/${name}.png`;
        }),
    ),
  );
  return Object.fromEntries(entries);
}
export function neighborMask(at, x, y, accepts) {
  return [
    [0, -1, 1],
    [1, 0, 2],
    [0, 1, 4],
    [-1, 0, 8],
  ].reduce((mask, [dx, dy, bit]) => mask | (accepts(at(x + dx, y + dy)) ? bit : 0), 0);
}
export function drawWeatheredTile(ctx, art, at, x, y, options = {}) {
  const name = at(x, y),
    size = WEATHERED_TILE_SIZE;
  if (!WEATHERED_TERRAINS.has(name)) return false;
  ctx.imageSmoothingEnabled = false;
  const stamp = (sheet, index, columns = 4, rows = 4) => {
    const img = art[sheet],
      w = img.width / columns,
      h = img.height / rows;
    ctx.drawImage(
      img,
      (index % columns) * w,
      Math.floor(index / columns) * h,
      w,
      h,
      0,
      0,
      size,
      size,
    );
  };
  const biomeSheet = ['tundra', 'volcano'].includes(options.biome)
    ? `meadow-${options.biome}`
    : 'meadow-weathered';
  const meadow = (i) => stamp(art[biomeSheet] ? biomeSheet : 'meadow-weathered', i);
  const box = (color, a, b, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(a, b, w, h);
  };
  const hazardIndex = {
    Ice: 0,
    'Lava Crack': 1,
    Swamp: 2,
    Bog: 3,
    'Acidic Swamp': 4,
    'Acidic Bog': 5,
  }[name];
  if (hazardIndex !== undefined) {
    if (!art['hazards-weathered']) return false;
    stamp('hazards-weathered', hazardIndex, 3, 2);
    return true;
  }
  if (['Water', 'River'].includes(name)) {
    const bits =
      options.banks === false
        ? 0
        : neighborMask(at, x, y, (n) => n && !['Water', 'River', 'Bridge'].includes(n));
    const lookup = { 0: 4, 1: 5, 2: 6, 4: 7, 8: 8, 3: 9, 6: 10, 12: 11, 9: 12 };
    if (bits in lookup) meadow(lookup[bits]);
    else {
      meadow(4);
      for (const [bit, index, rect] of [
        [1, 5, [0, 0, 48, 12]],
        [2, 6, [36, 0, 12, 48]],
        [4, 7, [0, 36, 48, 12]],
        [8, 8, [0, 0, 12, 48]],
      ]) {
        if (!(bits & bit)) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(...rect);
        ctx.clip();
        meadow(index);
        ctx.restore();
      }
    }
    return true;
  }
  if (name === 'Bridge') {
    meadow(4);
    // Connected decks: no repeated end posts or internal rails in a multi-cell span.
    const bits = neighborMask(at, x, y, (n) => n === 'Bridge');
    const waterNS =
      ['Water', 'River'].includes(at(x, y - 1)) || ['Water', 'River'].includes(at(x, y + 1));
    const horizontal = (bits & 10) !== 0 || (!(bits & 5) && waterNS);
    ctx.save();
    if (!horizontal) {
      ctx.translate(48, 0);
      ctx.rotate(Math.PI / 2);
    }
    const north = horizontal ? bits & 1 : bits & 8,
      south = horizontal ? bits & 4 : bits & 2;
    const top = north ? 0 : 10,
      bottom = south ? 48 : 38;
    box('#403d36', 0, top, 48, bottom - top);
    for (let col = 0; col < 48; col += 6) {
      box('#8b7155', col + 1, top + 1, 5, bottom - top - 2);
      box('#ad9270', col + 1, top + 1, 1, bottom - top - 2);
    }
    if (!north) {
      box('#453b31', 0, 8, 48, 4);
      box('#b09a76', 0, 8, 48, 1);
    }
    if (!south) {
      box('#453b31', 0, 36, 48, 4);
      box('#a18a67', 0, 36, 48, 1);
    }
    ctx.restore();
    return true;
  }
  if (name === 'Wall') {
    const bits = neighborMask(at, x, y, (n) => n === 'Wall');
    // Full-cell solid masonry. Adjacent blocks share their surface, while only
    // exposed sides receive a bevel/face. No grass is painted on blocked cells.
    box('#555951', 0, 0, 48, 48);
    const left = bits & 8 ? 0 : 3,
      right = bits & 2 ? 48 : 45;
    const top = bits & 1 ? 0 : 3,
      bottom = bits & 4 ? 48 : 41;
    for (let b = top; b < bottom; b++)
      for (let a = left; a < right; a++) {
        const gy = y * 48 + b,
          gx = x * 48 + a;
        const joint = gy % 8 === 0 || (gx + (Math.floor(gy / 8) % 2) * 8) % 16 === 0;
        box(
          joint
            ? '#727569'
            : (Math.floor(gx / 16) + Math.floor(gy / 8)) % 3 === 0
              ? '#a3a48f'
              : '#b0ad97',
          a,
          b,
          1,
          1,
        );
      }
    if (!(bits & 1)) box('#d0c9aa', left, 1, right - left, 2);
    if (!(bits & 8)) box('#c2bda4', 1, top, 2, bottom - top);
    if (!(bits & 2)) box('#666b60', 45, top, 3, bottom - top);
    if (!(bits & 4)) {
      box('#898b7a', left, 41, right - left, 5);
      for (let a = left; a < right; a += 12) box('#575d54', a, 42, 1, 4);
      box('#414b43', 0, 46, 48, 2);
    }
    // Isolated blocks read as low ruined piers; connected walls stay continuous.
    if (bits === 0) {
      box('#777d70', 10, 10, 28, 1);
      box('#777d70', 10, 10, 1, 20);
    }
    return true;
  }
  if (name === 'Fort') {
    meadow(0);
    ctx.drawImage(art['fort-compact'], 0, 0, size, size);
    return true;
  }
  const index = { Plain: (x * 31 + y * 17) % 19 === 0 ? 1 : 0, Forest: 2, Mountain: 3 }[name];
  if (index !== undefined) meadow(index);
  else
    stamp(
      'structures-weathered',
      { Sand: 0, Village: 2, Ballista: 3, Floor: 4, Throne: 11, Pillar: 15 }[name],
    );
  return true;
}
