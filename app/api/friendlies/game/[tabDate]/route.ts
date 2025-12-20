// GET /api/friendlies/game/[tabDate] - Get game details for player
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, getPlayerEntries } from '@/lib/friendlies-sheets';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tabDate } = await params;
    const userName = session.user.userName;

    // Get game details
    const games = await getGames();
    const game = games.find(g => g.tabDate === tabDate);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Verify user has entered this game
    const userEntries = await getPlayerEntries(userName);
    const userEntry = userEntries.find(e => e.tabName === game.tabName);

    if (!userEntry) {
      return NextResponse.json({ error: 'You have not entered this game' }, { status: 403 });
    }

    // Verify game status is S, P, C, or A
    if (!['S', 'P', 'C', 'A'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Game details not available yet' },
        { status: 400 }
      );
    }

    // Read game sheet
    const allPlayers = await getGameSheet(game.tabName);

    // Filter to show only selected players (Selected = Y/R/T)
    const selectedPlayers = allPlayers.filter(p =>
      ['Y', 'R', 'T'].includes(p.selected)
    );

    // Find current user's details
    const currentUser = allPlayers.find(p => p.name === userName);

    // Organize into teams
    const regularPlayers = selectedPlayers.filter(p => p.selected === 'Y');
    const reserves = selectedPlayers.filter(p => p.selected === 'R');
    const reserveTeams = selectedPlayers.filter(p => p.selected === 'T');

    // Group regular players by team
    const teams: any[] = [];
    const teamNumbers = [...new Set(regularPlayers.map(p => p.team).filter(t => t !== null))];

    for (const teamNum of teamNumbers.sort()) {
      const teamPlayers = regularPlayers
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder = { 'S': 0, '1': 1, '2': 2, '3': 3 };
          return (posOrder[a.position as keyof typeof posOrder] || 99) -
                 (posOrder[b.position as keyof typeof posOrder] || 99);
        });

      teams.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
          isCaptain: p.captain === 'Y',
        })),
      });
    }

    // Group reserve team players
    const reserveTeamsList: any[] = [];
    const reserveTeamNumbers = [...new Set(reserveTeams.map(p => p.team).filter(t => t !== null))];

    for (const teamNum of reserveTeamNumbers.sort()) {
      const teamPlayers = reserveTeams
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder = { 'S': 0, '1': 1, '2': 2, '3': 3 };
          return (posOrder[a.position as keyof typeof posOrder] || 99) -
                 (posOrder[b.position as keyof typeof posOrder] || 99);
        });

      reserveTeamsList.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
        })),
      });
    }

    // Find captain of day
    const captain = allPlayers.find(p => p.captain === 'Y');

    return NextResponse.json({
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        status: game.status,
        userStatus: currentUser?.selected || null,
        userTeam: currentUser?.team || null,
        userPosition: currentUser?.position || null,
        userConfirmed: currentUser?.status === 'Y',
      },
      teams,
      reserves: reserves.map(r => ({
        name: r.name,
        team: r.team,
        position: r.position,
        status: r.status,
      })),
      reserveTeams: reserveTeamsList,
      captainOfDay: captain?.name || '',
    });
  } catch (error) {
    console.error('Error fetching game details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game details' },
      { status: 500 }
    );
  }
}
