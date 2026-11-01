// app/api/banking/renewals-xero/guard.ts
// Admin and Treasurer only (Treasurer also under its legacy code 'T') — the same people
// as Bar Reconciliation. Returns the real user's username, or null.

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';

export async function getRenewalsXeroUser(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.userName) return null;
  if (!hasRole(session.user.role, 'Admin', 'Treasurer', 'T')) return null;
  if (session.user.isImpersonating && session.user.originalAdmin && session.user.originalAdmin.userName) {
    return session.user.originalAdmin.userName;
  }
  return session.user.userName;
}
