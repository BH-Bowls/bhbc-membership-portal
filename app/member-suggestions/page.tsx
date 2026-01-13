// app/member-suggestions/page.tsx
// Member Suggestions List Page
// Shows all suggestions with tabs for committee members and simple list for regular members

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import type { MemberSuggestion, SuggestionStatus } from '@/types/suggestions';
import { getSuggestionStatus, getStatusLabel, getStatusColor } from '@/types/suggestions';
import { restoreDraft } from '@/lib/form-draft-utils';

// ============================================================================
// Main Component
// ============================================================================

/**
 * Member Suggestions List Page
 * Features:
 * - Committee members: See all suggestions with tabbed filtering
 * - Regular members: See own suggestions + accepted ongoing ones
 * - Click row to view details
 * - Add button to create new suggestion
 */
export default function MemberSuggestionsPage() {
  // Get current user session
  const { data: session } = useSession();

  // Router for navigation
  const router = useRouter();

  // State: List of all suggestions
  const [suggestions, setSuggestions] = useState<MemberSuggestion[]>([]);

  // State: Current filter selection (for committee members)
  const [filter, setFilter] = useState<'all' | SuggestionStatus>('all');

  // State: Loading indicator while fetching
  const [loading, setLoading] = useState(true);

  // State: Is committee member
  const [isCommittee, setIsCommittee] = useState(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch suggestions when page loads
   */
  useEffect(() => {
    fetchSuggestions();
  }, []);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch all suggestions from API (filtered by role)
   */
  async function fetchSuggestions() {
    setLoading(true);

    try {
      const response = await fetch('/api/suggestions');
      const data = await response.json();

      if (response.ok) {
        setSuggestions(data.suggestions);
        setIsCommittee(data.isCommittee);
      } else {
        alert(data.error || 'Failed to load suggestions');
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
      alert('Failed to load suggestions');
    } finally {
      setLoading(false);
    }
  }

  // ============================================================================
  // Filtering and Display Logic
  // ============================================================================

  /**
   * Filter suggestions based on selected filter tab
   */
  const filteredSuggestions = suggestions.filter((suggestion) => {
    // If 'all' filter selected, show all suggestions
    if (filter === 'all') return true;

    // Otherwise, only show suggestions with matching status
    return getSuggestionStatus(suggestion) === filter;
  });

  /**
   * Get status badge component for a suggestion
   */
  const getStatusBadge = (suggestion: MemberSuggestion) => {
    const status = getSuggestionStatus(suggestion);
    const label = getStatusLabel(status);
    const color = getStatusColor(status);

    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${color}`}>
        {label}
      </span>
    );
  };

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
   * Check if suggestion has unsaved draft
   */
  const hasDraft = (suggestionId: string): boolean => {
    if (!session?.user?.userName) return false;
    const draft = restoreDraft(`MemberSuggestion-${suggestionId}`, session.user.userName);
    return draft !== null;
  };

  /**
   * Navigate to suggestion detail page
   */
  const viewSuggestion = (suggestionId: string) => {
    router.push(`/member-suggestions/${suggestionId}`);
  };

  /**
   * Navigate to new suggestion page
   */
  const createNewSuggestion = () => {
    router.push('/member-suggestions/new');
  };

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar */}
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
      />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Page header with title and add button */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Member Suggestions</h1>

          {/* Add New Suggestion button */}
          <button
            onClick={createNewSuggestion}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
          >
            + Add Suggestion
          </button>
        </div>

        {/* Filter tabs (committee only) */}
        {isCommittee && (
          <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
            {/* All suggestions */}
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 font-medium border-b-2 whitespace-nowrap ${
                filter === 'all'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              All
            </button>

            {/* Filter tabs for each status */}
            {(['new', 'ongoing', 'review', 'complete', 'cancelled', 'on_hold'] as const).map(
              (status) => (
                <button
                  key={status}
                  onClick={() => setFilter(status)}
                  className={`px-4 py-2 font-medium border-b-2 whitespace-nowrap ${
                    filter === status
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {getStatusLabel(status)}
                </button>
              )
            )}
          </div>
        )}

        {/* Suggestions table */}
        {loading ? (
          // Loading state
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading suggestions...</p>
          </div>
        ) : filteredSuggestions.length === 0 ? (
          // Empty state
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <p className="text-gray-500 mb-4">No suggestions found.</p>
            <button
              onClick={createNewSuggestion}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
            >
              Create First Suggestion
            </button>
          </div>
        ) : (
          // Suggestions table
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              {/* Table header */}
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Title
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Created By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Status
                  </th>
                  {isCommittee && (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                      Coordinator
                    </th>
                  )}
                </tr>
              </thead>

              {/* Table body */}
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSuggestions.map((suggestion) => (
                  <tr
                    key={suggestion.suggestionId}
                    onClick={() => viewSuggestion(suggestion.suggestionId)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    {/* Date column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {formatDate(suggestion.createdAt)}
                    </td>

                    {/* ID column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                      {suggestion.suggestionId}
                    </td>

                    {/* Title column */}
                    <td className="px-6 py-4 text-sm font-medium">
                      <div className="flex items-center gap-2">
                        <div className="max-w-md truncate">{suggestion.title}</div>
                        {hasDraft(suggestion.suggestionId) && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-800 whitespace-nowrap">
                            <svg className="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                            Draft
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Category column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {suggestion.category}
                    </td>

                    {/* Created by column */}
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {suggestion.createdByFullName}
                    </td>

                    {/* Status badge column */}
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(suggestion)}
                    </td>

                    {/* Coordinator column (committee only) */}
                    {isCommittee && (
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {suggestion.coordinatorFullName || '-'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
