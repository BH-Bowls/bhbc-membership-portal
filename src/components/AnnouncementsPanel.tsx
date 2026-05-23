// src/components/AnnouncementsPanel.tsx
// Home page panel that displays active club announcements.
// Fetches from GET /api/announcements. Uses sessionStorage for instant back-navigation.
// Renders nothing if there are no active announcements.

'use client';

import { useEffect, useState } from 'react';
import type { Announcement } from '@/types/diary';

// sessionStorage key for announcement cache
const CACHE_KEY = 'HomeAnnouncementsCache';

// Main component — shows amber announcement panel when active announcements exist
export function AnnouncementsPanel() {
  // Announcements state — null while loading, empty array if none
  const [announcements, setAnnouncements] = useState<Announcement[] | null>(null);

  // Load cached announcements from sessionStorage, then re-fetch in background
  useEffect(() => {
    // Show cached announcements instantly if available (avoids blank screen on back-nav)
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setAnnouncements(parsed);
      } catch {
        // Ignore corrupt cache — will be replaced by fresh fetch
      }
    }

    // Always re-fetch in background to get fresh data
    fetchAnnouncements({ silent: !!cached });
  }, []);

  // Fetch active announcements from the API
  const fetchAnnouncements = async ({ silent = false }: { silent?: boolean }) => {
    // Only set loading state when there is no cached data to show
    if (!silent) {
      setAnnouncements([]);
    }
    try {
      // Fetch from the member-facing announcements endpoint
      const res = await fetch('/api/announcements');
      if (!res.ok) {
        // On error, silently leave current state unchanged
        return;
      }
      const json = await res.json();
      const items: Announcement[] = json.announcements || [];

      // Update state with fresh data
      setAnnouncements(items);

      // Store in sessionStorage for instant display on back-navigation
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(items));
    } catch {
      // Network or parse error — leave existing state unchanged
    }
  };

  // Do not render anything while loading (null) or when there are no active announcements
  if (announcements === null || announcements.length === 0) {
    return null;
  }

  return (
    // Amber panel to signal importance — visually distinct from diary and regular content
    <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg overflow-hidden text-gray-900">
      {/* Panel header */}
      <div className="px-4 py-3 bg-amber-100 border-b border-amber-300">
        <h2 className="text-sm font-semibold text-amber-900">Club Announcements</h2>
      </div>

      {/* Announcement list */}
      <ul className="divide-y divide-amber-200">
        {announcements.map((announcement) => (
          <li key={announcement.id} className="px-4 py-3">
            {/* Message text */}
            <p className="text-sm text-gray-900">{announcement.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
