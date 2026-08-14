// src/components/SeasonPlanningTabs.tsx
// Small shared tab bar between the Season Planning stage pages
// (Events / Friendlies / Leagues) — kept as a real shared component, not
// duplicated per-page, so the tabs themselves never visually drift between
// stages the way page-local helpers are allowed to.

'use client';

import Link from 'next/link';

interface SeasonPlanningTabsProps {
  active: 'events' | 'friendlies' | 'leagues';
}

const TABS = [
  { key: 'events', label: 'Events', href: '/fixtures/season-planning' },
  { key: 'friendlies', label: 'Friendlies', href: '/fixtures/season-planning/friendlies' },
  { key: 'leagues', label: 'Leagues', href: null },
] as const;

export function SeasonPlanningTabs({ active }: SeasonPlanningTabsProps) {
  return (
    <div className="flex gap-1 mb-6 border-b border-gray-200">
      {TABS.map((tab) => {
        if (!tab.href) {
          return (
            <span key={tab.key} className="px-3 py-2 text-sm font-medium text-gray-400 cursor-not-allowed">
              {tab.label} (not built)
            </span>
          );
        }
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
  );
}
