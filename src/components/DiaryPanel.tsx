// src/components/DiaryPanel.tsx
// Home page diary panel showing the member's upcoming duties and games.
// Fetches from GET /api/diary. Uses sessionStorage for instant back-navigation.
// Shows a skeleton row while loading, an empty state when no items, and a
// chronological list when items are available.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { DiaryItem, DiaryItemType } from '@/types/diary';

// sessionStorage key for diary cache
const CACHE_KEY = 'HomeDiaryCache';

// Map diary item type to a display emoji
function getIcon(type: DiaryItemType): string {
  // Return the appropriate emoji for each diary item type
  if (type === 'cleaning') return '🧹';
  if (type === 'sweeping') return '🌿';
  if (type === 'tea') return '🫖';
  if (type === 'friendly') return '🟢';
  if (type === 'competition') return '🏆';
  if (type === 'marker') return '📋';
  if (type === 'availability_nudge') return '❓';
  if (type === 'availability_confirmed') return '✅';
  if (type === 'friendly-needs-players') return '🟠';
  if (type === 'applications_pending') return '📥';
  return '•';
}

// Returns a highlight class for item types that need special visual treatment, or '' for none
function highlightClass(type: DiaryItemType): string {
  if (type === 'availability_nudge') return 'bg-blue-50 border border-blue-200 -mx-1 px-2';
  if (type === 'friendly-needs-players') return 'bg-orange-50 border border-orange-300 -mx-1 px-2';
  if (type === 'applications_pending') return 'bg-amber-50 border border-amber-300 -mx-1 px-2';
  return '';
}

// Skeleton placeholder row shown while diary data is loading
function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 py-3 animate-pulse">
      {/* Date placeholder */}
      <div className="h-4 bg-gray-200 rounded w-24 flex-shrink-0 mt-0.5"></div>
      {/* Icon placeholder */}
      <div className="h-4 bg-gray-200 rounded w-6 flex-shrink-0 mt-0.5"></div>
      {/* Text placeholder */}
      <div className="flex-1 space-y-1.5">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        <div className="h-3 bg-gray-200 rounded w-1/2"></div>
      </div>
    </div>
  );
}

// A single diary item row — wraps in a Link if there is a destination URL
function DiaryRow({ item }: { item: DiaryItem }) {
  // Build the inner content shared between the linked and non-linked variants
  const inner = (
    <div className={`flex items-start gap-3 py-3 rounded-md px-1 text-gray-900 ${highlightClass(item.type)}`}>
      {/* Fixed-width date column */}
      <span className="text-sm text-gray-700 w-24 flex-shrink-0">{item.displayDate}</span>
      {/* Type icon */}
      <span className="flex-shrink-0 text-base leading-snug">{getIcon(item.type)}</span>
      {/* Label and subLabel */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
        {/* Secondary info — subLabel must be readable so use text-gray-700 minimum */}
        {item.subLabel ? (
          <p className="text-xs text-gray-700 mt-0.5">{item.subLabel}</p>
        ) : null}
      </div>
      {/* Chevron indicator for linked rows */}
      {item.linkUrl ? (
        <span className="flex-shrink-0 text-gray-700 text-sm">›</span>
      ) : null}
    </div>
  );

  // Wrap with Link if a URL is provided; otherwise render as plain div
  if (item.linkUrl) {
    return (
      <Link href={item.linkUrl} className="block hover:bg-gray-50 rounded-md transition-colors">
        {inner}
      </Link>
    );
  }

  return <div>{inner}</div>;
}

// Main diary panel component
export function DiaryPanel() {
  // Diary items state — null while loading for the first time
  const [items, setItems] = useState<DiaryItem[] | null>(null);

  // Load cached diary from sessionStorage, then re-fetch in background
  useEffect(() => {
    // Show cached data instantly if available (avoids spinner on back-navigation)
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setItems(parsed);
      } catch {
        // Ignore corrupt cache — fresh fetch will replace it
      }
    }

    // Always re-fetch in background to get up-to-date diary
    fetchDiary({ silent: !!cached });
  }, []);

  // Fetch diary items from the API
  const fetchDiary = async ({ silent = false }: { silent?: boolean }) => {
    // Only show loading skeleton when nothing is cached yet
    if (!silent) {
      setItems(null);
    }
    try {
      // Call the diary endpoint for the current user's personalised items
      const res = await fetch('/api/diary');
      if (!res.ok) {
        // On error, quietly leave the current state as-is
        if (!silent) {
          setItems([]);
        }
        return;
      }
      const json = await res.json();
      const diaryItems: DiaryItem[] = json.items || [];

      // Update state with fresh items
      setItems(diaryItems);

      // Persist to sessionStorage for instant display on back-navigation
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(diaryItems));
    } catch {
      // Network or parse error — show empty state rather than staying on skeleton
      if (!silent) {
        setItems([]);
      }
    }
  };

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg text-gray-900">
      <div className="px-4 py-5 sm:p-6">
        {/* Panel heading */}
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Coming Up</h2>
        <p className="text-xs text-gray-700 mb-3">Your upcoming duties and games</p>

        {/* Loading state — show skeleton row while first fetch is in progress */}
        {items === null ? (
          <div className="divide-y divide-gray-100">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : items.length === 0 ? (
          // Empty state — friendly message when there is nothing in the diary
          <p className="text-sm text-gray-700 py-2">Nothing coming up — enjoy the break!</p>
        ) : (
          // Diary list — chronological, one row per item
          <div className="divide-y divide-gray-100">
            {items.map((item, index) => (
              // Use index as part of key since items may share date+type combinations
              <DiaryRow key={`${item.type}-${item.date}-${index}`} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
