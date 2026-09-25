// sigil — Direction C, "Reliquary sigils": the same item geometry as the pixel
// grammar, rendered as flat-faceted vector engravings on a category plaque (the
// class-crest language of src/ui/crestArt.js). Every material except the
// "accent" (gem, liquid, element) is struck in one engraving metal, so the set
// reads as one reliquary: metal + a single colour. Pure string building.
import { MATERIALS } from './palette.mjs';

const INK = '#0e0c14';
const ACCENTS = new Set([
  'blood',
  'verdigris',
  'sky',
  'unlight',
  'lilac',
  'rose',
  'pearl',
  'leaf',
  'ember',
  'steel',
  'earth',
  'slate',
]);
const LIGHT = [-0.62, -0.78];

const f = (n) => Math.round(n * 100) / 100;

function shapePath(sh) {
  switch (sh.kind) {
    case 'poly':
      return `M${sh.pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
    case 'rect':
      return `M${f(sh.x)} ${f(sh.y)}h${f(sh.w)}v${f(sh.h)}h${f(-sh.w)}Z`;
    case 'circle':
      return `M${f(sh.cx - sh.r)} ${f(sh.cy)}a${f(sh.r)} ${f(sh.r)} 0 1 0 ${f(2 * sh.r)} 0a${f(sh.r)} ${f(sh.r)} 0 1 0 ${f(-2 * sh.r)} 0Z`;
    case 'ellipse': {
      const pts = [];
      const rot = ((sh.rot || 0) * Math.PI) / 180;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const x = Math.cos(a) * sh.rx;
        const y = Math.sin(a) * sh.ry;
        pts.push([
          sh.cx + x * Math.cos(rot) - y * Math.sin(rot),
          sh.cy + x * Math.sin(rot) + y * Math.cos(rot),
        ]);
      }
      return shapePath({ kind: 'poly', pts });
    }
    case 'capsule': {
      const [ax, ay] = sh.a;
      const [bx, by] = sh.b;
      const l = Math.hypot(bx - ax, by - ay) || 1e-6;
      const nx = (-(by - ay) / l) * sh.r;
      const ny = ((bx - ax) / l) * sh.r;
      return `M${f(ax + nx)} ${f(ay + ny)}L${f(bx + nx)} ${f(by + ny)}A${f(sh.r)} ${f(sh.r)} 0 0 0 ${f(bx - nx)} ${f(by - ny)}L${f(ax - nx)} ${f(ay - ny)}A${f(sh.r)} ${f(sh.r)} 0 0 0 ${f(ax + nx)} ${f(ay + ny)}Z`;
    }
    case 'ring':
      return `${shapePath({ kind: 'circle', cx: sh.cx, cy: sh.cy, r: sh.r1 })}${shapePath({ kind: 'circle', cx: sh.cx, cy: sh.cy, r: sh.r0 })}`;
    case 'arc': {
      const pts = [];
      const tau = Math.PI * 2;
      const span = (((sh.a1 - sh.a0) % tau) + tau) % tau || tau;
      const N = 24;
      for (let i = 0; i <= N; i++) {
        const a = sh.a0 + (span * i) / N;
        pts.push([
          sh.cx + Math.cos(a) * (sh.r + sh.w / 2),
          sh.cy + Math.sin(a) * (sh.r + sh.w / 2),
        ]);
      }
      for (let i = N; i >= 0; i--) {
        const a = sh.a0 + (span * i) / N;
        pts.push([
          sh.cx + Math.cos(a) * (sh.r - sh.w / 2),
          sh.cy + Math.sin(a) * (sh.r - sh.w / 2),
        ]);
      }
      return shapePath({ kind: 'poly', pts });
    }
    default:
      return '';
  }
}

function bbox(sh) {
  const d = shapePath(sh);
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  // Rough: path numbers alternate x/y except arc flags; fine for centroids.
  const xs = [];
  const ys = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push(nums[i]);
    ys.push(nums[i + 1]);
  }
  const c =
    sh.cx != null
      ? [sh.cx, sh.cy]
      : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return c;
}

const PLAQUES = {
  weapon: 'M16 1.5L28.5 5v11.5c0 7-6 11.8-12.5 14-6.5-2.2-12.5-7-12.5-14V5Z',
  supply: 'M16 1.5a14.5 14.5 0 1 0 0.01 0Z',
  accessory: 'M16 1L31 16 16 31 1 16Z',
  forge: 'M10 1.5h12l8.5 8.5v12l-8.5 8.5H10l-8.5-8.5V10Z',
  blessing: 'M16 1.5a14.5 14.5 0 1 0 0.01 0Z',
  upgrade: 'M3 2h26v22l-13 6.5L3 24Z',
};

const TIER_RIM = {
  Iron: '#7a7a80',
  Steel: '#77a5c6',
  Silver: '#ddd0bd',
  Legend: '#f3cb6c',
  Rare: '#a863cc',
  none: '#b3702c',
};

/**
 * @param {{parts: object[]}} spec pixel-grammar spec
 * @param {{plaque?: string, tier?: string, metal?: string, id?: string}} o
 */
export function sigilSvg(
  spec,
  { plaque = 'weapon', tier = 'none', metal = 'gilt', id = 's' } = {},
) {
  const metalRamp = MATERIALS[metal];
  const defs = [];
  const under = [];
  const over = [];
  spec.parts.forEach((p, i) => {
    const matName = typeof p.mat === 'string' ? p.mat : null;
    const ramp = matName && ACCENTS.has(matName) ? MATERIALS[matName] : metalRamp;
    const d = shapePath(p.shape);
    const clip = `${id}c${i}`;
    defs.push(
      `<clipPath id="${clip}"><path d="${d}" clip-rule="evenodd" fill-rule="evenodd"/></clipPath>`,
    );
    // Holes cut through the whole part (stroke included) via a mask.
    let mask = '';
    if (p.holes?.length) {
      defs.push(
        `<mask id="${id}m${i}" maskUnits="userSpaceOnUse" x="-8" y="-8" width="48" height="48"><rect x="-8" y="-8" width="48" height="48" fill="#fff"/>${p.holes.map((h) => `<path d="${shapePath(h)}" fill="#000"/>`).join('')}</mask>`,
      );
      mask = ` mask="url(#${id}m${i})"`;
    }
    under.push(
      `<path d="${d}" fill-rule="evenodd" fill="${INK}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round"${mask}/>`,
    );
    const shade = p.shade || 'dome';
    const g = [];
    if (p.level != null) {
      g.push(
        `<path d="${d}" fill-rule="evenodd" fill="${ramp[Math.max(1, Math.min(4, p.level))]}"/>`,
      );
    } else if (shade === 'ridge' || shade === 'cyl') {
      // Two facets split along the spine: the half facing the light is lit.
      const sh = p.shape;
      const axis =
        p.axis || (sh.kind === 'capsule' ? [sh.b[0] - sh.a[0], sh.b[1] - sh.a[1]] : [0, 1]);
      const al = Math.hypot(...axis) || 1;
      const u = [axis[0] / al, axis[1] / al];
      const v = [-u[1], u[0]];
      const c = p.spine0 || p.centre || bbox(sh);
      const s = v[0] * LIGHT[0] + v[1] * LIGHT[1] > 0 ? 1 : -1;
      const far = 60;
      const q = [
        [c[0] - u[0] * far, c[1] - u[1] * far],
        [c[0] + u[0] * far, c[1] + u[1] * far],
        [c[0] + u[0] * far + v[0] * s * far, c[1] + u[1] * far + v[1] * s * far],
        [c[0] - u[0] * far + v[0] * s * far, c[1] - u[1] * far + v[1] * s * far],
      ];
      g.push(`<path d="${d}" fill-rule="evenodd" fill="${ramp[shade === 'cyl' ? 2 : 1]}"/>`);
      g.push(`<path d="${shapePath({ kind: 'poly', pts: q })}" fill="${ramp[3]}"/>`);
    } else if (shade === 'sphere') {
      const sh = p.shape;
      const r = sh.r || sh.rx || 3;
      const c = [sh.cx, sh.cy];
      g.push(`<path d="${d}" fill-rule="evenodd" fill="${ramp[1]}"/>`);
      g.push(
        `<circle cx="${f(c[0] - r * 0.22)}" cy="${f(c[1] - r * 0.22)}" r="${f(r * 0.78)}" fill="${ramp[2]}"/>`,
      );
      g.push(
        `<circle cx="${f(c[0] - r * 0.38)}" cy="${f(c[1] - r * 0.38)}" r="${f(r * 0.28)}" fill="${ramp[4]}"/>`,
      );
    } else {
      // Bevel facets: dark base, lit copy nudged toward the light, mid face inset.
      const c = bbox(p.shape);
      g.push(`<path d="${d}" fill-rule="evenodd" fill="${ramp[1]}"/>`);
      g.push(
        `<path d="${d}" fill-rule="evenodd" fill="${ramp[3]}" transform="translate(-0.8 -0.8)"/>`,
      );
      g.push(
        `<path d="${d}" fill-rule="evenodd" fill="${ramp[2]}" transform="translate(${f(c[0] * 0.16)} ${f(c[1] * 0.16)}) scale(0.84)"/>`,
      );
    }
    over.push(`<g${mask}><g clip-path="url(#${clip})">${g.join('')}</g></g>`);
  });
  const rim = TIER_RIM[tier] || TIER_RIM.none;
  const plq = PLAQUES[plaque] || PLAQUES.weapon;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs>${defs.join('')}<linearGradient id="${id}pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2e293a"/><stop offset="1" stop-color="#110f18"/></linearGradient></defs>
<path d="${plq}" fill="url(#${id}pg)" stroke="${INK}" stroke-width="1.2"/>
<path d="${plq}" fill="none" stroke="${rim}" stroke-width="0.7" transform="translate(1.6 1.6) scale(0.9)" opacity="0.9"/>
<g transform="translate(5.6 5.6) scale(0.65)">${under.join('')}${over.join('')}</g></svg>`;
}
