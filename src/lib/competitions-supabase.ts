// src/lib/competitions-supabase.ts
// Postgres-backed replacement for competitions-sheets.ts. Same function names/signatures
// throughout, so every consumer route needs only an import swap.
//
// The old model was one CompetitionsControl sheet + 12 per-competition match sheets (one
// per competition, e.g. CompMensChampionship) + one CompetitionsSettings key-value sheet.
// Here that's three tables (supabase/migrations/0033_competitions.sql): competitions,
// a single unified competition_matches (comp_id column instead of 12 separate tables),
// and competition_settings (still simple key-value, same shape as the old sheet).
//
// side1Usernames/side2Usernames are real text[] arrays now, not pipe-joined strings —
// encodeSide/parseSide are gone, the array goes straight to/from Postgres.
//
// match_id is kept as the existing human-readable business key (e.g.
// "mens-championship-r1-3") rather than replaced by the row's own uuid — bracket
// progression (nextRoundTarget/propagateWinnerToNextRound) constructs and looks these up
// directly, so preserving the ID scheme avoids rewriting that logic.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getRenewalCompetitionEntries, getCurrentSeasonYear } from './renewals-supabase';
import type { Competition, CompMatch, CompType, CompStatus, CompRound, CompMemberInfo } from '@/types/competitions';
import { ROUND_ORDER } from '@/types/competitions';

// ============================================================================
// COMP CONFIG MAP
// ============================================================================

/**
 * Static per-competition config: which Renewals column marks someone as an entrant
 * (normalised column name, matching the renewals table's own column names — see
 * renewals-supabase.ts's getRenewalCompetitionEntries). Omit renewalColumn for comps
 * where all playing members are eligible (e.g. centenary — draw is from a hat).
 */
export const COMP_SHEET_CONFIG: Record<string, {
  renewalColumn?: string;
  subRenewalColumn?: string; // For pairs/triples substitute column
}> = {
  'mens-championship': { renewalColumn: 'comp_mens_championship' },
  'ladies-maynard': { renewalColumn: 'comp_ladies_maynard' },
  'mens-two-wood': { renewalColumn: 'comp_mens_two_wood' },
  'ladies-two-wood': { renewalColumn: 'comp_ladies_two_wood' },
  'handicap': { renewalColumn: 'comp_handicap' },
  'oldlands': { renewalColumn: 'comp_oldlands' },
  'veterans': { renewalColumn: 'comp_veterans' },
  'married-pairs': { renewalColumn: 'comp_married_pairs' },
  'drawn-pairs': { renewalColumn: 'comp_drawn_pairs', subRenewalColumn: 'sub_drawn_pairs' },
  'australian-pairs': { renewalColumn: 'comp_australian_pairs', subRenewalColumn: 'sub_australian_pairs' },
  'drawn-triples': { renewalColumn: 'comp_drawn_triples', subRenewalColumn: 'sub_drawn_triples' },
  'centenary': {},
};

// ============================================================================
// ROW MAPPERS
// ============================================================================

function mapCompetitionRow(row: any): Competition {
  return {
    compId: row.comp_id,
    displayName: row.display_name,
    compType: row.comp_type as CompType,
    status: row.status as CompStatus,
    year: row.year,
    finalsDate: row.finals_date,
    prelimPlayBy: row.prelim_play_by,
    r1PlayBy: row.r1_play_by,
    r2PlayBy: row.r2_play_by,
    qfPlayBy: row.qf_play_by,
    sfPlayBy: row.sf_play_by,
    prelimFixed: row.prelim_fixed === true,
    r1Fixed: row.r1_fixed === true,
    r2Fixed: row.r2_fixed === true,
    qfFixed: row.qf_fixed === true,
    sfFixed: row.sf_fixed === true,
    finalsFixed: row.finals_fixed === true,
    drawSideCount: row.draw_side_count,
    compStartDate: row.comp_start_date,
    compDescription: row.comp_description,
    extraDescription: row.extra_description,
    markersNotes: row.markers_notes,
  };
}

function mapMatchRow(row: any): CompMatch {
  return {
    matchId: row.match_id,
    round: row.round as CompRound,
    position: row.position,
    side1Usernames: row.side1_usernames ?? [],
    side2Usernames: row.side2_usernames,
    score1: row.score1,
    score2: row.score2,
    winnerSide: (row.winner_side as 1 | 2 | null) ?? null,
    status: row.status,
    playByDate: row.play_by_date,
    playedDate: row.played_date,
    marker: row.marker_username || '',
  };
}

