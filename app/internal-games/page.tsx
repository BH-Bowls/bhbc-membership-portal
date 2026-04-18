// app/internal-games/page.tsx
// Main Internal Games page - displays list of internal games with entry functionality

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';
import { calculateCapacity, formatCapacity, getCapacityBadgeColor } from '@/lib/game-management/capacity';
import type { InternalGame } from '@/lib/game-management/types';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';
import { parseUKDate } from '@/lib/date-utils';
import { hasRole } from '@/lib/role-utils';

// Extended type to include user entry status from API
interface InternalGameWithUserStatus extends InternalGame {
  userEntered: boolean;
  userStatus: string | null;
}

type FilterType = 'all' | 'O' | 'upcoming';

export default function InternalGamesPage() {
  const { data: session } = useSession();
  const [games, setGames] = useState<InternalGameWithUserStatus[]>([]);
  const [filter, setFilter] = useState<FilterType>('O');
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGameForModal, setSelectedGameForModal] = useState<InternalGameWithUserStatus | null>(null);
  const [selectedGames, setSelectedGames] = useState<Set<string>>(new Set());
  const [entering, setEntering] = useState(false);
  const [detailsModalGame, setDetailsModalGame] = useState<InternalGameWithUserStatus | null>(null);

  useEffect(() => {
    fetchGames();
  }, []);

  // Initialize selected games checkboxes when games load
  useEffect(() => {
    if (games.length > 0) {
      const enteredGames = new Set(
        games.filter(g => g.status === 'O' && g.userEntered).map(g => g.tabName)
      );
      setSelectedGames(enteredGames);
    }
  }, [games]);

  async function fetchGames() {
    setLoading(true);
    try {
      const response = await fetch('/api/internal-games/games');
      const data = await response.json();
      if (data.games) {
        setGames(data.games);
      }
    } catch (error) {
      alert('Failed to load games. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateEntries() {
    setEntering(true);

    try {
      const errors: string[] = [];

      // Get all open games
      const openGames = games.filter(g => g.status === 'O');

      // Get set of games user is currently entered in
      const currentlyEntered = new Set(openGames.filter(g => g.userEntered).map(g => g.tabName));

      // Calculate changes
      const toEnter = Array.from(selectedGames).filter(id => !currentlyEntered.has(id));
      const toRemove = openGames.filter(g => currentlyEntered.has(g.tabName) && !selectedGames.has(g.tabName)).map(g => g.tabName);

      // Enter new games
      if (toEnter.length > 0) {
        const enterResponse = await fetch('/api/internal-games/enter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game_ids: toEnter }),
        });

        const enterData = await enterResponse.json();

        if (enterResponse.ok && enterData.results) {
          const failed = enterData.results.filter((r: any) => !r.entered) || [];
          if (failed.length > 0) {
            errors.push(...failed.map((f: any) => `Enter ${f.game_id}: ${f.error}`));
          }
        } else {
          errors.push(`Enter failed: ${enterData.error}`);
        }
      }

      // Withdraw from games
      for (const tabName of toRemove) {
        try {
          const removeResponse = await fetch('/api/internal-games/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: tabName }),
          });

          if (!removeResponse.ok) {
            errors.push(`Remove ${tabName}: Failed`);
          }
        } catch (error) {
          errors.push(`Remove ${tabName}: Error`);
        }
      }

      if (errors.length > 0) {
        alert(`Some updates failed:\n\n${errors.join('\n')}`);
      }

      await fetchGames();
    } catch (error) {
      alert('An error occurred while updating games.');
    } finally {
      setEntering(false);
    }
  }

  const filteredGames = games.filter(game => {
    switch (filter) {
      case 'O':
        return game.status === 'O';
      case 'upcoming':
        return ['', 'O', 'X', 'S'].includes(game.status);
      default:
        return true;
    }
  });

  function getStatusBadge(status: string) {
    const badges: { [key: string]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },
      'O': { label: 'Open', color: 'bg-green-500' },
      'X': { label: 'Closed', color: 'bg-yellow-500' },
      'S': { label: 'Selected', color: 'bg-blue-500' },
      'P': { label: 'Played', color: 'bg-purple-500' },
      'C': { label: 'Cancelled', color: 'bg-red-500' },
      'A': { label: 'Archived', color: 'bg-gray-400' },
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
          <h1 className="text-3xl font-bold text-gray-900">Internal Games</h1>

          {hasRole(session?.user?.role, 'Captain', 'Admin') && (
            <Link
              href="/internal-games/manage"
              className={getButtonClasses('primary', 'md')}
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
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            All Games
          </button>

          <button
            onClick={() => setFilter('O')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'O'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Open for Entry
          </button>

          <button
            onClick={() => setFilter('upcoming')}
            className={`px-4 py-2 font-medium border-b-2 ${
              filter === 'upcoming'
                ? 'border-blue-500 text-blue-500'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Upcoming
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
            {filteredGames.map((game, index) => (
              <div
                key={game.tabName && game.tabName.trim() ? game.tabName : `${game.date}-${game.gameName}-${game.time}-${index}`}
                className={`bg-white rounded-lg shadow border p-4 ${
                  game.userEntered ? 'border-blue-200' : 'border-gray-200'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    {game.detailsUrl ? (
                      <h3
                        className="font-bold text-lg text-blue-600 hover:text-blue-800 cursor-pointer hover:underline"
                        title={game.description || 'Click for details'}
                        onClick={() => setDetailsModalGame(game)}
                      >
                        {game.gameName}
                      </h3>
                    ) : game.description ? (
                      <h3
                        className="font-bold text-lg cursor-help"
                        title={game.description}
                      >
                        {game.gameName}
                      </h3>
                    ) : (
                      <h3 className="font-bold text-lg text-gray-900">{game.gameName}</h3>
                    )}
                    <p className="text-sm text-gray-700">
                      {parseUKDate(game.date).toLocaleDateString('en-GB', {
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

                <div className="space-y-1 text-sm text-gray-900 mb-4">
                  {game.location && (
                    <p>
                      <span className="font-medium">Location:</span> {game.location}
                    </p>
                  )}

                  <p>
                    <span className="font-medium">Format:</span> {game.format}
                  </p>

                  <p>
                    <span className="font-medium">Type:</span> {game.ladiesMen}
                  </p>

                  {/* For open games, show player count and capacity with View/Add button */}
                  {game.status === 'O' && (() => {
                    const hasCapacity = game.maxPlayers > 0;
                    const capacity = calculateCapacity(game);
                    const badgeColor = hasCapacity ? getCapacityBadgeColor(capacity) : 'bg-green-500';

                    return (
                      <div className="mt-2 pt-2 border-t border-gray-100">
                        <p className="font-medium text-gray-900">
                          {game.entered} Player{game.entered !== 1 ? 's' : ''} Entered
                        </p>
                        {hasCapacity && (
                          <p className="text-gray-700">
                            Capacity: {game.maxPlayers}
                          </p>
                        )}
                        <button
                          onClick={() => {
                            setSelectedGameForModal(game);
                            setIsModalOpen(true);
                          }}
                          className={`mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white rounded ${badgeColor} hover:opacity-90 transition-opacity`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          View / Add
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* For open games, show checkbox to enter/withdraw */}
                {game.status === 'O' && (() => {
                  const capacity = calculateCapacity(game);
                  const isFull = capacity.isFull && !game.userEntered;

                  return (
                    <label className={`flex items-center space-x-2 ${isFull ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={selectedGames.has(game.tabName)}
                        disabled={isFull}
                        onChange={e => {
                          const newSelected = new Set(selectedGames);
                          if (e.target.checked) {
                            newSelected.add(game.tabName);
                          } else {
                            newSelected.delete(game.tabName);
                          }
                          setSelectedGames(newSelected);
                        }}
                        className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500 disabled:cursor-not-allowed"
                      />
                      <span className={`text-sm font-medium ${isFull ? 'text-gray-400' : 'text-blue-500'}`}>
                        {isFull ? 'Game is full' : (game.userEntered ? 'Entered' : 'Enter this game')}
                      </span>
                    </label>
                  );
                })()}

                {/* View Details button for selected/played/cancelled/abandoned games */}
                {['S', 'P', 'C', 'A'].includes(game.status) && game.userEntered && (
                  <Link
                    href={`/internal-games/game/${game.tabDate}`}
                    className={`block w-full text-center ${getButtonClasses('primary', 'md')}`}
                  >
                    View Details
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Floating action button - only show when there are pending changes */}
        {(() => {
          const openGames = games.filter(g => g.status === 'O');
          const currentlyEntered = new Set(openGames.filter(g => g.userEntered).map(g => g.tabName));
          const toEnter = Array.from(selectedGames).filter(id => !currentlyEntered.has(id));
          const toRemove = openGames.filter(g => currentlyEntered.has(g.tabName) && !selectedGames.has(g.tabName));
          const changeCount = toEnter.length + toRemove.length;

          if (changeCount === 0) return null;

          return (
            <div className="fixed bottom-8 right-8 z-50">
              <button
                onClick={handleUpdateEntries}
                disabled={entering}
                className="bg-green-600 text-white px-6 py-3 rounded-full shadow-lg hover:bg-green-700 transition-colors flex items-center space-x-2 disabled:opacity-50"
              >
                {entering ? (
                  <>
                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Updating...</span>
                  </>
                ) : (
                  <>
                    <span>Update {changeCount} Game{changeCount !== 1 ? 's' : ''}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          );
        })()}

        {/* Modal for viewing and managing entered players */}
        {selectedGameForModal && (
          <EnteredPlayersModal
            isOpen={isModalOpen}
            onClose={() => {
              setIsModalOpen(false);
              setSelectedGameForModal(null);
            }}
            gameId={selectedGameForModal.tabName}
            gameType="internal-games"
            gameName={`${selectedGameForModal.gameName} - ${selectedGameForModal.date}`}
            ladiesMen={selectedGameForModal.ladiesMen}
            currentUserRole={session?.user?.role}
            maxPlayers={selectedGameForModal.maxPlayers}
            onPlayersChanged={() => {
              fetchGames();
            }}
          />
        )}

        {/* Modal for viewing game details (Google Doc) */}
        {detailsModalGame && detailsModalGame.detailsUrl && (
          <>
            <div
              className="fixed inset-0 bg-black bg-opacity-50 z-40"
              onClick={() => setDetailsModalGame(null)}
            />
            <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
                <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">{detailsModalGame.gameName}</h2>
                    {detailsModalGame.description && (
                      <p className="text-sm text-gray-600 mt-1">{detailsModalGame.description}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setDetailsModalGame(null)}
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <iframe
                    src={(() => {
                      // Convert Google Doc URL to embeddable preview URL
                      const url = detailsModalGame.detailsUrl!;
                      // Extract doc ID from various Google Doc URL formats
                      const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
                      if (match) {
                        return `https://docs.google.com/document/d/${match[1]}/preview`;
                      }
                      // If not a Google Doc, try to embed directly
                      return url;
                    })()}
                    className="w-full h-full border-0"
                    title={`Details for ${detailsModalGame.gameName}`}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
