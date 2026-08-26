// app/api/friendlies/enter/route.ts
// API endpoint for players to enter one or more games
// Updates Players sheet with 'E' status and recalculates entered counts in Games sheet

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { updatePlayerEntry, addPlayerToGameSheet } from '@/lib/friendlies-sheets';
import { getFixtures, updateFixture } from '@/lib/fixtures-supabase';
import { clearDiaryCache, clearSheetDataCacheByPrefix } from '@/lib/home-cache';
import { EnterGamesRequest, EnterGamesResponse } from '@/lib/types/friendlies';
import { canEnterGame } from '@/lib/game-management/capacity';
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

    // Fetch all fixtures to verify each game exists and is open. Postgres reads are
    // always fresh — no cache layer to bypass here (unlike the old Sheets Games
    // cache, which forceFresh used to skip so a member couldn't enter a game the
    // captain just closed).
    const allGames = await getFixtures();

    // Process every (game × target) entry. Games write to different columns/tabs so
    // they run in parallel; targets within a game run in sequence to keep each game
    // sheet's writes ordered. A joint-game entry always sends only the lead game's
    // tabName (the client enters game 1), so no partner is entered here.
    const nested = await Promise.all(
      game_ids.map(async (tabName) => {
        const gameResults: EnterGamesResponse['results'] = [];
        try {
          const game = allGames.find(g => g.tabName === tabName);

          if (!game) {
            for (const t of targets) gameResults.push({ game_id: tabName, entered: false, error: 'Game not found', user_name: t === userName ? undefined : t });
            return gameResults;
          }
          if (game.status !== 'O') {
            for (const t of targets) gameResults.push({ game_id: tabName, entered: false, error: 'Game not open for entry', user_name: t === userName ? undefined : t });
            return gameResults;
          }

          if (game.maxPlayers && game.maxPlayers > 0) {
            const capacityCheck = canEnterGame(game, false); // Friendlies don't allow waitlist
            if (!capacityCheck.canEnter) {
              for (const t of targets) gameResults.push({ game_id: tabName, entered: false, error: capacityCheck.reason || 'Cannot enter game', user_name: t === userName ? undefined : t });
              return gameResults;
            }
          }

          const gameCarNumber = car_numbers?.[tabName];
          for (const target of targets) {
            try {
              await updatePlayerEntry(target, game.tabName, 'E');
              // Open-game entry — skip stat computation (stats are snapshotted at close)
              await addPlayerToGameSheet(game.tabName, target, 'R', gameCarNumber, false);
              gameResults.push({ game_id: tabName, entered: true, user_name: target === userName ? undefined : target });
            } catch (updateError: any) {
              gameResults.push({ game_id: tabName, entered: false, error: updateError.message || 'Update failed', user_name: target === userName ? undefined : target });
            }
          }
          return gameResults;
        } catch {
          for (const t of targets) gameResults.push({ game_id: tabName, entered: false, error: 'Processing failed', user_name: t === userName ? undefined : t });
          return gameResults;
        }
      })
    );
    const results: EnterGamesResponse['results'] = nested.flat();

    // Update entered counts in Games sheet for all successfully entered games
    // This requires counting actual entries in Players sheet to get accurate totals
    const successfulEntries = results.filter(r => r.entered);

    if (successfulEntries.length > 0) {
      const { getGoogleSheetsClient } = await import('@/lib/sheets');

      // Get Sheets client and spreadsheet ID
      const sheets = getGoogleSheetsClient();
      const spreadsheetId = process.env.FRIENDLIES_SPREADSHEET_ID!;

      // Fetch all Players sheet data once for efficiency
      const playersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Players!A:ZZ',
      });

      // Extract rows and headers from Players sheet
      const rows = playersResponse.data.values || [];
      const headers = rows[0] || [];

      // Collect all count updates
      const countUpdates: { id: string; entered: number }[] = [];

      // A game may have several successful entries (caller + buddies) — only recount once.
      const countedGames = new Set<string>();
      for (const result of successfulEntries) {
        if (countedGames.has(result.game_id)) continue;
        countedGames.add(result.game_id);

        // Find the game object for this entry
        const game = allGames.find(g => g.tabName === result.game_id);

        if (game) {
          // Find which column in Players sheet corresponds to this game
          const gameColIndex = headers.findIndex((h: string) => h === game.tabName);

          if (gameColIndex !== -1) {
            // Count active entries only — exclude withdrawn (ending in W) and empty cells.
            // A game reopened from X/S status may have PW/RW/EW entries in the Players
            // sheet for players who withdrew before the reopen; they must not inflate the count.
            let enteredCount = 0;
            for (let i = 1; i < rows.length; i++) {
              const status = (rows[i][gameColIndex] || '').toString();
              if (status && !status.endsWith('W')) {
                enteredCount++;
              }
            }

            countUpdates.push({ id: game.id, entered: enteredCount });
          }
        }
      }

      // Update all counts on the fixtures
      if (countUpdates.length > 0) {
        await Promise.all(countUpdates.map(u => updateFixture(u.id, { entered: u.entered })));
      }
    }

    // Send entry confirmation emails (fire-and-forget — failures do not affect the response).
    // Each entered user (caller and any buddies) gets their own confirmation to their address.
    if (successfulEntries.length > 0) {
      try {
        const appUrl = await getAppUrl();

        // Group the games each user was successfully entered into (caller uses their own username)
        const gamesByUser = new Map<string, string[]>();
        for (const r of successfulEntries) {
          const who = r.user_name ?? userName;
          const list = gamesByUser.get(who) ?? [];
          list.push(r.game_id);
          gamesByUser.set(who, list);
        }

        for (const [who, tabNames] of gamesByUser) {
          const user = await getUserByUsername(who);
          if (!user?.emailAddress) continue;
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : who);

          const successfulGames = tabNames
            .map(t => allGames.find(g => g.tabName === t))
            .filter((g): g is typeof allGames[0] => !!g);

          // The entry itself only lands on the lead of a linked pair (see resolveLeadTab),
          // but for a joint game the confirmation should tell the player they've entered
          // BOTH games — the captains allocate them to one nearer the time. Look up the
          // partner from all games (it isn't entered, so it isn't in successfulGames).
          const emailed = new Set<string>();
          for (const game of successfulGames) {
            if (emailed.has(game.tabName)) continue;
            if (game.paired === 'Y') {
              const partner = allGames.find(g =>
                g.tabName !== game.tabName && g.paired === 'Y' && g.date === game.date
              );
              if (partner) {
                await sendLinkedEntryConfirmedEmail(user.emailAddress, who, fullName, game, partner, appUrl);
                emailed.add(game.tabName);
                continue;
              }
            }
            await sendEntryConfirmedEmail(user.emailAddress, who, fullName, game, appUrl);
            emailed.add(game.tabName);
          }
        }
      } catch (emailError) {
        console.error('Error sending entry confirmation emails:', emailError);
      }
    }

    // Invalidate the diary cache so the home page reflects the new entry — for every entered user.
    // Also bust the shared Players-sheet cache diary-sheets.ts's fetchFriendliesItems reads from
    // (24h TTL, otherwise never invalidated by writes — without this, the diary keeps computing
    // fresh but off a stale pre-entry snapshot of who's in each game, for up to 24h).
    for (const who of new Set(successfulEntries.map(r => r.user_name ?? userName))) {
      clearDiaryCache(who);
    }
    clearSheetDataCacheByPrefix('friendlies-players:');

    // Return success response with results for each game
    return NextResponse.json({ success: true, results });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to enter games' },
      { status: 500 }
    );
  }
}
