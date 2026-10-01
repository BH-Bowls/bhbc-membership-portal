// src/types/lockers.ts
// Locker Register types — shared by the data layer, API routes, the register page
// (/admin/lockers) and Print Labels.

export type LockerRoom = 'Mens' | 'Ladies';
export type LockerStatus = 'member' | 'club' | 'occupied' | 'empty';

export const LOCKER_ROOMS: LockerRoom[] = ['Mens', 'Ladies'];

export const LOCKER_STATUS_LABELS: Record<LockerStatus, string> = {
  member: 'Member',
  club: 'Club Locker',
  occupied: 'Occupied',
  empty: 'Empty',
};

export interface Locker {
  id: string;
  room: LockerRoom;
  lockerNumber: number;
  keyNumber: string | null;
  keysCount: number | null; // null = unknown
  status: LockerStatus;
  userName: string | null;
  notes: string | null;
}

/** The editable fields of a locker. */
export type LockerInput = Omit<Locker, 'id'>;

/** Locker as returned by the API — with the allocated member's display name. */
export interface LockerWithMember extends Locker {
  memberName: string | null;
  memberActive: boolean;
}

/** Short reference used wherever a member's locker is shown, e.g. "Mens 36". */
export function lockerRef(locker: { room: string; lockerNumber: number }): string {
  return `${locker.room} ${locker.lockerNumber}`;
}
