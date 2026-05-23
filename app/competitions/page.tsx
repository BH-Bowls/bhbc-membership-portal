// app/competitions/page.tsx
// Competitions list page — loads live data from API

'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { Competition, CompStatus, CompType } from '@/types/competitions';

const STATUS_STYLES: Record<CompStatus, { badge: string; label: string }> = {
  'Not Started': { badge: 'bg-gray-100 text-gray-600',     label: 'Not Started' },
  'Draw Done':   { badge: 'bg-yellow-100 text-yellow-700', label: 'Draw Done' },
  'In Progress': { badge: 'bg-blue-100 text-blue-700',     label: 'In Progress' },
  'Complete':    { badge: 'bg-green-100 text-green-700',   label: 'Complete' },
};

const TYPE_LABELS: Record<CompType, string> = {
  singles: 'Singles',
  pairs:   'Pairs',
  triples: 'Triples',
};

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

export default function CompetitionsPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '' && role !== 'Kiosk';

  const [message, setMessage] = useState('');
  const [editingMessage, setEditingMessage] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/competitions')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCompetitions(data.competitions || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    fetch('/api/competitions/message')
      .then((r) => r.json())
      .then((data) => { if (typeof data.message === 'string') setMessage(data.message); })
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
      const res = await fetch('/api/competitions/message', {
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

  const groups: { heading: string; statuses: CompStatus[] }[] = [
    { heading: 'In Progress', statuses: ['In Progress'] },
    { heading: 'Draw Done',   statuses: ['Draw Done'] },
    { heading: 'Not Started', statuses: ['Not Started'] },
    { heading: 'Complete',    statuses: ['Complete'] },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        showLogoOnly={isGuest}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Competitions</h1>
            {competitions.find((c) => c.finalsDate) && (
              <p className="text-gray-500 mt-1 text-sm">
                Finals weekend:{' '}
                {formatDate(competitions.find((c) => c.finalsDate)?.finalsDate ?? null)}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            {!!role && role !== 'Kiosk' && (
              <button
                onClick={() => router.push('/competitions/my')}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 font-medium text-sm cursor-pointer"
              >
                My Progress
              </button>
            )}
            {isCommittee && (
              <button
                onClick={() => router.push('/competitions/admin')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium text-sm"
              >
                Manage
              </button>
            )}
          </div>
        </div>

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

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading competitions…</div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && competitions.length === 0 && (
          <div className="text-center py-12 text-gray-400">No competitions found.</div>
        )}

        {!loading && !error && groups.map(({ heading, statuses }) => {
          const comps = competitions.filter((c) => statuses.includes(c.status));
          if (comps.length === 0) return null;
          return (
            <div key={heading} className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {heading}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {comps.map((comp) => {
                  const { badge, label } = STATUS_STYLES[comp.status];
                  return (
                    <button
                      key={comp.compId}
                      onClick={() => router.push(`/competitions/${comp.compId}`)}
                      title={`View ${comp.displayName} draw`}
                      className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">{comp.displayName}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{TYPE_LABELS[comp.compType]}</p>
                          {comp.compDescription && (
                            <p className="text-xs text-gray-700 mt-1">{comp.compDescription}</p>
                          )}
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge}`}>
                          {label}
                        </span>
                      </div>

                      {comp.finalsDate && comp.status !== 'Not Started' && (
                        <p className="text-xs text-gray-400 mt-2">
                          Final: {formatDate(comp.finalsDate)}
                        </p>
                      )}

                      {comp.triplesFixedDay && comp.triplesFixedDate && (
                        <p className="text-xs text-blue-600 mt-1">
                          First games day: {formatDate(comp.triplesFixedDate)}
                        </p>
                      )}
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
