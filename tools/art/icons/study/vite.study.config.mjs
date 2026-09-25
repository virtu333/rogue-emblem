// Dev server config for study captures from a worktree whose node_modules is a symlink
// to the main checkout: allow serving files outside the worktree (fonts from
// @fontsource), otherwise identical to vite.config.js.
import base from '../../../../vite.config.js';

export default { ...base, server: { ...(base.server || {}), fs: { strict: false } } };
