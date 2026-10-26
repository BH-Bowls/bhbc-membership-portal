// src/lib/competition-eligibility.ts
// Club competitions entry rule on the renewal form: a playing member may enter if they
// made themselves available for at least N friendlies in the previous season.
//
//   - N is config min_friendlies_for_competitions (Admin config → General).
//   - The count comes live from the friendlies data (getFriendliesAvailableCount) — not
//     from a stored number on the member.
//   - An Admin can override it per member (member_profiles.competitions_eligible_override,
//     set on the admin member page): true = eligible, false = not eligible, null = use
//     the friendlies count.

import { getConfig } from './config-supabase';
import { getFriendliesAvailableCount } from './fixture-groups-supabase';
import { getCurrentSeasonYear } from './renewals-supabase';

const DEFAULT_MIN_FRIENDLIES = 6;

export interface CompetitionEligibility {
  canEnterCompetitions: boolean;
  friendliesRequired: number;
  friendliesLastSeason: number | null; // null when last season isn't in the friendlies data
  previousSeasonYear: number;
  override: boolean | null;
}

export async function getMinFriendliesForCompetitions(): Promise<number> {
  const config = await getConfig();
  const value = parseInt(config.min_friendlies_for_competitions || '', 10);
  if (isNaN(value) || value < 0) {
    return DEFAULT_MIN_FRIENDLIES;
  }
  return value;
}

export async function getCompetitionEligibility(
  userName: string,
  override: boolean | null
): Promise<CompetitionEligibility> {
  const previousSeasonYear = getCurrentSeasonYear() - 1;
  const [friendliesRequired, friendliesLastSeason] = await Promise.all([
    getMinFriendliesForCompetitions(),
    getFriendliesAvailableCount(userName, previousSeasonYear),
  ]);

  let canEnterCompetitions = false;
  if (override === true) {
    canEnterCompetitions = true;
  } else if (override === false) {
    canEnterCompetitions = false;
  } else if (friendliesLastSeason !== null) {
    canEnterCompetitions = friendliesLastSeason >= friendliesRequired;
  }

  return {
    canEnterCompetitions,
    friendliesRequired,
    friendliesLastSeason,
    previousSeasonYear,
    override,
  };
}
