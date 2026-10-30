// survivorsEntry.js — whether Home Base offers Darkest Before Dawn, the survivors mode
// (docs/specs/survivors-mode.md). Web only: the iOS and Android apps never show it (their
// download size and review stay as they are). While it is a prototype it shows only where
// review routes run (the dev server and Netlify deploy previews), never on the live site.
import { nativeCapacitor } from './nativeSaveMirror.js';

export function survivorsEntryShown({ native = nativeCapacitor(), env = import.meta.env } = {}) {
  if (native) return false;
  return Boolean(env?.DEV) || env?.VITE_DEV_ROUTES === 'true';
}
