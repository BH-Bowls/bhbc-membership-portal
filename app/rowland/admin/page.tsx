// app/rowland/admin/page.tsx
// Committee admin — two tabs: Competitions (overview of all 4 Rowland comps, links to
// each one's setup page) and Entries (every club's Rowland Cup entry — teams, contacts,
// payment status; manual "Mark Paid"/"Withdraw" actions until real bank-rec matching
// exists — see Specs/ROWLAND_TEAM_ENTRY_SPEC.md §7, deferred). Also reachable via the
// Navbar's "Rowland Admin" link (src/components/Navbar.tsx), not just /rowland's own
// "Manage" button.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import type { RowlandComp, RowlandCompStatus } from '@/types/rowland';
import { ROWLAND_COMP_NAMES } from '@/types/rowland';

type Tab = 'competitions' | 'entries';

const STATUS_STYLES: Record<RowlandCompStatus, string> = {
  'Not Started': 'bg-gray-100 text-gray-600',
  'Draw Done':   'bg-yellow-100 text-yellow-700',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Complete':    'bg-green-100 text-green-700',
};

interface TeamEntry {
  id: string;
  trophy: 'edward' | 'gladys';
  teamNumber: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  status: 'Entered' | 'Withdrawn';
}

interface RowlandEntry {
  id: string;
  clubName: string;
  amountDuePence: number;
  amountReceivedPence: number;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
  teams: TeamEntry[];
}

const PAYMENT_STYLES: Record<RowlandEntry['paymentStatus'], string> = {
  Unpaid: 'bg-red-100 text-red-700',
  Partial: 'bg-yellow-100 text-yellow-700',
  Paid: 'bg-green-100 text-green-700',
};

