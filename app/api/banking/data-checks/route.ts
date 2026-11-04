// app/api/banking/data-checks/route.ts
// GET — runs the data checks (src/lib/data-checks.ts) and returns every check with the
// problems found. Read-only. Treasurer and Admin.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { runDataChecks } from '@/lib/data-checks';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin', 'Treasurer', 'T')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json(await runDataChecks());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to run the data checks' }, { status: 500 });
  }
}
