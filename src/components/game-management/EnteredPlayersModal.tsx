// src/components/game-management/EnteredPlayersModal.tsx
// Modal to show who has entered a game and allow adding/removing players
// Used by Friendlies, Internal Games, and Social Events

'use client';

import { useState, useEffect } from 'react';
import { SearchableSelect } from '../SearchableSelect';
import { hasRole } from '@/lib/role-utils';

interface EnteredPlayer {
  userName: string;
  fullName: string;
  status: 'E' | 'M'; // E = self-entered, M = manually added
}

interface EnteredPlayersModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string; // tabName for the game
  pairedGameIds?: string[]; // Additional tabNames for paired games (add players to all)
  gameType: 'friendlies' | 'internal-games' | 'social-events';
  gameName: string; // Display name (club name, game name, or event name)
  ladiesMen?: string; // For gender validation (Friendlies/Internal Games only)
  currentUserRole?: string; // For capacity restrictions
  maxPlayers?: number; // For capacity checking
  onPlayersChanged: () => void; // Callback to refresh parent data
  // Optional props for "add-only" mode (used by manage game pages)
  addOnlyMode?: boolean; // If true, starts in add mode without showing entered players list
  existingPlayerNames?: string[]; // Players already in game (for filtering in add-only mode)
  onAddPlayers?: (playerUserNames: string[]) => Promise<{ success: boolean; message?: string; error?: string }>; // Custom add handler
}

export function EnteredPlayersModal({
  isOpen,
  onClose,
  gameId,
  pairedGameIds,
  gameType,
  gameName,
  ladiesMen,
  currentUserRole,
  maxPlayers,
  onPlayersChanged,
  addOnlyMode = false,
  existingPlayerNames = [],
  onAddPlayers,
}: EnteredPlayersModalProps) {
  const [enteredPlayers, setEnteredPlayers] = useState<EnteredPlayer[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<{ userName: string; fullName: string; memberType?: string }[]>([]);
  const [loading, setLoading] = useState(!addOnlyMode); // Don't show loading in add-only mode
  const [showAddDialog, setShowAddDialog] = useState(addOnlyMode); // Start in add mode if addOnlyMode
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Check if user is captain or admin (no capacity restrictions)
  const isCaptainOrAdmin = hasRole(currentUserRole, 'Captain', 'Admin');

  useEffect(() => {
    if (isOpen) {
      // In add-only mode, just fetch available players
      if (addOnlyMode) {
        setShowAddDialog(true);
        setLoading(false);
        fetchAvailablePlayers();
      } else {
        fetchEnteredPlayers();
        // Fetch available players for all members (everyone can add players now)
        fetchAvailablePlayers();
      }
    }
  }, [isOpen, gameId, addOnlyMode]);

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

  // Build player options for the searchable dropdown.
  // Gender-ineligible players are excluded entirely.
  // Already-entered and already-pending players are shown with strikethrough so the
  // user can see them in search results but cannot select them again.
  const getEligiblePlayers = () => {
    const enteredUserNames = new Set(enteredPlayers.map(p => p.userName));
    const existingNames = new Set(existingPlayerNames.map(n => n.toLowerCase()));
    const pendingUserNames = new Set(selectedPlayers);

    return availablePlayers
      .filter(player => {
        // Completely hide gender-ineligible players
        if (ladiesMen && player.memberType) {
          const mt = player.memberType.toLowerCase();
          if (ladiesMen === 'Ladies' && mt !== 'playing lady') return false;
          if (ladiesMen === 'Men' && mt !== 'playing man') return false;
        }
        return true;
      })
      .map(player => {
        const alreadyEntered =
          enteredUserNames.has(player.userName) ||
          existingNames.has(player.userName.toLowerCase()) ||
          existingNames.has(player.fullName.toLowerCase());
        const alreadyPending = pendingUserNames.has(player.userName);
        const strikethrough = alreadyEntered || alreadyPending;
        return {
          value: player.userName,
          label: player.fullName,
          strikethrough,
        };
      });
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
      // Use custom handler if provided (for add-only mode)
      if (onAddPlayers) {
        const result = await onAddPlayers(selectedPlayers);
        if (result.success) {
          setShowAddDialog(false);
          setSelectedPlayers([]);
          onPlayersChanged();
          onClose(); // Close modal in add-only mode after success
        } else {
          setError(result.error || 'Failed to add players');
        }
      } else {
        // Default behavior: call the standard API endpoint
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
          // For paired games, also add to the partner game(s)
          if (pairedGameIds && pairedGameIds.length > 0) {
            for (const pairedId of pairedGameIds) {
              try {
                await fetch(`/api/${gameType}/add-players`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    gameId: pairedId,
                    playerUserNames: selectedPlayers,
                  }),
                });
              } catch (pairedErr) {
                console.error(`Failed to add players to paired game ${pairedId}:`, pairedErr);
              }
            }
          }

          // Refresh the entered players list
          await fetchEnteredPlayers();
          setShowAddDialog(false);
          setSelectedPlayers([]);
          onPlayersChanged(); // Notify parent to refresh
        } else {
          setError(data.error || 'Failed to add players');
        }
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
        // For paired games, also remove from the partner game(s)
        if (pairedGameIds && pairedGameIds.length > 0) {
          for (const pairedId of pairedGameIds) {
            try {
              await fetch(`/api/${gameType}/remove-player`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  gameId: pairedId,
                  playerUserName: userName,
                }),
              });
            } catch (pairedErr) {
              console.error(`Failed to remove player from paired game ${pairedId}:`, pairedErr);
            }
          }
        }

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
              {showAddDialog ? 'Add Players' : 'Players Entered'}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {gameName}
              {!addOnlyMode && maxPlayers != null && maxPlayers > 0 && (
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
                  // In add-only mode, Cancel closes the modal entirely
                  // In normal mode, Cancel goes back to the players list
                  if (addOnlyMode) {
                    handleClose();
                  } else {
                    setShowAddDialog(false);
                    setSelectedPlayers([]);
                    setError('');
                  }
                } : handleClose}
                disabled={adding}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Close
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
              ) : (
                <button
                  onClick={() => setShowAddDialog(true)}
                  className="px-4 py-2 text-white bg-green-600 rounded hover:bg-green-700 transition-colors flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Players
                </button>
              )}
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
                  autoFocus={true}
                  keepFocusOnSelect={true}
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
                    {(player.status === 'M' || player.status === 'E') && (
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
