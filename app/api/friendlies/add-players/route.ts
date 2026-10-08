// app/api/friendlies/add-players/route.ts
// API endpoint to add other players to a game (the "View / Add" modal).
// Captains/Admins can add to Open, Selecting or Selected games, bypassing capacity;
// warnings (on teas, wrong section) come back for confirmation before anything is
// written — resend with confirm: true to add anyway. Anyone else can add only to an
// Open game, within capacity, and ineligible players are refused.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { addEntries, checkEntryEligibility, appendManageLog } from '@/lib/fixture-groups-supabase';
import { getFixtures, getGameByIdOrTab } from '@/lib/fixtures-supabase';
import { canManageGame } from '@/lib/squads-supabase';
import { getAllUsers } from '@/lib/members-supabase';
import { sendEntryConfirmedEmail, sendLinkedEntryConfirmedEmail } from '@/lib/email/friendlies';
import { clearDiaryCache } from '@/lib/home-cache';

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { gameId, playerUserNames, confirm = false } = body as { gameId: string; playerUserNames: string[]; confirm?: boolean };

    // Validate input
    if (!gameId || !Array.isArray(playerUserNames) || playerUserNames.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request data' },
        { status: 400 }
      );
    }

    const allGames = await getFixtures();
    let game = allGames.find(g => g.tabName === gameId) || null;
    if (!game) game = await getGameByIdOrTab(null, gameId); // Club Team games

    if (!game || !game.groupId) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    const groupId = game.groupId;

    // Captain/Admin — or, for a league / Club Team game, the squad's organisers (who add
    // people to the squad from the game page)
    const isCaptainOrAdmin = await canManageGame(game, session.user.userName, session.user.role);

    // Only allow adding to open games, or Selecting/Selected games for captains/admins
    if (game.status !== 'O') {
      if (!isCaptainOrAdmin || !['X', 'S'].includes(game.status)) {
        return NextResponse.json({ error: 'Game is not open for entry' }, { status: 400 });
      }
    }

    // Eligibility for every game in the group: on teas, wrong section
    const groupGames = allGames.filter(g => g.groupId === groupId);
    const eligibility = await checkEntryEligibility(groupGames, playerUserNames);
    const withReasons = eligibility.filter(e => e.reasons.length > 0);

    if (isCaptainOrAdmin && withReasons.length > 0 && !confirm) {
      // Nothing written yet — ask the captain to confirm
      return NextResponse.json({
        success: false,
        needsConfirmation: true,
        warnings: withReasons.map(w => ({ userName: w.username, fullName: w.fullName, message: `${w.fullName} is ${w.reasons.join(' and ')}` })),
      });
    }

    const refused = isCaptainOrAdmin ? [] : withReasons;
    const toAdd = playerUserNames.filter(u => !refused.some(r => r.username === u));

    const outcome = await addEntries({
      groupId,
      usernames: toAdd,
      source: isCaptainOrAdmin ? 'manager' : 'buddy',
      enteredBy: session.user.userName,
      enforceCapacity: !isCaptainOrAdmin,
    });

    const results = [
      ...refused.map(r => ({ userName: r.username, added: false, error: `${r.fullName} is ${r.reasons.join(' and ')}` })),
      ...outcome.map(r => ({
        userName: r.username,
        added: r.result === 'entered',
        error: r.result === 'full' ? 'Game is full' : r.result === 'already' ? 'Already entered' : undefined,
      })),
    ];

    const addedUserNames = results.filter(r => r.added).map(r => r.userName);
    if (addedUserNames.length === 0) {
      return NextResponse.json({ success: false, error: (results.length > 0 && results[0].error) || 'Failed to add players', results }, { status: 400 });
    }

    await appendManageLog({
      username: session.user.userName,
      action: 'add-players',
      tabName: game.tabName,
      fixtureId: game.id,
      groupId,
      details: { players: addedUserNames, warningsConfirmed: withReasons.length > 0 && isCaptainOrAdmin },
    });
    for (const userName of addedUserNames) clearDiaryCache(userName);

    // Send entry confirmation emails to each successfully added player (fire-and-forget)
    (async () => {
      try {
        const allUsers = await getAllUsers();
        const appUrl = await getAppUrl();
        // A linked occasion still open for entry: confirm both games, allocation to follow
        const partner = game.status === 'O'
          ? allGames.find(g => g.groupId === groupId && g.id !== game.id && !g.reserveOf)
          : undefined;

        for (const userName of addedUserNames) {
          const user = allUsers.find(u => u.userName.toLowerCase() === userName.toLowerCase());
          if (!user?.emailAddress) continue;
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : userName);
          if (partner) {
            await sendLinkedEntryConfirmedEmail(user.emailAddress, userName, fullName, game, partner, appUrl);
          } else {
            await sendEntryConfirmedEmail(user.emailAddress, userName, fullName, game, appUrl, true);
          }
        }
      } catch (emailError) {
        console.error('[add-players] Error sending entry confirmation emails:', emailError);
      }
    })();

    return NextResponse.json({ success: true, results, addedToGameSheet: true });
  } catch (error) {
    console.error('[Friendlies API] Error adding players:', error);
    return NextResponse.json(
      { error: 'Failed to add players' },
      { status: 500 }
    );
  }
}
