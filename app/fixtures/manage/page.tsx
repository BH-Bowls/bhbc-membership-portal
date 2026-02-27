// app/fixtures/manage/page.tsx
// Fixtures Management — Captain/Admin CRUD for Games sheet rows

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Game, GameType, ALL_GAME_TYPES } from '@/lib/types/friendlies';
import { getButtonClasses } from '@/config/theme-helpers';

// ============================================================================
// Utilities
// ============================================================================

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

// Convert DD/MM/YYYY or other formats to YYYY-MM-DD for <input type="date">
function toDateInputValue(dateStr: string): string {
  if (!dateStr) return '';
  const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ukMatch) {
    return `${ukMatch[3]}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  }
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return dateStr;
  return '';
}

function statusBadge(status: string): string {
  switch (status) {
    case 'P': return 'bg-green-100 text-green-800';
    case 'C': return 'bg-red-100 text-red-800';
    case 'A': return 'bg-orange-100 text-orange-800';
    case 'O': return 'bg-teal-100 text-teal-800';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function statusText(status: string): string {
  switch (status) {
    case 'P': return 'Played';
    case 'C': return 'Cancelled';
    case 'A': return 'Abandoned';
    case 'O': return 'Open';
    case 'S': return 'Selected';
    case 'X': return 'Closed';
    default: return 'Scheduled';
  }
}

// ============================================================================
// Fixture Form Data
// ============================================================================

interface FixtureFormData {
  date: string;
  time: string;
  type: GameType;
  clubName: string;
  clubSuffix: string;
  homeAway: 'H' | 'A';
  format: string;
  ladiesMen: string;
  dress: string;
  paired: string;
  maxPlayers: string;
}

const defaultFormData: FixtureFormData = {
  date: '',
  time: '',
  type: 'Friendly',
  clubName: '',
  clubSuffix: '',
  homeAway: 'H',
  format: '',
  ladiesMen: '',
  dress: '',
  paired: '',
  maxPlayers: '',
};

// ============================================================================
// Add/Edit Modal
// ============================================================================

interface FixtureModalProps {
  isOpen: boolean;
  editGame: Game | null;
  onClose: () => void;
  onSave: (data: FixtureFormData) => Promise<void>;
  saving: boolean;
  error: string | null;
}

function FixtureModal({ isOpen, editGame, onClose, onSave, saving, error }: FixtureModalProps) {
  const [form, setForm] = useState<FixtureFormData>(defaultFormData);

  useEffect(() => {
    if (editGame) {
      setForm({
        date: toDateInputValue(editGame.date),
        time: editGame.time || '',
        type: editGame.gameType || 'Friendly',
        clubName: editGame.clubName || '',
        clubSuffix: editGame.clubSuffix || '',
        homeAway: editGame.homeAway || 'H',
        format: editGame.format || '',
        ladiesMen: editGame.ladiesMen || '',
        dress: editGame.dress || '',
        paired: editGame.paired || '',
        maxPlayers: editGame.maxPlayers ? String(editGame.maxPlayers) : '',
      });
    } else {
      setForm(defaultFormData);
    }
  }, [editGame, isOpen]);

  if (!isOpen) return null;

  const set = (field: keyof FixtureFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">
            {editGame ? 'Edit Fixture' : 'Add Fixture'}
          </h2>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input
                type="date"
                value={form.date}
                onChange={set('date')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {/* Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time</label>
              <input
                type="time"
                value={form.time}
                onChange={set('time')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={form.type}
              onChange={set('type')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              {ALL_GAME_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Club Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Club Name *</label>
              <input
                type="text"
                value={form.clubName}
                onChange={set('clubName')}
                placeholder="e.g. Henfield"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {/* Club Suffix */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Club Suffix</label>
              <input
                type="text"
                value={form.clubSuffix}
                onChange={set('clubSuffix')}
                placeholder='e.g. A, B'
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* H/A */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">H/A</label>
              <select
                value={form.homeAway}
                onChange={set('homeAway')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="H">Home</option>
                <option value="A">Away</option>
              </select>
            </div>
            {/* Format */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Format</label>
              <input
                type="text"
                value={form.format}
                onChange={set('format')}
                placeholder="e.g. Triples"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Ladies/Men */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
              <select
                value={form.ladiesMen}
                onChange={set('ladiesMen')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">—</option>
                <option value="Ladies">Ladies</option>
                <option value="Men">Men</option>
                <option value="Mixed">Mixed</option>
              </select>
            </div>
            {/* Dress */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Dress</label>
              <input
                type="text"
                value={form.dress}
                onChange={set('dress')}
                placeholder="e.g. Whites"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Paired */}
            <div className="flex items-center gap-2 pt-5">
              <input
                type="checkbox"
                id="paired"
                checked={form.paired === 'Y'}
                onChange={e => setForm(prev => ({ ...prev, paired: e.target.checked ? 'Y' : '' }))}
                className="rounded border-gray-300"
              />
              <label htmlFor="paired" className="text-sm font-medium text-gray-700">Paired game</label>
            </div>
            {/* Max Capacity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Capacity</label>
              <input
                type="number"
                min="0"
                value={form.maxPlayers}
                onChange={set('maxPlayers')}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* View-only result fields (edit mode only) */}
          {editGame && (editGame.bhbcScore !== null || editGame.status === 'C') && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 space-y-1">
              <p className="font-medium text-gray-700">Recorded Result (read-only here)</p>
              {editGame.bhbcScore !== null && (
                <p>Score: BHBC {editGame.bhbcScore} – {editGame.opponentScore}</p>
              )}
              {editGame.reason && (
                <p>Reason: {editGame.reason}</p>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        <div className="p-5 border-t border-gray-200 flex gap-3 justify-end sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className={getButtonClasses('secondary', 'md')}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.date || !form.clubName}
            className={getButtonClasses('primary', 'md')}
          >
            {saving ? 'Saving…' : editGame ? 'Save Changes' : 'Add Fixture'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function FixturesManagePage() {
  const { data: session } = useSession();
  const router = useRouter();

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Game | null>(null);
  const [deleting, setDeleting] = useState(false);

  const userRole = (session?.user as any)?.role || '';
  const isAdmin = userRole === 'Admin' || userRole === 'superadmin';
  const isCaptain = userRole === 'Captain';
  const canAccess = isAdmin || isCaptain;

  useEffect(() => {
    if (session === null) { router.push('/'); return; }
    if (session && !canAccess) { router.push('/'); return; }
    if (session && canAccess) { fetchGames(); }
  }, [session, canAccess]);

  async function fetchGames() {
    setLoading(true);
    try {
      const res = await fetch('/api/fixtures/manage/games');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setGames(data.games || []);
    } catch {
      setPageError('Failed to load fixtures');
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditGame(null);
    setModalError(null);
    setModalOpen(true);
  }

  function openEdit(game: Game) {
    setEditGame(game);
    setModalError(null);
    setModalOpen(true);
  }

  async function handleSave(form: FixtureFormData) {
    setSaving(true);
    setModalError(null);
    try {
      if (editGame) {
        // PATCH
        const res = await fetch(`/api/fixtures/manage/game/${editGame.rowNumber}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update');
        }
      } else {
        // POST
        const res = await fetch('/api/fixtures/manage/games', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create');
        }
      }
      setModalOpen(false);
      setEditGame(null);
      await fetchGames();
    } catch (err: any) {
      setModalError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/fixtures/manage/game/${confirmDelete.rowNumber}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      setConfirmDelete(null);
      await fetchGames();
    } catch (err: any) {
      setPageError(err.message || 'Failed to delete fixture');
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  if (!session || !canAccess) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={(session?.user as any)?.userName}
        userRole={userRole}
      />

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <Link href="/fixtures" className="text-sm text-gray-500 hover:text-gray-700 mb-2 inline-block">
              ← Back to Fixtures
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Manage Fixtures</h1>
          </div>
          <button
            onClick={openAdd}
            className={getButtonClasses('primary', 'md')}
          >
            + Add Fixture
          </button>
        </div>

        {pageError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {pageError}
          </div>
        )}

        {/* Games table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading…</div>
        ) : games.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No fixtures. Add one above.</div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Club</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">H/A</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Format</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Section</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {games.map(game => (
                    <tr key={game.rowNumber} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-gray-900">
                        {formatDisplayDate(game.date)}
                        {game.time && <span className="text-gray-400 text-xs ml-1">{game.time}</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs font-medium text-gray-600">{game.gameType}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-800">
                        {displayClubName(game.clubName, game.clubSuffix)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          game.homeAway === 'H' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {game.homeAway === 'H' ? 'Home' : 'Away'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{game.format || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{game.ladiesMen || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadge(game.status)}`}>
                          {statusText(game.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openEdit(game)}
                            className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded hover:bg-blue-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDelete(game)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Add/Edit Modal */}
      <FixtureModal
        isOpen={modalOpen}
        editGame={editGame}
        onClose={() => { setModalOpen(false); setEditGame(null); }}
        onSave={handleSave}
        saving={saving}
        error={modalError}
      />

      {/* Delete Confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Fixture"
          message={`Are you sure you want to delete the fixture vs ${displayClubName(confirmDelete.clubName, confirmDelete.clubSuffix)} on ${formatDisplayDate(confirmDelete.date)}? This cannot be undone.`}
          confirmLabel="Delete"
          confirmVariant="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
