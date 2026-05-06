// GET /api/friendlies/match-card/[tabDate] - Generate match card data
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getGames,
  getGameSheet,
  getTeaRotaList,
  getClubDetails,
  getClubContacts,
  getMembersSpreadsheetId,
  getColumnMap,
  getSheetsClient,
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

    // Verify game status allows match card (X, S, P, C, A)
    if (!['X', 'S', 'P', 'C', 'A'].includes(game.status)) {
      return NextResponse.json(
        { error: 'Match card only available for Selecting, Selected, Played, Cancelled, or Abandoned games' },
        { status: 400 }
      );
    }

    console.log('[match-card] Game found:', { tabName: game.tabName, status: game.status, homeAway: game.homeAway });

    // Get all players from game sheet
    let allPlayers;
    try {
      allPlayers = await getGameSheet(game.tabName);
      console.log('[match-card] Got players from game sheet:', allPlayers.length);
    } catch (err) {
      console.error('[match-card] Error getting game sheet:', err);
      throw err;
    }

    // Collect withdrawn players (status='W') — these were selected but later withdrew
    const withdrawnPlayers = allPlayers.filter(p => p.status === 'W');

    // Collect opposition players (selected='O')
    const oppositionPlayers = allPlayers.filter(p => p.selected === 'O');

    // Filter selected (and not withdrawn) players
    const selectedPlayers = allPlayers.filter(p =>
      ['Y', 'R', 'T'].includes(p.selected) && p.status !== 'W'
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
          name: p.fullName,  // Use fullName for display
          position: p.position,
          status: p.status,
          driving: game.homeAway === 'A' ? p.driving : undefined,
          carNumber: game.homeAway === 'A' ? p.carNumber : undefined,
          isCaptain: game.captain ? p.name === game.captain : p.captain === 'Y',
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
          name: p.fullName,  // Use fullName for display
          position: p.position,
          status: p.status,
        })),
      });
    }

    // Map reserves to list
    const reservesList: ReservePlayer[] = reserves.map(r => ({
      name: r.fullName,  // Use fullName for display
      team: r.team,
      position: r.position,
      status: r.status,
    }));

    // Find captain of day — prefer Games sheet captain (userName), fall back to game sheet flag
    let captainName = '';
    if (game.captain) {
      // New: captain stored as userName on Games sheet
      const captainPlayer = allPlayers.find(p => p.name === game.captain);
      captainName = captainPlayer ? captainPlayer.fullName : game.captain;
    } else {
      // Legacy: captain marked with 'Y' on individual game sheet row
      const captainPlayer = allPlayers.find(p => p.captain === 'Y');
      if (captainPlayer) captainName = captainPlayer.fullName;
    }

    // Build opposition list
    const oppositionList = oppositionPlayers.map(p => ({ name: p.fullName }));

    // Build withdrawn list (show their name and what they were selected as)
    const withdrawnList = withdrawnPlayers.map(p => ({
      name: p.fullName,
      wasSelected: p.selected === 'Y' ? 'Playing' : p.selected === 'R' ? 'Reserve' : p.selected === 'T' ? 'Reserve Team' : '',
    }));

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
        pickupInfo: game.pickupInfo || '',
      },
      teams,
      reserves: reservesList,
      reserveTeams,
      opposition: oppositionList,
      withdrawn: withdrawnList,
      captain: captainName,
    };

    // Add tea rota for HOME games (read from Games sheet columns)
    if (game.homeAway === 'H') {
      try {
        console.log('[match-card] Fetching tea rota for HOME game:', { tabName: game.tabName });
        const teaRotaList = await getTeaRotaList();
        const teaRotaEntry = teaRotaList.find(t => t.tabName === game.tabName);
        if (teaRotaEntry && (teaRotaEntry.teaLead || teaRotaEntry.teaFirst || teaRotaEntry.teaSecond)) {
          // Build full name lookup from Members sheet
          const membersSpreadsheetId = getMembersSpreadsheetId();
          const membersColMap = await getColumnMap(membersSpreadsheetId, 'Members');
          const sheets = getSheetsClient();
          const membersResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: membersSpreadsheetId,
            range: 'Members!A:ZZ',
          });
          const membersRows = membersResponse.data.values || [];

          // Build userName -> fullName lookup
          const fullNameLookup: Record<string, string> = {};
          const memberUserNameCol = membersColMap['user_name'];
          const memberFullNameCol = membersColMap['full_name'] ?? membersColMap['full_known_as'] ?? membersColMap['name'];
          if (memberUserNameCol !== undefined && memberFullNameCol !== undefined) {
            for (let j = 1; j < membersRows.length; j++) {
              const memberRow = membersRows[j];
              const memberUserName = memberRow[memberUserNameCol];
              const memberFullName = memberRow[memberFullNameCol];
              if (memberUserName) {
                fullNameLookup[memberUserName.toLowerCase()] = memberFullName || memberUserName;
              }
            }
          }

          // Helper to get full name from username
          const getFullName = (userName: string): string => {
            if (!userName) return '';
            return fullNameLookup[userName.toLowerCase()] || userName;
          };

          matchCardData.teaRota = {
            lead: getFullName(teaRotaEntry.teaLead),
            second: getFullName(teaRotaEntry.teaFirst),
            third: getFullName(teaRotaEntry.teaSecond),
          };
        }
        console.log('[match-card] Tea rota result:', teaRotaEntry ? 'found' : 'not found');
      } catch (err) {
        // Tea rota is optional - log warning but continue without it
        console.warn('[match-card] Could not fetch tea rota:', err instanceof Error ? err.message : err);
      }
    }

    // Add club details and contacts for all games (optional - don't fail if not available)
    {
      console.log('[match-card] Fetching club details:', { clubName: game.clubName, homeAway: game.homeAway });
      let clubDetails;
      let clubContacts;
      try {
        clubDetails = await getClubDetails(game.clubName);
        console.log('[match-card] Club details result:', clubDetails ? 'found' : 'not found');
      } catch (err) {
        // Club details are optional - log warning but continue without them
        console.warn('[match-card] Could not fetch club details:', err instanceof Error ? err.message : err);
      }
      try {
        clubContacts = await getClubContacts(game.clubName);
        console.log('[match-card] Club contacts result:', clubContacts?.length || 0);
      } catch (err) {
        // Club contacts are optional - log warning but continue without them
        console.warn('[match-card] Could not fetch club contacts:', err instanceof Error ? err.message : err);
      }

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
          miles: clubDetails.miles,
          travelTime: clubDetails.travelTime,
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
    console.error('[match-card] Error generating match card:', error);
    return NextResponse.json(
      { error: 'Failed to generate match card' },
      { status: 500 }
    );
  }
}
