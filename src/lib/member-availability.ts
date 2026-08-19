// src/lib/member-availability.ts
// Member Availability substrate — standard week + overrides + commitments + resolver.
// Per specs/MEMBER_AVAILABILITY_SPEC.md. Joined to the rest of the app only by
// `username` — no cross-store joins. The planning layer (events/slots/responses,
// groups) stays entirely on Google Sheets; this is additive.

import { getSupabaseClient } from './supabase';

export type Session = 'morning' | 'afternoon' | 'evening';
export type OverrideSession = Session | 'all';
export type CommitmentSession = 'early' | Session | 'all';
export type EffectiveStatus = 'free' | 'busy_committed' | 'busy_personal' | 'unknown';
export type CommitmentSource = 'availability' | 'friendly' | 'competition' | 'rota' | 'marker' | 'external';

export interface StandardWeekEntry {
  id: string;
  username: string;
  weekday: number;      // 0=Sun ... 6=Sat
  session: Session;
  status: 'free' | 'busy';
  label: string | null;
}

export interface AvailabilityOverride {
  id: string;
  username: string;
  date: string;          // DD/MM/YYYY
  session: OverrideSession;
  status: 'free' | 'busy';
  label: string | null;
}

export interface Commitment {
  id: string;
  username: string;
  date: string;          // DD/MM/YYYY
  session: CommitmentSession;
  source: CommitmentSource;
  sourceRef: string | null;
  status: 'committed' | 'tentative';
  type: string | null;
  label: string | null;
  subLabel: string | null;
  linkUrl: string | null;
}

