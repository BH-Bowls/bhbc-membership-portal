// app/api/rowland/[compId]/matches/[matchId]/score-sheet/route.ts
// POST — confirm a score sheet image uploaded directly to Google Drive.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setPublicReadPermission, driveViewUrl } from '@/lib/drive';
import { getRowlandMatches, updateRowlandMatch } from '@/lib/rowland-supabase';
import { hasRole, isCommitteeMember } from '@/lib/role-utils';
import type { RowlandCompId } from '@/types/rowland';
import { BHBC_CLUB_NAME } from '@/types/rowland';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ compId: string; matchId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.user.role;
    const isRowlandPlayer = hasRole(role, 'RowlandPlayer');
    // Committee = general committee or the Rowland organiser — multi-role aware
    const isCommittee =
      !isRowlandPlayer &&
      (isCommitteeMember(role) || hasRole(role, 'RowlandOrganiser'));

    if (!isCommittee && !isRowlandPlayer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { compId, matchId } = await params;

    if (isRowlandPlayer) {
      const matches = await getRowlandMatches(compId as RowlandCompId);
      const match = matches.find((m) => m.matchId === matchId);
      if (!match) {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      }
      if (match.homeTeam?.clubName !== BHBC_CLUB_NAME && match.awayTeam?.clubName !== BHBC_CLUB_NAME) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const { fileId } = await req.json();
    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 });
    }

    await setPublicReadPermission(fileId);
    const url = driveViewUrl(fileId);

    await updateRowlandMatch(compId as RowlandCompId, matchId, { scoreSheetUrl: url });

    return NextResponse.json({ url });
  } catch (error) {
    console.error('[rowland/score-sheet] POST error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
