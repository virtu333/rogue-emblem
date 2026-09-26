#!/usr/bin/env node
// The next iOS build number (CFBundleVersion) for a TestFlight upload: one above the
// highest build App Store Connect already has for the app (processing, expired or
// valid, any version), and never below --min (the project's CURRENT_PROJECT_VERSION).
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=AuthKey.p8 \
//     node tools/ios/nextBuildNumber.mjs --bundle-id com.davechen.emblemrogue --min 20
//
// Prints the number on stdout; diagnostics go to stderr. No dependencies: the App Store
// Connect API token is an ES256 JWT signed with node:crypto.
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** An App Store Connect API token (valid for `ttlSeconds`, at most 20 minutes). */
export function appStoreConnectToken({ keyId, issuerId, privateKeyPem, ttlSeconds = 600, now }) {
  const iat = Math.floor((now ?? Date.now()) / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    iat,
    exp: iat + Math.min(ttlSeconds, 1200),
    aud: 'appstoreconnect-v1',
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(privateKeyPem);
  // JWS ES256 wants the raw r||s signature, not DER.
  const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${b64url(signature)}`;
}

/** Highest numeric build number among `versions` (strings like "21" or "1.0.3"), or 0. */
export function highestBuildNumber(versions) {
  let best = 0;
  for (const v of versions || []) {
    // CFBundleVersion may be dotted; TestFlight orders by the leading integer for our scheme.
    const n = Number.parseInt(String(v).split('.')[0], 10);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

/** max(highest existing + 1, min). */
export function nextBuildNumber(existingVersions, min = 1) {
  return Math.max(highestBuildNumber(existingVersions) + 1, Number(min) || 1);
}

/**
 * Call an App Store Connect API path (or a full `links.next` URL). GET by default; `body` is
 * sent as JSON. Returns the parsed response, or null for an empty one (204).
 */
export async function api(path, token, { method = 'GET', body } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    const error = new Error(
      `App Store Connect ${res.status} for ${method} ${url.replace(API, '')}: ${text.slice(0, 400)}`,
    );
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Rejected and failed builds still use up their build number, so every state counts.
export const ALL_PROCESSING_STATES = 'filter[processingState]=PROCESSING,FAILED,INVALID,VALID';

/** A token for the key in ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_PATH. */
export function tokenFromEnv(env = process.env) {
  const { ASC_KEY_ID: keyId, ASC_ISSUER_ID: issuerId, ASC_KEY_PATH: keyPath } = env;
  if (!keyId || !issuerId || !keyPath)
    throw new Error('need ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH');
  return appStoreConnectToken({ keyId, issuerId, privateKeyPem: readFileSync(keyPath, 'utf8') });
}

/** The App Store Connect app record for `bundleId`. */
export async function findApp(bundleId, token) {
  const apps = await api(
    `/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId,name`,
    token,
  );
  const app = (apps.data || []).find((a) => a.attributes?.bundleId === bundleId);
  if (!app)
    throw new Error(
      `No App Store Connect app with bundle ID ${bundleId} is visible to this API key ` +
        '(create the app record, or give the key access to it).',
    );
  console.error(`App Store Connect app: ${app.attributes?.name} (${app.id})`);
  return app;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bundleId = arg('--bundle-id');
  const min = Number(arg('--min') || 1);
  if (!bundleId) throw new Error('need --bundle-id');

  const token = tokenFromEnv();
  const app = await findApp(bundleId, token);

  const versions = [];
  let next = `/builds?filter[app]=${app.id}&${ALL_PROCESSING_STATES}&fields[builds]=version&limit=200`;
  for (let page = 0; next && page < 20; page++) {
    const res = await api(next, token);
    for (const b of res.data || []) versions.push(b.attributes?.version);
    next = res.links?.next || null;
  }
  const n = nextBuildNumber(versions, min);
  console.error(
    `Existing builds: ${versions.length}; highest ${highestBuildNumber(versions)}; next ${n}`,
  );
  process.stdout.write(`${n}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
