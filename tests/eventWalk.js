// Walking the pages of a shipped event in a test (docs/specs/event-nodes-phase2.md §2A). A
// multi-page event (the Sunken Mine, the Plague Village) is reached one step at a time, and an
// outcome is seeded, so a test that wants "this choice on that page" walks a route of choices
// and keeps only the seeds whose rolls led where the route needs. Nothing here decides what an
// outcome does: it only drives the real commands and reads the data's own page graph.
import { chooseEventOption, eventView } from '../src/engine/EventCommands.js';
import { START_PAGE, pageOf } from '../src/engine/EventSystem.js';

/** Every page id of an event face: `start`, then the others in the data's order. */
export const pageIdsOf = (event) => [START_PAGE, ...Object.keys(event.pages || {})];

/** Every [pageId, choiceId, outcomeId] an event face can produce. */
export function eventTriples(event) {
  return pageIdsOf(event).flatMap((pageId) =>
    pageOf(event, pageId).choices.flatMap((choice) =>
      choice.outcomes.map((outcome) => [pageId, choice.id, outcome.id]),
    ),
  );
}

/**
 * For each page, the shortest list of steps [{ choiceId, to }] from the first page: the choice
 * to make and the page its outcome must lead on to. Breadth first over the outcomes' `next`.
 */
export function routesToPages(event) {
  const routes = new Map([[START_PAGE, []]]);
  const queue = [START_PAGE];
  while (queue.length) {
    const from = queue.shift();
    for (const choice of pageOf(event, from).choices)
      for (const outcome of choice.outcomes)
        if (outcome.next && !routes.has(outcome.next)) {
          routes.set(outcome.next, [
            ...routes.get(from),
            { choiceId: choice.id, to: outcome.next },
          ]);
          queue.push(outcome.next);
        }
  }
  return routes;
}

/** The last qualifying unit of a choice's picker (so the target is not always the commander). */
export function pickTargetUid(run, nodeId, choiceId) {
  const choice = eventView(run, nodeId).choices.find((c) => c.id === choiceId);
  if (!choice?.target) return null;
  return choice.target.candidates.filter((c) => c.ok).at(-1)?.uid || null;
}

/**
 * Follow a route on a run whose event is open. True when every step landed on the page it
 * needed (the seeded rolls may send a step elsewhere: the caller then tries another seed).
 */
export function walkRoute(run, nodeId, route) {
  for (const step of route) {
    const result = chooseEventOption(run, nodeId, step.choiceId, {
      targetUid: pickTargetUid(run, nodeId, step.choiceId),
    });
    if (!result.ok || result.next !== step.to) return false;
  }
  return true;
}

/**
 * Leave an event that has moved on to another page, the way a player with nothing left to
 * spend would: the first open choice none of whose outcomes goes deeper. Returns that choice's
 * result (or null when none is open).
 */
export function takeAnExit(run, nodeId, event) {
  const view = eventView(run, nodeId);
  const page = pageOf(event, view.page);
  const exit = view.choices.find((c) => {
    if (c.block) return false;
    const def = page.choices.find((d) => d.id === c.id);
    return def.outcomes.every((o) => !o.next);
  });
  if (!exit) return null;
  return chooseEventOption(run, nodeId, exit.id, {
    targetUid: pickTargetUid(run, nodeId, exit.id),
  });
}
