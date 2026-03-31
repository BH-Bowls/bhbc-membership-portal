// app/api/rowland/[compId]/matches/[matchId]/score-sheet/route.ts
// POST — upload a score sheet image for a Rowland Cup match

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { uploadFileToCloudinary } from '@/lib/cloudinary';
import { getRowlandMatches } from '@/lib/rowland-sheets';
import type { RowlandCompId } from '@/types/rowland';

const BHBC_CLUB_ID = 'burgess.hill';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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

    // For clubs and RowlandPlayer, verify their club is a participant
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

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 400 });
    }

    const mimeType = file.type || 'image/jpeg';
    if (!mimeType.startsWith('image/')) {
      return NextResponse.json({ error: 'Only image files are accepted' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadFileToCloudinary(
      matchId,
      buffer,
      file.name || 'score-sheet.jpg',
      mimeType,
      'bhbc-rowland'
    );

    return NextResponse.json({ url: result.secureUrl });
  } catch (error) {
    console.error('[rowland/score-sheet] POST error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
