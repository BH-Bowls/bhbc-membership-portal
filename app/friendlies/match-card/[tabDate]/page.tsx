// app/friendlies/match-card/[tabDate]/page.tsx
// Match Card Display Page - shows formatted match card ready for printing
// Two-column layout designed to be folded in half:
// - Left side (front): Match details, teams, reserves
// - Right side (back): Opposition details, contacts, car sharing

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { MatchCardData, Team } from '@/lib/types/friendlies';
import Link from 'next/link';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { parseUKDate } from '@/lib/date-utils';

// ============================================================================
// Types
// ============================================================================

interface CarGroup {
  carNumber: string;
  driver: string;
  passengers: string[];
}

// ============================================================================
// Main Component
// ============================================================================

export default function MatchCardPage() {
  const { data: session } = useSession();
  const params = useParams();
  const tabDate = params.tabDate as string;
  const role = session?.user?.role ?? '';
  const isManageRole = ['Captain', 'Admin'].some(r => role.split(',').map(s => s.trim()).includes(r));
  usePhoneBackNavigation(isManageRole ? `/friendlies/manage/game/${tabDate}` : `/friendlies/game/${tabDate}`);

  const [matchCard, setMatchCard] = useState<MatchCardData | null>(null);
  const [loading, setLoading] = useState(true);

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    fetchMatchCard();
  }, [tabDate]);

  // ============================================================================
  // API Functions
  // ============================================================================

  async function fetchMatchCard() {
    setLoading(true);
    try {
      const response = await fetch(`/api/friendlies/match-card/${tabDate}`);
      const data = await response.json();
      if (response.ok) {
        setMatchCard(data);
      } else {
        alert(data.error || 'Failed to load match card');
      }
    } catch (error) {
      console.error('Error fetching match card:', error);
      alert('Failed to load match card');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  function handlePrint() {
    window.print();
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  // Build car groups from all players
  const buildCarGroups = (teams: Team[]): { carGroups: CarGroup[]; ownTransport: string[] } => {
    const carMap = new Map<string, { driver: string; passengers: string[] }>();
    const ownTransport: string[] = [];
    const allPlayers: { name: string; driving?: string; carNumber?: string }[] = [];

    // Collect all players from all teams
    teams.forEach(team => {
      team.players.forEach(p => {
        allPlayers.push(p);
      });
    });

    // Group by car number
    allPlayers.forEach(p => {
      if (p.carNumber && p.carNumber.toUpperCase() === 'O') {
        // 'O' means own transport
        ownTransport.push(p.name);
      } else if (p.driving === 'Y' && p.carNumber) {
        // This player is a driver
        if (!carMap.has(p.carNumber)) {
          carMap.set(p.carNumber, { driver: p.name, passengers: [] });
        } else {
          // Already have passengers for this car, set driver
          const car = carMap.get(p.carNumber)!;
          car.driver = p.name;
        }
      } else if (p.carNumber) {
        // This player is a passenger
        if (!carMap.has(p.carNumber)) {
          carMap.set(p.carNumber, { driver: '', passengers: [p.name] });
        } else {
          carMap.get(p.carNumber)!.passengers.push(p.name);
        }
      } else if (p.driving === 'Y') {
        // Driver with no car number - own transport
        ownTransport.push(p.name);
      }
    });

    // Convert map to array and sort by car number
    const carGroups: CarGroup[] = [];
    carMap.forEach((value, carNumber) => {
      // If car has driver but no passengers, they're own transport
      if (value.driver && value.passengers.length === 0) {
        ownTransport.push(value.driver);
      } else {
        carGroups.push({
          carNumber,
          driver: value.driver,
          passengers: value.passengers,
        });
      }
    });

    carGroups.sort((a, b) => a.carNumber.localeCompare(b.carNumber));

    return { carGroups, ownTransport };
  };

  // Format car group as string: "Passenger1, Driver(Driver), Passenger2"
  const formatCarGroup = (group: CarGroup): string => {
    const parts: string[] = [];

    // Add passengers before driver
    group.passengers.forEach(p => {
      if (p !== group.driver) {
        parts.push(p);
      }
    });

    // Insert driver with (Driver) label
    if (group.driver) {
      // Find a good position to insert driver (after first passenger if any)
      if (parts.length > 0) {
        parts.splice(1, 0, `${group.driver}(Driver)`);
      } else {
        parts.push(`${group.driver}(Driver)`);
      }
    }

    return parts.join(', ');
  };

  // ============================================================================
  // Loading State
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-700">Loading match card...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!matchCard) return null;

  // ============================================================================
  // Extract Match Card Data
  // ============================================================================

  const { game, teams, reserves, reserveTeams, captain, teaRota, clubDetails, clubContacts } = matchCard;

  // Count rinks
  const rinkCount = teams.length;

  // Build car groups for away games
  const { carGroups, ownTransport } = game.homeAway === 'A' ? buildCarGroups(teams) : { carGroups: [], ownTransport: [] };

  // Format date
  const gameDate = parseUKDate(game.date);
  const formattedDate = gameDate.toLocaleDateString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <>
      {/* Print-specific styles */}
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
          .print-page {
            page-break-after: always;
          }
          .print-page:last-child {
            page-break-after: avoid;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50">
        {/* Navigation bar - hidden when printing */}
        <div className="no-print">
          <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        </div>

        {/* Header with back link and print button - hidden when printing */}
        <div className="no-print bg-white border-b border-gray-200 p-4">
          <div className="container mx-auto max-w-4xl flex justify-between items-center">
            <Link
              href={['Captain', 'Admin'].some(r => session?.user?.role?.split(',').includes(r))
                ? `/friendlies/manage/game/${tabDate}`
                : `/friendlies/game/${tabDate}`}
              className="text-blue-600 hover:text-blue-800 mb-2 inline-block"
            >← Back to Game</Link>
            <button
              onClick={handlePrint}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Print Match Card
            </button>
          </div>
        </div>

        {/* Match card content */}
        <div className="container mx-auto max-w-4xl px-4 py-4">
          {/* ============================================================ */}
          {/* MAIN MATCH CARD - Page 1 */}
          {/* ============================================================ */}
          <div className="print-page bg-white shadow-lg text-gray-900">
            <div className="grid grid-cols-2 min-h-[calc(100vh-200px)] print:min-h-0">
              {/* ======================================================== */}
              {/* LEFT COLUMN - Teams (Front when folded) */}
              {/* ======================================================== */}
              <div className="border-r border-gray-300 p-4">
                {/* Match Header */}
                <div className="border-2 border-gray-400 mb-2">
                  <div className="text-center p-2">
                    <h1 className="text-lg font-bold text-red-600">
                      Burgess Hill vs {game.clubName}
                    </h1>
                    <p className="text-sm">
                      {formattedDate}, {game.time}, {game.homeAway === 'H' ? 'Home' : 'Away'}
                    </p>
                    <p className="text-sm">
                      {game.format} | {game.ladiesMen} | Dress : {game.dress || 'W'}
                    </p>
                  </div>
                  <div className="border-t border-gray-400 p-2 text-center">
                    <p className="text-sm">Captain : {captain || 'TBC'}</p>
                  </div>
                </div>

                {/* Teams Grid */}
                <div className="space-y-1">
                  {teams.map(team => (
                    <table key={team.team} className="w-full border-collapse border-2 border-gray-500 text-sm">
                      <tbody>
                        {team.players
                          .sort((a, b) => {
                            const order: { [key: string]: number } = { '1': 0, '2': 1, '3': 2, 'S': 3 };
                            return (order[a.position] ?? 99) - (order[b.position] ?? 99);
                          })
                          .map((player, idx) => (
                            <tr key={idx} className={player.isCaptain ? 'bg-purple-100' : ''}>
                              <td className="border border-gray-400 px-1 py-px w-6 text-center text-xs">
                                {player.position === '1' ? 'L' : (player.position || '-')}
                              </td>
                              <td className="border border-gray-400 px-2 py-px">
                                {player.name}
                                {player.isCaptain && ' ★'}
                              </td>
                              <td className="border border-gray-400 px-1 py-px w-6 text-center text-xs">
                                {player.status === 'Y' ? 'Y' : ''}
                              </td>
                              <td className="border border-gray-400 w-10" title="Initials" />
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  ))}
                </div>

                {/* PTO notice for away games */}
                {game.homeAway === 'A' && (
                  <p className="text-center text-sm font-bold mt-4">
                    *** PTO FOR CAR SHARE DETAILS ***
                  </p>
                )}

                {/* Reserves Section - two columns */}
                {reserves.length > 0 && (
                  <div className="mt-2 border-2 border-gray-400">
                    <p className="text-sm font-bold text-center border-b border-gray-400 py-1">
                      Reserves
                    </p>
                    <div className="grid grid-cols-2 gap-x-1 p-1">
                      {[
                        reserves.filter((_, i) => i < Math.ceil(reserves.length / 2)),
                        reserves.filter((_, i) => i >= Math.ceil(reserves.length / 2)),
                      ].map((col, colIdx) => (
                        <table key={colIdx} className="w-full border-collapse border border-gray-400 text-sm">
                          <tbody>
                            {col.map((reserve, idx) => (
                              <tr key={idx}>
                                <td className="border border-gray-400 px-2 py-px">{reserve.name}</td>
                                <td className="border border-gray-400 px-1 py-px w-6 text-center text-xs">
                                  {reserve.status === 'Y' ? 'Y' : ''}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ))}
                    </div>
                  </div>
                )}

              </div>

              {/* ======================================================== */}
              {/* RIGHT COLUMN - Details (Back when folded) */}
              {/* ======================================================== */}
              <div className="p-4">
                {/* Opposition Club Details Box */}
                {clubDetails && (
                  <div className="border-2 border-gray-400 mb-4">
                    <div className="border-b border-gray-400 p-2">
                      <p className="text-sm font-bold">{game.clubName}</p>
                    </div>
                    <div className="border-b border-gray-400 p-2">
                      <p className="text-sm">
                        {clubDetails.address}
                        {clubDetails.postCode && `, ${clubDetails.postCode}`}
                      </p>
                    </div>
                    <div className="p-2 text-sm">
                      {clubDetails.clubNumber && (
                        <p>Club Number: {clubDetails.clubNumber}</p>
                      )}
                      {clubDetails.clubMobile && (
                        <p>Club Mobile: {clubDetails.clubMobile}</p>
                      )}
                      {clubDetails.clubEmail && (
                        <p>Club Email: {clubDetails.clubEmail}</p>
                      )}
                    </div>
                  </div>
                )}

                {/* Club Contacts */}
                {clubContacts && clubContacts.length > 0 && (
                  <div className="border-2 border-gray-400 mb-4">
                    <div className="border-b border-gray-400 p-2">
                      <p className="font-bold text-sm">{game.clubName} Contact Details</p>
                    </div>
                    <div className="p-2 text-sm space-y-1">
                      {clubContacts.map((contact, idx) => (
                        <p key={idx}>
                          {contact.role}, {contact.name}
                          {contact.mobile && `, ${contact.mobile}`}
                          {contact.phone && `, ${contact.phone}`}
                          {contact.email && (
                            <>
                              , <span className="break-all">{contact.email}</span>
                            </>
                          )}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Car Sharing Section (away games only) */}
                {game.homeAway === 'A' && (carGroups.length > 0 || ownTransport.length > 0) && (
                  <div className="border-2 border-gray-400 mb-4">
                    <div className="border-b border-gray-400 p-2">
                      <p className="font-bold text-sm">
                        Car Sharing - Petrol : £{clubDetails?.petrolCost?.toFixed(2) || '0.00'}
                      </p>
                    </div>

                    {/* Car Groups */}
                    <div className="text-sm">
                      {carGroups.map((group, idx) => (
                        <div key={idx} className={`p-2 ${idx < carGroups.length - 1 || ownTransport.length > 0 ? 'border-b border-gray-300' : ''}`}>
                          <p>
                            {group.passengers
                              .filter(p => p !== group.driver)
                              .slice(0, 1)
                              .join(', ')}
                            {group.passengers.filter(p => p !== group.driver).length > 0 && ', '}
                            {group.driver && `${group.driver}(Driver)`}
                            {group.passengers
                              .filter(p => p !== group.driver)
                              .slice(1)
                              .map(p => `, ${p}`)
                              .join('')}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Own Transport */}
                    {ownTransport.length > 0 && (
                      <div className="p-2">
                        <p className="font-bold text-sm text-center mb-1">Own Transport</p>
                        <p className="text-sm">{ownTransport.join(', ')}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* General Information */}
                {clubDetails?.generalInfo && (
                  <div className="border-2 border-gray-400 mb-4">
                    <div className="border-b border-gray-400 p-2">
                      <p className="font-bold text-sm">General Information</p>
                    </div>
                    <div className="p-2">
                      <p className="text-sm whitespace-pre-line">{clubDetails.generalInfo}</p>
                    </div>
                  </div>
                )}

                {/* Tea Rota for home games */}
                {game.homeAway === 'H' && teaRota && (
                  <div className="border-2 border-green-400 bg-green-50 p-3 mb-4">
                    <p className="font-bold text-sm mb-1">Tea Duty</p>
                    <p className="text-sm">Lead: {teaRota.lead}</p>
                    <p className="text-sm">Second: {teaRota.second}</p>
                    {teaRota.third && <p className="text-sm">Third: {teaRota.third}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ============================================================ */}
          {/* RESERVE TEAMS - Page 2 (if any) */}
          {/* ============================================================ */}
          {reserveTeams.length > 0 && (
            <div className="print-page bg-white shadow-lg mt-8 print:mt-0 text-gray-900">
              <div className="grid grid-cols-2 min-h-[calc(100vh-200px)] print:min-h-0">
                {/* LEFT COLUMN - Reserve Teams */}
                <div className="border-r border-gray-300 p-4">
                  <h2 className="text-lg font-bold text-center mb-4 border-b-2 border-gray-400 pb-2 text-gray-900">
                    Reserve Teams
                  </h2>

                  <div className="space-y-2">
                    {reserveTeams.map(team => (
                      <div key={team.team}>
                        <p className="text-sm font-bold mb-1">Reserve Team {team.team}</p>
                        <table className="w-full border-collapse border border-gray-400 text-sm">
                          <tbody>
                            {team.players
                              .sort((a, b) => {
                                const order: { [key: string]: number } = { '1': 0, '2': 1, '3': 2, 'S': 3 };
                                return (order[a.position] ?? 99) - (order[b.position] ?? 99);
                              })
                              .map((player, idx) => (
                                <tr key={idx}>
                                  <td className="border border-gray-400 px-2 py-1 w-8 text-center">
                                    {player.position === '1' ? 'L' : (player.position || '-')}
                                  </td>
                                  <td className="border border-gray-400 px-2 py-1">
                                    {player.name}
                                  </td>
                                  <td className="border border-gray-400 px-2 py-1 w-8 text-center">
                                    {player.status === 'Y' ? 'Y' : ''}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </div>

                {/* RIGHT COLUMN - Empty for reserve teams page */}
                <div className="p-4">
                  {/* Intentionally empty - nothing to print on back of reserve teams sheet */}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
