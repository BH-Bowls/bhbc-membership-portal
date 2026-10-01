// src/lib/role-utils.ts
// Helpers for parsing and checking user roles (comma-separated multi-role support)
// Empty role string = regular member. "Member" is treated as empty for backwards compat.

/** Parse a raw role string (e.g. "Captain,RowlandOrganiser") into an array of role names. */
export function parseRoles(role: string | undefined | null): string[] {
  if (!role || role === 'Member') return [];
  return role.split(',').map(r => r.trim()).filter(Boolean);
}

/** Return true if the user has any of the specified roles. */
export function hasRole(role: string | undefined | null, ...checkRoles: string[]): boolean {
  const roles = parseRoles(role);
  return checkRoles.some(r => roles.includes(r));
}

/** Return true if the user is a committee member (Captain, Treasurer, GMC, or Admin).
 *  RowlandOrganiser and RowlandPlayer are intentionally excluded — they are specialist roles, not general committee. */
export function isCommitteeMember(role: string | undefined | null): boolean {
  return hasRole(role, 'Captain', 'Treasurer', 'GMC', 'Admin');
}

/** Return true if the user is a regular member (no roles assigned). */
export function isMember(role: string | undefined | null): boolean {
  return parseRoles(role).length === 0;
}

/** Return true if the user can use the bar till (/bar and its API routes): committee
 *  members, plus the dedicated 'Bar' till login. Deliberately NOT folded into
 *  isCommitteeMember() itself — that would grant the till's own credential committee
 *  access everywhere else in the app (admin menus, other committee-only pages), not
 *  just the bar subsystem it's scoped to. */
export function canUseBarTill(role: string | undefined | null): boolean {
  return isCommitteeMember(role) || hasRole(role, 'Bar');
}