// ============================================================================
// COMPETITIONS — READ
// ============================================================================

export async function getAllCompetitions(): Promise<Competition[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('competitions').select('*');
  if (error) throw new Error(`Failed to fetch competitions: ${error.message}`);
  return (data ?? []).map(mapCompetitionRow);
}

export async function getCompetitionById(compId: string): Promise<Competition | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('competitions').select('*').eq('comp_id', compId).maybeSingle();
  if (error) throw new Error(`Failed to fetch competition ${compId}: ${error.message}`);
  return data ? mapCompetitionRow(data) : null;
}

// ============================================================================
// COMPETITIONS — WRITE
// ============================================================================

export async function updateCompetition(comp: Competition): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('competitions').update({
    display_name: comp.displayName,
    comp_type: comp.compType,
    status: comp.status,
    year: comp.year,
    finals_date: comp.finalsDate || null,
    prelim_play_by: comp.prelimPlayBy || null,
    r1_play_by: comp.r1PlayBy || null,
    r2_play_by: comp.r2PlayBy || null,
    qf_play_by: comp.qfPlayBy || null,
    sf_play_by: comp.sfPlayBy || null,
    prelim_fixed: !!comp.prelimFixed,
    r1_fixed: !!comp.r1Fixed,
    r2_fixed: !!comp.r2Fixed,
    qf_fixed: !!comp.qfFixed,
    sf_fixed: !!comp.sfFixed,
    finals_fixed: !!comp.finalsFixed,
    draw_side_count: comp.drawSideCount ?? null,
    comp_start_date: comp.compStartDate || null,
    comp_description: comp.compDescription || null,
    extra_description: comp.extraDescription || null,
    markers_notes: comp.markersNotes || null,
  }).eq('comp_id', comp.compId);
  if (error) throw new Error(`Failed to update competition ${comp.compId}: ${error.message}`);
}

export async function updateDrawSideCount(compId: string, drawSideCount: number): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('competitions').update({ draw_side_count: drawSideCount }).eq('comp_id', compId);
  if (error) throw new Error(`Failed to update draw side count for ${compId}: ${error.message}`);
}

export async function updateCompetitionStatus(compId: string, status: CompStatus): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('competitions').update({ status }).eq('comp_id', compId);
  if (error) throw new Error(`Failed to update status for ${compId}: ${error.message}`);
}

// ============================================================================
// MATCHES — READ
// ============================================================================

export async function getCompetitionMatches(compId: string): Promise<CompMatch[]> {
  if (!COMP_SHEET_CONFIG[compId]) throw new Error(`Unknown competition: ${compId}`);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('competition_matches').select('*').eq('comp_id', compId);
  if (error) throw new Error(`Failed to fetch matches for ${compId}: ${error.message}`);
  return (data ?? []).map(mapMatchRow);
}

// ============================================================================
// BRACKET STRUCTURE HELPERS (pure — unchanged from competitions-sheets.ts)
// ============================================================================

function nextRoundLabel(currentRound: CompRound, nextCount: number): CompRound {
  if (currentRound === 'Prelim') return 'R1';
  if (nextCount === 1) return 'F';
  if (nextCount === 2) return 'SF';
  if (nextCount === 4) return 'QF';
  if (nextCount === 8) return 'R2';
  return 'R1';
}

function buildBracketStructure(
  firstRound: CompRound,
  firstCount: number
): { round: CompRound; count: number }[] {
  const rounds: { round: CompRound; count: number }[] = [
    { round: firstRound, count: firstCount },
  ];
  let current = firstRound;
  let count = firstCount;
  while (count > 1) {
    count = Math.floor(count / 2);
    const next = nextRoundLabel(current, count);
    rounds.push({ round: next, count });
    current = next;
  }
  return rounds;
}

function findNextRound(
  currentRound: CompRound,
  allMatches: CompMatch[]
): CompRound | null {
  const presentRounds = [...new Set(allMatches.map((m) => m.round))];
  presentRounds.sort(
    (a, b) => ROUND_ORDER.indexOf(a) - ROUND_ORDER.indexOf(b)
  );
  const idx = presentRounds.indexOf(currentRound);
  if (idx === -1 || idx === presentRounds.length - 1) return null;
  return presentRounds[idx + 1];
}

