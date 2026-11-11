// src/components/YearSelect.tsx
// The year picker used on /competitions, /rowland and /friendlies — same look as the one
// on /fixtures. Hidden until there's more than one year to choose from.

'use client';

interface YearSelectProps {
  years: (number | string)[];
  value: number | string;
  onChange: (year: string) => void;
}

export function YearSelect({ years, value, onChange }: YearSelectProps) {
  if (years.length < 2) return null;
  return (
    <select
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Year"
      className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white"
    >
      {years.map((y) => (
        <option key={String(y)} value={String(y)}>{y}</option>
      ))}
    </select>
  );
}

/** The note shown above a past year's results. */
export function PastYearNotice({ year }: { year: number | string }) {
  return (
    <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-900">
      You&apos;re looking at <strong>{year}</strong>. Past years are read only.
    </div>
  );
}
