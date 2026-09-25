// Infantry recipes beyond the sword family: axe, armoured lance, bow, tome,
// staff, Sera, and the Swordmaster promotion.
import { arm, weapon } from './gear.mjs';
import { drawHead, drawHairBack, cord } from './build-helpers.mjs';
import { X0, S, pose3, isPlayer, LEGS } from './classes.mjs';

export const INFANTRY = {};

// Fighter — conscript from the logging camps: workwear, open vest, gloves,
// broad stance, axe head above the shoulder.
INFANTRY.fighter = {
  label: 'Fighter',
  kind: 'infantry',
  identityDefaults: { face: 'mature', hair: 'crop', headgear: 'headband', sub: 'umber' },
  draw(f, ctx) {
    const handB = pose3(ctx, [25, 29], [25, 27], [28, 27]);
    arm(f, [27, 22], [25, 26], handB, {
      tag: 'armB',
      sleeve: 'linen',
      forearm: 'skin',
      hand: 'leather',
    });
    S(f, LEGS.planted, X0, 31, { tag: 'legs' });
    S(
      f,
      [
        '..........zz.....',
        '....pPPCcppcCcp..',
        '...pPPCcccpcccfp.',
        '...pPCccccpccccf.',
        '...pPCccccpcccf..',
        '....PCccccpcccf..',
        '....PCcccqpcccf..',
        '....bLLLLyLLLLb..',
        '....uoOOOoOOOou..',
      ],
      X0,
      20,
      { tag: 'torso' },
    );
    drawHead(f, ctx.id, 29, 12);
    const grip = pose3(ctx, [38, 27], [35, 20], [42, 26]);
    weapon(f, 'axe', grip, pose3(ctx, 82, 110, 0), { tag: 'weapon', len: 14, big: true });
    arm(f, [37, 22], pose3(ctx, [39, 25], [38, 22], [40, 24]), grip, {
      tag: 'armF',
      sleeve: 'linen',
      forearm: 'skin',
      hand: 'leather',
    });
  },
};

// Knight — the empire's human wall: slab shield, rectangular plate, issue
// tabard, planted stance, upright lance. Players show the face; enemies are visored.
const GREAVES = [
  '....iMMmMMMmi....',
  '....iMmi.iMmi....',
  '....iMmi.iMmi....',
  '...iMWmi..iMmi...',
  '...iMmmi..iMWmi..',
  '...iMmi...iMmi...',
  '...iMmi...iMmi...',
  '...iMmi...iMmi...',
  '...iMWi...iMWi...',
  '...iMmi...iMmi...',
  '..iMMmi..iMMmmi..',
  '..iMmmi..iMMmmi..',
  '.iiiiii..iiiiiii.',
];
INFANTRY.knight = {
  label: 'Knight',
  kind: 'heavy',
  identityDefaults: { face: 'mature', hair: 'crop', sub: 'charcoal' },
  draw(f, ctx) {
    const helm = isPlayer(ctx) ? 'openHelm' : 'greatHelm';
    const grip = pose3(ctx, [39, 26], [39, 24], [42, 27]);
    S(f, GREAVES, X0, 31, { tag: 'legs', remap: { metal: 'armor' } });
    S(
      f,
      [
        '...iMWMi.ccc.iMMi..',
        '..iMWWMiCccciMMmi..',
        '..iMMMmiCcccimMmi..',
        '...iimiMCccfMii....',
        '....iMMCcccfMi.....',
        '....iMMCcccfMi.....',
        '....iMmCcccfmi.....',
        '....bLLLyLLLLb.....',
        '....iMCcccccfmi....',
        '...iMmCccccfmMi....',
        '...iMmCcccffmMi....',
        '....iifCccf.ii.....',
      ],
      X0,
      20,
      { tag: 'torso', remap: { metal: 'armor' } },
    );
    drawHead(f, { ...ctx.id, headgear: helm }, 29, 11);
    arm(f, [37, 22], pose3(ctx, [39, 24], [39, 23], [41, 25]), grip, {
      tag: 'armF',
      sleeve: 'armor',
      forearm: 'armor',
      hand: 'armor',
    });
    weapon(f, 'lance', grip, pose3(ctx, 90, 100, 0), {
      tag: 'weapon',
      len: ctx.pose === 'strike' ? 9 : 20,
      tail: ctx.pose === 'strike' ? 10 : 9,
    });
    // slab shield: faction field, thread (player) / iron (enemy) cross band
    S(
      f,
      [
        'iMMMMMMMi',
        'iCCccccfi',
        'iCCccccfi',
        'iCcycccfi',
        'iyygyyyji',
        'iCcycccfi',
        'iCcycccfi',
        'iCcycccfi',
        'iCcycccfi',
        '.iCcyccfi',
        '.iCcyccf.',
        '..iCyci..',
        '...iii...',
      ],
      pose3(ctx, 22, 21, 25),
      22,
      { tag: 'shield', remap: { metal: 'armor' } },
    );
  },
};

