// src/lib/membership-card.ts
// Shared "valid until" wording for the membership card — used by My Account's
// on-screen card (app/account/page.tsx) and the printed card labels (app/labels).

export interface MembershipCardValidity {
  honorary: boolean;
  latestRenewedSeasonYear: number | null;
}

export function validUntilLabel(card: MembershipCardValidity): { text: string; renewalDue: boolean } {
  if (card.honorary) {
    return { text: 'Honorary Member — no expiry', renewalDue: false };
  }
  if (card.latestRenewedSeasonYear === null) {
    return { text: 'Not yet renewed', renewalDue: true };
  }
  // Interim rule — renewals has no stored expiry date yet (see
  // src/lib/renewals-supabase.ts's getLatestRenewedSeason). Membership runs through
  // to the end of February the year after the season it was renewed for.
  const validUntilDate = new Date(card.latestRenewedSeasonYear + 1, 2, 0);
  const formatted = validUntilDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return { text: 'Valid until ' + formatted, renewalDue: false };
}