function playByDateForRound(comp: Competition, round: CompRound): string {
  switch (round) {
    case 'Prelim': return comp.prelimPlayBy || '';
    case 'R1':     return comp.r1PlayBy || '';
    case 'R2':     return comp.r2PlayBy || '';
    case 'QF':     return comp.qfPlayBy || '';
    case 'SF':     return comp.sfPlayBy || '';
    case 'F':      return comp.finalsDate || '';
    default:       return '';
  }
}

// ============================================================================
// MATCHES — WRITE (SETUP)
// ============================================================================

/**
 * Save the full bracket for a competition (used during setup/draw entry).
 * Replaces all of this competition's match rows with the freshly built set.
 * Also updates the competition status to 'Draw Done'.
 */
export async function saveCompetitionSetup(
  compId: string,
  matches: CompMatch[]
): Promise<void> {
  if (!COMP_SHEET_CONFIG[compId]) throw new Error(`Unknown competition: ${compId}`);

  const firstRound = matches[0]?.round ?? 'R1';
  const firstCount = matches.length;
  const structure = buildBracketStructure(firstRound, firstCount);

  // Fetch competition and existing matches in parallel. Existing matches are used to
  // preserve non-draw fields (played dates, scores, status, marker) on first-round
  // matches, and custom play-by dates on subsequent rounds. Without this, re-saving the
  // draw to fix a player name would blank played dates etc.
  const [comp, existingMatches] = await Promise.all([
    getCompetitionById(compId),
    getCompetitionMatches(compId),
  ]);
  const existingByMatchId = new Map(existingMatches.map((m) => [m.matchId, m]));

  const mergedFirstRound: CompMatch[] = matches.map((m) => {
    const ex = existingByMatchId.get(m.matchId);
    if (!ex) return m;
    return {
      ...m,
      playedDate: ex.playedDate ?? m.playedDate,
      score1: ex.score1 ?? m.score1,
      score2: ex.score2 ?? m.score2,
      winnerSide: ex.winnerSide ?? m.winnerSide,
      status: (ex.status && ex.status !== 'Pending') ? ex.status : m.status,
      marker: ex.marker || m.marker,
    };
  });

  // Placeholder matches for every round after the first, preserving any data already
  // recorded on those rounds. Without this, re-saving the draw would wipe out results
  // and bracket progress already recorded beyond round one.
  const subsequentMatches: CompMatch[] = [];
  for (const { round, count } of structure.slice(1)) {
    const defaultPlayByDate = comp ? playByDateForRound(comp, round) : '';
    for (let pos = 1; pos <= count; pos++) {
      const matchId = `${compId}-${round.toLowerCase()}-${pos}`;
      const existing = existingByMatchId.get(matchId);
      subsequentMatches.push({
        matchId,
        round,
        position: pos,
        side1Usernames: existing?.side1Usernames ?? [],
        side2Usernames: existing?.side2Usernames ?? null,
        score1: existing?.score1 ?? null,
        score2: existing?.score2 ?? null,
        winnerSide: existing?.winnerSide ?? null,
        status: existing?.status ?? 'Pending',
        playByDate: existing?.playByDate || defaultPlayByDate || null,
        playedDate: existing?.playedDate || null,
        marker: existing?.marker || '',
      });
    }
  }

  const allMatches = [...mergedFirstRound, ...subsequentMatches];

  // Auto-propagate bye matches (side2 === null) into the next round immediately.
  if (structure.length > 1) {
    const nextRoundName = structure[1].round;
    for (const m of mergedFirstRound) {
      const isByeMatch = (m.side2Usernames === null || m.side2Usernames.length === 0) && m.side1Usernames.length > 0;
      if (isByeMatch) {
        m.status = 'Bye';
        m.winnerSide = 1;

        const nextPosition = Math.ceil(m.position / 2);
        const nextMatchId = `${compId}-${nextRoundName.toLowerCase()}-${nextPosition}`;
        const nextMatch = allMatches.find((x) => x.matchId === nextMatchId);
        if (nextMatch) {
          if (m.position % 2 === 1) {
            nextMatch.side1Usernames = [...m.side1Usernames];
          } else {
            nextMatch.side2Usernames = [...m.side1Usernames];
          }
        }
      }
    }
  }

  // For rounds flagged as fixed-day, pre-fill playedDate = playByDate on every Pending
  // match in that round that doesn't already have a played date, so they appear in the
  // home-page Coming Up.
  if (comp) {
    const fixedByRound: { [round: string]: boolean } = {
      Prelim: !!comp.prelimFixed,
      R1: !!comp.r1Fixed,
      R2: !!comp.r2Fixed,
      QF: !!comp.qfFixed,
      SF: !!comp.sfFixed,
      F: !!comp.finalsFixed,
    };
    for (const m of allMatches) {
      if (fixedByRound[m.round] && m.status === 'Pending' && !m.playedDate && m.playByDate) {
        m.playedDate = m.playByDate;
      }
    }
  }

  const supabase = getSupabaseClient();

  // Replace this competition's matches wholesale — same semantics as the Sheets
  // version's clear-then-rewrite.
  const { error: deleteError } = await supabase.from('competition_matches').delete().eq('comp_id', compId);
  if (deleteError) throw new Error(`Failed to clear existing matches for ${compId}: ${deleteError.message}`);

  const rows = allMatches.map((m) => ({
    comp_id: compId,
    match_id: m.matchId,
    round: m.round,
    position: m.position,
    side1_usernames: m.side1Usernames,
    side2_usernames: m.side2Usernames,
    score1: m.score1,
    score2: m.score2,
    winner_side: m.winnerSide,
    status: m.status,
    play_by_date: m.playByDate || null,
    played_date: m.playedDate || null,
    marker_username: null, // Marker column — always blank on fresh setup rows
  }));

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from('competition_matches').insert(rows);
    if (insertError) throw new Error(`Failed to save matches for ${compId}: ${insertError.message}`);
  }

  await updateCompetitionStatus(compId, 'Draw Done');
}

