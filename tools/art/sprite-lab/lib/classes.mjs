// Class recipes. Each recipe draws a class onto a Figure from:
//   - hand-authored body parts (legs, torsos, cloaks, shields, mounts) in
//     absolute 64x64 rig coordinates (feet on y=43, texture centre x=32);
//   - the unit's identity head (face/hair/headgear from heads.mjs);
//   - parametric arms and weapons (gear.mjs) whose sockets depend on pose.
// Slots: `main` is the faction area, `trim` the gold thread (player) / iron
// (enemy), `armor` plate, `metal` blades, `sub` identity cloth.
import { arm, weapon } from './gear.mjs';
import { drawHead, drawHairBack, cord } from './build-helpers.mjs';

export const X0 = 22;
export const S = (f, rows, x, y, opts = {}) => f.stamp(rows, x, y, opts);
export const pose3 = (ctx, idle, windup, strike) =>
  ctx.pose === 'strike' ? strike : ctx.pose === 'windup' ? windup : idle;
export const isPlayer = (ctx) => ctx.faction === 'player';

// ---------------------------------------------------------------- legs ----
export const LEGS = {
  stride: [
    '......uoOOoOOo....',
    '......uoOo.uoOo...',
    '.....uoOo...uoOo..',
    '.....uoOo...uoOo..',
    '.....uoO.....uoO..',
    '....uoOo.....uoOo.',
    '....uoO.......uoO.',
    '....bLl.......bLl.',
    '....bLl.......bLl.',
    '...bLLl.......bLLl',
    '...bLl........bLl.',
    '..bbLl.......bbLLl',
    '.BbbbB.......BbbbbB',
  ], // y31
  planted: [
    '.....uoOOOoOOo...',
    '.....uoOo.uoOo...',
    '.....uoOo..uoOo..',
    '....uoOo...uoOo..',
    '....uoOo...uoOo..',
    '....uoO.....uoO..',
    '....bLl.....bLl..',
    '....bLl.....bLl..',
    '....bLL.....bLL..',
    '....bLl.....bLl..',
    '...bLLl....bLLl..',
    '...bbLl....bbLLl.',
    '..BbbbB....BbbbbB',
  ], // y31
  hakama: [
    '......uoOOOOo....',
    '......uoOOoOOo...',
    '.....uoOOo.uOOo..',
    '.....uoOo...uOOo.',
    '.....uoOo...uoOo.',
    '....uoOOo...uoOo.',
    '....uoOo....uoOOo',
    '....uoOo.....uoOo',
    '...uoOOo.....uoOo',
    '...uuooo.....uuoo',
    '....pP........pP.',
    '....pP........pP.',
    '....qp........qp.',
    '...blL.......blLl',
    '..BbbB.......BbbbB',
  ], // y29
  crouch: [
    '.....uoOOOoOOOo....',
    '....uoOo...uoOOOo..',
    '....uoOo.....uoOOo.',
    '...uoOo.......uoOo.',
    '...uoOo.......bLl..',
    '..uoOo........bLl..',
    '..bLl.........bLl..',
    '.bLl..........bLl..',
    '.bLl.........bbLl..',
    'bLLl.........bLLLl.',
    'BbbB........BbbbbB.',
  ], // y33
};

// ------------------------------------------------------------- recipes ----
export const CLASSES = {};

// Edric — Lord. Lightly equipped: teal tunic and cloak, leather, plain sword.
CLASSES.lord_edric = {
  label: 'Edric (Lord)',
  kind: 'infantry',
  identityDefaults: {
    face: 'youth',
    hair: 'swept',
    hairRamp: 'hairBrown',
    skin: 'skinWarm',
    sub: 'umber',
    headgear: 'none',
  },
  playerAlias: { main: 'teal' },
  draw(f, ctx) {
    const cloak = [
      '......vfc.',
      '.....vfcCc',
      '....vfcCcc',
      '...vfcCccf',
      '...fcCccf.',
      '..vfcCcf..',
      '..fcCccf..',
      '.vfcCcf...',
      '.fcCccf...',
      '.fcCccf...',
      'vfcCcf....',
      'vfcCcf....',
      'fcCccf....',
      'fcCcf.....',
      'fcCf.f....',
      'vc...f....',
    ];
    S(f, cloak.slice(0, 9), X0, 21, { tag: 'cloakTop' });
    S(f, cloak.slice(9), X0, 30, { tag: 'sway' });
    const hand = pose3(ctx, [26, 29], [25, 26], [27, 28]);
    arm(f, [28, 22], [26, 26], hand, {
      tag: 'armB',
      sleeve: 'main',
      forearm: 'leather',
      hand: 'leather',
    });
    S(f, LEGS.stride, X0, 31, { tag: 'legs' });
    S(
      f,
      [
        '..........zz....',
        '.....fCCcuucccf.',
        '.....CCFccccccff',
        '.....CCcccfcccff',
        '.....fCcccfcccf.',
        '......Cccfcccf..',
        '......Cccfcccf..',
        '......fCcfcccf..',
        '......bLLLyLLlb.',
        '......Cccfcccf..',
        '.....fCcc.cccff.',
        '.....fCc...ccf..',
        '.....vff....fv..',
      ],
      X0,
      20,
      { tag: 'torso' },
    );
    cord(f, [36, 22], [30, 27]);
    drawHead(f, ctx.id, 29, 12);
    const grip = pose3(ctx, [39, 28], [36, 21], [40, 26]);
    const elbow = pose3(ctx, [38, 25], [39, 23], [40, 24]);
    arm(f, [37, 22], elbow, grip, {
      tag: 'armF',
      sleeve: 'main',
      forearm: 'leather',
      hand: 'leather',
    });
    weapon(f, 'sword', grip, pose3(ctx, -35, 115, -8), { tag: 'weapon', len: 10 });
  },
};

