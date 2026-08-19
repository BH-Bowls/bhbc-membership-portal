// app/api/fixtures/manage/game/[id]/route.ts
// Captain-only: PATCH to update, DELETE to remove a specific fixture row

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateFixture, deleteFixture, getFixtures } from '@/lib/fixtures-supabase';
import { GameType } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const body = await request.json();
    const {
      date, time, type, clubName, clubSuffix,
      homeAway, format, ladiesMen, dress, paired, maxPlayers, message, pickupInfo,
    } = body;

    // Trap mismatched pairs: when flagging a game as paired, the other paired game on
    // the same date must be the same section (Ladies/Men — usually both Mixed). Pairing
    // a Mixed game with a Ladies game is almost always a mistake.
    if (paired === 'Y') {
      const games = await getFixtures();
      const thisSection = (ladiesMen || '').trim().toLowerCase();
      // Look for another paired game on the same date (a closed link 'C' counts too)
      for (let i = 0; i < games.length; i++) {
        const other = games[i];
        if (other.id === id) continue;
        const otherPaired = other.paired === 'Y' || other.paired === 'C';
        if (otherPaired && other.date === date) {
          const otherSection = (other.ladiesMen || '').trim().toLowerCase();
          // Only block when both sections are set and genuinely differ
          if (thisSection && otherSection && thisSection !== otherSection) {
            return NextResponse.json(
              {
                error: `Can't pair these games — paired games must be the same section. This game is "${ladiesMen}" but the other paired game on this date is "${other.ladiesMen}". They're usually both Mixed.`,
              },
              { status: 400 }
            );
          }
        }
      }
    }

    await updateFixture(id, {
      date,
      time,
      type: type as GameType | undefined,
      clubName,
      clubSuffix,
      homeAway,
      format,
      ladiesMen,
      dress,
      paired,
      maxPlayers: maxPlayers !== undefined ? parseInt(maxPlayers) : undefined,
      message,
      pickupInfo,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating fixture:', error);
    return NextResponse.json(
      { error: 'Failed to update fixture' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    await deleteFixture(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting fixture:', error);
    return NextResponse.json(
      { error: 'Failed to delete fixture' },
      { status: 500 }
    );
  }
}
