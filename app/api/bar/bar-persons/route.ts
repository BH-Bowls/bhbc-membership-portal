// app/api/bar/bar-persons/route.ts
// GET — members flagged as bar-duty volunteers, for the "Served by" selector.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getBarPersons } from '@/lib/bar-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ barPersons: await getBarPersons() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load bar persons' }, { status: 500 });
  }
}
