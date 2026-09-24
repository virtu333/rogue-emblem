import { resolveDeploymentSelection } from '../engine/DeploymentSelection.js';
import { getUnitTraits } from '../engine/TraitSystem.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { unitPortrait } from './unitPortrait.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { findCommander } from '../engine/Commander.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { getStaticCombatStats } from '../engine/Combat.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';

function unitRow(scene, gameData, unit, action, selected) {
  const row = button(null, action, 're-btn re-row re-party-row');
  row.setAttribute('aria-pressed', String(selected));
  const portrait = unitPortrait(scene, gameData, unit, 'mr-unit-face');
  if (portrait) row.append(portrait);
  row.append(
    element('strong', unit.name),
    element(
      'small',
      `${unit.className} · Lv ${getDisplayLevel(unit)} · HP ${unit.currentHP}/${unit.stats.HP}`,
    ),
  );
  return row;
}
export function describeUnit(gameData, unit) {
  const box = element('div');
  box.append(
    element('h3', unit.name),
    element(
      'p',
      gameData.classes?.find((c) => c.name === unit.className)?.description || unit.className,
    ),
  );
  box.append(
    element(
      'p',
      ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV']
        .map((key) => `${key} ${unit.stats[key]}`)
        .join(' · '),
    ),
  );
  if (unit.proficiencies?.length)
    box.append(element('p', unit.proficiencies.map((p) => `${p.type} ${p.rank}`).join(' · ')));
  const traits = getUnitTraits(unit, gameData.traits);
  for (const trait of traits) box.append(element('p', `${trait.name}: ${trait.description || ''}`));
  for (const id of unit.skills || []) {
    const skill = gameData.skills?.find((s) => s.id === id);
    box.append(element('p', `${skill?.name || id}: ${skill?.description || ''}`));
  }
  if (unit.inventory?.length)
    box.append(element('p', unit.inventory.map((w) => w.name).join(' · ')));
  const combat = getStaticCombatStats(unit, unit.weapon);
  box.append(
    element('p', `Atk ${combat.atk} · AS ${combat.as} · Hit ${combat.hit} · Crit ${combat.crit}`),
  );
  return box;
}

export function showArrivalMenu(
  owner,
  title,
  candidates,
  resolve,
  { skip = false, reroll = null } = {},
) {
  let selected = candidates[0];
  let done = false;
  const finish = (unit) => {
    if (done || surface.destroyed) return;
    done = true;
    resolve(unit);
  };
  const feedback = element('p');
  feedback.setAttribute('role', 'status');
  const surface = new MenuSurface(owner.scene, title, () => {
    if (skip) finish(null);
    else feedback.textContent = 'Choose a lord and press Welcome to continue.';
  });
  owner.domMenu = surface;
  surface.header.querySelector('button').remove();
  if (skip) surface.header.append(button('Skip recruit', () => finish(null)));
  if (reroll)
    surface.header.append(
      button('Reroll', () => {
        if (!done) {
          done = true;
          reroll();
        }
      }),
    );
  const render = () => {
    surface.body.replaceChildren();
    const split = element('div', null, 'mu-split');
    const list = element('div', null, 're-scroll re-party-list');
    for (const candidate of candidates)
      list.append(
        unitRow(
          owner.scene,
          owner.gameData,
          candidate.unit,
          () => {
            selected = candidate;
            render();
            surface.body.querySelector('[aria-pressed="true"]')?.focus();
          },
          selected === candidate,
        ),
      );
    const detail = element('section', null, 'mu-detail');
    const copy = element('div', null, 'mu-copy');
    copy.append(describeUnit(owner.gameData, selected.unit));
    const confirm = button(
      title === 'Lord arrival' ? 'Welcome' : 'Recruit',
      () => finish(selected.unit),
      're-btn re-btn--primary',
    );
    const inspect = button('Full unit details', () => {
      if (owner.inspector && !owner.inspector.destroyed) return;
      surface.root.inert = true;
      owner.inspector = new MobileRosterSheet({
        scene: owner.scene,
        gameData: owner.gameData,
        units: candidates.map((c) => c.unit),
        index: candidates.indexOf(selected),
        run: null,
        onClose: () => {
          owner.inspector.destroy();
          surface.root.inert = false;
          inspect.focus();
        },
      });
    });
    detail.append(copy, inspect, confirm);
    split.append(list, detail);
    surface.body.append(feedback, split);
  };
  surface.body.style.display = 'flex';
  render();
  surface.focusContent();
}

