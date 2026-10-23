# Redraw road (a Valor sink)

Dave's rule for Valor sinks: they buy **choice or looks, never power** (2026-10-21). Redraw road
is the first: on the route map, pay Valor to throw away every place ahead of the party in this
act and draw them again.

## Rules (as built)

- **What changes.** Every node strictly between the party's row and the act's boss. The node the
  party stands on (the start node before the first step), every row behind it and the boss stay as
  they were; only the seam row's edges are rewritten to reach the new road.
- **How it is drawn.** `generateNodeMap` draws a whole fresh map for the act with the run's own
  generation options (`nodeMapOptionsForRun`), and its rows ahead are spliced on
  (`RouteRedraw.spliceRoad`, the seam joined by `connectRows`). The splice must keep every rule the
  old map kept (`RouteEdit.checkNodeMapValidity` and `serviceStreakProblems`, counting only
  problems the old map did not already have), else the next attempt is drawn; after
  `REDRAW_ATTEMPTS` (24) nothing changes and nothing is charged.
- **Streams.** Attempt `k` of redraw `n` runs under `withEclipseSeed('route-redraw:<seed>:<act>:<n>:<k>')`,
  so `Math.random`, the node-map stream and every other stream are untouched, and two copies of a
  run draw the same road.
- **No power.** The road ahead never holds more recruit or Colosseum nodes than before (counted by
  what the generator made them, so a node the Eclipse took still counts); a surplus becomes a
  battle, latest rows first (`capRoadPromises`). A Pilgrim's Road shop ahead is restamped on the
  new road (`_stampExtraShops` from the next row; one already passed is the act's one). An Old
  Sanctum ahead moves to a church on the new road (`sanctum-redraw:` key) or is lost if none is
  drawn. The Eclipse falls on the new road at the act's shadow (`applyEclipseNow`), and those falls
  are marked seen (the road as drawn, no fall ceremony).
- **Node-keyed state.** The run's tables keyed by node id (`battleConfigsByNodeId`,
  `shopStateByNodeId`, the Ruins', churches' and events' tables) lose every id of the old road
  ahead, so a new node that reuses an id never reads an old lock. An event route change or a
  contract's road ahead is thrown away like any other node.
- **Price and cap.** 300 / 400 / 500 / 650 / 800 Valor for the 1st to 5th redraw of a run
  (`ROUTE_REDRAW_PRICES`), at most 5 a run (`ROUTE_REDRAW_MAX`), nothing raises it. The count is
  `run.routeRedraws` (saved, `inert` in `RunFormat`: an older client ignores it and plays the
  saved nodes).
- **When.** Not in the prologue, a no-upgrade run (`noMetaMode`), the Descent or any map with
  authored nodes (`not_offered`, button hidden); not during a battle or after the act's boss
  (`busy`); not while the party is held at its node: not done there, spoils or a contract reward
  owed (`held`); hidden when only the boss lies ahead (`no_road`).
- **The transaction** (`ui/RouteRedrawController.commitRouteRedraw`): the run redraws first
  (refusable with nothing changed), then `MetaProgressionManager.spendValor` (its own `_commit`
  write; short or a failed write undoes the redraw), then the run is saved (a failed save undoes the
  redraw and hands the Valor back). A redraw is paid and saved, or neither.

## UI

An entry in the route map's Menu (the pause menu), "Redraw road", at the top: under the note,
above the burdens, the blessings and Resume (a `lead` action, `.mp-lead`; on a short landscape
phone it reads on one line and the actions below take three columns, so the panel is no taller)
(`RouteRedrawController.routeRedrawPauseEntry`, PauseOverlay's `routeRedraw`): a line under it
says the price and redraws left ("300 Valor · 5 left"), or, greyed, why it cannot be used ("Need
300 Valor (you have 120).", "No redraws left this run.", "Finish here before redrawing the road.").
The Menu/Roster row keeps its two buttons. Choosing it closes the menu and asks first ("Redraw the
road ahead?", the price, Valor held and redraws left after); after a redraw a toast says how many
are left. A greyed entry does nothing.

Tests: `tests/RouteRedraw.test.js`, `tests/e2e/route-redraw.spec.js` (the `menus` lane).