// ============================================================================
// WINNER PROPAGATION
// ============================================================================

function nextRoundTarget(
  compId: string,
  match: CompMatch,
  allMatches: CompMatch[]
): { nextMatchId: string; targetSide: 'side1Usernames' | 'side2Usernames' } | null {
  const nextRound = findNextRound(match.round, allMatches);
  if (!nextRound) return null;
  const nextPosition = Math.ceil(match.position / 2);
  const nextMatchId = `${compId}-${nextRound.toLowerCase()}-${nextPosition}`;
  const targetSide: 'side1Usernames' | 'side2Usernames' =
    match.position % 2 === 1 ? 'side1Usernames' : 'side2Usernames';
  return { nextMatchId, targetSide };
}

/**
 * Propagate the winner of a completed match into the correct slot of the next-round
 * match. Overwrites whatever is there, so re-running it after a correction replaces a
 * wrongly-advanced side.
 */
export async function propagateWinnerToNextRound(
  compId: string,
  completedMatch: CompMatch,
  winnerSide: 1 | 2
): Promise<void> {
  const winnerUsernames =
    winnerSide === 1
      ? completedMatch.side1Usernames
      : completedMatch.side2Usernames ?? [];

  if (winnerUsernames.length === 0) return;

  const allMatches = await getCompetitionMatches(compId);
  const target = nextRoundTarget(compId, completedMatch, allMatches);
  if (!target) return; // Completed match was the Final — nothing to propagate

  const updates: Parameters<typeof updateMatch>[2] = {};
  if (target.targetSide === 'side1Usernames') updates.side1Usernames = winnerUsernames;
  else updates.side2Usernames = winnerUsernames;
  await updateMatch(compId, target.nextMatchId, updates);
}

/**
 * Find the next-round match a given match feeds into (or null if it's the Final).
 * Used to guard corrections/resets: you cannot change who advances, or blank a match,
 * if that next-round match has already been played.
 */
export async function getNextRoundMatch(
  compId: string,
  match: CompMatch,
  allMatches?: CompMatch[]
): Promise<CompMatch | null> {
  const matches = allMatches ?? (await getCompetitionMatches(compId));
  const target = nextRoundTarget(compId, match, matches);
  if (!target) return null;
  for (let i = 0; i < matches.length; i++) {
    if (matches[i].matchId === target.nextMatchId) return matches[i];
  }
  return null;
}

