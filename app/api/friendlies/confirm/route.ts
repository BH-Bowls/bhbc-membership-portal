// app/api/friendlies/confirm/route.ts
// API endpoint for players to confirm their participation after being selected for a game
// Updates the confirmation status column in the game sheet from blank to 'Y' (confirmed)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet } from '@/lib/friendlies-sheets';
import { ConfirmParticipationRequest } from '@/lib/types/friendlies';
import { getUserByUsername } from '@/lib/sheets';
import { canManageUser } from '@/lib/buddies-sheets';
import { buildFriendlyICSAttachment, isGmailAddress, icsUpdatesEnabled } from '@/lib/ics-utils';
import { sendEmail } from '@/lib/email/mailer';

// POST handler - Confirms player's participation in a selected game
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);

    // Reject if not logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: ConfirmParticipationRequest & { onBehalfOf?: string[] } = await request.json();
    // Decode tab_name in case it's URL-encoded
    const tab_name = decodeURIComponent(body.tab_name);

    // Get current user's username
    const userName = session.user.userName;

    // Optional: additional players to confirm alongside the caller (their buddies —
    // the same people they can "switch user" to). Each is authorised below.
    const onBehalfOf: string[] = Array.isArray(body.onBehalfOf) ? body.onBehalfOf : [];

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

    // Only allow confirmation for games in Selected (S) status
    if (game.status !== 'S') {
      return NextResponse.json(
        { error: 'Can only confirm participation for selected games' },
        { status: 400 }
      );
    }

    // Fetch all players from the game sheet
    const players = await getGameSheet(game.tabName);

    // Build the set of usernames to confirm: the caller, plus any authorised buddies.
    const targets: string[] = [userName];
    for (const other of onBehalfOf) {
      if (!other || other === userName) continue;
      // Only buddies (people who list the caller as their buddy) may be confirmed by them
      const allowed = await canManageUser(userName, session.user.role, other);
      if (!allowed) {
        return NextResponse.json(
          { error: 'You can only confirm for your own partner' },
          { status: 403 }
        );
      }
      targets.push(other);
    }

    // Resolve each target to a selected game-sheet row. A target who isn't a selected
    // player is skipped. For a plain self-confirm (no buddies) preserve the clear
    // "not in game / not selected" errors.
    const updates: { rowNumber: number; status: string }[] = [];
    for (const target of targets) {
      let player = null;
      for (const p of players) {
        if (p.name === target) { player = p; break; }
      }
      const selected = !!player && ['Y', 'R', 'T'].includes(player.selected);
      if (target === userName && onBehalfOf.length === 0) {
        if (!player) {
          return NextResponse.json({ error: 'You are not in this game' }, { status: 404 });
        }
        if (!selected) {
          return NextResponse.json({ error: 'You have not been selected for this game' }, { status: 400 });
        }
      }
      if (player && selected) {
        updates.push({ rowNumber: player.rowNumber, status: 'Y' });
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No selected players to confirm' }, { status: 400 });
    }

    // Update confirmation status to 'Y' (confirmed) for the caller + any buddies
    await updateGameSheet(game.tabName, updates);

    // Send ICS confirmation email (fire-and-forget — failure does not affect the response)
    // Gated by ICS_UPDATE_EMAILS flag; Gmail users always skipped
    try {
      const user = await getUserByUsername(userName);
      if (icsUpdatesEnabled() && user?.emailAddress && !isGmailAddress(user.emailAddress)) {
        const ics = buildFriendlyICSAttachment({
          tabName: game.tabName,
          userName,
          sequence: 99,
          method: 'REQUEST',
          status: 'CONFIRMED',
          dateStr: game.date,
          timeStr: game.time,
          clubName: game.clubName,
          homeAway: game.homeAway,
          format: game.format,
          trigger: 'confirmed',
          organizerEmail: process.env.SMTP_USER,
          attendeeEmail: user.emailAddress,
        });
        const subject = `Participation Confirmed — ${game.clubName} ${game.date}`;
        const text = [
          `You have confirmed your participation in the friendly against ${game.clubName}.`,
          '',
          `Date: ${game.date}`,
          `Time: ${game.time}`,
          `Venue: ${game.homeAway === 'H' ? 'Home' : `Away at ${game.clubName}`}`,
          `Format: ${game.format}`,
          '',
          'A calendar attachment is included to update the event in your calendar.',
          '',
          '---',
          'Burgess Hill Bowls Club',
        ].join('\n');
        await sendEmail(user.emailAddress, subject, text, undefined, [ics]);
      }
    } catch (icsError) {
      console.error('Error sending confirm ICS email:', icsError);
    }

    // Return success response
    return NextResponse.json({
      success: true,
      message: 'Participation confirmed',
    });
  } catch (error) {
    // Log error and return 500 response
    return NextResponse.json(
      { error: 'Failed to confirm participation' },
      { status: 500 }
    );
  }
}
