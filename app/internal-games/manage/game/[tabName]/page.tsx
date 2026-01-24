// app/internal-games/manage/game/[tabName]/page.tsx
// Team selection page for internal games (basic version)

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { getButtonClasses } from '@/config/theme-helpers';

interface GameData {
  game: {
    tabName: string;
    tabDate: string;
    date: string;
    time: string;
    gameName: string;
    format: string;
    ladiesMen: string;
    status: string;
    entered: number;
    selected: number;
    location?: string;
  };
  players: Array<{
    rowNumber: number;
    name: string;
    selected: string;
    team: number | null;
    position: string;
  }>;
}

export default function InternalGameSelectionPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const router = useRouter();
  const tabName = decodeURIComponent(params.tabName as string);

  const [gameData, setGameData] = useState<GameData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    if (!session || !['Captain', 'Admin'].includes(session.user.role)) {
      router.push('/internal-games');
      return;
    }

    fetchGameData();
  }, [session, status, router, tabName]);

  async function fetchGameData() {
    try {
      const response = await fetch(`/api/internal-games/manage/game/${encodeURIComponent(tabName)}`);
      const data = await response.json();

      if (response.ok) {
        setGameData(data);
      } else {
        setError(data.error || 'Failed to load game');
      }
    } catch (err) {
      setError('Failed to load game data');
    } finally {
      setLoading(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading game...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !gameData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
            {error || 'Game not found'}
          </div>
          <Link href="/internal-games/manage" className="text-blue-600 hover:underline mt-4 inline-block">
            ← Back to Manage Games
          </Link>
        </div>
      </div>
    );
  }

  const { game, players } = gameData;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold">{game.gameName}</h1>
            <p className="text-gray-600">
              {new Date(game.date).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              {' at '}
              {game.time}
            </p>
          </div>
          <Link href="/internal-games/manage" className={getButtonClasses('secondary', 'md')}>
            Back to Manage
          </Link>
        </div>

        {/* Game info */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm text-gray-500">Format</p>
              <p className="font-medium">{game.format}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Type</p>
              <p className="font-medium">{game.ladiesMen}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Entered</p>
              <p className="font-medium">{game.entered}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Selected</p>
              <p className="font-medium">{game.selected}</p>
            </div>
          </div>
        </div>

        {/* Players list */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold">Entered Players ({players.length})</h2>
          </div>

          {players.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              No players have entered this game yet.
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Selection</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {players.map((player) => (
                  <tr key={player.rowNumber} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap font-medium">{player.name}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{player.selected || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{player.team || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">{player.position || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded text-yellow-800">
          <p className="font-medium">Team selection editing coming soon</p>
          <p className="text-sm">For now, you can view entered players. Full team selection functionality will be added in a future update.</p>
        </div>
      </div>
    </div>
  );
}