// Myrmidon — narrow upright unarmoured wrap; slender raised blade, tip near the head.
CLASSES.myrmidon = {
  label: 'Myrmidon',
  kind: 'infantry',
  identityDefaults: { face: 'youth', hair: 'ponytail', headgear: 'headband', sub: 'charcoal' },
  draw(f, ctx) {
    drawHairBack(f, ctx.id, 29, 12);
    const handB = pose3(ctx, [35, 28], [34, 22], [38, 26]);
    arm(f, [29, 22], [31, 26], handB, { tag: 'armB', sleeve: 'main', forearm: 'skin' });
    S(f, LEGS.hakama, X0, 29, { tag: 'legs' });
    S(
      f,
      [
        '..........zz....',
        '......fCcpPcf...',
        '......CCccpPcf..',
        '......CFcccpcf..',
        '......fCccccff..',
        '.......Ccccf....',
        '.......Ccccf....',
        '.......uoOOOu...',
        '.......uoOOOu...',
      ],
      X0,
      20,
      { tag: 'torso' },
    );
    // sash knot: the gold thread on a player, a plain knot on an enemy
    S(f, ['yG', '.y', '.j'], 35, 27, {
      tag: 'cord',
      casts: false,
      remap: isPlayer(ctx) ? {} : { trim: 'sub' },
    });
    drawHead(f, ctx.id, 29, 12);
    const grip = pose3(ctx, [37, 27], [35, 21], [39, 25]);
    arm(f, [35, 22], pose3(ctx, [37, 25], [37, 22], [39, 23]), grip, {
      tag: 'armF',
      sleeve: 'main',
      forearm: 'skin',
    });
    weapon(f, 'longsword', grip, pose3(ctx, 72, 100, 5), { tag: 'weapon' });
  },
};

// Mercenary — broad square shoulders, short tabard, wide blade over the shoulder.
CLASSES.mercenary = {
  label: 'Mercenary',
  kind: 'infantry',
  identityDefaults: { face: 'mature', hair: 'shag', beard: 'stubble', sub: 'olive' },
  draw(f, ctx) {
    const handB = pose3(ctx, [25, 29], [25, 28], [28, 28]);
    S(f, LEGS.planted, X0, 31, { tag: 'legs' });
    S(
      f,
      [
        '..........zz.....',
        '....mMMiiiMMm....',
        '...iMMCCcccfmi...',
        '...iMMCFcccfmi...',
        '...iMMCcccffm....',
        '....iMCccccfi....',
        '....iMCcccfmi....',
        '....bLLLyLLLLb...',
        '....iMCcccfmi....',
        '.....iCcccfi.....',
        '.....fCcccff.....',
        '......fCcff......',
      ],
      X0,
      20,
      { tag: 'torso', remap: { metal: 'armor' } },
    );
    cord(f, [29, 22], [34, 27]);
    arm(f, [27, 22], [25, 26], handB, {
      tag: 'armB',
      sleeve: 'sub',
      forearm: 'leather',
      hand: 'leather',
    });
    // Broad blade carried across the shoulders: hilt at the near shoulder, the
    // flat running back behind the head — a horizontal mass no other sword class has.
    const handF = pose3(ctx, [38, 21], [36, 18], [40, 25]);
    if (ctx.pose === 'idle') weapon(f, 'broadsword', handF, 164, { tag: 'weapon', len: 15 });
    drawHead(f, ctx.id, 29, 12);
    S(f, ['.iMWi', 'iMWMMi', 'iMMmi.', '.iii..'], 35, 20, {
      tag: 'armF',
      remap: { metal: 'armor' },
    });
    arm(f, [37, 23], pose3(ctx, [40, 25], [39, 22], [41, 24]), handF, {
      tag: 'armF',
      sleeve: 'sub',
      forearm: 'leather',
      hand: 'leather',
    });
    if (ctx.pose !== 'idle')
      weapon(f, 'broadsword', handF, pose3(ctx, 0, 115, -8), {
        tag: 'weapon',
        len: pose3(ctx, 13, 13, 11),
      });
  },
};

// Thief — low forward crouch, compact hood, short reversed blade held low.
CLASSES.thief = {
  label: 'Thief',
  kind: 'infantry',
  identityDefaults: { face: 'youth', hair: 'crop', headgear: 'hood', sub: 'ash' },
  draw(f, ctx) {
    const handB = pose3(ctx, [27, 33], [26, 31], [29, 32]);
    arm(f, [30, 27], [27, 30], handB, {
      tag: 'armB',
      sleeve: 'sub',
      forearm: 'sub',
      hand: 'leather',
    });
    S(f, LEGS.crouch, X0, 33, { tag: 'legs' });
    S(
      f,
      [
        '........fCccf......',
        '.......fCccccff....',
        '.......CCcccccf....',
        '......uCccccccfu...',
        '......uoCcccccou...',
        '.....uoOOcccfOOo...',
        '.....uoOo.bLb.oOo..',
        '....uoOo......uoo..',
      ],
      X0,
      26,
      { tag: 'torso' },
    );
    drawHead(f, ctx.id, 31, 18);
    const grip = pose3(ctx, [40, 33], [38, 27], [44, 31]);
    arm(f, [37, 28], pose3(ctx, [39, 31], [40, 29], [41, 30]), grip, {
      tag: 'armF',
      sleeve: 'sub',
      forearm: 'sub',
      hand: 'leather',
    });
    weapon(f, 'dagger', grip, pose3(ctx, -100, 140, 0), { tag: 'weapon' });
  },
};
