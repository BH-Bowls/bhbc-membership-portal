// src/lib/email/squads.ts
// Emails for squads (external leagues; Club Teams later): the team for a fixture is
// published, a picked player drops out, a squad leaver's tea slots were cleared.
// Sends are sequential (one SMTP connection — see CLAUDE.md on Gmail).

import { sendEmail } from './mailer';
import { getAllUsers } from '../members-supabase';
import { getSquadForFixture, getSquadManagers } from '../squads-supabase';
import type { Fixture } from '../fixtures-supabase';

export interface SquadEmailFixture {
  id: string;
  tabName: string;        // for links to the friendlies game pages
  squadLabel: string;     // "MSL 2026"
  fixtureType: string;    // "N/S A"
  date: string;           // DD/MM/YYYY
  time: string;           // HH:MM
  opponent: string;
  homeAway: 'H' | 'A';
  format: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function friendlyDate(uk: string): string {
  const [d, m, y] = uk.split('/').map(n => parseInt(n, 10));
  if (!d || !m || !y) return uk;
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fixtureLine(f: SquadEmailFixture): string {
  const venue = f.homeAway === 'H' ? 'at home' : `away at ${f.opponent}`;
  return `${f.fixtureType} v ${f.opponent} — ${friendlyDate(f.date)}${f.time ? ` at ${f.time}` : ''}, ${venue}`;
}

/** Turn plain-text paragraphs into a minimal HTML body. */
function toHtml(paragraphs: string[]): string {
  return paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
}

async function emailByUsername(): Promise<Map<string, { email: string; name: string }>> {
  const users = await getAllUsers();
  const map = new Map<string, { email: string; name: string }>();
  for (const u of users) {
    if (!u.userName) continue;
    map.set(u.userName.toLowerCase(), {
      email: u.emailAddress || '',
      name: u.fullKnownAs || u.fullName || u.userName,
    });
  }
  return map;
}

export interface PublishedPlayer {
  username: string;
  fullName: string;
  team: number | null;
  position: string;
}

function positionLabel(p: string): string {
  if (p === 'S') return 'Skip';
  if (p === '1') return 'Lead';
  if (p === '2') return 'Two';
  if (p === '3') return 'Three';
  return '';
}

/**
 * Team published: each picked player gets their team and the full team sheet; the tea
 * people (home fixtures) get a teas note — its own email if they aren't playing.
 */
export async function sendSquadTeamPublishedEmails(
  fixture: SquadEmailFixture,
  players: PublishedPlayer[],
  teaUsernames: string[],
  appUrl: string,
  message?: string
): Promise<{ emailsSent: number; withoutEmail: string[] }> {
  const contacts = await emailByUsername();
  const link = `${appUrl}/friendlies/game/${encodeURIComponent(fixture.tabName)}`;

  // Team sheet, grouped by team number
  const teams = new Map<string, PublishedPlayer[]>();
  for (const p of players) {
    const key = p.team === null ? 'Unassigned' : `Team ${p.team}`;
    const list = teams.get(key) || [];
    list.push(p);
    teams.set(key, list);
  }
  const sheetLines: string[] = [];
  for (const [team, list] of teams) {
    sheetLines.push(`${team}: ${list.map(p => `${p.fullName}${positionLabel(p.position) ? ` (${positionLabel(p.position)})` : ''}`).join(', ')}`);
  }
  const teaNames = teaUsernames.map(u => {
    const c = contacts.get(u.toLowerCase());
    return c ? c.name : u;
  });

  let emailsSent = 0;
  const withoutEmail: string[] = [];
  const playing = new Set(players.map(p => p.username.toLowerCase()));

  for (const p of players) {
    const c = contacts.get(p.username.toLowerCase());
    if (!c || !c.email) { withoutEmail.push(p.fullName); continue; }
    const onTeas = teaUsernames.some(t => t.toLowerCase() === p.username.toLowerCase());
    const paragraphs = [
      `Hi ${c.name},`,
      `You've been picked for ${fixtureLine(fixture)}.`,
      ...(message ? [message] : []),
      ...(onTeas ? ['You are also on teas: please arrive early to set up, and help with the light snack after the game.'] : []),
      `Teams:\n${sheetLines.join('\n')}`,
      ...(teaNames.length > 0 ? [`Teas: ${teaNames.join(' and ')}`] : []),
      `If you can't make it, please let us know as soon as possible: ${link}`,
      'Burgess Hill Bowls Club',
    ];
    const result = await sendEmail(c.email, `${fixture.squadLabel}: you're playing v ${fixture.opponent} (${fixture.date})`, paragraphs.join('\n\n'), toHtml(paragraphs));
    if (result.success) emailsSent++;
  }

  // Tea people who aren't playing get their own note
  for (const t of teaUsernames) {
    if (playing.has(t.toLowerCase())) continue;
    const c = contacts.get(t.toLowerCase());
    if (!c || !c.email) { withoutEmail.push(t); continue; }
    const paragraphs = [
      `Hi ${c.name},`,
      `You're on teas for ${fixtureLine(fixture)}.`,
      'Please arrive early to set up, and help with the light snack after the game.',
      ...(message ? [message] : []),
      `Details: ${link}`,
      'Burgess Hill Bowls Club',
    ];
    const result = await sendEmail(c.email, `${fixture.squadLabel}: you're on teas v ${fixture.opponent} (${fixture.date})`, paragraphs.join('\n\n'), toHtml(paragraphs));
    if (result.success) emailsSent++;
  }

  return { emailsSent, withoutEmail };
}

/** A picked player can't make a published fixture — tell the squad's managers. */
export async function sendSquadDropOutEmail(
  fixture: SquadEmailFixture,
  playerUsername: string,
  managerUsernames: string[],
  appUrl: string
): Promise<void> {
  const contacts = await emailByUsername();
  const player = contacts.get(playerUsername.toLowerCase());
  const playerName = player ? player.name : playerUsername;
  for (const m of managerUsernames) {
    const c = contacts.get(m.toLowerCase());
    if (!c || !c.email) continue;
    const paragraphs = [
      `Hi ${c.name},`,
      `${playerName} has dropped out of ${fixtureLine(fixture)}.`,
      `Pick a replacement: ${appUrl}/friendlies/manage/game/${encodeURIComponent(fixture.tabName)}`,
    ];
    await sendEmail(c.email, `${fixture.squadLabel}: ${playerName} can't play v ${fixture.opponent} (${fixture.date})`, paragraphs.join('\n\n'), toHtml(paragraphs));
  }
}

/** A squad leaver held tea slots / picks on upcoming fixtures — tell the managers. */
export async function sendSquadLeaverEmail(
  squadLabel: string,
  playerUsername: string,
  clearedTeas: Array<{ date: string; opponent: string; fixtureType: string }>,
  droppedPicks: Array<{ date: string; opponent: string; fixtureType: string }>,
  managerUsernames: string[],
  appUrl: string,
  squadId: string
): Promise<void> {
  if (clearedTeas.length === 0 && droppedPicks.length === 0) return;
  const contacts = await emailByUsername();
  const player = contacts.get(playerUsername.toLowerCase());
  const playerName = player ? player.name : playerUsername;
  const list = (items: Array<{ date: string; opponent: string; fixtureType: string }>) =>
    items.map(i => `• ${i.fixtureType} v ${i.opponent} (${i.date})`).join('\n');
  for (const m of managerUsernames) {
    const c = contacts.get(m.toLowerCase());
    if (!c || !c.email) continue;
    const paragraphs = [
      `Hi ${c.name},`,
      `${playerName} has left the ${squadLabel} squad.`,
      ...(clearedTeas.length > 0 ? [`They were on teas for these fixtures, which now need someone else:\n${list(clearedTeas)}`] : []),
      ...(droppedPicks.length > 0 ? [`They had been picked for:\n${list(droppedPicks)}`] : []),
      `Squad page: ${appUrl}/squads/${squadId}`,
    ];
    await sendEmail(c.email, `${squadLabel}: ${playerName} has left the squad`, paragraphs.join('\n\n'), toHtml(paragraphs));
  }
}

/**
 * A player withdrew from a published game. If it's a league / Club Team game, tell the
 * squad's organisers (only when the player had been picked — a squad reserve stepping
 * back needs no action) and return true; for a friendly return false so the caller emails
 * the Captains as usual.
 */
export async function notifySquadOrganisersOfDropOut(
  game: Fixture,
  username: string,
  appUrl: string,
  wasPicked: boolean
): Promise<boolean> {
  const squad = await getSquadForFixture(game);
  if (!squad) return false;
  if (!wasPicked) return true;
  const managers = await getSquadManagers(squad.id);
  await sendSquadDropOutEmail(
    {
      id: game.id,
      tabName: game.tabName,
      squadLabel: squad.label,
      fixtureType: game.gameType,
      date: game.date,
      time: (game.time || '').slice(0, 5),
      opponent: game.clubName || game.description || 'TBC',
      homeAway: game.homeAway,
      format: game.format,
    },
    username,
    managers,
    appUrl
  );
  return true;
}