/**
 * Reset a completed match back to Pending: clears its score/winner/status/played date
 * (keeping the participants and play-by date) and removes the side it previously
 * advanced from the next-round slot. The caller MUST ensure that next-round match has
 * not already been played — otherwise clearing the slot orphans that result.
 */
export async function resetMatch(compId: string, match: CompMatch): Promise<void> {
  await updateMatch(compId, match.matchId, {
    score1: null,
    score2: null,
    winnerSide: null,
    status: 'Pending',
    playedDate: null,
  });

  const allMatches = await getCompetitionMatches(compId);
  const target = nextRoundTarget(compId, match, allMatches);
  if (!target) return;
  let nextExists = false;
  for (let i = 0; i < allMatches.length; i++) {
    if (allMatches[i].matchId === target.nextMatchId) { nextExists = true; break; }
  }
  if (!nextExists) return;
  const updates: Parameters<typeof updateMatch>[2] = {};
  if (target.targetSide === 'side1Usernames') updates.side1Usernames = [];
  else updates.side2Usernames = [];
  await updateMatch(compId, target.nextMatchId, updates);
}

// ============================================================================
// MATCHES — WRITE (SCORE / WALKOVER / SUBSTITUTION)
// ============================================================================

export async function updateMatch(
  compId: string,
  matchId: string,
  updates: {
    score1?: number | null;
    score2?: number | null;
    winnerSide?: 1 | 2 | null;
    status?: CompMatch['status'];
    playedDate?: string | null;
    side1Usernames?: string[];
    side2Usernames?: string[] | null;
    playByDate?: string | null;
    // Username of the member acting as marker — empty string clears the field, absent = no change
    marker?: string;
  }
): Promise<void> {
  if (!COMP_SHEET_CONFIG[compId]) throw new Error(`Unknown competition: ${compId}`);

  const columnUpdates: Record<string, unknown> = {};
  if (updates.score1 !== undefined) columnUpdates.score1 = updates.score1;
  if (updates.score2 !== undefined) columnUpdates.score2 = updates.score2;
  if (updates.winnerSide !== undefined) columnUpdates.winner_side = updates.winnerSide;
  if (updates.status !== undefined) columnUpdates.status = updates.status;
  if (updates.playedDate !== undefined) columnUpdates.played_date = updates.playedDate || null;
  if (updates.playByDate !== undefined) columnUpdates.play_by_date = updates.playByDate || null;
  if (updates.side1Usernames !== undefined) columnUpdates.side1_usernames = updates.side1Usernames;
  if (updates.side2Usernames !== undefined) columnUpdates.side2_usernames = updates.side2Usernames;
  if (updates.marker !== undefined) columnUpdates.marker_username = updates.marker || null;

  if (Object.keys(columnUpdates).length === 0) return;
  columnUpdates.updated_at = new Date().toISOString();

  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('competition_matches')
    .update(columnUpdates, { count: 'exact' })
    .eq('comp_id', compId)
    .eq('match_id', matchId);
  if (error) throw new Error(`Failed to update match ${matchId}: ${error.message}`);
  if (!count) throw new Error(`Match '${matchId}' not found in ${compId}`);

  // If the match is now Complete or Walkover, bump competition status to In Progress
  if (updates.status === 'Complete' || updates.status === 'Walkover') {
    const comp = await getCompetitionById(compId);
    if (comp && comp.status === 'Draw Done') {
      await updateCompetitionStatus(compId, 'In Progress');
    }
  }
}

// ============================================================================
// RENEWALS — ENTRANT LOOKUP
// ============================================================================

/**
 * Get usernames of members who entered a specific competition,
 * sorted by member type (Playing Men first, then Playing Ladies) then surname.
 *
 * For pairs/triples the substitute list is also returned separately.
 */
