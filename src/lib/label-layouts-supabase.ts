// src/lib/label-layouts-supabase.ts
// Named label-sheet layouts for Print Labels (supabase/migrations/0076_label_layouts.sql).
// Each label type's default layout is a config key (label_default_layout_<type>),
// read and written through config-supabase.ts like any other setting.

import { getSupabaseClient } from './supabase';
import { validateLayout } from '@/types/label-layouts';
import type { LabelLayout, LabelLayoutInput } from '@/types/label-layouts';

interface LayoutRow {
  id: string;
  name: string;
  description: string | null;
  width_mm: number | string;
  height_mm: number | string;
  top_margin_mm: number | string;
  left_margin_mm: number | string;
  column_gap_mm: number | string;
  row_gap_mm: number | string;
  per_row: number;
  per_col: number;
  card_outline: boolean;
}

function mapLayout(row: LayoutRow): LabelLayout {
  // numeric columns can come back as strings, so convert them explicitly
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    widthMm: Number(row.width_mm),
    heightMm: Number(row.height_mm),
    topMarginMm: Number(row.top_margin_mm),
    leftMarginMm: Number(row.left_margin_mm),
    columnGapMm: Number(row.column_gap_mm),
    rowGapMm: Number(row.row_gap_mm),
    perRow: row.per_row,
    perCol: row.per_col,
    cardOutline: row.card_outline,
  };
}

function toRow(layout: LabelLayoutInput): Record<string, unknown> {
  let description: string | null = null;
  if (layout.description && layout.description.trim()) description = layout.description.trim();
  return {
    name: layout.name.trim(),
    description,
    width_mm: layout.widthMm,
    height_mm: layout.heightMm,
    top_margin_mm: layout.topMarginMm,
    left_margin_mm: layout.leftMarginMm,
    column_gap_mm: layout.columnGapMm,
    row_gap_mm: layout.rowGapMm,
    per_row: layout.perRow,
    per_col: layout.perCol,
    card_outline: layout.cardOutline,
  };
}

/** Turns a unique-name clash into a friendly message; other errors are thrown. */
function nameClash(message: string): string | null {
  if (message.includes('label_layouts_name_key')) return 'There is already a layout with that name';
  return null;
}

/** All layouts, by name. */
export async function getLabelLayouts(): Promise<LabelLayout[]> {
  const { data, error } = await getSupabaseClient().from('label_layouts').select('*').order('name', { ascending: true });
  if (error) throw new Error(`Failed to fetch label layouts: ${error.message}`);
  const layouts: LabelLayout[] = [];
  for (const row of data || []) layouts.push(mapLayout(row as LayoutRow));
  return layouts;
}

export async function createLabelLayout(layout: LabelLayoutInput): Promise<{ layout?: LabelLayout; error?: string }> {
  const invalid = validateLayout(layout);
  if (invalid) return { error: invalid };
  const { data, error } = await getSupabaseClient().from('label_layouts').insert(toRow(layout)).select('*').single();
  if (error) {
    const clash = nameClash(error.message);
    if (clash) return { error: clash };
    throw new Error(`Failed to create label layout: ${error.message}`);
  }
  return { layout: mapLayout(data as LayoutRow) };
}

export async function updateLabelLayout(id: string, layout: LabelLayoutInput): Promise<{ layout?: LabelLayout; error?: string }> {
  const invalid = validateLayout(layout);
  if (invalid) return { error: invalid };
  const { data, error } = await getSupabaseClient()
    .from('label_layouts')
    .update({ ...toRow(layout), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    const clash = nameClash(error.message);
    if (clash) return { error: clash };
    throw new Error(`Failed to update label layout: ${error.message}`);
  }
  if (!data) return { error: 'Layout not found' };
  return { layout: mapLayout(data as LayoutRow) };
}

/** Deletes a layout, unless it's the last one or a label type's default. */
export async function deleteLabelLayout(id: string, defaultIds: string[]): Promise<{ error?: string }> {
  if (defaultIds.includes(id)) return { error: 'This layout is a default for a label type — choose another default first' };
  const supabase = getSupabaseClient();
  const { count, error: countError } = await supabase.from('label_layouts').select('*', { count: 'exact', head: true });
  if (countError) throw new Error(`Failed to count label layouts: ${countError.message}`);
  if (count !== null && count <= 1) return { error: 'You need at least one layout' };
  const { error } = await supabase.from('label_layouts').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete label layout: ${error.message}`);
  return {};
}
