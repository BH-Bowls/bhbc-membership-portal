'use client';

// app/admin/config/page.tsx
// App-wide settings — General (maintenance mode, age anchor, competitions threshold)
// and Labels (print-label layout config, moved here from /labels). Admin only.

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { hasRole } from '@/lib/role-utils';
import { getInputClasses, getCardClasses, getAlertClasses } from '@/config/theme-helpers';

type Tab = 'general' | 'labels' | 'rowland';

const ROWLAND_FIELDS: [string, string, string][] = [
  // key, label, hint
  ['rowland_entry_fee', 'Entry fee per team (£)', 'Charged per team on the Rowland Cup entry form.'],
  ['rowland_entry_deadline', 'Entry deadline (YYYY-MM-DD)', 'Shown on the entry form and confirmation email, and used as the access-token expiry.'],
  ['rowland_entry_season', 'Entry season', 'Which season new entry-form submissions get tagged with, e.g. "2027".'],
];

const LABELS_FIELDS: [string, string][] = [
  ['booklet_label_message', 'Booklet label message'],
  ['banner_url', 'Banner image URL'],
  ['label_width_mm', 'Label width (mm)'],
  ['label_height_mm', 'Label height (mm)'],
  ['top_margin_mm', 'Top margin (mm)'],
  ['left_margin_mm', 'Left margin (mm)'],
  ['column_gap_mm', 'Column gap (mm)'],
  ['row_gap_mm', 'Row gap (mm)'],
  ['labels_per_row', 'Labels per row'],
  ['labels_per_col', 'Labels per column'],
  ['printer_margin_mm', 'Printer margin (mm)'],
];

