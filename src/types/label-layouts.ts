// src/types/label-layouts.ts
// Named label-sheet layouts for Print Labels (supabase/migrations/0076_label_layouts.sql).

export type LabelType = 'address' | 'booklet' | 'locker' | 'card';

export const LABEL_TYPES: { id: LabelType; label: string }[] = [
  { id: 'address', label: 'Address' },
  { id: 'booklet', label: 'Booklet' },
  { id: 'locker', label: 'Locker' },
  { id: 'card', label: 'Membership Card' },
];

/** The config key holding a label type's default layout id. */
export function defaultLayoutKey(type: LabelType): string {
  return `label_default_layout_${type}`;
}

export interface LabelLayout {
  id: string;
  name: string;
  description: string | null;
  widthMm: number;
  heightMm: number;
  topMarginMm: number;
  leftMarginMm: number;
  columnGapMm: number;
  rowGapMm: number;
  perRow: number;
  perCol: number;
  // Membership cards: true = draw a credit-card cut-out outline inside the label;
  // false = the card fills the whole label (card-sized sheets, or a sticker for a blank card)
  cardOutline: boolean;
}

/** A layout as entered in the admin form (everything but the id). */
export type LabelLayoutInput = Omit<LabelLayout, 'id'>;

/** A4 portrait, in mm. */
export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

/** Checks a layout's numbers make sense and its labels fit on an A4 sheet; returns an error message or null. */
export function validateLayout(layout: LabelLayoutInput): string | null {
  if (!layout.name || !layout.name.trim()) return 'Name is required';
  const sizes: [number, string][] = [
    [layout.widthMm, 'Label width'],
    [layout.heightMm, 'Label height'],
  ];
  for (const [value, label] of sizes) {
    if (!Number.isFinite(value) || value <= 0) return `${label} must be more than 0`;
  }
  const spacings: [number, string][] = [
    [layout.topMarginMm, 'Top margin'],
    [layout.leftMarginMm, 'Left margin'],
    [layout.columnGapMm, 'Column gap'],
    [layout.rowGapMm, 'Row gap'],
  ];
  for (const [value, label] of spacings) {
    if (!Number.isFinite(value) || value < 0) return `${label} must be 0 or more`;
  }
  if (!Number.isInteger(layout.perRow) || layout.perRow < 1 || layout.perRow > 20) return 'Labels across must be a whole number from 1 to 20';
  if (!Number.isInteger(layout.perCol) || layout.perCol < 1 || layout.perCol > 50) return 'Labels down must be a whole number from 1 to 50';

  const usedWidth = layout.leftMarginMm + layout.perRow * layout.widthMm + (layout.perRow - 1) * layout.columnGapMm;
  if (usedWidth > PAGE_WIDTH_MM + 0.01) return `The labels are ${usedWidth.toFixed(1)} mm across — wider than an A4 sheet (210 mm)`;
  const usedHeight = layout.topMarginMm + layout.perCol * layout.heightMm + (layout.perCol - 1) * layout.rowGapMm;
  if (usedHeight > PAGE_HEIGHT_MM + 0.01) return `The labels are ${usedHeight.toFixed(1)} mm down — taller than an A4 sheet (297 mm)`;
  return null;
}
