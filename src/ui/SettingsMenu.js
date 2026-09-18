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
      'Effects',
      () => settings.getSFXVolume(),
      (value) => {
        settings.setSFXVolume(value);
        audio?.setSFXVolume(value);
        audio?.playSFX('sfx_confirm');
      },
    );
    const reduced = button(
      '',
      () => {
        settings.setReducedEffects(!settings.getReducedEffects());
        render();
      },
      're-btn re-setting',
    );
    const render = () => {
      const enabled = settings.getReducedEffects?.() ?? false;
      reduced.textContent = `Reduced effects · ${enabled ? 'On' : 'Off'}`;
      reduced.setAttribute('aria-pressed', String(enabled));
    };
    render();
    list.append(reduced);
    this.surface.body.append(list);
    this.surface.focusContent();
  }
  destroy() {
    this.surface.destroy();
  }
}
