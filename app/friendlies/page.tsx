'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { GameWithUserStatus } from '@/lib/types/friendlies';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';

type FilterType = 'all' | 'O' | 'entered' | 'selected';

export default function FriendliesPage() {
  const { data: session } = useSession();
  const [games, setGames] = useState<GameWithUserStatus[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    fetchGames();
  }, []);

  async function fetchGames() {
    setLoading(true);
    try {
      const response = await fetch('/api/friendlies/games');
      const data = await response.json();

      if (data.games) {
        setGames(data.games);
      }
    } catch (error) {
      console.error('Error fetching games:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnterGames() {
    if (selectedGames.size === 0) return;

    setEntering(true);
    try {
      const response = await fetch('/api/friendlies/enter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_ids: Array.from(selectedGames),
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh games list
        await fetchGames();
        setSelectedGames(new Set());
      }
    } catch (error) {
      console.error('Error entering games:', error);
    } finally {
      setEntering(false);
    }
  }

  const filteredGames = games.filter(game => {
    switch (filter) {
      case 'O':
        return game.status === 'O';
      case 'entered':
        return game.userEntered;
      case 'selected':
        return game.userStatus && ['P', 'R', 'T'].includes(game.userStatus);
      default:
        return true;
    }
  });

  function getStatusBadge(status: string) {
    const badges: { [key: string]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },
      'O': { label: 'Open', color: 'bg-green-500' },
      'X': { label: 'Selecting', color: 'bg-yellow-500' },
      'S': { label: 'Selected', color: 'bg-blue-500' },
      'P': { label: 'Played', color: 'bg-purple-500' },
      'C': { label: 'Cancelled', color: 'bg-red-500' },
      'A': { label: 'Abandoned', color: 'bg-orange-500' },
    };

    const badge = badges[status] || badges[''];
    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Friendly Matches</h1>
        {session?.user.role && ['Captain', 'Admin'].includes(session.user.role) && (
          <Link
            href="/friendlies/manage"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Manage Games
          </Link>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 border-b border-gray-200">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 font-medium border-b-2 ${
            filter === 'all'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          All Games
        </button>
        <button
          onClick={() => setFilter('O')}
          className={`px-4 py-2 font-medium border-b-2 ${
            filter === 'O'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Open for Entry
        </button>
        <button
          onClick={() => setFilter('entered')}
          className={`px-4 py-2 font-medium border-b-2 ${
            filter === 'entered'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Entries
        </button>
        <button
          onClick={() => setFilter('selected')}
          className={`px-4 py-2 font-medium border-b-2 ${
            filter === 'selected'
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          I'm Selected
        </button>
      </div>

      {/* Games list */}
      {loading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading games...</p>
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600">No games found for this filter.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredGames.map(game => (
            <div
              key={game.tabName}
              className={`bg-white rounded-lg shadow border ${
                game.userEntered ? 'border-blue-200' : 'border-gray-200'
              } p-4`}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-bold text-lg">{game.clubName}</h3>
                  <p className="text-sm text-gray-600">
                    {new Date(game.date).toLocaleDateString('en-GB', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                    {' at '}
                    {game.time}
                  </p>
                </div>
                {getStatusBadge(game.status)}
              </div>

              <div className="space-y-1 text-sm mb-4">
                <p>
                  <span className="font-medium">Venue:</span> {game.homeAway === 'H' ? 'Home' : 'Away'}
                </p>
                <p>
                  <span className="font-medium">Format:</span> {game.format}
                </p>
                <p>
                  <span className="font-medium">Type:</span> {game.ladiesMen}
                </p>
                {game.status === 'O' && (
                  <p className="text-green-600">
                    <span className="font-medium">{game.entered}</span> players entered
                  </p>
                )}
              </div>

              {game.status === 'O' && !game.userEntered && (
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGames.has(game.tabDate)}
                    onChange={e => {
                      const newSelected = new Set(selectedGames);
                      if (e.target.checked) {
                        newSelected.add(game.tabDate);
                      } else {
                        newSelected.delete(game.tabDate);
                      }
                      setSelectedGames(newSelected);
                    }}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-blue-600">Select to enter</span>
                </label>
              )}

              {game.userEntered && game.status === 'O' && (
                <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm text-blue-800">
                  You are entered
                </div>
              )}

              {['S', 'P'].includes(game.status) && game.userEntered && (
                <Link
                  href={`/friendlies/game/${game.tabDate}`}
                  className="block w-full text-center bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                >
                  View Details
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Floating action button for entering selected games */}
      {selectedGames.size > 0 && (
        <div className="fixed bottom-8 right-8 z-50">
          <button
            onClick={handleEnterGames}
            disabled={entering}
            className="bg-green-600 text-white px-6 py-3 rounded-full shadow-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
          >
            {entering ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Entering...</span>
              </>
            ) : (
              <>
                <span>Enter {selectedGames.size} Game{selectedGames.size !== 1 ? 's' : ''}</span>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
