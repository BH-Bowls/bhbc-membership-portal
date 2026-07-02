// src/lib/display-name-utils.ts
// Disambiguate member display names within a list (e.g. an availability poll roster).
// A club has repeated first names (two "Mike"s, two "Sue"s). Showing the preferred
// first name alone is ambiguous, so when two people in the same list share a first
// name we append the shortest surname prefix that tells them apart — "Mike S" vs
// "Mike B", or "Mike Smi" vs "Mike Smy" when the surnames also start the same.
// A single "Sue" is left as just "Sue".

export interface DisplayNamePerson {
  userName: string;   // unique key the result map is keyed by
  firstName: string;  // preferred first name (fullKnownAs)
  lastName: string;   // surname (may be empty)
}

/**
 * Build a userName → display-name map that is unambiguous within `people`.
 * - Unique first name → the first name alone.
 * - Shared first name → first name + the shortest surname prefix unique in that group.
 * - Identical first name AND surname → a numeric suffix as a last resort.
 */
export function disambiguateDisplayNames(people: DisplayNamePerson[]): Record<string, string> {
  const result: Record<string, string> = {};

  // Group people by first name (case-insensitive)
  const groups: Record<string, DisplayNamePerson[]> = {};
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const key = (p.firstName || p.userName || '').trim().toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  const groupKeys = Object.keys(groups);
  for (let g = 0; g < groupKeys.length; g++) {
    const group = groups[groupKeys[g]];

    // Only one person with this first name — the first name alone is enough
    if (group.length === 1) {
      const p = group[0];
      result[p.userName] = p.firstName || p.userName;
      continue;
    }

    // Longest surname in the group bounds how far a prefix can grow
    let maxLen = 0;
    for (let i = 0; i < group.length; i++) {
      if (group[i].lastName.length > maxLen) maxLen = group[i].lastName.length;
    }

    // For each person, grow the surname prefix until it is unique within the group
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      const last = p.lastName || '';
      let k = 1;
      while (k <= maxLen) {
        const sig = last.slice(0, k).toLowerCase();
        let collision = false;
        for (let j = 0; j < group.length; j++) {
          if (j === i) continue;
          if ((group[j].lastName || '').slice(0, k).toLowerCase() === sig) {
            collision = true;
            break;
          }
        }
        if (!collision) break;
        k = k + 1;
      }
      const prefix = last.slice(0, k);
      result[p.userName] = prefix ? `${p.firstName} ${prefix}` : (p.firstName || p.userName);
    }

    // Last resort: identical first name and surname (e.g. two "Mike Smith") — number them
    const seen: Record<string, number> = {};
    for (let i = 0; i < group.length; i++) {
      const p = group[i];
      const base = result[p.userName];
      if (seen[base] === undefined) {
        seen[base] = 1;
      } else {
        seen[base] = seen[base] + 1;
        result[p.userName] = `${base} (${seen[base]})`;
      }
    }
  }

  return result;
}
