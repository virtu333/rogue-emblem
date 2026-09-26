// tools/ios/distributeBuild.mjs: the TestFlight workflow sends each upload to a tester group
// (the public link) and submits it for beta review.
import { describe, it, expect } from 'vitest';
import {
  whatsNewText,
  pickGroup,
  distributionPlan,
  distribute,
} from '../tools/ios/distributeBuild.mjs';

const GROUPS = {
  data: [
    { id: 'g-int', attributes: { name: 'App Store Connect Users', isInternalGroup: true } },
    {
      id: 'g-pub',
      attributes: { name: 'Public Playtest', isInternalGroup: false, publicLinkEnabled: true },
    },
  ],
};

const buildResponse = (processingState, externalBuildState) => ({
  data: [
    {
      type: 'builds',
      id: 'b23',
      attributes: { version: '23', processingState },
      relationships: { buildBetaDetail: { data: { type: 'buildBetaDetails', id: 'd23' } } },
    },
  ],
  included: [{ type: 'buildBetaDetails', id: 'd23', attributes: { externalBuildState } }],
});

/** A fake App Store Connect that answers GETs by path prefix and records every call. */
function fakeApi(routes, { failSubmitWith, detailAfterConflict } = {}) {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push({ method, path: path.split('?')[0], body });
    if (method === 'POST' && path === '/betaAppReviewSubmissions' && failSubmitWith) {
      const error = new Error(`App Store Connect ${failSubmitWith} for POST ${path}`);
      error.status = failSubmitWith;
      throw error;
    }
    if (method !== 'GET') return null;
    if (path.endsWith('/buildBetaDetail?fields[buildBetaDetails]=externalBuildState'))
      return { data: { attributes: { externalBuildState: detailAfterConflict } } };
    const hit = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    return hit ? routes[hit] : { data: [] };
  };
  return { call, calls };
}

