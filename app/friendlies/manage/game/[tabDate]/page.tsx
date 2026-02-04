// app/friendlies/manage/game/[tabDate]/page.tsx
// Team selection page for captains to select players, assign teams/positions, and manage game day logistics
// Allows viewing player stats, adding offline players, selecting teams, and generating match cards

'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';
import Link from 'next/link';
import { GameSheetPlayer } from '@/lib/types/friendlies';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import { parseUKDate } from '@/lib/date-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Game data structure returned from API
 * Includes game details and list of all players with their stats
 */
interface GameData {
  // Game information
  game: {
    tabDate: string;        // Game sheet identifier (e.g., "13 Jan 25")
    date: string;           // Game date (DD/MM/YYYY)
    time: string;           // Game time (HH:MM)
    clubName: string;       // Opponent club name
    homeAway: 'H' | 'A';    // Home or Away venue
    format: string;         // Game format (Triples, Pairs, etc.)
    ladiesMen: string;      // Ladies/Men/Mixed
    dress: string;          // Dress code
    status: string;         // Game status (O, X, S, P, C, A)
    tabName: string;        // Tab name in Google Sheets
    entered: number;        // Number of players entered
    selected: number;       // Number of players selected
    reserves: number;       // Number of reserves
  };

  // List of players with stats and selection info
  players: GameSheetPlayer[];
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Team Selection Page Component
 * Captain-only page for selecting players and building teams
 * Features:
 * - View all entered players with stats (name down, picked, percent played)
 * - Add offline players who didn't enter online
 * - Select players as Playing/Reserve/Reserve Team
 * - Assign team numbers and positions (Skip, Lead, Second, Third)
 * - Select captain of the day
 * - For away games: mark drivers and assign car numbers
 * - Update selection and sync back to Players sheet
 * - Generate match card for printing
 */
export default function TeamSelectionPage() {
  // Get user session for authentication
  const { data: session } = useSession();

  // Get route parameters and navigation
  const params = useParams();
  const router = useRouter();

  // Extract tabDate from URL parameter
  const tabDate = params.tabDate as string;

  // State: Game data including game details and all players
  const [gameData, setGameData] = useState<GameData | null>(null);

  // State: Players list (separate from gameData for easier updates)
  const [players, setPlayers] = useState<GameSheetPlayer[]>([]);

  // State: Original players for cancel/reset
  const [originalPlayers, setOriginalPlayers] = useState<GameSheetPlayer[]>([]);

  // State: Edit mode - whether user is editing selections
  const [isEditing, setIsEditing] = useState(false);

  // State: Loading indicator while fetching game data
  const [loading, setLoading] = useState(true);

  // State: Saving indicator while updating selection
  const [saving, setSaving] = useState(false);

  // State: Refreshing stats indicator
  const [refreshingStats, setRefreshingStats] = useState(false);

  // State: Add Players modal visibility
  const [showAddPlayersModal, setShowAddPlayersModal] = useState(false);

  // State: Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Ref to track if initial setup has been done for this tabDate
  const setupDoneRef = useRef<string | null>(null);

  // Draft form name for sessionStorage
  const draftFormName = `FriendliesGame-${tabDate}`;
  const userName = session?.user?.userName || session?.user?.name || '';

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Initialize page - fetch data, restore draft, then refresh stats
   * All done in one effect to avoid race conditions
   * Waits for session to be ready before running
   */
  useEffect(() => {
    // Wait for session to be ready (needed for draft check)
    if (!session?.user) return;

    // Skip if we've already set up for this tabDate
    if (setupDoneRef.current === tabDate) return;

    async function initializePage() {
      setLoading(true);

      try {
        // 1. Fetch game data
        const response = await fetch(`/api/friendlies/manage/game/${tabDate}`);
        const data = await response.json();

        if (!response.ok) {
          alert(data.error || 'Failed to load game');
          router.push('/friendlies/manage');
          return;
        }

        setGameData(data);
        setOriginalPlayers(data.players);

        // 2. Check for draft
        const currentUserName = session?.user?.userName || session?.user?.name || '';

        if (currentUserName) {
          const draft = restoreDraft<GameSheetPlayer[]>(draftFormName, currentUserName);
          if (draft && draft.length > 0) {
            setPlayers(draft);
            setIsEditing(true);
          } else {
            setPlayers(data.players);
          }
        } else {
          setPlayers(data.players);
        }

        // Note: Stats are populated when the game is closed (createGameSheet).
        // get-stats is only called when adding new players via the Add Players button.

        setupDoneRef.current = tabDate;
      } catch (error) {
        console.error('Error fetching game:', error);
        alert('Failed to load game');
        router.push('/friendlies/manage');
      } finally {
        setLoading(false);
      }
    }

    initializePage();
  }, [tabDate, session, draftFormName, router]);

  /**
   * Effect: Auto-save draft when editing
   */
  useEffect(() => {
    if (isEditing && players.length > 0 && userName) {
      saveDraft(draftFormName, userName, players);
    }
  }, [isEditing, players, draftFormName, userName]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Helper to close confirmation dialog
   */
  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: () => {},
    });
  };

  /**
   * Refresh stats from Players sheet and add any new players
   * Preserves current edits - only adds truly new players
   * Called after adding players via the modal
   */
  async function refreshStats() {
    if (!gameData) return;

    setRefreshingStats(true);

    try {
      const response = await fetch('/api/friendlies/manage/get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: gameData.game.tabName }),
      });

      const data = await response.json();

      if (response.ok) {
        // Get fresh game data to find new players
        const gameResponse = await fetch(`/api/friendlies/manage/game/${tabDate}`);
        const gameDataResult = await gameResponse.json();
        if (gameResponse.ok) {
          setGameData(gameDataResult);

          // If we're editing, merge new players with existing edits
          if (isEditing) {
            const existingRowNumbers = new Set(players.map(p => p.rowNumber));
            const newPlayers = gameDataResult.players.filter(
              (p: GameSheetPlayer) => !existingRowNumbers.has(p.rowNumber)
            );
            if (newPlayers.length > 0) {
              setPlayers([...players, ...newPlayers]);
            }
          } else {
            // Not editing, just replace
            setPlayers(gameDataResult.players);
            setOriginalPlayers(gameDataResult.players);
          }
        }
      } else {
        console.error('Failed to refresh stats:', data.error);
      }
    } catch (error) {
      console.error('Error refreshing stats:', error);
    } finally {
      setRefreshingStats(false);
    }
  }

  /**
   * Handle adding players via the EnteredPlayersModal
   * The add-players API now adds players to both Players sheet AND game sheet directly
   * So we just need to refetch game data to update the UI
   */
  async function handleAddPlayers(playerUserNames: string[]): Promise<{ success: boolean; error?: string }> {
    if (!gameData) return { success: false, error: 'Game data not loaded' };

    try {
      // Call add-players endpoint which adds to Players sheet AND game sheet
      const response = await fetch('/api/friendlies/add-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: gameData.game.tabName,
          playerUserNames,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Refetch game data to get updated player list (skip get-stats, it's done by add-players)
        const gameResponse = await fetch(`/api/friendlies/manage/game/${tabDate}`);
        const gameDataResult = await gameResponse.json();
        if (gameResponse.ok) {
          setGameData(gameDataResult);
          // Merge new players with existing edits if editing
          if (isEditing) {
            const existingRowNumbers = new Set(players.map(p => p.rowNumber));
            const newPlayers = gameDataResult.players.filter(
              (p: GameSheetPlayer) => !existingRowNumbers.has(p.rowNumber)
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
    } catch (error) {
      console.error('Error adding players:', error);
      return { success: false, error: 'Failed to add players' };
    }
  }

  // ============================================================================
  // Edit Mode Functions
  // ============================================================================

  /**
   * Enter edit mode
   */
  const startEditing = useCallback(() => {
    setOriginalPlayers(players);
    setIsEditing(true);
  }, [players]);

  /**
   * Save changes and exit edit mode
   * Wraps handleUpdateSelection with edit mode handling
   */
  const handleSave = useCallback(async () => {
    if (!gameData) return;

    setSaving(true);

    try {
      // 1. Save selection to game sheet
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
          tab_name: gameData.game.tabName,
          selections,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || 'Failed to save selection');
        return;
      }

      // 2. Update stats to Players sheet (recalculates from all game columns)
      // 3. Refresh game sheet stats from the now-updated Players sheet
      // 4. Re-fetch game data to get updated stats for display
      let updatedPlayers = data.sorted_players;
      try {
        await fetch('/api/friendlies/manage/update-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: gameData.game.tabName }),
        });

        await fetch('/api/friendlies/manage/get-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: gameData.game.tabName }),
        });

        const refreshResponse = await fetch(`/api/friendlies/manage/game?tab_name=${encodeURIComponent(gameData.game.tabName)}`);
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          if (refreshData.players) {
            updatedPlayers = refreshData.players;
          }
        }
      } catch (statsError) {
        console.error('Error updating stats:', statsError);
        // Don't fail the save - just use data from save response
      }

      setPlayers(updatedPlayers);
      setOriginalPlayers(updatedPlayers);
      clearDraft(draftFormName, userName);
      setIsEditing(false);
      // Success - no alert needed, UI reflects saved state
    } catch (error) {
      console.error('Error saving selection:', error);
      // Keep error alert as user needs to know save failed
      alert('Failed to save selection');
    } finally {
      setSaving(false);
    }
  }, [gameData, players, draftFormName, userName]);

  /**
   * Cancel changes and exit edit mode
   */
  const handleCancel = useCallback(() => {
    setPlayers(originalPlayers);
    clearDraft(draftFormName, userName);
    setIsEditing(false);
  }, [originalPlayers, draftFormName, userName]);

  // ============================================================================
  // Local State Update Functions
  // ============================================================================

  /**
   * Update a single field for a single player
   * Updates local state only - doesn't save to server until Save clicked
   * Special handling for captain field - only one player can be captain
   */
  function updatePlayer(rowNumber: number, field: string, value: any) {
    setPlayers(prev =>
      prev.map(p =>
        p.rowNumber === rowNumber
          ? { ...p, [field]: value }
          : field === 'captain' && value === 'Y'
          ? { ...p, captain: '' }
          : p
      )
    );
  }

  // ============================================================================
  // Loading State
  // ============================================================================

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

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user.name ?? undefined}
        userRole={session?.user.role ?? undefined}
        actionButtons={navbarActionButtons}
      />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header with back link and game details */}
        <div className="mb-6">
          <Link href="/friendlies/manage" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">
            ← Back to Manage Games
          </Link>

          <h1 className="text-3xl font-bold">{game.clubName} - Team Selection</h1>

          <div className="text-gray-600 mt-2">
            {parseUKDate(game.date).toLocaleDateString('en-GB', {
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

          {/* Refreshing stats indicator */}
          {refreshingStats && (
            <div className="mt-2 text-sm text-blue-600 flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Refreshing player stats...
            </div>
          )}
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

          {/* Print Match Card link - always visible */}
          <Link
            href={`/friendlies/match-card/${tabDate}`}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
          >
            Print Match Card
          </Link>
        </div>

        {/* Selection table - main UI for selecting players and assigning teams */}
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
                <tr
                  key={player.rowNumber}
                  className={player.status === 'W' ? 'bg-red-50' : ''}
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    <span
                      className="cursor-help"
                      title={player.last8Games && player.last8Games.length > 0 ? player.last8Games.join('\n') : 'No recent games'}
                    >
                      {player.fullName}
                    </span>
                  </td>

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
                      disabled={!isEditing}
                      className={`text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
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
                      disabled={!isEditing}
                      className={`w-16 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                    />
                  </td>

                  <td className="px-4 py-3">
                    <select
                      value={player.position}
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

                  {isAway && (
                    <>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={player.driving === 'Y'}
                          onChange={e => updatePlayer(player.rowNumber, 'driving', e.target.checked ? 'Y' : '')}
                          disabled={!isEditing}
                          className={`w-4 h-4 ${!isEditing ? 'cursor-not-allowed' : ''}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={player.carNumber || ''}
                          onChange={e => updatePlayer(player.rowNumber, 'carNumber', e.target.value)}
                          disabled={!isEditing}
                          className={`w-12 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
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
                      disabled={!isEditing}
                      className={`w-4 h-4 ${!isEditing ? 'cursor-not-allowed' : ''}`}
                    />
                  </td>

                  <td className="px-4 py-3 text-sm">
                    {player.status === 'Y' && <span className="text-green-600">Confirmed</span>}
                    {player.status === 'W' && <span className="text-red-600">Withdrawn</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Instructions panel */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold mb-2">Instructions:</h4>
          <ul className="text-sm space-y-1 list-disc list-inside">
            <li>Player stats are populated when the game is closed and when new players are added</li>
            <li>Click <strong>Edit Selection</strong> to start editing</li>
            <li>Select players as Y (Playing), R (Reserve), or T (Reserve Team)</li>
            <li>Assign team numbers and positions for selected players</li>
            <li>Select ONE captain of the day (radio button)</li>
            <li>For away games, mark drivers and assign car numbers</li>
            <li>Click <strong>Save</strong> to save selections (also updates Players sheet), or <strong>Cancel</strong> to discard changes</li>
          </ul>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />

      {/* Add Players Modal */}
      <EnteredPlayersModal
        isOpen={showAddPlayersModal}
        onClose={() => setShowAddPlayersModal(false)}
        gameId={game.tabName}
        gameType="friendlies"
        gameName={game.clubName}
        ladiesMen={game.ladiesMen}
        currentUserRole={session?.user?.role}
        onPlayersChanged={() => {}} // Refresh handled by onAddPlayers
        addOnlyMode={true}
        existingPlayerNames={players.map(p => p.name)}
        onAddPlayers={handleAddPlayers}
      />
    </div>
  );
}
