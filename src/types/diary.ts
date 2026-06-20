// src/types/diary.ts
// TypeScript types for the Diary Panel and Announcements feature

// The kind of item that can appear in the member's personal diary
export type DiaryItemType =
  | 'cleaning'
  | 'sweeping'
  | 'tea'
  | 'friendly'
  | 'friendly-needs-players'
  | 'competition'
  | 'marker'
  | 'availability_nudge'
  | 'availability_confirmed'
  | 'applications_pending';

// A single item in the diary panel
export type DiaryItem = {
  type: DiaryItemType;
  date: string;           // ISO date string YYYY-MM-DD — used for sorting
  displayDate: string;    // Human-readable e.g. "Sat 24 May"
  label: string;          // Primary description e.g. "vs Newick (Away)"
  subLabel: string;       // Secondary info e.g. "Tea Lead" / "R1" / event title
  linkUrl: string;        // Where to navigate on click — empty string if no link
};

// API response shape for GET /api/diary
export type DiaryResponse = {
  items: DiaryItem[];
};

// A single home page announcement
export type Announcement = {
  id: string;
  message: string;
  expiresAt: string;      // ISO datetime string
  createdBy: string;      // username
  createdAt: string;      // ISO datetime string
  updatedBy: string;      // username or empty string
  updatedAt: string;      // ISO datetime string or empty string
  isExpired: boolean;     // computed — true if expiresAt < now
};

// API response for GET /api/announcements (member view — active only)
export type AnnouncementsResponse = {
  announcements: Announcement[];
};

// API response for GET /api/admin/announcements (admin view — all including expired)
export type AdminAnnouncementsResponse = {
  announcements: Announcement[];
};