const writes = (calls) =>
  calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`);

describe('TestFlight distribution', () => {
  it('uses the given note, else the commit subject without its PR number, capped at 4000', () => {
    expect(whatsNewText('  New music  ', 'ignored')).toBe('New music');
    expect(whatsNewText('', 'Music for every place (#103)')).toBe('Music for every place');
    expect(whatsNewText(undefined, '')).toBe('');
    const long = whatsNewText('x'.repeat(5000));
    expect(long).toHaveLength(4000);
    expect(long.endsWith('…')).toBe(true);
  });

  it('finds the group by name, ignoring case and spaces', () => {
    expect(pickGroup(GROUPS, ' public playtest ').id).toBe('g-pub');
    expect(pickGroup(GROUPS, 'Nobody')).toBeNull();
    expect(pickGroup(null, 'x')).toBeNull();
  });

  it('submits a processed build once, and never a rejected or unprocessed one', () => {
    expect(
      distributionPlan({ processing: 'VALID', external: 'READY_FOR_BETA_SUBMISSION' }),
    ).toEqual({
      ok: true,
      submit: true,
    });
    expect(distributionPlan({ processing: 'VALID', external: 'IN_BETA_TESTING' })).toEqual({
      ok: true,
      submit: false,
    });
    expect(distributionPlan({ processing: 'VALID', internalGroup: true })).toEqual({
      ok: true,
      submit: false,
    });
    expect(distributionPlan({ processing: 'PROCESSING' }).ok).toBe(false);
    expect(distributionPlan({ processing: 'VALID', external: 'BETA_REJECTED' }).ok).toBe(false);
  });

  it('sets What to Test, adds the build to the public group and submits it for review', async () => {
    const { call, calls } = fakeApi({
      '/betaGroups': GROUPS,
      '/builds?': buildResponse('VALID', 'READY_FOR_BETA_SUBMISSION'),
      '/builds/b23/betaBuildLocalizations': { data: [] },
    });
    const lines = await distribute({
      call,
      appId: 'app',
      buildNumber: '23',
      groupName: 'Public Playtest',
      whatsNew: 'New music',
    });
    expect(writes(calls)).toEqual([
      'POST /betaBuildLocalizations',
      'POST /betaGroups/g-pub/relationships/builds',
      'POST /betaAppReviewSubmissions',
    ]);
    const [loc, add, submit] = calls.filter((c) => c.method !== 'GET');
    expect(loc.body.data.attributes).toEqual({ locale: 'en-US', whatsNew: 'New music' });
    expect(loc.body.data.relationships.build.data).toEqual({ type: 'builds', id: 'b23' });
    expect(add.body).toEqual({ data: [{ type: 'builds', id: 'b23' }] });
    expect(submit.body.data.relationships.build.data.id).toBe('b23');
    expect(lines.join('\n')).toContain('Submitted for beta review');
  });

  it('updates an existing What to Test note instead of adding another', async () => {
    const { call, calls } = fakeApi({
      '/betaGroups': GROUPS,
      '/builds?': buildResponse('VALID', 'READY_FOR_BETA_SUBMISSION'),
      '/builds/b23/betaBuildLocalizations': {
        data: [{ id: 'loc1', attributes: { locale: 'en-US', whatsNew: 'old' } }],
      },
    });
    await distribute({
      call,
      appId: 'a',
      buildNumber: '23',
      groupName: 'Public Playtest',
      whatsNew: 'new',
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.path).toBe('/betaBuildLocalizations/loc1');
    expect(patch.body.data).toEqual({
      type: 'betaBuildLocalizations',
      id: 'loc1',
      attributes: { whatsNew: 'new' },
    });
  });

  it('skips the note when there is none and the review when already submitted', async () => {
    const { call, calls } = fakeApi({
      '/betaGroups': GROUPS,
      '/builds?': buildResponse('VALID', 'WAITING_FOR_BETA_REVIEW'),
    });
    await distribute({
      call,
      appId: 'a',
      buildNumber: '23',
      groupName: 'Public Playtest',
      whatsNew: '',
    });
    expect(writes(calls)).toEqual(['POST /betaGroups/g-pub/relationships/builds']);
  });

  it('accepts a submission conflict only when the build is in fact submitted', async () => {
    const routes = {
      '/betaGroups': GROUPS,
      '/builds?': buildResponse('VALID', 'READY_FOR_BETA_SUBMISSION'),
    };
    const ok = fakeApi(routes, {
      failSubmitWith: 409,
      detailAfterConflict: 'WAITING_FOR_BETA_REVIEW',
    });
    const lines = await distribute({
      ...ok,
      appId: 'a',
      buildNumber: '23',
      groupName: 'Public Playtest',
    });
    expect(lines.join('\n')).toContain('Already submitted');

    const bad = fakeApi(routes, {
      failSubmitWith: 409,
      detailAfterConflict: 'READY_FOR_BETA_SUBMISSION',
    });
    await expect(
      distribute({ ...bad, appId: 'a', buildNumber: '23', groupName: 'Public Playtest' }),
    ).rejects.toThrow('409');

    const server = fakeApi(routes, { failSubmitWith: 500 });
    await expect(
      distribute({ ...server, appId: 'a', buildNumber: '23', groupName: 'Public Playtest' }),
    ).rejects.toThrow('500');
  });

  it('adds to an internal group without a review', async () => {
    const { call, calls } = fakeApi({
      '/betaGroups': GROUPS,
      '/builds?': buildResponse('VALID', 'READY_FOR_BETA_SUBMISSION'),
    });
    const lines = await distribute({
      call,
      appId: 'a',
      buildNumber: '23',
      groupName: 'App Store Connect Users',
    });
    expect(writes(calls)).toEqual(['POST /betaGroups/g-int/relationships/builds']);
    expect(lines.join('\n')).toContain('Internal testers can install it now.');
  });

  it('fails clearly for a missing group, a missing build or an unprocessed build, writing nothing', async () => {
    const missingGroup = fakeApi({ '/betaGroups': GROUPS });
    await expect(
      distribute({ ...missingGroup, appId: 'a', buildNumber: '23', groupName: 'Friends' }),
    ).rejects.toThrow(
      'No TestFlight group named "Friends" (groups: "App Store Connect Users", "Public Playtest")',
    );

    const missingBuild = fakeApi({ '/betaGroups': GROUPS, '/builds?': { data: [] } });
    await expect(
      distribute({ ...missingBuild, appId: 'a', buildNumber: '23', groupName: 'Public Playtest' }),
    ).rejects.toThrow('Build 23 is not in App Store Connect');

    const processing = fakeApi({ '/betaGroups': GROUPS, '/builds?': buildResponse('PROCESSING') });
    await expect(
      distribute({ ...processing, appId: 'a', buildNumber: '23', groupName: 'Public Playtest' }),
    ).rejects.toThrow('the build is processing');

    for (const f of [missingGroup, missingBuild, processing]) expect(writes(f.calls)).toEqual([]);
  });

  it('in a dry run only looks up the group', async () => {
    const { call, calls } = fakeApi({ '/betaGroups': GROUPS });
    const lines = await distribute({
      call,
      appId: 'a',
      groupName: 'Public Playtest',
      dryRun: true,
    });
    expect(calls.map((c) => c.path)).toEqual(['/betaGroups']);
    expect(lines[0]).toBe(
      'Would send each upload to **Public Playtest** (external group, public link on) and submit it for beta review.',
    );
  });
});