export async function getEntrantsFromRenewals(compId: string): Promise<{
  entrants: string[];
  subs: string[];
}> {
  const cfg = COMP_SHEET_CONFIG[compId];
  if (!cfg) throw new Error(`Unknown competition: ${compId}`);

  // No renewal column = open draw from a hat; no pre-set entrants list.
  // Members will appear under "Other members" in the player search.
  if (!cfg.renewalColumn) {
    return { entrants: [], subs: [] };
  }

  const rows = await getRenewalCompetitionEntries(getCurrentSeasonYear());

  const entrantUsernames: string[] = [];
  const subUsernames: string[] = [];

  for (const row of rows) {
    const username = row['username'];
    if (!username) continue;

    const entrantVal = row[cfg.renewalColumn];
    if (entrantVal === true) {
      entrantUsernames.push(String(username));
    }

    if (cfg.subRenewalColumn !== undefined) {
      const subVal = row[cfg.subRenewalColumn];
      if (subVal === true) {
        subUsernames.push(String(username));
      }
    }
  }

  // Sort: Playing Men (PM) first, Playing Ladies (PL) second, then by surname
  const users = await getAllUsers();
  const userMap = new Map(users.map((u) => [u.userName.toLowerCase(), u]));

  function sortScore(username: string): string {
    const u = userMap.get(username.toLowerCase());
    if (!u) return `ZZ_${username}`;
    const typeOrder = u.memberType === 'Playing Man' ? '1' : u.memberType === 'Playing Lady' ? '2' : '3';
    return `${typeOrder}_${u.lastName.toLowerCase()}_${u.firstName.toLowerCase()}`;
  }

  entrantUsernames.sort((a, b) => sortScore(a).localeCompare(sortScore(b)));
  subUsernames.sort((a, b) => sortScore(a).localeCompare(sortScore(b)));

  return { entrants: entrantUsernames, subs: subUsernames };
}

// ============================================================================
// MEMBER INFO ENRICHMENT
// ============================================================================

/**
 * Build a CompMemberInfo lookup map from Postgres member data.
 * Used by API routes to enrich match data before sending to the client.
 */
export async function getMemberInfoMap(): Promise<Map<string, CompMemberInfo>> {
  const users = await getAllUsers();
  const map = new Map<string, CompMemberInfo>();
  for (const u of users) {
    map.set(u.userName.toLowerCase(), {
      username: u.userName,
      fullName: u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      handicap: u.handicap,
      memberType: u.memberType,
      mobile: u.mobile,
      email: u.emailAddress,
    });
  }
  return map;
}

export async function getMemberInfo(username: string): Promise<CompMemberInfo | null> {
  const map = await getMemberInfoMap();
  return map.get(username.toLowerCase()) ?? null;
}

// ============================================================================
// COMPETITIONS SETTINGS (competition_settings table: key | value)
// ============================================================================

// The three shared rules-text blocks live in competition_settings as key/value rows.
// The rules page renders each under a fixed heading; the table holds only the body text
// (light formatting: newlines + manual numbering + <b>/<i>/<u>).
//   description       → General Rules
//   extra_description → Standard Scoring Procedure
//   markers_notes     → Marker Responsibilities
export interface CompetitionRulesText {
  generalRules: string;
  scoringProcedure: string;
  markerResponsibilities: string;
}

const RULES_TEXT_KEYS = {
  generalRules: 'description',
  scoringProcedure: 'extra_description',
  markerResponsibilities: 'markers_notes',
} as const;

/** Read the three shared rules-text blocks from competition_settings. */
export async function getCompetitionRulesText(): Promise<CompetitionRulesText> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('competition_settings').select('key, value');
  if (error) throw new Error(`Failed to fetch competition rules text: ${error.message}`);

  const byKey: Record<string, string> = {};
  for (const row of data ?? []) {
    byKey[row.key] = row.value ?? '';
  }

  return {
    generalRules: byKey[RULES_TEXT_KEYS.generalRules] ?? '',
    scoringProcedure: byKey[RULES_TEXT_KEYS.scoringProcedure] ?? '',
    markerResponsibilities: byKey[RULES_TEXT_KEYS.markerResponsibilities] ?? '',
  };
}

/** Upsert the three shared rules-text blocks. */
export async function setCompetitionRulesText(text: CompetitionRulesText): Promise<void> {
  const supabase = getSupabaseClient();
  const rows = [
    { key: RULES_TEXT_KEYS.generalRules, value: text.generalRules },
    { key: RULES_TEXT_KEYS.scoringProcedure, value: text.scoringProcedure },
    { key: RULES_TEXT_KEYS.markerResponsibilities, value: text.markerResponsibilities },
  ];
  const { error } = await supabase.from('competition_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(`Failed to save competition rules text: ${error.message}`);
}