export function showDeploymentMenu(owner, roster, limits, onConfirm, initialNames) {
  const { scene, gameData, runManager } = owner;
  let commander = findCommander(roster);
  const selected = new Set(resolveDeploymentSelection(roster, limits, [...(initialNames || [])]));
  let busy = false;
  const surface = new MenuSurface(scene, 'Deploy units', async () => {
    if (busy || !runManager) return;
    busy = true;
    try {
      const ok = await transitionToScene(
        scene,
        'NodeMap',
        { gameData, runManager },
        { reason: TRANSITION_REASONS.BACK },
      );
      if (ok) owner._cleanup();
      else status.textContent = 'Could not return to map. Try again.';
    } finally {
      busy = false;
    }
  });
  owner.domMenu = surface;
  surface.header.querySelector('button').textContent = 'Back';
  const rosterButton = button('Roster', () => {
    if (busy || (owner.inspector && !owner.inspector.destroyed)) return;
    const names = new Set([...selected].map((unit) => unit.name));
    surface.root.inert = true;
    owner.inspector = new MobileRosterSheet({
      scene,
      gameData,
      units: runManager.roster,
      run: runManager,
      onClose: () => {
        owner.inspector.destroy();
        surface.root.inert = false;
        roster = runManager.getRoster?.() || roster;
        scene.roster = roster;
        commander = findCommander(roster);
        selected.clear();
        if (commander) selected.add(commander);
        for (const unit of roster)
          if (names.has(unit.name) && selected.size < limits.max) selected.add(unit);
        render();
        rosterButton.focus();
      },
    });
  });
  surface.header.append(rosterButton);
  const status = element('p');
  status.setAttribute('role', 'status');
  const list = element('div', null, 're-scroll re-party-list');
  const confirm = button(
    'Deploy',
    () => {
      if (busy || surface.destroyed || selected.size < limits.min || selected.size > limits.max)
        return;
      busy = true;
      owner._cleanup();
      onConfirm(roster.filter((unit) => selected.has(unit)));
    },
    're-btn re-btn--primary',
  );
  const render = () => {
    list.replaceChildren();
    status.textContent = `${selected.size} / ${limits.max} selected · Minimum ${limits.min} · ${{ rout: 'Rout: defeat all enemies', seize: 'Seize: defeat the boss, then capture the throne with a Lord', escape: 'Escape: only Lords must exit; others retreat safely' }[scene.battleParams?.objective] || 'Rout: defeat all enemies'}`;
    confirm.disabled = selected.size < limits.min || selected.size > limits.max;
    for (const unit of roster) {
      const row = unitRow(
        scene,
        gameData,
        unit,
        () => {
          if (busy || unit === commander) return;
          if (selected.has(unit)) selected.delete(unit);
          else if (selected.size < limits.max) selected.add(unit);
          render();
          list.children[roster.indexOf(unit)]?.focus();
        },
        selected.has(unit),
      );
      if (unit === commander) row.append(element('small', 'Commander · Required'));
      row.setAttribute(
        'aria-disabled',
        String(unit === commander || (!selected.has(unit) && selected.size >= limits.max)),
      );
      list.append(row);
    }
  };
  surface.body.style.display = 'flex';
  surface.body.style.flexDirection = 'column';
  surface.body.style.gap = '8px';
  const selectionActions = element('div');
  selectionActions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;flex-shrink:0';
  const restore = button('Same as last battle', () => {
    if (busy) return;
    selected.clear();
    for (const unit of resolveDeploymentSelection(roster, limits, runManager?.lastDeployment))
      selected.add(unit);
    render();
  });
  restore.disabled = !runManager?.lastDeployment?.length;
  const clear = button('Clear optional selections', () => {
    if (busy) return;
    selected.clear();
    if (commander) selected.add(commander);
    render();
  });
  selectionActions.append(restore, clear);
  surface.body.append(status, selectionActions, list, confirm);
  render();
  surface.focusContent();
}
