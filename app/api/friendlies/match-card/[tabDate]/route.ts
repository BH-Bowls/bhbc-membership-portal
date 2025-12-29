// GET /api/friendlies/match-card/[tabDate] - Generate match card data
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  getGameSheet,
  getTeaRota,
  getClubDetails,
  getClubContacts,
} from '@/lib/friendlies-sheets';
import { MatchCardData, Team, ReservePlayer } from '@/lib/types/friendlies';

const BHBC_PLACE_ID = 'ChIJcfipELGNdUgRmS1st4mG9X0';

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
    const { searchParams } = new URL(request.url);

    // Get type parameter, default to 'main' if not provided
    let type = searchParams.get('type');
    if (!type) {
      type = 'main'; // main or reserves
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

    // Verify game status is S or P (Selected or Played)
    if (!['S', 'P'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Match card only available for Selected or Played games' },
        { status: 400 }
      );
    }

    // Get all players from game sheet
    const allPlayers = await getGameSheet(game.tabName);

    // Filter selected players
    const selectedPlayers = allPlayers.filter(p =>
      ['Y', 'R', 'T'].includes(p.selected)
    );

    // Separate into categories
    const regularPlayers = selectedPlayers.filter(p => p.selected === 'Y');
    const reserves = selectedPlayers.filter(p => p.selected === 'R');
    const reserveTeamPlayers = selectedPlayers.filter(p => p.selected === 'T');

    // Group regular players by team
    const teams: Team[] = [];

    // Get unique team numbers
    const teamNumbersSet = new Set<number>();
    for (const p of regularPlayers) {
      if (p.team !== null) {
        teamNumbersSet.add(p.team);
      }
    }
    const teamNumbers = Array.from(teamNumbersSet);
    teamNumbers.sort((a, b) => a - b);

    for (const teamNum of teamNumbers) {
      const teamPlayers = regularPlayers
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder: { [key: string]: number } = { 'S': 0, '1': 1, '2': 2, '3': 3 };

          let posA = posOrder[a.position];
          if (posA === undefined) posA = 99;

          let posB = posOrder[b.position];
          if (posB === undefined) posB = 99;

          return posA - posB;
        });

      teams.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
          driving: game.homeAway === 'A' ? p.driving : undefined,
          carNumber: game.homeAway === 'A' ? p.carNumber : undefined,
          isCaptain: p.captain === 'Y',
        })),
      });
    }

    // Group reserve team players
    const reserveTeams: Team[] = [];

    // Get unique reserve team numbers
    const reserveTeamNumbersSet = new Set<number>();
    for (const p of reserveTeamPlayers) {
      if (p.team !== null) {
        reserveTeamNumbersSet.add(p.team);
      }
    }
    const reserveTeamNumbers = Array.from(reserveTeamNumbersSet);
    reserveTeamNumbers.sort((a, b) => a - b);

    for (const teamNum of reserveTeamNumbers) {
      const teamPlayers = reserveTeamPlayers
        .filter(p => p.team === teamNum)
        .sort((a, b) => {
          const posOrder: { [key: string]: number } = { 'S': 0, '1': 1, '2': 2, '3': 3 };

          let posA = posOrder[a.position];
          if (posA === undefined) posA = 99;

          let posB = posOrder[b.position];
          if (posB === undefined) posB = 99;

          return posA - posB;
        });

      reserveTeams.push({
        team: teamNum,
        players: teamPlayers.map(p => ({
          name: p.name,
          position: p.position,
          status: p.status,
        })),
      });
    }

    // Map reserves to list
    const reservesList: ReservePlayer[] = reserves.map(r => ({
      name: r.name,
      team: r.team,
      position: r.position,
      status: r.status,
    }));

    // Find captain of day
    let captainPlayer = null;
    for (const p of allPlayers) {
      if (p.captain === 'Y') {
        captainPlayer = p;
        break;
      }
    }

    let captainName = '';
    if (captainPlayer) {
      captainName = captainPlayer.name;
    }

    // Build match card data
    const matchCardData: MatchCardData = {
      game: {
        tabDate: game.tabDate,
        date: game.date,
        time: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        ladiesMen: game.ladiesMen,
        dress: game.dress,
      },
      teams,
      reserves: reservesList,
      reserveTeams,
      captain: captainName,
    };

    // Add tea rota for HOME games
    if (game.homeAway === 'H') {
      const teaRota = await getTeaRota(game.date, game.time, game.clubName);
      if (teaRota) {
        matchCardData.teaRota = {
          lead: teaRota.lead,
          second: teaRota.second,
          third: teaRota.third,
        };
      }
    }

    // Add club details and contacts for AWAY games
    if (game.homeAway === 'A') {
      const clubDetails = await getClubDetails(game.clubName);
      const clubContacts = await getClubContacts(game.clubName);

      if (clubDetails) {
        // Build address string
        const addressParts = [];
        if (clubDetails.address1) addressParts.push(clubDetails.address1);
        if (clubDetails.address2) addressParts.push(clubDetails.address2);
        if (clubDetails.address3) addressParts.push(clubDetails.address3);
        if (clubDetails.address4) addressParts.push(clubDetails.address4);

        // Generate Google Maps directions URL
        let directionsUrl = '';
        if (clubDetails.latitude && clubDetails.longitude) {
          directionsUrl =
            `https://www.google.com/maps/dir/?api=1` +
            `&origin=Burgess+Hill+Bowls+Club` +
            `&origin_place_id=${BHBC_PLACE_ID}` +
            `&destination=${clubDetails.latitude}%2C${clubDetails.longitude}`;
        }

        matchCardData.clubDetails = {
          address: addressParts.join(', '),
          postCode: clubDetails.postCode,
          generalInfo: clubDetails.generalInfo,
          petrolCost: clubDetails.petrolCost,
          drivingBand: clubDetails.drivingBand,
          directionsUrl,
          clubNumber: clubDetails.clubNumber,
          clubMobile: clubDetails.clubMobile,
          clubEmail: clubDetails.clubEmail,
          website: clubDetails.website,
        };
      }

      if (clubContacts && clubContacts.length > 0) {
        matchCardData.clubContacts = clubContacts.map(c => ({
          name: c.name,
          role: c.role,
          phone: c.phoneNumber,
          mobile: c.mobileNumber,
          email: c.email,
        }));
      }
    }

    return NextResponse.json(matchCardData);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate match card' },
      { status: 500 }
    );
  }
}
