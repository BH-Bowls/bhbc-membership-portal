// app/fixtures/page.tsx
// Public fixtures view — all authenticated users can see all fixture types
// Type filter tabs, expandable game cards

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { Game, GameType, ALL_GAME_TYPES } from '@/lib/types/friendlies';

// Map URL-friendly slugs to GameType values and back
const SLUG_TO_TAB: Record<string, 'All' | GameType> = {
  all:    'All',
  nsa:    'N/S A',
  nsb:    'N/S B',
  msl:    'MSL',
  bl:     'BL',
  jsl:    'JSL',
  events: 'Event',
};
const TAB_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_TAB).map(([slug, tab]) => [tab, slug])
);

// Utility: format date as "Sat 25 Apr"
function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    const d = new Date(parseInt(ukMatch[3]), parseInt(ukMatch[2]) - 1, parseInt(ukMatch[1]));
    if (!isNaN(d.getTime())) {
      return `${dayNames[d.getDay()]} ${d.getDate()} ${monthNamesShort[d.getMonth()]}`;
    }
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return `${dayNames[d.getDay()]} ${d.getDate()} ${monthNamesShort[d.getMonth()]}`;
  }
  return dateStr;
}

function displayClubName(clubName: string, clubSuffix: string): string {
  return [clubName, clubSuffix].filter(Boolean).join(' ');
}

function gameTypeBadgeClasses(type: GameType): string {
  switch (type) {
    case 'Friendly': return 'bg-blue-100 text-blue-800';
    case 'N/S A': return 'bg-purple-100 text-purple-800';
    case 'N/S B': return 'bg-purple-100 text-purple-800';
    case 'MSL': return 'bg-indigo-100 text-indigo-800';
    case 'JSL': return 'bg-indigo-100 text-indigo-800';
    case 'BL': return 'bg-indigo-100 text-indigo-800';
    case 'Event': return 'bg-pink-100 text-pink-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}

function statusLabel(status: string): { label: string; classes: string } {
  switch (status) {
    case 'P': return { label: 'Played', classes: 'bg-green-100 text-green-800' };
    case 'C': return { label: 'Cancelled', classes: 'bg-red-100 text-red-800' };
    case 'A': return { label: 'Abandoned', classes: 'bg-orange-100 text-orange-800' };
    case 'O': return { label: 'Open', classes: 'bg-teal-100 text-teal-800' };
    case 'S': return { label: 'Selected', classes: 'bg-green-100 text-green-800' };
    default: return { label: 'Scheduled', classes: 'bg-blue-100 text-blue-800' };
  }
}

// ============================================================================
// Main Component
// ============================================================================

export default function FixturesPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab = SLUG_TO_TAB[searchParams.get('tab') ?? ''] ?? 'All';

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<'All' | GameType>(initialTab);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setTab = useCallback((tab: 'All' | GameType) => {
    setTypeFilter(tab);
    const slug = TAB_TO_SLUG[tab];
    const params = slug && slug !== 'all' ? `?tab=${slug}` : '';
    router.replace(`/fixtures${params}`, { scroll: false });
  }, [router]);

  const userRole = (session?.user as any)?.role || '';
  const isAdmin = userRole === 'Admin' || userRole === 'superadmin';
  const isCaptain = userRole === 'Captain';
  const canManage = isAdmin || isCaptain;

  useEffect(() => {
    if (status === 'loading') return;
    fetchGames();
  }, [status]);

  async function fetchGames() {
    setLoading(true);
    try {
      const res = await fetch('/api/fixtures/games');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setGames(data.games || []);
    } catch {
      setError('Failed to load fixtures');
    } finally {
      setLoading(false);
    }
  }

  const filteredGames = typeFilter === 'All'
    ? games
    : games.filter(g => g.gameType === typeFilter);

  const typeFilterOptions: ('All' | GameType)[] = ['All', ...ALL_GAME_TYPES];

  if (status === 'loading') return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={(session?.user as any)?.userName}
        userRole={userRole}
        showLogoOnly={isGuest}
      />

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Fixtures</h1>
            <p className="text-gray-500 text-sm mt-1">All club fixtures and results</p>
          </div>
          {canManage && (
            <Link
              href="/fixtures/manage"
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
            >
              Manage Fixtures
            </Link>
          )}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Type filter tabs */}
        <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
          {typeFilterOptions.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                typeFilter === t
                  ? 'border-green-600 text-green-700 bg-green-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Games list */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading fixtures…</div>
        ) : filteredGames.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No fixtures found.</div>
        ) : (
          <div className="space-y-2">
            {filteredGames.map(game => {
              const isExpanded = expandedRow === game.rowNumber;
              const st = statusLabel(game.status);
              const clubDisplay = displayClubName(game.clubName, game.clubSuffix);

              return (
                <div
                  key={game.rowNumber}
                  className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
                >
                  {/* Main row — click to expand */}
                  <button
                    className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedRow(isExpanded ? null : game.rowNumber)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 min-w-[120px]">
                        {formatDisplayDate(game.date)}
                      </span>
                      {game.time && (
                        <span className="text-gray-500 text-sm">{game.time}</span>
                      )}
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${gameTypeBadgeClasses(game.gameType)}`}>
                        {game.gameType}
                      </span>
                      <span className="font-semibold text-gray-800 flex-1">
                        {clubDisplay}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        game.homeAway === 'H' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                      }`}>
                        {game.homeAway === 'H' ? 'H' : 'A'}
                      </span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.classes}`}>
                        {st.label}
                      </span>
                      <span className="text-gray-400 text-xs ml-auto">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3 text-sm text-gray-600 space-y-1.5">
                      {game.format && (
                        <div><span className="font-medium text-gray-700">Format:</span> {game.format}</div>
                      )}
                      {game.ladiesMen && (
                        <div><span className="font-medium text-gray-700">Section:</span> {game.ladiesMen}</div>
                      )}
                      {game.dress && (
                        <div><span className="font-medium text-gray-700">Dress:</span> {game.dress}</div>
                      )}
                      {(game.status === 'P' || game.status === 'A') && game.bhbcScore !== null && game.opponentScore !== null && (
                        <div className="font-medium text-gray-800">
                          Score: BHBC {game.bhbcScore} – {game.opponentScore} {clubDisplay}
                        </div>
                      )}
                      {game.status === 'C' && game.reason && (
                        <div className="text-red-600">
                          Cancelled: {game.reason}{game.who ? ` (${game.who})` : ''}
                        </div>
                      )}
                      {game.status === 'A' && game.reason && (
                        <div className="text-orange-600">
                          Abandoned: {game.reason}{game.who ? ` (${game.who})` : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