// Archer — border yeoman: weather mantle + hood (faction area), quiver mass on
// the back, a plain bow nearly as tall as the body.
INFANTRY.archer = {
  label: 'Archer',
  kind: 'infantry',
  identityDefaults: { face: 'youth', hair: 'swept', headgear: 'hood', sub: 'olive' },
  draw(f, ctx) {
    S(f, ['p.P', 'PpP', '.pP', '.bL', 'bL.', 'bL.', 'bL.', 'bl.', 'b..'], 26, 15, { tag: 'back' });
    const handB = pose3(ctx, [33, 28], [31, 24], [32, 25]);
    arm(f, [28, 22], [29, 26], handB, {
      tag: 'armB',
      sleeve: 'sub',
      forearm: 'leather',
      hand: 'skin',
    });
    S(
      f,
      [
        '......uoOOoOo....',
        '......uoOo.uOo...',
        '......uoOo.uoOo..',
        '.....uoOo..uoOo..',
        '.....uoOo...uoO..',
        '.....uoO....uoO..',
        '.....bLl....bLl..',
        '.....bLl....bLl..',
        '.....bLl....bLl..',
        '.....bLl....bLl..',
        '....bLLl...bLLl..',
        '....bbLl...bbLLl.',
        '...BbbbB...BbbbbB',
      ],
      X0,
      31,
      { tag: 'legs' },
    );
    S(
      f,
      [
        '..........zz....',
        '.....fCcccccf...',
        '....fCCccccccf..',
        '....CCccccccff..',
        '....fCcccccff...',
        '.....fcccccf....',
        '.....bLLbLLlb...',
        '.....bLLbLLlb...',
        '.....bLLLyLLb...',
        '.....bLlL.Llb...',
        '.....bl....lb...',
      ],
      X0,
      20,
      { tag: 'torso' },
    );
    cord(f, [28, 22], [34, 25], { knot: false });
    drawHead(f, ctx.id, 29, 12);
    const grip = pose3(ctx, [39, 27], [39, 25], [42, 25]);
    arm(f, [37, 22], pose3(ctx, [39, 24], [39, 23], [41, 24]), grip, {
      tag: 'armF',
      sleeve: 'sub',
      forearm: 'leather',
      hand: 'skin',
    });
    weapon(f, 'bow', grip, 0, { tag: 'weapon', len: 14, draw: ctx.pose === 'windup' ? 4 : 0 });
  },
};

