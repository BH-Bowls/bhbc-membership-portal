// src/lib/home-cache.ts
// Server-side in-memory cache for diary and announcement data.
// Diary cache: per-user, 48-hour TTL, invalidated on member writes.
// Announcement cache: shared, 30-minute TTL, invalidated on admin save.

import type { DiaryItem } from '@/types/diary';
import type { Announcement } from '@/types/diary';

// ─── Diary Cache ──────────────────────────────────────────────────────────────

// One entry per user: the diary items and when they were cached
type DiaryCacheEntry = {
  data: DiaryItem[];
  cachedAt: number;  // Date.now() timestamp
};

// 48 hours in milliseconds
const DIARY_CACHE_TTL_MS = 48 * 60 * 60 * 1000;

// Map from userName to cached diary entry
const diaryCache: Map<string, DiaryCacheEntry> = new Map();

// Returns cached diary items if present and not expired, otherwise null
export function getDiaryCache(userName: string): DiaryItem[] | null {
  // Check if there is a cache entry for this user
  const entry = diaryCache.get(userName);

  // Return null if no entry exists
  if (!entry) {
    return null;
  }

  // Check if the cache entry has expired
  const ageMs = Date.now() - entry.cachedAt;
  if (ageMs > DIARY_CACHE_TTL_MS) {
    // Remove the stale entry and return null
    diaryCache.delete(userName);
    return null;
  }

  return entry.data;
}

// Stores diary items in cache with the current timestamp
export function setDiaryCache(userName: string, items: DiaryItem[]): void {
  diaryCache.set(userName, {
    data: items,
    cachedAt: Date.now(),
  });
}

// Removes the cache entry for a single user (call after writes that affect their diary)
export function clearDiaryCache(userName: string): void {
  diaryCache.delete(userName);
}

// Removes ALL per-user diary cache entries (call when a change affects every user's diary)
export function clearAllDiaryCaches(): void {
  diaryCache.clear();
}

// ─── Announcement Cache ───────────────────────────────────────────────────────

// Single shared entry — announcements are the same for all users
type AnnouncementCacheEntry = {
  data: Announcement[];  // active announcements only
  cachedAt: number;
};

// 30 minutes in milliseconds
const ANNOUNCEMENT_CACHE_TTL_MS = 30 * 60 * 1000;

// Shared cache object — not a Map because there is only one global entry
const announcementCache: { entry: AnnouncementCacheEntry | null } = { entry: null };

// Returns cached active announcements if present and not expired, otherwise null
export function getAnnouncementCache(): Announcement[] | null {
  // Check if a cache entry exists
  if (!announcementCache.entry) {
    return null;
  }

  // Check if the cache entry has expired
  const ageMs = Date.now() - announcementCache.entry.cachedAt;
  if (ageMs > ANNOUNCEMENT_CACHE_TTL_MS) {
    // Clear the stale entry and return null
    announcementCache.entry = null;
    return null;
  }

  return announcementCache.entry.data;
}

// Stores active announcements in cache with the current timestamp
export function setAnnouncementCache(announcements: Announcement[]): void {
  announcementCache.entry = {
    data: announcements,
    cachedAt: Date.now(),
  };
}

// Clears the shared announcement cache (call after any create/update/delete)
export function clearAnnouncementCache(): void {
  announcementCache.entry = null;
}

// ─── Shared Raw Sheet Data Cache ──────────────────────────────────────────────
// Caches raw Google Sheets row arrays shared across all users.
// 24-hour TTL — no write invalidation — diary data may be up to 24 hours old.
// Used for: Games, Players, CleaningRota, SweepingRota, competition match sheets.

type SheetDataCacheEntry = {
  data: string[][];
  cachedAt: number;
};

// 24 hours in milliseconds
const SHEET_DATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Cache map: arbitrary string key → raw sheet rows
const sheetDataCache = new Map<string, SheetDataCacheEntry>();

// Returns cached sheet rows if present and not expired, otherwise null
export function getSheetDataCache(key: string): string[][] | null {
  const entry = sheetDataCache.get(key);
  if (!entry) {
    return null;
  }
  // Evict and return null if the entry has expired
  const ageMs = Date.now() - entry.cachedAt;
  if (ageMs > SHEET_DATA_CACHE_TTL_MS) {
    sheetDataCache.delete(key);
    return null;
  }
  return entry.data;
}

// Stores sheet rows in the cache with the current timestamp
export function setSheetDataCache(key: string, data: string[][]): void {
  sheetDataCache.set(key, {
    data,
    cachedAt: Date.now(),
  });
}

// Removes all sheet data cache entries whose key starts with the given prefix
export function clearSheetDataCacheByPrefix(prefix: string): void {
  for (const key of sheetDataCache.keys()) {
    if (key.startsWith(prefix)) {
      sheetDataCache.delete(key);
    }
  }
}
