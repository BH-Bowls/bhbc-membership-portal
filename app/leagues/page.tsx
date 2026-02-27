// app/leagues/page.tsx
// League Management page — Captain/Admin only
// View and record results for N/S A, N/S B, MSL, JSL, BL league games

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Game, GameType, LEAGUE_GAME_TYPES } from '@/lib/types/friendlies';
import { getButtonClasses } from '@/config/theme-helpers';

// Utility: format date as "Sat 25 Apr"
function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Try DD/MM/YYYY
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
    if (!isNaN(d.getTime())) {
      return `${dayNames[d.getDay()]} ${d.getDate()} ${monthNamesShort[d.getMonth()]}`;
    }
  }
  // Try ISO
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${dayNames[d.getDay()]} ${d.getDate()} ${monthNamesShort[d.getMonth()]}`;
  }
  return dateStr;
}

function displayClubName(clubName: string, clubSuffix: string): string {
  return [clubName, clubSuffix].filter(Boolean).join(' ');
}

function statusLabel(status: string): { label: string; classes: string } {
  switch (status) {
    case 'P': return { label: 'Played', classes: 'bg-green-100 text-green-800' };
    case 'C': return { label: 'Cancelled', classes: 'bg-red-100 text-red-800' };
    case 'A': return { label: 'Abandoned', classes: 'bg-orange-100 text-orange-800' };
    default: return { label: 'Scheduled', classes: 'bg-blue-100 text-blue-800' };
  }
}

// ============================================================================
// Outcome Dialog
// ============================================================================

interface OutcomeDialogState {
  isOpen: boolean;
  rowNumber: number;
  tabName: string;
  clubName: string;
  action: 'played' | 'cancel' | 'abandon' | '';
  bhbcScore: string;
  opponentScore: string;
  reason: string;
  who: 'Burgess Hill' | 'Opponent' | '';
}

const defaultOutcome: OutcomeDialogState = {
  isOpen: false,
  rowNumber: 0,
  tabName: '',
  clubName: '',
  action: '',
  bhbcScore: '',
  opponentScore: '',
  reason: '',
  who: '',
};

// ============================================================================
// Main Component
// ============================================================================

export default function LeagueManagementPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<GameType>('N/S A');
  const [outcome, setOutcome] = useState<OutcomeDialogState>(defaultOutcome);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userRole = (session?.user as any)?.role || '';
  const isAdmin = userRole === 'Admin' || userRole === 'superadmin';
  const isCaptain = userRole === 'Captain';
  const canAccess = isAdmin || isCaptain;

  useEffect(() => {
    if (session === null) {
      router.push('/');
      return;
    }
    if (session && !canAccess) {
      router.push('/');
      return;
    }
    if (session && canAccess) {
      fetchGames();
    }
  }, [session, canAccess]);

  async function fetchGames() {
    setLoading(true);
    try {
      const res = await fetch('/api/leagues/manage/games');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setGames(data.games || []);
    } catch {
      setError('Failed to load league games');
    } finally {
      setLoading(false);
    }
  }

  const gamesForTab = games.filter(g => g.gameType === activeTab);

  function openOutcomeDialog(game: Game) {
    setOutcome({
      ...defaultOutcome,
      isOpen: true,
      rowNumber: game.rowNumber,
      tabName: game.tabName,
      clubName: displayClubName(game.clubName, game.clubSuffix),
    });
  }

  async function submitOutcome() {
    if (!outcome.action) return;
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, any> = {
        rowNumber: outcome.rowNumber,
        tabName: outcome.tabName,
        action: outcome.action,
      };

      if (outcome.action === 'played' || outcome.action === 'abandon') {
        body.bhbc_score = parseInt(outcome.bhbcScore);
        body.opponent_score = parseInt(outcome.opponentScore);
      }
      if (outcome.action === 'cancel' || outcome.action === 'abandon') {
        body.reason = outcome.reason;
        body.who = outcome.who;
      }

      const res = await fetch('/api/leagues/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update');
      }

      setOutcome(defaultOutcome);
      await fetchGames();
    } catch (err: any) {
      setError(err.message || 'Failed to record result');
    } finally {
      setSubmitting(false);
    }
  }

  if (!session || !canAccess) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={(session?.user as any)?.userName}
        userRole={userRole}
      />

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
            ← Back to Home
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">League Management</h1>
          <p className="text-gray-500 text-sm mt-1">Record results for league fixtures</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Type tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {LEAGUE_GAME_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === type
                  ? 'border-green-600 text-green-700 bg-green-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Games list */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading games…</div>
        ) : gamesForTab.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No {activeTab} fixtures found.
          </div>
        ) : (
          <div className="space-y-3">
            {gamesForTab.map(game => {
              const st = statusLabel(game.status);
              const clubDisplay = displayClubName(game.clubName, game.clubSuffix);
              const canRecord = !['P', 'C'].includes(game.status);

              return (
                <div
                  key={game.rowNumber}
                  className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {/* Game info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-semibold text-gray-900">
                          {formatDisplayDate(game.date)}
                          {game.time ? ` · ${game.time}` : ''}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          game.homeAway === 'H' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {game.homeAway === 'H' ? 'Home' : 'Away'}
                        </span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.classes}`}>
                          {st.label}
                        </span>
                      </div>
                      <div className="text-gray-700 font-medium">{clubDisplay}</div>
                      {(game.status === 'P' || game.status === 'A') && game.bhbcScore !== null && game.opponentScore !== null && (
                        <div className="text-sm text-gray-600 mt-1">
                          BHBC {game.bhbcScore} – {game.opponentScore} {clubDisplay}
                        </div>
                      )}
                      {game.status === 'C' && game.reason && (
                        <div className="text-sm text-gray-500 mt-1">
                          Cancelled: {game.reason}
                          {game.who ? ` (${game.who})` : ''}
                        </div>
                      )}
                    </div>

                    {/* Action button */}
                    {canRecord && (
                      <button
                        onClick={() => openOutcomeDialog(game)}
                        className={getButtonClasses('primary', 'sm')}
                      >
                        Record Result
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Outcome Dialog */}
      {outcome.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Record Result</h2>
              <p className="text-sm text-gray-500 mt-1">{outcome.clubName}</p>
            </div>

            <div className="p-5 space-y-4">
              {/* Action selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Outcome</label>
                <div className="flex gap-2 flex-wrap">
                  {(['played', 'cancel', 'abandon'] as const).map(a => (
                    <button
                      key={a}
                      onClick={() => setOutcome(prev => ({ ...prev, action: a }))}
                      className={`px-3 py-1.5 rounded-lg border text-sm font-medium capitalize ${
                        outcome.action === a
                          ? 'border-green-600 bg-green-50 text-green-700'
                          : 'border-gray-300 text-gray-600 hover:border-gray-400'
                      }`}
                    >
                      {a === 'played' ? 'Played' : a === 'cancel' ? 'Cancelled' : 'Abandoned'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scores */}
              {(outcome.action === 'played' || outcome.action === 'abandon') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">BHBC Score</label>
                    <input
                      type="number"
                      min="0"
                      value={outcome.bhbcScore}
                      onChange={e => setOutcome(prev => ({ ...prev, bhbcScore: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Opponent Score</label>
                    <input
                      type="number"
                      min="0"
                      value={outcome.opponentScore}
                      onChange={e => setOutcome(prev => ({ ...prev, opponentScore: e.target.value }))}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Reason */}
              {(outcome.action === 'cancel' || outcome.action === 'abandon') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <input
                      type="text"
                      value={outcome.reason}
                      onChange={e => setOutcome(prev => ({ ...prev, reason: e.target.value }))}
                      placeholder="e.g. Waterlogged green"
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Cancelled by</label>
                    <div className="flex gap-3">
                      {(['Burgess Hill', 'Opponent'] as const).map(w => (
                        <label key={w} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="who"
                            value={w}
                            checked={outcome.who === w}
                            onChange={() => setOutcome(prev => ({ ...prev, who: w }))}
                          />
                          <span className="text-sm">{w}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>

            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setOutcome(defaultOutcome)}
                className={getButtonClasses('secondary', 'md')}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                onClick={submitOutcome}
                disabled={submitting || !outcome.action}
                className={getButtonClasses('primary', 'md')}
              >
                {submitting ? 'Saving…' : 'Save Result'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