export default function AdminConfigPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>('general');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editGeneral, setEditGeneral] = useState<Record<string, string>>({});
  const [isEditingGeneral, setIsEditingGeneral] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const [editLabels, setEditLabels] = useState<Record<string, string>>({});
  const [isEditingLabels, setIsEditingLabels] = useState(false);
  const [savingLabels, setSavingLabels] = useState(false);

  const [editRowland, setEditRowland] = useState<Record<string, string>>({});
  const [isEditingRowland, setIsEditingRowland] = useState(false);
  const [savingRowland, setSavingRowland] = useState(false);

  // Auth guard
  useEffect(() => {
    if (status === 'loading') return;
    if (!session || !hasRole(session.user?.role, 'Admin')) {
      router.push('/');
    }
  }, [session, status, router]);

  // Load config
  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setEditGeneral(data.config);
          setEditLabels(data.config);
          setEditRowland(data.config);
        } else {
          setError(data.error || 'Failed to load config');
        }
      })
      .catch(() => setError('Failed to load config'))
      .finally(() => setLoading(false));
  }, []);

  async function saveGeneral() {
    setGeneralError(null);

    const ageAnchor = editGeneral.age_reference_date ?? '';
    if (ageAnchor && !/^\d{2}-\d{2}$/.test(ageAnchor)) {
      setGeneralError('Age anchor must be in MM-DD format, e.g. 03-01');
      return;
    }

    setSavingGeneral(true);
    try {
      const updates = {
        maintenance_mode: editGeneral.maintenance_mode ?? 'false',
        age_reference_date: ageAnchor,
        min_friendlies_for_competitions: editGeneral.min_friendlies_for_competitions ?? '',
        season_planning_green_total_rinks: editGeneral.season_planning_green_total_rinks ?? '',
        season_planning_capacity_warning_threshold: editGeneral.season_planning_capacity_warning_threshold ?? '',
        season_planning_max_players_per_day: editGeneral.season_planning_max_players_per_day ?? '',
      };
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      setConfig((prev) => ({ ...prev, ...updates }));
      setIsEditingGeneral(false);
    } catch {
      setGeneralError('Failed to save settings');
    } finally {
      setSavingGeneral(false);
    }
  }

  async function saveLabels() {
    setSavingLabels(true);
    try {
      const updates: Record<string, string> = {};
      for (const [key] of LABELS_FIELDS) updates[key] = editLabels[key] ?? '';
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      setConfig((prev) => ({ ...prev, ...updates }));
      setIsEditingLabels(false);
    } catch {
      alert('Failed to save label configuration');
    } finally {
      setSavingLabels(false);
    }
  }

  async function saveRowland() {
    setSavingRowland(true);
    try {
      const updates: Record<string, string> = {};
      for (const [key] of ROWLAND_FIELDS) updates[key] = editRowland[key] ?? '';
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      setConfig((prev) => ({ ...prev, ...updates }));
      setIsEditingRowland(false);
    } catch {
      alert('Failed to save Rowland configuration');
    } finally {
      setSavingRowland(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!session || !hasRole(session.user?.role, 'Admin')) return null;

  // Case-insensitive — a value set directly via SQL/Table Editor (e.g. 'TRUE') is just
  // as valid as one set through this checkbox ('true'), and isMaintenanceModeOn() (the
  // real enforcement, src/lib/maintenance.ts) already compares case-insensitively.
  // Comparing case-sensitively here was a real bug: the checkbox could show unchecked
  // while maintenance mode was genuinely still on, found live during go-live 2026-08-19.
  const maintenanceOn = (config.maintenance_mode || '').trim().toLowerCase() === 'true';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Config</h1>

        {error && <div className={getAlertClasses('danger')}>{error}</div>}

        {/* Tabs */}
        <div className="border-b border-gray-200 flex gap-6">
          {(['general', 'labels', 'rowland'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-sm font-medium border-b-2 -mb-px ${
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'general' ? 'General' : t === 'labels' ? 'Labels' : 'Rowland'}
            </button>
          ))}
        </div>

        {/* ── General tab ── */}
        {tab === 'general' && (
          <div className={`${getCardClasses('md')} space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">General settings</h2>
              {!isEditingGeneral ? (
                <button onClick={() => { setEditGeneral(config); setIsEditingGeneral(true); }} className="text-sm text-blue-600 hover:text-blue-800">
                  Edit
                </button>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={() => { setEditGeneral(config); setIsEditingGeneral(false); setGeneralError(null); }}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                  <button onClick={saveGeneral} disabled={savingGeneral} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
                    {savingGeneral ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {generalError && <div className={getAlertClasses('danger')}>{generalError}</div>}

            {maintenanceOn && !isEditingGeneral && (
              <div className={getAlertClasses('warning')}>Maintenance mode is currently ON — non-Admin logins are blocked.</div>
            )}

            <div className="space-y-4 text-sm">
              {/* Maintenance mode */}
              <div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isEditingGeneral}
                    checked={((isEditingGeneral ? editGeneral.maintenance_mode : config.maintenance_mode) || '').trim().toLowerCase() === 'true'}
                    onChange={(e) => setEditGeneral((prev) => ({ ...prev, maintenance_mode: e.target.checked ? 'true' : 'false' }))}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                  />
                  <span className="font-medium text-gray-900">Maintenance mode</span>
                </label>
                <p className="text-xs text-gray-700 mt-1 ml-6">Blocks new non-Admin logins and redirects active non-Admin sessions to the maintenance page.</p>
              </div>

              {/* Age anchor */}
              <div>
                <label className="block text-gray-900 mb-1">Age anchor (MM-DD)</label>
                {isEditingGeneral ? (
                  <input
                    type="text"
                    placeholder="03-01"
                    value={editGeneral.age_reference_date ?? ''}
                    onChange={(e) => setEditGeneral((prev) => ({ ...prev, age_reference_date: e.target.value }))}
                    className={`${getInputClasses()} max-w-[10rem]`}
                  />
                ) : (
                  <span className="text-gray-900">{config.age_reference_date || '—'}</span>
                )}
                <p className="text-xs text-gray-700 mt-1">The date each year age bands are calculated against. Not yet used anywhere in the app.</p>
              </div>

              {/* Min friendlies for competitions */}
              <div>
                <label className="block text-gray-900 mb-1">Min friendlies for competitions eligibility</label>
                {isEditingGeneral ? (
                  <input
                    type="number"
                    min={0}
                    value={editGeneral.min_friendlies_for_competitions ?? ''}
                    onChange={(e) => setEditGeneral((prev) => ({ ...prev, min_friendlies_for_competitions: e.target.value }))}
                    className={`${getInputClasses()} max-w-[10rem]`}
                  />
                ) : (
                  <span className="text-gray-900">{config.min_friendlies_for_competitions || '—'}</span>
                )}
                <p className="text-xs text-gray-700 mt-1">Not yet used anywhere in the app — Renewals' eligibility check still reads this threshold from Sheets.</p>
              </div>

              {/* Season Planning capacity */}
              <div>
                <label className="block text-gray-900 mb-1">Green total rinks</label>
                {isEditingGeneral ? (
                  <input
                    type="number"
                    min={1}
                    value={editGeneral.season_planning_green_total_rinks ?? ''}
                    onChange={(e) => setEditGeneral((prev) => ({ ...prev, season_planning_green_total_rinks: e.target.value }))}
                    className={`${getInputClasses()} max-w-[10rem]`}
                  />
                ) : (
                  <span className="text-gray-900">{config.season_planning_green_total_rinks || '—'}</span>
                )}
                <p className="text-xs text-gray-700 mt-1">Season Planning — the green's physical rink capacity, used for same-day Friendlies capacity warnings.</p>
              </div>

              <div>
                <label className="block text-gray-900 mb-1">Capacity warning threshold (rinks)</label>
                {isEditingGeneral ? (
                  <input
                    type="number"
                    min={1}
                    value={editGeneral.season_planning_capacity_warning_threshold ?? ''}
                    onChange={(e) => setEditGeneral((prev) => ({ ...prev, season_planning_capacity_warning_threshold: e.target.value }))}
                    className={`${getInputClasses()} max-w-[10rem]`}
                  />
                ) : (
                  <span className="text-gray-900">{config.season_planning_capacity_warning_threshold || '—'}</span>
                )}
                <p className="text-xs text-gray-700 mt-1">Season Planning — Home-rinks booked on a day at or above this fires an amber warning, before the hard ceiling above.</p>
              </div>

              <div>
                <label className="block text-gray-900 mb-1">Max players per day (soft guide)</label>
                {isEditingGeneral ? (
                  <input
                    type="number"
                    min={1}
                    value={editGeneral.season_planning_max_players_per_day ?? ''}
                    onChange={(e) => setEditGeneral((prev) => ({ ...prev, season_planning_max_players_per_day: e.target.value }))}
                    className={`${getInputClasses()} max-w-[10rem]`}
                  />
                ) : (
                  <span className="text-gray-900">{config.season_planning_max_players_per_day || '—'}</span>
                )}
                <p className="text-xs text-gray-700 mt-1">Season Planning — not enforced, just a warning. Covers all fixtures that day (Home and Away both need a full team), unlike the rinks check above which only counts Home.</p>
              </div>
            </div>
          </div>
        )}

        {/* ── Labels tab ── */}
        {tab === 'labels' && (
          <div className={`${getCardClasses('md')} space-y-3`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Label configuration</h2>
              {!isEditingLabels ? (
                <button onClick={() => { setEditLabels(config); setIsEditingLabels(true); }} className="text-sm text-blue-600 hover:text-blue-800">
                  Edit
                </button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => { setEditLabels(config); setIsEditingLabels(false); }} className="text-sm text-gray-500 hover:text-gray-700">
                    Cancel
                  </button>
                  <button onClick={saveLabels} disabled={savingLabels} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
                    {savingLabels ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-700">Used by Print Labels to lay out address, booklet, and locker labels.</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {LABELS_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <span className="text-gray-700">{label}: </span>
                  {isEditingLabels ? (
                    <input
                      type="text"
                      value={editLabels[key] ?? ''}
                      onChange={(e) => setEditLabels((prev) => ({ ...prev, [key]: e.target.value }))}
                      className={`${getInputClasses()} w-full mt-0.5`}
                    />
                  ) : (
                    <span className="text-gray-900">{config[key] || '—'}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Rowland tab ── */}
        {tab === 'rowland' && (
          <div className={`${getCardClasses('md')} space-y-3`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Rowland Cup entry settings</h2>
              {!isEditingRowland ? (
                <button onClick={() => { setEditRowland(config); setIsEditingRowland(true); }} className="text-sm text-blue-600 hover:text-blue-800">
                  Edit
                </button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => { setEditRowland(config); setIsEditingRowland(false); }} className="text-sm text-gray-500 hover:text-gray-700">
                    Cancel
                  </button>
                  <button onClick={saveRowland} disabled={savingRowland} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
                    {savingRowland ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-700">Used by the public Rowland Cup team entry form (/rowland/enter) and its confirmation email.</p>

            <div className="space-y-4 text-sm">
              {ROWLAND_FIELDS.map(([key, label, hint]) => (
                <div key={key}>
                  <label className="block text-gray-900 mb-1">{label}</label>
                  {isEditingRowland ? (
                    <input
                      type="text"
                      value={editRowland[key] ?? ''}
                      onChange={(e) => setEditRowland((prev) => ({ ...prev, [key]: e.target.value }))}
                      className={`${getInputClasses()} max-w-xs`}
                    />
                  ) : (
                    <span className="text-gray-900">{config[key] || '—'}</span>
                  )}
                  <p className="text-xs text-gray-700 mt-1">{hint}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
