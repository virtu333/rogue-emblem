// tools/ios/nextBuildNumber.mjs: the TestFlight workflow's build number and its App Store
// Connect API token (ES256 JWT signed with node:crypto, no dependencies).
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  appStoreConnectToken,
  highestBuildNumber,
  nextBuildNumber,
} from '../tools/ios/nextBuildNumber.mjs';

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('TestFlight build number', () => {
  it('is one above the highest existing build', () => {
    expect(highestBuildNumber(['3', '21', '9'])).toBe(21);
    expect(nextBuildNumber(['3', '21', '9'], 1)).toBe(22);
  });

  it('never goes below the project minimum', () => {
    expect(nextBuildNumber([], 21)).toBe(21);
    expect(nextBuildNumber(['5'], 21)).toBe(21);
    expect(nextBuildNumber(['30'], 21)).toBe(31);
  });

  it('compares numerically, reads dotted build numbers by their leading integer, ignores junk', () => {
    expect(highestBuildNumber(['9', '10', '100'])).toBe(100);
    expect(highestBuildNumber(['12.3', '7'])).toBe(12);
    expect(highestBuildNumber([null, undefined, 'abc', ''])).toBe(0);
    expect(nextBuildNumber(undefined)).toBe(1);
  });
});

describe('App Store Connect API token', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  it('is an ES256 JWT with the key id, issuer and App Store Connect audience', () => {
    const token = appStoreConnectToken({
      keyId: 'ABC123DEFG',
      issuerId: '57246542-96fe-1a63-e053-0824d011072a',
      privateKeyPem: pem,
      now: 1_700_000_000_000,
    });
    const [h, p, s] = token.split('.');
    expect(decode(h)).toEqual({ alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
    expect(decode(p)).toEqual({
      iss: '57246542-96fe-1a63-e053-0824d011072a',
      iat: 1_700_000_000,
      exp: 1_700_000_600,
      aud: 'appstoreconnect-v1',
    });
    const signature = Buffer.from(s, 'base64url');
    expect(signature.length).toBe(64); // raw r||s, as JWS requires
    const ok = verify(
      'sha256',
      Buffer.from(`${h}.${p}`),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
    expect(ok).toBe(true);
  });

  it('caps the lifetime at Apple’s 20 minutes', () => {
    const token = appStoreConnectToken({
      keyId: 'K',
      issuerId: 'I',
      privateKeyPem: pem,
      ttlSeconds: 3600,
      now: 0,
    });
    expect(decode(token.split('.')[1]).exp).toBe(1200);
  });
});
