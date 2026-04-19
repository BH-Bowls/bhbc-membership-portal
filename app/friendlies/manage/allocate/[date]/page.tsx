// app/friendlies/manage/allocate/[date]/page.tsx
// Allocation screen for paired games — captain assigns each player to Game A or Game B
// Shown when paired games are in 'L' (Allocating) status. Players start unallocated.
// Saving creates the game sheets with only allocated players and transitions to 'X' (Selecting).

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { Game } from '@/lib/types/friendlies';
import { getButtonClasses } from '@/config/theme-helpers';
import Link from 'next/link';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';

interface AllocPlayer {
  name: string;
  fullName: string;
}

type Pool = 'unallocated' | 'a' | 'b';

export default function AllocatePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const date = decodeURIComponent(params.date as string);
  usePhoneBackNavigation('/friendlies/manage');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [gameA, setGameA] = useState<Game | null>(null);
  const [gameB, setGameB] = useState<Game | null>(null);
  const [players, setPlayers] = useState<AllocPlayer[]>([]);
  const [allocation, setAllocation] = useState<Record<string, Pool>>({});
  const [draggedPlayer, setDraggedPlayer] = useState<string | null>(null);

  // Fetch paired games and their players
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // First, get all games to find the paired games on this date
        const gamesRes = await fetch('/api/friendlies/manage/games');
        const gamesData = await gamesRes.json();

        if (!gamesData.games) {
          alert('Failed to load games');
          return;
        }

        // Find paired games on this date in Allocating status
        const pairedGames = (gamesData.games as Game[]).filter(
          g => g.date === date && g.paired === 'Y' && g.status === 'L'
        );

        if (pairedGames.length < 2) {
          alert('Could not find two paired games on this date');
          router.push('/friendlies/manage');
          return;
        }

        const gA = pairedGames[0];
        const gB = pairedGames[1];
        setGameA(gA);
        setGameB(gB);

        // Fetch players from both game sheets via allocation API
        const playersRes = await fetch(
          `/api/friendlies/manage/allocate?game_a=${encodeURIComponent(gA.tabName)}&game_b=${encodeURIComponent(gB.tabName)}`
        );
        const playersData = await playersRes.json();

        if (playersData.success) {
          setPlayers(playersData.players);
          // Initialize all players as unallocated
          const initialAlloc: Record<string, Pool> = {};
          for (const p of playersData.players) {
            initialAlloc[p.name] = 'unallocated';
          }
          setAllocation(initialAlloc);
        }
      } catch (error) {
        console.error('Error fetching allocation data:', error);
        alert('Failed to load allocation data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [date, router]);

  // Move a player to a pool
  function movePlayer(playerName: string, pool: Pool) {
    setAllocation(prev => ({ ...prev, [playerName]: pool }));
  }

  // Get players in a specific pool
  function getPoolPlayers(pool: Pool): AllocPlayer[] {
    return players.filter(p => allocation[p.name] === pool);
  }

  // Check if allocation is complete (no unallocated players)
  function isComplete(): boolean {
    return players.length > 0 && getPoolPlayers('unallocated').length === 0;
  }

  // Save allocation
  async function handleSave() {
    if (!gameA || !gameB) return;
    if (!isComplete()) {
      alert('Please allocate all players before saving.');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/friendlies/manage/allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_a_tab_name: gameA.tabName,
          game_b_tab_name: gameB.tabName,
          game_a_players: getPoolPlayers('a').map(p => p.name),
          game_b_players: getPoolPlayers('b').map(p => p.name),
        }),
      });

      const data = await response.json();

      if (data.success) {
        router.push('/friendlies/manage');
      } else {
        alert(data.error || 'Failed to save allocation');
      }
    } catch (error) {
      console.error('Error saving allocation:', error);
      alert('Failed to save allocation');
    } finally {
      setSaving(false);
    }
  }

  // Drag and drop handlers
  function handleDragStart(playerName: string) {
    setDraggedPlayer(playerName);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent, pool: Pool) {
    e.preventDefault();
    if (draggedPlayer) {
      movePlayer(draggedPlayer, pool);
      setDraggedPlayer(null);
    }
  }

  // Render a player chip
  function PlayerChip({ player, currentPool }: { player: AllocPlayer; currentPool: Pool }) {
    return (
      <div
        draggable
        onDragStart={() => handleDragStart(player.name)}
        className="flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow"
      >
        <span className="text-sm font-medium text-gray-900">{player.fullName}</span>
        <div className="flex gap-1">
          {currentPool !== 'a' && gameA && (
            <button
              onClick={() => movePlayer(player.name, 'a')}
              className="px-2 py-0.5 text-xs font-medium rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
              title={`Move to ${gameA.clubName}`}
            >
              {gameA.clubName.charAt(0)}
            </button>
          )}
          {currentPool !== 'b' && gameB && (
            <button
              onClick={() => movePlayer(player.name, 'b')}
              className="px-2 py-0.5 text-xs font-medium rounded bg-green-100 text-green-700 hover:bg-green-200"
              title={`Move to ${gameB.clubName}`}
            >
              {gameB.clubName.charAt(0)}
            </button>
          )}
          {currentPool !== 'unallocated' && (
            <button
              onClick={() => movePlayer(player.name, 'unallocated')}
              className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
              title="Move back to unallocated"
            >
              X
            </button>
          )}
        </div>
      </div>
    );
  }

  // Pool column component
  function PoolColumn({ title, pool, color, borderColor, bgColor }: {
    title: string;
    pool: Pool;
    color: string;
    borderColor: string;
    bgColor: string;
  }) {
    const poolPlayers = getPoolPlayers(pool);
    return (
      <div
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, pool)}
        className={`border-2 ${borderColor} ${bgColor} rounded-lg p-4 min-h-[200px]`}
      >
        <h3 className={`font-bold text-lg mb-1 ${color}`}>{title}</h3>
        <p className="text-sm text-gray-500 mb-3">{poolPlayers.length} player{poolPlayers.length !== 1 ? 's' : ''}</p>
        <div className="space-y-2">
          {poolPlayers.map(p => (
            <PlayerChip key={p.name} player={p} currentPool={pool} />
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600">Loading allocation data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Allocate Players</h1>
            <p className="text-gray-600 mt-1">
              {gameA?.clubName}{gameA?.clubName !== gameB?.clubName ? ` + ${gameB?.clubName}` : ''} &mdash; {date}
            </p>
          </div>
          <Link href="/friendlies/manage" className={getButtonClasses('secondary', 'md')}>← Back to Manage</Link>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <p className="text-blue-800 text-sm">
            Drag players or use the buttons to assign each player to either the{' '}
            <strong>{gameA?.clubName}</strong> or <strong>{gameB?.clubName}</strong> game.
            All players must be allocated before saving. Saving will create the game sheets and close both games.
          </p>
        </div>

        {/* Unallocated pool */}
        <div className="mb-6">
          <PoolColumn
            title="Unallocated"
            pool="unallocated"
            color="text-gray-700"
            borderColor="border-gray-300"
            bgColor="bg-gray-50"
          />
        </div>

        {/* Two-column layout for Game A and Game B */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <PoolColumn
            title={`${gameA?.clubName || 'Game A'} — ${gameA?.format || ''}`}
            pool="a"
            color="text-blue-700"
            borderColor="border-blue-300"
            bgColor="bg-blue-50"
          />
          <PoolColumn
            title={`${gameB?.clubName || 'Game B'} — ${gameB?.format || ''}`}
            pool="b"
            color="text-green-700"
            borderColor="border-green-300"
            bgColor="bg-green-50"
          />
        </div>

        {/* Quick allocation buttons */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={() => {
              const newAlloc: Record<string, Pool> = {};
              players.forEach(p => { newAlloc[p.name] = 'a'; });
              setAllocation(newAlloc);
            }}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 rounded hover:bg-blue-200"
          >
            All to {gameA?.clubName || 'Game A'}
          </button>
          <button
            onClick={() => {
              const newAlloc: Record<string, Pool> = {};
              players.forEach(p => { newAlloc[p.name] = 'b'; });
              setAllocation(newAlloc);
            }}
            className="px-4 py-2 text-sm font-medium text-green-700 bg-green-100 rounded hover:bg-green-200"
          >
            All to {gameB?.clubName || 'Game B'}
          </button>
          <button
            onClick={() => {
              const newAlloc: Record<string, Pool> = {};
              players.forEach(p => { newAlloc[p.name] = 'unallocated'; });
              setAllocation(newAlloc);
            }}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
          >
            Reset All
          </button>
        </div>

        {/* Save button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={!isComplete() || saving}
            className={`px-6 py-3 rounded-lg font-medium text-white shadow ${
              isComplete() && !saving
                ? 'bg-green-600 hover:bg-green-700 cursor-pointer'
                : 'bg-gray-400 cursor-not-allowed'
            } disabled:opacity-50 flex items-center gap-2`}
          >
            {saving && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            {saving ? 'Saving & Closing...' : `Save & Close (${getPoolPlayers('a').length} + ${getPoolPlayers('b').length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
