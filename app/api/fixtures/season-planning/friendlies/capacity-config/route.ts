// app/api/fixtures/season-planning/friendlies/capacity-config/route.ts
// GET: the config values the same-day capacity warnings need — the 3
// existing rink/player thresholds, plus the default DD-MM window (no year)
// evergreen Reservations fall back to when they don't have their own
// explicit dates. A scoped Captain/Admin endpoint rather than reusing
// /api/admin/config (Admin-only, and returns every config key app-wide) —
// Season Planning is accessible to Captains too, and only needs these
// values, not the whole config table.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getConfig } from '@/lib/config-supabase';

// Fallback defaults if the config rows are somehow missing (e.g. migrations
// 0042/0043 not yet applied) — matches the migrations' own seed values, so
// capacity warnings degrade to sensible behaviour rather than breaking.
const DEFAULTS = {
  greenTotalRinks: 6,
  capacityWarningThreshold: 5,
  maxPlayersPerDay: 20,
  reservationDefaultStart: '15-04',
  reservationDefaultEnd: '30-09',
};

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const config = await getConfig();
    const greenTotalRinks = parseInt(config.season_planning_green_total_rinks, 10) || DEFAULTS.greenTotalRinks;
    const capacityWarningThreshold = parseInt(config.season_planning_capacity_warning_threshold, 10) || DEFAULTS.capacityWarningThreshold;
    const maxPlayersPerDay = parseInt(config.season_planning_max_players_per_day, 10) || DEFAULTS.maxPlayersPerDay;
    const reservationDefaultStart = config.season_planning_reservation_default_start || DEFAULTS.reservationDefaultStart;
    const reservationDefaultEnd = config.season_planning_reservation_default_end || DEFAULTS.reservationDefaultEnd;

    return NextResponse.json({
      greenTotalRinks, capacityWarningThreshold, maxPlayersPerDay,
      reservationDefaultStart, reservationDefaultEnd,
    });
  } catch (error) {
    console.error('Error fetching capacity config:', error);
    return NextResponse.json(DEFAULTS);
  }
}
