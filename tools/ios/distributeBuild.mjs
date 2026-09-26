#!/usr/bin/env node
// Sends an uploaded build to a TestFlight tester group: sets its "What to Test" note, adds it
// to the group and, for an external group (such as the public link), submits it for beta
// review. Testers get it once Apple approves it.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=AuthKey.p8 \
//     node tools/ios/distributeBuild.mjs --bundle-id com.davechen.emblemrogue --build 23 \
//       --group "Public Playtest" --whats-new "New music" [--dry-run]
//
// --dry-run only checks that the group exists (for builds that were never uploaded).
// Markdown goes to stdout; diagnostics go to stderr. Exits 1 when the build could not be
// sent, 2 on any other failure.
import { ALL_PROCESSING_STATES, api, findApp, tokenFromEnv } from './nextBuildNumber.mjs';

// TestFlight's limit for "What to Test".
const WHATS_NEW_MAX = 4000;

// External states in which the build is already submitted or out to testers.
const ALREADY_SUBMITTED = new Set([
  'WAITING_FOR_BETA_REVIEW',
  'IN_BETA_REVIEW',
  'BETA_APPROVED',
  'IN_BETA_TESTING',
]);

/** "What to Test" text: the given note, or the commit subject without its "(#123)". */
export function whatsNewText(note, commitSubject = '') {
  const text = (note || '').trim() || commitSubject.replace(/\s*\(#\d+\)\s*$/, '').trim();
  return text.length > WHATS_NEW_MAX ? `${text.slice(0, WHATS_NEW_MAX - 1)}…` : text;
}

/** The group named `name` (case-insensitive) from a `/betaGroups` response. */
export function pickGroup(response, name) {
  const wanted = name.trim().toLowerCase();
  return (
    (response?.data || []).find(
      (g) => (g.attributes?.name || '').trim().toLowerCase() === wanted,
    ) || null
  );
}

/** What still needs doing for the build, given its processing and external states. */
export function distributionPlan({ processing, external, internalGroup }) {
  if (processing !== 'VALID')
    return {
      ok: false,
      reason: `the build is ${processing ? processing.toLowerCase() : 'not processed'}`,
    };
  if (internalGroup) return { ok: true, submit: false };
  if (ALREADY_SUBMITTED.has(external)) return { ok: true, submit: false };
  if (external === 'BETA_REJECTED')
    return { ok: false, reason: 'Apple rejected it in beta review' };
  return { ok: true, submit: true };
}

/**
 * Does the work through `call(method, path, body)` (the App Store Connect API). Returns
 * Markdown lines describing what happened; throws with a readable message on failure.
 */
export async function distribute({ call, appId, buildNumber, groupName, whatsNew, dryRun }) {
  const groups = await call(
    'GET',
    `/betaGroups?filter[app]=${appId}&limit=200&fields[betaGroups]=name,isInternalGroup,publicLinkEnabled`,
  );
  const group = pickGroup(groups, groupName);
  if (!group) {
    const names = (groups?.data || []).map((g) => `"${g.attributes?.name}"`).join(', ') || 'none';
    throw new Error(`No TestFlight group named "${groupName}" (groups: ${names}).`);
  }
  const internalGroup = Boolean(group.attributes?.isInternalGroup);
  const kind = internalGroup ? 'internal' : 'external';
  if (dryRun)
    return [
      `Would send each upload to **${group.attributes.name}** (${kind} group` +
        `${group.attributes?.publicLinkEnabled ? ', public link on' : ''})` +
        `${internalGroup ? '' : ' and submit it for beta review'}.`,
    ];

  const builds = await call(
    'GET',
    `/builds?filter[app]=${appId}&filter[version]=${encodeURIComponent(buildNumber)}` +
      `&filter[preReleaseVersion.platform]=IOS&${ALL_PROCESSING_STATES}&include=buildBetaDetail` +
      '&fields[builds]=version,processingState,buildBetaDetail' +
      '&fields[buildBetaDetails]=externalBuildState',
  );
  const build = (builds?.data || [])[0];
  if (!build) throw new Error(`Build ${buildNumber} is not in App Store Connect.`);
  const detailRef = build.relationships?.buildBetaDetail?.data;
  const detail = (builds.included || []).find(
    (i) => i.type === 'buildBetaDetails' && i.id === detailRef?.id,
  );
  const plan = distributionPlan({
    processing: build.attributes?.processingState,
    external: detail?.attributes?.externalBuildState,
    internalGroup,
  });
  if (!plan.ok) throw new Error(`Build ${buildNumber} cannot be sent: ${plan.reason}.`);

  const lines = [];
  if (whatsNew) {
    const localizations = await call(
      'GET',
      `/builds/${build.id}/betaBuildLocalizations?fields[betaBuildLocalizations]=locale,whatsNew`,
    );
    const existing = (localizations?.data || []).find((l) => l.attributes?.locale === 'en-US');
    if (existing)
      await call('PATCH', `/betaBuildLocalizations/${existing.id}`, {
        data: { type: 'betaBuildLocalizations', id: existing.id, attributes: { whatsNew } },
      });
    else
      await call('POST', '/betaBuildLocalizations', {
        data: {
          type: 'betaBuildLocalizations',
          attributes: { locale: 'en-US', whatsNew },
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
    lines.push(`What to Test: ${whatsNew.split('\n')[0]}`);
  }

  await call('POST', `/betaGroups/${group.id}/relationships/builds`, {
    data: [{ type: 'builds', id: build.id }],
  });
  lines.push(`Added build ${buildNumber} to **${group.attributes.name}** (${kind} group).`);

  if (plan.submit) {
    try {
      await call('POST', '/betaAppReviewSubmissions', {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: { build: { data: { type: 'builds', id: build.id } } },
        },
      });
      lines.push('Submitted for beta review; testers get it once Apple approves it.');
    } catch (error) {
      // A conflict is fine only if the build turns out to be submitted already.
      if (error.status !== 409) throw error;
      const now = await call(
        'GET',
        `/builds/${build.id}/buildBetaDetail?fields[buildBetaDetails]=externalBuildState`,
      );
      const state = now?.data?.attributes?.externalBuildState;
      if (!ALREADY_SUBMITTED.has(state)) throw error;
      lines.push(`Already submitted for beta review (${state}).`);
    }
  } else if (!internalGroup) {
    lines.push(`Beta review: ${detail?.attributes?.externalBuildState}, nothing to submit.`);
  } else {
    lines.push('Internal testers can install it now.');
  }
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bundleId = arg('--bundle-id');
  const buildNumber = arg('--build');
  const groupName = (arg('--group') || '').trim();
  const dryRun = args.includes('--dry-run');
  if (!bundleId || !groupName || (!dryRun && !buildNumber))
    throw new Error('need --bundle-id, --group and --build (or --dry-run)');

  const token = tokenFromEnv();
  const app = await findApp(bundleId, token);
  const call = (method, path, body) => api(path, token, { method, body });
  const whatsNew = whatsNewText(arg('--whats-new'), arg('--commit-subject') || '');

  let lines;
  try {
    lines = await distribute({ call, appId: app.id, buildNumber, groupName, whatsNew, dryRun });
  } catch (error) {
    const message = error.message || String(error);
    process.stdout.write(`### TestFlight testers\n\nNot sent to ${groupName}: ${message}\n`);
    console.error(
      `::error::Build ${buildNumber ?? ''} was not sent to ${groupName}: ${message} ` +
        `Add it in App Store Connect -> TestFlight -> ${groupName}.`,
    );
    process.exit(1);
  }
  process.stdout.write(`### TestFlight testers\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(2);
  });
}
