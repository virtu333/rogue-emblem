// Class sprite definitions for the 64x64 "rebuilt" unit slot.
//
// Layout contract (matches RebuiltSprites.spritePlacement at scale 1):
//   infantry art box x 13..50, y 10..43 (38x34), feet on row 42, outline row 43
//   mounted  art box x  9..54, y  4..43 (46x40)
// Every class is ~2.7 heads tall: head rows 12..23, feet 42.
//
// `b` is the idle-bob offset (0 or 1). Everything above the belt adds `b` to y so
// frame 2 of the idle loop breathes without detaching hands from weapons.
import { PixelSprite } from './pixel.mjs';

// ---- shared anatomy -------------------------------------------------------

function legs(s, { pants = 'cloth', boots = 'leather', wide = false } = {}) {
  const [l0, l1, r0, r1] = wide ? [26, 29, 34, 37] : [27, 30, 33, 36];
  s.rect(l0, 33, r1, 35, pants, { flat: true });
  s.rect(l0, 34, l1, 38, pants);
  s.rect(r0, 34, r1, 38, pants);
  s.rect(l0 - 1, 39, l1, 42, boots, { base: 1 });
  s.rect(r0, 39, r1 + 1, 42, boots, { base: 1 });
  s.erase([
    [l0 - 1, 39],
    [r1 + 1, 39],
  ]);
}

function torso(s, b, mat = 'cloth', { wide = 0 } = {}) {
  return s.poly(
    [
      [25 - wide, 24 + b],
      [38 + wide, 24 + b],
      [37 + wide, 32 + b],
      [26 - wide, 32 + b],
    ],
    mat,
  );
}

function belt(s, b, mat = 'leather', buckle = 'brass') {
  s.rect(26, 32 + b, 37, 33 + b, mat, { base: 1, flat: true });
  s.rect(31, 32 + b, 32, 33 + b, buckle, { shade: 3 });
}

// Arms hang by default; `leftHand`/`rightHand` override the hand position so a
// sleeve can reach a weapon grip.
function arm(s, b, side, { mat = 'cloth', hand = null, skin = 'skin' } = {}) {
  const x = side === 'L' ? 22 : 39;
  const [hx, hy] = hand ?? [x + 1, 32];
  s.line(x + 1, 25 + b, hx, hy - 1 + b, mat, { w: 3 });
  s.ellipse(x + 1, 25.5 + b, 1.5, 1.5, mat, { part: s.parts.length - 1 });
  s.rect(hx, hy + b, hx + 1, hy + 1 + b, skin);
}

function head(s, b, { skin = 'skin', hair = 'hairBrown', style = 'short' } = {}) {
  // Back hair first so the face sits in front of it.
  if (style === 'long') s.rect(26, 15 + b, 37, 25 + b, hair, { base: 1 });
  if (style === 'tail') {
    s.poly(
      [
        [35, 13 + b],
        [40, 14 + b],
        [43, 20 + b],
        [41, 19 + b],
        [37, 17 + b],
      ],
      hair,
      { base: 1 },
    );
    s.rect(36, 13 + b, 37, 14 + b, 'faction', { base: 3 });
  }
  const face = s.rect(28, 14 + b, 35, 22 + b, skin);
  s.erase([
    [28, 22 + b],
    [35, 22 + b],
  ]);
  s.rect(30, 23 + b, 33, 23 + b, skin, { base: 1 });
  // Eyes: two 1x2 marks; a brow-shadow row above keeps them readable at 1x.
  s.pixels(
    [
      [29, 17 + b],
      [34, 17 + b],
      [30, 17 + b],
      [33, 17 + b],
    ],
    skin,
    { shade: 1, part: face },
  );
  s.pixels(
    [
      [30, 18 + b],
      [30, 19 + b],
      [33, 18 + b],
      [33, 19 + b],
    ],
    'eye',
    { shade: 0 },
  );
  if (style === 'none') return;
  // Hair cap with a jagged fringe; side locks frame the face.
  const cap = s.poly(
    [
      [28, 12 + b],
      [35, 12 + b],
      [37, 14 + b],
      [37, 20 + b],
      [36, 20 + b],
      [36, 16 + b],
      [27, 16 + b],
      [27, 20 + b],
      [26, 20 + b],
      [26, 14 + b],
    ],
    hair,
  );
  s.pixels(
    [
      [28, 16 + b],
      [29, 16 + b],
      [31, 16 + b],
      [34, 16 + b],
      [35, 16 + b],
      [28, 17 + b],
      [35, 17 + b],
    ],
    hair,
    { part: cap },
  );
  if (style === 'spiky')
    s.pixels(
      [
        [27, 12 + b],
        [29, 11 + b],
        [32, 11 + b],
        [33, 11 + b],
        [36, 11 + b],
        [37, 13 + b],
        [25, 14 + b],
      ],
      hair,
      { part: cap },
    );
}

