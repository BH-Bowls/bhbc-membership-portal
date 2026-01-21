// src/components/game-management/EnteredPlayersModal.tsx
// Modal to show who has entered a game and allow adding/removing players
// Used by Friendlies, Internal Games, and Social Events

'use client';

import { useState, useEffect } from 'react';
import { SearchableSelect } from '../SearchableSelect';

interface EnteredPlayer {
  userName: string;
  fullName: string;
  status: 'E' | 'M'; // E = self-entered, M = manually added
}

interface EnteredPlayersModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string; // tabName for the game
  gameType: 'friendlies' | 'internal-games' | 'social-events';
  gameName: string; // Display name (club name, game name, or event name)
  ladiesMen?: string; // For gender validation (Friendlies/Internal Games only)
  currentUserRole?: string; // For capacity restrictions
  maxPlayers?: number; // For capacity checking
  onPlayersChanged: () => void; // Callback to refresh parent data
}

export function EnteredPlayersModal({
  isOpen,
  onClose,
  gameId,
  gameType,
  gameName,
  ladiesMen,
  currentUserRole,
  maxPlayers,
  onPlayersChanged,
}: EnteredPlayersModalProps) {
  const [enteredPlayers, setEnteredPlayers] = useState<EnteredPlayer[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<{ userName: string; fullName: string; memberType?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Check if user is captain or admin (no capacity restrictions)
  const isCaptainOrAdmin = currentUserRole && ['Captain', 'Admin'].includes(currentUserRole);

  useEffect(() => {
    if (isOpen) {
      fetchEnteredPlayers();
      // Only fetch available players for Captain/Admin (they're the only ones who can add)
      if (isCaptainOrAdmin) {
        fetchAvailablePlayers();
      }
    }
  }, [isOpen, gameId, isCaptainOrAdmin]);

  async function fetchEnteredPlayers() {
    try {
      const response = await fetch(`/api/${gameType}/entered-players?gameId=${encodeURIComponent(gameId)}`);
      const data = await response.json();

      if (data.success) {
        setEnteredPlayers(data.players || []);
      } else {
        setError(data.error || 'Failed to load players');
      }
    } catch (err) {
      setError('Failed to load players');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAvailablePlayers() {
    try {
      const response = await fetch(`/api/${gameType}/manage/players`);
      const data = await response.json();

      if (data.players) {
        setAvailablePlayers(data.players);
      }
    } catch (err) {
      console.error('Failed to load available players:', err);
    }
  }

  // Filter available players based on eligibility and not already entered
  const getEligiblePlayers = () => {
    const enteredUserNames = new Set(enteredPlayers.map(p => p.userName));

    return availablePlayers
      .filter(player => {
        // Already entered
        if (enteredUserNames.has(player.userName)) return false;

        // Check gender eligibility (Friendlies/Internal Games only)
        // Member types: PL=Playing Lady, SL=Social Lady, PM=Playing Man, SM=Social Man
        if (ladiesMen && player.memberType) {
          const memberType = player.memberType.toUpperCase();
          if (ladiesMen === 'Men') {
            // Men's games: only PM (Playing Man) or types ending in M
            if (!memberType.endsWith('M') && memberType !== 'FULL') return false;
          }
          if (ladiesMen === 'Ladies') {
            // Ladies' games: only PL (Playing Lady) or types ending in L
            if (!memberType.endsWith('L') && memberType !== 'SOCIAL') return false;
          }
          // Mixed games: allow all playing members (both PL and PM)
        }

        return true;
      })
      .map(player => ({
        value: player.userName,
        label: player.fullName,
      }));
  };

  async function handleAddPlayers() {
    if (selectedPlayers.length === 0) {
      setError('Please select at least one player');
      return;
    }

    // Check capacity for non-captains/admins
    if (!isCaptainOrAdmin && maxPlayers && maxPlayers > 0) {
      const currentCount = enteredPlayers.length;
      const availableSpots = maxPlayers - currentCount;

      if (selectedPlayers.length > availableSpots && availableSpots > 0) {
        setError(`Only ${availableSpots} spot${availableSpots === 1 ? '' : 's'} available. Please select fewer players.`);
        return;
      }
    }

    setAdding(true);
    setError('');

    try {
      const response = await fetch(`/api/${gameType}/add-players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          playerUserNames: selectedPlayers,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh the entered players list
        await fetchEnteredPlayers();
        setShowAddDialog(false);
        setSelectedPlayers([]);
        onPlayersChanged(); // Notify parent to refresh
      } else {
        setError(data.error || 'Failed to add players');
      }
    } catch (err) {
      setError('Failed to add players');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemovePlayer(userName: string) {
    setRemoving(userName);
    setError('');

    try {
      const response = await fetch(`/api/${gameType}/remove-player`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId,
          playerUserName: userName,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Refresh the entered players list
        await fetchEnteredPlayers();
        onPlayersChanged(); // Notify parent to refresh
      } else {
        setError(data.error || 'Failed to remove player');
      }
    } catch (err) {
      setError('Failed to remove player');
    } finally {
      setRemoving(null);
    }
  }

  const handleClose = () => {
    setShowAddDialog(false);
    setSelectedPlayers([]);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Players Entered
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {gameName}
              {maxPlayers != null && maxPlayers > 0 && (
                <span className="ml-2">
                  ({enteredPlayers.length}/{maxPlayers})
                </span>
              )}
            </p>
          </div>

          {/* Action buttons at top */}
          {!loading && (
            <div className="px-6 py-3 border-b border-gray-200 flex justify-between">
              <button
                onClick={showAddDialog ? () => {
                  setShowAddDialog(false);
                  setSelectedPlayers([]);
                  setError('');
                } : handleClose}
                disabled={adding}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              {showAddDialog ? (
                <button
                  onClick={handleAddPlayers}
                  disabled={adding || selectedPlayers.length === 0}
                  className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {adding && (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  Add {selectedPlayers.length} Player{selectedPlayers.length === 1 ? '' : 's'}
                </button>
              ) : isCaptainOrAdmin ? (
                <button
                  onClick={() => setShowAddDialog(true)}
                  className="px-4 py-2 text-white bg-green-600 rounded hover:bg-green-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Players
                </button>
              ) : null}
            </div>
          )}

          {/* Content */}
          <div className={`px-6 py-4 ${showAddDialog ? 'min-h-[400px] overflow-visible' : 'overflow-y-auto'} max-h-[calc(80vh-200px)]`}>
            {/* Error message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                {error}
              </div>
            )}

            {loading ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">Loading players...</p>
              </div>
            ) : enteredPlayers.length === 0 && !showAddDialog ? (
              <div className="text-center py-8 text-gray-600">
                No players entered yet
              </div>
            ) : showAddDialog ? (
              /* Add Players Interface */
              <div className="space-y-4">
                <SearchableSelect
                  options={getEligiblePlayers()}
                  value=""
                  onChange={(value) => {
                    if (value && !selectedPlayers.includes(value)) {
                      setSelectedPlayers([...selectedPlayers, value]);
                    }
                  }}
                  placeholder="Type to search players..."
                  disabled={adding}
                  className="w-full"
                />

                {/* Selected players list */}
                {selectedPlayers.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {selectedPlayers.map(userName => {
                      const player = availablePlayers.find(p => p.userName === userName);
                      return (
                        <div key={userName} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <span>{player?.fullName || userName}</span>
                          <button
                            onClick={() => setSelectedPlayers(selectedPlayers.filter(p => p !== userName))}
                            className="text-red-600 hover:text-red-800"
                            disabled={adding}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Players List */
              <div className="space-y-2">
                {enteredPlayers.map(player => (
                  <div
                    key={player.userName}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-gray-900">{player.fullName}</span>
                    {player.status === 'M' && (
                      <button
                        onClick={() => handleRemovePlayer(player.userName)}
                        disabled={removing === player.userName}
                        className="text-red-600 hover:text-red-800 disabled:opacity-50 flex items-center gap-1"
                        title="Remove player"
                      >
                        {removing === player.userName ? (
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
