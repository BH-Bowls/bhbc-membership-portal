// app/member-suggestions/[id]/page.tsx
// Member Suggestion Detail/Edit Page
// View and edit suggestion with role-based permissions

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchableSelect } from '@/components/SearchableSelect';
import type { MemberSuggestion } from '@/types/suggestions';
import { getSuggestionStatus, getStatusLabel, getStatusColor } from '@/types/suggestions';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';

// ============================================================================
// Main Component
// ============================================================================

export default function SuggestionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session } = useSession();
  const router = useRouter();

  // Unwrap params (Next.js 15+)
  const [suggestionId, setSuggestionId] = React.useState<string>('');

  React.useEffect(() => {
    params.then((p) => setSuggestionId(p.id));
  }, [params]);

  // State: Suggestion data (original from server)
  const [suggestion, setSuggestion] = useState<MemberSuggestion | null>(null);

  // State: Edited suggestion (work in progress)
  const [editedSuggestion, setEditedSuggestion] = useState<MemberSuggestion | null>(null);

  // State: Edit mode toggle
  const [isEditing, setIsEditing] = useState(false);

  // State: Saving indicator
  const [isSaving, setIsSaving] = useState(false);

  // State: Loading indicator
  const [loading, setLoading] = useState(true);

  // State: Permissions
  const [canEdit, setCanEdit] = useState(false);
  const [canEditAdminFields, setCanEditAdminFields] = useState(false);
  const [isCommittee, setIsCommittee] = useState(false);

  // State: Committee members for coordinator dropdown
  const [committeeMembers, setCommitteeMembers] = useState<Array<{ userName: string; fullName: string }>>([]);

  // State: Success/error messages
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  // Helper: Current suggestion (edited or saved)
  const current = isEditing ? editedSuggestion : suggestion;

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch suggestion on mount
   */
  useEffect(() => {
    if (suggestionId) {
      fetchSuggestion();
    }
  }, [suggestionId]);

  /**
   * Effect: Auto-save drafts when editing
   * Uses suggestion-specific key so multiple suggestions can have drafts
   */
  useEffect(() => {
    if (!suggestion || !session?.user?.userName || !isEditing || !suggestionId) return;

    const hasChanges = JSON.stringify(editedSuggestion) !== JSON.stringify(suggestion);

    if (hasChanges) {
      // Use suggestion-specific draft key
      saveDraft(`MemberSuggestion-${suggestionId}`, session.user.userName, editedSuggestion);
    }
  }, [editedSuggestion, suggestion, isEditing, session?.user?.userName, suggestionId]);

  /**
   * Effect: Clear edit state on user change
   */
  useEffect(() => {
    setIsEditing(false);
    setEditedSuggestion(null);
  }, [session?.user?.userName]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch suggestion from API
   */
  async function fetchSuggestion() {
    if (!suggestionId) return;

    setLoading(true);

    try {
      const response = await fetch(`/api/suggestions/${suggestionId}`);
      const data = await response.json();

      if (response.ok) {
        setSuggestion(data.suggestion);
        setCanEdit(data.canEdit);
        setCanEditAdminFields(data.canEditAdminFields);
        setIsCommittee(data.isCommittee);
        setCommitteeMembers(data.committeeMembers || []);

        // Restore draft if exists (using suggestion-specific key)
        if (session?.user?.userName && suggestionId) {
          const draft = restoreDraft<MemberSuggestion>(`MemberSuggestion-${suggestionId}`, session.user.userName);
          if (draft && draft.suggestionId === data.suggestion.suggestionId) {
            setEditedSuggestion(draft);
            setIsEditing(true);
          }
        }
      } else {
        alert(data.error || 'Failed to load suggestion');
        router.push('/member-suggestions');
      }
    } catch (error) {
      console.error('Error fetching suggestion:', error);
      alert('Failed to load suggestion');
      router.push('/member-suggestions');
    } finally {
      setLoading(false);
    }
  }

  /**
   * Save suggestion changes
   */
  async function saveSuggestion() {
    if (!editedSuggestion || !suggestionId) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/suggestions/${suggestionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSuggestion),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Suggestion updated successfully' });
        setIsEditing(false);
        setSuggestion(editedSuggestion);
        setEditedSuggestion(null);

        // Clear draft (using suggestion-specific key)
        if (session?.user?.userName && suggestionId) {
          clearDraft(`MemberSuggestion-${suggestionId}`, session.user.userName);
        }

        // Refresh data
        await fetchSuggestion();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update suggestion' });
      }
    } catch (error) {
      console.error('Error saving suggestion:', error);
      setMessage({ type: 'error', text: 'Failed to save changes' });
    } finally {
      setIsSaving(false);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle Edit button click
   */
  function handleEdit() {
    if (!suggestion) return;
    setEditedSuggestion({ ...suggestion });
    setIsEditing(true);
    setMessage(null);
  }

  /**
   * Handle Cancel button click
   */
  function handleCancel() {
    setConfirmDialog({
      isOpen: true,
      title: 'Discard Changes',
      message: 'Are you sure you want to discard your changes?',
      onConfirm: () => {
        setIsEditing(false);
        setEditedSuggestion(null);
        setMessage(null);
        if (session?.user?.userName && suggestionId) {
          clearDraft(`MemberSuggestion-${suggestionId}`, session.user.userName);
        }
        setConfirmDialog({ ...confirmDialog, isOpen: false });
      },
    });
  }

  /**
   * Handle field change
   */
  function handleChange(field: keyof MemberSuggestion, value: any) {
    if (!editedSuggestion) return;
    setEditedSuggestion({ ...editedSuggestion, [field]: value });
  }

  /**
   * Handle coordinator selection
   */
  function handleCoordinatorChange(userName: string) {
    if (!editedSuggestion) return;

    const member = committeeMembers.find((m) => m.userName === userName);

    setEditedSuggestion({
      ...editedSuggestion,
      coordinatorUsername: userName || null,
      coordinatorFullName: member?.fullName || null,
    });
  }

  /**
   * Handle back button
   */
  function handleBack() {
    router.push('/member-suggestions');
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Format date for display
   */
  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB');
    } catch {
      return dateStr;
    }
  };

  /**
   * Format date for input field (YYYY-MM-DD)
   */
  const formatDateForInput = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toISOString().split('T')[0];
    } catch {
      return '';
    }
  };

  // ============================================================================
  // Render UI
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading suggestion...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <p className="text-gray-600">Suggestion not found</p>
          </div>
        </div>
      </div>
    );
  }

  const status = getSuggestionStatus(current);
  const statusLabel = getStatusLabel(status);
  const statusColor = getStatusColor(status);

  const isFormDisabled = !isEditing || isSaving;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar with action buttons */}
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={
          canEdit && isEditing
            ? {
                primary: {
                  label: 'Save',
                  onClick: saveSuggestion,
                  loading: isSaving,
                  variant: 'primary' as const,
                },
                secondary: {
                  label: 'Cancel',
                  onClick: handleCancel,
                  disabled: isSaving,
                  variant: 'secondary' as const,
                },
              }
            : undefined
        }
      />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          ← Back to Suggestions
        </button>

        {/* Success/Error messages */}
        {message && (
          <div
            className={`mb-4 p-4 rounded-md ${
              message.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Page header */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-2xl font-bold mb-2">{current.title}</h1>
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span className="font-mono">{current.suggestionId}</span>
                <span>•</span>
                <span>{formatDate(current.createdAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-block px-3 py-1 text-sm font-semibold text-white rounded ${statusColor}`}>
                {statusLabel}
              </span>
              {canEdit && !isEditing && (
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                >
                  Edit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Public Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">Suggestion Details</h2>

          <div className="space-y-4">
            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <div className="text-gray-900 whitespace-pre-wrap">{current.description}</div>
            </div>

            {/* Reason for Improvement */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason Why This Would Improve the Club
              </label>
              <div className="text-gray-900 whitespace-pre-wrap">{current.reasonForImprovement}</div>
            </div>

            {/* Created By */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Created By
              </label>
              <div className="text-gray-900">{current.createdByFullName}</div>
            </div>
          </div>
        </div>

        {/* Admin Section (Committee + Coordinator) */}
        {(canEdit || current.committeeAcceptance === 'Yes') && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Committee Review</h2>

            <div className="space-y-4">
              {/* Committee Acceptance */}
              {(canEditAdminFields || current.committeeAcceptance) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Committee Acceptance
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <select
                        value={current.committeeAcceptance || ''}
                        onChange={(e) => handleChange('committeeAcceptance', e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Not Reviewed</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : (
                      <div className="text-gray-900">{current.committeeAcceptance || '-'}</div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Date Received
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <input
                        type="date"
                        value={formatDateForInput(current.dateReceived)}
                        onChange={(e) => handleChange('dateReceived', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    ) : (
                      <div className="text-gray-900">{formatDate(current.dateReceived)}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Acceptance Reason */}
              {(canEditAdminFields || current.committeeAcceptanceReason) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Committee Acceptance Reason
                  </label>
                  {isEditing && canEditAdminFields ? (
                    <textarea
                      value={current.committeeAcceptanceReason || ''}
                      onChange={(e) => handleChange('committeeAcceptanceReason', e.target.value || null)}
                      disabled={isFormDisabled}
                      rows={2}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  ) : (
                    <div className="text-gray-900 whitespace-pre-wrap">{current.committeeAcceptanceReason || '-'}</div>
                  )}
                </div>
              )}

              {/* Category */}
              {(canEditAdminFields || current.category) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  {isEditing && canEditAdminFields ? (
                    <select
                      value={current.category || 'Other'}
                      onChange={(e) => handleChange('category', e.target.value)}
                      disabled={isFormDisabled}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="Facilities">Facilities</option>
                      <option value="Green">Green</option>
                      <option value="Grounds">Grounds</option>
                      <option value="Clubhouse">Clubhouse</option>
                      <option value="Bar">Bar</option>
                      <option value="Social">Social</option>
                      <option value="Finance">Finance</option>
                      <option value="Other">Other</option>
                    </select>
                  ) : (
                    <div className="text-gray-900">{current.category || 'Other'}</div>
                  )}
                </div>
              )}

              {/* Priority and Coordinator */}
              {(canEditAdminFields || current.priority || current.coordinatorFullName) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Priority
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <select
                        value={current.priority || ''}
                        onChange={(e) => handleChange('priority', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Not Set</option>
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Safety essential">Safety Essential</option>
                      </select>
                    ) : (
                      <div className="text-gray-900">{current.priority || '-'}</div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Project Coordinator
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <div className="flex gap-2 items-start">
                        <div className="flex-1">
                          <SearchableSelect
                            options={committeeMembers.map(m => ({ value: m.userName, label: m.fullName }))}
                            value={current.coordinatorUsername || ''}
                            onChange={(value) => handleCoordinatorChange(value)}
                            placeholder="Search for a coordinator..."
                            disabled={isFormDisabled}
                          />
                        </div>
                        {current.coordinatorUsername && (
                          <button
                            type="button"
                            onClick={() => handleCoordinatorChange('')}
                            disabled={isFormDisabled}
                            className="px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md border border-red-300 hover:border-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-900">{current.coordinatorFullName || 'Unassigned'}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Cost Details */}
              {(canEdit || current.estimatedCost != null) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Estimated Cost (£)
                    </label>
                    {isEditing && canEdit ? (
                      <input
                        type="number"
                        value={current.estimatedCost || ''}
                        onChange={(e) => handleChange('estimatedCost', e.target.value ? parseFloat(e.target.value) : null)}
                        disabled={isFormDisabled}
                        min="0"
                        step="0.01"
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    ) : (
                      <div className="text-gray-900">
                        {current.estimatedCost != null ? `£${current.estimatedCost.toFixed(2)}` : '-'}
                      </div>
                    )}
                  </div>

                  {(canEditAdminFields || current.fundingSource) && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Funding Source
                      </label>
                      {isEditing && canEditAdminFields ? (
                        <select
                          value={current.fundingSource || ''}
                          onChange={(e) => handleChange('fundingSource', e.target.value || null)}
                          disabled={isFormDisabled}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">Not Set</option>
                          <option value="Club Funds">Club Funds</option>
                          <option value="Grant">Grant</option>
                          <option value="Fundraising">Fundraising</option>
                          <option value="Sponsor">Sponsor</option>
                          <option value="Other">Other</option>
                        </select>
                      ) : (
                        <div className="text-gray-900">{current.fundingSource || '-'}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Cost Quotes Details */}
              {(canEdit || current.costQuotesDetails) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost Quotes Details
                  </label>
                  {isEditing && canEdit ? (
                    <textarea
                      value={current.costQuotesDetails || ''}
                      onChange={(e) => handleChange('costQuotesDetails', e.target.value || null)}
                      disabled={isFormDisabled}
                      rows={3}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  ) : (
                    <div className="text-gray-900 whitespace-pre-wrap">{current.costQuotesDetails || '-'}</div>
                  )}
                </div>
              )}

              {/* Decision */}
              {(canEditAdminFields || current.decision) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Decision
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <select
                        value={current.decision || ''}
                        onChange={(e) => handleChange('decision', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Not Decided</option>
                        <option value="Approved">Approved</option>
                        <option value="Not Approved">Not Approved</option>
                        <option value="Deferred">Deferred</option>
                      </select>
                    ) : (
                      <div className="text-gray-900">{current.decision || '-'}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Decision Reason */}
              {(canEditAdminFields || current.decisionReason) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Decision Reason
                  </label>
                  {isEditing && canEditAdminFields ? (
                    <textarea
                      value={current.decisionReason || ''}
                      onChange={(e) => handleChange('decisionReason', e.target.value || null)}
                      disabled={isFormDisabled}
                      rows={2}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  ) : (
                    <div className="text-gray-900 whitespace-pre-wrap">{current.decisionReason || '-'}</div>
                  )}
                </div>
              )}

              {/* Timeline */}
              {(canEditAdminFields || current.targetCompletionDate || current.reviewDate) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Target Completion Date
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <input
                        type="date"
                        value={formatDateForInput(current.targetCompletionDate)}
                        onChange={(e) => handleChange('targetCompletionDate', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    ) : (
                      <div className="text-gray-900">{formatDate(current.targetCompletionDate)}</div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Review Date
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <input
                        type="date"
                        value={formatDateForInput(current.reviewDate)}
                        onChange={(e) => handleChange('reviewDate', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    ) : (
                      <div className="text-gray-900">{formatDate(current.reviewDate)}</div>
                    )}
                  </div>
                </div>
              )}

              {/* Progress Notes */}
              {(canEdit || current.progressNotes) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Progress Notes
                  </label>
                  {isEditing && canEdit ? (
                    <textarea
                      value={current.progressNotes || ''}
                      onChange={(e) => handleChange('progressNotes', e.target.value || null)}
                      disabled={isFormDisabled}
                      rows={4}
                      placeholder="Record progress updates here..."
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  ) : (
                    <div className="text-gray-900 whitespace-pre-wrap">{current.progressNotes || '-'}</div>
                  )}
                </div>
              )}

              {/* Final Outcome */}
              {(canEditAdminFields || current.finalOutcome) && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Final Outcome
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <select
                        value={current.finalOutcome || ''}
                        onChange={(e) => handleChange('finalOutcome', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">In Progress</option>
                        <option value="Completed">Completed</option>
                        <option value="Cancelled">Cancelled</option>
                        <option value="On Hold">On Hold</option>
                      </select>
                    ) : (
                      <div className="text-gray-900">{current.finalOutcome || 'In Progress'}</div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Date Completed
                    </label>
                    {isEditing && canEditAdminFields ? (
                      <input
                        type="date"
                        value={formatDateForInput(current.dateCompleted)}
                        onChange={(e) => handleChange('dateCompleted', e.target.value || null)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    ) : (
                      <div className="text-gray-900">{formatDate(current.dateCompleted)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Last Updated */}
        {current.updatedAt && (
          <div className="mt-4 text-sm text-gray-500 text-center">
            Last updated: {formatDate(current.updatedAt)}
            {current.updatedByUsername && ` by ${current.updatedByUsername}`}
          </div>
        )}
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
      />
    </div>
  );
}
