import { MenuSurface, element, button } from './MenuSurface.js';
import { battleSpeed, combatDuration } from '../utils/combatTiming.js';
import { progressionRows } from './progressionDisplay.js';
import { levelUpContent } from './growthContent.js';
import { voiceContext } from '../engine/UnitVoice.js';

// Display only: gains are already applied by the caller. Never award XP here.
export function progressionResult(scene, unit, result, promotion, skills, growths, close) {
  const cells = [];
  let revealed =
    scene.registry.get('settings')?.getReduceMotion?.() === true ||
    battleSpeed(scene) === 'instant';
  let timer = null;
  let index = 0;
  let continueButton;
  const status = element('p', revealed ? 'Continue when ready.' : 'Revealing stat gains…');
  status.setAttribute('role', 'status');
  const revealAll = () => {
    clearInterval(timer);
    for (const { cell, text, gain } of cells) {
      cell.textContent = text;
      cell.classList.toggle('re-gain', gain > 0);
    }
    revealed = true;
    if (continueButton) continueButton.textContent = 'Continue';
    status.textContent = 'Gains revealed. Continue when ready.';
  };
  const advance = () => {
    if (!revealed) revealAll();
    else close();
  };
  const surface = new MenuSurface(scene, promotion ? 'Promotion' : 'Level up', advance, {
    modal: true,
  });
  surface.root.classList.add('re-progression');
  surface.header.querySelector('button').remove();
  const level = result.isExtended ? `20+${result.extendedLevel}` : result.newLevel;
  const heading = element('h3', `${unit.name} · ${unit.className} · Lv ${level}`);
  const table = element('dl', null, 're-gain-grid');
  const rows = progressionRows(unit, result, promotion);
  for (const { stat, gain, before, after } of rows) {
    const text = `${after}${gain ? ` (+${gain})` : ''}`;
    const cell = element('dd', revealed ? text : String(before), revealed && gain ? 're-gain' : '');
    cells.push({ cell, text, gain });
    table.append(element('dt', stat), cell);
  }
  surface.body.append(heading, table);
  if (!promotion) {
    const { quote } = levelUpContent(
      unit,
      result,
      skills,
      voiceContext({
        gameData: scene.gameData,
        runManager: scene.runManager,
        units: scene.playerUnits,
      }),
    );
    if (quote) surface.body.append(element('p', `“${quote}”`, 're-progression-quote'));
  }
  if (growths && Object.keys(growths).length) {
    surface.body.append(element('h3', 'Growth bonuses'));
    for (const [stat, bonus] of Object.entries(growths))
      surface.body.append(element('p', `${stat} ${bonus >= 0 ? '+' : ''}${bonus}%`));
  }
  if (skills.length) {
    surface.body.append(element('h3', 'Learned skills'));
    for (const name of skills) surface.body.append(element('p', name));
  }
  continueButton = button(
    revealed ? 'Continue' : 'Reveal gains',
    advance,
    're-btn re-btn--primary',
  );
  surface.body.append(status);
  const footer = element('footer', null, 're-footer re-progression-footer');
  footer.append(continueButton);
  surface.root.append(footer);
  if (!revealed)
    timer = setInterval(
      () => {
        const entry = cells[index++];
        if (entry) {
          entry.cell.textContent = entry.text;
          if (entry.gain) {
            entry.cell.classList.add('re-gain');
            scene.registry.get('audio')?.playSFX('sfx_cursor');
          }
        }
        if (index >= cells.length) revealAll();
      },
      combatDuration(scene, 120),
    );
  const destroy = surface.destroy.bind(surface);
  surface.destroy = () => {
    clearInterval(timer);
    destroy();
  };
  continueButton.focus({ preventScroll: true });
  surface.body.scrollTop = 0;
  return surface;
}
