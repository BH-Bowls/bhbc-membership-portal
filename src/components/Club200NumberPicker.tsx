'use client';

// src/components/Club200NumberPicker.tsx
// 200 Club numbers on the renewal form (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §9).
// A grid of the season's numbers: taken ones are crossed out, tapping a free one picks
// it (up to one per entry), tapping it again unpicks it. Entries left without a pick are
// "Any number" — the 200 Club organiser gives those out by hand. Picks aren't held until
// the renewal is submitted, which is when the numbers are given out.

export interface Club200Info {
  season: string;
  open: boolean;
  price: number;
  poolSize: number;
  takenByOthers: string[];
  held: string[];
}

function listNumbers(numbers: string[]): string {
  const sorted = numbers.slice();
  sorted.sort((a, b) => Number(a) - Number(b));
  if (sorted.length <= 1) return sorted.join('');
  return sorted.slice(0, sorted.length - 1).join(', ') + ' and ' + sorted[sorted.length - 1];
}

export default function Club200NumberPicker({ info, entries, picks, disabled, submitted, onChange }: {
  info: Club200Info;
  entries: number;
  picks: string[];
  disabled: boolean;     // not editing — show the picks as text
  submitted: boolean;    // show the numbers they hold instead of the picks
  onChange: (picks: string[]) => void;
}) {
  if (entries <= 0) return null;

  if (submitted) {
    const toAllocate = entries - info.held.length;
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-900">
        {info.held.length > 0 && (
          <p>Your {info.held.length === 1 ? 'number is' : 'numbers are'} <span className="font-semibold">{listNumbers(info.held)}</span>.</p>
        )}
        {toAllocate > 0 && (
          <p className={info.held.length > 0 ? 'mt-1 text-gray-700' : 'text-gray-700'}>
            {toAllocate === 1 ? '1 entry' : `${toAllocate} entries`} still to be given a number by the 200 Club organiser.
          </p>
        )}
      </div>
    );
  }

  const anyCount = entries - picks.length;
  const takenPicks: string[] = [];
  for (const p of picks) {
    if (info.takenByOthers.indexOf(p) !== -1) takenPicks.push(p);
  }

  if (disabled) {
    if (picks.length === 0) {
      return <p className="text-sm text-gray-700">No numbers picked — the 200 Club organiser will give you {entries === 1 ? 'one' : 'yours'}.</p>;
    }
    let text = `Numbers picked: ${listNumbers(picks)}`;
    if (anyCount > 0) text += `, plus ${anyCount} any number`;
    return (
      <p className="text-sm text-gray-700">{text}. They aren&apos;t held until the renewal is submitted.</p>
    );
  }

  function toggle(n: string) {
    if (picks.indexOf(n) !== -1) {
      const next: string[] = [];
      for (const p of picks) {
        if (p !== n) next.push(p);
      }
      onChange(next);
      return;
    }
    // A pick someone else has since taken doesn't hold a slot — the new number replaces it
    const next: string[] = [];
    let replaced = false;
    for (const p of picks) {
      if (!replaced && picks.length >= entries && takenPicks.indexOf(p) !== -1) {
        replaced = true;
        continue;
      }
      next.push(p);
    }
    if (next.length >= entries) return;
    next.push(n);
    next.sort((a, b) => Number(a) - Number(b));
    onChange(next);
  }

  const full = picks.length - takenPicks.length >= entries;
  const numbers: string[] = [];
  for (let i = 1; i <= info.poolSize; i++) numbers.push(String(i));

  return (
    <div>
      <p className="text-sm text-gray-700 mb-2">
        Pick a number for each entry if you have a favourite, or leave it and the 200 Club organiser will give you one.
        Numbers aren&apos;t held until you submit — if someone takes yours first, you&apos;ll be asked to choose another.
      </p>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-sm">
        <span className="font-medium text-gray-900">
          Picked {picks.length} of {entries}
          {anyCount > 0 ? ` — ${anyCount === 1 ? '1 will be any number' : `${anyCount} will be any number`}` : ''}
        </span>
        {picks.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-blue-700 underline">Clear picks</button>
        )}
      </div>
      {takenPicks.length > 0 && (
        <p className="mb-2 text-sm font-medium text-red-700">
          {takenPicks.length === 1 ? `Number ${takenPicks[0]} has` : `Numbers ${listNumbers(takenPicks)} have`} been taken — tap a free number to replace {takenPicks.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div className="grid grid-cols-8 sm:grid-cols-10 gap-1 max-h-72 overflow-y-auto rounded-md border border-gray-200 p-2 bg-white">
        {numbers.map((n) => {
          const picked = picks.indexOf(n) !== -1;
          const taken = info.takenByOthers.indexOf(n) !== -1;
          let classes = 'border-gray-300 bg-white text-gray-900 hover:border-blue-500';
          if (picked && taken) classes = 'border-red-500 bg-red-50 text-red-800';
          else if (picked) classes = 'border-blue-600 bg-blue-600 text-white';
          else if (taken) classes = 'border-gray-200 bg-gray-100 text-gray-700 line-through cursor-not-allowed';
          else if (full) classes = 'border-gray-200 bg-white text-gray-700 cursor-not-allowed';
          return (
            <button key={n} type="button"
              onClick={() => toggle(n)}
              disabled={(taken && !picked) || (full && !picked)}
              title={taken && !picked ? 'Taken' : undefined}
              className={`py-1.5 rounded border text-sm font-medium ${classes}`}>
              {n}
            </button>
          );
        })}
      </div>
      {full && entries > 0 && (
        <p className="mt-1 text-xs text-gray-700">You&apos;ve picked a number for every entry — tap one to unpick it.</p>
      )}
    </div>
  );
}
