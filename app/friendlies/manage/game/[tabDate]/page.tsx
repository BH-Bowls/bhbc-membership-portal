'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { GameSheetPlayer } from '@/lib/types/friendlies';

interface GameData {
  game: {
    tabDate: string;
    date: string;
    time: string;
    clubName: string;
    homeAway: 'H' | 'A';
    format: string;
    ladiesMen: string;
    dress: string;
    status: string;
    tabName: string;
    entered: number;
    selected: number;
    reserves: number;
  };
  players: GameSheetPlayer[];
}

export default function TeamSelectionPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const tabDate = params.tabDate as string;

  const [gameData, setGameData] = useState<GameData | null>(null);
  const [players, setPlayers] = useState<GameSheetPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addPlayerName, setAddPlayerName] = useState('');

  useEffect(() => {
    fetchGameData();
  }, [tabDate]);

  async function fetchGameData() {
    setLoading(true);
    try {
      const response = await fetch(`/api/friendlies/manage/game/${tabDate}`);
      const data = await response.json();

      if (response.ok) {
        setGameData(data);
        setPlayers(data.players);
      } else {
        alert(data.error || 'Failed to load game');
        router.push('/friendlies/manage');
      }
    } catch (error) {
      console.error('Error fetching game:', error);
      alert('Failed to load game');
      router.push('/friendlies/manage');
    } finally {
      setLoading(false);
    }
  }

  async function handleGetStats() {
    if (!confirm('Update all player stats from the Players sheet?')) return;

    try {
      const response = await fetch('/api/friendlies/manage/get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_date: tabDate }),
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Stats updated for ${data.players_updated} players`);
        await fetchGameData();
      } else {
        alert(data.error || 'Failed to update stats');
      }
    } catch (error) {
      console.error('Error updating stats:', error);
      alert('Failed to update stats');
    }
  }

  async function handleUpdateSelection() {
    setSaving(true);
    try {
      // Build selection updates
      const selections = players.map(p => ({
        row_number: p.rowNumber,
        selected: p.selected,
        team: p.team,
        position: p.position,
        driving: p.driving,
        car_number: p.carNumber,
        captain: p.captain,
      }));

      const response = await fetch('/api/friendlies/manage/update-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_date: tabDate,
          selections,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert('Selection updated and sorted');
        setPlayers(data.sorted_players);
      } else {
        alert(data.error || 'Failed to update selection');
      }
    } catch (error) {
      console.error('Error updating selection:', error);
      alert('Failed to update selection');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateStats() {
    if (!confirm('Update the Players sheet with current selections?')) return;

    try {
      const response = await fetch('/api/friendlies/manage/update-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_date: tabDate }),
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Players sheet updated for ${data.stats_updated} players`);
      } else {
        alert(data.error || 'Failed to update stats');
      }
    } catch (error) {
      console.error('Error updating stats:', error);
      alert('Failed to update stats');
    }
  }

  async function handleAddPlayer() {
    if (!addPlayerName.trim()) return;

    try {
      const response = await fetch('/api/friendlies/manage/add-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_date: tabDate,
          user_name: addPlayerName.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Player ${addPlayerName} added`);
        setAddPlayerName('');
        await fetchGameData();
      } else {
        alert(data.error || 'Failed to add player');
      }
    } catch (error) {
      console.error('Error adding player:', error);
      alert('Failed to add player');
    }
  }

  function updatePlayer(rowNumber: number, field: string, value: any) {
    setPlayers(prev =>
      prev.map(p =>
        p.rowNumber === rowNumber
          ? { ...p, [field]: value }
          : field === 'captain' && value === 'Y'
          ? { ...p, captain: '' } // Clear other captains
          : p
      )
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading game...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gameData) return null;

  const { game } = gameData;
  const isAway = game.homeAway === 'A';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
      <div className="mb-6">
        <Link href="/friendlies/manage" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
          ← Back to Manage Games
        </Link>
        <h1 className="text-3xl font-bold">{game.clubName} - Team Selection</h1>
        <div className="text-gray-600 mt-2">
          {new Date(game.date).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          {' at '}
          {game.time}
          {' - '}
          {game.homeAway === 'H' ? 'Home' : 'Away'}
          {' - '}
          {game.format}
        </div>
      </div>

      {/* Action buttons */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3">
        <button
          onClick={handleGetStats}
          className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700 transition-colors"
        >
          Get Stats
        </button>
        <button
          onClick={handleUpdateSelection}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Update Selection'}
        </button>
        <button
          onClick={handleUpdateStats}
          className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors"
        >
          Update Stats to Players Sheet
        </button>
        <Link
          href={`/friendlies/match-card/${tabDate}`}
          className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
        >
          Print Match Card
        </Link>
      </div>

      {/* Add player */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h3 className="font-semibold mb-3">Add Offline Player</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={addPlayerName}
            onChange={e => setAddPlayerName(e.target.value)}
            placeholder="Enter player username"
            className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddPlayer}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Add Player
          </button>
        </div>
      </div>

      {/* Selection table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Stats</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">D/B</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Selected</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Team</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Position</th>
              {isAway && (
                <>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Driving</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Car #</th>
                </>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Captain</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {players.map(player => (
              <tr key={player.rowNumber} className={player.status === 'W' ? 'bg-red-50' : ''}>
                <td className="px-4 py-3 text-sm font-medium">{player.name}</td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  <div className="text-xs">
                    {player.nameDown}/{player.picked} ({player.percentPlayed}%)
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{player.driverBar}</span>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={player.selected}
                    onChange={e => updatePlayer(player.rowNumber, 'selected', e.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-</option>
                    <option value="Y">Y (Playing)</option>
                    <option value="R">R (Reserve)</option>
                    <option value="T">T (Reserve Team)</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={player.team || ''}
                    onChange={e => updatePlayer(player.rowNumber, 'team', e.target.value ? parseInt(e.target.value) : null)}
                    min="1"
                    className="w-16 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-3">
                  <select
                    value={player.position}
                    onChange={e => updatePlayer(player.rowNumber, 'position', e.target.value)}
                    className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">-</option>
                    <option value="S">Skip</option>
                    <option value="1">Lead</option>
                    <option value="2">Second</option>
                    <option value="3">Third</option>
                  </select>
                </td>
                {isAway && (
                  <>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={player.driving === 'Y'}
                        onChange={e => updatePlayer(player.rowNumber, 'driving', e.target.checked ? 'Y' : '')}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={player.carNumber || ''}
                        onChange={e => updatePlayer(player.rowNumber, 'carNumber', e.target.value)}
                        className="w-12 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                  </>
                )}
                <td className="px-4 py-3">
                  <input
                    type="radio"
                    name="captain"
                    checked={player.captain === 'Y'}
                    onChange={() => updatePlayer(player.rowNumber, 'captain', 'Y')}
                    className="w-4 h-4"
                  />
                </td>
                <td className="px-4 py-3 text-sm">
                  {player.status === 'Y' && <span className="text-green-600">✓ Confirmed</span>}
                  {player.status === 'W' && <span className="text-red-600">Withdrawn</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-semibold mb-2">Instructions:</h4>
        <ul className="text-sm space-y-1 list-disc list-inside">
          <li>Use "Get Stats" to refresh player statistics from the Players sheet</li>
          <li>Select players as Y (Playing), R (Reserve), or T (Reserve Team)</li>
          <li>Assign team numbers and positions for selected players</li>
          <li>Select ONE captain of the day (radio button)</li>
          <li>For away games, mark drivers and assign car numbers</li>
          <li>Click "Update Selection" to save and sort the table</li>
          <li>Use "Update Stats to Players Sheet" to sync final selections back to the Players sheet</li>
        </ul>
      </div>
      </div>
    </div>
  );
}