// Mage — academy field caster: structured A-line coat (faction), standing
// collar, open tome with a small light. No big hat.
INFANTRY.mage = {
  label: 'Mage',
  kind: 'mage',
  identityDefaults: { face: 'soft', hair: 'bob', sub: 'charcoal' },
  draw(f, ctx) {
    drawHairBack(f, ctx.id, 29, 14);
    arm(f, [28, 24], [27, 28], [27, 31], {
      tag: 'armB',
      sleeve: 'main',
      forearm: 'main',
      hand: 'skin',
    });
    S(
      f,
      [
        '.........zz......',
        '.....uoOOuuOOo...',
        '.....fCccuuccf...',
        '....fCCcccccccf..',
        '....fCcccpcccf...',
        '....fCcccpcccf...',
        '....fCccccccff...',
        '....bLLLyLLLLb...',
        '....fCccc.cccf...',
        '...fCcccc.ccccf..',
        '...fCccc.u.cccf..',
        '...fCccc.u.cccf..',
        '..fCcccc.u.ccccf.',
        '..fCccc.uou.cccf.',
        '..fCccc.uou.cccf.',
        '.fCcccc.uou.ccccf',
        '.fCcccf.uou.fcccf',
        '.fCcccf.uou.fcccf',
        '.fccff..bLl..fccf',
        '.vfv....bLl...fvf',
        '.......BbbB.bLl..',
        '............BbbbB',
      ],
      X0,
      22,
      { tag: 'torso' },
    );
    drawHead(f, ctx.id, 29, 14);
    const grip = pose3(ctx, [39, 28], [38, 23], [43, 26]);
    arm(f, [36, 24], pose3(ctx, [38, 25], [38, 23], [40, 24]), grip, {
      tag: 'armF',
      sleeve: 'main',
      forearm: 'main',
      hand: 'skin',
    });
    weapon(f, 'tome', [grip[0], grip[1] + 1], 0, {
      tag: 'weapon',
      open: true,
      glow: true,
      cover: 'sub',
    });
  },
};

// Cleric — temple attendant: travel-worn linen vestments, faction scapular,
// plain staff with a ringed head, field satchel.
INFANTRY.cleric = {
  label: 'Cleric',
  kind: 'mage',
  identityDefaults: { face: 'soft', hair: 'long', sub: 'umber' },
  // enemy temple levies wear grey vestments so the crimson scapular carries the side
  enemyAlias: { linen: 'ash' },
  draw(f, ctx) {
    drawHairBack(f, ctx.id, 29, 14);
    arm(f, [28, 24], [27, 28], [27, 31], {
      tag: 'armB',
      sleeve: 'linen',
      forearm: 'linen',
      hand: 'skin',
    });
    S(
      f,
      [
        '.........zz......',
        '.....pPPpccPPp...',
        '.....PPPccccPp...',
        '....pPPPccccPPp..',
        '....pPPcCccfPp...',
        '....pPPcCccfPp...',
        '....pPPcCccfPp...',
        '....bLLLyLLLLb...',
        '....pPPcCccfPp...',
        '...pPPPcCccfPPp..',
        '...pPPPcCccfPPp..',
        '...pPPPcCccfPPp..',
        '..pPPPPcCccfPPPp.',
        '..pPPPPcCccfPPPp.',
        '..pPPPPcCccfPPPp.',
        '.pPPPPPcCccfPPPPp',
        '.pPPPPPfccfqPPPPp',
        '.pPPPPqq...qqPPPp',
        '.qppqq.......qqpq',
        '.......bLl..bLl..',
        '......BbbB..BbbbB',
      ],
      X0,
      22,
      { tag: 'torso' },
    );
    S(f, ['bLLl', 'bLTl', 'bLLl', '.bb.'], 25, 30, { tag: 'back' });
    drawHead(f, ctx.id, 29, 14);
    const grip = pose3(ctx, [38, 29], [37, 25], [41, 26]);
    arm(f, [36, 24], pose3(ctx, [38, 25], [38, 23], [40, 24]), grip, {
      tag: 'armF',
      sleeve: 'linen',
      forearm: 'linen',
      hand: 'skin',
    });
    weapon(f, 'staff', grip, pose3(ctx, 90, 110, 40), { tag: 'weapon', len: 16, tail: 14 });
  },
};

