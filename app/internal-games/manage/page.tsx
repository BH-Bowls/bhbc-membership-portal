// app/internal-games/manage/page.tsx
// Internal Games management page (Captain/Admin only)

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';
import type { InternalGame } from '@/lib/game-management/types';
import { parseUKDate } from '@/lib/date-utils';
import { hasRole } from '@/lib/role-utils';

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export default function ManageInternalGamesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [games, setGames] = useState<InternalGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  useEffect(() => {
    if (status === 'loading') return;

    if (!session || !hasRole(session.user.role, 'Captain', 'Admin')) {
      router.push('/internal-games');
      return;
    }

    fetchGames();
  }, [session, status, router]);

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

  async function changeStatus(tabName: string, action: string, additionalData?: any, rowNumber?: number) {
    setActionLoading(tabName || `row-${rowNumber}`);

    try {
      const response = await fetch('/api/internal-games/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabName,
          row_number: rowNumber,
          action,
          ...additionalData,
        }),
      });

      const data = await response.json();

      if (response.ok) {
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

  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: () => {},
    });
  };

  function handleOpenGame(tabName: string, rowNumber: number) {
    setConfirmDialog({
      isOpen: true,
      title: 'Open Game',
      message: 'Open this game for player entry?',
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(tabName, 'open', undefined, rowNumber);
      },
    });
  }

  function handleCloseGame(tabName: string, rowNumber: number) {
    setConfirmDialog({
      isOpen: true,
      title: 'Close Game',
      message: 'Close this game and create team selection sheet?',
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(tabName, 'close', undefined, rowNumber);
      },
    });
  }

  function handlePublishSelection(tabName: string) {
    setConfirmDialog({
      isOpen: true,
      title: 'Publish Selection',
      message: 'Publish team selection to players?',
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(tabName, 'publish');
      },
    });
  }

  function handleMarkPlayed(tabName: string) {
    setConfirmDialog({
      isOpen: true,
      title: 'Mark as Played',
      message: 'Mark this game as played?',
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(tabName, 'played');
      },
    });
  }

  function handleCancelGame(tabName: string) {
    const reason = prompt('Enter cancellation reason:');
    const who = prompt('Who cancelled? (Club/Weather/Other):');

    if (!reason || !who) return;

    changeStatus(tabName, 'cancel', { reason, who });
  }

  function getStatusBadge(status: string) {
    const badges: { [key: string]: { label: string; color: string } } = {
      '': { label: 'Not Opened', color: 'bg-gray-500' },
      'O': { label: 'Open', color: 'bg-green-500' },
      'X': { label: 'Selecting', color: 'bg-yellow-500' },
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

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Manage Internal Games</h1>
          <Link
            href="/internal-games"
            className={getButtonClasses('secondary', 'md')}
          >
            Player View
          </Link>
        </div>

        {games.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600">No games found.</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Game
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Date / Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Format
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Players
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {games.map((game, index) => (
                  <tr key={game.tabName && game.tabName.trim() ? game.tabName : `${game.date}-${game.gameName}-${game.time}-${index}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{game.gameName}</div>
                      {game.location && (
                        <div className="text-sm text-gray-700">{game.location}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {parseUKDate(game.date).toLocaleDateString('en-GB')}
                      </div>
                      <div className="text-sm text-gray-700">{game.time}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{game.format}</div>
                      <div className="text-sm text-gray-700">{game.ladiesMen}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {game.entered} entered / {game.selected} selected
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(game.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                      {/* Not opened games - show Open button */}
                      {game.status === '' && (
                        <button
                          onClick={() => handleOpenGame(game.tabName, game._rowNumber!)}
                          disabled={actionLoading === game.tabName || actionLoading === `row-${game._rowNumber}`}
                          className="text-green-600 hover:text-green-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Open
                        </button>
                      )}

                      {/* Open games - show Close button */}
                      {game.status === 'O' && (
                        <button
                          onClick={() => handleCloseGame(game.tabName, game._rowNumber!)}
                          disabled={actionLoading === game.tabName || actionLoading === `row-${game._rowNumber}`}
                          className="text-yellow-600 hover:text-yellow-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Close
                        </button>
                      )}

                      {/* Selecting games - show Select Team link and Publish button */}
                      {game.status === 'X' && (
                        <>
                          <Link
                            href={`/internal-games/manage/game/${encodeURIComponent(game.tabName)}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Select Team
                          </Link>
                          <button
                            onClick={() => handlePublishSelection(game.tabName)}
                            disabled={actionLoading === game.tabName}
                            className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Publish
                          </button>
                        </>
                      )}

                      {/* Selected games - show Edit link and Mark Played button */}
                      {game.status === 'S' && (
                        <>
                          <Link
                            href={`/internal-games/manage/game/${encodeURIComponent(game.tabName)}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Edit
                          </Link>
                          <button
                            onClick={() => handleMarkPlayed(game.tabName)}
                            disabled={actionLoading === game.tabName}
                            className="text-purple-600 hover:text-purple-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Mark Played
                          </button>
                        </>
                      )}

                      {/* Cancel button - show for all active games */}
                      {['', 'O', 'X', 'S'].includes(game.status) && (
                        <button
                          onClick={() => handleCancelGame(game.tabName)}
                          disabled={actionLoading === game.tabName}
                          className="text-red-600 hover:text-red-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                      )}

                      {/* Played games - just show View link */}
                      {game.status === 'P' && (
                        <Link
                          href={`/internal-games/manage/game/${encodeURIComponent(game.tabName)}`}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          View
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold mb-2 text-gray-900">{confirmDialog.title}</h3>
            <p className="text-gray-600 mb-4">{confirmDialog.message}</p>
            <div className="flex justify-end space-x-2">
              <button
                onClick={closeConfirmDialog}
                className={getButtonClasses('secondary', 'sm')}
              >
                Cancel
              </button>
              <button
                onClick={confirmDialog.onConfirm}
                className={getButtonClasses('primary', 'sm')}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
