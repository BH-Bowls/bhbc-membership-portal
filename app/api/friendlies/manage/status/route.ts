// app/api/friendlies/manage/status/route.ts
// API endpoint for captains to change game status through the full lifecycle
// Status flow: blank → O (Open) → [L (Allocating) →] X (Selecting) → S (Selected) → P (Played)
// Paired games use L status for allocation before game sheets are created
// Alternative endings: C (Cancelled) or A (Abandoned)
// Each transition creates necessary Google Sheets structures and enforces business rules

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  updateGameStatus,
  createGameColumn,
  createGameSheet,
  getGameSheet,
  getTeaRotaEntry,
  setNeedsPlayersFlag,
  markGamePlayerEntriesAs,
  updateGameSheetStats,
} from '@/lib/friendlies-sheets';
// addPlayerToGameSheet / removePlayerFromGameSheet imported below in enter/withdraw routes
import { sendGamePublishedEmail, sendTeaRotaEmail, sendGameCancelledEmail, sendTeaRotaCancelledEmail } from '@/lib/email/friendlies';
import { getAllUsers } from '@/lib/sheets';
import { clearAllDiaryCaches, clearSheetDataCacheByPrefix } from '@/lib/home-cache';
import { ChangeStatusRequest, ChangeStatusResponse, GameStatus } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// POST handler - Changes game status with validation and sheet creation
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Captains and Admins can change game status
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body: ChangeStatusRequest = await request.json();
    const { tab_name, row_number, action, expected_status, bhbc_score, opponent_score, reason, who, send_email, email_player_names, send_tea_rota_email, publish_message } = body;

    // Fetch all games from Games sheet
    const games = await getGames();

    // Search for the game by tabName or rowNumber
    let game = null;

    // First try to find by tabName if provided and not empty
    if (tab_name && tab_name.trim() !== '') {
      game = games.find(g => g.tabName === tab_name) || null;
    }

    // If not found and rowNumber provided, find by rowNumber
    if (!game && row_number) {
      game = games.find(g => g.rowNumber === row_number) || null;
    }

    // Return 404 if game doesn't exist
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const statusLabel = (s: string) => ({ '': 'Upcoming', O: 'Open', L: 'Allocating', X: 'Selecting', S: 'Selected', P: 'Played', C: 'Cancelled', A: 'Abandoned' }[s] ?? s);

    // Pre-check: if client sent expected_status, reject if it no longer matches
    if (expected_status !== undefined && game.status !== expected_status) {
      return NextResponse.json(
        {
          error: `This game is now ${statusLabel(game.status)} — it was changed in another session. Close this dialog and refresh the game list.`,
          current_status: game.status,
        },
        { status: 409 },
      );
    }

    // Generate effectiveTabName - this will be used for all operations
    // Format: "ClubName DD MMM YY" (e.g., "West Hoathly 13 Jan 25")

    // Use tabDate field if available, otherwise format the date field
    let tabDatePart = game.tabDate || '';

    if (!tabDatePart || tabDatePart.trim() === '') {
      // Parse date from various formats
      const formatTabDate = (dateStr: string): string => {
        if (!dateStr) return '';

        // Try format: "Day, DD Month" (e.g., "Sun, 26 April")
        // This is your spreadsheet format
        const dayMonthMatch = dateStr.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+(\w+)/i);
        if (dayMonthMatch) {
          const day = dayMonthMatch[1].padStart(2, '0');
          const monthName = dayMonthMatch[2];

          // Get current year or next year based on month
          const now = new Date();
          const currentMonth = now.getMonth();
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthIndex = monthNames.findIndex(m => monthName.toLowerCase().startsWith(m.toLowerCase()));

          // If month has passed this year, assume next year
          let year = now.getFullYear();
          if (monthIndex !== -1 && monthIndex < currentMonth - 1) {
            year++;
          }

          const shortYear = year.toString().slice(-2);
          const shortMonth = monthNames[monthIndex] || monthName.slice(0, 3);
          return `${day} ${shortMonth} ${shortYear}`;
        }

        // Try format: "DD/MM/YYYY" or "DD/MM/YY"
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1];
          let year = parts[2];
          if (year.length === 4) {
            year = year.slice(-2);
          }
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const monthIndex = parseInt(month, 10) - 1;
          const monthName = monthNames[monthIndex] || month;
          return `${day} ${monthName} ${year}`;
        }

        return '';
      };

      tabDatePart = formatTabDate(game.date);
    }

    const effectiveTabName = `${game.clubName} ${tabDatePart}`.trim();

    // Get current status (empty string if not set)
    let currentStatus = game.status;
    if (!currentStatus) {
      currentStatus = '';
    }

    // Track new status and whether game sheet was created
    let newStatus: GameStatus = currentStatus;
    let gameSheetCreated = false;
    let statusAlreadyUpdated = false; // set true when a case calls updateGameStatus early
    let emailResult: { emailsSent?: number; playersWithoutEmail?: string[]; emailError?: string } = {};
    let teaRotaEmailResult: { emailsSent?: number; membersWithoutEmail?: string[]; emailError?: string } = {};

    // Handle different status transition actions with validation and sheet operations
    switch (action) {
      // OPEN: Transition from blank to 'O' (Open for player entries)
      // Also handles re-open after being stepped back to Upcoming (status='')
      case 'open':
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: `Can only open Upcoming games — this game is ${statusLabel(currentStatus)}. Refresh the game list.` },
            { status: 400 }
          );
        }

        // Set new status to Open
        newStatus = 'O';

        // Write the tabName and status to the Games sheet FIRST so that
        // createGameColumn and createGameSheet can find the game by tabName.
        await updateGameStatus(effectiveTabName, newStatus, {
          modifiedBy: session.user.userName,
          rowNumber: game.rowNumber,
        });
        statusAlreadyUpdated = true;

        // Create column in Players sheet (skipped if it already exists)
        await createGameColumn(effectiveTabName);

        // Create the individual game sheet now (moved from Close)
        // createGameSheet skips if sheet already exists, and deduplicates players on re-open.
        // Skip stat computation here — stats are snapshotted for everyone at close.
        await createGameSheet(effectiveTabName, undefined, true);
        gameSheetCreated = true;
        break;

      // ALLOCATE: Transition from 'O' (Open) to 'L' (Allocating) — paired games only
      // Entries are closed but no game sheets are created yet.
      // Captain will allocate players between paired games, then close to create sheets.
      case 'allocate':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only allocate games with Open status' },
            { status: 400 }
          );
        }

        // Set new status to Allocating (entries closed, no game sheet yet)
        newStatus = 'L';
        // Clear needs-players flag — entries are now closed
        await setNeedsPlayersFlag(effectiveTabName, false);
        break;

      // CLOSE: Transition from 'O' (Open) to 'X' (Selecting/Closed for entries)
      // Also handles 'L' → 'X' for paired games after allocation
      case 'close':
        if (currentStatus !== 'O' && currentStatus !== 'L') {
          return NextResponse.json(
            { error: `Can only close Open games — this game is ${statusLabel(currentStatus)}. Refresh the game list.` },
            { status: 400 }
          );
        }

        // Set new status to Selecting (closed for new entries)
        newStatus = 'X';
        // Game sheet was already created at Open time — no sheet work needed here
        // Clear needs-players flag — entries are now closed
        await setNeedsPlayersFlag(effectiveTabName, false);
        // Snapshot every player's display stats + last-6 hover note now, at close.
        // These are frozen from here on (the selection page no longer re-refreshes).
        await updateGameSheetStats(effectiveTabName);
        break;

      // PUBLISH: Transition from 'X' (Selecting) to 'S' (Selected/Published team)
      case 'publish':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: `Can only publish Selecting games — this game is ${statusLabel(currentStatus)}. Refresh the game list.` },
            { status: 400 }
          );
        }

        // Set new status to Selected (team has been picked and published)
        newStatus = 'S';

        // If email notification requested, send emails to all entered players
        if (send_email) {
          try {
            // Get all players from the game sheet (all entered players)
            const gamePlayers = await getGameSheet(effectiveTabName);

            // Get all users to find email addresses
            const allUsers = await getAllUsers();
            const userEmailMap = new Map<string, string>();
            for (const user of allUsers) {
              if (user.userName && user.emailAddress) {
                userEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
              }
            }

            // Build player list with email addresses and selection status
            let playersWithEmails = gamePlayers.map(player => ({
              userName: player.name,
              fullName: player.fullName || player.name,
              email: userEmailMap.get(player.name.toLowerCase()) || null,
              selected: player.selected,
              team: player.team,
              position: player.position,
              driving: player.driving,
              carNumber: player.carNumber,
            }));

            // If specific players requested, filter to just those usernames
            if (email_player_names && email_player_names.length > 0) {
              const targetSet = new Set(email_player_names.map(n => n.toLowerCase()));
              playersWithEmails = playersWithEmails.filter(p => targetSet.has(p.userName.toLowerCase()));
            }

            // Derive app URL from the incoming request so custom domains work correctly
            const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

            // Send the email
            const result = await sendGamePublishedEmail(game, playersWithEmails, appUrl, false, publish_message);

            emailResult = {
              emailsSent: result.emailsSent,
              playersWithoutEmail: result.playersWithoutEmail,
              emailError: result.error,
            };
          } catch (emailError) {
            console.error('Error sending publish notification emails:', emailError);
            emailResult.emailError = emailError instanceof Error ? emailError.message : 'Failed to send emails';
          }
        }

        // If tea rota email requested and this is a home game, email those on duty
        if (send_tea_rota_email && game.homeAway === 'H') {
          try {
            const teaEntry = await getTeaRotaEntry(game.rowNumber);

            if (teaEntry) {
              const allUsersForRota = await getAllUsers();
              const rotaEmailMap = new Map<string, string>();
              const rotaNameMap = new Map<string, string>();
              const rotaPhoneMap = new Map<string, string>();
              for (const user of allUsersForRota) {
                if (user.userName) {
                  if (user.emailAddress) rotaEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
                  rotaNameMap.set(user.userName.toLowerCase(), user.fullName || user.userName);
                  // Prefer mobile, fall back to landline
                  const phone = user.mobile || user.landline || null;
                  if (phone) rotaPhoneMap.set(user.userName.toLowerCase(), phone);
                }
              }

              const teaMembers = [
                { role: 'Tea Lead', userName: teaEntry.teaLead },
                { role: 'Tea First', userName: teaEntry.teaFirst },
                { role: 'Tea Second', userName: teaEntry.teaSecond },
              ]
                .filter(m => m.userName && m.userName.trim() !== '')
                .map(m => ({
                  role: m.role,
                  fullName: rotaNameMap.get(m.userName.toLowerCase()) || m.userName,
                  email: rotaEmailMap.get(m.userName.toLowerCase()) || null,
                  phone: rotaPhoneMap.get(m.userName.toLowerCase()) || null,
                }));

              const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
              const rotaResult = await sendTeaRotaEmail(game, teaMembers, appUrl);

              teaRotaEmailResult = {
                emailsSent: rotaResult.emailsSent,
                membersWithoutEmail: rotaResult.membersWithoutEmail,
                emailError: rotaResult.error,
              };
            }
          } catch (teaEmailError) {
            console.error('Error sending tea rota notification email:', teaEmailError);
            teaRotaEmailResult.emailError = teaEmailError instanceof Error ? teaEmailError.message : 'Failed to send tea rota email';
          }
        }
        break;

      // REPUBLISH: Re-send the published email without changing status (game already 'S')
      case 'republish':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only republish games that are already published' },
            { status: 400 }
          );
        }

        // Status stays 'S' — no change needed, just re-send the email
        newStatus = 'S';

        if (send_email) {
          try {
            const gamePlayers = await getGameSheet(effectiveTabName);
            const allUsers = await getAllUsers();
            const userEmailMap = new Map<string, string>();
            for (const user of allUsers) {
              if (user.userName && user.emailAddress) {
                userEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
              }
            }
            let playersWithEmails = gamePlayers.map(player => ({
              userName: player.name,
              fullName: player.fullName || player.name,
              email: userEmailMap.get(player.name.toLowerCase()) || null,
              selected: player.selected,
              team: player.team,
              position: player.position,
              driving: player.driving,
              carNumber: player.carNumber,
            }));
            if (email_player_names && email_player_names.length > 0) {
              const targetSet = new Set(email_player_names.map(n => n.toLowerCase()));
              playersWithEmails = playersWithEmails.filter(p => targetSet.has(p.userName.toLowerCase()));
            }
            const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
            const result = await sendGamePublishedEmail(game, playersWithEmails, appUrl, true, publish_message);
            emailResult = {
              emailsSent: result.emailsSent,
              playersWithoutEmail: result.playersWithoutEmail,
              emailError: result.error,
            };
          } catch (emailError) {
            console.error('Error sending republish notification emails:', emailError);
            emailResult.emailError = emailError instanceof Error ? emailError.message : 'Failed to send emails';
          }
        }
        break;

      // PLAYED: Transition from 'S' (Selected) to 'P' (Played/Completed)
      case 'played':
        // Validate that game is currently Selected (team was published)
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only mark Selected games as played' },
            { status: 400 }
          );
        }

        // Validate that both scores are provided (required for completed games)
        if (bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Scores required for played status' },
            { status: 400 }
          );
        }

        // Set new status to Played
        newStatus = 'P';
        break;

      // CANCEL: Transition to 'C' (Cancelled) - can happen from any status
      case 'cancel':
        // Validate that cancellation reason and who cancelled are provided
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }

        // Set new status to Cancelled
        newStatus = 'C';

        // Email all entered players with a METHOD:CANCEL ICS
        if (send_email) {
          try {
            const allUsers = await getAllUsers();
            const userEmailMap = new Map<string, string>();
            const userNameMap = new Map<string, string>();
            for (const user of allUsers) {
              if (user.userName) {
                if (user.emailAddress) userEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
                userNameMap.set(user.userName.toLowerCase(), user.fullName || user.userName);
              }
            }

            // Fetch Players sheet to find everyone who entered this game
            const { getGoogleSheetsClient } = await import('@/lib/sheets');
            const sheets = getGoogleSheetsClient();
            const playersResponse = await sheets.spreadsheets.values.get({
              spreadsheetId: process.env.FRIENDLIES_SPREADSHEET_ID!,
              range: 'Players!A:ZZ',
            });
            const rows = playersResponse.data.values || [];
            const headers = rows[0] || [];
            const gameColIndex = headers.findIndex((h: string) => h === effectiveTabName);
            const userNameColIndex = headers.findIndex((h: string) =>
              h.toLowerCase().replace(/\s+/g, '_') === 'user_name'
            );

            const enteredPlayers: Array<{ userName: string; fullName: string; email: string | null }> = [];
            if (gameColIndex !== -1 && userNameColIndex !== -1) {
              for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const entry = row[gameColIndex];
                const uName = row[userNameColIndex];
                if (entry && uName) {
                  enteredPlayers.push({
                    userName: uName,
                    fullName: userNameMap.get(uName.toLowerCase()) || uName,
                    email: userEmailMap.get(uName.toLowerCase()) || null,
                  });
                }
              }
            }

            const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
            const cancelResult = await sendGameCancelledEmail(game, enteredPlayers, appUrl, reason);
            emailResult = {
              emailsSent: cancelResult.emailsSent,
              playersWithoutEmail: cancelResult.playersWithoutEmail,
              emailError: cancelResult.error,
            };
          } catch (emailError) {
            console.error('Error sending cancellation emails:', emailError);
            emailResult.emailError = emailError instanceof Error ? emailError.message : 'Failed to send emails';
          }
        }

        // Email tea rota members for home games
        if (send_tea_rota_email && game.homeAway === 'H') {
          try {
            const teaEntry = await getTeaRotaEntry(game.rowNumber);
            if (teaEntry) {
              const allUsersForRota = await getAllUsers();
              const rotaEmailMap = new Map<string, string>();
              const rotaNameMap = new Map<string, string>();
              for (const user of allUsersForRota) {
                if (user.userName) {
                  if (user.emailAddress) rotaEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
                  rotaNameMap.set(user.userName.toLowerCase(), user.fullName || user.userName);
                }
              }
              const teaMembers = [
                { role: 'Tea Lead', userName: teaEntry.teaLead },
                { role: 'Tea First', userName: teaEntry.teaFirst },
                { role: 'Tea Second', userName: teaEntry.teaSecond },
              ]
                .filter(m => m.userName && m.userName.trim() !== '')
                .map(m => ({
                  role: m.role,
                  fullName: rotaNameMap.get(m.userName.toLowerCase()) || m.userName,
                  email: rotaEmailMap.get(m.userName.toLowerCase()) || null,
                }));

              const rotaResult = await sendTeaRotaCancelledEmail(game, teaMembers, reason);
              teaRotaEmailResult = {
                emailsSent: rotaResult.emailsSent,
                membersWithoutEmail: rotaResult.membersWithoutEmail,
                emailError: rotaResult.error,
              };
            }
          } catch (teaEmailError) {
            console.error('Error sending tea rota cancellation email:', teaEmailError);
            teaRotaEmailResult.emailError = teaEmailError instanceof Error ? teaEmailError.message : 'Failed to send tea rota email';
          }
        }

        // Mark all player entries as 'C' so stale P/R/T values don't inflate
        // percent_played the next time update-stats runs
        try {
          await markGamePlayerEntriesAs(effectiveTabName, 'C');
        } catch (e) {
          console.error('[cancel] Failed to mark player entries as C:', e);
        }

        // Clear needs-players flag
        await setNeedsPlayersFlag(effectiveTabName, false);
        break;

      // ABANDON: Transition from 'S' (Selected) to 'A' (Abandoned)
      case 'abandon':
        // Validate that game is currently Selected (was being played)
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only abandon Selected games' },
            { status: 400 }
          );
        }

        // Validate that abandonment reason and partial scores are provided
        // Abandoned games had started but didn't finish (weather, injury, etc.)
        if (!reason || bhbc_score === undefined || opponent_score === undefined) {
          return NextResponse.json(
            { error: 'Reason and partial scores required for abandoned status' },
            { status: 400 }
          );
        }

        // Set new status to Abandoned
        newStatus = 'A';

        // Mark all player entries as 'A' so they don't pollute stats
        try {
          await markGamePlayerEntriesAs(effectiveTabName, 'A');
        } catch (e) {
          console.error('[abandon] Failed to mark player entries as A:', e);
        }
        break;

      // REOPEN: Transition from 'O' (Open) back to '' (Upcoming) — undo an accidental open
      case 'reopen':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only revert Open games back to Upcoming' },
            { status: 400 }
          );
        }
        newStatus = '';
        // Clear needs-players flag — game is no longer open
        await setNeedsPlayersFlag(effectiveTabName, false);
        break;

      // REOPEN-ENTRIES: Transition from 'X' (Selecting) back to 'O' (Open) — re-open entries
      case 'reopen-entries':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only revert Selecting games back to Open' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        break;

      // UNPUBLISH: Transition from 'S' (Selected) back to 'X' (Selecting) — undo a publish
      case 'unpublish':
        if (currentStatus !== 'S') {
          return NextResponse.json(
            { error: 'Can only revert Published games back to Selecting' },
            { status: 400 }
          );
        }
        newStatus = 'X';
        break;

      // REVERT-TO-SELECTED: Transition from P/C/A back to 'S' (Selected)
      // Leaves scores, reasons, and other outcome fields intact as default values for re-entry
      case 'revert-to-selected':
        if (!['P', 'C', 'A'].includes(currentStatus)) {
          return NextResponse.json(
            { error: 'Can only revert Played, Cancelled, or Abandoned games to Selected' },
            { status: 400 }
          );
        }
        newStatus = 'S';
        break;

      // FLAG-NEEDS-PLAYERS: Captain marks an Open game as needing players (diary nudge)
      case 'flag-needs-players':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only flag Open games as needing players' },
            { status: 400 }
          );
        }
        await setNeedsPlayersFlag(effectiveTabName, true);
        clearSheetDataCacheByPrefix('friendlies-games:');
        clearAllDiaryCaches();
        return NextResponse.json({ success: true, new_status: currentStatus });

      // UNFLAG-NEEDS-PLAYERS: Captain removes the needs-players flag
      case 'unflag-needs-players':
        await setNeedsPlayersFlag(effectiveTabName, false);
        clearSheetDataCacheByPrefix('friendlies-games:');
        clearAllDiaryCaches();
        return NextResponse.json({ success: true, new_status: currentStatus });

      // Reject invalid action names
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the game status in the Games sheet (skip for republish — status unchanged,
    // or if already updated earlier in the switch e.g. 'open' action)
    if (action !== 'republish' && !statusAlreadyUpdated) await updateGameStatus(effectiveTabName, newStatus, {
      bhbcScore: bhbc_score,        // Our score (for played/abandoned games)
      opponentScore: opponent_score, // Opponent score (for played/abandoned games)
      reason,                        // Reason for cancellation/abandonment
      who,                          // Who initiated cancellation
      modifiedBy: session.user.userName, // Track who made this status change
      rowNumber: game.rowNumber,    // Row number to find game if tabName is empty
    });

    // Build success response with new status and whether game sheet was created
    const response: ChangeStatusResponse & {
      emails_sent?: number;
      players_without_email?: string[];
      email_error?: string;
      tea_rota_emails_sent?: number;
      tea_rota_members_without_email?: string[];
      tea_rota_email_error?: string;
    } = {
      success: true,
      new_status: newStatus,            // The new status code (O, X, S, P, C, or A)
      game_sheet_created: gameSheetCreated, // True if game sheet was created (close action)
    };

    // Add email results if applicable
    if (emailResult.emailsSent !== undefined) {
      response.emails_sent = emailResult.emailsSent;
    }
    if (emailResult.playersWithoutEmail && emailResult.playersWithoutEmail.length > 0) {
      response.players_without_email = emailResult.playersWithoutEmail;
    }
    if (emailResult.emailError) {
      response.email_error = emailResult.emailError;
    }

    // Add tea rota email results if applicable
    if (teaRotaEmailResult.emailsSent !== undefined) {
      response.tea_rota_emails_sent = teaRotaEmailResult.emailsSent;
    }
    if (teaRotaEmailResult.membersWithoutEmail && teaRotaEmailResult.membersWithoutEmail.length > 0) {
      response.tea_rota_members_without_email = teaRotaEmailResult.membersWithoutEmail;
    }
    if (teaRotaEmailResult.emailError) {
      response.tea_rota_email_error = teaRotaEmailResult.emailError;
    }

    // Return success response to client
    return NextResponse.json(response);
  } catch (error) {
    // Log error details for debugging
    console.error('Error updating game status:', error);

    // Return 500 error response to client
    return NextResponse.json(
      { error: 'Failed to update game status' },
      { status: 500 }
    );
  }
}
