// Expands the catalogue into render jobs and the runtime variant table (pure).
//
// Every (person, class) pair is one portrait id:
//   - an anchored pair keeps its existing id (generic_fighter, generic_warrior...)
//   - a class whose default portrait (generic_<class>) has no anchor gives that
//     id to the line's first person, so the default face is always a real render
//   - everything else is generic_<class>__<person> / enemy_<class>__<b|c|d>
import {
  PLAYER_CLASSES,
  PLAYER_CLASSES_F,
  LINES,
  ENEMY_CLASSES,
  ENEMY_LOOKS,
  NAME_GENDERS,
} from './catalog.mjs';

export const slug = (name) => String(name).toLowerCase().replace(/ /g, '_');

// Cross promotions: a Pegasus Knight may become a Wyvern Lord and a Wyvern
// Rider a Falcon Knight, but those classes' defaults belong to their own line.
const CROSS = { pegasus: ['Wyvern Lord'], wyvern: ['Falcon Knight'] };

function isHome(line, className) {
  return !CROSS[line]?.includes(className);
}

/**
 * @param {Set<string>} existingIds portrait ids that already exist (base ids)
 * @returns {{jobs: object[], runtime: object}}
 */
export function buildPlan(existingIds = new Set()) {
  const jobs = [];
  const identities = {};
  const classes = {};

  for (const [line, def] of Object.entries(LINES)) {
    const people = Object.entries(def.people);
    const first = people[0][0];
    for (const [person, info] of people) {
      const renders = {};
      // Render order: anchors first, then the base class, then the rest.
      const order = [
        ...def.classes.filter((c) => info.anchor?.[c]),
        ...def.classes.filter((c) => !info.anchor?.[c]),
      ];
      let identityRef = null;
      for (const className of order) {
        const anchor = info.anchor?.[className];
        const baseId = `generic_${slug(className)}`;
        const claimed = Object.values(LINES).some((d) =>
          Object.values(d.people).some((p) => p.anchor?.[className]?.id === baseId),
        );
        let id;
        if (anchor) id = anchor.id;
        else if (person === first && isHome(line, className) && existingIds.has(baseId) && !claimed)
          id = baseId;
        else id = `${baseId}__${person}`;
        renders[className] = id;
        jobs.push({
          id,
          side: 'player',
          line,
          person,
          className,
          gender: info.g,
          look: info.look,
          costume: (info.g === 'f' && PLAYER_CLASSES_F[className]) || PLAYER_CLASSES[className],
          mode: anchor?.mode || 'new',
          identityRef, // the person's first render (null for the first)
          isBase: id === baseId,
        });
        identityRef ||= id;
        (classes[className] ||= []).push(person);
      }
      identities[person] = { line, gender: info.g, renders };
    }
  }

  // Costume reference: the class default portrait, once drawn (not for itself).
  const baseOf = {};
  for (const j of jobs) if (j.isBase) baseOf[j.className] = j.id;
  for (const j of jobs) {
    const base = baseOf[j.className];
    j.costumeRef = base && base !== j.id && j.mode === 'new' ? base : null;
  }

  // Enemies: face a remasters enemy_<class>, b-d are new.
  const enemy = {};
  ENEMY_CLASSES.forEach((className, i) => {
    const s = slug(className);
    const baseId = `enemy_${s}`;
    const ids = [baseId];
    jobs.push({
      id: baseId,
      side: 'enemy',
      className,
      person: `${s}_a`,
      gender: null,
      look: null,
      costume: PLAYER_CLASSES[className],
      mode: 'remaster',
      identityRef: null,
      costumeRef: null,
      isBase: true,
    });
    ['b', 'c', 'd'].forEach((letter, k) => {
      const look = ENEMY_LOOKS[(i * 5 + k * 4) % ENEMY_LOOKS.length];
      const id = `${baseId}__${letter}`;
      ids.push(id);
      jobs.push({
        id,
        side: 'enemy',
        className,
        person: `${s}_${letter}`,
        gender: look.g,
        look: look.look,
        costume: (look.g === 'f' && PLAYER_CLASSES_F[className]) || PLAYER_CLASSES[className],
        mode: 'new',
        identityRef: null,
        costumeRef: baseId,
        isBase: false,
      });
    });
    enemy[className] = ids;
  });

  const names = {};
  // Only names that read as a man or a woman constrain the face.
  for (const g of ['m', 'f']) for (const n of NAME_GENDERS[g]) names[n] = g;
  const sortedNames = Object.fromEntries(
    Object.keys(names)
      .sort()
      .map((n) => [n, names[n]]),
  );

  return {
    jobs,
    runtime: {
      version: 1,
      generator: 'tools/art/portrait-variants',
      identities,
      classes,
      enemy,
      names: sortedNames,
    },
  };
}
