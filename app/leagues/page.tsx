// app/leagues/page.tsx
// Public leagues home — card list of all leagues with editable message panel

'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { League, LeagueStatus } from '@/types/leagues';

const STATUS_STYLES: Record<LeagueStatus, { badge: string; label: string }> = {
  'Not Started':  { badge: 'bg-gray-100 text-gray-600',     label: 'Not Started' },
  'Entries Open': { badge: 'bg-yellow-100 text-yellow-700', label: 'Entries Open' },
  'In Progress':  { badge: 'bg-blue-100 text-blue-700',     label: 'In Progress' },
  'Complete':     { badge: 'bg-green-100 text-green-700',   label: 'Complete' },
};

const GROUP_ORDER: { heading: string; statuses: LeagueStatus[] }[] = [
  { heading: 'In Progress',  statuses: ['In Progress'] },
  { heading: 'Entries Open', statuses: ['Entries Open'] },
  { heading: 'Not Started',  statuses: ['Not Started'] },
  { heading: 'Complete',     statuses: ['Complete'] },
];

export default function LeaguesPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '' && role !== 'Kiosk' && role !== 'Club';

  const [leagues, setLeagues] = useState<League[]>([]);
  const [enteredLeagueIds, setEnteredLeagueIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Message panel
  const [message, setMessage] = useState('');
  const [editingMessage, setEditingMessage] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/leagues')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLeagues(data.leagues || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    fetch('/api/leagues/message')
      .then((r) => r.json())
      .then((data) => { if (typeof data.message === 'string') setMessage(data.message); })
      .catch(() => {});

    fetch('/api/leagues/my-entries')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data.leagueIds)) setEnteredLeagueIds(new Set(data.leagueIds)); })
      .catch(() => {});
  }, []);

  function startEditMessage() {
    setEditDraft(message);
    setEditingMessage(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function saveMessage() {
    setSavingMessage(true);
    try {
      const res = await fetch('/api/leagues/message', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: editDraft }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setMessage(editDraft);
      setEditingMessage(false);
    } catch {
      alert('Failed to save message. Please try again.');
    } finally {
      setSavingMessage(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={role}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Club Leagues</h1>

        {/* Message panel */}
        {(message || isCommittee) && (
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            {editingMessage ? (
              <div className="space-y-2">
                <textarea
                  ref={textareaRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={4}
                  className="w-full border border-blue-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                  placeholder="Enter a message for all members…"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setEditingMessage(false)}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveMessage}
                    disabled={savingMessage}
                    className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingMessage ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-4">
                {message ? (
                  <p className="text-sm text-blue-900 whitespace-pre-wrap">{message}</p>
                ) : (
                  <p className="text-sm text-blue-400 italic">No message set. Click Edit to add one.</p>
                )}
                {isCommittee && (
                  <button
                    onClick={startEditMessage}
                    className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Edit
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {loading && <div className="text-center py-12 text-gray-400">Loading…</div>}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && leagues.length === 0 && (
          <div className="text-center py-12 text-gray-400">No leagues set up yet.</div>
        )}

        {!loading && !error && GROUP_ORDER.map(({ heading, statuses }) => {
          const group = leagues.filter((l) => statuses.includes(l.status));
          if (group.length === 0) return null;
          return (
            <div key={heading} className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {heading}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.map((league) => {
                  const { badge, label } = STATUS_STYLES[league.status];
                  const isEntered = enteredLeagueIds.has(league.leagueId);
                  return (
                    <button
                      key={league.leagueId}
                      onClick={() => router.push(`/leagues/${league.leagueId}`)}
                      className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{league.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5 capitalize">{league.type} · {league.season}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge}`}>
                            {label}
                          </span>
                          {isEntered && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                              Entered
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
