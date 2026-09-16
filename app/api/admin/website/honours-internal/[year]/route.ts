// app/api/admin/website/honours-internal/[year]/route.ts
// PATCH /api/admin/website/honours-internal/[year] — updates an existing season's record.
// DELETE /api/admin/website/honours-internal/[year] — permanently deletes a season's record.
// Auth: Admin, Captain, or GMC role required. Keyed by year (the table's primary key),
// not a generated id — one row per season.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateHonoursInternal, deleteHonoursInternal } from '@/lib/website-honours-internal-supabase';
import { revalidateWebsitePath } from '@/lib/revalidate-website';

const TEXT_FIELDS = [
  'president', 'mens_captain', 'ladies_captain', 'mens_championship', 'mixed_handicap',
  'mens_two_woods', 'ladies_maynard', 'ladies_two_woods', 'drawn_pairs', 'drawn_triples',
  'oldland', 'veterans_cup', 'married_pairs', 'australian_pairs', 'centenary_cup',
] as const;

function extractFields(body: any): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const key of TEXT_FIELDS) {
    const value = body[key];
    fields[key] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  return fields;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { year } = await params;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    const body = await request.json();

    try {
      await updateHonoursInternal(yearNum, extractFields(body) as any);
    } catch {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    await revalidateWebsitePath('/honours');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/website/honours-internal/[year]] Error:', error);
    return NextResponse.json({ error: 'Failed to update honours_internal row' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { year } = await params;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
    }

    try {
      await deleteHonoursInternal(yearNum);
    } catch {
      return NextResponse.json({ error: 'Season not found' }, { status: 404 });
    }

    await revalidateWebsitePath('/honours');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/honours-internal/[year]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete honours_internal row' }, { status: 500 });
  }
}