// ---- classes --------------------------------------------------------------

const CLASSES = {
  // Lord: approved teal signature on cape + tabard, raised blade for a heroic diagonal.
  edric(s, b) {
    const cape = s.poly(
      [
        [24, 24 + b],
        [39, 24 + b],
        [42, 40],
        [21, 40],
      ],
      'faction',
      { base: 1 },
    );
    s.pixels(
      [
        [22, 41],
        [25, 41],
        [26, 41],
        [40, 41],
        [41, 41],
        [37, 41],
      ],
      'faction',
      { part: cape },
    );
    legs(s, { pants: 'cloth', boots: 'leather' });
    torso(s, b, 'steel');
    s.rect(29, 24 + b, 34, 36 + b, 'faction');
    s.rect(29, 37 + b, 34, 37 + b, 'faction', { base: 1 });
    belt(s, b);
    arm(s, b, 'L', { mat: 'cloth' });
    arm(s, b, 'R', { mat: 'cloth', hand: [40, 30] });
    s.ellipse(25, 25 + b, 2, 1.5, 'steel', { base: 3 });
    s.ellipse(38, 25 + b, 2, 1.5, 'steel');
    head(s, b, { hair: 'hairBrown', style: 'spiky' });
    // Sword rising from the right hand toward the upper right.
    s.line(41, 29 + b, 48, 13 + b, 'steel', { base: 3, w: 2 });
    s.line(41, 29 + b, 48, 13 + b, 'steel', { shade: 4 });
    s.line(38, 29 + b, 44, 32 + b, 'brass', { base: 3 });
    s.line(40, 33 + b, 39, 35 + b, 'leather', { w: 2 });
  },

  // Myrmidon: lean duelist. Wind-caught scarf and tied tail give a moving silhouette; blade low.
  myrmidon(s, b) {
    // Scarf streams back and down from the neck, forked at the tail.
    const scarf = s.poly(
      [
        [28, 23 + b],
        [24, 24 + b],
        [20, 28 + b],
        [16, 33 + b],
        [19, 33 + b],
        [22, 30 + b],
        [26, 27 + b],
      ],
      'faction',
    );
    s.pixels(
      [
        [15, 34 + b],
        [18, 34 + b],
        [18, 35 + b],
      ],
      'faction',
      { part: scarf },
    );
    legs(s, { pants: 'cloth', boots: 'leather', wide: true });
    torso(s, b, 'moss');
    s.poly(
      [
        [27, 24 + b],
        [30, 24 + b],
        [36, 32 + b],
        [33, 32 + b],
      ],
      'leather',
      { base: 1 },
    );
    belt(s, b, 'faction', 'faction');
    s.poly(
      [
        [26, 33 + b],
        [37, 33 + b],
        [38, 37],
        [25, 37],
      ],
      'moss',
      { base: 1 },
    );
    arm(s, b, 'L', { mat: 'moss' });
    arm(s, b, 'R', { mat: 'moss', hand: [38, 32] });
    head(s, b, { hair: 'hairBlack', style: 'tail' });
    s.rect(27, 23 + b, 36, 24 + b, 'faction', { base: 3 });
    // Curved blade sweeping low to the right from a two-handed grip.
    s.rect(34, 31 + b, 37, 32 + b, 'leather', { base: 1 });
    s.rect(38, 30 + b, 39, 33 + b, 'brass', { base: 3 });
    s.line(40, 32 + b, 44, 34 + b, 'steel', { shade: 3 });
    s.line(44, 34 + b, 49, 34 + b, 'steel', { shade: 3 });
    s.line(40, 33 + b, 44, 35 + b, 'steel', { shade: 2 });
    s.line(44, 35 + b, 48, 35 + b, 'steel', { shade: 2 });
    s.line(41, 32 + b, 48, 33 + b, 'steel', { shade: 4 });
  },

  // Knight: the human wall. Slab shield, rectangular armour masses, upright lance.
  knight(s, b) {
    s.line(43, 14, 43, 42, 'wood', { base: 2 });
    s.poly(
      [
        [43, 11],
        [45, 15],
        [41, 15],
      ],
      'steel',
      { base: 3 },
    );
    s.rect(42, 17, 44, 18, 'faction');
    legs(s, { pants: 'iron', boots: 'iron', wide: true });
    s.rect(24, 24 + b, 39, 33 + b, 'iron');
    s.rect(29, 24 + b, 34, 37 + b, 'faction');
    s.pixels(
      [
        [30, 37 + b],
        [33, 37 + b],
      ],
      null,
    );
    belt(s, b, 'leather', 'steel');
    s.ellipse(40.5, 25.5 + b, 3, 2.5, 'steel');
    s.rect(40, 27 + b, 42, 31 + b, 'iron');
    s.rect(42, 32 + b, 43, 33 + b, 'iron', { base: 3 });
    // Great helm: a squared box with a dark visor slit and a faction crest, no face shown.
    s.rect(26, 12 + b, 37, 23 + b, 'steel');
    s.erase([
      [26, 12 + b],
      [37, 12 + b],
    ]);
    s.rect(27, 17 + b, 36, 18 + b, 'eye', { shade: 0 });
    s.rect(31, 19 + b, 32, 22 + b, 'steel', { shade: 1 });
    s.rect(30, 11 + b, 33, 12 + b, 'faction', { base: 3 });
    s.rect(31, 13 + b, 32, 16 + b, 'faction', { base: 2 });
    // Slab shield on the left arm, framed in iron with a faction band.
    s.rect(15, 23 + b, 26, 39 + b, 'iron', { base: 3 });
    s.rect(16, 24 + b, 25, 38 + b, 'wood', { base: 2 });
    s.rect(16, 29 + b, 25, 32 + b, 'faction', { base: 2 });
    s.rect(20, 24 + b, 21, 38 + b, 'iron', { base: 3 });
  },

  // Fighter: logging-camp conscript. Work vest, bare forearms, axe carried on the shoulder.
  fighter(s, b) {
    legs(s, { pants: 'leather', boots: 'leather', wide: true });
    torso(s, b, 'linen', { wide: 1 });
    s.poly(
      [
        [24, 24 + b],
        [30, 24 + b],
        [30, 34 + b],
        [25, 34 + b],
      ],
      'faction',
    );
    s.poly(
      [
        [33, 24 + b],
        [39, 24 + b],
        [38, 34 + b],
        [33, 34 + b],
      ],
      'faction',
    );
    belt(s, b, 'leather', 'iron');
    arm(s, b, 'L', { mat: 'skin', hand: [22, 31] });
    s.rect(21, 30 + b, 24, 32 + b, 'leather', { base: 1 });
    // Right arm raised to the haft over the shoulder.
    s.line(40, 25 + b, 42, 21 + b, 'skin', { w: 3 });
    s.rect(41, 19 + b, 43, 21 + b, 'leather', { base: 1 });
    head(s, b, { hair: 'hairBrown', style: 'short' });
    s.rect(27, 14 + b, 36, 15 + b, 'faction', { base: 3 });
    s.pixels(
      [
        [26, 15 + b],
        [25, 16 + b],
        [25, 17 + b],
      ],
      'faction',
      { base: 2 },
    );
    // Haft runs from behind the shoulder up-right; heavy bearded axe head.
    s.line(36, 26 + b, 46, 13 + b, 'wood', { w: 2 });
    s.poly(
      [
        [42, 11 + b],
        [48, 12 + b],
        [49, 20 + b],
        [45, 21 + b],
        [43, 16 + b],
      ],
      'steel',
      { base: 2 },
    );
    s.line(48, 12 + b, 49, 20 + b, 'steel', { shade: 4 });
  },

  // Archer: border yeoman. Weather cloak and hood as the faction block, tall bow, quiver mass.
  archer(s, b) {
    s.poly(
      [
        [36, 18 + b],
        [40, 16 + b],
        [43, 28 + b],
        [40, 30 + b],
      ],
      'leather',
      { base: 2 },
    );
    s.pixels(
      [
        [39, 14 + b],
        [40, 13 + b],
        [41, 15 + b],
        [38, 15 + b],
      ],
      'linen',
      { base: 3 },
    );
    const cloak = s.poly(
      [
        [24, 23 + b],
        [39, 23 + b],
        [41, 37],
        [22, 37],
      ],
      'faction',
      { base: 1 },
    );
    s.pixels(
      [
        [23, 38],
        [27, 38],
        [36, 38],
        [40, 38],
      ],
      'faction',
      { part: cloak },
    );
    legs(s, { pants: 'moss', boots: 'leather' });
    torso(s, b, 'moss');
    s.rect(28, 24 + b, 35, 31 + b, 'leather', { base: 2 });
    belt(s, b);
    arm(s, b, 'R', { mat: 'moss', hand: [40, 30] });
    head(s, b, { hair: 'hairAsh', style: 'short' });
    // Hood drawn up over the hair: a pointed cowl that frames the face.
    s.poly(
      [
        [31, 11 + b],
        [36, 12 + b],
        [38, 17 + b],
        [38, 24 + b],
        [36, 24 + b],
        [36, 15 + b],
        [27, 15 + b],
        [27, 24 + b],
        [25, 24 + b],
        [25, 17 + b],
        [27, 12 + b],
      ],
      'faction',
    );
    // Tall bow held out on the left: a clean arc taller than the body.
    s.line(18, 12 + b, 21, 17 + b, 'wood', { base: 3 });
    s.line(21, 17 + b, 22, 26 + b, 'wood', { base: 3 });
    s.line(22, 26 + b, 21, 35 + b, 'wood', { base: 3 });
    s.line(21, 35 + b, 18, 40 + b, 'wood', { base: 3 });
    s.line(18, 12 + b, 18, 40 + b, 'linen', { shade: 2 });
    arm(s, b, 'L', { mat: 'moss', hand: [21, 25] });
  },

  // Mage: academy field caster. Structured long coat, tall standing collar, worn book.
  mage(s, b) {
    legs(s, { pants: 'cloth', boots: 'leather' });
    // Long coat, split at the front so the stride stays visible.
    const coat = s.poly(
      [
        [25, 24 + b],
        [38, 24 + b],
        [44, 40],
        [34, 40],
        [32, 35],
        [31, 35],
        [29, 40],
        [19, 40],
      ],
      'faction',
    );
    s.pixels(
      [
        [20, 41],
        [24, 41],
        [27, 41],
        [37, 41],
        [40, 41],
        [43, 41],
      ],
      'faction',
      { part: coat },
    );
    s.rect(30, 24 + b, 33, 33 + b, 'cloth', { base: 2 });
    s.pixels(
      [
        [31, 26 + b],
        [32, 28 + b],
        [31, 30 + b],
      ],
      'brass',
      { shade: 3 },
    );
    belt(s, b, 'leather', 'brass');
    arm(s, b, 'R', { mat: 'faction' });
    head(s, b, { hair: 'hairRed', style: 'short' });
    // Standing collar in dark cloth rising to the ears on both sides: the class's cut.
    s.poly(
      [
        [24, 19 + b],
        [27, 20 + b],
        [28, 24 + b],
        [24, 24 + b],
      ],
      'cloth',
      { base: 1 },
    );
    s.poly(
      [
        [39, 19 + b],
        [36, 20 + b],
        [35, 24 + b],
        [39, 24 + b],
      ],
      'cloth',
      { base: 1 },
    );
    // Worn tome held open to the left, with a small cool light at the page edge.
    arm(s, b, 'L', { mat: 'faction', hand: [22, 28] });
    s.rect(15, 26 + b, 22, 31 + b, 'leather', { base: 1 });
    s.rect(16, 26 + b, 21, 29 + b, 'linen', { base: 3 });
    s.line(18, 26 + b, 18, 30 + b, 'leather', { shade: 1 });
    s.pixels(
      [
        [16, 24 + b],
        [17, 23 + b],
        [15, 23 + b],
      ],
      'glow',
      { shade: 3 },
    );
  },

  // Cleric: temple attendant with the levies. Travel-worn vestment, faction stole, plain staff.
  cleric(s, b) {
    s.line(42, 13, 42, 42, 'wood', { base: 3 });
    s.ellipse(42, 12.5, 1.5, 1.5, 'brass', { base: 3 });
    legs(s, { pants: 'linen', boots: 'leather' });
    const robe = s.poly(
      [
        [25, 24 + b],
        [38, 24 + b],
        [40, 40],
        [23, 40],
      ],
      'linen',
    );
    s.pixels(
      [
        [24, 41],
        [27, 41],
        [30, 41],
        [36, 41],
        [39, 41],
      ],
      'linen',
      { part: robe },
    );
    // Stole: two faction bands framing the chest down to the hem.
    s.rect(28, 24 + b, 29, 40, 'faction', { base: 3 });
    s.rect(34, 24 + b, 35, 40, 'faction', { base: 2 });
    s.rect(26, 32 + b, 37, 33 + b, 'leather', { base: 1, flat: true });
    // Field satchel on the left hip.
    s.rect(22, 32 + b, 26, 36 + b, 'leather', { base: 2 });
    arm(s, b, 'L', { mat: 'linen' });
    arm(s, b, 'R', { mat: 'linen', hand: [41, 28] });
    head(s, b, { hair: 'hairAsh', style: 'short' });
    // Lowered hood gathered behind the neck.
    s.poly(
      [
        [26, 22 + b],
        [37, 22 + b],
        [38, 25 + b],
        [25, 25 + b],
      ],
      'linen',
      { base: 1 },
    );
  },

  // Thief: wartime scavenger. Short asymmetric coat, crouched lean, reversed dagger, tool roll.
  thief(s, b) {
    const d = 1; // everything above the knees sits one row lower: a ready crouch
    legs(s, { pants: 'cloth', boots: 'leather', wide: true });
    s.poly(
      [
        [24, 24 + b + d],
        [38, 24 + b + d],
        [39, 36],
        [33, 37],
        [24, 33 + d],
      ],
      'faction',
    );
    s.rect(28, 25 + b + d, 32, 31 + b + d, 'leather', { base: 1 });
    s.rect(24, 33 + b, 37, 33 + b, 'leather', { base: 1, flat: true });
    s.rect(34, 30 + b, 37, 35 + b, 'leather', { base: 2 });
    s.pixels(
      [
        [35, 30 + b],
        [36, 29 + b],
      ],
      'steel',
      { shade: 3 },
    );
    arm(s, b + d, 'R', { mat: 'faction', hand: [41, 29] });
    head(s, b + d, { hair: 'hairBrown', style: 'short' });
    // Half-mask scarf over the lower face.
    s.rect(28, 20 + b + d, 35, 23 + b + d, 'cloth', { base: 2 });
    s.pixels(
      [
        [26, 22 + b + d],
        [25, 23 + b + d],
        [24, 25 + b + d],
      ],
      'cloth',
      { base: 2 },
    );
    // Reversed dagger in the left hand, blade pointing down and out.
    arm(s, b + d, 'L', { mat: 'faction', hand: [21, 30] });
    s.line(20, 33 + b + d, 17, 39 + b, 'steel', { shade: 4 });
    s.line(21, 33 + b + d, 18, 39 + b, 'steel', { shade: 2 });
    s.rect(19, 31 + b + d, 23, 31 + b + d, 'brass', { base: 3 });
  },

  // Cavalier: horse and rider read as two masses. Faction saddle cloth plus a pennant
  // trailing from an upright lance: the clearest side marker in the roster.
  cavalier(s, b) {
    const horse = 'horse';
    // Far legs first (darker), then barrel, then near legs.
    s.rect(18, 31, 19, 41, horse, { base: 1 });
    s.rect(41, 31, 42, 41, horse, { base: 1 });
    s.poly(
      [
        [13, 25],
        [16, 23],
        [41, 23],
        [45, 26],
        [44, 32],
        [15, 32],
      ],
      horse,
    );
    s.poly(
      [
        [11, 24],
        [14, 24],
        [14, 32],
        [12, 36],
        [10, 31],
      ],
      'hairBlack',
      { base: 2 },
    );
    s.rect(15, 31, 17, 38, horse, { base: 2 });
    s.rect(15, 39, 16, 41, horse, { base: 2 });
    s.rect(43, 31, 45, 38, horse, { base: 2 });
    s.rect(44, 39, 45, 41, horse, { base: 2 });
    for (const x of [14, 17, 40, 43]) s.rect(x, 42, x + 2, 42, 'iron', { shade: 1 });
    // Neck and long head, facing right and clear of the rider.
    s.poly(
      [
        [39, 25],
        [43, 15],
        [46, 11],
        [49, 11],
        [54, 17],
        [54, 20],
        [51, 20],
        [48, 17],
        [46, 27],
      ],
      horse,
    );
    s.pixels(
      [
        [46, 9],
        [47, 10],
      ],
      horse,
      { base: 3 },
    );
    s.poly(
      [
        [40, 20],
        [44, 12],
        [46, 12],
        [43, 22],
        [41, 26],
      ],
      'hairBlack',
      { base: 2 },
    );
    s.pixels([[49, 14]], 'eye', { shade: 0 });
    s.line(47, 17, 53, 19, 'leather', { shade: 1 });
    // Saddle cloth: a big faction block with a brass edge.
    s.poly(
      [
        [21, 22],
        [35, 22],
        [36, 31],
        [20, 31],
      ],
      'faction',
    );
    s.rect(20, 31, 36, 31, 'brass', { base: 2 });
    // Rider: torso over the saddle, leg hanging along the flank.
    const r = -7 + b;
    s.rect(28, 25, 31, 33, 'cloth', { base: 1 });
    s.rect(27, 33, 31, 35, 'leather', { base: 1 });
    s.poly(
      [
        [25, 24 + r],
        [38, 24 + r],
        [37, 32 + r],
        [26, 32 + r],
      ],
      'steel',
    );
    s.rect(29, 24 + r, 34, 33 + r, 'faction', { base: 3 });
    // Upright lance on the near side; pennant trails back as if at the gallop.
    s.line(22, 7, 22, 34, 'wood', { base: 3 });
    s.poly(
      [
        [22, 5],
        [23, 8],
        [21, 8],
      ],
      'steel',
      { base: 4 },
    );
    s.poly(
      [
        [21, 9],
        [14, 10],
        [16, 12],
        [14, 14],
        [21, 14],
      ],
      'faction',
      { base: 3 },
    );
    arm(s, r, 'L', { mat: 'steel', hand: [22, 26] });
    arm(s, r, 'R', { mat: 'steel', hand: [41, 29] });
    s.line(42, 23, 47, 18, 'leather', { shade: 1 });
    head(s, r, { hair: 'hairAsh', style: 'short' });
    s.rect(27, 12 + r, 36, 15 + r, 'steel', { base: 3 });
    s.erase([
      [27, 12 + r],
      [36, 12 + r],
    ]);
    s.rect(26, 15 + r, 37, 15 + r, 'steel', { base: 2 });
  },
};

export const SPRITES = [
  { key: 'lord_edric', cls: 'edric', factions: ['player'], kind: 'infantry', teal: true },
  { key: 'myrmidon', cls: 'myrmidon', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'knight', cls: 'knight', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'fighter', cls: 'fighter', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'archer', cls: 'archer', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'mage', cls: 'mage', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'cleric', cls: 'cleric', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'thief', cls: 'thief', factions: ['player', 'enemy'], kind: 'infantry' },
  { key: 'cavalier', cls: 'cavalier', factions: ['player', 'enemy'], kind: 'mounted' },
];

export const BOX = {
  infantry: { x: 13, y: 10, width: 38, height: 34 },
  mounted: { x: 9, y: 4, width: 46, height: 40 },
};

export function buildSprite(cls, bob = 0) {
  const s = new PixelSprite(64, 64);
  CLASSES[cls](s, bob);
  return s;
}
