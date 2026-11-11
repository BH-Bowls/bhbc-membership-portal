// app/rowland/admin/page.tsx
// Committee admin — two tabs: Competitions (overview of all 4 Rowland comps, links to
// each one's setup page) and Entries (every club's Rowland Cup entry — teams, contacts,
// payment status and payments, "Withdraw"). Bank payments are matched on /banking's
// Rowland Cup tab; cash is recorded here with "Record cash payment". A payment not yet
// exported to Xero can be undone. Also reachable via the
// Navbar's "Rowland Admin" link (src/components/Navbar.tsx), not just /rowland's own
// "Manage" button.
//
// The Competitions tab also has "Set up next year" (Admin / Rowland organiser): creates
// next year's four competitions, Not Started with no teams. This year's draws stay as they
// are and become a past year on the /rowland year picker.

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
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

interface RowlandPayment {
  id: string;
  date: string;
  amountPence: number;
  source: 'banking' | 'cash';
  paymentIds: string;
  exported: boolean;
}

interface RowlandEntry {
  id: string;
  clubName: string;
  amountDuePence: number;
  amountReceivedPence: number;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
  teams: TeamEntry[];
  payments: RowlandPayment[];
}

function gbp(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
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
  const canStartYear = hasRole(role, 'Admin', 'RowlandOrganiser');

  const [tab, setTab] = useState<Tab>('competitions');

  // Competitions tab
  const [comps, setComps] = useState<RowlandComp[]>([]);
  const [compsLoading, setCompsLoading] = useState(true);
  const [compsError, setCompsError] = useState<string | null>(null);

  // Set up next year
  const [currentYear, setCurrentYear] = useState<number | null>(null);
  const [nextYear, setNextYear] = useState<number | null>(null);
  const [startYearOpen, setStartYearOpen] = useState(false);
  const [startingYear, setStartingYear] = useState(false);
  const [startYearError, setStartYearError] = useState<string | null>(null);
  const [startYearDone, setStartYearDone] = useState<string | null>(null);

  // Entries tab
  const [season, setSeason] = useState('');
  const [entries, setEntries] = useState<RowlandEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [entriesNotice, setEntriesNotice] = useState<string | null>(null);

  // Record cash payment
  const [cashEntry, setCashEntry] = useState<RowlandEntry | null>(null);
  const [cashAmount, setCashAmount] = useState('');
  const [cashSaving, setCashSaving] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  // Undo a payment
  const [undoPayment, setUndoPayment] = useState<{ entry: RowlandEntry; payment: RowlandPayment } | null>(null);
  const [undoSaving, setUndoSaving] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    if (session && !isCommittee) router.replace('/rowland');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isCommittee]);

  useEffect(() => {
    loadComps();
    loadEntries();
  }, []);

  function loadComps() {
    fetch('/api/rowland')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setComps(data.comps || []);
        setCurrentYear(data.currentYear || null);
        setNextYear(data.nextYear || null);
      })
      .catch((err) => setCompsError(err.message))
      .finally(() => setCompsLoading(false));
  }

  async function startYear() {
    if (nextYear === null) return;
    setStartingYear(true);
    setStartYearError(null);
    try {
      const res = await fetch('/api/rowland/start-year', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: nextYear }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set up the new year');
      setStartYearOpen(false);
      setStartYearDone(`${data.year} is set up. The ${data.year - 1} draws are still on the Rowland Cup page: pick ${data.year - 1} from the year list.`);
      loadComps();
    } catch (err) {
      setStartYearError(err instanceof Error ? err.message : 'Failed to set up the new year');
    } finally {
      setStartingYear(false);
    }
  }

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

  function openCashPayment(entry: RowlandEntry) {
    setCashError(null);
    setCashAmount(((entry.amountDuePence - entry.amountReceivedPence) / 100).toFixed(2));
    setCashEntry(entry);
  }

  async function saveCashPayment() {
    if (!cashEntry) return;
    const amountPence = Math.round(parseFloat(cashAmount) * 100);
    if (!(amountPence > 0)) {
      setCashError('Enter an amount more than £0');
      return;
    }
    setCashSaving(true);
    setCashError(null);
    try {
      const res = await fetch(`/api/rowland/entries/${cashEntry.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountPence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record the payment');
      let notice = `${cashEntry.clubName}: ${gbp(amountPence)} cash recorded — now ${data.paymentStatus}.`;
      if (data.paymentStatus === 'Paid') {
        notice += data.emailsSent > 0
          ? ` Payment received email sent to ${data.emailsSent} contact${data.emailsSent === 1 ? '' : 's'}.`
          : ' No payment received email was sent (email isn\'t set up, or no contacts).';
      }
      setEntriesNotice(notice);
      setCashEntry(null);
      loadEntries();
    } catch (err) {
      setCashError(err instanceof Error ? err.message : 'Failed to record the payment');
    } finally {
      setCashSaving(false);
    }
  }

  async function confirmUndoPayment() {
    if (!undoPayment) return;
    setUndoSaving(true);
    setUndoError(null);
    try {
      const res = await fetch(`/api/rowland/entries/${undoPayment.entry.id}/payment?txnId=${encodeURIComponent(undoPayment.payment.id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to undo the payment');
      setEntriesNotice(
        undoPayment.payment.source === 'banking'
          ? `${undoPayment.entry.clubName}: payment undone. ${undoPayment.payment.paymentIds || 'The bank payment'} is back in Banking, unmatched.`
          : `${undoPayment.entry.clubName}: cash payment undone.`
      );
      setUndoPayment(null);
      loadEntries();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : 'Failed to undo the payment');
    } finally {
      setUndoSaving(false);
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

            {startYearDone && (
              <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                {startYearDone}
              </div>
            )}

            {!compsLoading && !compsError && (
              <div className="flex items-center justify-between mb-4">
                {currentYear !== null ? <p className="text-sm text-gray-700">{currentYear} season</p> : <span />}
                {canStartYear && nextYear !== null && (
                  <button
                    onClick={() => { setStartYearError(null); setStartYearOpen(true); }}
                    className="px-3 py-1.5 text-xs font-medium border border-gray-300 bg-white text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    Set up {nextYear}
                  </button>
                )}
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

                {entriesNotice && (
                  <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex justify-between gap-3">
                    <span>{entriesNotice}</span>
                    <button onClick={() => setEntriesNotice(null)} className="font-bold" aria-label="Dismiss">×</button>
                  </div>
                )}

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
                          {entry.paymentStatus !== 'Paid' && (
                            <button
                              onClick={() => openCashPayment(entry)}
                              disabled={busyId === entry.id}
                              className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              Record cash payment
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

                      {entry.payments.length > 0 && (
                        <div className="mb-3 rounded border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                          <p className="text-xs font-medium text-gray-700 mb-1">Payments</p>
                          {entry.payments.map((p) => (
                            <div key={p.id} className="flex items-center justify-between gap-3 py-0.5">
                              <span className="text-gray-900">
                                {p.date} · {p.source === 'cash' ? 'Cash' : `Bank${p.paymentIds ? ` (${p.paymentIds})` : ''}`} · {gbp(p.amountPence)}
                              </span>
                              {p.exported ? (
                                <span className="text-xs text-gray-700">In Xero</span>
                              ) : (
                                <button
                                  onClick={() => { setUndoError(null); setUndoPayment({ entry, payment: p }); }}
                                  className="text-xs px-2 py-0.5 border border-gray-300 rounded text-gray-700 hover:bg-white"
                                >
                                  Undo
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

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

      {cashEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Record cash payment — {cashEntry.clubName}</h2>
            <div className="text-sm text-gray-700 space-y-2 mb-4">
              <p>They owe {gbp(cashEntry.amountDuePence - cashEntry.amountReceivedPence)}. A part payment is fine; the entry stays Partial until it&apos;s all paid.</p>
              <p>Only for cash. A bank transfer or cheque shows on the bank statement, so the Treasurer matches it in Banking.</p>
            </div>
            <label htmlFor="cash-amount" className="block text-sm font-medium text-gray-900 mb-1">Amount (£)</label>
            <input
              id="cash-amount"
              type="number"
              step="0.01"
              min="0"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2 text-gray-900 mb-3"
            />
            {cashError && <p className="text-sm text-red-700 mb-3">{cashError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setCashEntry(null)}
                disabled={cashSaving}
                className="px-4 py-2 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveCashPayment}
                disabled={cashSaving}
                className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {cashSaving ? 'Saving…' : 'Record payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {undoPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Undo this payment?</h2>
            <div className="text-sm text-gray-700 space-y-2 mb-4">
              <p>{undoPayment.entry.clubName}: {gbp(undoPayment.payment.amountPence)} on {undoPayment.payment.date}.</p>
              {undoPayment.payment.source === 'banking' && (
                <p>The bank payment goes back to Banking, unmatched, so it can be matched again.</p>
              )}
            </div>
            {undoError && <p className="text-sm text-red-700 mb-3">{undoError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setUndoPayment(null)}
                disabled={undoSaving}
                className="px-4 py-2 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmUndoPayment}
                disabled={undoSaving}
                className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {undoSaving ? 'Undoing…' : 'Undo payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {startYearOpen && nextYear !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Set up the {nextYear} Rowland Cup?</h2>
            <div className="text-sm text-gray-700 space-y-2 mb-4">
              <p>This adds the four {nextYear} competitions, Not Started with no teams or dates. Entries aren&apos;t affected.</p>
              <p>{nextYear} becomes the year shown on the Rowland Cup page. The {nextYear - 1} draws and results stay as they are; pick {nextYear - 1} from the year list to see them. They can&apos;t be changed after this.</p>
              <p className="font-medium text-gray-900">Only do this once the {nextYear - 1} finals have been played.</p>
            </div>
            {startYearError && <p className="text-sm text-red-700 mb-3">{startYearError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setStartYearOpen(false)}
                disabled={startingYear}
                className="px-4 py-2 text-sm rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={startYear}
                disabled={startingYear}
                className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {startingYear ? 'Setting up…' : `Set up ${nextYear}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
