// tools/ios/buildStatus.mjs: the TestFlight workflow's report of what App Store Connect did
// with each uploaded build.
import { describe, it, expect } from 'vitest';
import { buildRows, uploadRows, waitVerdict, statusMarkdown } from '../tools/ios/buildStatus.mjs';

const build = (id, version, uploadedDate, processingState, prv, detail, expired = false) => ({
  type: 'builds',
  id,
  attributes: { version, uploadedDate, processingState, expired },
  relationships: {
    preReleaseVersion: { data: prv ? { type: 'preReleaseVersions', id: prv } : null },
    buildBetaDetail: { data: detail ? { type: 'buildBetaDetails', id: detail } : null },
  },
});

const response = {
  data: [
    build('b21', '21', '2026-09-20T10:00:00.000-07:00', 'VALID', 'v1', 'd21'),
    build('b22', '22', '2026-09-25T19:47:25.000-07:00', 'INVALID', 'v010', 'd22'),
  ],
  included: [
    { type: 'preReleaseVersions', id: 'v1', attributes: { version: '1.0', platform: 'IOS' } },
    { type: 'preReleaseVersions', id: 'v010', attributes: { version: '0.1.0', platform: 'IOS' } },
    {
      type: 'buildBetaDetails',
      id: 'd21',
      attributes: { internalBuildState: 'IN_BETA_TESTING', externalBuildState: 'IN_BETA_TESTING' },
    },
    {
      type: 'buildBetaDetails',
      id: 'd22',
      attributes: { internalBuildState: 'PROCESSING_EXCEPTION' },
    },
  ],
};

describe('App Store Connect build status', () => {
  it('joins each build to its version and TestFlight state, newest upload first', () => {
    const rows = buildRows(response);
    expect(rows.map((r) => r.build)).toEqual(['22', '21']);
    expect(rows[0]).toMatchObject({
      version: '0.1.0',
      processing: 'INVALID',
      internal: 'PROCESSING_EXCEPTION',
    });
    expect(rows[1]).toMatchObject({
      version: '1.0',
      processing: 'VALID',
      internal: 'IN_BETA_TESTING',
      external: 'IN_BETA_TESTING',
    });
  });

  it('shows a processed build that no external group has yet', () => {
    const [row] = buildRows({
      data: [build('b22', '22', '2026-09-26T02:47:25Z', 'VALID', 'v', 'd')],
      included: [
        { type: 'preReleaseVersions', id: 'v', attributes: { version: '0.1.0', platform: 'IOS' } },
        {
          type: 'buildBetaDetails',
          id: 'd',
          attributes: {
            internalBuildState: 'READY_FOR_BETA_TESTING',
            externalBuildState: 'READY_FOR_BETA_SUBMISSION',
          },
        },
      ],
    });
    expect(statusMarkdown({ appName: 'Rogue Dawn', rows: [row], focus: 22 })).toContain(
      'Build 22 (version 0.1.0): processed (`VALID`); internal testers: ready to test ' +
        '(`READY_FOR_BETA_TESTING`); external testers: not in an external group yet ' +
        '(`READY_FOR_BETA_SUBMISSION`).',
    );
  });

  it('tolerates missing relationships and an empty response', () => {
    expect(buildRows({})).toEqual([]);
    const [row] = buildRows({ data: [build('x', '5', '', 'PROCESSING', null, null)] });
    expect(row).toMatchObject({ build: '5', version: '?', internal: '' });
  });

  it('waits until the build exists and has finished processing', () => {
    const rows = buildRows(response);
    expect(waitVerdict(rows, 23)).toBe('pending');
    expect(waitVerdict([{ build: '23', processing: 'PROCESSING' }], 23)).toBe('pending');
    expect(waitVerdict(rows, 21)).toBe('valid');
    expect(waitVerdict(rows, '22')).toBe('invalid');
    expect(waitVerdict([{ build: '23', processing: 'FAILED' }], 23)).toBe('invalid');
  });

  it('reads build uploads, with or without a state object', () => {
    const rows = uploadRows({
      data: [
        {
          attributes: {
            cfBundleVersion: '22',
            cfBundleShortVersionString: '0.1.0',
            createdDate: '2026-09-26T02:47:20Z',
            state: {
              state: 'FAILED',
              errors: [{ code: 'ITMS-90000', description: 'Something is wrong' }],
              warnings: [{ description: 'Heads up' }],
            },
          },
        },
        { attributes: { cfBundleVersion: '21', state: 'COMPLETE' } },
      ],
    });
    expect(rows[0]).toMatchObject({
      build: '22',
      state: 'FAILED',
      errors: ['ITMS-90000: Something is wrong'],
      warnings: ['Heads up'],
    });
    expect(rows[1]).toMatchObject({ build: '21', version: '?', state: 'COMPLETE', errors: [] });
    expect(uploadRows(null)).toEqual([]);
  });

  it('summarises the focused build, every recent build and any upload errors', () => {
    const md = statusMarkdown({
      appName: 'Rogue Dawn',
      rows: buildRows(response),
      uploads: uploadRows({
        data: [
          {
            attributes: {
              cfBundleVersion: '22',
              state: { state: 'FAILED', errors: [{ code: 'ITMS-1', description: 'Bad | pipe' }] },
            },
          },
        ],
      }),
      focus: 22,
    });
    expect(md).toContain('### App Store Connect: Rogue Dawn');
    expect(md).toContain(
      'Build 22 (version 0.1.0): rejected by Apple (`INVALID`); internal testers: processing error',
    );
    expect(md).toContain(
      '| 21 | 1.0 | 2026-09-20 17:00 UTC | processed (`VALID`) | in testing (`IN_BETA_TESTING`) | in testing (`IN_BETA_TESTING`) |',
    );
    expect(md).toContain('  - Error: ITMS-1: Bad | pipe');
  });

  it('says so when the focused build has not appeared, and when there are no builds', () => {
    const md = statusMarkdown({ appName: 'Rogue Dawn', rows: [], focus: 23 });
    expect(md).toContain('Build 23 is not in App Store Connect yet.');
    expect(md).toContain('No builds yet.');
    expect(md).not.toContain('Recent uploads');
  });
});