function toISODate(ddmmyyyy: string): string {
  const [d, m, y] = ddmmyyyy.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function toUKDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const SESSIONS: Session[] = ['morning', 'afternoon', 'evening'];

// ============================================================================
// STANDARD WEEK
// ============================================================================

function mapStandardWeekRow(row: any): StandardWeekEntry {
  return {
    id: row.id,
    username: row.username,
    weekday: row.weekday,
    session: row.session,
    status: row.status,
    label: row.label || null,
  };
}

export async function getStandardWeek(username: string): Promise<StandardWeekEntry[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('standard_week')
    .select('*')
    .eq('username', username)
    .order('weekday');
  if (error) throw new Error(`Failed to fetch standard week: ${error.message}`);
  return (data || []).map(mapStandardWeekRow);
}

/**
 * Replaces a member's entire standard week with the given entries in one call — the
 * editor always saves the full 7x3 grid state, so a full wipe-and-reinsert (scoped to
 * that member only) is simpler and safer than diffing individual cell changes.
 */
export async function setStandardWeek(
  username: string,
  entries: { weekday: number; session: Session; status: 'free' | 'busy'; label?: string }[]
): Promise<void> {
  const supabase = getSupabaseClient();

  const { error: deleteError } = await supabase.from('standard_week').delete().eq('username', username);
  if (deleteError) throw new Error(`Failed to clear standard week: ${deleteError.message}`);

  if (entries.length === 0) return;

  const { error: insertError } = await supabase.from('standard_week').insert(
    entries.map((e) => ({
      username,
      weekday: e.weekday,
      session: e.session,
      status: e.status,
      label: e.label || null,
    }))
  );
  if (insertError) throw new Error(`Failed to save standard week: ${insertError.message}`);
}

// ============================================================================
// OVERRIDES
// ============================================================================

function mapOverrideRow(row: any): AvailabilityOverride {
  return {
    id: row.id,
    username: row.username,
    date: toUKDate(row.date),
    session: row.session,
    status: row.status,
    label: row.label || null,
  };
}

export async function getOverrides(
  username: string,
  startDate?: string,
  endDate?: string
): Promise<AvailabilityOverride[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('availability_overrides').select('*').eq('username', username);
  if (startDate) query = query.gte('date', toISODate(startDate));
  if (endDate) query = query.lte('date', toISODate(endDate));
  const { data, error } = await query.order('date');
  if (error) throw new Error(`Failed to fetch overrides: ${error.message}`);
  return (data || []).map(mapOverrideRow);
}

export async function addOverride(
  username: string,
  date: string,
  session: OverrideSession,
  status: 'free' | 'busy',
  label?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('availability_overrides')
    .upsert(
      { username, date: toISODate(date), session, status, label: label || null },
      { onConflict: 'username,date,session' }
    );
  if (error) throw new Error(`Failed to save override: ${error.message}`);
}

export async function removeOverride(id: string, username: string): Promise<void> {
  const supabase = getSupabaseClient();
  // Scope the delete to the owning username too — an editor route should never be able
  // to delete another member's override by guessing an id.
  const { error } = await supabase.from('availability_overrides').delete().eq('id', id).eq('username', username);
  if (error) throw new Error(`Failed to remove override: ${error.message}`);
}

// ============================================================================
// COMMITMENTS
// ============================================================================

function mapCommitmentRow(row: any): Commitment {
  return {
    id: row.id,
    username: row.username,
    date: toUKDate(row.date),
    session: row.session,
    source: row.source,
    sourceRef: row.source_ref || null,
    status: row.status,
    type: row.type || null,
    label: row.label || null,
    subLabel: row.sub_label || null,
    linkUrl: row.link_url || null,
  };
}

export async function getCommitments(
  usernames: string[],
  startDate: string,
  endDate: string
): Promise<Commitment[]> {
  if (usernames.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('commitments')
    .select('*')
    .in('username', usernames)
    .gte('date', toISODate(startDate))
    .lte('date', toISODate(endDate))
    .order('date');
  if (error) throw new Error(`Failed to fetch commitments: ${error.message}`);
  return (data || []).map(mapCommitmentRow);
}

/**
 * Upserts one commitment row, keyed on (source, source_ref, username) so re-concluding
 * an event is idempotent.
 */
export async function upsertCommitment(commitment: {
  username: string;
  date: string;               // DD/MM/YYYY
  session: CommitmentSession;
  source: CommitmentSource;
  sourceRef: string;
  status: 'committed' | 'tentative';
  type?: string;
  label?: string;
  subLabel?: string;
  linkUrl?: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('commitments').upsert(
    {
      username: commitment.username,
      date: toISODate(commitment.date),
      session: commitment.session,
      source: commitment.source,
      source_ref: commitment.sourceRef,
      status: commitment.status,
      type: commitment.type || null,
      label: commitment.label || null,
      sub_label: commitment.subLabel || null,
      link_url: commitment.linkUrl || null,
    },
    { onConflict: 'source,source_ref,username' }
  );
  if (error) throw new Error(`Failed to save commitment: ${error.message}`);
}

/** Removes every commitment row for a source record — used when an event is reopened. */
export async function deleteCommitmentsBySourceRef(source: CommitmentSource, sourceRef: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('commitments').delete().eq('source', source).eq('source_ref', sourceRef);
  if (error) throw new Error(`Failed to clear commitments: ${error.message}`);
}

// ============================================================================
// RESOLVER
// ============================================================================

/**
 * resolveAvailability — the heart of the substrate. Returns, for every (username, date,
 * session) in range, the effective status per the precedence in the header comment:
 * commitments > overrides > standard_week > unknown.
 *
 * Only the three real game sessions are resolved (not 'early'/'all' — those are
 * commitment/override-only concepts feeding the duties band and blanket-day overrides,
 * not something a member is asked "free or busy" about directly).
 */
export async function resolveAvailability(
  usernames: string[],
  startDate: string,   // DD/MM/YYYY
  endDate: string      // DD/MM/YYYY
): Promise<Map<string, Map<string, EffectiveStatus>>> {
  const result = new Map<string, Map<string, EffectiveStatus>>();
  for (const username of usernames) {
    result.set(username, new Map());
  }
  if (usernames.length === 0) return result;

  const supabase = getSupabaseClient();
  const startISO = toISODate(startDate);
  const endISO = toISODate(endDate);

  const [commitmentsResp, overridesResp, standardWeekResp] = await Promise.all([
    supabase.from('commitments').select('username, date, session').in('username', usernames).gte('date', startISO).lte('date', endISO),
    supabase.from('availability_overrides').select('username, date, session, status').in('username', usernames).gte('date', startISO).lte('date', endISO),
    supabase.from('standard_week').select('username, weekday, session, status').in('username', usernames),
  ]);
  if (commitmentsResp.error) throw new Error(`Failed to resolve availability (commitments): ${commitmentsResp.error.message}`);
  if (overridesResp.error) throw new Error(`Failed to resolve availability (overrides): ${overridesResp.error.message}`);
  if (standardWeekResp.error) throw new Error(`Failed to resolve availability (standard week): ${standardWeekResp.error.message}`);

  // Build every date in range, once.
  const dates: string[] = [];
  const cursor = new Date(startISO);
  const end = new Date(endISO);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  // Index standard week by username -> weekday -> session -> status
  const standardByUser = new Map<string, Map<number, Map<Session, 'free' | 'busy'>>>();
  for (const row of standardWeekResp.data || []) {
    if (!standardByUser.has(row.username)) standardByUser.set(row.username, new Map());
    const byWeekday = standardByUser.get(row.username) as Map<number, Map<Session, 'free' | 'busy'>>;
    if (!byWeekday.has(row.weekday)) byWeekday.set(row.weekday, new Map());
    const bySession = byWeekday.get(row.weekday) as Map<Session, 'free' | 'busy'>;
    bySession.set(row.session, row.status);
  }

  // Index overrides by username -> date -> session -> status (session may be 'all')
  const overridesByUser = new Map<string, Map<string, Map<string, 'free' | 'busy'>>>();
  for (const row of overridesResp.data || []) {
    if (!overridesByUser.has(row.username)) overridesByUser.set(row.username, new Map());
    const byDate = overridesByUser.get(row.username) as Map<string, Map<string, 'free' | 'busy'>>;
    if (!byDate.has(row.date)) byDate.set(row.date, new Map());
    const bySession = byDate.get(row.date) as Map<string, 'free' | 'busy'>;
    bySession.set(row.session, row.status);
  }

  // Index commitments by username -> date -> set of sessions committed (any status counts)
  const commitmentsByUser = new Map<string, Map<string, Set<string>>>();
  for (const row of commitmentsResp.data || []) {
    if (!commitmentsByUser.has(row.username)) commitmentsByUser.set(row.username, new Map());
    const byDate = commitmentsByUser.get(row.username) as Map<string, Set<string>>;
    if (!byDate.has(row.date)) byDate.set(row.date, new Set());
    (byDate.get(row.date) as Set<string>).add(row.session);
  }

  for (const username of usernames) {
    const userResult = result.get(username) as Map<string, EffectiveStatus>;
    for (const dateISO of dates) {
      const dateObj = new Date(dateISO);
      const weekday = dateObj.getUTCDay();
      const dateUK = toUKDate(dateISO);

      for (const session of SESSIONS) {
        const key = `${dateUK}:${session}`;

        const committedSessions = commitmentsByUser.get(username)?.get(dateISO);
        if (committedSessions && (committedSessions.has(session) || committedSessions.has('all'))) {
          userResult.set(key, 'busy_committed');
          continue;
        }

        const overrideSessions = overridesByUser.get(username)?.get(dateISO);
        if (overrideSessions) {
          const overrideStatus = overrideSessions.get(session) || overrideSessions.get('all');
          if (overrideStatus) {
            userResult.set(key, overrideStatus === 'free' ? 'free' : 'busy_personal');
            continue;
          }
        }

        const standardStatus = standardByUser.get(username)?.get(weekday)?.get(session);
        if (standardStatus) {
          userResult.set(key, standardStatus === 'free' ? 'free' : 'busy_personal');
          continue;
        }

        userResult.set(key, 'unknown');
      }
    }
  }

  return result;
}
