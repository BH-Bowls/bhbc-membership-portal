// app/api/fixtures/manage/game/[id]/route.ts
// Captain-only: PATCH to update, DELETE to remove a specific fixture row

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateFixture, deleteFixture } from '@/lib/fixtures-supabase';
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
      date, time, type, clubName, clubSuffix, description,
      homeAway, format, ladiesMen, dress, maxPlayers, message, pickupInfo,
    } = body;

    await updateFixture(id, {
      date,
      time,
      type: type as GameType | undefined,
      clubName,
      clubSuffix,
      description,
      homeAway,
      format,
      ladiesMen,
      dress,
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
