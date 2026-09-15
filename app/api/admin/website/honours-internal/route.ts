// app/api/admin/website/honours-internal/route.ts
// GET /api/admin/website/honours-internal — all seasons' internal honours records for the admin UI.
// POST /api/admin/website/honours-internal — creates a new season's record.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllHonoursInternal, createHonoursInternal } from '@/lib/website-honours-internal-supabase';

// Every column except year — free-text winner names, all optional
const TEXT_FIELDS = [
  'president', 'mens_captain', 'ladies_captain', 'mens_championship', 'mixed_handicap',
  'mens_two_woods', 'ladies_maynard', 'ladies_two_woods', 'drawn_pairs', 'drawn_triples',
  'oldland', 'veterans_cup', 'married_pairs', 'australian_pairs', 'centenary_cup',
] as const;

// Pull the text fields out of a request body, trimming blanks to null
function extractFields(body: any): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const key of TEXT_FIELDS) {
    const value = body[key];
    fields[key] = typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  }
  return fields;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await getAllHonoursInternal();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[GET /api/admin/website/honours-internal] Error:', error);
    return NextResponse.json({ error: 'Failed to load honours_internal' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const yearNum = Number(body.year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'year must be a positive whole number' }, { status: 400 });
    }

    let row;
    try {
      row = await createHonoursInternal(yearNum, extractFields(body) as any);
    } catch (err) {
      // Most likely cause: a row for this year already exists (primary key conflict)
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 409 });
    }

    return NextResponse.json({ success: true, row });
  } catch (error) {
    console.error('[POST /api/admin/website/honours-internal] Error:', error);
    return NextResponse.json({ error: 'Failed to create honours_internal row' }, { status: 500 });
  }
}
