// app/leagues/manage/[leagueId]/page.tsx
// Management page for a single league — teams, squad assignment, fixtures, status

'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { AttachmentUpload } from '@/components/AttachmentUpload';
import { AttachmentsList } from '@/components/AttachmentsList';
import type { Attachment } from '@/types/attachments';
import type {
  League,
  LeagueTeam,
  LeagueSquadMember,
  LeagueMatch,
  LeagueTableRow,
  LeagueStatus,
} from '@/types/leagues';

const STATUSES: LeagueStatus[] = ['Not Started', 'Entries Open', 'In Progress', 'Complete'];


function formatDate(d: string | null): string {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  catch { return d; }
}

// ── Searchable player picker ──────────────────────────────────────────────────
interface PlayerSelectProps {
  value: string;                     // selected username
  onChange: (username: string) => void;
  squad: LeagueSquadMember[];        // all squad members (for name lookup + list)
  excludeUsernames: Set<string>;     // usernames to hide (other-team / other-slot), except current value
  placeholder?: string;
}

function PlayerSelect({ value, onChange, squad, excludeUsernames, placeholder = 'Select player' }: PlayerSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sorted = [...squad].sort((a, b) => a.fullName.localeCompare(b.fullName));

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Word-start match — "dann" finds "Colin Dann"
  function matches(m: LeagueSquadMember): boolean {
    if (!search) return true;
    const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const nameWords = m.fullName.toLowerCase().split(/\s+/);
    return words.every((sw) => nameWords.some((nw) => nw.startsWith(sw)));
  }

  const selectable = sorted.filter(
    (m) => (m.username === value || !excludeUsernames.has(m.username)) && matches(m)
  );

  useEffect(() => { setHighlightedIndex(0); }, [search, isOpen]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightedIndex}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  function handleSelect(m: LeagueSquadMember) {
    onChange(m.username);
    setIsOpen(false);
    setSearch('');
  }

  const selectedMember = value ? squad.find((m) => m.username === value) : undefined;
  const displayName = selectedMember?.fullName ?? value ?? '';

  const borderClass = value ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white';

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={isOpen ? search : displayName}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); }}
          onFocus={() => { setSearch(''); setIsOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setIsOpen(false); setSearch(''); return; }
            if (e.key === 'ArrowDown') {
              e.preventDefault(); setIsOpen(true);
              setHighlightedIndex((i) => Math.min(i + 1, selectable.length - 1)); return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightedIndex((i) => Math.max(i - 1, 0)); return;
            }
            if (e.key === 'Enter' && isOpen) {
              e.preventDefault();
              const hit = selectable[highlightedIndex] ?? selectable[0];
              if (hit) handleSelect(hit);
            }
          }}
          placeholder={placeholder}
          className={`block w-full rounded-md shadow-sm text-sm px-3 py-2 border focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${borderClass}`}
        />
        {value && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 leading-none"
          >
            ×
          </button>
        )}
      </div>
      {isOpen && (
        <div ref={listRef} className="absolute z-30 left-0 w-64 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {selectable.length > 0 ? selectable.map((m, itemIdx) => (
            <div
              key={m.rowNumber}
              data-idx={itemIdx}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(m); }}
              onMouseEnter={() => setHighlightedIndex(itemIdx)}
              className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer ${
                itemIdx === highlightedIndex ? 'bg-blue-100 text-blue-900' :
                m.username === value ? 'bg-blue-50 text-blue-800' : 'text-gray-900 hover:bg-gray-100'
              }`}
            >
              <span>{m.fullName}</span>
              {m.username === value && <span className="text-blue-500 text-xs ml-2">✓</span>}
            </div>
          )) : (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function LeagueManageDetailPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const { data: session, status } = useSession();
  const router = useRouter();

  const role = session?.user?.role ?? '';
  const roles = role.split(',').map((r) => r.trim());
  const canAccess = ['LeagueCaptain', 'Captain', 'Admin'].some((r) => roles.includes(r));

  const [league, setLeague] = useState<League | null>(null);
  const [teams, setTeams] = useState<LeagueTeam[]>([]);
  const [squad, setSquad] = useState<LeagueSquadMember[]>([]);
  const [matches, setMatches] = useState<LeagueMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'squad' | 'fixtures' | 'settings' | 'rules'>('squad');

  // Rules / attachments
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  // Teams
  const [newTeamName, setNewTeamName] = useState('');
  const [addingTeam, setAddingTeam] = useState(false);

  // Add to squad
  const [allMembers, setAllMembers] = useState<{ userName: string; fullName: string }[]>([]);
  const [addSquadMember, setAddSquadMember] = useState('');
  const [addingToSquad, setAddingToSquad] = useState(false);

  // Squad assignment — competitions-style draft UI
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  interface TeamSlot { label: string; position: string; username: string; }
  const [localSlots, setLocalSlots] = useState<TeamSlot[]>([]);
  const [savedSlots, setSavedSlots] = useState<TeamSlot[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);

  function buildSlotTemplate(leagueType: string): TeamSlot[] {
    if (leagueType === 'triples') {
      return [
        { label: 'Skip 1',  position: 'Skip', username: '' },
        { label: 'Skip 2',  position: 'Skip', username: '' },
        { label: 'No.2 1',  position: 'Two',  username: '' },
        { label: 'No.2 2',  position: 'Two',  username: '' },
        { label: 'Lead 1',  position: 'Lead', username: '' },
        { label: 'Lead 2',  position: 'Lead', username: '' },
      ];
    }
    return [
      { label: 'Skip 1',  position: 'Skip', username: '' },
      { label: 'Skip 2',  position: 'Skip', username: '' },
      { label: 'Lead 1',  position: 'Lead', username: '' },
      { label: 'Lead 2',  position: 'Lead', username: '' },
    ];
  }

  function loadSlotsForTeam(teamId: string, leagueType: string, squadData: LeagueSquadMember[]) {
    const template = buildSlotTemplate(leagueType);
    const teamMembers = squadData.filter((m) => m.teamId === teamId);
    // Fill slots by position in order
    const byPosition: Record<string, string[]> = {};
    for (const m of teamMembers) {
      const pos = m.position || '';
      if (!byPosition[pos]) byPosition[pos] = [];
      byPosition[pos].push(m.username);
    }
    const posCounters: Record<string, number> = {};
    const filled = template.map((slot) => {
      const pos = slot.position;
      if (!posCounters[pos]) posCounters[pos] = 0;
      const username = byPosition[pos]?.[posCounters[pos]] ?? '';
      posCounters[pos]++;
      return { ...slot, username };
    });
    setLocalSlots(filled);
    setSavedSlots(filled);
  }

  // Inline team rename
  const [renamingTeamId, setRenamingTeamId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  async function saveRename(teamId: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingTeamId(null); return; }
    try {
      await fetch(`/api/leagues/${leagueId}/teams/${teamId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setRenamingTeamId(null);
      loadData();
    } catch (err: any) {
      alert(err.message);
    }
  }

  // Match edit dialog
  const [matchDialog, setMatchDialog] = useState<{
    matchId: string; homeTeamName: string; awayTeamName: string;
    scheduledDate: string; scheduledTime: string; playByDate: string;
    saving: boolean;
  } | null>(null);

  // Bulk fixture selection + edit
  const [selectedMatchIds, setSelectedMatchIds] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState<{
    scheduledDate: string; scheduledTime: string; playByDate: string;
    touched: { scheduledDate: boolean; scheduledTime: boolean; playByDate: boolean };
    saving: boolean;
  } | null>(null);

  function toggleMatchSelection(matchId: string) {
    setSelectedMatchIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId); else next.add(matchId);
      return next;
    });
  }

  async function saveBulkEdit() {
    if (!bulkDialog) return;
    const updates: Record<string, string | null> = {};
    if (bulkDialog.touched.scheduledDate) updates.scheduledDate = bulkDialog.scheduledDate || null;
    if (bulkDialog.touched.scheduledTime) updates.scheduledTime = bulkDialog.scheduledTime || null;
    if (bulkDialog.touched.playByDate) updates.playByDate = bulkDialog.playByDate || null;
    setBulkDialog((d) => d ? { ...d, saving: true } : d);
    try {
      await Promise.all([...selectedMatchIds].map((matchId) =>
        fetch(`/api/leagues/${leagueId}/matches/${matchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        })
      ));
      setBulkDialog(null);
      setSelectedMatchIds(new Set());
      loadData();
    } catch (err: any) {
      alert(err.message);
      setBulkDialog((d) => d ? { ...d, saving: false } : d);
    }
  }

  // Status change
  const [savingStatus, setSavingStatus] = useState(false);

  // Add fixture dialog
  const [addFixtureOpen, setAddFixtureOpen] = useState(false);
  const [newFixtureHome, setNewFixtureHome] = useState('');
  const [newFixtureAway, setNewFixtureAway] = useState('');
  const [addingFixture, setAddingFixture] = useState(false);

  function loadAttachments() {
    fetch(`/api/leagues/${leagueId}/attachments`)
      .then((r) => r.json())
      .then((data) => { if (data.attachments) setAttachments(data.attachments); })
      .catch(() => {});
  }

  function loadData() {
    fetch(`/api/leagues/${leagueId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setLeague(data.league);
        setTeams(data.teams);
        setSquad(data.squad);
        setMatches(data.matches);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (status === 'unauthenticated' || (status === 'authenticated' && !canAccess)) {
      router.replace('/leagues');
      return;
    }
    if (status === 'authenticated') { loadData(); loadAttachments(); }
  }, [status, canAccess, leagueId]);

  useEffect(() => {
    fetch('/api/members/lookup')
      .then((r) => r.json())
      .then((data) => { if (data.members) setAllMembers(data.members); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedTeamId && league) {
      loadSlotsForTeam(selectedTeamId, league.type, squad);
    } else {
      setLocalSlots([]);
      setSavedSlots([]);
    }
  }, [selectedTeamId, league?.type]);

  async function addTeam() {
    if (!newTeamName.trim()) return;
    setAddingTeam(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName: newTeamName.trim() }),
      });
      if (!res.ok) throw new Error('Failed to add team');
      setNewTeamName('');
      loadData();
    } catch (err: any) { alert(err.message); }
    finally { setAddingTeam(false); }
  }

  async function deleteTeam(teamId: string, teamName: string) {
    if (!confirm(`Delete team "${teamName}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/leagues/${leagueId}/teams/${teamId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete team');
      loadData();
    } catch (err: any) { alert(err.message); }
  }

  async function saveTeam() {
    if (!selectedTeamId) return;
    setSavingTeam(true);
    try {
      const players = localSlots
        .filter((s) => s.username)
        .map((s) => ({ username: s.username, position: s.position }));
      const res = await fetch(`/api/leagues/${leagueId}/teams/${selectedTeamId}/players`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ players }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      await loadDataAndRefreshSlots();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingTeam(false);
    }
  }

  async function loadDataAndRefreshSlots() {
    return new Promise<void>((resolve) => {
      fetch(`/api/leagues/${leagueId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.error) throw new Error(data.error);
          setLeague(data.league);
          setTeams(data.teams);
          setSquad(data.squad);
          setMatches(data.matches);
          if (selectedTeamId && data.league) {
            loadSlotsForTeam(selectedTeamId, data.league.type, data.squad);
          }
        })
        .catch((err) => setError(err.message))
        .finally(() => resolve());
    });
  }

  async function addToSquad() {
    if (!addSquadMember) return;
    setAddingToSquad(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: addSquadMember }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add');
      setAddSquadMember('');
      loadData();
    } catch (err: any) { alert(err.message); }
    finally { setAddingToSquad(false); }
  }

  async function removeFromSquad(member: LeagueSquadMember) {
    if (!confirm(`Remove ${member.fullName} from the squad?`)) return;
    try {
      const res = await fetch(`/api/leagues/${leagueId}/enter`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: member.username }),
      });
      if (!res.ok) throw new Error('Failed to remove');
      loadData();
    } catch (err: any) { alert(err.message); }
  }

  async function generateFixtures() {
    if (!confirm('This will replace all existing fixtures for this league. Continue?')) return;
    try {
      const res = await fetch(`/api/leagues/${leagueId}/matches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate');
      alert(`Generated ${data.count} fixtures.`);
      loadData();
    } catch (err: any) { alert(err.message); }
  }

  async function addFixture() {
    if (!newFixtureHome || !newFixtureAway || newFixtureHome === newFixtureAway) return;
    setAddingFixture(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/matches`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeTeamId: newFixtureHome, awayTeamId: newFixtureAway }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Failed'); }
      setAddFixtureOpen(false);
      setNewFixtureHome('');
      setNewFixtureAway('');
      loadData();
    } catch (err: any) { alert(err.message); }
    finally { setAddingFixture(false); }
  }

  async function deleteMatch(matchId: string) {
    if (!confirm('Delete this fixture?')) return;
    try {
      await fetch(`/api/leagues/${leagueId}/matches/${matchId}`, { method: 'DELETE' });
      loadData();
    } catch { alert('Failed to delete match'); }
  }

  async function saveMatchEdit() {
    if (!matchDialog) return;
    const updates: Record<string, any> = {};
    if (matchDialog.scheduledDate) updates.scheduledDate = matchDialog.scheduledDate;
    if (matchDialog.scheduledTime) updates.scheduledTime = matchDialog.scheduledTime;
    if (matchDialog.playByDate) updates.playByDate = matchDialog.playByDate;

    setMatchDialog((d) => d ? { ...d, saving: true } : d);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/matches/${matchDialog.matchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setMatchDialog(null);
      loadData();
    } catch (err: any) {
      alert(err.message);
      setMatchDialog((d) => d ? { ...d, saving: false } : d);
    }
  }

  async function changeStatus(newStatus: LeagueStatus) {
    setSavingStatus(true);
    try {
      const res = await fetch(`/api/leagues/${leagueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      setLeague((l) => l ? { ...l, status: newStatus } : l);
    } catch (err: any) { alert(err.message); }
    finally { setSavingStatus(false); }
  }

  function openMatchDialog(match: LeagueMatch) {
    const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
    const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
    setMatchDialog({
      matchId: match.matchId,
      homeTeamName: homeTeam?.teamName ?? 'Home',
      awayTeamName: awayTeam?.teamName ?? 'Away',
      scheduledDate: match.scheduledDate ?? '',
      scheduledTime: match.scheduledTime ?? '',
      playByDate: match.playByDate ?? '',
      saving: false,
    });
  }

  function getMatchDate(m: LeagueMatch): string | null {
    return league!.type === 'triples' ? m.scheduledDate : m.playByDate;
  }

  function formatFullDate(d: string): string {
    try {
      return new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return d; }
  }

  function formatTime(t: string | null): string {
    if (!t) return '';
    return t.replace(':', '');
  }

  function MatchRow({ match, isSelected, onToggle }: { match: LeagueMatch; isSelected: boolean; onToggle: () => void }) {
    const homeTeam = teams.find((t) => t.teamId === match.homeTeamId);
    const awayTeam = teams.find((t) => t.teamId === match.awayTeamId);
    const isPlayed = match.status === 'Played' || match.status === 'Walkover';
    return (
      <div className={`rounded-lg border p-3 flex flex-wrap items-center gap-2 ${isSelected ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          className="accent-blue-600 w-4 h-4 flex-shrink-0 cursor-pointer"
        />
        <div className="flex-1 min-w-0 text-sm">
          {match.scheduledTime && (
            <span className="text-gray-400 text-xs font-mono mr-2">{formatTime(match.scheduledTime)}</span>
          )}
          <span className="font-medium">{homeTeam?.teamName ?? '—'}</span>
          <span className="text-gray-400 mx-2">v</span>
          <span className="font-medium">{awayTeam?.teamName ?? '—'}</span>
          {isPlayed && match.homeScore !== null && (
            <span className="ml-2 font-semibold text-gray-700">
              {match.homeScore} – {match.awayScore}
            </span>
          )}
          {league!.type === 'pairs' && match.playByDate && (
            <span className="ml-2 text-gray-400 text-xs">{league!.dateLabel.toLowerCase()} {formatDate(match.playByDate)}</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
          match.status === 'Played'   ? 'bg-green-100 text-green-700' :
          match.status === 'Walkover' ? 'bg-yellow-100 text-yellow-700' :
          match.status === 'Cancelled'? 'bg-red-100 text-red-600' :
          'bg-gray-100 text-gray-600'
        }`}>
          {match.status}
        </span>
        <button
          onClick={() => openMatchDialog(match)}
          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 flex-shrink-0"
        >
          Edit
        </button>
        <button
          onClick={() => deleteMatch(match.matchId)}
          className="text-xs text-red-400 hover:text-red-600 flex-shrink-0"
        >
          Delete
        </button>
      </div>
    );
  }

  const scheduledDates = Array.from(
    new Set(matches.map(getMatchDate).filter((d): d is string => !!d))
  ).sort();
  const unscheduledMatches = matches.filter((m) => !getMatchDate(m));

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="text-center py-20 text-gray-400">Loading…</div>
      </div>
    );
  }

  if (error || !league) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="text-center py-20 text-red-500">{error ?? 'League not found'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/leagues/manage')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block"
          >
            ← League Management
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{league.name}</h1>
              <p className="text-xs text-gray-500 mt-0.5 capitalize">{league.type} · {league.season}</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Status:</label>
              <select
                value={league.status}
                onChange={(e) => changeStatus(e.target.value as LeagueStatus)}
                disabled={savingStatus}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Teams management (always visible at top) */}
        <div className="mb-6 bg-white border border-gray-200 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Teams</h2>
          {teams.length === 0 ? (
            <p className="text-sm text-gray-400 italic mb-3">No teams yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-3">
              {teams.map((team) => (
                <div key={team.teamId} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1 text-sm">
                  {renamingTeamId === team.teamId ? (
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => saveRename(team.teamId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(team.teamId);
                        if (e.key === 'Escape') setRenamingTeamId(null);
                      }}
                      className="bg-transparent border-b border-gray-400 outline-none text-sm w-28"
                    />
                  ) : (
                    <span
                      className="cursor-pointer hover:text-blue-600"
                      title="Click to rename"
                      onClick={() => { setRenamingTeamId(team.teamId); setRenameValue(team.teamName); }}
                    >
                      {team.teamName}
                    </span>
                  )}
                  <button
                    onClick={() => deleteTeam(team.teamId, team.teamName)}
                    className="text-gray-400 hover:text-red-500 ml-1 text-xs leading-none"
                    title="Delete team"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTeam(); }}
              placeholder="Team name"
              className="flex-1 max-w-xs border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
            <button
              onClick={addTeam}
              disabled={addingTeam || !newTeamName.trim()}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Add Team
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-6">
          {(['squad', 'fixtures', 'rules', 'settings'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 capitalize transition-colors ${
                tab === t
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'squad' ? `Squad (${squad.length})` : t === 'fixtures' ? `Fixtures (${matches.length})` : t === 'rules' ? `Rules (${attachments.length})` : 'Settings'}
            </button>
          ))}
        </div>

        {/* Squad tab */}
        {tab === 'squad' && (() => {
          const isDirty = JSON.stringify(localSlots) !== JSON.stringify(savedSlots);
          // Names in current draft
          const draftUsernames = new Set(localSlots.map((s) => s.username).filter(Boolean));
          const squadUsernames = new Set(squad.map((m) => m.username));
          // Cast allMembers into the shape PlayerSelect expects, excluding existing squad members
          const memberPickerSquad: LeagueSquadMember[] = allMembers
            .filter((m) => !squadUsernames.has(m.userName))
            .map((m, i) => ({
              rowNumber: i, leagueId: leagueId as string, teamId: '', username: m.userName,
              fullName: m.fullName, position: '' as any, enteredDate: '',
            }));
          // Names assigned to OTHER teams (not the currently selected team)
          const otherTeamUsernames = new Set(
            squad.filter((m) => m.teamId && m.teamId !== selectedTeamId).map((m) => m.username)
          );

          return (
            <div>
              {/* Add member to squad */}
              <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Add Member to Squad</h2>
                <div className="flex gap-2 items-start">
                  <div className="flex-1 max-w-xs">
                    <PlayerSelect
                      value={addSquadMember}
                      onChange={setAddSquadMember}
                      squad={memberPickerSquad}
                      excludeUsernames={new Set()}
                      placeholder="Search member…"
                    />
                  </div>
                  <button
                    onClick={addToSquad}
                    disabled={!addSquadMember || addingToSquad}
                    className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {addingToSquad ? 'Adding…' : 'Add to Squad'}
                  </button>
                </div>
              </div>

              {squad.length === 0 ? (
                <div className="text-center py-10 text-gray-400">No players entered yet.</div>
              ) : (
                <>
                  {/* Full squad overview */}
                  <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
                    <p className="text-xs font-medium text-gray-500 mb-3">
                      All players — {squad.filter(m => m.teamId).length}/{squad.length} assigned
                      {!selectedTeamId && teams.length > 0 && (
                        <span className="ml-2 text-gray-400">· Select a team below to assign players</span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {squad.map((member) => {
                        const inDraft = draftUsernames.has(member.username);
                        const inOtherTeam = otherTeamUsernames.has(member.username);
                        const canRemove = !member.teamId;
                        return (
                          <div
                            key={member.rowNumber}
                            title={
                              inOtherTeam
                                ? `${member.fullName} — assigned to ${teams.find(t => t.teamId === member.teamId)?.teamName ?? 'a team'}`
                                : inDraft ? `${member.fullName} — in current draft`
                                : member.fullName
                            }
                            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm border select-none ${
                              inOtherTeam
                                ? 'line-through text-gray-400 bg-gray-50 border-gray-200'
                                : inDraft
                                ? 'bg-green-50 border-green-300 text-green-800 font-medium'
                                : 'bg-white border-gray-300 text-gray-700'
                            }`}
                          >
                            {member.fullName}
                            {canRemove && (
                              <button
                                type="button"
                                onClick={() => removeFromSquad(member)}
                                className="text-gray-400 hover:text-red-500 leading-none ml-0.5"
                                title="Remove from squad"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Team selector buttons */}
                  {teams.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">Add teams above to start assigning players.</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2 mb-5">
                        {teams.map((team) => {
                          const memberCount = squad.filter(m => m.teamId === team.teamId).length;
                          const isSelected = selectedTeamId === team.teamId;
                          return (
                            <button
                              key={team.teamId}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedTeamId(null);
                                } else {
                                  setSelectedTeamId(team.teamId);
                                  loadSlotsForTeam(team.teamId, league.type, squad);
                                }
                              }}
                              className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                                isSelected
                                  ? 'border-green-600 bg-green-50 text-green-800'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                              }`}
                            >
                              {team.teamName}
                              <span className="ml-1.5 text-xs font-normal opacity-60">
                                {memberCount}/{league.squadSize ?? '?'}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Draft editor */}
                      {selectedTeamId && (
                        <div className="bg-white border border-gray-200 rounded-lg p-5">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-800">
                              {teams.find(t => t.teamId === selectedTeamId)?.teamName ?? 'Team'}
                            </h3>
                            {isDirty && (
                              <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                            {localSlots.map((slot, idx) => {
                              // Build exclude set: other-team players + players in other slots (not self)
                              const excludeUsernames = new Set<string>([
                                ...otherTeamUsernames,
                                ...localSlots
                                  .filter((s, i) => i !== idx && s.username)
                                  .map((s) => s.username),
                              ]);

                              return (
                                <div key={idx}>
                                  <label className="block text-xs text-gray-500 mb-1">{slot.label}</label>
                                  <PlayerSelect
                                    value={slot.username}
                                    onChange={(v) => {
                                      const updated = localSlots.map((s, i) =>
                                        i === idx ? { ...s, username: v } : s
                                      );
                                      setLocalSlots(updated);
                                    }}
                                    squad={squad}
                                    excludeUsernames={excludeUsernames}
                                    placeholder="— unassigned —"
                                  />
                                </div>
                              );
                            })}
                          </div>

                          <div className="flex gap-3">
                            <button
                              onClick={saveTeam}
                              disabled={savingTeam || !isDirty}
                              className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-40"
                            >
                              {savingTeam ? 'Saving…' : 'Save Team'}
                            </button>
                            <button
                              onClick={() => setLocalSlots([...savedSlots])}
                              disabled={savingTeam || !isDirty}
                              className="px-4 py-2 text-sm border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                            >
                              Discard &amp; reload saved
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* Fixtures tab */}
        {tab === 'fixtures' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-gray-600">
                {teams.length} teams · {matches.length} fixtures
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddFixtureOpen(true)}
                  disabled={teams.length < 2}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                  + Add fixture
                </button>
                <button
                  onClick={generateFixtures}
                  disabled={teams.length < 2}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
                >
                  Generate Round-Robin
                </button>
              </div>
            </div>

            {selectedMatchIds.size > 0 && (
              <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <span className="text-blue-800 font-medium">{selectedMatchIds.size} selected</span>
                <button
                  onClick={() => {
                    const sel = matches.filter((m) => selectedMatchIds.has(m.matchId));
                    const common = <T,>(vals: (T | null | undefined)[]) => vals.every((v) => v === vals[0]) ? (vals[0] ?? '') : '';
                    setBulkDialog({
                      scheduledDate: common(sel.map((m) => m.scheduledDate)),
                      scheduledTime: common(sel.map((m) => m.scheduledTime)),
                      playByDate: common(sel.map((m) => m.playByDate)),
                      touched: { scheduledDate: false, scheduledTime: false, playByDate: false },
                      saving: false,
                    });
                  }}
                  className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs font-medium"
                >
                  Edit Date / Time
                </button>
                <button
                  onClick={() => setSelectedMatchIds(new Set(matches.map((m) => m.matchId)))}
                  className="px-3 py-1 border border-blue-300 text-blue-700 rounded-md hover:bg-blue-100 text-xs"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedMatchIds(new Set())}
                  className="px-3 py-1 text-blue-600 hover:text-blue-800 text-xs"
                >
                  Clear
                </button>
              </div>
            )}

            {matches.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                No fixtures yet. Add teams and generate fixtures above.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Scheduled sessions — grouped by date */}
                {scheduledDates.map((date) => {
                  const dayMatches = matches
                    .filter((m) => getMatchDate(m) === date)
                    .sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''));
                  return (
                    <div key={date}>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">
                        {formatFullDate(date)}
                      </h3>
                      <div className="space-y-2">
                        {dayMatches.map((match) => <MatchRow key={match.matchId} match={match} isSelected={selectedMatchIds.has(match.matchId)} onToggle={() => toggleMatchSelection(match.matchId)} />)}
                      </div>
                    </div>
                  );
                })}

                {/* Unscheduled fixtures */}
                {unscheduledMatches.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-400 mb-2">Unscheduled</h3>
                    <div className="space-y-2">
                      {unscheduledMatches.map((match) => <MatchRow key={match.matchId} match={match} isSelected={selectedMatchIds.has(match.matchId)} onToggle={() => toggleMatchSelection(match.matchId)} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Rules tab */}
        {tab === 'rules' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                Upload rules documents, handbooks, or any reference files for this league.
              </p>
              {!showUpload && (
                <button
                  onClick={() => setShowUpload(true)}
                  className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 whitespace-nowrap"
                >
                  Upload Rules
                </button>
              )}
            </div>
            {showUpload && (
              <div className="mb-5">
                <AttachmentUpload
                  apiBasePath={`/api/leagues/${leagueId}`}
                  onUploadComplete={() => { setShowUpload(false); loadAttachments(); }}
                  onCancel={() => setShowUpload(false)}
                />
              </div>
            )}
            <AttachmentsList
              apiBasePath={`/api/leagues/${leagueId}`}
              attachments={attachments}
              canDelete={true}
              onDelete={loadAttachments}
            />
          </div>
        )}

        {/* Settings tab */}
        {tab === 'settings' && (
          <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-5 max-w-md">
            <div className="space-y-1 text-sm text-gray-600">
              <p><strong>Type:</strong> {league.type}</p>
              <p><strong>Season:</strong> {league.season}</p>
              <p><strong>Squad size:</strong> {league.squadSize}</p>
              <p><strong>Players per match:</strong> {league.playersPerMatch}</p>
            </div>
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date label</label>
                <select
                  value={league.dateLabel}
                  onChange={async (e) => {
                    const val = e.target.value as import('@/types/leagues').DateLabel;
                    await fetch(`/api/leagues/${leagueId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dateLabel: val }) });
                    setLeague((l) => l ? { ...l, dateLabel: val } : l);
                  }}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
                >
                  <option value="Play on/at">Play on/at</option>
                  <option value="Play by">Play by</option>
                  <option value="Play start date">Play start date</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">How fixture dates are labelled for members.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Legs (round-robin)</label>
                <select
                  value={league.legs}
                  onChange={async (e) => {
                    const val = parseInt(e.target.value) as 1 | 2;
                    await fetch(`/api/leagues/${leagueId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ legs: val }) });
                    setLeague((l) => l ? { ...l, legs: val } : l);
                  }}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm w-full"
                >
                  <option value={1}>1 — each pair plays once</option>
                  <option value={2}>2 — each pair plays twice</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">Affects Generate Round-Robin — re-generate fixtures after changing.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add fixture dialog */}
      {addFixtureOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Add Fixture</h2>
              <p className="text-xs text-gray-500 mt-0.5">Date and time can be set after adding.</p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Home team</label>
                <select
                  value={newFixtureHome}
                  onChange={(e) => setNewFixtureHome(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">— select —</option>
                  {teams.map((t) => (
                    <option key={t.teamId} value={t.teamId}>{t.teamName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Away team</label>
                <select
                  value={newFixtureAway}
                  onChange={(e) => setNewFixtureAway(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                >
                  <option value="">— select —</option>
                  {teams.filter((t) => t.teamId !== newFixtureHome).map((t) => (
                    <option key={t.teamId} value={t.teamId}>{t.teamName}</option>
                  ))}
                </select>
              </div>
              {newFixtureHome && newFixtureAway && newFixtureHome !== newFixtureAway && (
                <p className="text-sm text-gray-600">
                  <strong>{teams.find(t => t.teamId === newFixtureHome)?.teamName}</strong>
                  <span className="mx-2 text-gray-400">v</span>
                  <strong>{teams.find(t => t.teamId === newFixtureAway)?.teamName}</strong>
                </p>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => { setAddFixtureOpen(false); setNewFixtureHome(''); setNewFixtureAway(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={addFixture}
                disabled={addingFixture || !newFixtureHome || !newFixtureAway || newFixtureHome === newFixtureAway}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {addingFixture ? 'Adding…' : 'Add Fixture'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match edit dialog */}
      {matchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Edit Fixture</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {matchDialog.homeTeamName} vs {matchDialog.awayTeamName}
              </p>
            </div>
            <div className="p-5 space-y-4">
              {league.type === 'triples' ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{league.dateLabel}</label>
                    <input
                      type="date"
                      value={matchDialog.scheduledDate}
                      onChange={(e) => setMatchDialog((d) => d ? { ...d, scheduledDate: e.target.value } : d)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Time</label>
                    <input
                      type="time"
                      value={matchDialog.scheduledTime}
                      onChange={(e) => setMatchDialog((d) => d ? { ...d, scheduledTime: e.target.value } : d)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">{league.dateLabel}</label>
                  <input
                    type="date"
                    value={matchDialog.playByDate}
                    onChange={(e) => setMatchDialog((d) => d ? { ...d, playByDate: e.target.value } : d)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setMatchDialog(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveMatchEdit}
                disabled={matchDialog.saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {matchDialog.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk date/time edit dialog */}
      {bulkDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="p-5 border-b border-gray-200">
              <h2 className="text-base font-semibold text-gray-900">Edit Date / Time</h2>
              <p className="text-sm text-gray-500 mt-0.5">Applying to {selectedMatchIds.size} fixture{selectedMatchIds.size !== 1 ? 's' : ''}. Only fields you change will be updated — clearing a field removes that date/time.</p>
            </div>
            <div className="p-5 space-y-4">
              {league.type === 'triples' ? (
                <>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">{league.dateLabel}</label>
                    <input
                      type="date"
                      value={bulkDialog.scheduledDate}
                      onChange={(e) => setBulkDialog((d) => d ? { ...d, scheduledDate: e.target.value, touched: { ...d.touched, scheduledDate: true } } : d)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Time</label>
                    <input
                      type="time"
                      value={bulkDialog.scheduledTime}
                      onChange={(e) => setBulkDialog((d) => d ? { ...d, scheduledTime: e.target.value, touched: { ...d.touched, scheduledTime: true } } : d)}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">{league.dateLabel}</label>
                  <input
                    type="date"
                    value={bulkDialog.playByDate}
                    onChange={(e) => setBulkDialog((d) => d ? { ...d, playByDate: e.target.value, touched: { ...d.touched, playByDate: true } } : d)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                    autoFocus
                  />
                </div>
              )}
            </div>
            <div className="p-5 border-t border-gray-200 flex gap-3 justify-end">
              <button
                onClick={() => setBulkDialog(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={saveBulkEdit}
                disabled={bulkDialog.saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {bulkDialog.saving ? 'Saving…' : `Save ${selectedMatchIds.size} fixture${selectedMatchIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
