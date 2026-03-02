/**
 * Extract and validate auth user from provider result payload.
 * Throws when auth appears successful but no usable user id is returned.
 *
 * @param {unknown} result
 * @returns {{ id: string }}
 */
export function requireAuthUser(result) {
  const user = result?.user;
  if (!user?.id) {
    throw new Error('Auth succeeded but no user returned');
  }
  return user;
}
