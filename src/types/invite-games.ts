// src/types/invite-games.ts
// Type definitions for the Invite Games system

export interface InviteGame {
  // Identification
  inviteGameId: string; // IG-YYYY-NNN format

  // Game details
  title: string;
  description: string;
  closingDate: string | null;
  gameDate: string | null;

  // Metadata
  createdByUsername: string;
  createdByFullName: string; // Computed from Members sheet (not stored)
  createdAt: string;
  updatedAt: string | null;
  updatedByUsername: string | null;

  // Internal
  _rowNumber?: number;
}
