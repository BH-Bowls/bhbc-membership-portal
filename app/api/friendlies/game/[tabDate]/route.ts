// GET /api/friendlies/game/[tabDate] - Get game details for player
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet } from '@/lib/friendlies-sheets';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    // Check if user is logged in
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tabDate } = await params;
    const userName = session.user.userName;

    // Get game details
    const games = await getGames();

    // Find the game with this tabName (URL parameter is called tabDate but contains tabName)
    let game = null;
    for (const g of games) {
      if (g.tabName === tabDate) {
        game = g;
        break;
      }
    }

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
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
    let currentUser = null;
    for (const p of allPlayers) {
      if (p.name === userName) {
        currentUser = p;
        break;
      }
    }

    // Organize into teams
    const regularPlayers = selectedPlayers.filter(p => p.selected === 'Y');
    const reserves = selectedPlayers.filter(p => p.selected === 'R');
    const reserveTeams = selectedPlayers.filter(p => p.selected === 'T');

    // Group regular players by team
    const teams: any[] = [];

    // Get unique team numbers
    const teamNumbersSet = new Set<number>();
    for (const p of regularPlayers) {
      if (p.team !== null) {
        teamNumbersSet.add(p.team);
      }
    }
    const teamNumbers = Array.from(teamNumbersSet);
    teamNumbers.sort();

    for (const teamNum of teamNumbers) {
      const teamPlayers = regularPlayers
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder = { 'S': 0, '1': 1, '2': 2, '3': 3 };

          let posA = posOrder[a.position as keyof typeof posOrder];
          if (posA === undefined) posA = 99;

          let posB = posOrder[b.position as keyof typeof posOrder];
          if (posB === undefined) posB = 99;

          return posA - posB;
        });

      teams.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.fullName,  // Use fullName for display
          userName: p.name,  // Include userName for current user highlighting
          position: p.position,
          status: p.status,
          isCaptain: p.captain === 'Y',
        })),
      });
    }

    // Group reserve team players
    const reserveTeamsList: any[] = [];

    // Get unique reserve team numbers
    const reserveTeamNumbersSet = new Set<number>();
    for (const p of reserveTeams) {
      if (p.team !== null) {
        reserveTeamNumbersSet.add(p.team);
      }
    }
    const reserveTeamNumbers = Array.from(reserveTeamNumbersSet);
    reserveTeamNumbers.sort();

    for (const teamNum of reserveTeamNumbers) {
      const teamPlayers = reserveTeams
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder = { 'S': 0, '1': 1, '2': 2, '3': 3 };

          let posA = posOrder[a.position as keyof typeof posOrder];
          if (posA === undefined) posA = 99;

          let posB = posOrder[b.position as keyof typeof posOrder];
          if (posB === undefined) posB = 99;

          return posA - posB;
        });

      reserveTeamsList.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.fullName,  // Use fullName for display
          userName: p.name,  // Include userName for current user highlighting
          position: p.position,
          status: p.status,
        })),
      });
    }

    // Find captain of day
    let captain = null;
    for (const p of allPlayers) {
      if (p.captain === 'Y') {
        captain = p;
        break;
      }
    }

    // Get user's status for this game
    let userStatus = null;
    if (currentUser) {
      userStatus = currentUser.selected;
    }

    let userTeam = null;
    if (currentUser) {
      userTeam = currentUser.team;
    }

    let userPosition = null;
    if (currentUser) {
      userPosition = currentUser.position;
    }

    let userConfirmed = false;
    if (currentUser) {
      userConfirmed = currentUser.status === 'Y';
    }

    let captainOfDay = '';
    if (captain) {
      captainOfDay = captain.fullName;  // Use fullName for display
    }

    return NextResponse.json({
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        status: game.status,
        userStatus: userStatus,
        userTeam: userTeam,
        userPosition: userPosition,
        userConfirmed: userConfirmed,
        userName: userName,  // Current user's userName for highlighting
      },
      teams,
      reserves: reserves.map(r => ({
        name: r.fullName,  // Use fullName for display
        userName: r.name,  // Include userName for current user highlighting
        team: r.team,
        position: r.position,
        status: r.status,
      })),
      reserveTeams: reserveTeamsList,
      captainOfDay: captainOfDay,
    });
  } catch (error) {
    console.error('GET /api/friendlies/game error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game details' },
      { status: 500 }
    );
  }
}
