// src/components/SeasonPlanningTabs.tsx
// Small shared tab bar between the Season Planning stage pages
// (Events / Friendlies / Leagues) — kept as a real shared component, not
// duplicated per-page, so the tabs themselves never visually drift between
// stages the way page-local helpers are allowed to.

'use client';

import Link from 'next/link';
import { SeasonPlanningCalendar } from './SeasonPlanningCalendar';

interface SeasonPlanningTabsProps {
  active: 'events' | 'friendlies' | 'leagues';
}

const TABS = [
  { key: 'events', label: 'Events', href: '/fixtures/season-planning' },
  { key: 'friendlies', label: 'Friendlies', href: '/fixtures/season-planning/friendlies' },
  { key: 'leagues', label: 'Leagues', href: '/fixtures/season-planning/leagues' },
] as const;

export function SeasonPlanningTabs({ active }: SeasonPlanningTabsProps) {
  return (
    <div className="flex items-center justify-between mb-6 border-b border-gray-200">
      <div className="flex gap-1">
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                isActive
                  ? 'border-green-600 text-green-700 bg-green-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      <div className="pb-2 flex items-center gap-2">
        <Link
          href="/fixtures/season-planning/reservations"
          className="px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Reservations
        </Link>
        <SeasonPlanningCalendar />
      </div>
    </div>
  );
}
