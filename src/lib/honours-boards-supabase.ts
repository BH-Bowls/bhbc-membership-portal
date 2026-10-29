// src/lib/honours-boards-supabase.ts
// Printed honours board layouts (supabase/migrations/0078_honours_boards.sql, layout
// column added in 0080). The shared year settings (start year, years per set) are config
// keys, read and written through config-supabase.ts like any other setting.

import { getSupabaseClient } from './supabase';
import { isBoardLayout, validateBoard } from '@/types/honours-boards';
import type { HonoursBoard, HonoursBoardColumn, HonoursBoardInput } from '@/types/honours-boards';

interface BoardRow {
  id: string;
  name: string;
  display_order: number;
  layout: string;
  columns: unknown;
}

function mapBoard(row: BoardRow): HonoursBoard {
  // columns is jsonb — rebuild each entry so a hand-edited row can't smuggle in odd types
  const columns: HonoursBoardColumn[] = [];
  if (Array.isArray(row.columns)) {
    for (const raw of row.columns as Record<string, unknown>[]) {
      columns.push({
        field: String(raw.field ?? ''),
        heading: String(raw.heading ?? ''),
        width: Number(raw.width ?? 1),
      });
    }
  }
  // The database check only allows known layouts, but fall back to the default just in case
  const layout = isBoardLayout(row.layout) ? row.layout : 'a2_plus_a3';
  return { id: row.id, name: row.name, displayOrder: row.display_order, layout, columns };
}

function toRow(board: HonoursBoardInput): Record<string, unknown> {
  return {
    name: board.name.trim(),
    display_order: board.displayOrder,
    layout: board.layout,
    columns: board.columns.map((c) => ({ field: c.field, heading: c.heading.trim(), width: c.width })),
  };
}

/** Turns a unique-name clash into a friendly message; other errors are thrown. */
function nameClash(message: string): string | null {
  if (message.includes('honours_boards_name_key')) return 'There is already a board with that name';
  return null;
}

/** All boards, in display order. */
export async function getHonoursBoards(): Promise<HonoursBoard[]> {
  const { data, error } = await getSupabaseClient()
    .from('honours_boards')
    .select('*')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to fetch honours boards: ${error.message}`);
  const boards: HonoursBoard[] = [];
  for (const row of data || []) boards.push(mapBoard(row as BoardRow));
  return boards;
}

export async function createHonoursBoard(board: HonoursBoardInput): Promise<{ board?: HonoursBoard; error?: string }> {
  const invalid = validateBoard(board);
  if (invalid) return { error: invalid };
  const { data, error } = await getSupabaseClient().from('honours_boards').insert(toRow(board)).select('*').single();
  if (error) {
    const clash = nameClash(error.message);
    if (clash) return { error: clash };
    throw new Error(`Failed to create honours board: ${error.message}`);
  }
  return { board: mapBoard(data as BoardRow) };
}

export async function updateHonoursBoard(id: string, board: HonoursBoardInput): Promise<{ board?: HonoursBoard; error?: string }> {
  const invalid = validateBoard(board);
  if (invalid) return { error: invalid };
  const { data, error } = await getSupabaseClient()
    .from('honours_boards')
    .update({ ...toRow(board), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    const clash = nameClash(error.message);
    if (clash) return { error: clash };
    throw new Error(`Failed to update honours board: ${error.message}`);
  }
  if (!data) return { error: 'Board not found' };
  return { board: mapBoard(data as BoardRow) };
}

export async function deleteHonoursBoard(id: string): Promise<void> {
  const { error } = await getSupabaseClient().from('honours_boards').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete honours board: ${error.message}`);
}
