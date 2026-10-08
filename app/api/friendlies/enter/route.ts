// app/api/friendlies/enter/route.ts
// API endpoint for players to enter one or more games (and optionally their buddies).
// An entry is into the game's group — for linked games that's the shared occasion,
// and the captains pick players into the individual games at selection time.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { addEntries, checkEntryEligibility, type EntryPreference } from '@/lib/fixture-groups-supabase';
import { getFixtures, type Fixture } from '@/lib/fixtures-supabase';
import { clearDiaryCache } from '@/lib/home-cache';
import { EnterGamesRequest, EnterGamesResponse } from '@/lib/types/friendlies';
import { getUserByUsername } from '@/lib/members-supabase';
import { canManageUser } from '@/lib/buddies-supabase';
import { sendEntryConfirmedEmail, sendLinkedEntryConfirmedEmail } from '@/lib/email/friendlies';

// POST handler - Enters user into one or more games
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: EnterGamesRequest = await request.json();
    const { game_ids, car_numbers } = body;

    // Validate game_ids is a non-empty array
    if (!Array.isArray(game_ids) || game_ids.length === 0) {
      return NextResponse.json(
        { error: 'Invalid game_ids' },
        { status: 400 }
      );
    }

    // Get current user's username
    const userName = session.user.userName;

    // Optional: buddies to enter alongside the caller (the same family members the
    // caller can act for). Each is authorised with the same rule the confirm flow uses.
    const onBehalfOf: string[] = Array.isArray(body.on_behalf_of) ? body.on_behalf_of : [];
    const buddyTargets: string[] = [];
    for (const other of onBehalfOf) {
      if (!other || other === userName || buddyTargets.includes(other)) continue;
      const allowed = await canManageUser(userName, session.user.role ?? '', other);
      if (!allowed) {
        return NextResponse.json(
          { error: 'You can only enter your own partner' },
          { status: 403 }
        );
      }
      buddyTargets.push(other);
    }

    // Every user to enter into each game: the caller first, then any authorised buddies.
    const targets: string[] = [userName, ...buddyTargets];
    const userLabel = (t: string) => (t === userName ? undefined : t);

    const allGames = await getFixtures();
    const results: EnterGamesResponse['results'] = [];
    const enteredGroups = new Set<string>();
    const enteredGames: Array<{ who: string; game: Fixture }> = [];

    for (const tabName of game_ids) {
      const game = allGames.find(g => g.tabName === tabName);
      const fail = (error: string, who: string[] = targets) => {
        for (const t of who) results.push({ game_id: tabName, entered: false, error, user_name: userLabel(t) });
      };

      if (!game) { fail('Game not found'); continue; }
      if (game.status !== 'O' || !game.groupId) { fail('Game not open for entry'); continue; }
      // Both games of a linked pair may be sent — the entry is into the group, once.
      if (enteredGroups.has(game.groupId)) continue;
      enteredGroups.add(game.groupId);

      const groupGames = allGames.filter(g => g.groupId === game.groupId);

      // Server-side eligibility: on teas for any game in the group, or the wrong section.
      // (This used to be checked only on the friendlies page.)
      const eligibility = await checkEntryEligibility(groupGames, targets);
      const eligible: string[] = [];
      for (const item of eligibility) {
        if (item.reasons.length > 0) {
          const who = item.username === userName ? 'You are' : `${item.fullName} is`;
          fail(`${who} ${item.reasons.join(' and ')}`, [item.username]);
        } else {
          eligible.push(item.username);
        }
      }
      if (eligible.length === 0) continue;

      // Optional preference for one game of a linked group
      const pref = body.preferences ? body.preferences[tabName] : undefined;
      let preferredFixtureId: string | null = null;
      let preference: EntryPreference | null = null;
      if (pref && pref.fixture_id && groupGames.some(g => g.id === pref.fixture_id) && groupGames.filter(g => !g.reserveOf).length > 1) {
        preferredFixtureId = pref.fixture_id;
        preference = pref.preference === 'only' ? 'only' : 'preferred';
      }

      try {
        const outcome = await addEntries({
          groupId: game.groupId,
          usernames: eligible,
          source: 'self',
          enteredBy: userName,
          enforceCapacity: true, // friendlies don't allow a waitlist
          preferredFixtureId,
          preference,
          carNumber: car_numbers && car_numbers[tabName] ? car_numbers[tabName] : null,
        });
        for (const r of outcome) {
          if (r.result === 'entered') {
            results.push({ game_id: tabName, entered: true, user_name: userLabel(r.username) });
            enteredGames.push({ who: r.username, game });
          } else {
            fail(r.result === 'full' ? 'Game is full' : 'Already entered', [r.username]);
          }
        }
      } catch (enterError) {
        console.error('[enter] Failed to enter group:', enterError);
        fail('Processing failed', eligible);
      }
    }

    // Send entry confirmation emails (fire-and-forget — failures do not affect the response).
    // Each entered user (caller and any buddies) gets their own confirmation to their address.
    if (enteredGames.length > 0) {
      try {
        const appUrl = await getAppUrl();
        for (const { who, game } of enteredGames) {
          const user = await getUserByUsername(who);
          if (!user?.emailAddress) continue;
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : who);

          // A linked occasion: tell the player they've entered both games — the captains
          // pick them into one nearer the time.
          const partner = allGames.find(g => g.groupId === game.groupId && g.id !== game.id && !g.reserveOf);
          if (partner) {
            await sendLinkedEntryConfirmedEmail(user.emailAddress, who, fullName, game, partner, appUrl);
          } else {
            await sendEntryConfirmedEmail(user.emailAddress, who, fullName, game, appUrl);
          }
        }
      } catch (emailError) {
        console.error('Error sending entry confirmation emails:', emailError);
      }
    }

    // Invalidate the diary cache so the home page reflects the new entry — for every entered user.
    for (const who of new Set(enteredGames.map(e => e.who))) {
      clearDiaryCache(who);
    }

    // Return success response with results for each game
    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Error entering games:', error);
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
