// app/api/rowland/[compId]/matches/[matchId]/score-sheet/route.ts
// POST — confirm a score sheet image uploaded directly to Google Drive.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { setPublicReadPermission, driveViewUrl } from '@/lib/drive';
import { getRowlandMatches, updateRowlandMatch } from '@/lib/rowland-sheets';
import type { RowlandCompId } from '@/types/rowland';

const BHBC_CLUB_ID = 'burgess.hill';

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
    const roles = role ? role.split(',').map((r: string) => r.trim()) : [];
    const isClub = role === 'Club';
    const isRowlandPlayer = roles.includes('RowlandPlayer');
    const isCommittee = !isClub && !isRowlandPlayer && role !== 'Member' && role !== '';

    if (!isCommittee && !isClub && !isRowlandPlayer) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { compId, matchId } = await params;

    if (isClub || isRowlandPlayer) {
      const clubId = isRowlandPlayer ? BHBC_CLUB_ID : session.user.clubId;
      const matches = await getRowlandMatches(compId as RowlandCompId);
      const match = matches.find((m) => m.matchId === matchId);
      if (!match) {
        return NextResponse.json({ error: 'Match not found' }, { status: 404 });
      }
      if (match.homeTeam?.clubId !== clubId && match.awayTeam?.clubId !== clubId) {
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
