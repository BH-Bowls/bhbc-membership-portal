// POST /api/friendlies/withdraw - Withdraw from a game
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, updateGameSheet, updatePlayerEntry } from '@/lib/friendlies-sheets';
import { sendWithdrawalEmail } from '@/lib/email/friendlies';
import { WithdrawRequest } from '@/lib/types/friendlies';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: WithdrawRequest = await request.json();
    const { tab_date } = body;
    const userName = session.user.userName;

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tab_date);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Handle withdrawal based on game status
    if (game.status === 'O') {
      // Game is still open - just remove entry from Players sheet
      await updatePlayerEntry(userName, game.tabName, '');
      return NextResponse.json({
        success: true,
        message: 'Entry removed',
      });
    }

    if (['X', 'S', 'P'].includes(game.status)) {
      // Game is closed/selected/played - mark as withdrawn and notify captains
      const players = await getGameSheet(game.tabName);
      const userPlayer = players.find(p => p.name === userName);

      if (!userPlayer) {
        return NextResponse.json(
          { error: 'You are not in this game' },
          { status: 404 }
        );
      }

      // Update game sheet Status column (K) to "W"
      await updateGameSheet(game.tabName, [
        {
          rowNumber: userPlayer.rowNumber,
          status: 'W',
        },
      ]);

      // Add "W" suffix to Players sheet status
      let newStatus = userPlayer.selected === 'Y' ? 'PW' :
                     userPlayer.selected === 'R' ? 'RW' :
                     userPlayer.selected === 'T' ? 'TW' : 'EW';

      await updatePlayerEntry(userName, game.tabName, newStatus as any);

      // Send withdrawal email to captains
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
    console.error('Error withdrawing from game:', error);
    return NextResponse.json(
      { error: 'Failed to withdraw from game' },
      { status: 500 }
    );
  }
}
