import { resolveDeploymentSelection } from '../engine/DeploymentSelection.js';
import { traitLines } from './traitContent.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { unitPortrait, withUnitFace } from './unitPortrait.js';
import { getDisplayLevel, inventoryDisplayOrder } from '../engine/UnitManager.js';
import { findCommander } from '../engine/Commander.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { getStaticCombatStats } from '../engine/Combat.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { candidateCards } from './choiceContent.js';
import {
  choiceReducedMotion,
  draftFooter,
  draftRow,
  fitDraft,
  sealChoice,
  statLegend,
  unitCardLabel,
  unitChoiceCard,
} from './choiceCards.js';
import { unitTemperament } from './unitVoiceDisplay.js';

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
export function describeUnit(gameData, unit, scene = null) {
  const box = element('div');
  box.append(
    withUnitFace(element('h3', unit.name), scene, gameData, unit),
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
  for (const trait of traitLines(unit, gameData))
    box.append(element('p', `${trait.name}: ${trait.text}`));
  for (const id of unit.skills || []) {
    const skill = gameData.skills?.find((s) => s.id === id);
    box.append(element('p', `${skill?.name || id}: ${skill?.description || ''}`));
  }
  if (unit.inventory?.length)
    box.append(
      element(
        'p',
        inventoryDisplayOrder(unit)
          .map((w) => `${w === unit.weapon ? 'E ' : ''}${w.name}`)
          .join(' · '),
      ),
    );
  const combat = getStaticCombatStats(unit, unit.weapon);
  box.append(
    element('p', `Atk ${combat.atk} · AS ${combat.as} · Hit ${combat.hit} · Crit ${combat.crit}`),
  );
  return box;
}

// Boss recruit and lord arrival: the draft. Candidates stand side by side as
// cards (portrait, crest, idling sprite, stats against each other, traits,
// the roster cue); selection lifts a card, confirm seals it and hands the
// unit to the caller, whose join ceremony follows. `resolve` is the same
// one-shot command as before; nothing here touches the run.
export function showArrivalMenu(
  owner,
  title,
  candidates,
  resolve,
  { skip = false, reroll = null } = {},
) {
  const lord = title === 'Lord arrival';
  const confirmLabel = lord ? 'Welcome' : 'Recruit';
  let selected = candidates[0];
  let done = false;
  let sealing = false;
  const finish = (unit) => {
    if (done || surface.destroyed) return;
    done = true;
    resolve(unit);
  };
  const decline = () => {
    if (!sealing) finish(null);
  };
  const feedback = element('span', null, 'ch-feedback');
  feedback.setAttribute('role', 'status');
  const surface = new MenuSurface(owner.scene, title, () => {
    if (skip) decline();
    else if (!sealing) feedback.textContent = 'Choose a lord and press Welcome to continue.';
  });
  owner.domMenu = surface;
  surface.root.classList.add('ch-arrival');
  if (choiceReducedMotion(owner.scene)) surface.root.classList.add('is-still');
  surface.header.querySelector('button').remove();
  if (skip) surface.header.append(button('Skip recruit', decline));
  if (reroll)
    surface.header.append(
      button('Reroll', () => {
        if (!done && !sealing) {
          done = true;
          reroll();
        }
      }),
    );
  const units = candidates.map((c) => c.unit);
  const content = candidateCards(units, {
    roster: owner.runManager?.roster || owner.scene?.runManager?.roster || [],
    gameData: owner.gameData,
    temperamentOf: (unit) => unitTemperament(owner.scene, unit),
  });
  const render = () => {
    const row = draftRow(candidates.length, 'ch-candidates');
    candidates.forEach((candidate, i) => {
      const card = unitChoiceCard({
        scene: owner.scene,
        gameData: owner.gameData,
        unit: candidate.unit,
        content: content[i],
        selected: selected === candidate,
        label: unitCardLabel(content[i]),
        onSelect: () => {
          if (sealing || done) return;
          if (selected !== candidate)
            owner.scene?.registry?.get?.('audio')?.playSFX?.('sfx_cursor');
          selected = candidate;
          render();
          surface.body
            .querySelector('.ch-card[aria-pressed="true"]')
            ?.focus({ preventScroll: true });
        },
      });
      row.append(card);
    });
    const confirm = button(
      confirmLabel,
      () => {
        if (sealing || done) return;
        sealing = true;
        for (const b of surface.root.querySelectorAll('button')) b.disabled = true;
        owner.scene?.registry?.get?.('audio')?.playSFX?.('sfx_confirm');
        sealChoice(
          row,
          row.querySelector('.ch-card[aria-pressed="true"]'),
          choiceReducedMotion(owner.scene),
          () => finish(selected.unit),
        );
      },
      're-btn re-btn--primary',
    );
    const inspect = button('Full unit details', () => {
      if (sealing || (owner.inspector && !owner.inspector.destroyed)) return;
      surface.root.inert = true;
      owner.inspector = new MobileRosterSheet({
        scene: owner.scene,
        gameData: owner.gameData,
        units,
        index: candidates.indexOf(selected),
        run: null,
        onClose: () => {
          owner.inspector.destroy();
          surface.root.inert = false;
          inspect.focus();
        },
      });
    });
    const { footer, lead } = draftFooter(inspect, confirm);
    lead.append(statLegend(), feedback);
    surface.body.replaceChildren(row, footer);
    stopFit?.();
    stopFit = fitDraft(row);
  };
  let stopFit = null;
  render();
  surface.body.querySelector('.ch-card[aria-pressed="true"]')?.focus({ preventScroll: true });
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
