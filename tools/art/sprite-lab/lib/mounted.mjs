// Mounted recipes: Cavalier (horse) and Pegasus Knight. Mount art is hand-authored
// in the `mount` (body) and `mane` slots, so a bay / grey / black horse or a
// white pegasus is a ramp swap. Saddle cloth + pennant carry the faction area.
import { arm, weapon } from './gear.mjs';
import { drawHead, cord } from './build-helpers.mjs';
import { S, pose3 } from './classes.mjs';

export const MOUNTED = {};

// Horse, profile facing right, origin x=10. Rows from y=12.
const HORSE = [
  '..................................78.....',
  '.................................&78.....',
  '................................&%8887...',
  '...............................&%788889..',
  '..............................&%7788e89..',
  '.............................&%77788888..',
  '............................&%777788889.',
  '...........................&%7777.678889',
  '..........................&%77777..67888',
  '.........................&%777777...6776',
  '........................&%7777777....55.',
  '.....6777..............%77777778........',
  '...67888877777777777777877777778........',
  '..678888888888888888888887777788........',
  '.6788888988888888888888887777788........',
  '.6788888888888888888888888777788........',
  '.6788888888888888888888888777788........',
  '.6778888888888888888888887777788........',
  '..67788888888888888888887777778.........',
  '..6677788888888888888877777777..........',
  '...666777777777888777777776677..........',
  '...67777.56........56...6778............',
  '....6777.56........56...6778............',
  '....677..56........56...677.............',
  '.....677.56........56...677.............',
  '.....67..56........56...67..............',
  '.....67..56........56...67..............',
  '.....67..56........56...67..............',
  '.....67..56........56...67..............',
  '.....67..56........56...67..............',
  '....5567.556.......556..5678............',
  '....5555.555.......555..5555............',
];
const TAIL = ['.&', '&%', '&%', '&%', '&%', '%&', '%.', '%.', '..'];

MOUNTED.cavalier = {
  label: 'Cavalier',
  kind: 'mounted',
  upper: ['rider', 'riderArm', 'weapon', 'head', 'hair', 'headgear', 'cord', 'pennant'],
  identityDefaults: {
    face: 'mature',
    hair: 'crop',
    sub: 'charcoal',
    mount: 'horseBay',
    mane: 'maneDark',
  },
  enemyAlias: { mount: 'horseBlack' },
  draw(f, ctx) {
    S(f, TAIL, 10, 27, { tag: 'sway' });
    S(f, HORSE, 10, 12, { tag: 'mount' });
    // saddle cloth (faction area) with a thread (player) / iron (enemy) hem
    S(
      f,
      ['fCcccccccf', 'fCcccccccf', 'fCcccccccf', 'fCcccccccf', 'fCccccccff', 'yjyjyjyjyj'],
      21,
      24,
      { tag: 'saddle' },
    );
    // rider: seated torso (tabard over mail), thigh along the barrel, boot in the stirrup
    S(f, ['.uoOOo.', '..uoOOo', '...uoOo', '...uoOo', '...bLLl', '...bbLl'], 26, 24, {
      tag: 'rider',
    });
    S(
      f,
      [
        '....zz....',
        '.mMCccMm..',
        'imMCcccMm.',
        'imMCcccfm.',
        '.iMCcccfi.',
        '.iMCcccf..',
        '.iMCcccf..',
        '.bLLyLLb..',
        '.iCcccf...',
      ],
      27,
      14,
      { tag: 'rider', remap: { metal: 'armor' } },
    );
    cord(f, [34, 16], [29, 21], { knot: false });
    arm(f, [29, 16], [27, 19], [28, 22], {
      tag: 'riderArm',
      sleeve: 'armor',
      forearm: 'leather',
      hand: 'leather',
    });
    drawHead(f, ctx.id, 27, 6);
    const grip = pose3(ctx, [36, 21], [35, 18], [39, 20]);
    const deg = pose3(ctx, 88, 100, 5);
    weapon(f, 'lance', grip, deg, { tag: 'weapon', len: ctx.pose === 'strike' ? 9 : 16, tail: 9 });
    if (ctx.pose !== 'strike') {
      const [px, py] = [grip[0] + 1, grip[1] - 16];
      S(
        f,
        ['Ccf', 'Ccf.', 'Cf..', 'f...'].map((r) => r.padEnd(4, '.')),
        px,
        py + 2,
        { tag: 'pennant', casts: false },
      );
    }
    arm(f, [34, 16], pose3(ctx, [36, 18], [36, 16], [38, 18]), grip, {
      tag: 'riderArm',
      sleeve: 'armor',
      forearm: 'leather',
      hand: 'leather',
    });
  },
};

