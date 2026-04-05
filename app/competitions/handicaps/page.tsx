// app/competitions/handicaps/page.tsx
// Committee-only page to view and bulk-edit member handicaps

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

interface HandicapMember {
  username: string;
  fullName: string;
  memberType: string;
  handicap: number | null;
}

// Draft state: username → string value in the input ('', '0'..'10')
type DraftMap = Record<string, string>;

function handicapToString(h: number | null): string {
  return h != null ? String(h) : '';
}

export default function HandicapsPage() {
  const { data: session } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const isCommittee = role !== 'Member' && role !== '';

  const [members, setMembers] = useState<HandicapMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftMap>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadMembers = useCallback(() => {
    setLoading(true);
    fetch('/api/competitions/handicaps')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMembers(data.members || []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    if (!loading && !isCommittee) router.replace('/competitions');
  }, [loading, isCommittee, router]);

  // Derived
  const mens = useMemo(() => members.filter((m) => m.memberType === 'Playing Man'), [members]);
  const ladies = useMemo(() => members.filter((m) => m.memberType === 'Playing Lady'), [members]);

  const hasChanges = useMemo(() => {
    if (!isEditing) return false;
    return members.some(
      (m) => draft[m.username] !== handicapToString(m.handicap)
    );
  }, [draft, members, isEditing]);

  // ── Edit mode controls ──────────────────────────────────────────────────────
  function handleEdit() {
    const initial: DraftMap = {};
    for (const m of members) {
      initial[m.username] = handicapToString(m.handicap);
    }
    setDraft(initial);
    setSaveError(null);
    setIsEditing(true);
  }

  function handleCancel() {
    setIsEditing(false);
    setDraft({});
    setSaveError(null);
  }

  async function handleSave() {
    // Validate
    for (const m of members) {
      const val = draft[m.username] ?? '';
      if (val !== '') {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 0 || n > 10) {
          setSaveError(`Invalid handicap for ${m.fullName} — must be 0–10 or blank.`);
          return;
        }
      }
    }

    setSaving(true);
    setSaveError(null);

    try {
      // Build a single batch of only the changed members
      const updates = members
        .filter((m) => draft[m.username] !== handicapToString(m.handicap))
        .map((m) => {
          const val = draft[m.username] ?? '';
          return { username: m.username, handicap: val === '' ? null : parseInt(val, 10) };
        });

      if (updates.length > 0) {
        const res = await fetch('/api/competitions/handicaps', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to save handicaps');
        }
      }

      setIsEditing(false);
      setDraft({});
      loadMembers();
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  function renderSection(heading: string, list: HandicapMember[]) {
    return (
      <div key={heading}>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          {heading} ({list.length})
        </h2>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {list.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              No {heading.toLowerCase()} found.
            </div>
          )}
          {list.map((m) => (
            <div key={m.username} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{m.fullName}</span>
                <span className="ml-2 text-xs text-gray-400">{m.username}</span>
              </div>

              {isEditing ? (
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={draft[m.username] ?? ''}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [m.username]: e.target.value }))
                  }
                  placeholder="—"
                  className="w-20 rounded-md border-gray-300 shadow-sm text-sm text-center focus:border-blue-500 focus:ring-blue-500"
                />
              ) : (
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    m.handicap != null
                      ? 'bg-blue-100 text-blue-800'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {m.handicap != null ? m.handicap : '—'}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Page ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={role}
        actionButtons={isEditing ? {
          primary: {
            label: saving ? 'Saving…' : 'Save',
            onClick: handleSave,
            loading: saving,
            variant: 'primary' as const,
          },
          secondary: {
            label: 'Cancel',
            onClick: handleCancel,
            disabled: saving,
            variant: 'secondary' as const,
          },
        } : undefined}
      />

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <button
            onClick={() => router.push('/competitions/admin')}
            className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
          >
            ← Competitions admin
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Member Handicaps</h1>
              <p className="text-gray-500 text-sm mt-1">
                Handicap 0–10; higher = better player. Blank = not set.
              </p>
            </div>
            {!isEditing && !loading && (
              <button
                onClick={handleEdit}
                className="flex-shrink-0 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Unsaved changes banner */}
        {isEditing && hasChanges && (
          <div className="mb-4 bg-yellow-50 border border-yellow-300 rounded-lg px-4 py-2 text-sm text-yellow-800 flex items-center gap-2">
            <span className="font-medium">Unsaved changes</span>
            <span className="text-yellow-600">— use Save in the top bar to apply.</span>
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        {/* Load error */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : !error && (
          <div className="space-y-6">
            {renderSection('Playing Men', mens)}
            {renderSection('Playing Ladies', ladies)}
          </div>
        )}
      </div>
    </div>
  );
}
