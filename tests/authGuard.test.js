import { describe, it, expect } from 'vitest';
import { requireAuthUser } from '../src/auth/requireAuthUser.js';

describe('Auth result.user guard', () => {
  it('returns user when result has valid user with id', () => {
    const result = { user: { id: 'abc-123', user_metadata: { display_name: 'Alice' } } };
    const user = requireAuthUser(result);
    expect(user.id).toBe('abc-123');
  });

  it('throws when result is null', () => {
    expect(() => requireAuthUser(null)).toThrow('Auth succeeded but no user returned');
  });

  it('throws when result.user is undefined', () => {
    expect(() => requireAuthUser({})).toThrow('Auth succeeded but no user returned');
  });

  it('throws when result.user has no id', () => {
    expect(() => requireAuthUser({ user: { email: 'x@y.com' } })).toThrow(
      'Auth succeeded but no user returned',
    );
  });

  it('throws when result.user.id is empty string', () => {
    expect(() => requireAuthUser({ user: { id: '' } })).toThrow(
      'Auth succeeded but no user returned',
    );
  });
});
