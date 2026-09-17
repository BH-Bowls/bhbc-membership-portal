// app/api/bar/pricing-config/route.ts
// GET — the active bar pricing mode + global member discount rate. Committee-gated
// like the rest of /api/bar/*, not Admin-only like /api/admin/config (which is where
// this is edited) — till staff who need to price a basket aren't necessarily Admin.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getPricingConfig } from '@/lib/bar-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    return NextResponse.json({ pricingConfig: await getPricingConfig() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load pricing config' }, { status: 500 });
  }
}
