// Direction A — "Classic FE": anime map-sprite lineage. 3/4 view facing right,
// ~3 heads tall, expressive hair and eyes, clean faction cloth. Standard palette.
import { stamp, column } from '../grid.mjs';

const edric = [
  // Cape hanging behind the far shoulder: narrow, folds as darker runs, ragged hem.
  stamp(12, 12, [
    '....vfcC',
    '...vfcCc',
    '...fcCcf',
    '..vfcCcf',
    '..fcCccf',
    '..fcCcfc',
    '.vfcCcfc',
    '.fcCccfc',
    '.fcCcfc',
    'vfcCcfc',
    'vfcCcfc',
    'fcCccf',
    'fcCcfc',
    'fcCcf.',
    'vcC.fc',
    '.v..f.',
  ]),
  // Legs: slim, far leg a step behind (foot a row higher), near leg forward.
  stamp(17, 19, [
    '.uoOOOoOu',
    '.uoO..uOo',
    '.uoO..uOo',
    '.uoO..uOo',
    '.uoO...uOo',
    '.uoO...uOo',
    '.uoO...uOo',
    '.bLl...bLl',
    '.bLl...bLl',
    '.bLl...bLl',
    '.bLl...bLl',
    'bbLl...bLl',
    'BbbB...bbLl',
    '.......BbbbB',
  ]),
  // Torso: steel breastplate under a teal tabard that stops above the knee.
  stamp(17, 11, [
    '....zz..',
    '.imWWMmi',
    'imcFFCmi',
    '.icFCCci',
    '.icFCci',
    '..cCCc',
    '..fCCcf',
    '.bLGyLb',
    '.fcFCcf',
    '.fcC.cf',
  ]),
  stamp(16, 17, ['sz']),
  // Near arm: small pauldron, slim sleeve, gloved hand on the grip.
  stamp(23, 12, ['iMWi', 'imMi', '.uOo', '.uOo', '..uO', '..bLl', '..bL']),
  // Head (3/4 right): hair swept back with a shine band, fringe, narrow face.
  stamp(15, 1, [
    '...n.n',
    '.nnhnhn.n',
    'nhhHhhnhhn',
    'nhHYYHhhhhn',
    'nhhHHhhhhhhn',
    'nhhhhhsShSS',
    '.nhhhnseSSe',
    '.nhhhnseSSeS',
    '..nhhnzSSSz',
    '...nnhzzSz',
  ]),
  // Blade held low and forward.
  stamp(25, 18, [
    'EygGj',
    '..iW',
    '..iMW',
    '...iMW',
    '....iMW',
    '.....iMW',
    '......iMW',
    '.......iMW',
    '........iW',
  ]),
];

const knight = [
  // Lance, upright in the near hand, with a faction pennant.
  column(27, 4, 32, 'd'),
  stamp(26, 1, ['.W.', 'mWM', 'iMi']),
  stamp(28, 5, ['cCCf', 'cCf.', 'cf..']),
  // Armoured legs, wide planted stance.
  stamp(15, 20, [
    '.iMWMmMWMi',
    '.imMi.imMi',
    '.imMi.imMi',
    '.iMWi.iMWi',
    '.imMi.imMi',
    '.imMi.imMi',
    '.imMi..imMi',
    '.imMi..imMi',
    '.imMi..imMi',
    '.imMi..imMi',
    '.imMi..imMi',
    'IimMi..imMMi',
    'IIiiI..IiimmI',
  ]),
  // Breastplate with a faction tabard down the centre.
  stamp(15, 11, [
    '...imMMmi..',
    '..imMcCMmi.',
    '.imMcFCMmmi',
    '.imMcFCcMmi',
    '.imMcFCcmmi',
    '..imcCCcmi',
    '..imcCCcmi',
    '..bLLGLLb',
    '..fcCFCcf',
    '..fcC.Ccf',
  ]),
  // Pauldrons, near arm and gauntlet on the lance.
  stamp(22, 11, ['.imMi.', 'imMWMi', 'iMWWMi', '.imMi.', '.imi', '.iMi', '.imMMi', '..iMi']),
  // Helm with the face open on the near side and a faction crest.
  stamp(16, 1, [
    '..cCFc',
    '.iMWWMi',
    'imWWMMmi',
    'iMWMMmmmi',
    'imMMmSSSi',
    'imMMmeSei',
    'imMMmsSSi',
    '.imMmzSzi',
    '.iimmiii',
  ]),
  // Heater shield on the far arm: faction field, steel rim, gold bar.
  stamp(10, 12, [
    'IimMMmiI',
    'iMcCFCci',
    'iMcCgCci',
    'iMcggGci',
    'iMcCgCci',
    'iMcCgCci',
    'iMcCCcci',
    '.iMcCcci',
    '.iMcCci',
    '..iMcci',
    '..iMci',
    '...ii',
  ]),
];

