'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { MatchCardData } from '@/lib/types/friendlies';

export default function MatchCardPage() {
  const { data: session } = useSession();
  const params = useParams();
  const tabDate = params.tabDate as string;

  const [matchCard, setMatchCard] = useState<MatchCardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMatchCard();
  }, [tabDate]);

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

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading match card...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!matchCard) return null;

  const { game, teams, reserves, reserveTeams, captain, teaRota, clubDetails, clubContacts } = matchCard;

  const getPositionLabel = (pos: string) => {
    const labels: { [key: string]: string } = {
      'S': 'Skip',
      '1': 'Lead',
      '2': 'Second',
      '3': 'Third',
    };
    return labels[pos] || pos;
  };

  return (
    <>
      <style jsx global>{`
        @media print {
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .page-break {
            page-break-after: always;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50">
        {/* Navigation - hidden when printing */}
        <div className="no-print">
          <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        </div>

        {/* No-print header */}
        <div className="no-print bg-white border-b border-gray-200 p-4">
          <div className="container mx-auto max-w-4xl flex justify-between items-center">
            <Link href={`/friendlies/game/${tabDate}`} className="text-blue-600 hover:text-blue-800">
              ← Back to Game
            </Link>
            <button
              onClick={handlePrint}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Print Match Card
            </button>
          </div>
        </div>

        {/* Match card content */}
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <div className="bg-white rounded-lg shadow-lg p-8">
            {/* Header */}
            <div className="text-center border-b-2 border-gray-300 pb-4 mb-6">
              <h1 className="text-3xl font-bold text-gray-900">BURGESS HILL BOWLS CLUB</h1>
              <h2 className="text-2xl font-semibold mt-2 text-blue-600">{game.clubName}</h2>
              <div className="mt-3 text-lg">
                <p>
                  {new Date(game.date).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
                <p className="font-semibold">
                  {game.time} - {game.homeAway === 'H' ? 'HOME' : 'AWAY'} - {game.format} - {game.ladiesMen}
                </p>
                {game.dress && <p className="text-sm text-gray-600">Dress: {game.dress}</p>}
              </div>
            </div>

            {/* Captain of the Day */}
            {captain && (
              <div className="bg-purple-100 border-2 border-purple-600 rounded-lg p-4 mb-6 text-center">
                <p className="text-lg">
                  <strong>Captain of the Day:</strong> <span className="text-xl font-bold">{captain}</span>
                </p>
              </div>
            )}

            {/* Teams */}
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-4 text-gray-800">TEAMS</h3>
              <div className="grid grid-cols-2 gap-4">
                {teams.map(team => (
                  <div key={team.team} className="border-2 border-gray-300 rounded-lg p-4">
                    <h4 className="font-bold text-lg mb-3 text-center bg-gray-100 py-2 rounded">
                      Team {team.team}
                    </h4>
                    <div className="space-y-2">
                      {team.players.map((player, idx) => (
                        <div
                          key={idx}
                          className={`flex justify-between p-2 rounded ${
                            player.isCaptain ? 'bg-purple-100 font-bold' : 'bg-gray-50'
                          }`}
                        >
                          <span>
                            {player.name}
                            {player.isCaptain && ' ★'}
                          </span>
                          <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                        </div>
                      ))}
                    </div>
                    {game.homeAway === 'A' && team.players.some(p => p.driving) && (
                      <div className="mt-3 pt-2 border-t border-gray-300 text-sm">
                        <strong>Drivers:</strong>{' '}
                        {team.players
                          .filter(p => p.driving === 'Y')
                          .map(p => `${p.name}${p.carNumber ? ` (Car ${p.carNumber})` : ''}`)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Reserves */}
            {reserves.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xl font-bold mb-3 text-gray-800">RESERVES</h3>
                <div className="border-2 border-yellow-400 bg-yellow-50 rounded-lg p-4">
                  <div className="space-y-2">
                    {reserves.map((reserve, idx) => (
                      <div key={idx} className="flex justify-between p-2 bg-white rounded">
                        <span className="font-medium">{reserve.name}</span>
                        {reserve.position && (
                          <span className="text-gray-600">{getPositionLabel(reserve.position)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tea Rota (Home games only) */}
            {game.homeAway === 'H' && teaRota && (
              <div className="mb-6 border-2 border-green-400 bg-green-50 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3 text-gray-800">TEA DUTY</h3>
                <div className="space-y-1">
                  <p><strong>Lead:</strong> {teaRota.lead}</p>
                  <p><strong>Second:</strong> {teaRota.second}</p>
                  {teaRota.third && <p><strong>Third:</strong> {teaRota.third}</p>}
                </div>
              </div>
            )}

            {/* Venue Details (Away games only) */}
            {game.homeAway === 'A' && clubDetails && (
              <div className="mb-6 border-2 border-blue-400 bg-blue-50 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3 text-gray-800">VENUE</h3>
                <div className="space-y-2">
                  <div>
                    <p className="font-semibold">{clubDetails.address}</p>
                    <p className="text-lg font-bold">{clubDetails.postCode}</p>
                  </div>
                  {clubDetails.directionsUrl && (
                    <p>
                      <a
                        href={clubDetails.directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        📍 Get Directions from BHBC
                      </a>
                    </p>
                  )}
                  {clubDetails.generalInfo && (
                    <p className="text-sm">
                      <strong>Info:</strong> {clubDetails.generalInfo}
                    </p>
                  )}
                  {clubDetails.petrolCost > 0 && (
                    <p className="text-lg font-semibold text-green-700">
                      Petrol Cost: £{clubDetails.petrolCost.toFixed(2)} per person (Band {clubDetails.drivingBand})
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Club Contacts (Away games only) */}
            {game.homeAway === 'A' && clubContacts && clubContacts.length > 0 && (
              <div className="mb-6 border-2 border-indigo-400 bg-indigo-50 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3 text-gray-800">CONTACTS</h3>
                <div className="space-y-3">
                  {clubContacts.map((contact, idx) => (
                    <div key={idx} className="bg-white p-3 rounded">
                      <p className="font-bold">
                        {contact.name}
                        {contact.role && <span className="text-sm font-normal text-gray-600"> ({contact.role})</span>}
                      </p>
                      {contact.mobile && (
                        <p className="text-sm">
                          Mobile: <a href={`tel:${contact.mobile.replace(/\s/g, '')}`} className="text-blue-600">{contact.mobile}</a>
                        </p>
                      )}
                      {contact.phone && (
                        <p className="text-sm">
                          Phone: <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="text-blue-600">{contact.phone}</a>
                        </p>
                      )}
                      {contact.email && (
                        <p className="text-sm">
                          Email: <a href={`mailto:${contact.email}`} className="text-blue-600">{contact.email}</a>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reserve Teams */}
            {reserveTeams.length > 0 && (
              <div className="page-break">
                <div className="mt-8 pt-8 border-t-4 border-gray-300">
                  <h3 className="text-xl font-bold mb-4 text-gray-800">RESERVE TEAMS</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {reserveTeams.map(team => (
                      <div key={team.team} className="border-2 border-orange-400 bg-orange-50 rounded-lg p-4">
                        <h4 className="font-bold text-lg mb-3 text-center bg-orange-200 py-2 rounded">
                          Reserve Team {team.team}
                        </h4>
                        <div className="space-y-2">
                          {team.players.map((player, idx) => (
                            <div key={idx} className="flex justify-between p-2 bg-white rounded">
                              <span>{player.name}</span>
                              <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
