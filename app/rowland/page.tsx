// app/rowland/page.tsx
// Rowland Cup home — card grid like /competitions, with editable message panel

'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { RowlandComp, RowlandCompStatus } from '@/types/rowland';
import { ROWLAND_COMP_NAMES } from '@/types/rowland';

const LS_KEY = 'rowland_selected_club';

const ROWLAND_GUEST_BUTTONS = (
  <>
    <a href="/clublogin" className="px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors">Club Login</a>
    <a href="/login"     className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600  hover:bg-blue-700  rounded-md transition-colors">Member Login</a>
  </>
);

const STATUS_STYLES: Record<RowlandCompStatus, { badge: string; label: string }> = {
  'Not Started': { badge: 'bg-gray-100 text-gray-600',     label: 'Not Started' },
  'Draw Done':   { badge: 'bg-yellow-100 text-yellow-700', label: 'Draw Done' },
  'In Progress': { badge: 'bg-blue-100 text-blue-700',     label: 'In Progress' },
  'Complete':    { badge: 'bg-green-100 text-green-700',   label: 'Complete' },
};

const GROUP_ORDER: { heading: string; statuses: RowlandCompStatus[] }[] = [
  { heading: 'In Progress', statuses: ['In Progress'] },
  { heading: 'Draw Done',   statuses: ['Draw Done'] },
  { heading: 'Not Started', statuses: ['Not Started'] },
  { heading: 'Complete',    statuses: ['Complete'] },
];

export default function RowlandPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== 'Kiosk' && role !== 'Club' && role !== '';

  const [comps, setComps] = useState<RowlandComp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Club selector (for guests / non-club members)
  const isClubSession = role === 'Club' || role.split(',').map(r => r.trim()).includes('RowlandPlayer');
  const [clubs, setClubs] = useState<{ clubId: string; clubName: string }[]>([]);
  const [selectedClub, setSelectedClub] = useState<{ clubId: string; clubName: string } | null>(null);
  const [guestContactName, setGuestContactName] = useState('');
  const [contactNameInput, setContactNameInput] = useState('');

  // Message panel
  const [message, setMessage] = useState('');
  const [editingMessage, setEditingMessage] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/rowland')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setComps(data.comps || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    fetch('/api/rowland/message')
      .then((r) => r.json())
      .then((data) => { if (typeof data.message === 'string') setMessage(data.message); })
      .catch(() => {});

    // Load club list for selector (only needed if not logged in as a club)
    if (!isClubSession) {
      fetch('/api/rowland/participants')
        .then((r) => r.json())
        .then((data) => { if (data.clubs) setClubs(data.clubs); })
        .catch(() => {});

      // Restore previous selection from localStorage
      try {
        const stored = localStorage.getItem(LS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          setSelectedClub({ clubId: parsed.clubId, clubName: parsed.clubName });
          if (parsed.contactName) {
            setGuestContactName(parsed.contactName);
            setContactNameInput(parsed.contactName);
          }
        }
      } catch {}
    }
  }, [isClubSession]);

  function saveName() {
    const name = contactNameInput.trim();
    if (!name || !selectedClub) return;
    setGuestContactName(name);
    try { localStorage.setItem(LS_KEY, JSON.stringify({ ...selectedClub, contactName: name })); } catch {}
  }

  function startEditMessage() {
    setEditDraft(message);
    setEditingMessage(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  async function saveMessage() {
    setSavingMessage(true);
    try {
      const res = await fetch('/api/rowland/message', {
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
        showLogoOnly={isGuest}
        guestButtons={ROWLAND_GUEST_BUTTONS}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Rowland Cup</h1>

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
                  placeholder="Enter a message for all clubs and members…"
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

        {/* Club selector — shown to guests and non-club members */}
        {!isClubSession && clubs.length > 0 && (
          <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Which club are you from? Select yours to see your next match on each draw.
            </p>
            {selectedClub ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-900 font-medium">
                    {selectedClub.clubName}{guestContactName ? ` · ${guestContactName}` : ''}
                  </span>
                  <button
                    onClick={() => {
                      setSelectedClub(null);
                      setGuestContactName('');
                      setContactNameInput('');
                      try { localStorage.removeItem(LS_KEY); } catch {}
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Change
                  </button>
                </div>
                {isGuest && !guestContactName && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={contactNameInput}
                      onChange={(e) => setContactNameInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveName(); }}
                      placeholder="Your name…"
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm max-w-xs"
                    />
                    <button
                      onClick={saveName}
                      disabled={!contactNameInput.trim()}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <select
                defaultValue=""
                onChange={(e) => {
                  const club = clubs.find((c) => c.clubId === e.target.value) ?? null;
                  setSelectedClub(club);
                  setGuestContactName('');
                  setContactNameInput('');
                  try {
                    if (club) localStorage.setItem(LS_KEY, JSON.stringify(club));
                  } catch {}
                }}
                className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full max-w-xs"
              >
                <option value="" disabled>Select your club…</option>
                {clubs.map((c) => (
                  <option key={c.clubId} value={c.clubId}>{c.clubName}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {loading && (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && comps.length === 0 && (
          <div className="text-center py-12 text-gray-400">No competitions set up yet.</div>
        )}

        {!loading && !error && GROUP_ORDER.map(({ heading, statuses }) => {
          const group = comps.filter((c) => statuses.includes(c.status));
          if (group.length === 0) return null;
          return (
            <div key={heading} className="mb-8">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                {heading}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {group.map((comp) => {
                  const { badge, label } = STATUS_STYLES[comp.status];
                  return (
                    <button
                      key={comp.compId}
                      onClick={() => router.push(`/rowland/${comp.compId}`)}
                      title={`View ${ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName} bracket`}
                      className="bg-white rounded-lg border border-gray-200 p-4 text-left hover:shadow-md hover:border-gray-300 transition-all cursor-pointer"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName}
                          </p>
                          {comp.season && (
                            <p className="text-xs text-gray-500 mt-0.5">{comp.season}</p>
                          )}
                        </div>
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${badge}`}>
                          {label}
                        </span>
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