const mage = [
  // Long hair falling behind the shoulders.
  stamp(15, 6, ['nhhn', 'nhhhn', 'nhhhn', '.nhhn', '.nhn', '..n']),
  // Robe: faction, flaring to the ankles, front split over dark trousers.
  stamp(13, 12, [
    '....fcCCCcf',
    '....fcCFCcf',
    '....fcCFCcf',
    '....fcCFCcf',
    '...fcCCFCcf',
    '...fcCbGbcf',
    '...fcCFCccf',
    '..fcCCFCcccf',
    '..fcCCF.Cccf',
    '..fcCCo.Occf',
    '.fcCCCo.OCccf',
    '.fcCCCo.OCccf',
    '.fcCCco.oCccf',
    'fcCCCco.oCcccf',
    'fcCCcco.oCcccf',
    'fcCcccf.fcCccf',
    'fcCccf...fcCcf',
    'vfcff.....ffcv',
  ]),
  stamp(18, 30, ['bl', 'bb']),
  stamp(23, 31, ['blL', 'bbbB']),
  // Mantle and standing collar in dark cloth.
  stamp(15, 11, ['..uoOOou.', '.uoOOOOou', 'uoOoooOOou', '.uuu..uuu']),
  // Near hand holding the tome open, a small cool light at the page.
  stamp(24, 15, ['.fc', 'fcC', 'fcC', '.zs', 'bPXXPb', 'bpPPpb', '.bbbb']),
  stamp(27, 13, ['@', 'a*a', '.@']),
  // Head: side-swept hair, fringe, face.
  stamp(15, 1, [
    '..nnhn',
    '.nhhHhhn',
    'nhHYYhhhn',
    'nhHHhhhhhn',
    'nhhhhhsShSS',
    '.nhhhnseSSe',
    '.nhhhnseSSeS',
    '..nhhnzSSSz',
    '...nnhzzSz',
  ]),
];

const fighter = [
  // Axe held in the near hand, haft slanting up past the shoulder, head outboard.
  stamp(27, 4, [
    '....Dd',
    '....Dd',
    '...Dd',
    '...Dd',
    '...Dd',
    '..Dd',
    '..Dd',
    '..Dd',
    '..Dd',
    '.Dd',
    '.Dd',
    '.Dd',
    '.Dd',
    'Dd',
    'Dd',
    'Dd',
    'Dd',
  ]),
  // Bearded head: straight cheek on the haft, curved edge, long lower beard.
  stamp(32, 2, ['...iW', '..imW', 'iimMW', 'imMMW', 'imMWW', '.imMW', '..imW', '...iW', '....i']),
  // Legs: broad stance, work trousers, wrapped boots.
  stamp(15, 19, [
    '..uoOOOoOOu',
    '..uoOo..uoOu',
    '..uoOo..uoOu',
    '..uoOo..uoOu',
    '.uoOo....uoOu',
    '.uoOo....uoOu',
    '.bLLl....bLLl',
    '.blLl....blLl',
    '.blLl....blLl',
    '.blLl....blLl',
    '.blLl....blLl',
    'BbbbB....bbLLl',
    '.........BbbbbB',
  ]),
  // Torso: bare, broad chest under an open faction vest.
  stamp(15, 11, [
    '....zzz...',
    '..fczSSzcf.',
    '.fcCzSQSzCf',
    '.fcCzSSSzCcf',
    '.fcCzsSszCcf',
    '..fczsSszcf',
    '..fcCzszCcf',
    '..bLLLGLLb',
  ]),
  // Arms: far arm hanging, near arm bent to grip the haft; wrapped fists.
  stamp(13, 12, ['.zs', 'zsS', 'zsS', 'zsS', '.zs', '.bL']),
  stamp(26, 12, ['zsS', 'zsSs', '.zsS', '.zsS', '.zSs', '.bLl', '.bLL']),
  // Head: cropped hair, faction headband tails, heavier jaw.
  stamp(15, 2, [
    '..nnhhn',
    '.nhHYhhn',
    'nhhHhhhhn',
    'fcCCFCCCc',
    'fnhhhsShSS',
    'f.nhhnseSSe',
    '..nhhnseSSeS',
    '...nhnzSSSz',
    '....nzzzSz',
  ]),
];

export const STAMPS = { edric, knight, mage, fighter };

export default {
  label: 'A · Classic FE',
  note: 'Anime map-sprite lineage: 3/4 pose, expressive hair and eyes, clean palette.',
  subjects: [
    {
      key: 'lord_edric',
      stamps: edric,
      factions: ['player'],
      alias: { hair: 'hairBrown', faction: 'teal', cloth: 'slate' },
    },
    { key: 'knight', stamps: knight, alias: { cloth: 'slate' } },
    { key: 'mage', stamps: mage, alias: { hair: 'hairRed', cloth: 'cloth' } },
    { key: 'fighter', stamps: fighter, alias: { hair: 'hairBlack', cloth: 'slate' } },
  ],
};