export default function RowlandAdminPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '';

  const [tab, setTab] = useState<Tab>('competitions');

  // Competitions tab
  const [comps, setComps] = useState<RowlandComp[]>([]);
  const [compsLoading, setCompsLoading] = useState(true);
  const [compsError, setCompsError] = useState<string | null>(null);

  // Entries tab
  const [season, setSeason] = useState('');
  const [entries, setEntries] = useState<RowlandEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (session && !isCommittee) router.replace('/rowland');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isCommittee]);

  useEffect(() => {
    fetch('/api/rowland')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setComps(data.comps || []);
      })
      .catch((err) => setCompsError(err.message))
      .finally(() => setCompsLoading(false));

    loadEntries();
  }, []);

  function loadEntries() {
    setEntriesLoading(true);
    fetch('/api/rowland/entries')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSeason(data.season || '');
        setEntries(data.entries || []);
      })
      .catch((err) => setEntriesError(err.message))
      .finally(() => setEntriesLoading(false));
  }

  async function setPaymentStatus(entryId: string, newStatus: 'Paid' | 'Unpaid') {
    setBusyId(entryId);
    try {
      const res = await fetch(`/api/rowland/entries/${entryId}/payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update payment status');
      loadEntries();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update payment status');
    } finally {
      setBusyId(null);
    }
  }

  async function setTeamStatus(teamEntryId: string, newStatus: 'Entered' | 'Withdrawn') {
    setBusyId(teamEntryId);
    try {
      const res = await fetch(`/api/rowland/entries/team/${teamEntryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update team status');
      loadEntries();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update team status');
    } finally {
      setBusyId(null);
    }
  }

  async function withdrawWholeClub(entry: RowlandEntry) {
    if (!confirm(`Withdraw all ${entry.teams.filter((t) => t.status === 'Entered').length} team(s) entered by ${entry.clubName}?`)) return;
    setBusyId(entry.id);
    try {
      for (const team of entry.teams) {
        if (team.status === 'Entered') {
          await fetch(`/api/rowland/entries/team/${team.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'Withdrawn' }),
          });
        }
      }
      loadEntries();
    } finally {
      setBusyId(null);
    }
  }

  // Group by cup (Edward / Gladys)
  const edward = comps.filter((c) => c.compId.startsWith('edward'));
  const gladys = comps.filter((c) => c.compId.startsWith('gladys'));

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="mb-6">
          <button
            onClick={() => router.push('/rowland')}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← Rowland Cup
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Rowland Cup Admin</h1>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 flex gap-6 mb-6">
          {(['competitions', 'entries'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'competitions' ? 'Competitions' : 'Entries'}
            </button>
          ))}
        </div>

        {/* ── Competitions tab ── */}
        {tab === 'competitions' && (
          <>
            {compsLoading && <div className="text-center py-12 text-gray-400">Loading…</div>}
            {compsError && (
              <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                {compsError}
              </div>
            )}

            {!compsLoading && !compsError && (
              <div className="space-y-6">
                {[
                  { label: 'Edward Cup', items: edward },
                  { label: 'Gladys Cup', items: gladys },
                ].map(({ label, items }) => {
                  if (items.length === 0) return null;
                  return (
                    <div key={label}>
                      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        {label}
                      </h2>
                      <div className="space-y-2">
                        {items.map((comp) => (
                          <div
                            key={comp.compId}
                            className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-center justify-between"
                          >
                            <div className="flex items-center gap-3">
                              <span className="font-medium text-gray-900">
                                {ROWLAND_COMP_NAMES[comp.compId] ?? comp.compName}
                              </span>
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[comp.status]}`}>
                                {comp.status}
                              </span>
                              {comp.numTeams > 0 && (
                                <span className="text-xs text-gray-500">{comp.numTeams} teams</span>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => router.push(`/rowland/${comp.compId}`)}
                                className="px-3 py-1.5 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50"
                              >
                                View
                              </button>
                              <button
                                onClick={() => router.push(`/rowland/${comp.compId}/setup`)}
                                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                              >
                                Manage
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Entries tab ── */}
        {tab === 'entries' && (
          <>
            {entriesLoading && <div className="text-center py-12 text-gray-400">Loading…</div>}
            {entriesError && <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{entriesError}</div>}

            {!entriesLoading && !entriesError && (
              <>
                <div className="flex items-center justify-between mb-3">
                  {season ? <p className="text-xs text-gray-500">Season {season}</p> : <span />}
                  <button
                    onClick={() => router.push('/rowland/enter?from=admin')}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Add Entry
                  </button>
                </div>

                {entries.length === 0 && (
                  <div className="text-center py-12 text-gray-400">No entries yet.</div>
                )}

                {entries.map((entry) => {
                  const activeTeams = entry.teams.filter((t) => t.status === 'Entered');
                  return (
                    <div key={entry.id} className="bg-white rounded-lg border border-gray-200 p-5 mb-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                        <div>
                          <h2 className="font-semibold text-gray-900">{entry.clubName}</h2>
                          <p className="text-sm text-gray-700">
                            {activeTeams.length} team{activeTeams.length !== 1 ? 's' : ''} entered
                            {entry.teams.length !== activeTeams.length && ` (${entry.teams.length - activeTeams.length} withdrawn)`}
                            {' — '}£{(entry.amountReceivedPence / 100).toFixed(2)} of £{(entry.amountDuePence / 100).toFixed(2)} received
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2 py-1 rounded-full ${PAYMENT_STYLES[entry.paymentStatus]}`}>
                            {entry.paymentStatus}
                          </span>
                          {entry.paymentStatus === 'Paid' ? (
                            <button
                              onClick={() => setPaymentStatus(entry.id, 'Unpaid')}
                              disabled={busyId === entry.id}
                              className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Undo
                            </button>
                          ) : (
                            <button
                              onClick={() => setPaymentStatus(entry.id, 'Paid')}
                              disabled={busyId === entry.id}
                              className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              Mark Paid
                            </button>
                          )}
                          {activeTeams.length > 0 && (
                            <button
                              onClick={() => withdrawWholeClub(entry)}
                              disabled={busyId === entry.id}
                              className="text-xs px-2 py-1 border border-red-300 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              Suspend Club
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="divide-y divide-gray-100">
                        {entry.teams.map((team) => (
                          <div key={team.id} className={`flex items-center justify-between py-2 text-sm ${team.status === 'Withdrawn' ? 'opacity-50' : ''}`}>
                            <div>
                              <span className="font-medium text-gray-900">
                                {team.trophy === 'edward' ? 'Edward' : 'Gladys'} — Team {team.teamNumber}
                              </span>
                              {team.status === 'Withdrawn' && <span className="ml-2 text-xs text-red-600">Withdrawn</span>}
                              <span className="ml-3 text-gray-700">{team.contactName} · {team.contactPhone} · {team.contactEmail}</span>
                            </div>
                            <button
                              onClick={() => setTeamStatus(team.id, team.status === 'Entered' ? 'Withdrawn' : 'Entered')}
                              disabled={busyId === team.id}
                              className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-700 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                            >
                              {team.status === 'Entered' ? 'Withdraw' : 'Reinstate'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
