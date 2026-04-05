// app/cleaning-rota/page.tsx
// Cleaning Rota page - displays cleaning duty assignments for Saturday mornings
// Members can view and swap their duties
// Committee members can edit all assignments

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';
import { CleaningRotaEntry, CleaningPosition } from '@/lib/types/cleaning';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchableSelect } from '@/components/SearchableSelect';

interface MemberOption {
  value: string;  // userName
  label: string;  // fullName
}

interface TargetAssignment {
  rowNumber: number;
  displayDate: string;
  position: CleaningPosition;
  positionLabel: string;
}

interface SwapModalState {
  isOpen: boolean;
  entry: CleaningRotaEntry | null;
  position: CleaningPosition | null;
  currentUsername: string;
}

interface EditedAssignments {
  [rowNumber: number]: {
    lead: string;
    second: string;
    third: string;
    fourth: string;
  };
}

export default function CleaningRotaPage() {
  const { data: session } = useSession();

  const [entries, setEntries] = useState<CleaningRotaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string>('');

  // Edit mode states (for committee)
  const [isEditing, setIsEditing] = useState(false);
  const [editedAssignments, setEditedAssignments] = useState<EditedAssignments>({});
  const [saving, setSaving] = useState(false);

  // Members list for searchable select
  const [members, setMembers] = useState<MemberOption[]>([]);

  // Swap modal state
  const [swapModal, setSwapModal] = useState<SwapModalState>({
    isOpen: false,
    entry: null,
    position: null,
    currentUsername: '',
  });
  const [swapUsername, setSwapUsername] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Target assignment selection (when other user has multiple assignments)
  const [targetAssignments, setTargetAssignments] = useState<TargetAssignment[]>([]);
  const [selectedTargetIndex, setSelectedTargetIndex] = useState<number | null>(null);
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  // Check if user can edit (committee = non-Member)
  const userRole = session?.user?.role || 'Member';
  const canEdit = userRole !== 'Member' && userRole !== '' && userRole !== 'Kiosk';
  const isKiosk = userRole === 'Kiosk';

  // Fetch members for searchable select
  const fetchMembers = useCallback(async () => {
    try {
      const response = await fetch('/api/members/lookup');
      const data = await response.json();
      if (data.members) {
        const options: MemberOption[] = data.members.map((m: { fullName: string; userName: string }) => ({
          value: m.userName,
          label: m.fullName,
        }));
        // Add empty option at the start
        options.unshift({ value: '', label: '(None)' });
        setMembers(options);
      }
    } catch (err) {
      console.error('Failed to fetch members:', err);
    }
  }, []);

  // Fetch entries
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/cleaning-rota');
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to load cleaning rota');
        return;
      }
      setEntries(data.entries || []);
      setCurrentUsername(data.currentUser || '');
    } catch (err) {
      console.error('Failed to fetch cleaning rota:', err);
      setError('Failed to load cleaning rota');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchMembers();
  }, [fetchEntries, fetchMembers]);

  // Auto-save draft when editing
  useEffect(() => {
    if (isEditing && session?.user?.userName && Object.keys(editedAssignments).length > 0) {
      saveDraft('CleaningRota', session.user.userName, { editedAssignments });
    }
  }, [editedAssignments, isEditing, session?.user?.userName]);

  // Restore draft on page load
  useEffect(() => {
    if (session?.user?.userName && entries.length > 0 && !isEditing) {
      const draft = restoreDraft<{ editedAssignments: EditedAssignments }>(
        'CleaningRota',
        session.user.userName
      );
      if (draft && Object.keys(draft.editedAssignments).length > 0) {
        fetchMembers().then(() => {
          setEditedAssignments(draft.editedAssignments);
          setIsEditing(true);
        });
      }
    }
  }, [session?.user?.userName, entries.length, fetchMembers, isEditing]);

  // Start editing
  async function startEditing() {
    await fetchMembers();

    const initial: EditedAssignments = {};
    entries.forEach(entry => {
      initial[entry.rowNumber] = {
        lead: entry.lead,
        second: entry.second,
        third: entry.third,
        fourth: entry.fourth,
      };
    });
    setEditedAssignments(initial);
    setIsEditing(true);
  }

  // Cancel editing
  function cancelEditing() {
    setIsEditing(false);
    setEditedAssignments({});
    clearDraft('CleaningRota', session?.user?.userName || '');
  }

  // Save all changes
  async function saveChanges() {
    setSaving(true);
    try {
      // Collect all modified rows
      const modifiedRows = Object.entries(editedAssignments)
        .filter(([rowNum, edited]) => {
          const original = entries.find(e => e.rowNumber === parseInt(rowNum));
          if (!original) return false;
          return (
            original.lead !== edited.lead ||
            original.second !== edited.second ||
            original.third !== edited.third ||
            original.fourth !== edited.fourth
          );
        })
        .map(([rowNum, edited]) => ({
          rowNumber: parseInt(rowNum),
          lead: edited.lead,
          second: edited.second,
          third: edited.third,
          fourth: edited.fourth,
        }));

      // Batch update all modified rows in a single API call
      if (modifiedRows.length > 0) {
        const response = await fetch('/api/cleaning-rota/batch', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: modifiedRows }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save changes');
        }
      }

      // Clear draft and refresh
      clearDraft('CleaningRota', session?.user?.userName || '');
      setIsEditing(false);
      setEditedAssignments({});
      await fetchEntries();
    } catch (err) {
      console.error('Failed to save changes:', err);
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  // Update edited assignment
  function updateAssignment(rowNumber: number, field: keyof EditedAssignments[number], value: string) {
    setEditedAssignments(prev => ({
      ...prev,
      [rowNumber]: {
        ...prev[rowNumber],
        [field]: value,
      },
    }));
  }

  // Open swap modal
  function openSwapModal(entry: CleaningRotaEntry, position: CleaningPosition) {
    setSwapModal({
      isOpen: true,
      entry,
      position,
      currentUsername: entry[position],
    });
    setSwapUsername('');
    setSwapError(null);
    setTargetAssignments([]);
    setSelectedTargetIndex(null);
  }

  // Close swap modal
  function closeSwapModal() {
    setSwapModal({
      isOpen: false,
      entry: null,
      position: null,
      currentUsername: '',
    });
    setSwapUsername('');
    setSwapError(null);
    setTargetAssignments([]);
    setSelectedTargetIndex(null);
  }

  // Fetch assignments for the selected user
  async function fetchUserAssignments(userName: string) {
    setLoadingAssignments(true);
    setSwapError(null);
    setTargetAssignments([]);
    setSelectedTargetIndex(null);

    try {
      const response = await fetch(`/api/cleaning-rota/assignments/${encodeURIComponent(userName)}`);
      const data = await response.json();

      if (!response.ok) {
        setSwapError(data.error || 'Failed to fetch assignments');
        return;
      }

      if (data.assignments.length === 0) {
        setTargetAssignments([]);
        setSelectedTargetIndex(null);
      } else if (data.assignments.length === 1) {
        setTargetAssignments(data.assignments);
        setSelectedTargetIndex(0);
      } else {
        setTargetAssignments(data.assignments);
        setSelectedTargetIndex(null);
      }
    } catch (err) {
      console.error('Failed to fetch assignments:', err);
      setSwapError('Failed to fetch assignments');
    } finally {
      setLoadingAssignments(false);
    }
  }

  // Handle member selection change
  function handleMemberSelect(userName: string) {
    setSwapUsername(userName);
    if (userName) {
      fetchUserAssignments(userName);
    } else {
      setTargetAssignments([]);
      setSelectedTargetIndex(null);
    }
  }

  // Perform swap
  async function performSwap() {
    if (!swapModal.entry || !swapModal.position || !swapUsername) {
      setSwapError('Please select a member');
      return;
    }

    if (targetAssignments.length > 1 && selectedTargetIndex === null) {
      setSwapError('Please select which assignment to swap with');
      return;
    }

    setSwapping(true);
    setSwapError(null);

    try {
      const requestBody: {
        rowNumber: number;
        position: string;
        newUsername: string;
        targetRowNumber?: number;
        targetPosition?: string;
      } = {
        rowNumber: swapModal.entry.rowNumber,
        position: swapModal.position,
        newUsername: swapUsername,
      };

      if (selectedTargetIndex !== null && targetAssignments[selectedTargetIndex]) {
        const target = targetAssignments[selectedTargetIndex];
        requestBody.targetRowNumber = target.rowNumber;
        requestBody.targetPosition = target.position;
      }

      const response = await fetch('/api/cleaning-rota/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        setSwapError(data.error || 'Failed to swap');
        return;
      }

      await fetchEntries();
      closeSwapModal();
    } catch (err) {
      console.error('Failed to swap:', err);
      setSwapError('Failed to swap cleaning duty');
    } finally {
      setSwapping(false);
    }
  }

  // Get display value for cleaning assignment
  function getDisplayValue(entry: CleaningRotaEntry, position: CleaningPosition): string {
    if (isEditing) {
      return editedAssignments[entry.rowNumber]?.[position] || '';
    }
    return entry[position] || '';
  }

  // Check if current user is assigned to this position
  function isCurrentUserAssigned(entry: CleaningRotaEntry, position: CleaningPosition): boolean {
    return entry[position] === currentUsername;
  }

  // Check if entry has any of current user's assignments
  function hasUserAssignment(entry: CleaningRotaEntry): boolean {
    return (
      entry.lead === currentUsername ||
      entry.second === currentUsername ||
      entry.third === currentUsername ||
      entry.fourth === currentUsername
    );
  }

  // Position display names
  const positionNames: Record<CleaningPosition, string> = {
    lead: 'Lead',
    second: 'Second',
    third: 'Third',
    fourth: 'Fourth',
  };

  // Get member full name from username
  function getMemberDisplayName(userName: string): string {
    if (!userName) return '';
    const member = members.find(m => m.value === userName);
    return member?.label || userName;
  }

  // Build navbar action buttons
  const getNavbarActionButtons = () => {
    if (!isEditing) return undefined;

    return {
      primary: {
        label: 'Save',
        onClick: saveChanges,
        loading: saving,
      },
      secondary: {
        label: 'Cancel',
        onClick: cancelEditing,
        disabled: saving,
      },
    };
  };

  // Print handler
  function handlePrint() {
    window.print();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={getNavbarActionButtons()}
      />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 print:mb-4">
          <div>
            <h1 className="text-3xl font-bold print:text-2xl text-gray-900">Cleaning Rota</h1>
            <p className="text-gray-600 mt-1 print:text-sm">Saturday morning cleaning duties (before 10:00)</p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={handlePrint}
              className={getButtonClasses('secondary', 'md')}
            >
              Print
            </button>
            {canEdit && !isEditing && (
              <button
                onClick={startEditing}
                className={getButtonClasses('primary', 'md')}
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading cleaning rota...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600">No cleaning rota entries found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4 print:hidden">
              Showing {entries.length} cleaning session{entries.length !== 1 ? 's' : ''}
              {currentUsername && (
                <span className="ml-2">
                  (Your assignments are <span className="bg-yellow-100 px-1 rounded">highlighted</span>)
                </span>
              )}
            </p>

            {/* Desktop table view */}
            <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden print:block print:shadow-none">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 print:bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Lead
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Second
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Third
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Fourth
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {entries.map((entry) => (
                    <tr
                      key={entry.rowNumber}
                      className={hasUserAssignment(entry) ? 'bg-yellow-50' : 'hover:bg-gray-50'}
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {entry.displayDate}
                      </td>
                      {(['lead', 'second', 'third', 'fourth'] as const).map((position) => (
                        <td
                          key={position}
                          className={`px-4 py-3 text-sm ${
                            isCurrentUserAssigned(entry, position) ? 'bg-yellow-100 font-medium' : ''
                          }`}
                        >
                          {isEditing ? (
                            <SearchableSelect
                              options={members}
                              value={getDisplayValue(entry, position)}
                              onChange={(value) => updateAssignment(entry.rowNumber, position, value)}
                              placeholder="Search member..."
                              className="min-w-[140px]"
                            />
                          ) : (
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              <span>{getMemberDisplayName(entry[position]) || '-'}</span>
                              {isCurrentUserAssigned(entry, position) && !isEditing && !isKiosk && (
                                <button
                                  onClick={() => openSwapModal(entry, position)}
                                  className="ml-2 text-blue-600 hover:text-blue-800 text-xs underline print:hidden"
                                  title="Swap with another member"
                                >
                                  Swap
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-4 print:hidden">
              {entries.map((entry) => (
                <div
                  key={entry.rowNumber}
                  className={`bg-white rounded-lg shadow p-4 ${
                    hasUserAssignment(entry) ? 'border-2 border-yellow-300' : 'border border-gray-200'
                  }`}
                >
                  <div className="font-bold text-lg text-gray-900 mb-3">{entry.displayDate}</div>

                  <div className="space-y-2 border-t border-gray-200 pt-3">
                    {(['lead', 'second', 'third', 'fourth'] as const).map((position) => (
                      <div
                        key={position}
                        className={`flex justify-between items-center ${
                          isCurrentUserAssigned(entry, position) ? 'bg-yellow-100 -mx-2 px-2 py-1 rounded' : ''
                        }`}
                      >
                        <span className="text-gray-500 text-sm">{positionNames[position]}:</span>
                        {isEditing ? (
                          <SearchableSelect
                            options={members}
                            value={getDisplayValue(entry, position)}
                            onChange={(value) => updateAssignment(entry.rowNumber, position, value)}
                            placeholder="Search..."
                            className="w-40"
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-gray-900 font-medium">{getMemberDisplayName(entry[position]) || '-'}</span>
                            {isCurrentUserAssigned(entry, position) && !isKiosk && (
                              <button
                                onClick={() => openSwapModal(entry, position)}
                                className="text-blue-600 hover:text-blue-800 text-xs underline"
                              >
                                Swap
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Swap Modal */}
      <ConfirmDialog
        isOpen={swapModal.isOpen}
        title="Swap Cleaning Duty"
        message={
          swapModal.entry
            ? `Swap your ${positionNames[swapModal.position || 'lead']} duty for ${swapModal.entry.displayDate} with another member.`
            : ''
        }
        confirmLabel={swapping ? 'Swapping...' : 'Swap'}
        onConfirm={performSwap}
        onCancel={closeSwapModal}
        confirmDisabled={!swapUsername || swapping || loadingAssignments || (targetAssignments.length > 1 && selectedTargetIndex === null)}
      >
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select member to swap with:
            </label>
            <SearchableSelect
              options={members.filter(m => m.value !== '' && m.value !== currentUsername)}
              value={swapUsername}
              onChange={handleMemberSelect}
              placeholder="Search by name..."
            />
          </div>

          {/* Loading assignments */}
          {loadingAssignments && (
            <div className="flex items-center text-sm text-gray-500">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
              Checking assignments...
            </div>
          )}

          {/* Show target assignment selection if user has multiple */}
          {!loadingAssignments && targetAssignments.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select which of their assignments to swap with:
              </label>
              <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {targetAssignments.map((assignment, index) => (
                  <label
                    key={`${assignment.rowNumber}-${assignment.position}`}
                    className={`flex items-center p-2 rounded cursor-pointer ${
                      selectedTargetIndex === index ? 'bg-blue-50 border border-blue-300' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="targetAssignment"
                      checked={selectedTargetIndex === index}
                      onChange={() => setSelectedTargetIndex(index)}
                      className="mr-3"
                    />
                    <div className="text-sm">
                      <div className="font-medium">{assignment.displayDate}</div>
                      <div className="text-gray-500">{assignment.positionLabel}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Show single assignment info */}
          {!loadingAssignments && targetAssignments.length === 1 && (
            <div className="text-sm bg-gray-50 p-3 rounded-lg">
              <div className="font-medium text-gray-700">Swapping with their assignment:</div>
              <div className="text-gray-600 mt-1">
                {targetAssignments[0].displayDate} - {targetAssignments[0].positionLabel}
              </div>
            </div>
          )}

          {/* No assignments message */}
          {!loadingAssignments && swapUsername && targetAssignments.length === 0 && (
            <div className="text-sm bg-yellow-50 p-3 rounded-lg text-yellow-800">
              This member has no cleaning assignments. They will take your duty, and you will have no cleaning duty.
            </div>
          )}

          {swapError && (
            <p className="text-sm text-red-600">{swapError}</p>
          )}

          <p className="text-xs text-gray-500">
            An email notification will be sent to the other member.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
