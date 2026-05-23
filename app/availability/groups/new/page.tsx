// app/availability/groups/new/page.tsx
// Create a new availability group — form with name, description, member management setting,
// initial members (portal members + visitors)

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { RouterBackLink } from '@/components/RouterBackLink';
import { getButtonClasses, getInputClasses, getAlertClasses } from '@/config/theme-helpers';

// Shape of a portal member returned by the lookup endpoint
interface MemberOption {
  fullName: string;
  userName: string;
  memberType: string;
}

// Shape of a visitor entry added by the user
interface VisitorEntry {
  visitorName: string;
  visitorEmail: string;
}

export default function NewGroupPage() {
  // Load session for navbar and draft scoping
  const { data: session } = useSession();
  const router = useRouter();

  // Form field state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Default: members cannot manage membership (only creator can)
  const [allowMemberManagement, setAllowMemberManagement] = useState(false);

  // Selected portal members (by userName)
  const [selectedMemberUserNames, setSelectedMemberUserNames] = useState<string[]>([]);
  // Map of userName → displayName for selected members (for rendering)
  const [selectedMemberNames, setSelectedMemberNames] = useState<Record<string, string>>({});

  // All portal members loaded for the search dropdown
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  // Whether member list is loading
  const [membersLoading, setMembersLoading] = useState(false);
  // Search term for filtering the member dropdown
  const [memberSearch, setMemberSearch] = useState('');
  // Whether the member dropdown is visible
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);

  // Visitor entries added by the user
  const [visitors, setVisitors] = useState<VisitorEntry[]>([]);
  // Fields for the add-visitor inline form
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorEmail, setNewVisitorEmail] = useState('');
  const [visitorError, setVisitorError] = useState<string | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const userName = session && session.user ? session.user.userName : '';

  // Load all portal members for the member search dropdown
  useEffect(() => {
    // Only load once (no dependency on form fields)
    loadMembers();
  }, []);

  // Fetch member list from lookup endpoint
  async function loadMembers() {
    setMembersLoading(true);
    try {
      const res = await fetch('/api/members/lookup');
      const data = await res.json();
      if (data.members) {
        setAllMembers(data.members);
      }
    } catch (err) {
      console.error('[NewGroupPage] Failed to load member list:', err);
    } finally {
      setMembersLoading(false);
    }
  }

  // Filter member options by search term, excluding already-selected members
  function getFilteredMembers(): MemberOption[] {
    const searchLower = memberSearch.toLowerCase();
    const results: MemberOption[] = [];
    for (let i = 0; i < allMembers.length; i++) {
      const m = allMembers[i];
      // Skip already-selected members
      if (selectedMemberUserNames.indexOf(m.userName) !== -1) continue;
      // Skip the current user (they're the creator, not an invitee)
      if (m.userName === userName) continue;
      // Apply search filter
      if (searchLower && m.fullName.toLowerCase().indexOf(searchLower) === -1) continue;
      results.push(m);
    }
    // Show at most 10 in dropdown
    return results.slice(0, 10);
  }

  // Add a portal member to the selected list
  function addMember(member: MemberOption) {
    // Check if already added (guard against duplicates)
    if (selectedMemberUserNames.indexOf(member.userName) !== -1) return;
    setSelectedMemberUserNames(prev => [...prev, member.userName]);
    setSelectedMemberNames(prev => {
      const next = { ...prev };
      next[member.userName] = member.fullName;
      return next;
    });
    // Clear search after selection
    setMemberSearch('');
    setShowMemberDropdown(false);
  }

  // Remove a portal member from the selected list
  function removeMember(removeUserName: string) {
    setSelectedMemberUserNames(prev => prev.filter(u => u !== removeUserName));
    setSelectedMemberNames(prev => {
      const next = { ...prev };
      delete next[removeUserName];
      return next;
    });
  }

  // Add a visitor to the visitors list
  function addVisitor() {
    setVisitorError(null);
    // Validate required fields
    if (!newVisitorName.trim()) {
      setVisitorError('Visitor name is required.');
      return;
    }
    if (!newVisitorEmail.trim()) {
      setVisitorError('Visitor email is required.');
      return;
    }
    // Basic email format check
    if (newVisitorEmail.indexOf('@') === -1) {
      setVisitorError('Please enter a valid email address.');
      return;
    }
    setVisitors(prev => [...prev, {
      visitorName: newVisitorName.trim(),
      visitorEmail: newVisitorEmail.trim().toLowerCase(),
    }]);
    // Clear the visitor form fields
    setNewVisitorName('');
    setNewVisitorEmail('');
  }

  // Remove a visitor from the list by index
  function removeVisitor(index: number) {
    setVisitors(prev => prev.filter((_, i) => i !== index));
  }

  // Submit the create-group form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    // Client-side validation
    if (!name.trim()) {
      setSubmitError('Group name is required.');
      return;
    }

    setSubmitting(true);
    try {
      // POST to the groups API endpoint
      const res = await fetch('/api/availability/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          allowMemberManagement,
          memberUserNames: selectedMemberUserNames,
          visitorMembers: visitors,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.error || 'Failed to create group.');
        return;
      }

      // Navigate to the new group page
      router.push(`/availability/groups/${data.groupId}`);
    } catch (err) {
      console.error('[NewGroupPage] handleSubmit error:', err);
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Page header with back link */}
        <div className="mb-6">
          <RouterBackLink fallbackHref="/availability" label="Availability" />
          <h1 className="text-2xl font-bold text-gray-900">Create Group</h1>
          <p className="text-sm text-gray-700 mt-1">
            A group is a saved list of people you can run multiple events against.
          </p>
        </div>

        {/* Error banner for submission failures */}
        {submitError && (
          <div className={getAlertClasses('danger') + ' mb-4'}>
            {submitError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* ── Section 1: Group Details ──────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Group Details</h2>

            {/* Group name (required) */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Group Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={getInputClasses(!name.trim() && submitting)}
                placeholder="e.g. Tuesday Evening Group"
                maxLength={100}
              />
            </div>

            {/* Optional description */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-500">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className={getInputClasses(false)}
                placeholder="Brief description of the group"
                rows={2}
                maxLength={250}
              />
            </div>

            {/* Allow member management toggle */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Allow members to manage membership
              </label>
              <div className="flex gap-3">
                {/* Yes button */}
                <button
                  type="button"
                  onClick={() => setAllowMemberManagement(true)}
                  className={allowMemberManagement
                    ? getButtonClasses('primary', 'sm')
                    : getButtonClasses('secondary', 'sm')}
                >
                  Yes
                </button>
                {/* No button */}
                <button
                  type="button"
                  onClick={() => setAllowMemberManagement(false)}
                  className={!allowMemberManagement
                    ? getButtonClasses('primary', 'sm')
                    : getButtonClasses('secondary', 'sm')}
                >
                  No
                </button>
              </div>
              <p className="text-xs text-gray-700 mt-1">
                If Yes, any group member can add or remove people. You can always manage membership as the creator.
              </p>
            </div>
          </div>

          {/* ── Section 2: Initial Members ────────────────────────── */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Initial Members</h2>
            <p className="text-xs text-gray-700 mb-4">
              You can leave this empty and add people later from the group page.
            </p>

            {/* Two sub-sections side by side on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Portal members search */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Portal Members</h3>

                {/* Search input with dropdown */}
                <div className="relative">
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => {
                      setMemberSearch(e.target.value);
                      // Show dropdown when user types
                      setShowMemberDropdown(true);
                    }}
                    onFocus={() => setShowMemberDropdown(true)}
                    onBlur={() => {
                      // Slight delay to allow click on dropdown item
                      setTimeout(() => setShowMemberDropdown(false), 150);
                    }}
                    className={getInputClasses(false)}
                    placeholder={membersLoading ? 'Loading members…' : 'Search by name'}
                    disabled={membersLoading}
                  />

                  {/* Dropdown list of matching members */}
                  {showMemberDropdown && memberSearch.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {getFilteredMembers().length === 0 ? (
                        <div className="px-3 py-2 text-sm text-gray-700">No members found</div>
                      ) : (
                        getFilteredMembers().map((m) => (
                          <button
                            key={m.userName}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                            onMouseDown={() => addMember(m)}
                          >
                            {m.fullName}
                            <span className="text-gray-700 text-xs ml-1">({m.userName})</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* List of selected members */}
                {selectedMemberUserNames.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {selectedMemberUserNames.map((u) => (
                      <li key={u} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
                        <span className="text-gray-900">{selectedMemberNames[u] || u}</span>
                        <button
                          type="button"
                          onClick={() => removeMember(u)}
                          className="text-red-600 hover:text-red-800 ml-2 text-xs font-medium"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Visitors form */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Visitors</h3>

                {/* Visitor input fields */}
                {visitorError && (
                  <p className="text-xs text-red-600 mb-2">{visitorError}</p>
                )}
                <input
                  type="text"
                  value={newVisitorName}
                  onChange={(e) => setNewVisitorName(e.target.value)}
                  className={getInputClasses(false) + ' mb-2'}
                  placeholder="Visitor name"
                  maxLength={100}
                />
                <input
                  type="email"
                  value={newVisitorEmail}
                  onChange={(e) => setNewVisitorEmail(e.target.value)}
                  className={getInputClasses(false) + ' mb-2'}
                  placeholder="Visitor email"
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={addVisitor}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  Add Visitor
                </button>

                {/* List of added visitors */}
                {visitors.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {visitors.map((v, i) => (
                      <li key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
                        <div>
                          <span className="text-gray-900">{v.visitorName}</span>
                          <span className="text-gray-700 text-xs ml-1">{v.visitorEmail}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeVisitor(i)}
                          className="text-red-600 hover:text-red-800 ml-2 text-xs font-medium"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          {/* Submit button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className={getButtonClasses('primary', 'md')}
            >
              {submitting ? 'Creating…' : 'Create Group'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
