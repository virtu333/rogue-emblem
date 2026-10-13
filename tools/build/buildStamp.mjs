// The commit and date a build is stamped with (vite.config.js `define`), read in game by
// src/utils/buildIdentity.js so a bug report can name the exact build it came from.
//
// The commit comes from the CI's own variable first (GitHub Actions' GITHUB_SHA for the
// TestFlight and Play builds and CI, Netlify's COMMIT_REF for the website), then the
// checkout's HEAD, else 'unknown'. Never throws: a build without git still builds.
import { execFileSync } from 'node:child_process';

const SHA_RE = /^[0-9a-f]{7,40}$/i;

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** `{ sha, date }`: the short commit (7 characters, lower case) and the UTC build date. */
export function resolveBuildStamp({ env = process.env, git = gitHead, now = new Date() } = {}) {
  const candidates = [env.GITHUB_SHA, env.COMMIT_REF];
  let full = candidates.find((value) => SHA_RE.test(String(value || '').trim()));
  if (!full) {
    let head;
    try {
      head = String(git() || '').trim();
    } catch {
      head = '';
    }
    full = SHA_RE.test(head) ? head : '';
  }
  return {
    sha: full ? full.trim().slice(0, 7).toLowerCase() : 'unknown',
    date: now.toISOString().slice(0, 10),
  };
}
