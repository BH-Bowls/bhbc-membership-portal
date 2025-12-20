'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';

interface GameDetails {
  game: {
    tabDate: string;
    date: string;
    time: string;
    clubName: string;
    homeAway: 'H' | 'A';
    format: string;
    status: string;
    userStatus: string | null;
    userTeam: number | null;
    userPosition: string | null;
    userConfirmed: boolean;
  };
  teams: Array<{
    team: number;
    players: Array<{
      name: string;
      position: string;
      status: string;
      isCaptain: boolean;
    }>;
  }>;
  reserves: Array<{
    name: string;
    team: number | null;
    position: string;
    status: string;
  }>;
  reserveTeams: Array<{
    team: number;
    players: Array<{
      name: string;
      position: string;
      status: string;
    }>;
  }>;
  captainOfDay: string;
}

export default function GameDetailsPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const tabDate = params.tabDate as string;

  const [gameDetails, setGameDetails] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchGameDetails();
  }, [tabDate]);

  async function fetchGameDetails() {
    setLoading(true);
    try {
      const response = await fetch(`/api/friendlies/game/${tabDate}`);
      const data = await response.json();

      if (response.ok) {
        setGameDetails(data);
      } else {
        console.error('Error:', data.error);
        alert(data.error || 'Failed to load game details');
        router.push('/friendlies');
      }
    } catch (error) {
      console.error('Error fetching game details:', error);
      alert('Failed to load game details');
      router.push('/friendlies');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!confirm('Confirm your participation in this game?')) return;

    setActionLoading(true);
    try {
      const response = await fetch('/api/friendlies/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_date: tabDate,
          action: 'confirm',
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert('Participation confirmed!');
        await fetchGameDetails();
      } else {
        alert(data.error || 'Failed to confirm participation');
      }
    } catch (error) {
      console.error('Error confirming:', error);
      alert('Failed to confirm participation');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWithdraw() {
    if (!confirm('Are you sure you want to withdraw from this game? The captains will be notified.')) return;

    setActionLoading(true);
    try {
      const response = await fetch('/api/friendlies/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_date: tabDate,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert('You have withdrawn from this game. Captains have been notified.');
        router.push('/friendlies');
      } else {
        alert(data.error || 'Failed to withdraw');
      }
    } catch (error) {
      console.error('Error withdrawing:', error);
      alert('Failed to withdraw');
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading game details...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gameDetails) {
    return null;
  }

  const { game, teams, reserves, reserveTeams, captainOfDay } = gameDetails;

  const getPositionLabel = (pos: string) => {
    const labels: { [key: string]: string } = {
      'S': 'Skip',
      '1': 'Lead',
      '2': 'Second',
      '3': 'Third',
    };
    return labels[pos] || pos;
  };

  const getUserStatusBadge = () => {
    if (!game.userStatus) return null;

    const badges: { [key: string]: { label: string; color: string } } = {
      'Y': { label: 'Playing', color: 'bg-green-500' },
      'R': { label: 'Reserve', color: 'bg-yellow-500' },
      'T': { label: 'Reserve Team', color: 'bg-orange-500' },
    };

    const badge = badges[game.userStatus];
    if (!badge) return null;

    return (
      <span className={`inline-block px-3 py-1 text-sm font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
        {game.userTeam && ` - Team ${game.userTeam}`}
        {game.userPosition && ` (${getPositionLabel(game.userPosition)})`}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
      <div className="mb-6">
        <Link href="/friendlies" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
          ← Back to Games
        </Link>
        <h1 className="text-3xl font-bold">{game.clubName}</h1>
        <div className="text-gray-600 mt-2">
          {new Date(game.date).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          {' at '}
          {game.time}
        </div>
        <div className="mt-2 space-y-1">
          <p>
            <span className="font-medium">Venue:</span> {game.homeAway === 'H' ? 'Home' : 'Away'}
          </p>
          <p>
            <span className="font-medium">Format:</span> {game.format}
          </p>
        </div>
      </div>

      {/* User Status */}
      {game.userStatus && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg mb-2">Your Status</h3>
              {getUserStatusBadge()}
              {game.userConfirmed && (
                <div className="mt-2 text-green-600 text-sm">
                  ✓ Participation confirmed
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {game.status === 'S' && !game.userConfirmed && ['Y', 'R', 'T'].includes(game.userStatus) && (
                <button
                  onClick={handleConfirm}
                  disabled={actionLoading}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Processing...' : 'Confirm Participation'}
                </button>
              )}
              {game.status === 'S' && (
                <button
                  onClick={handleWithdraw}
                  disabled={actionLoading}
                  className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {actionLoading ? 'Processing...' : 'Withdraw'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Captain of Day */}
      {captainOfDay && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold">Captain of the Day</h3>
          <p className="text-lg">{captainOfDay}</p>
        </div>
      )}

      {/* Teams */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
        <h2 className="text-2xl font-bold mb-4">Teams</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {teams.map(team => (
            <div key={team.team} className="border rounded-lg p-4">
              <h3 className="font-bold text-xl mb-3">Team {team.team}</h3>
              <div className="space-y-2">
                {team.players.map((player, idx) => (
                  <div
                    key={idx}
                    className={`flex justify-between items-center p-2 rounded ${
                      player.isCaptain ? 'bg-purple-100' : 'bg-gray-50'
                    }`}
                  >
                    <div>
                      <span className="font-medium">{player.name}</span>
                      {player.isCaptain && (
                        <span className="ml-2 text-xs bg-purple-600 text-white px-2 py-1 rounded">
                          Captain
                        </span>
                      )}
                    </div>
                    <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Reserves */}
      {reserves.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Reserves</h2>
          <div className="space-y-2">
            {reserves.map((reserve, idx) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-yellow-50 rounded">
                <span className="font-medium">{reserve.name}</span>
                {reserve.position && (
                  <span className="text-gray-600">{getPositionLabel(reserve.position)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reserve Teams */}
      {reserveTeams.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Reserve Teams</h2>
          <div className="grid gap-6 md:grid-cols-2">
            {reserveTeams.map(team => (
              <div key={team.team} className="border border-orange-300 rounded-lg p-4 bg-orange-50">
                <h3 className="font-bold text-xl mb-3">Reserve Team {team.team}</h3>
                <div className="space-y-2">
                  {team.players.map((player, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2 bg-white rounded">
                      <span className="font-medium">{player.name}</span>
                      <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match Card Link */}
      <div className="text-center">
        <Link
          href={`/friendlies/match-card/${tabDate}`}
          className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
        >
          View Match Card
        </Link>
      </div>
      </div>
    </div>
  );
}
