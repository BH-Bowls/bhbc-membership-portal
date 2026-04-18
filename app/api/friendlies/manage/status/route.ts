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
} from '@/lib/friendlies-sheets';
import { sendGamePublishedEmail, sendTeaRotaEmail } from '@/lib/email/friendlies';
import { getAllUsers } from '@/lib/sheets';
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
    const { tab_name, row_number, action, bhbc_score, opponent_score, reason, who, send_email, send_tea_rota_email } = body;

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
      console.log('[Status API] Looking up game by rowNumber:', row_number, 'found:', !!game);
    }

    // Return 404 if game doesn't exist
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Generate effectiveTabName - this will be used for all operations
    // Format: "ClubName DD MMM YY" (e.g., "West Hoathly 13 Jan 25")
    console.log('[Status API] Game data - date:', game.date, 'tabDate:', game.tabDate, 'clubName:', game.clubName);

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
    console.log('[Status API] Generated effectiveTabName:', effectiveTabName, 'for game at row', game.rowNumber);

    // Get current status (empty string if not set)
    let currentStatus = game.status;
    if (!currentStatus) {
      currentStatus = '';
    }

    // Track new status and whether game sheet was created
    let newStatus: GameStatus = currentStatus;
    let gameSheetCreated = false;
    let emailResult: { emailsSent?: number; playersWithoutEmail?: string[]; emailError?: string } = {};
    let teaRotaEmailResult: { emailsSent?: number; membersWithoutEmail?: string[]; emailError?: string } = {};

    // Handle different status transition actions with validation and sheet operations
    switch (action) {
      // OPEN: Transition from blank to 'O' (Open for player entries)
      case 'open':
        // Validate that game is currently blank (not already opened or in later stage)
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: 'Can only open games with blank status' },
            { status: 400 }
          );
        }

        // Set new status to Open
        newStatus = 'O';

        // Create a new column in Players sheet for this game
        // Players will use this column to mark their entry status (E, P, R, etc.)
        // Use effectiveTabName to ensure we have a valid name
        await createGameColumn(effectiveTabName);
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
        break;

      // CLOSE: Transition from 'O' (Open) to 'X' (Selecting/Closed for entries)
      // Also handles 'L' → 'X' for paired games after allocation
      case 'close':
        // Validate that game is currently Open or Allocating
        if (currentStatus !== 'O' && currentStatus !== 'L') {
          return NextResponse.json(
            { error: 'Can only close games with Open or Allocating status' },
            { status: 400 }
          );
        }

        // Set new status to Selecting (closed for new entries)
        newStatus = 'X';

        // Create dedicated game sheet (tab) for team selection
        // This sheet will hold all entered players with teams, positions, etc.
        // Use effectiveTabName to ensure we have a valid name
        await createGameSheet(effectiveTabName);
        gameSheetCreated = true;
        break;

      // PUBLISH: Transition from 'X' (Selecting) to 'S' (Selected/Published team)
      case 'publish':
        // Validate that game is currently in Selecting status
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only publish games with Selecting status' },
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
            const playersWithEmails = gamePlayers.map(player => ({
              fullName: player.fullName || player.name,
              email: userEmailMap.get(player.name.toLowerCase()) || null,
              selected: player.selected,
              team: player.team,
              position: player.position,
            }));

            // Derive app URL from the incoming request so custom domains work correctly
            const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

            // Send the email
            const result = await sendGamePublishedEmail(game, playersWithEmails, appUrl);

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
        break;

      // Reject invalid action names
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the game status in the Games sheet along with any additional data
    // Use effectiveTabName to ensure we have a valid name for all operations
    // Pass rowNumber to identify unopened games that don't have tabName yet
    await updateGameStatus(effectiveTabName, newStatus, {
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
