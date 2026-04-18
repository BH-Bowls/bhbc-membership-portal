// app/internal-games/manage/game/[tabName]/page.tsx
// Team selection page for internal games with edit mode pattern

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';
import Link from 'next/link';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import { parseUKDate } from '@/lib/date-utils';
import { hasRole } from '@/lib/role-utils';

interface Player {
  rowNumber: number;
  name: string;
  selected: string;
  team: number | null;
  position: string;
}

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
  players: Player[];
}

export default function InternalGameSelectionPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const router = useRouter();
  const tabName = decodeURIComponent(params.tabName as string);

  const [gameData, setGameData] = useState<GameData | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [originalPlayers, setOriginalPlayers] = useState<Player[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddPlayersModal, setShowAddPlayersModal] = useState(false);

  // Draft form name for sessionStorage
  const draftFormName = `InternalGame-${tabName}`;
  const userName = session?.user?.userName || session?.user?.name || '';

  // Ref to track if initial setup has been done for this tabName
  const setupDoneRef = useRef<string | null>(null);

  // Effect: Initialize page - check auth, fetch data, restore draft
  useEffect(() => {
    if (status === 'loading') return;

    if (!session || !hasRole(session.user.role, 'Captain', 'Admin')) {
      router.push('/internal-games');
      return;
    }

    // Skip if we've already set up for this tabName
    if (setupDoneRef.current === tabName) return;

    async function initializePage() {
      try {
        // 1. Fetch game data
        const response = await fetch(`/api/internal-games/manage/game/${encodeURIComponent(tabName)}`);
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Failed to load game');
          return;
        }

        setGameData(data);
        setOriginalPlayers(data.players);

        // 2. Check for draft
        const currentUserName = session?.user?.userName || session?.user?.name || '';
        if (currentUserName) {
          const draft = restoreDraft<Player[]>(draftFormName, currentUserName);
          if (draft && draft.length > 0) {
            setPlayers(draft);
            setIsEditing(true);
          } else {
            setPlayers(data.players);
          }
        } else {
          setPlayers(data.players);
        }

        setupDoneRef.current = tabName;
      } catch (err) {
        setError('Failed to load game data');
      } finally {
        setLoading(false);
      }
    }

    initializePage();
  }, [session, status, router, tabName, draftFormName]);

  // Auto-save draft when editing
  useEffect(() => {
    if (isEditing && players.length > 0 && userName) {
      saveDraft(draftFormName, userName, players);
    }
  }, [isEditing, players, draftFormName, userName]);

  // Enter edit mode
  const startEditing = useCallback(() => {
    setOriginalPlayers(players);
    setIsEditing(true);
  }, [players]);

  // Save changes and exit edit mode
  const handleSave = useCallback(async () => {
    if (!gameData) return;

    setSaving(true);

    try {
      // Update each player's selection
      const updatePromises = players.map(player =>
        fetch(`/api/internal-games/manage/update-player`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tabName: gameData.game.tabName,
            rowNumber: player.rowNumber,
            updates: {
              selected: player.selected,
              team: player.team,
              position: player.position,
            },
          }),
        })
      );

      const results = await Promise.all(updatePromises);
      const allSuccessful = results.every(r => r.ok);

      if (allSuccessful) {
        // Refresh game data
        const response = await fetch(`/api/internal-games/manage/game/${encodeURIComponent(tabName)}`);
        const data = await response.json();
        if (response.ok) {
          setGameData(data);
          setPlayers(data.players);
          setOriginalPlayers(data.players);
        }
        clearDraft(draftFormName, userName);
        setIsEditing(false);
        alert('Selection saved successfully');
      } else {
        alert('Some updates failed. Please try again.');
      }
    } catch (err) {
      console.error('Error saving selection:', err);
      alert('Failed to save selection');
    } finally {
      setSaving(false);
    }
  }, [gameData, players, draftFormName, userName, tabName]);

  // Cancel changes and exit edit mode
  const handleCancel = useCallback(() => {
    setPlayers(originalPlayers);
    clearDraft(draftFormName, userName);
    setIsEditing(false);
  }, [originalPlayers, draftFormName, userName]);

  // Update a single field for a single player
  function updatePlayer(rowNumber: number, field: string, value: any) {
    setPlayers(prev =>
      prev.map(p =>
        p.rowNumber === rowNumber
          ? { ...p, [field]: value }
          : p
      )
    );
  }

  // Handle adding players via the EnteredPlayersModal
  async function handleAddPlayers(playerUserNames: string[]): Promise<{ success: boolean; error?: string }> {
    if (!gameData) return { success: false, error: 'Game data not loaded' };

    try {
      const response = await fetch('/api/internal-games/add-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: gameData.game.tabName,
          playerUserNames,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Fetch fresh game data to get new players
        const gameResponse = await fetch(`/api/internal-games/manage/game/${encodeURIComponent(tabName)}`);
        const gameDataResult = await gameResponse.json();

        if (gameResponse.ok) {
          setGameData(gameDataResult);

          // If editing, merge new players with existing edits
          if (isEditing) {
            const existingRowNumbers = new Set(players.map(p => p.rowNumber));
            const newPlayers = gameDataResult.players.filter(
              (p: Player) => !existingRowNumbers.has(p.rowNumber)
            );
            if (newPlayers.length > 0) {
              setPlayers([...players, ...newPlayers]);
            }
          } else {
            setPlayers(gameDataResult.players);
            setOriginalPlayers(gameDataResult.players);
          }
        }

        return { success: true };
      } else {
        return { success: false, error: data.error || 'Failed to add players' };
      }
    } catch (err) {
      console.error('Error adding players:', err);
      return { success: false, error: 'Failed to add players' };
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

  const { game } = gameData;

  // Build navbar action buttons - only show Save/Cancel when editing
  const navbarActionButtons = isEditing
    ? {
        primary: {
          label: 'Save',
          onClick: handleSave,
          loading: saving,
        },
        secondary: {
          label: 'Cancel',
          onClick: handleCancel,
          variant: 'secondary' as const,
        },
      }
    : undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user.name ?? undefined}
        userRole={session?.user.role ?? undefined}
        actionButtons={navbarActionButtons}
      />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <Link href="/internal-games/manage" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
              ← Back to Manage Games
            </Link>
            <h1 className="text-3xl font-bold text-gray-900">{game.gameName}</h1>
            <p className="text-gray-600">
              {parseUKDate(game.date).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              {' at '}
              {game.time}
            </p>
          </div>
        </div>

        {/* Action buttons panel */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3">
          {/* Edit button - only show when not editing */}
          {!isEditing && (
            <button
              onClick={startEditing}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit Selection
            </button>
          )}

          {/* Add Players button - only show when editing */}
          {isEditing && (
            <button
              onClick={() => setShowAddPlayersModal(true)}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Players
            </button>
          )}
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
            <h2 className="text-xl font-semibold text-gray-900">Entered Players ({players.length})</h2>
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
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={player.selected || ''}
                        onChange={e => updatePlayer(player.rowNumber, 'selected', e.target.value)}
                        disabled={!isEditing}
                        className={`text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      >
                        <option value="">-</option>
                        <option value="Y">Y (Playing)</option>
                        <option value="R">R (Reserve)</option>
                        <option value="T">T (Reserve Team)</option>
                      </select>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="number"
                        value={player.team || ''}
                        onChange={e => updatePlayer(player.rowNumber, 'team', e.target.value ? parseInt(e.target.value) : null)}
                        min="1"
                        disabled={!isEditing}
                        className={`w-16 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <select
                        value={player.position || ''}
                        onChange={e => updatePlayer(player.rowNumber, 'position', e.target.value)}
                        disabled={!isEditing}
                        className={`text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                      >
                        <option value="">-</option>
                        <option value="S">Skip</option>
                        <option value="1">Lead</option>
                        <option value="2">Second</option>
                        <option value="3">Third</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Instructions panel */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold mb-2">Instructions:</h4>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>Click <strong>Edit</strong> in the navbar to start editing selections</li>
            <li>Select players as Y (Playing), R (Reserve), or T (Reserve Team)</li>
            <li>Assign team numbers and positions for selected players</li>
            <li>Click <strong>Save</strong> to save changes, or <strong>Cancel</strong> to discard changes</li>
          </ul>
        </div>
      </div>

      {/* Add Players Modal */}
      <EnteredPlayersModal
        isOpen={showAddPlayersModal}
        onClose={() => setShowAddPlayersModal(false)}
        gameId={game.tabName}
        gameType="internal-games"
        gameName={game.gameName}
        ladiesMen={game.ladiesMen}
        currentUserRole={session?.user?.role}
        onPlayersChanged={() => {}}
        addOnlyMode={true}
        existingPlayerNames={players.map(p => p.name)}
        onAddPlayers={handleAddPlayers}
      />
    </div>
  );
}
