// src/lib/halveit-auth.ts
// Session checks for the Halve It API routes: any signed-in user can view; the
// Darts role (or Admin) manages the team, nights and scores.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';

export function canManageHalveIt(role: string | undefined | null): boolean {
  return role === 'superadmin' || hasRole(role, 'Darts', 'Admin');
}

/** Returns a 401 response if not signed in, otherwise whether the user can manage. */
export async function requireSession(): Promise<{ denied: NextResponse } | { canManage: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  return { canManage: canManageHalveIt(session.user.role) };
}

/** Returns a 401/403 response unless the user has the Darts role or is an Admin. */
export async function requireManager(): Promise<NextResponse | null> {
  const result = await requireSession();
  if ('denied' in result) return result.denied;
  if (!result.canManage) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}
