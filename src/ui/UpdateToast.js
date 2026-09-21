import { isolateDOMInput } from '../utils/domInputBoundary.js';

export function showUpdateToast(onReload, { gameGetter = () => window.__emblemRogueGame } = {}) {
  if (document.getElementById('sw-update-toast')) return;
  const toast = document.createElement('aside');
  toast.id = 'sw-update-toast';
  toast.className = 'sw-update-toast';
  toast.setAttribute('aria-label', 'Game update');
  isolateDOMInput(toast, { keyboard: true });
  const label = document.createElement('span');
  label.className = 'sw-update-label';
  label.textContent = 'Update ready';
  label.setAttribute('role', 'status');
  const restart = document.createElement('button');
  restart.type = 'button';
  restart.className = 'sw-update-restart';
  restart.textContent = 'Restart';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'sw-update-dismiss';
  dismiss.textContent = '×';
  dismiss.setAttribute('aria-label', 'Dismiss update notice');
  const blocked = () =>
    Boolean(
      gameGetter()?.scene?.isActive?.('Battle') ||
      document.querySelector('#game-wrapper [role="dialog"], #game-wrapper .re-screen'),
    );
  const remove = () => {
    window.clearInterval(timer);
    toast.remove();
  };
  restart.onclick = () => {
    if (blocked()) return;
    remove();
    onReload();
  };
  dismiss.onclick = remove;
  toast.append(label, restart, dismiss);
  document.body.append(toast);
  const sync = () => {
    if (!toast.isConnected) {
      window.clearInterval(timer);
      return;
    }
    toast.hidden = blocked();
  };
  const timer = window.setInterval(sync, 250);
  sync();
  return toast;
}