// Sera — Light Sage. Long red hair, plum robe under a cream mantle, a tome
// whose light is the gold thread itself.
INFANTRY.lord_sera = {
  label: 'Sera (Light Sage)',
  kind: 'mage',
  identityDefaults: {
    face: 'youth',
    hair: 'long',
    hairRamp: 'hairAuburn',
    skin: 'skinFair',
    sub: 'plum',
    linen: 'bone',
  },
  playerAlias: { main: 'plum' },
  draw(f, ctx) {
    // Sera's own long hair: a red mass falling behind the shoulders to the waist
    S(
      f,
      [
        '..hhH',
        '.hhHh',
        'hhHhh',
        'hHhhn',
        'hhhhn',
        'hhhn.',
        'hhhn.',
        'hhn..',
        'hhn..',
        'hn...',
        'hn...',
        'n....',
      ],
      24,
      20,
      { tag: 'hairBack' },
    );
    arm(f, [28, 24], [27, 28], [28, 31], {
      tag: 'armB',
      sleeve: 'linen',
      forearm: 'linen',
      hand: 'skin',
    });
    S(
      f,
      [
        '.........zz......',
        '.....pPPPPPPp....',
        '....pPXPPPPPPp...',
        '....pPPPPPPPPp...',
        '....qpPPjPPPpq...',
        '.....fCcpPcf.....',
        '.....fCcpPcf.....',
        '.....bLLyLLb.....',
        '....fCccpPccf....',
        '....fCccpPccf....',
        '...fCcccpPcccf...',
        '...fCcccpPcccf...',
        '...fCcccpPccccf..',
        '..fCccccpPcccccf.',
        '..fCccccpPcccccf.',
        '..fCccccpPcccccf.',
        '.fCccccqpPqccccf.',
        '.fCcccqpPPqpcccf.',
        '.fCccfqpPPpqfccff',
        '.vffv.qqpPqq.vff.',
        '.......BbB.bbB...',
        '......BbbB.BbbB..',
      ],
      X0,
      22,
      { tag: 'torso' },
    );
    drawHead(f, ctx.id, 29, 14);
    const grip = pose3(ctx, [39, 28], [38, 24], [42, 26]);
    arm(f, [36, 24], pose3(ctx, [38, 27], [38, 25], [40, 25]), grip, {
      tag: 'armF',
      sleeve: 'linen',
      forearm: 'linen',
      hand: 'skin',
    });
    weapon(f, 'tome', [grip[0], grip[1] + 1], 0, {
      tag: 'weapon',
      open: true,
      glow: true,
      cover: 'trim',
    });
  },
};

// Swordmaster — the Myrmidon promoted: same person, same stance family; a
// split coat edged in thread, a longer blade, a lower guard.
INFANTRY.swordmaster = {
  label: 'Swordmaster',
  kind: 'infantry',
  identityDefaults: { face: 'youth', hair: 'ponytail', headgear: 'headband', sub: 'charcoal' },
  draw(f, ctx) {
    drawHairBack(f, ctx.id, 29, 12);
    const handB = pose3(ctx, [35, 28], [34, 22], [38, 26]);
    arm(f, [29, 22], [31, 26], handB, {
      tag: 'armB',
      sleeve: 'main',
      forearm: 'main',
      hand: 'skin',
    });
    S(f, LEGS.hakama, X0, 29, { tag: 'legs' });
    S(
      f,
      [
        '.....fCcc....cccf.',
        '....fCccf....fccfy',
        '....fCccf.....fcfy',
        '...fCccf......fccy',
        '...fCccf.......fcy',
        '...fCcf........fcy',
        '..ygjy..........yj',
      ],
      X0,
      30,
      { tag: 'sway' },
    );
    S(
      f,
      [
        '..........zz....',
        '.....yfCcpPcfy..',
        '.....yCCccpPcfy.',
        '.....yCFcccpcfy.',
        '.....yfCcccccfy.',
        '......yCcccccy..',
        '......yCcccccy..',
        '.......uoOOOu...',
        '......fuoOOOuf..',
        '.....fCcc...ccf.',
      ],
      X0,
      20,
      { tag: 'torso' },
    );
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
      forearm: 'main',
      hand: 'skin',
    });
    weapon(f, 'longsword', grip, pose3(ctx, 62, 100, 5), { tag: 'weapon', len: 16 });
  },
};
