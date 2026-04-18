// app/api/friendlies/manage/send-test-email/route.ts
// Sends a single preview copy of the game-published email to the logged-in captain/admin.
// Used to check the email layout before publishing to all players.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet } from '@/lib/friendlies-sheets';
import { GameSheetPlayer } from '@/lib/types/friendlies';
import { sendGamePublishedEmail } from '@/lib/email/friendlies';
import { getAllUsers } from '@/lib/sheets';
import { hasRole } from '@/lib/role-utils';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userEmail = session.user.email;
    if (!userEmail) {
      return NextResponse.json({ error: 'Your account has no email address on file' }, { status: 400 });
    }

    const { tab_name } = await request.json();

    const games = await getGames();
    const game = games.find(g => g.tabName === tab_name);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Get game sheet players so we can use real selection data if the sender is in the game
    let gamePlayers: GameSheetPlayer[] = [];
    try {
      gamePlayers = await getGameSheet(tab_name);
    } catch {
      // game sheet may not exist yet — fall back to empty list
    }

    // Build email address map so we can find the sender's selection status
    const allUsers = await getAllUsers();
    const userEmailMap = new Map<string, string>();
    for (const user of allUsers) {
      if (user.userName && user.emailAddress) {
        userEmailMap.set(user.userName.toLowerCase(), user.emailAddress);
      }
    }

    // Find the sender in the game sheet (if they entered)
    const senderInGame = gamePlayers.find(
      p => p.name.toLowerCase() === session.user.userName?.toLowerCase()
    );

    // Build a single-player payload representing the sender.
    // If they're in the game use their real status; otherwise show "Selected — Playing" as a demo.
    const previewPlayer = {
      fullName: session.user.name || session.user.userName || 'Captain',
      email: userEmail,
      selected: (senderInGame?.selected || 'Y') as string,
      team: senderInGame?.team ?? 1,
      position: senderInGame?.position ?? 'S',
    };

    const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    const result = await sendGamePublishedEmail(game, [previewPlayer], appUrl);

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to send test email' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending test email:', error);
    return NextResponse.json({ error: 'Failed to send test email' }, { status: 500 });
  }
}
