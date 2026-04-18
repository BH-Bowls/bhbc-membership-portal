// app/api/fixtures/manage/game/[rowNumber]/route.ts
// Captain-only: PATCH to update, DELETE to remove a specific fixture row

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateFixture, deleteFixtureRow } from '@/lib/friendlies-sheets';
import { GameType } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ rowNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { rowNumber: rowNumberStr } = await params;
    const rowNumber = parseInt(rowNumberStr);
    if (isNaN(rowNumber) || rowNumber < 2) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    const body = await request.json();
    const {
      date, time, type, clubName, clubSuffix,
      homeAway, format, ladiesMen, dress, paired, maxPlayers, message,
    } = body;

    await updateFixture(rowNumber, {
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
  { params }: { params: Promise<{ rowNumber: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { rowNumber: rowNumberStr } = await params;
    const rowNumber = parseInt(rowNumberStr);
    if (isNaN(rowNumber) || rowNumber < 2) {
      return NextResponse.json({ error: 'Invalid row number' }, { status: 400 });
    }

    await deleteFixtureRow(rowNumber);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting fixture:', error);
    return NextResponse.json(
      { error: 'Failed to delete fixture' },
      { status: 500 }
    );
  }
}
