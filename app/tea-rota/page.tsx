// app/tea-rota/page.tsx
// Tea Rota page - displays tea duty assignments for home games
// Members can view and swap their duties
// Committee members can edit all assignments

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';
import { TeaRotaEntry } from '@/lib/types/friendlies';
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
  time: string;
  clubName: string;
  position: 'teaLead' | 'teaFirst' | 'teaSecond';
  positionLabel: string;
}

interface SwapModalState {
  isOpen: boolean;
  entry: TeaRotaEntry | null;
  position: 'teaLead' | 'teaFirst' | 'teaSecond' | null;
  currentUsername: string;
}

interface EditedAssignments {
  [rowNumber: number]: {
    teaLead: string;
    teaFirst: string;
    teaSecond: string;
  };
}

export default function TeaRotaPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';

  const [entries, setEntries] = useState<TeaRotaEntry[]>([]);
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
      const response = await fetch('/api/tea-rota');
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Failed to load tea rota');
        return;
      }
      setEntries(data.entries || []);
      setCurrentUsername(data.currentUser || '');
    } catch (err) {
      console.error('Failed to fetch tea rota:', err);
      setError('Failed to load tea rota');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchMembers(); // Fetch members for display names
  }, [fetchEntries, fetchMembers]);

  // Auto-save draft when editing
  useEffect(() => {
    if (isEditing && session?.user?.userName && Object.keys(editedAssignments).length > 0) {
      saveDraft('TeaRota', session.user.userName, { editedAssignments });
    }
  }, [editedAssignments, isEditing, session?.user?.userName]);

  // Restore draft on page load
  useEffect(() => {
    if (session?.user?.userName && entries.length > 0 && !isEditing) {
      const draft = restoreDraft<{ editedAssignments: EditedAssignments }>(
        'TeaRota',
        session.user.userName
      );
      if (draft && Object.keys(draft.editedAssignments).length > 0) {
        // Fetch members for the searchable select
        fetchMembers().then(() => {
          setEditedAssignments(draft.editedAssignments);
          setIsEditing(true);
        });
      }
    }
  }, [session?.user?.userName, entries.length, fetchMembers]);

  // Start editing — played and cancelled games are excluded from edit mode
  async function startEditing() {
    // Fetch members for the searchable select
    await fetchMembers();

    const initial: EditedAssignments = {};
    entries.forEach(entry => {
      if (entry.status === 'C' || entry.status === 'P') return;
      initial[entry.rowNumber] = {
        teaLead: entry.teaLead,
        teaFirst: entry.teaFirst,
        teaSecond: entry.teaSecond,
      };
    });
    setEditedAssignments(initial);
    setIsEditing(true);
  }

  // Cancel editing
  function cancelEditing() {
    setIsEditing(false);
    setEditedAssignments({});
    clearDraft('TeaRota', session?.user?.userName || '');
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
            original.teaLead !== edited.teaLead ||
            original.teaFirst !== edited.teaFirst ||
            original.teaSecond !== edited.teaSecond
          );
        })
        .map(([rowNum, edited]) => ({
          rowNumber: parseInt(rowNum),
          teaLead: edited.teaLead,
          teaFirst: edited.teaFirst,
          teaSecond: edited.teaSecond,
        }));

      // Batch update all modified rows in a single API call
      if (modifiedRows.length > 0) {
        const response = await fetch('/api/tea-rota/batch', {
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
      clearDraft('TeaRota', session?.user?.userName || '');
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
  function openSwapModal(entry: TeaRotaEntry, position: 'teaLead' | 'teaFirst' | 'teaSecond') {
    setSwapModal({
      isOpen: true,
      entry,
      position,
      currentUsername: entry[position],
    });
    setSwapUsername('');
    setSwapError(null);
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
      const response = await fetch(`/api/tea-rota/assignments/${encodeURIComponent(userName)}`);
      const data = await response.json();

      if (!response.ok) {
        setSwapError(data.error || 'Failed to fetch assignments');
        return;
      }

      if (data.assignments.length === 0) {
        // User has no assignments - can still proceed (they'll get the duty, we lose ours)
        setTargetAssignments([]);
        setSelectedTargetIndex(null);
      } else if (data.assignments.length === 1) {
        // Only one assignment - auto-select it
        setTargetAssignments(data.assignments);
        setSelectedTargetIndex(0);
      } else {
        // Multiple assignments - user must choose
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

    // If user has multiple assignments, they must select one
    if (targetAssignments.length > 1 && selectedTargetIndex === null) {
      setSwapError('Please select which assignment to swap with');
      return;
    }

    setSwapping(true);
    setSwapError(null);

    try {
      // Build the request body
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

      // If a target assignment is selected, include it
      if (selectedTargetIndex !== null && targetAssignments[selectedTargetIndex]) {
        const target = targetAssignments[selectedTargetIndex];
        requestBody.targetRowNumber = target.rowNumber;
        requestBody.targetPosition = target.position;
      }

      const response = await fetch('/api/tea-rota/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        setSwapError(data.error || 'Failed to swap');
        return;
      }

      // Refresh entries and close modal
      await fetchEntries();
      closeSwapModal();
    } catch (err) {
      console.error('Failed to swap:', err);
      setSwapError('Failed to swap tea duty');
    } finally {
      setSwapping(false);
    }
  }

  // Get display value for tea assignment
  function getDisplayValue(entry: TeaRotaEntry, position: 'teaLead' | 'teaFirst' | 'teaSecond'): string {
    if (isEditing) {
      return editedAssignments[entry.rowNumber]?.[position] || '';
    }
    return entry[position] || '';
  }

  // Check if current user is assigned to this position
  function isCurrentUserAssigned(entry: TeaRotaEntry, position: 'teaLead' | 'teaFirst' | 'teaSecond'): boolean {
    return !!currentUsername && entry[position] === currentUsername;
  }

  // Check if entry has any of current user's assignments
  function hasUserAssignment(entry: TeaRotaEntry): boolean {
    return !!currentUsername && (
      entry.teaLead === currentUsername ||
      entry.teaFirst === currentUsername ||
      entry.teaSecond === currentUsername
    );
  }

  // Position display names
  const positionNames: Record<string, string> = {
    teaLead: 'Tea Lead',
    teaFirst: 'Tea First',
    teaSecond: 'Tea Second',
  };

  // Get member full name from username (for display in view mode)
  function getMemberDisplayName(userName: string): string {
    if (!userName) return '';
    const member = members.find(m => m.value === userName);
    return member?.label || userName;
  }

  // Build navbar action buttons - only when editing
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
        actionButtons={isGuest ? undefined : getNavbarActionButtons()}
        showLogoOnly={isGuest}
      />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 print:mb-4">
          <div>
            <h1 className="text-3xl font-bold print:text-2xl text-gray-900">Tea Rota</h1>
            <p className="text-gray-600 mt-1 print:text-sm">Tea duty assignments for home games</p>
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
            <p className="mt-2 text-gray-600">Loading tea rota...</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-600">No home games found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4 print:hidden">
              Showing {entries.length} home game{entries.length !== 1 ? 's' : ''}
              {currentUsername && (
                <span className="ml-2">
                  (Your assignments are <span className="bg-yellow-100 px-1 rounded">highlighted</span>)
                </span>
              )}
            </p>

            {/* Desktop table view */}
            <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden print:block print:shadow-none print:overflow-visible">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 print:bg-gray-100">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Opponent
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Format
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Tea Lead
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Tea First
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                      Tea Second
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {entries.map((entry) => {
                    const isLocked = entry.status === 'C' || entry.status === 'P';
                    const statusBadge = entry.status === 'C'
                      ? { label: 'Cancelled', cls: 'text-red-600 bg-red-50 border-red-200' }
                      : entry.status === 'P'
                      ? { label: 'Played', cls: 'text-green-700 bg-green-50 border-green-200' }
                      : null;
                    return (
                    <tr
                      key={entry.rowNumber}
                      className={
                        isLocked
                          ? 'bg-gray-50 opacity-60'
                          : hasUserAssignment(entry) ? 'bg-yellow-50' : 'hover:bg-gray-50'
                      }
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          {entry.displayDate}
                          {statusBadge && (
                            <span className={`text-xs font-medium border px-1.5 py-0.5 rounded ${statusBadge.cls}`}>
                              {statusBadge.label}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {entry.time}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {entry.clubName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {entry.format}
                      </td>
                      {(['teaLead', 'teaFirst', 'teaSecond'] as const).map((position) => (
                        <td
                          key={position}
                          className={`px-4 py-3 text-sm ${
                            !isLocked && isCurrentUserAssigned(entry, position) ? 'bg-yellow-100 font-medium' : ''
                          }`}
                        >
                          {isEditing && !isLocked ? (
                            <>
                              <SearchableSelect
                                options={members}
                                value={getDisplayValue(entry, position)}
                                onChange={(value) => updateAssignment(entry.rowNumber, position, value)}
                                placeholder="Search member..."
                                className="min-w-[140px] print:hidden"
                              />
                              <span className="hidden print:inline">
                                {getMemberDisplayName(getDisplayValue(entry, position))}
                              </span>
                            </>
                          ) : (
                            <div className="flex items-center gap-1 whitespace-nowrap">
                              <span>{getMemberDisplayName(entry[position]) || '-'}</span>
                              {!isLocked && isCurrentUserAssigned(entry, position) && !isEditing && !isKiosk && (
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
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card view */}
            <div className="md:hidden space-y-4 print:hidden">
              {entries.map((entry) => {
                const isLocked = entry.status === 'C' || entry.status === 'P';
                const statusBadge = entry.status === 'C'
                  ? { label: 'Cancelled', cls: 'text-red-600 bg-red-50 border-red-200' }
                  : entry.status === 'P'
                  ? { label: 'Played', cls: 'text-green-700 bg-green-50 border-green-200' }
                  : null;
                return (
                <div
                  key={entry.rowNumber}
                  className={`bg-white rounded-lg shadow p-4 ${
                    isLocked
                      ? 'border border-gray-200 opacity-60'
                      : hasUserAssignment(entry) ? 'border-2 border-yellow-300' : 'border border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-lg text-gray-900">{entry.displayDate}</div>
                        {statusBadge && (
                          <span className={`text-xs font-medium border px-1.5 py-0.5 rounded ${statusBadge.cls}`}>
                            {statusBadge.label}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-900">{entry.time}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-blue-600">{entry.clubName}</div>
                      <div className="text-xs text-gray-900">{entry.format}</div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-gray-200 pt-3">
                    {(['teaLead', 'teaFirst', 'teaSecond'] as const).map((position) => (
                      <div
                        key={position}
                        className={`flex justify-between items-center ${
                          !isLocked && isCurrentUserAssigned(entry, position) ? 'bg-yellow-100 -mx-2 px-2 py-1 rounded' : ''
                        }`}
                      >
                        <span className="text-gray-500 text-sm">{positionNames[position]}:</span>
                        {isEditing && !isLocked ? (
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
                            {!isLocked && isCurrentUserAssigned(entry, position) && !isKiosk && (
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
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Swap Modal */}
      <ConfirmDialog
        isOpen={swapModal.isOpen}
        title="Swap Tea Duty"
        message={
          swapModal.entry
            ? `Swap your ${positionNames[swapModal.position || 'teaLead']} duty for ${swapModal.entry.displayDate} (${swapModal.entry.clubName}) with another member.`
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
                      <div className="font-medium">{assignment.displayDate} - {assignment.clubName}</div>
                      <div className="text-gray-500">{assignment.positionLabel} @ {assignment.time}</div>
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
                {targetAssignments[0].displayDate} - {targetAssignments[0].clubName}
                <br />
                {targetAssignments[0].positionLabel} @ {targetAssignments[0].time}
              </div>
            </div>
          )}

          {/* No assignments message */}
          {!loadingAssignments && swapUsername && targetAssignments.length === 0 && (
            <div className="text-sm bg-yellow-50 p-3 rounded-lg text-yellow-800">
              This member has no tea assignments. They will take your duty, and you will have no tea duty.
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
