// app/invite-games/[id]/page.tsx
// Invite Game detail page — view for members, edit/delete for committee

'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { AttachmentUpload } from '@/components/AttachmentUpload';
import { AttachmentsList } from '@/components/AttachmentsList';
import type { InviteGame } from '@/types/invite-games';
import type { InviteGameAttachment } from '@/types/attachments';

export default function InviteGameDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { data: session } = useSession();
  const router = useRouter();
  usePhoneBackNavigation('/invite-games');

  const [inviteGameId, setInviteGameId] = React.useState<string>('');

  React.useEffect(() => {
    params.then((p) => setInviteGameId(p.id));
  }, [params]);

  // Data state
  const [game, setGame] = useState<InviteGame | null>(null);
  const [editedGame, setEditedGame] = useState<InviteGame | null>(null);
  const [attachments, setAttachments] = useState<InviteGameAttachment[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCommittee, setIsCommittee] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  const current = isEditing ? editedGame : game;

  // ============================================================================
  // Effects
  // ============================================================================

  useEffect(() => {
    if (inviteGameId) {
      fetchGame();
      fetchAttachments();
    }
  }, [inviteGameId]);

  // ============================================================================
  // API Functions
  // ============================================================================

  async function fetchGame() {
    setLoading(true);
    try {
      const response = await fetch(`/api/invite-games/${inviteGameId}`);
      const data = await response.json();

      if (response.ok) {
        setGame(data.game);
        setIsCommittee(data.isCommittee);
      } else {
        alert(data.error || 'Failed to load invite game');
        router.push('/invite-games');
      }
    } catch (error) {
      console.error('Error fetching invite game:', error);
      router.push('/invite-games');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAttachments() {
    if (!inviteGameId) return;
    try {
      const response = await fetch(`/api/invite-games/${inviteGameId}/attachments`);
      const data = await response.json();
      if (response.ok) {
        setAttachments(data.attachments || []);
      }
    } catch (error) {
      console.error('Error fetching attachments:', error);
    }
  }

  function handleUploadComplete() {
    fetchAttachments();
    setShowUploadForm(false);
    setMessage({ type: 'success', text: 'Attachment added successfully' });
  }

  async function saveGame() {
    if (!editedGame || !inviteGameId) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/invite-games/${inviteGameId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editedGame.title,
          description: editedGame.description,
          gameDate: editedGame.gameDate,
          closingDate: editedGame.closingDate,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: 'success', text: 'Game updated successfully' });
        setIsEditing(false);
        setGame(editedGame);
        setEditedGame(null);
        await fetchGame();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update game' });
      }
    } catch (error) {
      console.error('Error saving game:', error);
      setMessage({ type: 'error', text: 'Failed to save changes' });
    } finally {
      setIsSaving(false);
    }
  }

  function handleEdit() {
    if (!game) return;
    setEditedGame({ ...game });
    setIsEditing(true);
    setMessage(null);
  }

  function handleCancelEdit() {
    setConfirmDialog({
      isOpen: true,
      title: 'Discard Changes',
      message: 'Are you sure you want to discard your changes?',
      onConfirm: () => {
        setIsEditing(false);
        setEditedGame(null);
        setMessage(null);
        setConfirmDialog((d) => ({ ...d, isOpen: false }));
      },
    });
  }

  function handleDeleteGame() {
    setConfirmDialog({
      isOpen: true,
      title: 'Delete Invite Game',
      message: `Are you sure you want to delete "${game?.title}"? This will also delete all attachments and cannot be undone.`,
      onConfirm: async () => {
        setConfirmDialog((d) => ({ ...d, isOpen: false }));
        try {
          const response = await fetch(`/api/invite-games/${inviteGameId}`, {
            method: 'DELETE',
          });
          if (response.ok) {
            router.push('/invite-games');
          } else {
            const data = await response.json();
            alert(data.error || 'Failed to delete game');
          }
        } catch (error) {
          console.error('Error deleting game:', error);
          alert('Failed to delete game');
        }
      },
    });
  }

  function handleChange(field: keyof InviteGame, value: any) {
    if (!editedGame) return;
    setEditedGame({ ...editedGame, [field]: value });
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB');
    } catch {
      return dateStr;
    }
  };

  const formatDateForInput = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toISOString().split('T')[0];
    } catch {
      return '';
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            <p className="mt-2 text-gray-600">Loading...</p>
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
          <p className="text-center text-gray-600">Invite game not found</p>
        </div>
      </div>
    );
  }

  const isFormDisabled = !isEditing || isSaving;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={
          isCommittee && isEditing
            ? {
                primary: {
                  label: 'Save',
                  onClick: saveGame,
                  loading: isSaving,
                  variant: 'primary' as const,
                },
                secondary: {
                  label: 'Cancel',
                  onClick: handleCancelEdit,
                  disabled: isSaving,
                  variant: 'secondary' as const,
                },
              }
            : undefined
        }
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Link href="/invite-games" className="mb-4 text-blue-600 hover:text-blue-800 inline-block">← Back to Invite Games</Link>

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

        {/* Game Details Card */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1 mr-4">
              <span className="font-mono text-sm text-gray-500">{current.inviteGameId}</span>
              {isEditing ? (
                <input
                  type="text"
                  value={current.title}
                  onChange={(e) => handleChange('title', e.target.value)}
                  disabled={isFormDisabled}
                  className="mt-1 text-2xl font-bold w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                />
              ) : (
                <h1 className="text-2xl font-bold mt-1 text-gray-900">{current.title}</h1>
              )}
            </div>

            {isCommittee && !isEditing && (
              <div className="flex gap-2">
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
                >
                  Edit
                </button>
                <button
                  onClick={handleDeleteGame}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium text-sm"
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Game Date</label>
              {isEditing ? (
                <input
                  type="date"
                  value={formatDateForInput(current.gameDate)}
                  onChange={(e) => handleChange('gameDate', e.target.value || null)}
                  disabled={isFormDisabled}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                />
              ) : (
                <p className="text-gray-900">{formatDate(current.gameDate)}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Closing Date
              </label>
              {isEditing ? (
                <input
                  type="date"
                  value={formatDateForInput(current.closingDate)}
                  onChange={(e) => handleChange('closingDate', e.target.value || null)}
                  disabled={isFormDisabled}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
                />
              ) : (
                <p className="text-gray-900">{formatDate(current.closingDate)}</p>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            {isEditing ? (
              <textarea
                value={current.description}
                onChange={(e) => handleChange('description', e.target.value)}
                disabled={isFormDisabled}
                rows={6}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:opacity-50"
              />
            ) : (
              <div className="text-gray-900 whitespace-pre-wrap">
                {current.description || (
                  <span className="text-gray-400 italic">No description provided.</span>
                )}
              </div>
            )}
          </div>

          {/* Metadata footer */}
          <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-400">
            Added by {current.createdByFullName} on {formatDate(current.createdAt)}
            {current.updatedAt && current.updatedByUsername && (
              <span>
                {' '}· Last updated {formatDate(current.updatedAt)} by {current.updatedByUsername}
              </span>
            )}
          </div>
        </div>

        {/* Attachments Section */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900">Attachments</h2>
            {isCommittee && !showUploadForm && !isEditing && (
              <button
                onClick={() => setShowUploadForm(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Attachment
              </button>
            )}
          </div>

          {showUploadForm && (
            <div className="mb-6">
              <AttachmentUpload
                apiBasePath={`/api/invite-games/${inviteGameId}`}
                onUploadComplete={handleUploadComplete}
                onCancel={() => setShowUploadForm(false)}
              />
            </div>
          )}

          <AttachmentsList
            apiBasePath={`/api/invite-games/${inviteGameId}`}
            attachments={attachments}
            canDelete={isCommittee}
            onDelete={fetchAttachments}
          />
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((d) => ({ ...d, isOpen: false }))}
      />
    </div>
  );
}
