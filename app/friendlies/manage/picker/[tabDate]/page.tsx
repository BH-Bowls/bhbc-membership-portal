// app/friendlies/manage/picker/[tabDate]/page.tsx
// Printable Match Picker Sheet - A4 optimised two-column layout
// Left column: empty team boxes for handwritten team assignments
// Right column: player reference table with stats and last 6 game history

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { GameSheetPlayer } from '@/lib/types/friendlies';
import { parseUKDate } from '@/lib/date-utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface GameData {
  game: {
    tabDate: string;
    date: string;
    time: string;
    clubName: string;
    homeAway: 'H' | 'A';
    format: string;
    ladiesMen: string;
    dress: string;
    status: string;
    tabName: string;
    entered: number;
    selected: number;
    reserves: number;
  };
  players: GameSheetPlayer[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the position labels for each team box based on game format
 * Rinks/Fours: 4 positions (1, 2, 3, S)
 * Triples: 3 positions (1, 2, S)
 * Pairs: 2 positions (1, S)
 */
function getPositionLabels(format: string): string[] {
  const f = format.toLowerCase();
  if (f.includes('pair')) return ['L', 'S'];
  if (f.includes('triple')) return ['L', '2', 'S'];
  return ['L', '2', '3', 'S']; // Rinks/Fours default
}

/**
 * Parse the number of teams from the format string (e.g. "4 Triples" → 4, "6 Rinks" → 6)
 * Falls back to 4 if no number found
 */
function getTeamCount(format: string): number {
  const match = format.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

/**
 * Parse a player's last8Games array into an array of status codes (most recent first)
 * Each entry format: "GameTabName    StatusCode" (4-space separator)
 * Returns up to 6 status codes
 */
function parsePlayerHistory(last8Games?: string[]): string[] {
  if (!last8Games || last8Games.length === 0) return [];

  const statuses: string[] = [];
  // Array is newest-first (built by backward scan in getPlayerStatsFromCache).
  // Iterate forward so statuses[0] = most recent game (displayed in "Last" column).
  for (let i = 0; i < last8Games.length && statuses.length < 6; i++) {
    const entry = last8Games[i];
    const sepIdx = entry.indexOf('    ');
    if (sepIdx === -1) continue;
    statuses.push(entry.substring(sepIdx + 4).trim());
  }
  return statuses;
}

// ============================================================================
// Main Component
// ============================================================================

export default function PickerSheetPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const tabDate = params.tabDate as string;
  usePhoneBackNavigation(`/friendlies/manage/game/${tabDate}`);

  const [gameData, setGameData] = useState<GameData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchGame() {
      try {
        // No stats refresh here — display stats are snapshotted when the game is
        // closed and frozen after, so the game data below already has final figures.
        const response = await fetch(`/api/friendlies/manage/game/${tabDate}`);
        const data = await response.json();
        if (!response.ok) {
          alert(data.error || 'Failed to load game');
          router.push('/friendlies/manage');
          return;
        }
        setGameData(data);
      } catch (error) {
        console.error('Error fetching game:', error);
        alert('Failed to load game');
        router.push('/friendlies/manage');
      } finally {
        setLoading(false);
      }
    }
    fetchGame();
  }, [tabDate, router]);

  function handlePrint() {
    window.print();
  }

  // ============================================================================
  // Loading State
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-700">Loading picker sheet...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gameData) return null;

  const { game, players } = gameData;
  const isAway = game.homeAway === 'A';
  const positionLabels = getPositionLabels(game.format);
  const teamBoxCount = getTeamCount(game.format);
  const carShareBoxCount = 5;

  // Sort to match the main selection screen exactly:
  // Selected (Y) → Reserves (R) → Reserve Team (T) → Unselected → Withdrawn
  // Opposition players (O) excluded — not BHBC players being selected
  // Within selected: team number → position → surname
  // Within reserves / unselected: surname
  const selectionOrder: Record<string, number> = { Y: 0, R: 1, T: 2, '': 3 };
  const positionOrder: Record<string, number> = { S: 0, '1': 1, '2': 2, '3': 3, '': 4 };
  const activePlayers = players.filter(p => p.selected !== 'O'); // Exclude opposition
  const sortedPlayers = [...activePlayers].sort((a, b) => {
    // Withdrawn players go last
    const aWithdrawn = a.status === 'W';
    const bWithdrawn = b.status === 'W';
    if (aWithdrawn !== bWithdrawn) return aWithdrawn ? 1 : -1;

    const selA = selectionOrder[a.selected ?? ''] ?? 3;
    const selB = selectionOrder[b.selected ?? ''] ?? 3;
    if (selA !== selB) return selA - selB;

    const teamA = a.team ?? 999;
    const teamB = b.team ?? 999;
    if (teamA !== teamB) return teamA - teamB;

    const posA = positionOrder[a.position ?? ''] ?? 4;
    const posB = positionOrder[b.position ?? ''] ?? 4;
    if (posA !== posB) return posA - posB;

    const lastNameCompare = (a.lastName || a.fullName).localeCompare(b.lastName || b.fullName);
    if (lastNameCompare !== 0) return lastNameCompare;
    return a.fullName.localeCompare(b.fullName);
  });

  // Format date
  const gameDate = parseUKDate(game.date);
  const formattedDate = gameDate.toLocaleDateString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Column headers for the last 6 games (generic per-player labels)
  const historyHeaders = ['Last', 'L-1', 'L-2', 'L-3', 'L-4', 'L-5'];

  // Validation: returns which cells are invalid for a given player
  function validatePlayer(player: GameSheetPlayer) {
    const sel = player.selected;
    if (player.status === 'W' || (sel !== 'Y' && sel !== 'T' && sel !== 'R')) {
      return { teamInvalid: false, positionInvalid: false, carInvalid: false };
    }
    if (sel === 'Y' || sel === 'T') {
      return {
        teamInvalid: player.team === null || player.team === undefined,
        positionInvalid: !player.position,
        carInvalid: false,
      };
    }
    // sel === 'R': must have no team, position, or car number
    return {
      teamInvalid: player.team !== null && player.team !== undefined,
      positionInvalid: !!player.position,
      carInvalid: !!(player.carNumber && player.carNumber.trim()),
    };
  }

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <>
      {/* Print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50">
        {/* Navigation - hidden when printing */}
        <div className="no-print">
          <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        </div>

        {/* Header with back link and print button - hidden when printing */}
        <div className="no-print bg-white border-b border-gray-200 p-4">
          <div className="container mx-auto max-w-5xl flex justify-between items-center">
            <Link href={`/friendlies/manage/game/${tabDate}`} className="text-blue-600 hover:text-blue-800 mb-2 inline-block">← Back to Game</Link>
            <button
              onClick={handlePrint}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Print Picker Sheet
            </button>
          </div>
        </div>

        {/* Picker sheet content - A4 optimised */}
        <div className="container mx-auto max-w-5xl px-4 py-4">
          <div className="bg-white shadow-lg print:shadow-none">
            <div className="grid grid-cols-[1fr_2fr] text-[11px] leading-tight">
              {/* ============================================================ */}
              {/* LEFT COLUMN - Empty team boxes for handwriting */}
              {/* ============================================================ */}
              <div className="border-r border-gray-400 p-2">
                {/* Game Header Box */}
                <div className="border-2 border-gray-800 mb-2">
                  <div className="text-center p-1.5">
                    <div className="font-bold text-sm text-blue-800">
                      Burgess Hill vs {game.clubName}
                    </div>
                    <div>
                      {formattedDate}, {game.time}, {game.homeAway === 'H' ? 'Home' : 'Away'}
                    </div>
                    <div>
                      {game.format} | {game.ladiesMen} | Dress: {game.dress || 'W'}
                    </div>
                  </div>
                  <div className="border-t border-gray-800 p-1 text-center">
                    Captain:
                  </div>
                </div>

                {/* Team Boxes - number derived from maxPlayers / playersPerTeam */}
                {Array.from({ length: teamBoxCount }, (_, i) => (
                  <table
                    key={i}
                    className="w-full border-collapse border border-gray-600 mb-1.5"
                  >
                    <tbody>
                      {positionLabels.map(pos => (
                        <tr key={pos}>
                          <td className="border border-gray-600 px-1 py-[3px] w-6 text-center font-semibold bg-gray-50">
                            {pos}
                          </td>
                          <td className="border border-gray-600 px-1 py-[3px]">
                            &nbsp;
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}

                {/* Car Share boxes - away games only */}
                {isAway && (
                  <>
                    <div className="border-2 border-gray-600 mt-2 p-1 text-center font-semibold">
                      Car Sharing
                    </div>
                    <div className="mt-1">
                      {Array.from({ length: carShareBoxCount }, (_, i) => (
                        <div
                          key={i}
                          className="border border-gray-600 mb-1 h-[44px]"
                        />
                      ))}
                    </div>

                    {/* Making own way box */}
                    <div className="border-2 border-gray-600 mt-2 p-1 text-center font-semibold">
                      Making own way
                    </div>
                    <div className="border border-gray-600 border-t-0 h-[44px]" />
                  </>
                )}

                {/* Last Games Key */}
                <div className="mt-3 border border-gray-400 p-1.5">
                  <div className="font-semibold mb-1">Last Games Key</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0 text-[9px]">
                    <div><span className="font-semibold">P</span> = Picked</div>
                    <div><span className="font-semibold">R</span> = Reserve</div>
                    <div><span className="font-semibold">T</span> = Res Team</div>
                    <div><span className="font-semibold">C</span> = Cancelled</div>
                    <div><span className="font-semibold">A</span> = Abandoned</div>
                    <div className="col-span-2"><span className="font-semibold">W</span> suffix = Withdrawn (e.g. PW, RW)</div>
                  </div>
                </div>
              </div>

              {/* ============================================================ */}
              {/* RIGHT COLUMN - Player reference table */}
              {/* ============================================================ */}
              <div className="p-1">
                <table className="w-full border-collapse text-[10px] text-gray-900">
                  <thead>
                    <tr>
                      {/* Name column - horizontal header */}
                      <th className="border border-gray-400 px-0.5 py-0.5 text-left font-semibold bg-blue-50 min-w-[90px]">
                        Name
                      </th>

                      {/* Stat columns with vertical headers */}
                      {[
                        { label: 'Stats', title: 'ND/Pk(%)+FutureEntered' },
                        { label: 'D/B', title: 'Driver/Bar' },
                        { label: 'Tm', title: 'Team' },
                        { label: 'Pos', title: 'Position' },
                        ...(isAway
                          ? [
                              { label: 'Drv', title: 'Driving' },
                              { label: 'Car', title: 'Car Number' },
                            ]
                          : []),
                      ].map(col => (
                        <th
                          key={col.label}
                          className="border border-gray-400 bg-blue-50 w-[22px] h-[60px] p-0 align-bottom"
                          title={col.title}
                        >
                          <div
                            className="font-semibold"
                            style={{
                              writingMode: 'vertical-rl',
                              transform: 'rotate(180deg)',
                              whiteSpace: 'nowrap',
                              padding: '2px 1px',
                            }}
                          >
                            {col.title}
                          </div>
                        </th>
                      ))}

                      {/* Last 6 games columns - per-player history with generic headers */}
                      {historyHeaders.map((label) => (
                        <th
                          key={label}
                          className="border border-gray-400 bg-green-50 w-[22px] h-[60px] p-0 align-bottom"
                        >
                          <div
                            className="font-semibold"
                            style={{
                              writingMode: 'vertical-rl',
                              transform: 'rotate(180deg)',
                              whiteSpace: 'nowrap',
                              padding: '2px 1px',
                            }}
                          >
                            {label}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {sortedPlayers.map(player => {
                      const history = parsePlayerHistory(player.last8Games);
                      const isWithdrawn = player.status === 'W';
                      const { teamInvalid, positionInvalid, carInvalid } = validatePlayer(player);
                      const rowInvalid = teamInvalid || positionInvalid || carInvalid;
                      const invalidCell = 'bg-amber-100 border-amber-500';
                      return (
                        <tr key={player.rowNumber} className={`hover:bg-gray-50 print:hover:bg-transparent ${isWithdrawn ? 'bg-gray-100 opacity-60' : rowInvalid ? 'bg-amber-50' : ''}`}>
                          {/* Name */}
                          <td className={`border border-gray-400 px-1 py-[2px] font-medium truncate max-w-[120px] ${isWithdrawn ? 'line-through text-gray-500' : ''}`}>
                            {player.fullName}
                          </td>

                          {/* Stats: ND/Pk(%)+FutureEntered */}
                          <td className="border border-gray-400 px-0.5 py-[2px] text-center text-blue-800 font-semibold whitespace-nowrap">
                            {player.nameDown}/{player.picked}({Math.round(player.percentPlayed > 1 ? player.percentPlayed : player.percentPlayed * 100)}%)+{player.futureEntered}
                          </td>

                          {/* Driver/Bar */}
                          <td className="border border-gray-400 px-0.5 py-[2px] text-center">
                            {player.driverBar}
                          </td>

                          {/* Team */}
                          <td className={`border px-0.5 py-[2px] text-center ${teamInvalid ? invalidCell : 'border-gray-400'}`}>
                            {player.team || ''}
                          </td>

                          {/* Position */}
                          <td className={`border px-0.5 py-[2px] text-center ${positionInvalid ? invalidCell : 'border-gray-400'}`}>
                            {player.position === '1' ? 'L' : (player.position || '')}
                          </td>

                          {/* Driving + Car (away only) */}
                          {isAway && (
                            <>
                              <td className="border border-gray-400 px-0.5 py-[2px] text-center">
                                {player.driving === 'Y' ? 'Y' : ''}
                              </td>
                              <td className={`border px-0.5 py-[2px] text-center ${carInvalid ? invalidCell : 'border-gray-400'}`}>
                                {player.carNumber || ''}
                              </td>
                            </>
                          )}

                          {/* Last 6 game status columns (per-player, most recent first) */}
                          {historyHeaders.map((_, idx) => (
                            <td
                              key={idx}
                              className="border border-gray-400 px-0.5 py-[2px] text-center"
                            >
                              {history[idx] || ''}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
