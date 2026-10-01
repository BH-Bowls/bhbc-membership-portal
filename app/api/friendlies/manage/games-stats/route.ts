// GET /api/friendlies/manage/games-stats?seasonId=&compareSeasonId=
// Season-level (not player-level) stats for friendlies: clubs played, new/lost
// clubs, games/seats arranged, status breakdown, W/D/L, cancellations, reserve
// games, home/away. Captain / Admin only, matching player-stats.
//
// Scope: fixture_type='Friendly' only (matches this page's existing Games/Player
// Stats scope — Test rows are always excluded, even for Admin, since they're not
// real fixtures).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getFixtures, getAllSeasons, getActiveSeasonId, type Fixture } from '@/lib/fixtures-supabase';
import { categorizeCancellationReason } from '@/lib/friendlies-utils';

interface ResultBreakdown {
  won: number;
  drawn: number;
  lost: number;
  noResult: number; // status='P' but a score wasn't recorded
}

interface CancellationReasonTally {
  weather: number;
  insufficientPlayers: number;
  other: number;
  total: number;
}

function emptyCancellationTally(): CancellationReasonTally {
  return { weather: 0, insufficientPlayers: 0, other: 0, total: 0 };
}

interface SeasonGamesStats {
  seasonId: string;
  year: number;
  clubsPlayed: number;
  clubNames: string[];
  nonClubFixtures: { count: number; descriptions: string[] };
  reserveGamesArranged: number;
  gamesArranged: number;
  seatsArranged: number;
  openUpcoming: number;
  selectingSelected: number;
  playedInFull: number;
  results: ResultBreakdown;
  abandoned: number;
  cancelled: number;
  cancelledBreakdown: Record<'burgessHill' | 'opponent' | 'unspecified', CancellationReasonTally>;
  homeAway: { home: number; away: number };
  homeAwayResults: { home: ResultBreakdown; away: ResultBreakdown };
}

function emptyResultBreakdown(): ResultBreakdown {
  return { won: 0, drawn: 0, lost: 0, noResult: 0 };
}

function tallyResult(target: ResultBreakdown, f: Fixture) {
  const hasScore = f.bhbcScore != null && f.opponentScore != null;
  if (!hasScore) { target.noResult++; return; }
  if (f.bhbcScore! > f.opponentScore!) target.won++;
  else if (f.bhbcScore! < f.opponentScore!) target.lost++;
  else target.drawn++;
}

function computeSeasonStats(seasonId: string, year: number, fixtures: Fixture[]): SeasonGamesStats {
  const isRealClub = (f: Fixture) => !!f.clubName && f.clubName.trim() !== '';
  const isNonClub = (f: Fixture) => !isRealClub(f) && !f.isReserve;

  const clubNames = Array.from(new Set(fixtures.filter(isRealClub).map((f) => f.clubName))).sort((a, b) =>
    a.localeCompare(b)
  );

  const nonClub = fixtures.filter(isNonClub);
  const nonClubDescriptions = Array.from(
    new Set(nonClub.map((f) => (f.description || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  const results = emptyResultBreakdown();
  const homeAwayResults = { home: emptyResultBreakdown(), away: emptyResultBreakdown() };
  let openUpcoming = 0;
  let selectingSelected = 0;
  let playedInFull = 0;
  let abandoned = 0;
  let cancelled = 0;
  const cancelledBreakdown = {
    burgessHill: emptyCancellationTally(),
    opponent: emptyCancellationTally(),
    unspecified: emptyCancellationTally(),
  };
  let home = 0;
  let away = 0;
  let seatsArranged = 0;

  for (const f of fixtures) {
    seatsArranged += f.selected || 0;
    if (f.homeAway === 'A') away++; else home++;

    switch (f.status) {
      case '':
      case 'O':
        openUpcoming++;
        break;
      case 'X':
      case 'S':
        selectingSelected++;
        break;
      case 'P':
        playedInFull++;
        tallyResult(results, f);
        tallyResult(f.homeAway === 'A' ? homeAwayResults.away : homeAwayResults.home, f);
        break;
      case 'A':
        abandoned++;
        break;
      case 'C': {
        cancelled++;
        const whoKey = f.who === 'Burgess Hill' ? 'burgessHill' : f.who === 'Opponent' ? 'opponent' : 'unspecified';
        const tally = cancelledBreakdown[whoKey];
        tally.total++;
        switch (categorizeCancellationReason(f.reason)) {
          case 'Weather': tally.weather++; break;
          case 'Insufficient players': tally.insufficientPlayers++; break;
          default: tally.other++; break;
        }
        break;
      }
    }
  }

  return {
    seasonId,
    year,
    clubsPlayed: clubNames.length,
    clubNames,
    nonClubFixtures: { count: nonClub.length, descriptions: nonClubDescriptions },
    reserveGamesArranged: fixtures.filter((f) => f.isReserve).length,
    gamesArranged: fixtures.length,
    seatsArranged,
    openUpcoming,
    selectingSelected,
    playedInFull,
    results,
    abandoned,
    cancelled,
    cancelledBreakdown,
    homeAway: { home, away },
    homeAwayResults,
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = new URL(request.url);
    const requestedSeasonId = url.searchParams.get('seasonId') || undefined;
    const requestedCompareSeasonId = url.searchParams.get('compareSeasonId');

    const seasons = await getAllSeasons();
    if (seasons.length === 0) {
      return NextResponse.json({ error: 'No seasons found' }, { status: 404 });
    }

    const seasonId = requestedSeasonId && seasons.some((s) => s.id === requestedSeasonId)
      ? requestedSeasonId
      : await getActiveSeasonId();
    const season = seasons.find((s) => s.id === seasonId)!;

    // Compare season: explicit param (including '' to mean "none") wins; otherwise
    // auto-pick the season one year earlier, if it exists.
    let compareSeasonId: string | null = null;
    if (requestedCompareSeasonId !== null) {
      compareSeasonId = requestedCompareSeasonId && seasons.some((s) => s.id === requestedCompareSeasonId)
        ? requestedCompareSeasonId
        : null;
    } else {
      const prior = seasons.find((s) => s.year === season.year - 1);
      compareSeasonId = prior?.id ?? null;
    }
    const compareSeason = compareSeasonId ? seasons.find((s) => s.id === compareSeasonId)! : null;

    const [seasonFixtures, compareFixtures] = await Promise.all([
      getFixtures(undefined, ['Friendly'], season.id),
      compareSeason ? getFixtures(undefined, ['Friendly'], compareSeason.id) : Promise.resolve(null),
    ]);

    const seasonStats = computeSeasonStats(season.id, season.year, seasonFixtures);
    const compareStats = compareSeason && compareFixtures
      ? computeSeasonStats(compareSeason.id, compareSeason.year, compareFixtures)
      : null;

    const newClubs = compareStats
      ? seasonStats.clubNames.filter((c) => !compareStats.clubNames.includes(c))
      : [];
    const lostClubs = compareStats
      ? compareStats.clubNames.filter((c) => !seasonStats.clubNames.includes(c))
      : [];

    return NextResponse.json({
      seasons: seasons.map((s) => ({ id: s.id, year: s.year, isActive: s.isActive })),
      season: seasonStats,
      compareSeason: compareStats,
      newClubs,
      lostClubs,
    });
  } catch (error) {
    console.error('GET /api/friendlies/manage/games-stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch games stats' }, { status: 500 });
  }
}
