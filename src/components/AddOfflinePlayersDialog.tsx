// src/components/AddOfflinePlayersDialog.tsx
// Dialog for adding multiple offline players to a friendly game

'use client';

import { useState } from 'react';
import { SearchableSelect } from './SearchableSelect';

interface PlayerRow {
  id: string;
  userName: string;
}

interface AddOfflinePlayersDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (players: string[]) => Promise<void>;
  availablePlayers: Array<{ userName: string; fullName: string }>;
  existingPlayers: string[]; // List of userNames already in the game
}

export function AddOfflinePlayersDialog({
  isOpen,
  onClose,
  onConfirm,
  availablePlayers,
  existingPlayers,
}: AddOfflinePlayersDialogProps) {
  const [playerRows, setPlayerRows] = useState<PlayerRow[]>([
    { id: crypto.randomUUID(), userName: '' },
  ]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Filter out players already in the game or already selected in dialog
  const getAvailableOptions = (currentRowId: string) => {
    const selectedInDialog = playerRows
      .filter(row => row.id !== currentRowId && row.userName)
      .map(row => row.userName);

    return availablePlayers
      .filter(player =>
        !existingPlayers.includes(player.userName) &&
        !selectedInDialog.includes(player.userName)
      )
      .map(player => ({
        value: player.userName,
        label: player.fullName,
      }));
  };

  // Add a new empty row
  const addRow = () => {
    setPlayerRows([
      ...playerRows,
      { id: crypto.randomUUID(), userName: '' },
    ]);
  };

  // Remove a row
  const removeRow = (id: string) => {
    if (playerRows.length === 1) return; // Keep at least one row
    setPlayerRows(playerRows.filter(row => row.id !== id));
  };

  // Update player selection in a row
  const updateRow = (id: string, userName: string) => {
    setPlayerRows(
      playerRows.map(row => (row.id === id ? { ...row, userName } : row))
    );
  };

  // Handle save
  const handleSave = async () => {
    // Filter out empty rows
    const selectedPlayers = playerRows
      .filter(row => row.userName.trim())
      .map(row => row.userName);

    // Validation
    if (selectedPlayers.length === 0) {
      setError('Please select at least one player');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      await onConfirm(selectedPlayers);
      // Reset dialog state
      setPlayerRows([{ id: crypto.randomUUID(), userName: '' }]);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to add players');
    } finally {
      setIsSaving(false);
    }
  };

  // Handle cancel
  const handleCancel = () => {
    setPlayerRows([{ id: crypto.randomUUID(), userName: '' }]);
    setError('');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={handleCancel}
      />

      {/* Dialog */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Add Offline Players
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Add players who didn't enter online
            </p>
          </div>

          {/* Content */}
          <div className="px-6 py-4 overflow-y-auto max-h-[calc(80vh-160px)]">
            {/* Error message */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">
                {error}
              </div>
            )}

            {/* Player rows */}
            <div className="space-y-3">
              {playerRows.map((row, index) => (
                <div key={row.id} className="flex gap-2 items-center">
                  {/* Row number */}
                  <span className="text-gray-500 font-medium w-8 text-right">
                    {index + 1}.
                  </span>

                  {/* Player dropdown */}
                  <div className="flex-1">
                    <SearchableSelect
                      options={getAvailableOptions(row.id)}
                      value={row.userName}
                      onChange={(value) => updateRow(row.id, value)}
                      placeholder="Type to search players..."
                      disabled={isSaving}
                    />
                  </div>

                  {/* Remove button */}
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    disabled={playerRows.length === 1 || isSaving}
                    className="p-2 text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Remove player"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Add row button */}
            <button
              type="button"
              onClick={addRow}
              disabled={isSaving}
              className="mt-4 w-full py-2 border-2 border-dashed border-gray-300 rounded text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Another Player
            </button>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isSaving}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              )}
              {isSaving ? 'Adding Players...' : 'Add Players'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
