// A stand-in for PrologueTip.showPrologueTip in unit tests (vi.mock): the tip's
// options are kept, `read()` plays the player reading it (Got it, or long enough on
// screen), and `close(read)` behaves as GuidanceNote's handle does.
import { vi } from 'vitest';

export function fakeTipHandle(opts) {
  let read = false;
  const markRead = () => {
    if (read) return;
    read = true;
    opts?.onRead?.();
  };
  const handle = {
    opts,
    closed: null,
    read: markRead,
    isRead: () => read,
    onClose: null,
    close: vi.fn((acknowledged = false) => {
      if (handle.closed !== null) return;
      handle.closed = Boolean(acknowledged);
      if (acknowledged) markRead();
      handle.onClose?.(read);
    }),
  };
  return handle;
}