// Pegasus: a lighter horse with raised wings (mount slot) and a flax mane.
const PEGASUS = [
  '...............................78.....',
  '..............................&78.....',
  '.............................&%8887...',
  '............................&%788889..',
  '...........................&%7788e89..',
  '..........................&%77788888..',
  '.........................&%7777.67889.',
  '........................&%77777..6788.',
  '.......................&%777777...665.',
  '......6777777777777777%7777778........',
  '....678888888888888888777777788.......',
  '...67888888888888888888777778.........',
  '..6788888888888888888887777788........',
  '..6778888888888888888887777788........',
  '...6777888888888888887777778..........',
  '....66777777777777777777777...........',
  '.....5677..56......5667.567...........',
  '.....567...56......567..5678..........',
  '......67..56.......567...678..........',
  '......67..56.......56....67...........',
  '......67..56.......56....67...........',
  '.....5567.556......556...5678.........',
  '.....5555.555......555...5555.........',
];
const WING = [
  '9...............',
  '899.............',
  '7889............',
  '67889...........',
  '.678899.........',
  '.6788899........',
  '..67888999......',
  '..6.7888899.....',
  '...6.788888999..',
  '...6.6778888899.',
  '....6.677888888.',
  '.....6.6677888..',
  '......6.66677...',
  '.......6..66....',
];

MOUNTED.pegasus_knight = {
  label: 'Pegasus Knight',
  kind: 'flyer',
  upper: ['rider', 'riderArm', 'weapon', 'head', 'hair', 'headgear', 'cord', 'wing'],
  // wings beat against the breath: up on frames 2-3
  idleExtra: { 2: [[['wing'], 0, -2]], 3: [[['wing'], 0, -1]] },
  identityDefaults: {
    face: 'youth',
    hair: 'ponytail',
    sub: 'linen',
    mount: 'pegasus',
    mane: 'maneFlax',
  },
  enemyAlias: { mount: 'horseGrey', mane: 'maneDark' },
  draw(f, ctx) {
    // far wing (darker), then near wing, both raised behind the rider
    S(f, WING, 17, 9, { tag: 'wing', shadeShift: -1 });
    S(f, ['.&', '&%', '&%', '&%', '%&', '%.'], 11, 29, { tag: 'sway' });
    S(f, PEGASUS, 11, 21, { tag: 'mount' });
    S(f, WING, 13, 13, { tag: 'wing' });
    S(f, ['fCccccccf', 'fCccccccf', 'fCccccccf', 'yjyjyjyjy'], 23, 31, { tag: 'saddle' });
    S(f, ['.uoOo.', '..uoOo', '...uoO', '...bLl', '...bbL'], 27, 31, { tag: 'rider' });
    S(
      f,
      [
        '...zz...',
        '.cCccc..',
        'fCCcccf.',
        'fCcccff.',
        '.CcFcf..',
        '.Cccf...',
        '.bLyLb..',
        '.iCcf...',
      ],
      28,
      23,
      { tag: 'rider' },
    );
    cord(f, [34, 25], [29, 29], { knot: false });
    arm(f, [29, 25], [28, 28], [30, 31], {
      tag: 'riderArm',
      sleeve: 'main',
      forearm: 'leather',
      hand: 'leather',
    });
    drawHead(f, ctx.id, 27, 15);
    const grip = pose3(ctx, [36, 29], [35, 26], [39, 28]);
    weapon(f, 'lance', grip, pose3(ctx, 80, 95, 5), {
      tag: 'weapon',
      len: ctx.pose === 'strike' ? 8 : 14,
      tail: 7,
    });
    arm(f, [34, 25], pose3(ctx, [36, 27], [36, 25], [38, 26]), grip, {
      tag: 'riderArm',
      sleeve: 'main',
      forearm: 'leather',
      hand: 'leather',
    });
  },
};
