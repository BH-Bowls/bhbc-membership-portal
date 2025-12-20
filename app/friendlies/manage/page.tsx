'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Game, GameStatus } from '@/lib/types/friendlies';

export default function ManageGamesPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [games, setGames] = useState<Game[]>([]);
  const [filter, setFilter] = useState<'all' | GameStatus>('all');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchGames();
  }, []);

  async function fetchGames() {
    setLoading(true);
    try {
      const response = await fetch('/api/friendlies/manage/games');
      const data = await response.json();

      if (response.ok) {
        setGames(data.games);
      } else {
        alert(data.error || 'Failed to load games');
      }
    } catch (error) {
      console.error('Error fetching games:', error);
      alert('Failed to load games');
    } finally {
      setLoading(false);
    }
  }

  async function changeStatus(tabDate: string, action: string, additionalData?: any) {
    setActionLoading(tabDate);
    try {
      const response = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_date: tabDate,
          action,
          ...additionalData,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Game status updated to ${data.new_status}`);
        await fetchGames();
      } else {
        alert(data.error || 'Failed to update status');
      }
    } catch (error) {
      console.error('Error changing status:', error);
      alert('Failed to update status');
    } finally {
      setActionLoading(null);
    }
  }

  function handleOpenGame(tabDate: string) {
    if (!confirm('Open this game for player entry?')) return;
    changeStatus(tabDate, 'open');
  }

  function handleCloseGame(tabDate: string) {
    if (!confirm('Close this game and create team selection sheet?')) return;
    changeStatus(tabDate, 'close');
  }

  function handlePublishSelection(tabDate: string) {
    if (!confirm('Publish team selection to players?')) return;
    changeStatus(tabDate, 'publish');
  }

  function handleMarkPlayed(tabDate: string) {
    const bhbcScore = prompt('Enter BHBC score:');
    const opponentScore = prompt('Enter opponent score:');

    if (bhbcScore === null || opponentScore === null) return;

    changeStatus(tabDate, 'played', {
      bhbc_score: parseInt(bhbcScore),
      opponent_score: parseInt(opponentScore),
    });
  }

  function handleCancelGame(tabDate: string) {
    const reason = prompt('Enter cancellation reason:');
    const who = prompt('Who cancelled? (Us/Them):');

    if (!reason || !who) return;

    changeStatus(tabDate, 'cancel', { reason, who });
  }

  const filteredGames = games.filter(game => {
    if (filter === 'all') return true;
    return game.status === filter;
  });

  const getStatusBadge = (status: GameStatus) => {
    const badges: { [key in GameStatus]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },
      'O': { label: 'Open', color: 'bg-green-500' },
      'X': { label: 'Selecting', color: 'bg-yellow-500' },
      'S': { label: 'Selected', color: 'bg-blue-500' },
      'P': { label: 'Played', color: 'bg-purple-500' },
      'C': { label: 'Cancelled', color: 'bg-red-500' },
      'A': { label: 'Abandoned', color: 'bg-orange-500' },
    };

    const badge = badges[status] || { label: status || 'Unknown', color: 'bg-gray-500' };
    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Manage Friendly Matches</h1>
        <Link
          href="/friendlies"
          className="text-blue-600 hover:text-blue-800"
        >
          Player View →
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
        {(['all', '', 'O', 'X', 'S', 'P', 'C', 'A'] as const).map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 font-medium border-b-2 whitespace-nowrap ${
              filter === status
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {status === 'all' ? 'All' : status === '' ? 'Upcoming' : status}
          </button>
        ))}
      </div>

      {/* Games table */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading games...</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date/Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Club
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Details
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Players
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredGames.map(game => (
                <tr key={game.tabName} className={actionLoading === game.tabDate ? 'opacity-50' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div>{new Date(game.date).toLocaleDateString('en-GB')}</div>
                    <div className="text-gray-500">{game.time}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    {game.clubName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div>{game.homeAway === 'H' ? 'Home' : 'Away'}</div>
                    <div className="text-gray-500">{game.format}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(game.status)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <div>Entered: {game.entered}</div>
                    <div className="text-gray-500">Selected: {game.selected}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    {game.status === '' && (
                      <button
                        onClick={() => handleOpenGame(game.tabDate)}
                        disabled={actionLoading === game.tabDate}
                        className="text-green-600 hover:text-green-800 font-medium disabled:opacity-50"
                      >
                        Open
                      </button>
                    )}
                    {game.status === 'O' && (
                      <button
                        onClick={() => handleCloseGame(game.tabDate)}
                        disabled={actionLoading === game.tabDate}
                        className="text-yellow-600 hover:text-yellow-800 font-medium disabled:opacity-50"
                      >
                        Close
                      </button>
                    )}
                    {game.status === 'X' && (
                      <>
                        <Link
                          href={`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Select Team
                        </Link>
                        <button
                          onClick={() => handlePublishSelection(game.tabDate)}
                          disabled={actionLoading === game.tabDate}
                          className="text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                        >
                          Publish
                        </button>
                      </>
                    )}
                    {game.status === 'S' && (
                      <>
                        <Link
                          href={`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleMarkPlayed(game.tabDate)}
                          disabled={actionLoading === game.tabDate}
                          className="text-purple-600 hover:text-purple-800 font-medium disabled:opacity-50"
                        >
                          Mark Played
                        </button>
                      </>
                    )}
                    {!['C', 'P', 'A'].includes(game.status) && (
                      <button
                        onClick={() => handleCancelGame(game.tabDate)}
                        disabled={actionLoading === game.tabDate}
                        className="text-red-600 hover:text-red-800 font-medium disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
