// app/api/friendlies/manage/status/route.ts
// API endpoint for captains to change game status through the full lifecycle
// Status flow: blank → O (Open) → X (Selecting) → S (Selected) → P (Played)
// Alternative endings: C (Cancelled) or A (Abandoned)
//
// Opening creates the fixture's group (fixture-groups-supabase.ts) — a group of one, or
// several games opened together as a linked occasion. Open/close and their undos act
// on the whole group (one shared entry window); from Selecting onward each game moves
// on its own.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAppUrl } from '@/lib/app-url';
import {
  openFixtures,
  setGroupFixturesStatus,
  getFixtureRoster,
  returnSelectionsToPool,
  appendManageLog,
} from '@/lib/fixture-groups-supabase';
import { getFixtures, updateFixture, getTeaRotaEntry, getGameByIdOrTab, type Fixture } from '@/lib/fixtures-supabase';
import { canManageGame, getSquadForFixture } from '@/lib/squads-supabase';
import { sendSquadTeamPublishedEmails } from '@/lib/email/squads';
import { sendGamePublishedEmail, sendTeaRotaEmail, sendGameCancelledEmail, sendTeaRotaCancelledEmail } from '@/lib/email/friendlies';
import { getAllUsers } from '@/lib/members-supabase';
import { clearAllDiaryCaches, clearSheetDataCacheByPrefix } from '@/lib/home-cache';
import { ChangeStatusRequest, ChangeStatusResponse, GameStatus, GameSheetPlayer } from '@/lib/types/friendlies';
import { hasRole } from '@/lib/role-utils';

// Statuses after which a game's outcome is settled (for "is this the last game in the group?")
const PAST_SELECTING = ['S', 'P', 'C', 'A'];

