// app/api/friendlies/withdraw/route.ts
// API endpoint for players to withdraw from a game
// Handles two scenarios: removing entry (Open games) or marking as withdrawn (Closed/Selected games)
// Sends email notifications to captains when withdrawing from selected games

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import { getGames, getGameSheet, updateGameSheet, updatePlayerEntry, updateGameCounts, removePlayerFromGameSheet, getActiveEnteredCount } from '@/lib/friendlies-sheets';
import { clearDiaryCache } from '@/lib/home-cache';
import { sendWithdrawalEmail, sendWithdrawalNoticeEmail, sendLinkedWithdrawalNoticeEmail } from '@/lib/email/friendlies';
import type { WithdrawRequest, Game } from '@/lib/types/friendlies';
import { getUserByUsername } from '@/lib/members-supabase';
import { canManageUser } from '@/lib/buddies-supabase';

// POST handler - Withdraws user from a game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: WithdrawRequest = await request.json();
    // Decode tab_name in case it's URL-encoded
    const tab_name = decodeURIComponent(body.tab_name);

    // Get current user's username
    const userName = session.user.userName;

    // Fetch all games from Games sheet
    const games = await getGames();

    // Search for the game by tabName
    let game = null;
    for (const g of games) {
      if (g.tabName === tab_name) {
        game = g;
        break;
      }
    }

    // Return 404 if game doesn't exist
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Derive app URL from the incoming request so custom domains work correctly
    const appUrl = await getAppUrl();

    // Handle withdrawal differently based on game status
    // Scenario 1: Game is still Open - simple removal
    if (game.status === 'O') {
      // Optional: buddies to remove alongside the caller (authorised the same way as entry).
      const onBehalfOf: string[] = Array.isArray(body.on_behalf_of) ? body.on_behalf_of : [];
      const removeTargets: string[] = [userName];
      for (const other of onBehalfOf) {
        if (!other || other === userName || removeTargets.includes(other)) continue;
        const allowed = await canManageUser(userName, session.user.role ?? '', other);
        if (!allowed) {
          return NextResponse.json(
            { error: 'You can only remove your own partner' },
            { status: 403 }
          );
        }
        removeTargets.push(other);
      }

      // Remove each target's entry from the Players sheet and their row from the game
      // sheet. A joint-game entry only ever lives on the lead game, so this removes
      // only that game — no partner writes (keeps quota use down).
      for (const target of removeTargets) {
        await updatePlayerEntry(target, game.tabName, '');
        await removePlayerFromGameSheet(game.tabName, target);
      }

      // Recalculate entered count in Games sheet
      const { getGoogleSheetsClient } = await import('@/lib/sheets');
      const sheets = getGoogleSheetsClient();
      const spreadsheetId = process.env.FRIENDLIES_SPREADSHEET_ID!;

      // Fetch Players sheet to count remaining entries
      const playersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Players!A:ZZ',
      });

      const rows = playersResponse.data.values || [];
      const headers = rows[0] || [];

      // Find which column corresponds to this game
      let gameColIndex = -1;
      for (let i = 0; i < headers.length; i++) {
        if (headers[i] === game.tabName) {
          gameColIndex = i;
          break;
        }
      }

      // Count remaining entries and update Games sheet
      if (gameColIndex !== -1) {
        // Count non-empty cells in this game's column (skip header)
        let enteredCount = 0;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i][gameColIndex]) {
            enteredCount++;
          }
        }

        // Update the entered count in Games sheet
        await updateGameCounts(game.tabName, { entered: enteredCount });
      }

      // Joint game: pair the removal email with both games (mirror of the entry
      // email). The partner is found in the already-loaded games list — no extra
      // reads, so no quota cost.
      const emailPartner = (game.paired === 'Y' || game.paired === 'C')
        ? games.find(g => g.tabName !== game.tabName && (g.paired === 'Y' || g.paired === 'C') && g.date === game.date)
        : undefined;

      // Send a removal notice to each removed player (fire-and-forget)
      for (const target of removeTargets) {
        try {
          const user = await getUserByUsername(target);
          if (user?.emailAddress) {
            const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : target);
            if (emailPartner) {
              await sendLinkedWithdrawalNoticeEmail(user.emailAddress, target, fullName, game, emailPartner, appUrl);
            } else {
              await sendWithdrawalNoticeEmail(user.emailAddress, target, fullName, game, appUrl);
            }
          }
        } catch (emailError) {
          console.error('Error sending removal notice email:', emailError);
        }
        // Invalidate each removed user's diary cache so their home page updates
        clearDiaryCache(target);
      }

      // Return success for Open game removal
      return NextResponse.json({
        success: true,
        message: 'Entry removed',
      });
    }

    // Scenario 2: Game is Closed/Selected/Played - mark as withdrawn
    if (['X', 'S', 'P'].includes(game.status)) {
      // Fetch all players from game sheet
      const players = await getGameSheet(game.tabName);

      // Find this user in the game sheet
      let userPlayer = null;
      for (const p of players) {
        if (p.name === userName) {
          userPlayer = p;
          break;
        }
      }

      // Return 404 if user is not in this game
      if (!userPlayer) {
        return NextResponse.json(
          { error: 'You are not in this game' },
          { status: 404 }
        );
      }

      // Mark player as withdrawn in game sheet (Status column = 'W')
      await updateGameSheet(game.tabName, [
        {
          rowNumber: userPlayer.rowNumber,
          status: 'W',
        },
      ]);

      // Update Players sheet status with "W" suffix to indicate withdrawal
      // PW = Picked+Withdrawn, RW = Reserve+Withdrawn, etc.
      let newStatus;
      if (userPlayer.selected === 'Y') {
        newStatus = 'PW'; // Was picked to play
      } else if (userPlayer.selected === 'R') {
        newStatus = 'RW'; // Was reserve
      } else if (userPlayer.selected === 'T') {
        newStatus = 'TW'; // Was reserve team
      } else {
        newStatus = 'EW'; // Was just entered
      }

      await updatePlayerEntry(userName, game.tabName, newStatus as any);

      // Recalculate entered count, excluding the player who just withdrew
      try {
        const activeCount = await getActiveEnteredCount(game.tabName);
        await updateGameCounts(game.tabName, { entered: activeCount });
      } catch (countError) {
        console.error('[withdraw] Error updating entered count:', countError);
      }

      // Send email notification to captains if game is Selected or Played
      // (No email for Selecting status as team not finalized yet)
      if (game.status === 'S' || game.status === 'P') {
        await sendWithdrawalEmail(
          userName,
          game,
          {
            selected: userPlayer.selected,
            team: userPlayer.team,
            position: userPlayer.position,
          },
          appUrl
        );
      }

      // Send withdrawal notice to the player (fire-and-forget)
      try {
        const user = await getUserByUsername(userName);
        if (user?.emailAddress) {
          const fullName = user.fullName || (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : userName);
          await sendWithdrawalNoticeEmail(user.emailAddress, userName, fullName, game, appUrl);
        }
      } catch (emailError) {
        console.error('Error sending withdrawal notice email:', emailError);
      }

      // Invalidate the diary cache so the home page reflects the withdrawal
      clearDiaryCache(userName);

      // Return success for closed game withdrawal
      return NextResponse.json({
        success: true,
        message: 'Withdrawal recorded and captains notified',
      });
    }

    // Cannot withdraw from cancelled or abandoned games
    return NextResponse.json(
      { error: 'Cannot withdraw from this game' },
      { status: 400 }
    );
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to withdraw from game' },
      { status: 500 }
    );
  }
}
