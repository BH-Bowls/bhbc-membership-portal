// app/availability/groups/[groupId]/page.tsx
// Group page — shows group details, membership panel, and event feed

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { useSessionRefresh } from '@/hooks/useSessionRefresh';
import {
  getButtonClasses,
  getInputClasses,
  getBadgeClasses,
  getAlertClasses,
} from '@/config/theme-helpers';
import type {
  AvailabilityGroupDetail,
  AvailabilityGroupMember,
  AvailabilityEventSummary,
} from '@/types/availability';

// sessionStorage cache key prefix — appended with groupId at runtime
const CACHE_KEY_PREFIX = 'AvailabilityGroup-';

// Shape of a portal member from the lookup endpoint
interface MemberOption {
  fullName: string;
  userName: string;
}

// Format an ISO timestamp to a short date string
function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Return a human-readable relative time string
function relativeTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  return formatDate(iso);
}

// Badge variant for event status
function statusBadgeVariant(status: string): 'success' | 'warning' | 'primary' | 'secondary' {
  if (status === 'open') return 'success';
  if (status === 'closed') return 'warning';
  if (status === 'concluded') return 'primary';
  return 'secondary';
}

// Badge variant for event type
function typeBadgeVariant(type: string): 'primary' | 'secondary' | 'warning' {
  if (type === 'fixture') return 'warning';
  if (type === 'signup') return 'secondary';
  return 'primary';
}

