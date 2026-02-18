// app/invite-games/new/page.tsx
// Create new invite game (committee only)

'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

export default function NewInviteGamePage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [gameDate, setGameDate] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role || 'Member';
  const isCommittee = role !== 'Member' && role !== '';

  // Redirect non-committee members
  if (session && !isCommittee) {
    router.push('/invite-games');
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch('/api/invite-games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          gameDate: gameDate || null,
          closingDate: closingDate || null,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push(`/invite-games/${data.inviteGameId}`);
      } else {
        setError(data.error || 'Failed to create invite game');
      }
    } catch (err) {
      console.error('Error creating invite game:', err);
      setError('Failed to create invite game');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
      />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <button
          onClick={() => router.push('/invite-games')}
          className="mb-4 text-blue-600 hover:text-blue-800 flex items-center gap-1"
        >
          ← Back to Invite Games
        </button>

        <div className="bg-white rounded-lg shadow p-6">
          <h1 className="text-2xl font-bold mb-6">New Invite Game</h1>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Greenfield BC Open Day 2026"
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required
                disabled={saving}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details about the game, format, what to bring, etc."
                rows={5}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                disabled={saving}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Game Date
                </label>
                <input
                  type="date"
                  value={gameDate}
                  onChange={(e) => setGameDate(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  disabled={saving}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Closing Date
                </label>
                <input
                  type="date"
                  value={closingDate}
                  onChange={(e) => setClosingDate(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  disabled={saving}
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => router.push('/invite-games')}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {saving ? 'Creating...' : 'Create Game'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
