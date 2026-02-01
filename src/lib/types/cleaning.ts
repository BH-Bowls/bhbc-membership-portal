// src/lib/types/cleaning.ts
// Types for Cleaning Rota feature

export interface CleaningRotaEntry {
  rowNumber: number;
  date: string;           // Raw date from sheet
  displayDate: string;    // Formatted date for display (e.g., "Sat, 05 September")
  lead: string;           // Username of lead cleaner
  second: string;         // Username of second cleaner
  third: string;          // Username of third cleaner
  fourth: string;         // Username of fourth cleaner
}

export type CleaningPosition = 'lead' | 'second' | 'third' | 'fourth';