// Capitalise first letter
function cap(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function GroupPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { data: session } = useSession();
  useSessionRefresh();
  const router = useRouter();

  // Resolve the groupId from the async params
  const [groupId, setGroupId] = useState('');
  React.useEffect(() => {
    params.then((p) => setGroupId(p.groupId));
  }, [params]);

  // Group detail data from the API
  const [detail, setDetail] = useState<AvailabilityGroupDetail | null>(null);
  // Whether initial data is loading
  const [loading, setLoading] = useState(true);
  // Whether the user is not a group member (403)
  const [forbidden, setForbidden] = useState(false);
  // Error message for display
  const [error, setError] = useState<string | null>(null);

  // Whether the membership panel is expanded
  const [showMembersPanel, setShowMembersPanel] = useState(false);
  // Whether the edit group form is shown
  const [showEditForm, setShowEditForm] = useState(false);
  // Whether the archive confirmation is shown
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  // Edit form fields
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAllowManagement, setEditAllowManagement] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Archive state
  const [archiving, setArchiving] = useState(false);

  // Add members state (inside membership panel)
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [addMemberUserNames, setAddMemberUserNames] = useState<string[]>([]);
  const [addMemberNames, setAddMemberNames] = useState<Record<string, string>>({});
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorEmail, setNewVisitorEmail] = useState('');
  const [visitorError, setVisitorError] = useState<string | null>(null);
  const [addVisitors, setAddVisitors] = useState<{ visitorName: string; visitorEmail: string }[]>([]);
  const [addMembersError, setAddMembersError] = useState<string | null>(null);
  const [addMembersSuccess, setAddMembersSuccess] = useState<string | null>(null);
  const [addMembersSaving, setAddMembersSaving] = useState(false);

  // Remove member state
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);

  const currentUserName = session && session.user ? session.user.userName : '';
  const currentUserRole = session && session.user ? session.user.role : '';

  // Load group data when groupId is resolved
  useEffect(() => {
    if (!groupId) return;
    const cacheKey = CACHE_KEY_PREFIX + groupId + '-Cache';
    // Show cached data instantly if available
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        setDetail(JSON.parse(cached));
        setLoading(false);
        fetchDetail({ silent: true, gid: groupId });
        return;
      } catch {
        // Corrupt cache — fetch fresh
      }
    }
    fetchDetail({ silent: false, gid: groupId });
  }, [groupId]);

  // Fetch group detail from the API
  async function fetchDetail({ silent, gid }: { silent: boolean; gid: string }) {
    if (!silent) setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(`/api/availability/groups/${gid}`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (res.status === 404) {
        setError('Group not found.');
        return;
      }
      if (!res.ok) {
        throw new Error('Failed to load group');
      }
      const data: AvailabilityGroupDetail = await res.json();
      setDetail(data);
      // Cache for back-navigation
      const cacheKey = CACHE_KEY_PREFIX + gid + '-Cache';
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (err) {
      if (!silent) setError('Failed to load group. Please refresh.');
      console.error('[GroupPage] fetchDetail error:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Load portal members list for the add-members search
  async function loadAllMembers() {
    if (allMembers.length > 0) return; // Already loaded
    setMembersLoading(true);
    try {
      const res = await fetch('/api/members/lookup');
      const data = await res.json();
      if (data.members) setAllMembers(data.members);
    } catch (err) {
      console.error('[GroupPage] loadAllMembers error:', err);
    } finally {
      setMembersLoading(false);
    }
  }

  // Open the membership panel and load members list
  function handleOpenMembersPanel() {
    setShowMembersPanel(true);
    loadAllMembers();
  }

  // Populate edit form fields from current group data
  function handleOpenEditForm() {
    if (!detail) return;
    setEditName(detail.group.name);
    setEditDescription(detail.group.description);
    setEditAllowManagement(detail.group.allowMemberManagement);
    setEditError(null);
    setShowEditForm(true);
  }

  // Save group edits
  async function handleSaveEdit() {
    if (!detail || !groupId) return;
    setEditError(null);
    if (!editName.trim()) {
      setEditError('Group name is required.');
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/availability/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
          allowMemberManagement: editAllowManagement,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setEditError(d.error || 'Failed to save changes.');
        return;
      }
      // Re-fetch to show updated data
      setShowEditForm(false);
      await fetchDetail({ silent: false, gid: groupId });
    } catch (err) {
      console.error('[GroupPage] handleSaveEdit error:', err);
      setEditError('An unexpected error occurred.');
    } finally {
      setEditSaving(false);
    }
  }

  // Archive the group (soft-delete)
  async function handleArchive() {
    if (!groupId) return;
    setArchiving(true);
    try {
      const res = await fetch(`/api/availability/groups/${groupId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to archive group.');
        return;
      }
      // Navigate back to hub after archiving
      router.push('/availability');
    } catch (err) {
      console.error('[GroupPage] handleArchive error:', err);
      setError('Failed to archive group.');
    } finally {
      setArchiving(false);
      setShowArchiveConfirm(false);
    }
  }

  // Get filtered members for the add-members dropdown
  function getFilteredAddMembers(): MemberOption[] {
    const existingUserNames: string[] = [];
    // Build list of current group member usernames
    if (detail) {
      for (let i = 0; i < detail.members.length; i++) {
        const m = detail.members[i];
        if (m.memberType === 'member' && m.userName) {
          existingUserNames.push(m.userName);
        }
      }
    }
    const searchLower = memberSearch.toLowerCase();
    const results: MemberOption[] = [];
    for (let i = 0; i < allMembers.length; i++) {
      const m = allMembers[i];
      // Skip current members
      if (existingUserNames.indexOf(m.userName) !== -1) continue;
      // Skip already-queued additions
      if (addMemberUserNames.indexOf(m.userName) !== -1) continue;
      // Apply search filter
      if (searchLower && m.fullName.toLowerCase().indexOf(searchLower) === -1) continue;
      results.push(m);
    }
    return results.slice(0, 10);
  }

  // Queue a member to be added
  function queueAddMember(member: MemberOption) {
    if (addMemberUserNames.indexOf(member.userName) !== -1) return;
    setAddMemberUserNames(prev => [...prev, member.userName]);
    setAddMemberNames(prev => {
      const next = { ...prev };
      next[member.userName] = member.fullName;
      return next;
    });
    setMemberSearch('');
    setShowMemberDropdown(false);
  }

  // Remove from queue
  function dequeueAddMember(u: string) {
    setAddMemberUserNames(prev => prev.filter(x => x !== u));
    setAddMemberNames(prev => {
      const next = { ...prev };
      delete next[u];
      return next;
    });
  }

  // Add a visitor to the add-visitors queue
  function queueAddVisitor() {
    setVisitorError(null);
    if (!newVisitorName.trim()) {
      setVisitorError('Visitor name is required.');
      return;
    }
    if (!newVisitorEmail.trim() || newVisitorEmail.indexOf('@') === -1) {
      setVisitorError('Please enter a valid email address.');
      return;
    }
    setAddVisitors(prev => [...prev, {
      visitorName: newVisitorName.trim(),
      visitorEmail: newVisitorEmail.trim().toLowerCase(),
    }]);
    setNewVisitorName('');
    setNewVisitorEmail('');
  }

  // Save all queued member additions
  async function handleSaveMembers() {
    if (!groupId) return;
    if (addMemberUserNames.length === 0 && addVisitors.length === 0) {
      setAddMembersError('Please add at least one member or visitor.');
      return;
    }
    setAddMembersError(null);
    setAddMembersSuccess(null);
    setAddMembersSaving(true);
    try {
      const res = await fetch(`/api/availability/groups/${groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberUserNames: addMemberUserNames,
          visitorMembers: addVisitors,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddMembersError(data.error || 'Failed to add members.');
        return;
      }
      // Reset the add-members form
      setAddMemberUserNames([]);
      setAddMemberNames({});
      setAddVisitors([]);
      setAddMembersSuccess(`${data.addedCount} member(s) added successfully.`);
      // Re-fetch group to show updated member list
      await fetchDetail({ silent: false, gid: groupId });
    } catch (err) {
      console.error('[GroupPage] handleSaveMembers error:', err);
      setAddMembersError('An unexpected error occurred.');
    } finally {
      setAddMembersSaving(false);
    }
  }

  // Remove a group member
  async function handleRemoveMember(memberId: string) {
    if (!groupId) return;
    setRemovingMemberId(memberId);
    try {
      const res = await fetch(
        `/api/availability/groups/${groupId}/members/${memberId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || 'Failed to remove member.');
        return;
      }
      // Re-fetch to reflect removal
      await fetchDetail({ silent: false, gid: groupId });
    } catch (err) {
      console.error('[GroupPage] handleRemoveMember error:', err);
      setError('Failed to remove member.');
    } finally {
      setRemovingMemberId(null);
    }
  }

  const displayName = session && session.user && session.user.name ? session.user.name : undefined;
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Navbar userName={displayName} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Forbidden message */}
        {forbidden && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            You are not a member of this group.
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className={getAlertClasses('danger') + ' mt-4'}>
            {error}
          </div>
        )}

        {/* Loading spinner on first load */}
        {loading && !forbidden && (
          <div className="text-center py-16">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-700">Loading group…</p>
          </div>
        )}

        {/* Main content once data is loaded */}
        {!loading && !forbidden && detail && (
          <>
            {/* ── Group header ─────────────────────────────────────── */}
            <div className="mb-6">
              <a href="/availability" className="text-blue-600 hover:text-blue-800 mb-2 inline-block">← Groups</a>

              {/* Title row with status badge */}
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-2xl font-bold text-gray-900">{detail.group.name}</h1>
                {detail.group.status === 'archived' ? (
                  <span className={getBadgeClasses('secondary')}>Archived</span>
                ) : (
                  <span className={getBadgeClasses('success')}>Active</span>
                )}
              </div>

              {/* Description */}
              {detail.group.description && (
                <p className="text-sm text-gray-700 mb-2">{detail.group.description}</p>
              )}

              {/* Member count */}
              <p className="text-sm text-gray-700 mb-3">
                {detail.members.length} {detail.members.length === 1 ? 'member' : 'members'}
              </p>

              {/* Action buttons */}
              <div className="flex flex-wrap gap-2">
                {/* Manage members — shown if user has permission */}
                {detail.canManageMembers && detail.group.status === 'active' && (
                  <button
                    onClick={handleOpenMembersPanel}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Manage Members
                  </button>
                )}

                {/* Edit group — shown to creator only */}
                {detail.isCreator && detail.group.status === 'active' && (
                  <button
                    onClick={handleOpenEditForm}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Edit Group
                  </button>
                )}

                {/* Create poll — primary action */}
                {detail.group.status === 'active' && (
                  <Link
                    href={`/availability/groups/${groupId}/events/new`}
                    className={getButtonClasses('primary', 'sm')}
                  >
                    Create Poll
                  </Link>
                )}

                {/* Archive — shown to creator or admin */}
                {(detail.isCreator || currentUserRole.indexOf('Admin') !== -1) && detail.group.status === 'active' && (
                  <button
                    onClick={() => setShowArchiveConfirm(true)}
                    className={getButtonClasses('danger', 'sm')}
                  >
                    Archive Group
                  </button>
                )}
              </div>
            </div>

            {/* ── Archive confirmation ──────────────────────────────── */}
            {showArchiveConfirm && (
              <div className={getAlertClasses('warning') + ' mb-4'}>
                <p className="font-medium text-gray-900 mb-2">Archive this group?</p>
                <p className="text-sm text-gray-700 mb-3">
                  Archiving removes the group from all views. Events within the group are not automatically archived.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleArchive}
                    disabled={archiving}
                    className={getButtonClasses('danger', 'sm')}
                  >
                    {archiving ? 'Archiving…' : 'Confirm Archive'}
                  </button>
                  <button
                    onClick={() => setShowArchiveConfirm(false)}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Edit group form (inline) ──────────────────────────── */}
            {showEditForm && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Edit Group</h2>

                {editError && (
                  <div className={getAlertClasses('danger') + ' mb-3 text-sm'}>
                    {editError}
                  </div>
                )}

                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={getInputClasses(false)}
                    maxLength={100}
                  />
                </div>
                <div className="mb-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className={getInputClasses(false)}
                    rows={2}
                    maxLength={250}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Allow members to manage membership
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditAllowManagement(true)}
                      className={editAllowManagement
                        ? getButtonClasses('success', 'sm')
                        : 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-md px-3 py-1.5 text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm'}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditAllowManagement(false)}
                      className={!editAllowManagement
                        ? getButtonClasses('danger', 'sm')
                        : 'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 rounded-md px-3 py-1.5 text-sm border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 shadow-sm'}
                    >
                      No
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={editSaving}
                    className={getButtonClasses('primary', 'sm')}
                  >
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button
                    onClick={() => setShowEditForm(false)}
                    className={getButtonClasses('secondary', 'sm')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Membership panel (inline) ─────────────────────────── */}
            {showMembersPanel && (
              <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-semibold text-gray-900">Members</h2>
                  <button
                    onClick={() => setShowMembersPanel(false)}
                    className="text-gray-500 hover:text-gray-700 text-sm"
                  >
                    Close ✕
                  </button>
                </div>

                {/* Current member list */}
                {detail.members.length === 0 ? (
                  <p className="text-sm text-gray-700 mb-4">No members yet.</p>
                ) : (
                  <ul className="mb-4 space-y-1">
                    {detail.members.map((m: AvailabilityGroupMember) => (
                      <li key={m.memberId} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-900">
                            {m.memberType === 'member'
                              ? (detail.memberDisplayNames[m.userName] || m.userName)
                              : m.visitorName}
                          </span>
                          <span className={getBadgeClasses(m.memberType === 'visitor' ? 'secondary' : 'primary', 'sm')}>
                            {m.memberType === 'visitor' ? 'Visitor' : 'Member'}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveMember(m.memberId)}
                          disabled={removingMemberId === m.memberId}
                          className="text-xs text-red-600 hover:text-red-800 font-medium ml-2"
                        >
                          {removingMemberId === m.memberId ? 'Removing…' : 'Remove'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add new members */}
                <div className="border-t border-gray-100 pt-3">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Add Members</h3>

                  {addMembersError && (
                    <div className={getAlertClasses('danger') + ' mb-2 text-sm'}>
                      {addMembersError}
                    </div>
                  )}
                  {addMembersSuccess && (
                    <div className={getAlertClasses('success') + ' mb-2 text-sm'}>
                      {addMembersSuccess}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Portal member search */}
                    <div>
                      <p className="text-xs text-gray-700 mb-1">Portal Members</p>
                      <div className="relative">
                        <input
                          type="text"
                          value={memberSearch}
                          onChange={(e) => {
                            setMemberSearch(e.target.value);
                            setShowMemberDropdown(true);
                          }}
                          onFocus={() => setShowMemberDropdown(true)}
                          onBlur={() => setTimeout(() => setShowMemberDropdown(false), 150)}
                          className={getInputClasses(false)}
                          placeholder={membersLoading ? 'Loading…' : 'Search by name'}
                          disabled={membersLoading}
                        />
                        {showMemberDropdown && memberSearch.length > 0 && (
                          <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-40 overflow-y-auto">
                            {getFilteredAddMembers().length === 0 ? (
                              <div className="px-3 py-2 text-sm text-gray-700">No members found</div>
                            ) : (
                              getFilteredAddMembers().map((m) => (
                                <button
                                  key={m.userName}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm text-gray-900 hover:bg-gray-100"
                                  onMouseDown={() => queueAddMember(m)}
                                >
                                  {m.fullName}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                      {addMemberUserNames.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {addMemberUserNames.map((u) => (
                            <li key={u} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1 text-sm">
                              <span className="text-gray-900">{addMemberNames[u] || u}</span>
                              <button
                                type="button"
                                onClick={() => dequeueAddMember(u)}
                                className="text-xs text-red-600 hover:text-red-800 ml-2"
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Visitor add form */}
                    <div>
                      <p className="text-xs text-gray-700 mb-1">Visitors</p>
                      {visitorError && (
                        <p className="text-xs text-red-600 mb-1">{visitorError}</p>
                      )}
                      <input
                        type="text"
                        value={newVisitorName}
                        onChange={(e) => setNewVisitorName(e.target.value)}
                        className={getInputClasses(false) + ' mb-1'}
                        placeholder="Visitor name"
                        maxLength={100}
                      />
                      <input
                        type="email"
                        value={newVisitorEmail}
                        onChange={(e) => setNewVisitorEmail(e.target.value)}
                        className={getInputClasses(false) + ' mb-1'}
                        placeholder="Visitor email"
                        maxLength={200}
                      />
                      <button
                        type="button"
                        onClick={queueAddVisitor}
                        className={getButtonClasses('secondary', 'sm')}
                      >
                        Add Visitor
                      </button>
                      {addVisitors.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {addVisitors.map((v, i) => (
                            <li key={i} className="flex items-center justify-between bg-gray-50 rounded px-2 py-1 text-sm">
                              <span className="text-gray-900">{v.visitorName}</span>
                              <button
                                type="button"
                                onClick={() => setAddVisitors(prev => prev.filter((_, j) => j !== i))}
                                className="text-xs text-red-600 hover:text-red-800 ml-2"
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      onClick={handleSaveMembers}
                      disabled={addMembersSaving}
                      className={getButtonClasses('primary', 'sm')}
                    >
                      {addMembersSaving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Event feed ───────────────────────────────────────── */}
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Polls</h2>

              {detail.events.length === 0 ? (
                <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
                  <p className="text-gray-700">No polls yet. Create the first one.</p>
                  {detail.group.status === 'active' && (
                    <div className="mt-4">
                      <Link
                        href={`/availability/groups/${groupId}/events/new`}
                        className={getButtonClasses('primary', 'sm')}
                      >
                        Create Poll
                      </Link>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {detail.events.map((ev: AvailabilityEventSummary) => (
                    <div
                      key={ev.eventId}
                      className={
                        'rounded-lg border p-4 ' +
                        (ev.status === 'open'
                          ? 'bg-white border-gray-200'
                          : 'bg-gray-50 border-gray-100')
                      }
                    >
                      {/* Event title and badges */}
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                        <Link
                          href={`/availability/events/${ev.eventId}`}
                          className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {ev.title}
                        </Link>
                        <div className="flex flex-wrap gap-1">
                          <span className={getBadgeClasses(typeBadgeVariant(ev.type), 'sm')}>
                            {cap(ev.type)}
                          </span>
                          <span className={getBadgeClasses(statusBadgeVariant(ev.status), 'sm')}>
                            {cap(ev.status)}
                          </span>
                          {/* Tick if user has responded */}
                          {ev.hasResponded && (
                            <span className={getBadgeClasses('success', 'sm')}>✓ Responded</span>
                          )}
                        </div>
                      </div>

                      {/* Metadata */}
                      <div className="text-xs text-gray-700 space-y-0.5">
                        <p>
                          By {ev.createdByName}
                        </p>
                        <p>
                          {ev.slotCount} {ev.slotCount === 1 ? 'option' : 'options'} ·{' '}
                          {ev.responseCount} {ev.responseCount === 1 ? 'response' : 'responses'} ·{' '}
                          Expires {formatDate(ev.expiresAt)}
                        </p>
                        {/* Winning slot if concluded */}
                        {ev.status === 'concluded' && ev.concludedSlotLabel && (
                          <p className="text-green-700 font-medium">
                            Chosen: {ev.concludedSlotLabel}
                          </p>
                        )}
                      </div>

                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
