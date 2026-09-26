#!/usr/bin/env node
// What App Store Connect has done with the app's recent builds: Apple's processing result
// and the TestFlight state of each, as Markdown for a GitHub step summary.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=AuthKey.p8 \
//     node tools/ios/buildStatus.mjs --bundle-id com.davechen.emblemrogue [--wait-for 22]
//
// --wait-for N polls until build N has finished processing (--timeout-minutes, default 30)
// and exits 1 if Apple rejected it. Any other failure (the API, the key) exits 2. Markdown
// goes to stdout; diagnostics go to stderr.
import { ALL_PROCESSING_STATES, api, findApp, tokenFromEnv } from './nextBuildNumber.mjs';

const PROCESSING = {
  PROCESSING: 'still processing',
  VALID: 'processed',
  INVALID: 'rejected by Apple',
  FAILED: 'processing failed',
};

const TESTFLIGHT = {
  PROCESSING: 'processing',
  PROCESSING_EXCEPTION: 'processing error',
  MISSING_EXPORT_COMPLIANCE: 'needs the encryption answer',
  IN_EXPORT_COMPLIANCE_REVIEW: 'in encryption review',
  READY_FOR_BETA_TESTING: 'ready to test',
  IN_BETA_TESTING: 'in testing',
  EXPIRED: 'expired',
};

/** Builds from a `/builds?include=preReleaseVersion,buildBetaDetail` response, newest first. */
export function buildRows(response) {
  const included = new Map(
    (response?.included || []).map((item) => [`${item.type}:${item.id}`, item.attributes || {}]),
  );
  const related = (build, name) => {
    const ref = build.relationships?.[name]?.data;
    return ref ? included.get(`${ref.type}:${ref.id}`) || {} : {};
  };
  return (response?.data || [])
    .map((build) => {
      const a = build.attributes || {};
      return {
        build: String(a.version ?? ''),
        version: related(build, 'preReleaseVersion').version || '?',
        platform: related(build, 'preReleaseVersion').platform || '',
        uploaded: a.uploadedDate || '',
        processing: a.processingState || '',
        expired: Boolean(a.expired),
        internal: related(build, 'buildBetaDetail').internalBuildState || '',
      };
    })
    .sort((x, y) => String(y.uploaded).localeCompare(String(x.uploaded)));
}

/** Rows from the build uploads endpoint (App Store Connect API 4.0), with Apple's messages. */
export function uploadRows(response) {
  return (response?.data || []).map((upload) => {
    const a = upload.attributes || {};
    const state = a.state || {};
    const messages = (list) =>
      (list || []).map((m) => [m.code, m.description].filter(Boolean).join(': ')).filter(Boolean);
    return {
      build: String(a.cfBundleVersion ?? ''),
      version: a.cfBundleShortVersionString || '?',
      created: a.createdDate || a.uploadedDate || '',
      state: typeof state === 'string' ? state : state.state || '',
      errors: messages(state.errors),
      warnings: messages(state.warnings),
    };
  });
}

/** 'pending' until build `buildNumber` exists and is done processing, then 'valid' or 'invalid'. */
export function waitVerdict(rows, buildNumber) {
  const row = rows.find((r) => r.build === String(buildNumber));
  if (!row || !row.processing || row.processing === 'PROCESSING') return 'pending';
  return row.processing === 'VALID' ? 'valid' : 'invalid';
}

const label = (map, state) => (state ? `${map[state] || state.toLowerCase()} (\`${state}\`)` : '—');
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const when = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : '—';
};

/** Markdown for the step summary; `focus` is the build number this run cares about. */
export function statusMarkdown({ appName, rows, uploads = null, focus = null }) {
  const lines = [`### App Store Connect: ${appName}`, ''];
  if (focus) {
    const row = rows.find((r) => r.build === String(focus));
    if (!row) lines.push(`Build ${focus} is not in App Store Connect yet.`, '');
    else
      lines.push(
        `Build ${focus} (version ${row.version}): ${label(PROCESSING, row.processing)}` +
          (row.internal ? `; TestFlight: ${label(TESTFLIGHT, row.internal)}` : '') +
          '.',
        '',
      );
  }
  if (rows.length) {
    lines.push('| Build | Version | Uploaded | Apple processing | TestFlight |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of rows)
      lines.push(
        `| ${cell(r.build)} | ${cell(r.version)}${r.platform && r.platform !== 'IOS' ? ` ${cell(r.platform)}` : ''} | ${when(r.uploaded)} | ` +
          `${label(PROCESSING, r.processing)} | ${r.expired ? 'expired' : label(TESTFLIGHT, r.internal)} |`,
      );
  } else lines.push('No builds yet.');
  if (uploads?.length) {
    lines.push('', '#### Recent uploads', '');
    for (const u of uploads) {
      lines.push(
        `- Build ${u.build} (version ${u.version}), ${when(u.created)}: \`${u.state || '?'}\``,
      );
      for (const e of u.errors) lines.push(`  - Error: ${e}`);
      for (const w of u.warnings) lines.push(`  - Warning: ${w}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

async function fetchRows(appId, token, limit) {
  const fields =
    'fields[builds]=version,uploadedDate,processingState,expired,preReleaseVersion,buildBetaDetail' +
    '&fields[preReleaseVersions]=version,platform&fields[buildBetaDetails]=internalBuildState';
  const res = await api(
    `/builds?filter[app]=${appId}&${ALL_PROCESSING_STATES}&sort=-uploadedDate&limit=${limit}` +
      `&include=preReleaseVersion,buildBetaDetail&${fields}`,
    token,
  );
  return buildRows(res);
}

// Newer API; an upload Apple turned away before it became a build only shows up here.
async function fetchUploads(appId, token, limit) {
  try {
    return uploadRows(await api(`/apps/${appId}/buildUploads?limit=${limit}`, token));
  } catch (error) {
    console.error(`Build uploads unavailable: ${error.message || error}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const bundleId = arg('--bundle-id');
  const waitFor = arg('--wait-for');
  const timeoutMinutes = Number(arg('--timeout-minutes') || 30);
  const limit = Number(arg('--limit') || 10);
  if (!bundleId) throw new Error('need --bundle-id');

  let token = tokenFromEnv();
  let tokenAt = Date.now();
  const app = await findApp(bundleId, token);
  const appName = app.attributes?.name || bundleId;

  let rows = await fetchRows(app.id, token, limit);
  if (waitFor) {
    const deadline = Date.now() + timeoutMinutes * 60_000;
    while (waitVerdict(rows, waitFor) === 'pending' && Date.now() < deadline) {
      const row = rows.find((r) => r.build === String(waitFor));
      console.error(
        `Build ${waitFor}: ${row ? row.processing || 'no state yet' : 'not listed yet'}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      if (Date.now() - tokenAt > 8 * 60_000) {
        token = tokenFromEnv();
        tokenAt = Date.now();
      }
      rows = await fetchRows(app.id, token, limit);
    }
  }
  const uploads = await fetchUploads(app.id, token, limit);
  process.stdout.write(statusMarkdown({ appName, rows, uploads, focus: waitFor }));

  if (waitFor) {
    const verdict = waitVerdict(rows, waitFor);
    if (verdict === 'invalid') {
      console.error(`::error::Apple did not accept build ${waitFor}; see the run summary.`);
      process.exit(1);
    }
    if (verdict === 'pending')
      console.error(
        `::warning::Build ${waitFor} was still processing after ${timeoutMinutes} minutes; run the workflow in status mode later.`,
      );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(2);
  });
}
