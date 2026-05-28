// src/lib/ics-utils.ts
// Builds iCalendar (.ics) event strings for friendly game emails.
// UIDs are stable per player+game so calendar clients update rather than duplicate events.

export type ICSMethod = 'PUBLISH' | 'REQUEST' | 'CANCEL';
export type ICSStatus = 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';
export type ICSTrigger = 'entered' | 'published' | 'confirmed' | 'withdrawn' | 'cancelled';

export interface FriendlyICSParams {
  tabName: string;        // game.tabName — used in UID (e.g. "West Hoathly 25-Sep")
  userName: string;       // player's username — scopes UID per player
  sequence: number;       // SEQUENCE: 0=entered, 1=published, 2=republished, 99=confirmed/withdrawn
  method: ICSMethod;
  status: ICSStatus;
  dateStr: string;        // "DD/MM/YYYY" (UK format from sheet) or "YYYY-MM-DD"
  timeStr: string;        // Any UK time string: "14:00", "2:00 PM", "14:00:00", etc.
  clubName: string;
  homeAway: 'H' | 'A';
  format: string;
  trigger: ICSTrigger;
  organizerEmail?: string;  // Required for METHOD:REQUEST/CANCEL (RFC 5546 §3.2.1)
  attendeeEmail?: string;   // Player's email — added as ATTENDEE;RSVP=FALSE when present
}

// Returns true for @gmail.com / @googlemail.com addresses.
// Used to skip non-entry ICS attachments for Gmail users (Google Calendar handles .ics differently).
export function isGmailAddress(email: string): boolean {
  const lower = email.toLowerCase();
  return lower.endsWith('@gmail.com') || lower.endsWith('@googlemail.com');
}

// Returns true when ICS attachments on publish/confirm/withdraw/cancel emails are enabled.
// Set ICS_UPDATE_EMAILS=true in environment to turn on the full flow.
// The initial entry email always sends ICS regardless of this flag.
export function icsUpdatesEnabled(): boolean {
  return process.env.ICS_UPDATE_EMAILS === 'true';
}

export interface ICSAttachment {
  filename: string;
  content: string;
  contentType: string;
}

// Parse "DD/MM/YYYY" or "YYYY-MM-DD" into { year, month, day }.
function parseDate(dateStr: string): { year: number; month: number; day: number } | null {
  const uk = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) return { day: +uk[1], month: +uk[2], year: +uk[3] };
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };
  return null;
}

// Parse any common UK time string into { hour, minute }.
// Handles: "14:00", "14:00:00", "2:00 PM", "2:00PM", "2 PM", "2PM".
function parseTime(timeStr: string): { hour: number; minute: number } | null {
  const h24 = timeStr.match(/^(\d{1,2}):(\d{2})/);
  if (h24) return { hour: +h24[1], minute: +h24[2] };

  const h12min = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (h12min) {
    let hour = +h12min[1];
    const minute = +h12min[2];
    const pm = h12min[3].toUpperCase() === 'PM';
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    return { hour, minute };
  }

  const h12 = timeStr.match(/^(\d{1,2})\s*(AM|PM)/i);
  if (h12) {
    let hour = +h12[1];
    const pm = h12[2].toUpperCase() === 'PM';
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    return { hour, minute: 0 };
  }

  return null;
}

// Convert a Europe/London local time to UTC.
// UK is always UTC+0 (GMT) or UTC+1 (BST) — try both offsets and validate via Intl.
function londonDateToUTC(dateStr: string, timeStr: string): Date {
  const dateParts = parseDate(dateStr);
  const timeParts = parseTime(timeStr);

  if (!dateParts || !timeParts) {
    console.warn(`[ics-utils] Could not parse date/time: "${dateStr}" / "${timeStr}"`);
    return new Date(NaN);
  }

  const { year, month, day } = dateParts;
  const { hour, minute } = timeParts;

  for (const offsetHours of [0, 1]) {
    const candidateMs = Date.UTC(year, month - 1, day, hour, minute) - offsetHours * 3600000;
    const candidate = new Date(candidateMs);
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(candidate);
    const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '-1');
    const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '-1');
    if (h === hour && m === minute) return candidate;
  }

  return new Date(Date.UTC(year, month - 1, day, hour, minute));
}

function formatICSDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

const TRIGGER_SUMMARY_PREFIX: Record<ICSTrigger, string> = {
  entered: 'Entered',
  published: 'Selected',
  confirmed: 'Confirmed',
  withdrawn: 'Withdrawn',
  cancelled: 'Cancelled',
};

