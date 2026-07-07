// app/api/rowland/[compId]/route.ts
// GET single comp — PATCH to update metadata (status, dates, numTeams)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole, isCommitteeMember } from '@/lib/role-utils';
import { getRowlandComp, updateRowlandComp, createEmptyBracket, getRowlandMatches } from '@/lib/rowland-sheets';
import type { RowlandCompId } from '@/types/rowland';

// Committee or the Rowland organiser. Multi-role aware — the previous raw string
// compare let Kiosk and multi-role member strings through.
function isCommittee(role: string) {
  return isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser');
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const { compId } = await params;
    const comp = await getRowlandComp(compId as RowlandCompId);
    if (!comp) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ comp });
  } catch (error) {
    console.error('[rowland/compId] GET error:', error);
    return NextResponse.json({ error: 'Failed to load competition' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isCommittee(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { compId } = await params;
    const id = compId as RowlandCompId;
    const body = await req.json();

    // Create/recreate empty bracket when numTeams is set and no matches exist yet
    let bracketCreated = false;
    if (body.numTeams && body.numTeams >= 2) {
      const comp = await getRowlandComp(id);
      const canCreate = comp?.status === 'Not Started' || comp?.status === 'Draw Done';
      if (canCreate) {
        // Only create if no matches exist (avoids overwriting an in-progress draw)
        const existing = await getRowlandMatches(id);
        if (existing.length === 0) {
          await createEmptyBracket(id, body.numTeams);
          body.status = 'Draw Done';
          bracketCreated = true;
        }
      }
    }

    await updateRowlandComp(id, body);
    return NextResponse.json({ success: true, bracketCreated });
  } catch (error) {
    console.error('[rowland/compId] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update competition' }, { status: 500 });
  }
}