// POST handler - Changes game status with validation
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: ChangeStatusRequest = await request.json();
    const { tab_name, id, action, expected_status, bhbc_score, opponent_score, no_score, reason, who, send_email, email_player_names, send_tea_rota_email, publish_message } = body;
    const actor = session.user.userName;

    // Fetch all fixtures for the active season
    const games = await getFixtures();

    // Search for the fixture — id is preferred (always present, even before the fixture
    // has ever been opened and so has no tabName yet); tabName is a fallback for older
    // callers that only send it.
    let game: Fixture | null = null;
    if (id) {
      game = games.find(g => g.id === id) || null;
    }
    if (!game && tab_name && tab_name.trim() !== '') {
      game = games.find(g => g.tabName === tab_name) || null;
    }
    // Club Team games aren't in the general fixture list — look them up directly
    if (!game) {
      game = await getGameByIdOrTab(id, tab_name);
    }

    // Return 404 if game doesn't exist
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Captains and Admins can change any game's status. A league / Club Team game's
    // squad organisers can publish it from the selection page (results and cancelling
    // are on the squad page).
    const squad = await getSquadForFixture(game);
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      const organiserAction = ['publish', 'republish', 'unpublish'].includes(action);
      if (!squad || !organiserAction || !(await canManageGame(game, session.user.userName, session.user.role))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const statusLabel = (s: string) => ({ '': 'Upcoming', O: 'Open', X: 'Selecting', S: 'Selected', P: 'Played', C: 'Cancelled', A: 'Abandoned' }[s] ?? s);

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

    // Get current status (empty string if not set)
    const currentStatus: GameStatus = game.status || '';

    // Track new status
    let newStatus: GameStatus = currentStatus;
    let statusAlreadyUpdated = false; // set true when a case writes the status itself
    let emailResult: { emailsSent?: number; playersWithoutEmail?: string[]; emailError?: string } = {};
    let teaRotaEmailResult: { emailsSent?: number; membersWithoutEmail?: string[]; emailError?: string } = {};
    const log = (fixture: Fixture, from: string, to: string, details?: Record<string, unknown>) =>
      appendManageLog({ username: actor, action: `status:${to}`, tabName: fixture.tabName, fixtureId: fixture.id, groupId: fixture.groupId, oldStatus: from, newStatus: to, details });

    // Other games in this game's group (linked games / reserve games)
    // Emails name a squad game by its league (or Club Team) and opponent, e.g.
    // "N/S A v Newick" — a Club Team opponent may be free text rather than a club.
    const emailGame: Fixture = squad
      ? { ...game, clubName: `${squad.squadType === 'league' ? game.gameType : squad.label} v ${game.clubName || game.description || 'TBC'}` }
      : game;

    // (A squad's other fixtures are separate games, not linked ones.)
    const groupMates = game.groupId && !squad ? games.filter(g => g.groupId === game!.groupId && g.id !== game!.id) : [];

    // Handle different status transition actions with validation
    switch (action) {
      // OPEN: blank → 'O'. Creates the group; link_ids ("Open linked with …") open
      // several same-date games together as one linked occasion.
      case 'open': {
        if (currentStatus !== '') {
          return NextResponse.json(
            { error: `Can only open Upcoming games — this game is ${statusLabel(currentStatus)}. Refresh the game list.` },
            { status: 400 }
          );
        }

        let ids: string[];
        if (game.groupId) {
          // Re-opening after a revert to Upcoming: the whole existing group reopens
          ids = [game.id, ...groupMates.filter(g => g.status === '').map(g => g.id)];
        } else {
          // Linked occasion: the other games named by the caller ("Open linked with …")
          const linkIds = Array.isArray(body.link_ids) ? body.link_ids.filter(x => x && x !== game!.id) : [];
          ids = [game.id, ...linkIds];
        }

        try {
          const opened = await openFixtures(ids, actor);
          for (const f of opened.fixtures) {
            if (ids.includes(f.id)) await log(f, '', 'O');
          }
        } catch (openError) {
          return NextResponse.json(
            { error: openError instanceof Error ? openError.message : 'Failed to open game' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        statusAlreadyUpdated = true;
        break;
      }

      // CLOSE: 'O' → 'X' for every game in the group (entries close together)
      case 'close':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: `Can only close Open games — this game is ${statusLabel(currentStatus)}. Refresh the game list.` },
            { status: 400 }
          );
        }
        newStatus = 'X';
        if (game.groupId) {
          // Clear the needs-players flag too — entries are now closed. Unselected
          // entrants are reserves by definition, so there's nothing to default.
          const closedIds = await setGroupFixturesStatus(game.groupId, 'O', 'X', actor, { needs_players: '' });
          for (const f of games.filter(g => closedIds.includes(g.id))) await log(f, 'O', 'X');
          statusAlreadyUpdated = true;
        } else {
          await updateFixture(game.id, { needsPlayers: false });
        }
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

        // If email notification requested, send emails to the game's players
        if (send_email) {
          try {
            // In a linked group the reserves are shared — email them only with the last
            // game of the group to be published, so nobody gets the same news twice.
            const otherMainGamesPending = groupMates.some(g => !g.reserveOf && !PAST_SELECTING.includes(g.status));
            const roster = await getFixtureRoster(game);
            // A league / Club Team game: just the picked team (the rest of the squad are
            // "reserves" only in the sense of who could be picked — don't email them weekly)
            const recipients = roster.filter(p => squad ? p.selected !== 'R' : !(otherMainGamesPending && p.selected === 'R'));
            emailResult = await emailPlayers(recipients, async (players, appUrl) =>
              sendGamePublishedEmail(emailGame, players, appUrl, false, publish_message), email_player_names);
          } catch (emailError) {
            console.error('Error sending publish notification emails:', emailError);
            emailResult.emailError = emailError instanceof Error ? emailError.message : 'Failed to send emails';
          }
        }

        // League / Club Team home game: the two squad members on teas get the squad's teas
        // email ("arrive early to set up… light snack after the game")
        if (send_tea_rota_email && game.homeAway === 'H' && squad) {
          try {
            const teaEntry = await getTeaRotaEntry(game.id);
            const teas = teaEntry ? [teaEntry.teaLead, teaEntry.teaFirst].filter(Boolean) : [];
            if (teas.length > 0) {
              const appUrl = await getAppUrl();
              const result = await sendSquadTeamPublishedEmails(
                {
                  id: game.id,
                  tabName: game.tabName,
                  squadLabel: squad.label,
                  fixtureType: game.gameType,
                  date: game.date,
                  time: (game.time || '').slice(0, 5),
                  opponent: game.clubName || game.description || 'TBC',
                  homeAway: game.homeAway,
                  format: game.format,
                },
                [],
                teas,
                appUrl,
                publish_message
              );
              teaRotaEmailResult = { emailsSent: result.emailsSent, membersWithoutEmail: result.withoutEmail };
            }
          } catch (teaEmailError) {
            console.error('Error sending squad teas email:', teaEmailError);
            teaRotaEmailResult.emailError = teaEmailError instanceof Error ? teaEmailError.message : 'Failed to send teas email';
          }
        }

        // If tea rota email requested and this is a home friendly, email those on duty
        if (send_tea_rota_email && game.homeAway === 'H' && !squad) {
          try {
            const teaEntry = await getTeaRotaEntry(game.id);

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

              const appUrl = await getAppUrl();
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
            const roster = await getFixtureRoster(game);
            emailResult = await emailPlayers(roster, async (players, appUrl) =>
              sendGamePublishedEmail(emailGame, players, appUrl, true, publish_message), email_player_names);
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

        // Normally both scores are required. A "no score" game (e.g. a reserve team —
        // Burgess Hill vs Burgess Hill) is recorded as played with a reason instead.
        if (!no_score) {
          if (bhbc_score === undefined || opponent_score === undefined) {
            return NextResponse.json(
              { error: 'Scores required for played status' },
              { status: 400 }
            );
          }
        } else if (!reason || !reason.trim()) {
          return NextResponse.json(
            { error: 'A reason is required when recording no score' },
            { status: 400 }
          );
        }

        // Set new status to Played
        newStatus = 'P';
        break;

      // CANCEL: Transition to 'C' (Cancelled) - can happen from any status
      case 'cancel': {
        // Validate that cancellation reason and who cancelled are provided
        if (!reason || !who) {
          return NextResponse.json(
            { error: 'Reason and who required for cancelled status' },
            { status: 400 }
          );
        }

        // Set new status to Cancelled
        newStatus = 'C';

        // Does another main game in the group still go ahead? Then the shared reserves
        // aren't affected by this cancellation.
        const otherGamesGoAhead = groupMates.some(g => !['C', 'A'].includes(g.status));

        // Email the affected players with a METHOD:CANCEL ICS — read the roster BEFORE
        // any return-to-reserves so the selected players still show against this game.
        if (send_email && game.groupId) {
          try {
            const roster = await getFixtureRoster(game);
            const affected = roster.filter(p => !(otherGamesGoAhead && p.selected === 'R'));
            const allUsers = await getAllUsers();
            const userEmailMap = new Map<string, string>();
            for (const user of allUsers) {
              if (user.userName && user.emailAddress) userEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
            }
            const enteredPlayers = affected.map(p => ({
              userName: p.name,
              fullName: p.fullName || p.name,
              email: userEmailMap.get(p.name.toLowerCase()) || null,
            }));

            const appUrl = await getAppUrl();
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
            const teaEntry = await getTeaRotaEntry(game.id);
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

        // Linked group, captain chose to: this game's selected players go back into the
        // shared reserves so they can be picked for the game that's still on. Otherwise
        // their selections are kept as they were.
        if (body.return_to_reserves && otherGamesGoAhead) {
          const returned = await returnSelectionsToPool(game.id);
          await appendManageLog({ username: actor, action: 'return-to-reserves', tabName: game.tabName, fixtureId: game.id, groupId: game.groupId, details: { players: returned } });
        }

        // Clear needs-players flag
        await updateFixture(game.id, { needsPlayers: false });
        break;
      }

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

        // Set new status to Abandoned (stats derive C/A from the fixture status — no
        // per-player rewrite needed)
        newStatus = 'A';
        break;

      // REOPEN: 'O' → '' (Upcoming) for the whole group — undo an accidental open.
      // Entries are kept; opening again brings the same group back.
      case 'reopen':
        if (currentStatus !== 'O') {
          return NextResponse.json(
            { error: 'Can only revert Open games back to Upcoming' },
            { status: 400 }
          );
        }
        newStatus = '';
        if (game.groupId) {
          const ids = await setGroupFixturesStatus(game.groupId, 'O', '', actor, { needs_players: '' });
          for (const f of games.filter(g => ids.includes(g.id))) await log(f, 'O', '');
          statusAlreadyUpdated = true;
        } else {
          await updateFixture(game.id, { needsPlayers: false });
        }
        break;

      // REOPEN-ENTRIES: 'X' → 'O' for the group's games still Selecting — re-open entries
      case 'reopen-entries':
        if (currentStatus !== 'X') {
          return NextResponse.json(
            { error: 'Can only revert Selecting games back to Open' },
            { status: 400 }
          );
        }
        newStatus = 'O';
        if (game.groupId) {
          const ids = await setGroupFixturesStatus(game.groupId, 'X', 'O', actor);
          for (const f of games.filter(g => ids.includes(g.id))) await log(f, 'X', 'O');
          statusAlreadyUpdated = true;
        }
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
        await updateFixture(game.id, { needsPlayers: true });
        clearSheetDataCacheByPrefix('friendlies-games:');
        clearAllDiaryCaches();
        return NextResponse.json({ success: true, new_status: currentStatus });

      // UNFLAG-NEEDS-PLAYERS: Captain removes the needs-players flag
      case 'unflag-needs-players':
        await updateFixture(game.id, { needsPlayers: false });
        clearSheetDataCacheByPrefix('friendlies-games:');
        clearAllDiaryCaches();
        return NextResponse.json({ success: true, new_status: currentStatus });

      // Reject invalid action names
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Update the fixture's status in Postgres (skip for republish — status unchanged,
    // or if a group-level case already wrote it)
    if (action !== 'republish' && !statusAlreadyUpdated) {
      await updateFixture(game.id, {
        status: newStatus,
        bhbcScore: bhbc_score,        // Our score (for played/abandoned games)
        opponentScore: opponent_score, // Opponent score (for played/abandoned games)
        reason,                        // Reason for cancellation/abandonment
        who,                           // Who initiated cancellation
        lastModifiedBy: actor,         // Track who made this status change
      });
      await log(game, currentStatus, newStatus);
    }

    // Status changes alter what every member's diary shows
    clearAllDiaryCaches();

    const response: ChangeStatusResponse & {
      emails_sent?: number;
      players_without_email?: string[];
      email_error?: string;
      tea_rota_emails_sent?: number;
      tea_rota_members_without_email?: string[];
      tea_rota_email_error?: string;
    } = {
      success: true,
      new_status: newStatus,
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

    return NextResponse.json(response);
  } catch (error) {
    // Log error details for debugging
    console.error('Error updating game status:', error);

    return NextResponse.json(
      { error: 'Failed to update game status' },
      { status: 500 }
    );
  }
}

/**
 * Build the publish-email recipient list from a roster (optionally limited to named
 * players) and send it. Shared by publish and republish.
 */
async function emailPlayers(
  roster: GameSheetPlayer[],
  send: (
    players: Array<{ userName: string; fullName: string; email: string | null; selected: string; team: number | null; position: string; driving: string; carNumber: string }>,
    appUrl: string
  ) => Promise<{ emailsSent: number; playersWithoutEmail: string[]; error?: string }>,
  onlyNames?: string[]
): Promise<{ emailsSent?: number; playersWithoutEmail?: string[]; emailError?: string }> {
  const allUsers = await getAllUsers();
  const userEmailMap = new Map<string, string>();
  for (const user of allUsers) {
    if (user.userName && user.emailAddress) userEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
  }

  let players = roster.map(player => ({
    userName: player.name,
    fullName: player.fullName || player.name,
    email: userEmailMap.get(player.name.toLowerCase()) || null,
    selected: player.selected,
    team: player.team,
    position: player.position,
    driving: player.driving,
    carNumber: player.carNumber,
  }));

  if (onlyNames && onlyNames.length > 0) {
    const targetSet = new Set(onlyNames.map(n => n.toLowerCase()));
    players = players.filter(p => targetSet.has(p.userName.toLowerCase()));
  }

  const appUrl = await getAppUrl();
  const result = await send(players, appUrl);
  return { emailsSent: result.emailsSent, playersWithoutEmail: result.playersWithoutEmail, emailError: result.error };
}
