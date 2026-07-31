// src/lib/competition-rules.ts
// The public rules page (/competitions/rules) renders one section per competition,
// anchored by its compId. This helper builds the deep-link URL to a competition's
// section — used to link straight to a competition's rules.

/** Return the /competitions/rules URL deep-linked to a competition's section. */
export function rulesUrlFor(compId: string): string {
  return compId ? `/competitions/rules#${compId}` : '/competitions/rules';
}
