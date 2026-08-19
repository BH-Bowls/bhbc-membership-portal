// src/lib/invite-games-supabase.ts
// Postgres-backed replacement for invite-games-sheets.ts. Same function
// names/signatures throughout, so every consumer route needs only an import swap.
//
// One table (supabase/migrations/0044_invite_games.sql).

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import type { InviteGame } from '@/types/invite-games';

function mapRow(row: any): InviteGame {
  return {
    inviteGameId: row.invite_game_id,
    title: row.title,
    description: row.description,
    closingDate: row.closing_date,
    gameDate: row.game_date,
    createdByUsername: row.created_by_username,
    createdByFullName: '', // populated by enrichGamesWithNames
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedByUsername: row.updated_by_username,
  };
}

/** Enrich invite games with current full names from Members, looked up dynamically. */
async function enrichGamesWithNames(games: InviteGame[]): Promise<InviteGame[]> {
  if (games.length === 0) return games;
  try {
    const users = await getAllUsers();
    const nameMap = new Map<string, string>();
    for (const user of users) {
      if (user.userName) nameMap.set(user.userName, user.fullName || user.userName);
    }
    return games.map((game) => ({
      ...game,
      createdByFullName: nameMap.get(game.createdByUsername) || game.createdByUsername || 'Unknown',
    }));
  } catch (error) {
    console.error('[enrichGamesWithNames] Error enriching games:', error);
    return games;
  }
}

/** Generate next invite game ID (IG-YYYY-NNN format, resets yearly). */
async function generateNextInviteGameId(): Promise<string> {
  const supabase = getSupabaseClient();
  const currentYear = new Date().getFullYear();
  const { data, error } = await supabase
    .from('invite_games')
    .select('invite_game_id')
    .like('invite_game_id', `IG-${currentYear}-%`);
  if (error) throw new Error(`Failed to generate invite game ID: ${error.message}`);

  let maxNumber = 0;
  const prefix = `IG-${currentYear}-`;
  for (const row of data ?? []) {
    const num = parseInt((row.invite_game_id as string).substring(prefix.length), 10);
    if (!isNaN(num) && num > maxNumber) maxNumber = num;
  }
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`;
}

/** Get all invite games, sorted by game date descending (most recent first). */
export async function getAllInviteGames(): Promise<InviteGame[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('invite_games').select('*');
  if (error) throw new Error(`Failed to fetch invite games: ${error.message}`);

  const games = (data ?? []).map(mapRow);
  const enriched = await enrichGamesWithNames(games);

  return enriched.sort((a, b) => {
    if (!a.gameDate && !b.gameDate) return 0;
    if (!a.gameDate) return 1;
    if (!b.gameDate) return -1;
    return b.gameDate.localeCompare(a.gameDate);
  });
}

export async function getInviteGameById(inviteGameId: string): Promise<InviteGame | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('invite_games').select('*').eq('invite_game_id', inviteGameId).maybeSingle();
  if (error) throw new Error(`Failed to fetch invite game ${inviteGameId}: ${error.message}`);
  if (!data) return null;
  const [enriched] = await enrichGamesWithNames([mapRow(data)]);
  return enriched;
}

export async function createInviteGame(data: {
  title: string;
  description: string;
  closingDate: string | null;
  gameDate: string | null;
  createdByUsername: string;
}): Promise<{ success: boolean; inviteGameId?: string; error?: string }> {
  try {
    const inviteGameId = await generateNextInviteGameId();
    const now = new Date().toISOString();

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('invite_games').insert({
      invite_game_id: inviteGameId,
      title: data.title,
      description: data.description,
      closing_date: data.closingDate,
      game_date: data.gameDate,
      created_by_username: data.createdByUsername,
      created_at: now,
      updated_at: now,
      updated_by_username: data.createdByUsername,
    });
    if (error) throw new Error(error.message);

    return { success: true, inviteGameId };
  } catch (error) {
    console.error('[createInviteGame] Error:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to create invite game' };
  }
}

export async function updateInviteGame(
  inviteGameId: string,
  updates: Partial<Pick<InviteGame, 'title' | 'description' | 'closingDate' | 'gameDate'>>,
  updatedByUsername: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const columnUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) columnUpdates.title = updates.title;
    if (updates.description !== undefined) columnUpdates.description = updates.description;
    if ('closingDate' in updates) columnUpdates.closing_date = updates.closingDate;
    if ('gameDate' in updates) columnUpdates.game_date = updates.gameDate;
    columnUpdates.updated_at = new Date().toISOString();
    columnUpdates.updated_by_username = updatedByUsername;

    const supabase = getSupabaseClient();
    const { error, count } = await supabase
      .from('invite_games')
      .update(columnUpdates, { count: 'exact' })
      .eq('invite_game_id', inviteGameId);
    if (error) throw new Error(error.message);
    if (!count) return { success: false, error: 'Invite game not found' };

    return { success: true };
  } catch (error) {
    console.error(`[updateInviteGame] Error for ${inviteGameId}:`, error);
    return { success: false, error: error instanceof Error ? error.message : 'Failed to update invite game' };
  }
}

export async function deleteInviteGame(inviteGameId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseClient();
  const { error, count } = await supabase.from('invite_games').delete({ count: 'exact' }).eq('invite_game_id', inviteGameId);
  if (error) return { success: false, error: error.message };
  if (!count) return { success: false, error: 'Invite game not found' };
  return { success: true };
}
