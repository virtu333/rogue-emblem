// Head library — hand-authored, fill-only (the outline is generated).
// All parts share an 8x9 local box whose origin is the rig's head socket
// (standing infantry: x=29, y=12). 3/4 view facing right: face lower-right,
// hair covers the top and back. Row 8 is the neck (cols 3-4 -> x=32,33).
// Head = 8 rows on a ~32px figure: about four heads tall, which is what the
// approved rebuilt Edric/Sera measure at map size.
//
// Identity = face x hair style x hair ramp x skin ramp x headgear x beard.

export const FACES = {
  // two-pixel eyes: the anime-flair default for younger recruits and lords
  youth: [
    '........',
    '..sSS...',
    '.sQSSS..',
    'zsQSSSS.',
    'zsSeSSe.',
    'zsSeSSeS',
    '.zsSSSz.',
    '..zzSz..',
    '...zz...',
  ],
  // one-pixel eyes under a brow shadow, squarer jaw: veterans
  mature: [
    '........',
    '..sSS...',
    '.sQSSS..',
    'zsSzSSz.',
    'zsSeSSe.',
    'zsSSSSSS',
    'zzsSSSz.',
    '.zzsSz..',
    '...zz...',
  ],
  // rounder cheek, softer chin
  soft: [
    '........',
    '..sSS...',
    '.sQSSS..',
    'zsQSSSS.',
    'zsSeSSe.',
    'zsSeSSeS',
    'zssSSSz.',
    '.zzsSz..',
    '...zz...',
  ],
};

// Hair: `front` goes over the face, `back` is drawn behind the body (long hair,
// tails, buns) at an optional (backDx, backDy) offset.
export const HAIR = {
  swept: {
    front: ['..hHHh..', '.hHYYHh.', 'hHYHHhHh', 'hhhHhh.h', 'hhn.....', 'hn......', 'n.......'],
  },
  spiky: { front: ['.h.hh.h.', 'hHhHHhHh', 'hYYHHhHh', 'hhHhhhnh', 'hhn...n.', 'hn......'] },
  crop: { front: ['........', '..hHHh..', '.hHYYHh.', 'hHhhhh..', 'hn......', 'n.......'] },
  shaved: { front: ['........', '........', '..nhhn..', '.nhhn...', 'nn......'] },
  long: {
    front: [
      '..hHHh..',
      '.hHYYHh.',
      'hHYHHhHh',
      'hhHhhh.h',
      'hhhn....',
      'hhhn....',
      'hhhn....',
      'hhn.....',
      '.hn.....',
    ],
    back: [
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      'hhn.....',
      'hhn.....',
      'hn......',
      'n.......',
    ],
  },
  ponytail: {
    front: ['..hHHh..', '.hHYYHh.', 'hHYHHhHh', 'hhhHhh.h', 'hhn.....', 'hn......'],
    back: ['........', 'hh......', 'hHh.....', '.hHh....', '..hHh...', '...hh...', '....n...'],
    backDx: -3,
  },
  bob: {
    front: [
      '..hHHh..',
      '.hHYYHh.',
      'hHYHHhHh',
      'hhHhhhhh',
      'hhhn..h.',
      'hhhn....',
      'hhn.....',
      '.n......',
    ],
  },
  bun: {
    front: ['..hHHh..', '.hHYYHh.', 'hHYHHhHh', 'hhhhhh.h', 'hhn.....', '.n......'],
    back: ['.hH.....', 'hHYh....', 'hhh.....'],
    backDy: -2,
    backDx: -1,
  },
  shag: {
    front: ['.hhHh...', 'hHYYHhh.', 'hYHHhHhh', 'hhHhhhnh', 'hhhnh.n.', 'hhn.....', 'hn......'],
  },
};

export const BEARDS = {
  none: null,
  stubble: [null, null, null, null, null, null, '...zz.z.', '..zzzz..'],
  full: [null, null, null, null, null, '......n.', '..nhhhn.', '..nhhn..', '...nn...'],
};

// Headgear. `clearRows` wipes that many rows of hair first (helmets sit on the
// skull; hair only survives below them). `faceShade` darkens the face rows a
// brim/hood shadows (key light is upper-left). Helmet art uses the metal slot;
// recipes remap it to `armor` (plate ramp) so it follows the faction treatment.
export const HEADGEAR = {
  none: null,
  headband: { rows: ['........', '........', 'oOOOOOo.', 'o.......', 'u.......'], dx: -1 },
  headbandMain: { rows: ['........', '........', 'cCCCCCc.', 'c.......', 'f.......'], dx: -1 },
  circlet: { rows: ['........', '........', '.jygGyj.'] },
  hood: {
    clearRows: 4,
    rows: [
      '..fcCc..',
      '.fcCCcc.',
      'fcCCccCc',
      'fcCcccc.',
      'fcc.....',
      'fc......',
      'fc......',
      '.f......',
    ],
    faceShade: [3, 4],
  },
  hoodSub: {
    clearRows: 4,
    rows: [
      '..uoOo..',
      '.uoOOoo.',
      'uoOOooOo',
      'uoOoooo.',
      'uoo.....',
      'uo......',
      'uo......',
      '.u......',
    ],
    faceShade: [3, 4],
  },
  veil: {
    clearRows: 4,
    rows: [
      '..pPPp..',
      '.pPXXPp.',
      'pPXPPPPp',
      'pPjyjPP.',
      'pPp.....',
      'pPp.....',
      'pPp.....',
      'qpP.....',
      'qpp.....',
      '.qp.....',
    ],
  },
  openHelm: {
    clearRows: 3,
    rows: ['..iMMi..', '.iMWWMi.', 'iMWMMMMi', 'iMMm.mM.', 'iMm.....', 'im......'],
  },
  greatHelm: {
    clearRows: 8,
    rows: [
      '..iMMi..',
      '.iMWWMi.',
      'iMWMMMMi',
      'iMMMmmmm',
      'iMMmIIIm',
      'iMMMmmmi',
      '.iMMMMi.',
      '..immi..',
    ],
  },
  kettle: {
    clearRows: 3,
    rows: ['........', '..iMMi..', '.iMWWMi.', 'iiMMMMii'],
    faceShade: [4],
  },
};