export function buildFriendlyICS(params: FriendlyICSParams): string {
  const {
    tabName, userName, sequence, method, status,
    dateStr, timeStr, clubName, homeAway, format, trigger,
    organizerEmail, attendeeEmail,
  } = params;

  const safeTab = tabName.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '');
  const uid = `BHBC-FRIENDLY-${safeTab}-${userName}@bhbc.org.uk`;

  const dtStart = londonDateToUTC(dateStr, timeStr);
  if (isNaN(dtStart.getTime())) {
    throw new Error(`[ics-utils] Invalid game date/time: "${dateStr}" / "${timeStr}"`);
  }
  const dtEnd = new Date(dtStart.getTime() + 3 * 60 * 60 * 1000);
  const dtstamp = formatICSDate(new Date());

  const summary = `${TRIGGER_SUMMARY_PREFIX[trigger]}: Friendly vs ${clubName}`;
  const location =
    homeAway === 'H'
      ? 'Burgess Hill Bowls Club, Leylands Road, Burgess Hill'
      : clubName;

  const venueLabel = homeAway === 'H' ? 'Home' : `Away at ${clubName}`;
  const description =
    `${venueLabel}\\nDate: ${dateStr}\\nTime: ${timeStr}\\nFormat: ${format}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BHBC Membership Portal//EN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${formatICSDate(dtStart)}`,
    `DTEND:${formatICSDate(dtEnd)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    `STATUS:${status}`,
    // ORGANIZER is required for METHOD:REQUEST/CANCEL (RFC 5546 §3.2.1)
    ...(organizerEmail ? [`ORGANIZER:mailto:${organizerEmail}`] : []),
    ...(attendeeEmail ? [`ATTENDEE;RSVP=FALSE:mailto:${attendeeEmail}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.join('\r\n');
}

export function buildFriendlyICSAttachment(params: FriendlyICSParams): ICSAttachment {
  const content = buildFriendlyICS(params);
  const safeTab = params.tabName.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_.-]/g, '');
  return {
    filename: `BHBC-${safeTab}.ics`,
    content,
    contentType:
      params.method === 'CANCEL'
        ? 'text/calendar; method=CANCEL'
        : params.method === 'PUBLISH'
        ? 'text/calendar; method=PUBLISH'
        : 'text/calendar; method=REQUEST',
  };
}

// Build a single combined ICS attachment for a linked game pair.
// Uses the earlier game time; UID is stable per player+date so the entry
// can be updated later if needed.
export function buildLinkedFriendlyICSAttachment(params: {
  userName: string;
  dateStr: string;
  timeStr: string;        // earlier of the two game times
  gameAClubName: string;
  gameAHomeAway: 'H' | 'A';
  gameBClubName: string;
  gameBHomeAway: 'H' | 'A';
}): ICSAttachment {
  const { userName, dateStr, timeStr, gameAClubName, gameAHomeAway, gameBClubName, gameBHomeAway } = params;

  const dtStart = londonDateToUTC(dateStr, timeStr);
  if (isNaN(dtStart.getTime())) {
    throw new Error(`[ics-utils] Invalid linked game date/time: "${dateStr}" / "${timeStr}"`);
  }
  const dtEnd = new Date(dtStart.getTime() + 3 * 60 * 60 * 1000);
  const dtstamp = formatICSDate(new Date());

  const safeDate = dateStr.replace(/\//g, '-').replace(/\s+/g, '_');
  const uid = `BHBC-FRIENDLY-LINKED-${safeDate}-${userName}@bhbc.org.uk`;

  const labelA = gameAHomeAway === 'H' ? `Home vs ${gameAClubName}` : `Away at ${gameAClubName}`;
  const labelB = gameBHomeAway === 'H' ? `Home vs ${gameBClubName}` : `Away at ${gameBClubName}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BHBC Membership Portal//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'SEQUENCE:0',
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${formatICSDate(dtStart)}`,
    `DTEND:${formatICSDate(dtEnd)}`,
    `SUMMARY:Entered: Linked Friendly ${dateStr}`,
    `DESCRIPTION:Linked games — you will be allocated to one by the captain.\\n${labelA}\\n${labelB}`,
    'LOCATION:Burgess Hill Bowls Club, Leylands Road, Burgess Hill',
    'STATUS:TENTATIVE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return {
    filename: `BHBC-Linked-${safeDate}.ics`,
    content: lines.join('\r\n'),
    contentType: 'text/calendar; method=PUBLISH',
  };
}
