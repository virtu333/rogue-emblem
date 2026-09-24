import { BATTLE_SPEEDS } from '../utils/combatTiming.js';
import { MenuSurface, element, button } from './MenuSurface.js';
export class SettingsMenu {
  constructor(scene, onClose) {
    this.surface = new MenuSurface(scene, 'Settings', onClose, { modal: true });
    const settings = scene.registry.get('settings');
    const audio = scene.registry.get('audio');
    const list = element('div', null, 're-scroll re-menu');
    const volume = (label, read, write) => {
      const row = element('div', null, 're-card re-setting');
      const output = element('output');
      output.setAttribute('aria-live', 'polite');
      const render = () => {
        output.textContent = `${Math.round(read() * 100)}%`;
      };
      const adjust = (delta) => {
        write(Math.max(0, Math.min(1, Math.round((read() + delta) * 10) / 10)));
        render();
      };
      const down = button('−', () => adjust(-0.1));
      down.setAttribute('aria-label', `Decrease ${label.toLowerCase()}`);
      const up = button('+', () => adjust(0.1));
      up.setAttribute('aria-label', `Increase ${label.toLowerCase()}`);
      row.append(element('span', label), down, output, up);
      render();
      list.append(row);
    };
    volume(
      'Music',
      () => settings.getMusicVolume(),
      (value) => {
        settings.setMusicVolume(value);
        audio?.setMusicVolume(value);
      },
    );
    volume(
      'Sound effects',
      () => settings.getSFXVolume(),
      (value) => {
        settings.setSFXVolume(value);
        audio?.setSFXVolume(value);
        audio?.playSFX('sfx_confirm');
      },
    );
    const toggle = (label, read, write, help, values = ['Off', 'On']) => {
      const control = button(
        '',
        () => {
          write(!read());
          render();
        },
        're-btn re-setting',
      );
      const render = () => {
        const enabled = read();
        control.textContent = `${label} · ${values[Number(enabled)]}`;
        control.setAttribute('aria-pressed', String(enabled));
      };
      render();
      list.append(control, element('p', help, 're-muted'));
    };
    toggle(
      'Contextual helpers',
      () => settings.getHints?.() !== false,
      (value) => settings.setHints(value),
      'Show brief first-use explanations. The practice tutorial remains available separately.',
    );
    toggle(
      'Skip seen dialogue',
      () => settings.getSkipSeenDialogue?.() === true,
      (value) => settings.setSkipSeenDialogue(value),
      'Automatically skip run openings and act transitions already read in this save slot. New story variants, bosses and recruitment still appear.',
    );
    const hintStatus = element('p', '', 're-muted');
    hintStatus.setAttribute('role', 'status');
    list.append(
      button('Reset hints for this save slot', () => {
        const hints = scene.registry.get('hints');
        hints?.reset?.();
        hintStatus.textContent = hints
          ? 'Hints reset for this save slot.'
          : 'Start or select a save slot first.';
      }),
      hintStatus,
    );
    toggle(
      'Reduce motion',
      () => settings.getReduceMotion(),
      (value) => settings.setReduceMotion(value),
      'Keep combat information still. Removes lunges, sliding banners and camera shake.',
    );
    toggle(
      'Effects quality',
      () => settings.getEffectsQuality() === 'high',
      (value) => settings.setEffectsQuality(value ? 'high' : 'low'),
      'Low simplifies visual effects. Dialogue and combat information remain visible.',
      ['Low', 'High'],
    );
    const speed = button(
      '',
      () => {
        const index = BATTLE_SPEEDS.indexOf(settings.getBattleSpeed());
        settings.setBattleSpeed(BATTLE_SPEEDS[(index + 1) % BATTLE_SPEEDS.length]);
        renderSpeed();
      },
      're-btn re-setting',
    );
    const renderSpeed = () => {
      const value = settings.getBattleSpeed();
      speed.textContent = `Battle speed · ${value[0].toUpperCase()}${value.slice(1)}`;
    };
    renderSpeed();
    list.append(
      speed,
      element(
        'p',
        'Normal / Fast / Instant. Speeds up combat effects; dialogue and decisions stay at your pace.',
        're-muted',
      ),
    );
    this.surface.body.append(list);
    this.surface.focusContent();
  }
  destroy() {
    this.surface.destroy();
  }
}
