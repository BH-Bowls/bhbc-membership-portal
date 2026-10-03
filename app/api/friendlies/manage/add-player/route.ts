// app/api/friendlies/manage/add-player/route.ts
// API endpoint for a captain to add a player to a game's group (captain function).
// Capacity is bypassed; eligibility warnings (on teas, wrong section) come back for
// confirmation first — resend with confirm: true to add anyway.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { addEntries, checkEntryEligibility, getGroupFixtures, appendManageLog } from '@/lib/fixture-groups-supabase';
import { getFixtureByTabName } from '@/lib/fixtures-supabase';
import { AddPlayerRequest } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can add players
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: AddPlayerRequest & { confirm?: boolean } = await request.json();
    const { tab_name, user_name, confirm = false } = body;

    // Validate required fields
    if (!tab_name || !user_name) {
      return NextResponse.json(
        { error: 'Missing tab_name or user_name' },
        { status: 400 }
      );
    }

    const game = await getFixtureByTabName(tab_name);

    if (!game || !game.groupId) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Allow adding players to Open (O), Selecting (X), or Selected (S) games
    if (!['O', 'X', 'S'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Can only add players to Open, Selecting, or Selected games' },
        { status: 400 }
      );
    }

    const [check] = await checkEntryEligibility(await getGroupFixtures(game.groupId), [user_name]);
    if (check.reasons.length > 0 && !confirm) {
      return NextResponse.json({
        success: false,
        needsConfirmation: true,
        warnings: [{ userName: user_name, fullName: check.fullName, message: `${check.fullName} is ${check.reasons.join(' and ')}` }],
      });
    }

    // Added to the group's pool — i.e. as a reserve until picked
    const outcomes = await addEntries({
      groupId: game.groupId,
      usernames: [user_name],
      source: 'manager',
      enteredBy: session.user.userName,
      enforceCapacity: false,
    });
    const result = outcomes.length > 0 ? outcomes[0].result : null;

    if (result === 'entered') {
      await appendManageLog({
        username: session.user.userName,
        action: 'add-player',
        tabName: game.tabName,
        fixtureId: game.id,
        groupId: game.groupId,
        details: { player: user_name, warningsConfirmed: check.reasons.length > 0 },
      });
      clearDiaryCache(user_name);
    }

    return NextResponse.json({
      success: true,
      message: result === 'already' ? `${user_name} is already in this game` : `Player ${user_name} added to game`,
    });
  } catch (error) {
    console.error('Error adding player:', error);
    return NextResponse.json(
      { error: 'Failed to add player' },
      { status: 500 }
    );
  }
}
