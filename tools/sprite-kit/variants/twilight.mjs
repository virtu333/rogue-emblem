// Direction C — "Twilight": the Classic FE anatomy and anime faces for allies, pushed
// toward Souls through a muted material grade, a cool back-light and enemies whose
// faces are covered (closed visor, hood in shadow, iron half-helm). Faction cloth
// keeps full saturation so the side read survives the darker world.
import { stamp } from '../grid.mjs';
import { STAMPS } from './classic.mjs';

const enemyOnly = (base, overlay) => (faction) => (faction === 'enemy' ? [base, overlay] : base);

// Closed visor over the knight's open face: a single dark sight slit.
const visor = [stamp(20, 5, ['imMMi', 'iIIIi', 'imMmi', 'imMmi'])];

// Deep hood over the mage: hair hidden, upper face in shadow.
const hood = [
  stamp(14, 1, [
    '....uoOOu',
    '..uoOOOOOu',
    '.uoOOoooOOu',
    'uoOoouuuuoOOu',
    'uoOouUkzkzkU',
    'uoOou',
    'uoOou',
    'uoOou',
    '.uoOu',
    '.uoOou',
    '..uoOu',
  ]),
];

// Iron half-helm with a nasal guard over the fighter's brow.
const halfHelm = [
  stamp(15, 2, ['..imMMi', '.imMWWMi', 'imMWWMMmi', 'IiimmMmiiI', '.....IiI', '......i']),
];

export default {
  label: 'C · Twilight',
  note: 'Classic FE anatomy and ally faces; muted materials, cool rim light, faceless enemies.',
  grade: { sat: 0.62, val: 0.82, keep: ['faction', 'glow', 'spark', 'eye', 'ink'] },
  rim: { dx: 1, color: [150, 176, 210], amount: 0.38 },
  subjects: [
    {
      key: 'lord_edric',
      stamps: STAMPS.edric,
      factions: ['player'],
      alias: { hair: 'hairBrown', faction: 'teal', cloth: 'slate' },
    },
    {
      key: 'knight',
      stamps: enemyOnly(STAMPS.knight, visor),
      alias: { cloth: 'slate', metal: 'iron' },
    },
    { key: 'mage', stamps: enemyOnly(STAMPS.mage, hood), alias: { hair: 'hairRed', cloth: 'ash' } },
    {
      key: 'fighter',
      stamps: enemyOnly(STAMPS.fighter, halfHelm),
      alias: { hair: 'hairBlack', cloth: 'slate', metal: 'iron' },
    },
  ],
};
