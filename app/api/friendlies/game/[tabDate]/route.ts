// GET /api/friendlies/game/[tabDate] - Get game details for player
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getGames, getGameSheet, getClubDetails, getTeaRotaList } from '@/lib/friendlies-sheets';
import { getUserByUsername } from '@/lib/sheets';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tabDate: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    const { tabDate } = await params;
    const isAuthenticated = !!session?.user;
    const userName = session?.user?.userName ?? null;

    // For unauthenticated visitors arriving via an email link, ?me= identifies the viewer
    const meParam = !isAuthenticated ? (request.nextUrl.searchParams.get('me') ?? null) : null;
    const viewerUserName = userName ?? meParam;

    // Unauthenticated: show first name only, except for the viewer's own entry
    function displayName(fullName: string, playerUserName: string): string {
      if (isAuthenticated) return fullName;
      if (viewerUserName && playerUserName === viewerUserName) return fullName;
      return fullName.split(' ')[0];
    }

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

    // Verify game is in a viewable state (not Upcoming or Allocating)
    if (!['O', 'X', 'S', 'P', 'C', 'A'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Game details not available yet' },
        { status: 400 }
      );
    }

    // Read game sheet, club details, and tea rota in parallel
    const [allPlayers, clubDetailsResult, teaRotaList] = await Promise.all([
      getGameSheet(game.tabName),
      game.homeAway === 'A' ? getClubDetails(game.clubName).catch(() => null) : Promise.resolve(null),
      game.homeAway === 'H' ? getTeaRotaList().catch(() => null) : Promise.resolve(null),
    ]);

    // Collect withdrawn players (status='W') and opposition players (selected='O')
    const withdrawnPlayers = allPlayers.filter(p => p.status === 'W');
    const oppositionPlayers = allPlayers.filter(p => p.selected === 'O');

    // Filter to show only selected (not withdrawn) players (Selected = Y/R/T)
    const selectedPlayers = allPlayers.filter(p =>
      ['Y', 'R', 'T'].includes(p.selected) && p.status !== 'W'
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
          name: displayName(p.fullName, p.name),
          userName: p.name,
          position: p.position,
          status: p.status,
          isCaptain: game.captain ? p.name === game.captain : p.captain === 'Y',
          driving: p.driving,
          carNumber: p.carNumber,
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
          name: displayName(p.fullName, p.name),
          userName: p.name,
          position: p.position,
          status: p.status,
        })),
      });
    }

    // Find captain of day — prefer Games sheet captain (userName), fall back to game sheet flag
    let captainOfDay = '';
    if (game.captain) {
      const captainPlayer = allPlayers.find(p => p.name === game.captain);
      captainOfDay = captainPlayer ? displayName(captainPlayer.fullName, captainPlayer.name) : game.captain;
    } else {
      const captainPlayer = allPlayers.find(p => p.captain === 'Y');
      if (captainPlayer) captainOfDay = displayName(captainPlayer.fullName, captainPlayer.name);
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

    // Resolve tea duty for home games
    let teaDuty = null;
    if (teaRotaList) {
      const teaEntry = teaRotaList.find(e => e.tabName === game.tabName);
      if (teaEntry) {
        const [leadUser, firstUser, secondUser] = await Promise.all([
          teaEntry.teaLead ? getUserByUsername(teaEntry.teaLead) : Promise.resolve(null),
          teaEntry.teaFirst ? getUserByUsername(teaEntry.teaFirst) : Promise.resolve(null),
          teaEntry.teaSecond ? getUserByUsername(teaEntry.teaSecond) : Promise.resolve(null),
        ]);
        teaDuty = {
          teaLead: teaEntry.teaLead ? { userName: teaEntry.teaLead, name: leadUser ? displayName(leadUser.fullName, teaEntry.teaLead) : teaEntry.teaLead } : null,
          teaFirst: teaEntry.teaFirst ? { userName: teaEntry.teaFirst, name: firstUser ? displayName(firstUser.fullName, teaEntry.teaFirst) : teaEntry.teaFirst } : null,
          teaSecond: teaEntry.teaSecond ? { userName: teaEntry.teaSecond, name: secondUser ? displayName(secondUser.fullName, teaEntry.teaSecond) : teaEntry.teaSecond } : null,
        };
      }
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
        userName: userName ?? '',  // Current user's userName for highlighting
        pickupInfo: game.pickupInfo || '',
        petrolCost: clubDetailsResult?.petrolCost ?? null,
        miles: clubDetailsResult?.miles || '',
        travelTime: clubDetailsResult?.travelTime || '',
      },
      teams,
      reserves: reserves.map(r => ({
        name: displayName(r.fullName, r.name),
        userName: r.name,
        team: r.team,
        position: r.position,
        status: r.status,
      })),
      reserveTeams: reserveTeamsList,
      opposition: oppositionPlayers.map(p => ({ name: displayName(p.fullName, '') })),
      withdrawn: withdrawnPlayers.map(p => ({
        name: displayName(p.fullName, p.name),
        wasSelected: p.selected === 'Y' ? 'Playing' : p.selected === 'R' ? 'Reserve' : p.selected === 'T' ? 'Reserve Team' : '',
      })),
      captainOfDay: captainOfDay,
      teaDuty,
    });
  } catch (error) {
    console.error('GET /api/friendlies/game error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game details' },
      { status: 500 }
    );
  }
}
