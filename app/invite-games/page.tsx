// app/invite-games/page.tsx
// Invite Games list page — all members can view, committee can add

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { InviteGame } from '@/types/invite-games';

export default function InviteGamesPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [games, setGames] = useState<InviteGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCommittee, setIsCommittee] = useState(false);

  useEffect(() => {
    fetchGames();
  }, []);

  // Determine committee status from session
  useEffect(() => {
    const role = session?.user?.role || 'Member';
    setIsCommittee(role !== 'Member' && role !== '');
  }, [session]);

  async function fetchGames() {
    setLoading(true);
    try {
      const response = await fetch('/api/invite-games');
      const data = await response.json();
      if (response.ok) {
        setGames(data.games);
      } else {
        alert(data.error || 'Failed to load invite games');
      }
    } catch (error) {
      console.error('Error fetching invite games:', error);
      alert('Failed to load invite games');
    } finally {
      setLoading(false);
    }
  }

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB');
    } catch {
      return dateStr;
    }
  };

  const isUpcoming = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false;
    return new Date(dateStr) >= new Date();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
      />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Invite Games</h1>
            <p className="text-gray-600 mt-1">
              External club competitions and invite events
            </p>
          </div>

          {isCommittee && (
            <button
              onClick={() => router.push('/invite-games/new')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Game
            </button>
          )}
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="mt-2 text-gray-600">Loading invite games...</p>
          </div>
        ) : games.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-gray-500 mb-4">No invite games added yet.</p>
            {isCommittee && (
              <button
                onClick={() => router.push('/invite-games/new')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                Add First Game
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {games.map((game) => (
              <div
                key={game.inviteGameId}
                onClick={() => router.push(`/invite-games/${game.inviteGameId}`)}
                title="View invite game details"
                className="bg-white rounded-lg shadow p-5 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-mono text-xs text-gray-500">
                        {game.inviteGameId}
                      </span>
                      {game.gameDate && isUpcoming(game.gameDate) && (
                        <span className="inline-block px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded">
                          Upcoming
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 truncate">
                      {game.title}
                    </h2>
                    {game.description && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {game.description}
                      </p>
                    )}
                  </div>

                  <div className="flex-shrink-0 text-right text-sm text-gray-600 space-y-1">
                    {game.gameDate && (
                      <div>
                        <span className="font-medium">Game:</span>{' '}
                        {formatDate(game.gameDate)}
                      </div>
                    )}
                    {game.closingDate && (
                      <div>
                        <span className="font-medium">Closing:</span>{' '}
                        {formatDate(game.closingDate)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2 text-xs text-gray-400">
                  Added by {game.createdByFullName} on {formatDate(game.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
