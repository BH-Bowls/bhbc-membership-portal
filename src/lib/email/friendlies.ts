// src/lib/email/friendlies.ts
// Email notification functions for Friendlies system
// Handles sending withdrawal notifications to captains and future game status notifications
// Uses the club's email service to notify captains when players withdraw from selected teams

import { sendEmail } from './mailer';
import { getUserByUsername, getAllUsers } from '../sheets';
import { Game, GameSheetPlayer } from '../types/friendlies';
import { hasRole } from '../role-utils';
import { buildFriendlyICSAttachment, buildLinkedFriendlyICSAttachment, isGmailAddress, icsUpdatesEnabled } from '../ics-utils';

/**
 * Get email addresses for all captains and admins
 * Fetches the full user list from Members sheet and filters for Captain/Admin roles
 * Only includes users who have a valid email address configured
 * Used to send withdrawal notifications and other captain-only communications
 * @returns Array of email addresses (empty array if error or no captains found)
 */
export async function getCaptainEmails(): Promise<string[]> {
  try {
    // Fetch all users from Members sheet
    const users = await getAllUsers();

    // Build array of email addresses for Captain and Admin users
    const captainEmails: string[] = [];

    // Loop through all users
    for (const user of users) {
      // Check if user has Captain or Admin role (handles comma-separated roles e.g. "Captain,Rowland")
      if (!hasRole(user.role, 'Captain', 'Admin')) {
        continue;
      }

      // Check if user has email address configured
      if (!user.emailAddress) {
        // Skip users without email address
        continue;
      }

      // Add email address to list
      captainEmails.push(user.emailAddress);
    }

    return captainEmails;
  } catch (error) {
    // Log error but don't throw - return empty array to prevent email send failures
    console.error('Error getting captain emails:', error);
    return [];
  }
}

/**
 * Send withdrawal notification email to all captains
 * Called when a player withdraws from a Selected or Played game
 * Alerts captains that a replacement player is needed
 * Includes player's current team/position so captain knows which spot to fill
 * Email contains both plain text and HTML versions with link to team selection page
 * @param userName The username of the player who withdrew
 * @param game The game object containing match details
 * @param selection The player's current selection status (team, position, selected status)
 * @param appUrl The base URL of the application for building links
 */
export async function sendWithdrawalEmail(
  userName: string,
  game: Game,
  selection: {
    selected: string;      // Selection status: Y=Playing, R=Reserve, T=Reserve Team
    team: number | null;   // Team number (1-4 typically)
    position: string;      // Position: S=Skip, 1=Lead, 2=Two, 3=Three
  },
  appUrl: string
): Promise<void> {
  try {
    // Fetch user's profile to get their full display name
    const user = await getUserByUsername(userName);

    // Build full name with fallback chain
    // Priority: fullName → firstName + lastName → userName
    let userFullName = '';

    if (user && user.fullName) {
      userFullName = user.fullName;
    } else if (user && user.firstName && user.lastName) {
      userFullName = `${user.firstName} ${user.lastName}`;
    } else {
      userFullName = userName;
    }

    // Get list of all captain/admin email addresses
    const captainEmails = await getCaptainEmails();

    // Exit early if no captains configured (log warning but don't throw error)
    if (captainEmails.length === 0) {
      console.warn('No captain emails found for withdrawal notification');
      return;
    }

    // Build subject label from selection status: Y=Player, R=Reserve, T=Reserve Team
    let subjectStatusLabel = '';
    if (selection.selected === 'Y') {
      subjectStatusLabel = 'Player';
    } else if (selection.selected === 'R') {
      subjectStatusLabel = 'Reserve';
    } else if (selection.selected === 'T') {
      subjectStatusLabel = 'Reserve Team';
    }

    // Build email subject line with game details.
    // Including the player name ensures each withdrawal has a unique subject so
    // Gmail does not thread multiple withdrawals from the same game into one conversation.
    const statusPart = subjectStatusLabel ? ` (${subjectStatusLabel})` : '';
    const subject = `${userFullName} has withdrawn${statusPart} - ${game.clubName} ${game.tabName}`;

    // Convert selection status code to human-readable text
    // Y = Playing (Regular team), R = Reserve, T = Reserve Team
    let statusText = '';
    if (selection.selected === 'Y') {
      statusText = 'Playing (Regular team)';
    } else if (selection.selected === 'R') {
      statusText = 'Reserve';
    } else if (selection.selected === 'T') {
      statusText = 'Reserve Team';
    } else {
      // Default fallback for any other status codes
      statusText = 'Selected';
    }

    // Build plain text version of email
    // Used for email clients that don't support HTML
    const text = `
${userFullName} has withdrawn from the ${game.clubName} game on ${game.date} at ${game.time}.

Current status: ${statusText}
Team: ${selection.team || 'N/A'}
Position: ${selection.position || 'N/A'}

Please select a replacement player.

View game: ${appUrl}/friendlies/manage/game/${encodeURIComponent(game.tabName)}

---
Burgess Hill Bowls Club
Friendlies Management System
    `.trim();

    // Build HTML version of email with styling and call-to-action button
    // HTML email provides better visual presentation for modern email clients
    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    /* Base styles for email body */
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    /* Center content container with max width for readability */
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    /* Blue header bar with white text */
    .header {
      background-color: #0066cc;
      color: white;
      padding: 20px;
      text-align: center;
      border-radius: 5px 5px 0 0;
    }
    /* Light gray content area */
    .content {
      background-color: #f9f9f9;
      padding: 20px;
      border: 1px solid #ddd;
    }
    /* Highlighted details box with red left border (indicates urgency) */
    .details {
      background-color: white;
      padding: 15px;
      margin: 15px 0;
      border-left: 4px solid #ff6b6b;
    }
    /* Blue button for call-to-action link */
    .button {
      display: inline-block;
      background-color: #0066cc;
      color: #ffffff;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 5px;
      margin-top: 15px;
      font-weight: bold;
    }
    /* Small footer text */
    .footer {
      text-align: center;
      padding: 15px;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Email header with title -->
    <div class="header">
      <h2>Friendly Match Withdrawal</h2>
    </div>

    <!-- Main email content -->
    <div class="content">
      <p><strong>${userFullName}</strong> has withdrawn from the <strong>${game.clubName}</strong> game.</p>

      <!-- Highlighted withdrawal details box -->
      <div class="details">
        <p><strong>Date:</strong> ${game.date} at ${game.time}</p>
        <p><strong>Current status:</strong> ${statusText}</p>
        <p><strong>Team:</strong> ${selection.team || 'N/A'}</p>
        <p><strong>Position:</strong> ${selection.position || 'N/A'}</p>
      </div>

      <p>Please select a replacement player from the reserves or add an offline player.</p>

      <!-- Call-to-action button linking to team selection page -->
      <a href="${appUrl}/friendlies/manage/game/${encodeURIComponent(game.tabName)}" class="button" style="display:inline-block;background-color:#0066cc;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:5px;margin-top:15px;font-weight:bold;">View Game &amp; Select Replacement</a>
    </div>

    <!-- Email footer -->
    <div class="footer">
      <p>Burgess Hill Bowls Club - Friendlies Management System</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    // Send one email to all captains/admins combined so there is a single Sent item
    // and captains can Reply All to coordinate.
    await sendEmail(captainEmails.join(', '), subject, text, html);

    console.log(`Withdrawal notification sent to ${captainEmails.length} captain(s)`);
  } catch (error) {
    // Log error but don't throw
    // Email failures should not prevent the withdrawal from being recorded
    console.error('Error sending withdrawal email:', error);
  }
}

/**
 * Send game published notification email to all entered players
 * Sends individual emails so each player sees their own selection status
 * @param game The game object containing match details
 * @param players Array of entered players with email addresses and selection status
 * @param appUrl The base URL of the application for building links
 * @returns Object with success status, count of emails sent, and any players without emails
 */
export async function sendGamePublishedEmail(
  game: Game,
  players: Array<{
    userName?: string;   // Used in ICS UID — optional for backwards compatibility
    fullName: string;
    email: string | null;
    selected?: string;   // SelectionStatus: 'Y' | 'R' | 'T' | ''
    team?: number | null;
    position?: string;
    captain?: string;    // 'Y' if captain of the day
    driving?: string;    // 'Y' if driving (away games)
    carNumber?: string | null;
  }>,
  appUrl: string,
  isRepublish = false,
  publishMessage?: string,
): Promise<{ success: boolean; emailsSent: number; playersWithoutEmail: string[]; error?: string }> {
  try {
    const playersWithEmail = players.filter(p => p.email && p.email.trim() !== '');
    const playersWithoutEmail = players.filter(p => !p.email || p.email.trim() === '').map(p => p.fullName);

    if (playersWithEmail.length === 0) {
      console.warn('No players with email addresses for game published notification');
      return { success: true, emailsSent: 0, playersWithoutEmail };
    }

    const { getEmailTransporter, isEmailConfigured } = await import('./mailer');

    if (!isEmailConfigured()) {
      console.error('SMTP not configured for game published notification');
      return { success: false, emailsSent: 0, playersWithoutEmail, error: 'Email service not configured' };
    }

    // Use a pooled transporter so all sends share one persistent SMTP connection
    // rather than opening a new connection per email (which can trigger Gmail rate limits)
    const transporter = getEmailTransporter(true);
    const gameBaseUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}`;
    const subject = isRepublish
      ? `Team Selection Updated - ${game.clubName} ${game.date}`
      : `Team Selection Published - ${game.clubName} ${game.date}`;
    const venue = game.homeAway === 'H' ? 'Home' : 'Away';
    const emailHeading = isRepublish ? 'Team Selection Updated' : 'Team Selection Published';
    const defaultIntroHtml = isRepublish
      ? `The team selection for the <strong>${game.clubName}</strong> game has been updated.`
      : `The team has been selected for the <strong>${game.clubName}</strong> game.`;
    const defaultIntroText = isRepublish
      ? `The team selection for the ${game.clubName} game has been updated.`
      : `The team has been selected for the ${game.clubName} game.`;
    const emailIntro = publishMessage ? publishMessage.replace(/\n/g, '<br>') : defaultIntroHtml;
    const emailIntroText = publishMessage ? publishMessage : defaultIntroText;

    const BUTTON_STYLE = 'display:inline-block;background-color:#0066cc;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:5px;margin-top:15px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;';

    const positionLabel = (pos?: string) => {
      switch (pos) {
        case 'S': return 'Skip';
        case '1': return 'Lead';
        case '2': return 'Second';
        case '3': return 'Third';
        default:  return pos || '';
      }
    };

    const isAway = game.homeAway === 'A';

    // Build status label, colour, and detail lines for a player
    const buildStatusDetails = (player: typeof playersWithEmail[0]): {
      statusLabel: string;
      color: string;
      textLines: string[];
      htmlLines: string[];
    } => {
      const isCaptain = player.captain === 'Y';

      if (player.selected === 'Y') {
        const captainSuffix = isCaptain ? ' ★ Captain of the Day' : '';
        const statusLabel = `Selected — Playing${captainSuffix}`;
        const textLines: string[] = [];
        const htmlLines: string[] = [];

        if (player.team != null)  { textLines.push(`Team: ${player.team}`);                      htmlLines.push(`<p style="margin:4px 0;"><strong>Team:</strong> ${player.team}</p>`); }
        if (player.position)      { textLines.push(`Position: ${positionLabel(player.position)}`); htmlLines.push(`<p style="margin:4px 0;"><strong>Position:</strong> ${positionLabel(player.position)}</p>`); }
        if (isAway) {
          const carNum = player.carNumber?.toUpperCase();
          if (carNum === 'O') {
            textLines.push('Travel: Own Transport');
            htmlLines.push(`<p style="margin:4px 0;"><strong>Travel:</strong> Own Transport</p>`);
          } else if (player.driving === 'Y' && player.carNumber) {
            textLines.push(`Travel: Driving — Car ${player.carNumber}`);
            htmlLines.push(`<p style="margin:4px 0;"><strong>Travel:</strong> Driving — Car ${player.carNumber}</p>`);
          } else if (player.carNumber) {
            textLines.push(`Travel: Passenger in Car ${player.carNumber}`);
            htmlLines.push(`<p style="margin:4px 0;"><strong>Travel:</strong> Passenger in Car ${player.carNumber}</p>`);
          }
        }
        return { statusLabel, color: '#1a7a1a', textLines, htmlLines };
      }

      if (player.selected === 'T') {
        const textLines: string[] = [];
        const htmlLines: string[] = [];
        if (player.team != null)  { textLines.push(`Team: ${player.team}`);                      htmlLines.push(`<p style="margin:4px 0;"><strong>Team:</strong> ${player.team}</p>`); }
        if (player.position)      { textLines.push(`Position: ${positionLabel(player.position)}`); htmlLines.push(`<p style="margin:4px 0;"><strong>Position:</strong> ${positionLabel(player.position)}</p>`); }
        return { statusLabel: 'Reserve Team', color: '#6b21a8', textLines, htmlLines };
      }

      if (player.selected === 'R') {
        return { statusLabel: 'Reserve', color: '#b45309', textLines: [], htmlLines: [] };
      }

      return { statusLabel: 'Entered (not yet assigned)', color: '#555555', textLines: [], htmlLines: [] };
    };

    let emailsSent = 0;
    const failedPlayers: string[] = [];

    for (const player of playersWithEmail) {
      const gameUrl = player.userName
        ? `${gameBaseUrl}?me=${encodeURIComponent(player.userName)}`
        : gameBaseUrl;
      const messageCaptainsUrl = `${gameUrl}&action=message-captains`;

      const { statusLabel, color, textLines, htmlLines } = buildStatusDetails(player);
      const isCaptain = player.captain === 'Y';

      const textDetailBlock = textLines.length > 0 ? '\n' + textLines.join('\n') : '';

      const text = `
${emailHeading}

Hi ${player.fullName},

${emailIntroText}

Date: ${game.date}
Time: ${game.time}
Venue: ${venue}
Format: ${game.format}

Your status: ${statusLabel}${textDetailBlock}

You can view the full team selection and sign off your name either by clicking the link below or visiting the clubhouse:
${gameUrl}

Please do not reply to this email. To contact the captains, use the Message Captains button on the game page:
${messageCaptainsUrl}

---
Burgess Hill Bowls Club
Friendlies Management System
      `.trim();

      const captainBadgeHtml = isCaptain
        ? ` <span style="background-color:#7c3aed;color:#fff;font-size:11px;padding:2px 7px;border-radius:10px;vertical-align:middle;">★ Captain of the Day</span>`
        : '';

      const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066cc; color: #ffffff; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .header h2 { margin: 0; color: #ffffff; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .details { background-color: #ffffff; padding: 15px; margin: 15px 0; border-left: 4px solid #0066cc; }
    .status-box { background-color: #ffffff; padding: 15px; margin: 15px 0; border-left: 4px solid ${color}; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${emailHeading}</h2>
    </div>
    <div class="content">
      <p>Hi <strong>${player.fullName}</strong>,</p>
      <p>${emailIntro}</p>
      <div class="details">
        <p><strong>Date:</strong> ${game.date}</p>
        <p><strong>Time:</strong> ${game.time}</p>
        <p><strong>Venue:</strong> ${venue}</p>
        <p><strong>Format:</strong> ${game.format}</p>
      </div>
      <div class="status-box">
        <p style="margin:0 0 ${htmlLines.length > 0 ? '8px' : '0'} 0;">
          <strong>Your status:</strong>
          <span style="color:${color};font-weight:bold;">${player.selected === 'Y' ? 'Selected — Playing' : statusLabel}</span>${captainBadgeHtml}
        </p>
        ${htmlLines.join('\n        ')}
      </div>
      <p>You can view the full team selection and sign off your name either by clicking the button below or visiting the clubhouse.</p>
      <p style="font-size:13px;color:#cc0000;">Please do not reply to this email. Use the buttons below to view the game or contact the captains.</p>
      <a href="${gameUrl}" style="${BUTTON_STYLE}">View Game Details</a>
      <a href="${messageCaptainsUrl}" style="${SECONDARY_BUTTON_STYLE}">Message Captains</a>
    </div>
    <div class="footer">
      <p>Burgess Hill Bowls Club - Friendlies Management System</p>
    </div>
  </div>
</body>
</html>
      `.trim();

      // ICS on publish is gated by ICS_UPDATE_EMAILS env flag; Gmail users always skipped
      const icsAttachment = (icsUpdatesEnabled() && player.userName && !isGmailAddress(player.email!))
        ? buildFriendlyICSAttachment({
            tabName: game.tabName,
            userName: player.userName,
            sequence: isRepublish ? 2 : 1,
            method: 'REQUEST',
            status: 'TENTATIVE',
            dateStr: game.date,
            timeStr: game.time,
            clubName: game.clubName,
            homeAway: game.homeAway,
            format: game.format,
            trigger: 'published',
            organizerEmail: process.env.SMTP_USER,
            attendeeEmail: player.email!,
          })
        : null;

      try {
        await transporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: player.email!,
          subject,
          text,
          html,
          ...(icsAttachment ? { attachments: [icsAttachment] } : {}),
        });
        emailsSent++;
      } catch (playerError) {
        console.error(`Failed to send published email to ${player.fullName} (${player.email}):`, playerError);
        failedPlayers.push(player.fullName);
      }
    }

    // Close the pooled connection when done
    transporter.close();

    const allFailed = [...playersWithoutEmail, ...failedPlayers];
    if (failedPlayers.length > 0) {
      console.warn(`⚠ Failed to send published email to ${failedPlayers.length} player(s): ${failedPlayers.join(', ')}`);
    }
    console.log(`✓ Game published notification sent to ${emailsSent} player(s) for ${game.tabName}`);
    return { success: true, emailsSent, playersWithoutEmail: allFailed };
  } catch (error) {
    console.error('Error sending game published email:', error);
    return {
      success: false,
      emailsSent: 0,
      playersWithoutEmail: [],
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}

/**
 * Send tea rota notification email to members assigned to tea duty for a home game
 * Sends individual To: emails to each member who has an email address
 * All members' names and phone numbers are listed in every email so they can contact each other
 * @param game The game object containing match details
 * @param teaMembers Array of all tea rota members (including those without email)
 * @param appUrl The base URL of the application for building links
 * @returns Object with success status, count of emails sent, and any members without emails
 */
export async function sendTeaRotaEmail(
  game: Game,
  teaMembers: Array<{ role: string; fullName: string; email: string | null; phone: string | null }>,
  appUrl: string
): Promise<{ success: boolean; emailsSent: number; membersWithoutEmail: string[]; error?: string }> {
  try {
    const membersWithEmail = teaMembers.filter(m => m.email && m.email.trim() !== '');
    const membersWithoutEmail = teaMembers.filter(m => !m.email || m.email.trim() === '').map(m => m.fullName);

    if (membersWithEmail.length === 0) {
      console.warn('No tea rota members with email addresses for notification');
      return { success: true, emailsSent: 0, membersWithoutEmail };
    }

    const { getEmailTransporter, isEmailConfigured } = await import('./mailer');

    if (!isEmailConfigured()) {
      return { success: false, emailsSent: 0, membersWithoutEmail, error: 'Email service not configured' };
    }

    const transporter = getEmailTransporter();
    const gameUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}`;
    const subject = `Tea Duty - ${game.clubName} ${game.date}`;

    // Build the rota contact list (all members, with phone numbers, for the email body)
    const rotaTextLines = teaMembers
      .map(m => {
        const phone = m.phone ? `  ${m.phone}` : '';
        return `${m.role}: ${m.fullName}${phone}`;
      })
      .join('\n');

    const rotaHtmlRows = teaMembers
      .map(m => {
        const phone = m.phone
          ? `<br><span style="color:#555;font-size:0.9em;">${m.phone}</span>`
          : '';
        return `<tr>
          <td style="padding:6px 12px 6px 0;font-weight:bold;white-space:nowrap;">${m.role}</td>
          <td style="padding:6px 0;">${m.fullName}${phone}</td>
        </tr>`;
      })
      .join('\n');

    const text = `
Tea Duty Reminder

You are on tea duty for the upcoming home game against ${game.clubName}.

Date: ${game.date}
Time: ${game.time}
Format: ${game.format}

Tea Rota:
${rotaTextLines}

View game details:
${gameUrl}

---
Burgess Hill Bowls Club
Friendlies Management System
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #0066cc; }
    .rota { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #e6a817; }
    .button { display: inline-block; background-color: #0066cc; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin-top: 15px; font-weight: bold; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Tea Duty Reminder</h2>
    </div>
    <div class="content">
      <p>You are on tea duty for the upcoming home game against <strong>${game.clubName}</strong>.</p>
      <div class="details">
        <p><strong>Date:</strong> ${game.date}</p>
        <p><strong>Time:</strong> ${game.time}</p>
        <p><strong>Format:</strong> ${game.format}</p>
      </div>
      <div class="rota">
        <p><strong>Tea Rota:</strong></p>
        <table style="border-collapse:collapse;">
          ${rotaHtmlRows}
        </table>
      </div>
      <a href="${gameUrl}" class="button" style="display:inline-block;background-color:#0066cc;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:5px;margin-top:15px;font-weight:bold;">View Game Details</a>
    </div>
    <div class="footer">
      <p>Burgess Hill Bowls Club - Friendlies Management System</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    // Send a single email with all recipients in To: so they can see each other's addresses
    const toList = membersWithEmail.map(m => m.email).join(', ');

    await transporter.sendMail({
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to: toList,
      subject,
      text,
      html,
    });

    console.log(`✓ Tea rota notification sent to ${membersWithEmail.length} member(s) for ${game.tabName}`);
    return { success: true, emailsSent: membersWithEmail.length, membersWithoutEmail };
  } catch (error) {
    console.error('Error sending tea rota email:', error);
    return {
      success: false,
      emailsSent: 0,
      membersWithoutEmail: [],
      error: error instanceof Error ? error.message : 'Failed to send email',
    };
  }
}

/**
 * Send game cancellation notification email to all entered players
 * Includes a METHOD:CANCEL ICS attachment to remove the event from their calendar
 */
export async function sendGameCancelledEmail(
  game: Game,
  players: Array<{ userName: string; fullName: string; email: string | null }>,
  appUrl: string,
  reason?: string,
): Promise<{ success: boolean; emailsSent: number; playersWithoutEmail: string[]; error?: string }> {
  try {
    const playersWithEmail = players.filter(p => p.email && p.email.trim() !== '');
    const playersWithoutEmail = players.filter(p => !p.email || p.email.trim() === '').map(p => p.fullName);

    if (playersWithEmail.length === 0) {
      return { success: true, emailsSent: 0, playersWithoutEmail };
    }

    const { getEmailTransporter, isEmailConfigured } = await import('./mailer');
    if (!isEmailConfigured()) {
      return { success: false, emailsSent: 0, playersWithoutEmail, error: 'Email service not configured' };
    }

    const transporter = getEmailTransporter(true);
    const subject = `Game Cancelled — ${game.clubName} ${game.date}`;
    const venue = game.homeAway === 'H' ? 'Home' : `Away at ${game.clubName}`;
    const reasonLine = reason ? `\nReason: ${reason}` : '';

    const BUTTON_STYLE = 'display:inline-block;background-color:#0066cc;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:5px;margin-top:15px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;';

    let emailsSent = 0;

    for (const player of playersWithEmail) {
      // ICS on cancel is gated by ICS_UPDATE_EMAILS env flag; Gmail users always skipped
      const ics = (icsUpdatesEnabled() && !isGmailAddress(player.email!))
        ? buildFriendlyICSAttachment({
            tabName: game.tabName,
            userName: player.userName,
            sequence: 99,
            method: 'CANCEL',
            status: 'CANCELLED',
            dateStr: game.date,
            timeStr: game.time,
            clubName: game.clubName,
            homeAway: game.homeAway,
            format: game.format,
            trigger: 'cancelled',
            organizerEmail: process.env.SMTP_USER,
            attendeeEmail: player.email!,
          })
        : null;

      const text = [
        `Hi ${player.fullName},`,
        '',
        `The ${game.homeAway === 'H' ? 'home' : 'away'} friendly against ${game.clubName} on ${game.date} has been cancelled.`,
        '',
        `Date: ${game.date}`,
        `Time: ${game.time}`,
        `Venue: ${venue}`,
        `Format: ${game.format}`,
        reasonLine,
        '',
        ...(ics ? ['A calendar cancellation is attached to remove this event from your calendar.', ''] : []),
        '---',
        'Burgess Hill Bowls Club',
      ].filter(l => l !== undefined).join('\n');

      const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #dc2626; color: #ffffff; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .header h2 { margin: 0; color: #ffffff; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .details { background-color: #ffffff; padding: 15px; margin: 15px 0; border-left: 4px solid #dc2626; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>Game Cancelled</h2></div>
    <div class="content">
      <p>Hi <strong>${player.fullName}</strong>,</p>
      <p>The friendly against <strong>${game.clubName}</strong> has been cancelled.</p>
      <div class="details">
        <p><strong>Date:</strong> ${game.date}</p>
        <p><strong>Time:</strong> ${game.time}</p>
        <p><strong>Venue:</strong> ${venue}</p>
        <p><strong>Format:</strong> ${game.format}</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      </div>
      ${ics ? '<p>A calendar cancellation is attached to remove this event from your calendar.</p>' : ''}
    </div>
    <div class="footer"><p>Burgess Hill Bowls Club - Friendlies Management System</p></div>
  </div>
</body>
</html>`.trim();

      try {
        await transporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: player.email!,
          subject,
          text,
          html,
          ...(ics ? { attachments: [ics] } : {}),
        });
        emailsSent++;
      } catch (playerError) {
        console.error(`Failed to send cancellation email to ${player.fullName}:`, playerError);
      }
    }

    transporter.close();
    console.log(`✓ Cancellation notification sent to ${emailsSent} player(s) for ${game.tabName}`);
    return { success: true, emailsSent, playersWithoutEmail };
  } catch (error) {
    console.error('Error sending game cancelled email:', error);
    return { success: false, emailsSent: 0, playersWithoutEmail: [], error: error instanceof Error ? error.message : 'Failed to send email' };
  }
}

/**
 * Send tea rota cancellation notice for a home game
 * Plain notification — no ICS needed since the tea rota email has no calendar event
 */
export async function sendTeaRotaCancelledEmail(
  game: Game,
  teaMembers: Array<{ role: string; fullName: string; email: string | null }>,
  reason?: string,
): Promise<{ success: boolean; emailsSent: number; membersWithoutEmail: string[]; error?: string }> {
  try {
    const membersWithEmail = teaMembers.filter(m => m.email && m.email.trim() !== '');
    const membersWithoutEmail = teaMembers.filter(m => !m.email || m.email.trim() === '').map(m => m.fullName);

    if (membersWithEmail.length === 0) {
      return { success: true, emailsSent: 0, membersWithoutEmail };
    }

    const { getEmailTransporter, isEmailConfigured } = await import('./mailer');
    if (!isEmailConfigured()) {
      return { success: false, emailsSent: 0, membersWithoutEmail, error: 'Email service not configured' };
    }

    const transporter = getEmailTransporter();
    const subject = `Tea Duty Cancelled — ${game.clubName} ${game.date}`;
    const reasonLine = reason ? `\nReason: ${reason}` : '';

    const rotaTextLines = teaMembers.map(m => `${m.role}: ${m.fullName}`).join('\n');
    const rotaHtmlRows = teaMembers
      .map(m => `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">${m.role}</td><td style="padding:4px 0;">${m.fullName}</td></tr>`)
      .join('\n');

    const text = [
      `The home game against ${game.clubName} on ${game.date} has been cancelled.`,
      'You are no longer required for tea duty.',
      reasonLine,
      '',
      `Tea Rota (for your reference):`,
      rotaTextLines,
      '',
      '---',
      'Burgess Hill Bowls Club',
    ].join('\n');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .details { background-color: white; padding: 15px; margin: 15px 0; border-left: 4px solid #dc2626; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>Tea Duty Cancelled</h2></div>
    <div class="content">
      <p>The home game against <strong>${game.clubName}</strong> on <strong>${game.date}</strong> has been cancelled.</p>
      <p><strong>You are no longer required for tea duty.</strong></p>
      <div class="details">
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
        <p><strong>Tea Rota (for reference):</strong></p>
        <table style="border-collapse:collapse;">${rotaHtmlRows}</table>
      </div>
    </div>
    <div class="footer"><p>Burgess Hill Bowls Club - Friendlies Management System</p></div>
  </div>
</body>
</html>`.trim();

    const toList = membersWithEmail.map(m => m.email).join(', ');
    await transporter.sendMail({
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to: toList,
      subject,
      text,
      html,
    });

    console.log(`✓ Tea rota cancellation sent to ${membersWithEmail.length} member(s) for ${game.tabName}`);
    return { success: true, emailsSent: membersWithEmail.length, membersWithoutEmail };
  } catch (error) {
    console.error('Error sending tea rota cancellation email:', error);
    return { success: false, emailsSent: 0, membersWithoutEmail: [], error: error instanceof Error ? error.message : 'Failed to send email' };
  }
}

/**
 * Send game status change notification (future enhancement placeholder)
 * Currently just logs the status change - not yet implemented
 * Future use: notify all entered players when game status changes
 * Potential notifications:
 *   - Status 'O' (Opened): Notify members that entries are open
 *   - Status 'X' (Selecting): Notify players that entries are closed, selection in progress
 *   - Status 'S' (Selected): Notify all players of their selection status (picked/reserve/not selected)
 *   - Status 'P' (Played): Send match results to all participants
 *   - Status 'C' (Cancelled): Notify all entered players that game was cancelled
 * @param game The game object containing match details
 * @param newStatus The new status code (O, X, S, P, C, or A)
 * @param appUrl The base URL of the application for building links
 */
export async function sendGameStatusChangeEmail(
  game: Game,
  newStatus: string,
  appUrl: string
): Promise<void> {
  // Future enhancement: implement notification logic based on status
  // For now, just log the status change for debugging
  console.log(`Game status change notification: ${game.tabName} -> ${newStatus}`);

  // TODO: Implement actual email notifications
  // - Fetch all players who entered this game
  // - Build appropriate message based on status
  // - Send personalized emails showing their selection status
}

// ─── Player notification emails (entry, withdrawal, removal) ─────────────────

const PLAYER_BUTTON_STYLE =
  'display:inline-block;background-color:#0066cc;color:#ffffff;padding:12px 24px;' +
  'text-decoration:none;border-radius:5px;margin-top:15px;font-family:Arial,sans-serif;' +
  'font-size:14px;font-weight:bold;';

const SECONDARY_BUTTON_STYLE =
  'display:inline-block;background-color:#ffffff;color:#0066cc;padding:11px 20px;' +
  'text-decoration:none;border-radius:5px;margin-top:8px;margin-left:8px;' +
  'font-family:Arial,sans-serif;font-size:14px;font-weight:bold;border:2px solid #0066cc;';

function buildFriendlyPlayerHtml(opts: {
  heading: string;
  headerColor: string;
  fullName: string;
  introHtml: string;
  game: Game;
  noteHtml?: string;
  gameUrl: string;
  buttonText: string;
  messageCaptainsUrl?: string;
}): string {
  const venue = opts.game.homeAway === 'H' ? 'Home' : `Away at ${opts.game.clubName}`;
  const messageCaptainsBtn = opts.messageCaptainsUrl
    ? `<a href="${opts.messageCaptainsUrl}" style="${SECONDARY_BUTTON_STYLE}">Message Captains</a>`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: ${opts.headerColor}; color: #ffffff; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .header h2 { margin: 0; color: #ffffff; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .details { background-color: #ffffff; padding: 15px; margin: 15px 0; border-left: 4px solid ${opts.headerColor}; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>${opts.heading}</h2></div>
    <div class="content">
      <p>Hi <strong>${opts.fullName}</strong>,</p>
      <p>${opts.introHtml}</p>
      <div class="details">
        <p><strong>Date:</strong> ${opts.game.date}</p>
        <p><strong>Time:</strong> ${opts.game.time}</p>
        <p><strong>Venue:</strong> ${venue}</p>
        <p><strong>Format:</strong> ${opts.game.format}</p>
      </div>
      ${opts.noteHtml ?? ''}
      <a href="${opts.gameUrl}" style="${PLAYER_BUTTON_STYLE}">${opts.buttonText}</a>${messageCaptainsBtn}
    </div>
    <div class="footer"><p>Burgess Hill Bowls Club - Friendlies Management System</p></div>
  </div>
</body>
</html>`.trim();
}

function resolveDisplayName(user: { fullName?: string | null; firstName?: string | null; lastName?: string | null } | null, fallback: string): string {
  if (!user) return fallback;
  if (user.fullName) return user.fullName;
  if (user.firstName && user.lastName) return `${user.firstName} ${user.lastName}`;
  return fallback;
}

/**
 * Send entry confirmation email to a player.
 * When addedByAdmin is true the intro reads "You have been entered" (passive);
 * otherwise "You have entered" (active). ICS is always attached.
 */
export async function sendEntryConfirmedEmail(
  emailAddress: string,
  userName: string,
  fullName: string,
  game: Game,
  appUrl: string,
  addedByAdmin = false,
): Promise<void> {
  const gameUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}?me=${encodeURIComponent(userName)}`;
  const messageCaptainsUrl = `${gameUrl}&action=message-captains`;
  const venue = game.homeAway === 'H' ? 'Home' : `Away at ${game.clubName}`;
  const subject = `Friendly Entry Confirmed — ${game.clubName} ${game.date}`;
  const introText = addedByAdmin
    ? `You have been entered in the friendly against ${game.clubName}.`
    : `You have entered the friendly against ${game.clubName}.`;
  const introHtml = addedByAdmin
    ? `You have been entered in the friendly against <strong>${game.clubName}</strong>.`
    : `You have entered the friendly against <strong>${game.clubName}</strong>.`;

  const ics = buildFriendlyICSAttachment({
    tabName: game.tabName,
    userName,
    sequence: 0,
    method: 'PUBLISH',
    status: 'TENTATIVE',
    dateStr: game.date,
    timeStr: game.time,
    clubName: game.clubName,
    homeAway: game.homeAway,
    format: game.format,
    trigger: 'entered',
  });

  const text = [
    `Hi ${fullName},`,
    '',
    introText,
    '',
    `Date: ${game.date}`,
    `Time: ${game.time}`,
    `Venue: ${venue}`,
    `Format: ${game.format}`,
    '',
    'The event is marked as tentative until the team is published.',
    'A calendar attachment is included.',
    '',
    `View game: ${gameUrl}`,
    '',
    'Please do not reply to this email. To contact the captains, use the Message Captains',
    `button on the game page: ${messageCaptainsUrl}`,
    '',
    '---',
    'Burgess Hill Bowls Club',
  ].join('\n');

  const html = buildFriendlyPlayerHtml({
    heading: 'Friendly Entry Confirmed',
    headerColor: '#0066cc',
    fullName,
    introHtml,
    game,
    noteHtml: `<p>The event is marked as tentative until the team is published. A calendar attachment is included.</p>
      <p style="font-size:13px;color:#cc0000;margin-top:16px;">Please do not reply to this email. Use the buttons below to view the game or contact the captains.</p>`,
    gameUrl,
    buttonText: 'View Game Details',
    messageCaptainsUrl,
  });

  await sendEmail(emailAddress, subject, text, html, [ics]);
}

/**
 * Send a single combined entry confirmation for a linked game pair.
 * The player has entered both games and will be allocated to one by the captain.
 */
export async function sendLinkedEntryConfirmedEmail(
  emailAddress: string,
  userName: string,
  fullName: string,
  gameA: Game,
  gameB: Game,
  appUrl: string,
): Promise<void> {
  const urlA = `${appUrl}/friendlies/game/${encodeURIComponent(gameA.tabName)}?me=${encodeURIComponent(userName)}`;
  const urlB = `${appUrl}/friendlies/game/${encodeURIComponent(gameB.tabName)}?me=${encodeURIComponent(userName)}`;
  const venueA = gameA.homeAway === 'H' ? 'Home' : `Away at ${gameA.clubName}`;
  const venueB = gameB.homeAway === 'H' ? 'Home' : `Away at ${gameB.clubName}`;
  const subject = `Friendly Entry Confirmed — ${gameA.date}`;

  const allocationNote = 'These games are linked. You have been added to both and will be allocated to one by the captain.';

  // Use the earlier of the two game times for the calendar entry start
  const earlierTime = gameA.time <= gameB.time ? gameA.time : gameB.time;
  const ics = buildLinkedFriendlyICSAttachment({
    userName,
    dateStr: gameA.date,
    timeStr: earlierTime,
    gameAClubName: gameA.clubName,
    gameAHomeAway: gameA.homeAway,
    gameBClubName: gameB.clubName,
    gameBHomeAway: gameB.homeAway,
  });

  const text = [
    `Hi ${fullName},`,
    '',
    allocationNote,
    '',
    `Game 1: ${venueA}`,
    `Date: ${gameA.date}`,
    `Time: ${gameA.time}`,
    `Format: ${gameA.format}`,
    `View: ${urlA}`,
    '',
    `Game 2: ${venueB}`,
    `Date: ${gameB.date}`,
    `Time: ${gameB.time}`,
    `Format: ${gameB.format}`,
    `View: ${urlB}`,
    '',
    'A calendar attachment is included (tentative until you are allocated to a game).',
    '',
    '---',
    'Burgess Hill Bowls Club',
  ].join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #0066cc; color: #ffffff; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .header h2 { margin: 0; color: #ffffff; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .details { background-color: #ffffff; padding: 15px; margin: 15px 0; border-left: 4px solid #0066cc; }
    .allocation-note { background-color: #e8f0fe; border-left: 4px solid #0066cc; padding: 12px 15px; margin: 15px 0; font-size: 14px; }
    .footer { text-align: center; padding: 15px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header"><h2>Friendly Entry Confirmed</h2></div>
    <div class="content">
      <p>Hi <strong>${fullName}</strong>,</p>
      <div class="allocation-note">${allocationNote}</div>
      <p><strong>Game 1</strong></p>
      <div class="details">
        <p><strong>Date:</strong> ${gameA.date}</p>
        <p><strong>Time:</strong> ${gameA.time}</p>
        <p><strong>Venue:</strong> ${venueA}</p>
        <p><strong>Format:</strong> ${gameA.format}</p>
      </div>
      <a href="${urlA}" style="${PLAYER_BUTTON_STYLE}">View Game 1</a>
      <p style="margin-top:20px"><strong>Game 2</strong></p>
      <div class="details">
        <p><strong>Date:</strong> ${gameB.date}</p>
        <p><strong>Time:</strong> ${gameB.time}</p>
        <p><strong>Venue:</strong> ${venueB}</p>
        <p><strong>Format:</strong> ${gameB.format}</p>
      </div>
      <a href="${urlB}" style="${PLAYER_BUTTON_STYLE}">View Game 2</a>
      <p style="font-size:13px;margin-top:16px;">A calendar attachment is included (tentative until you are allocated to a game).</p>
      <p style="font-size:13px;color:#cc0000;">Please do not reply to this email.</p>
    </div>
    <div class="footer"><p>Burgess Hill Bowls Club - Friendlies Management System</p></div>
  </div>
</body>
</html>`.trim();

  await sendEmail(emailAddress, subject, text, html, [ics]);
}

/**
 * Send withdrawal confirmation to a player who withdrew themselves from a game.
 * ICS cancel is gated on icsUpdatesEnabled() and the address not being Gmail.
 */
export async function sendWithdrawalNoticeEmail(
  emailAddress: string,
  userName: string,
  fullName: string,
  game: Game,
  appUrl: string,
): Promise<void> {
  const gameUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}?me=${encodeURIComponent(userName)}`;
  const venue = game.homeAway === 'H' ? 'Home' : `Away at ${game.clubName}`;
  const subject = `Friendly Withdrawal — ${game.clubName} ${game.date}`;

  const ics = (icsUpdatesEnabled() && !isGmailAddress(emailAddress))
    ? buildFriendlyICSAttachment({
        tabName: game.tabName,
        userName,
        sequence: 99,
        method: 'CANCEL',
        status: 'CANCELLED',
        dateStr: game.date,
        timeStr: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        trigger: 'withdrawn',
        organizerEmail: process.env.SMTP_USER,
        attendeeEmail: emailAddress,
      })
    : null;

  const text = [
    `Hi ${fullName},`,
    '',
    `You have withdrawn from the friendly against ${game.clubName} on ${game.date}.`,
    '',
    `Date: ${game.date}`,
    `Time: ${game.time}`,
    `Venue: ${venue}`,
    `Format: ${game.format}`,
    '',
    ...(ics ? ['A calendar cancellation is attached to remove this event from your calendar.', ''] : []),
    `View game: ${gameUrl}`,
    '',
    '---',
    'Burgess Hill Bowls Club',
  ].join('\n');

  const html = buildFriendlyPlayerHtml({
    heading: 'Friendly Withdrawal',
    headerColor: '#d97706',
    fullName,
    introHtml: `You have withdrawn from the friendly against <strong>${game.clubName}</strong> on ${game.date}.`,
    game,
    noteHtml: ics ? '<p>A calendar cancellation is attached to remove this event from your calendar.</p>' : undefined,
    gameUrl,
    buttonText: 'View Game',
  });

  await sendEmail(emailAddress, subject, text, html, ics ? [ics] : undefined);
}

/**
 * Send notice to a player removed from an Open/Selecting game by a captain.
 * ICS cancel is gated on icsUpdatesEnabled() and the address not being Gmail.
 */
export async function sendRemovedNoticeEmail(
  emailAddress: string,
  userName: string,
  fullName: string,
  game: Game,
  appUrl: string,
): Promise<void> {
  const gameUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}?me=${encodeURIComponent(userName)}`;
  const venue = game.homeAway === 'H' ? 'Home' : `Away at ${game.clubName}`;
  const subject = `Friendly Entry Removed — ${game.clubName} ${game.date}`;

  const ics = (icsUpdatesEnabled() && !isGmailAddress(emailAddress))
    ? buildFriendlyICSAttachment({
        tabName: game.tabName,
        userName,
        sequence: 99,
        method: 'CANCEL',
        status: 'CANCELLED',
        dateStr: game.date,
        timeStr: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        trigger: 'withdrawn',
        organizerEmail: process.env.SMTP_USER,
        attendeeEmail: emailAddress,
      })
    : null;

  const text = [
    `Hi ${fullName},`,
    '',
    `You have been removed from the friendly against ${game.clubName} on ${game.date}.`,
    '',
    `Date: ${game.date}`,
    `Time: ${game.time}`,
    `Venue: ${venue}`,
    `Format: ${game.format}`,
    '',
    ...(ics ? ['A calendar cancellation is attached to remove this event from your calendar.', ''] : []),
    `View game: ${gameUrl}`,
    '',
    '---',
    'Burgess Hill Bowls Club',
  ].join('\n');

  const html = buildFriendlyPlayerHtml({
    heading: 'Friendly Entry Removed',
    headerColor: '#d97706',
    fullName,
    introHtml: `You have been removed from the friendly against <strong>${game.clubName}</strong> on ${game.date}.`,
    game,
    noteHtml: ics ? '<p>A calendar cancellation is attached to remove this event from your calendar.</p>' : undefined,
    gameUrl,
    buttonText: 'View Game',
  });

  await sendEmail(emailAddress, subject, text, html, ics ? [ics] : undefined);
}

/**
 * Send notice to a player withdrawn from a Selected game by a captain.
 * ICS cancel is gated on icsUpdatesEnabled() and the address not being Gmail.
 */
export async function sendWithdrawnByAdminNoticeEmail(
  emailAddress: string,
  userName: string,
  fullName: string,
  game: Game,
  appUrl: string,
): Promise<void> {
  const gameUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}?me=${encodeURIComponent(userName)}`;
  const venue = game.homeAway === 'H' ? 'Home' : `Away at ${game.clubName}`;
  const subject = `Friendly Withdrawal — ${game.clubName} ${game.date}`;

  const ics = (icsUpdatesEnabled() && !isGmailAddress(emailAddress))
    ? buildFriendlyICSAttachment({
        tabName: game.tabName,
        userName,
        sequence: 99,
        method: 'CANCEL',
        status: 'CANCELLED',
        dateStr: game.date,
        timeStr: game.time,
        clubName: game.clubName,
        homeAway: game.homeAway,
        format: game.format,
        trigger: 'withdrawn',
        organizerEmail: process.env.SMTP_USER,
        attendeeEmail: emailAddress,
      })
    : null;

  const text = [
    `Hi ${fullName},`,
    '',
    `You have been withdrawn from the friendly against ${game.clubName} on ${game.date}.`,
    '',
    `Date: ${game.date}`,
    `Time: ${game.time}`,
    `Venue: ${venue}`,
    `Format: ${game.format}`,
    '',
    ...(ics ? ['A calendar cancellation is attached to remove this event from your calendar.', ''] : []),
    `View game: ${gameUrl}`,
    '',
    '---',
    'Burgess Hill Bowls Club',
  ].join('\n');

  const html = buildFriendlyPlayerHtml({
    heading: 'Friendly Withdrawal',
    headerColor: '#d97706',
    fullName,
    introHtml: `You have been withdrawn from the friendly against <strong>${game.clubName}</strong> on ${game.date}.`,
    game,
    noteHtml: ics ? '<p>A calendar cancellation is attached to remove this event from your calendar.</p>' : undefined,
    gameUrl,
    buttonText: 'View Game',
  });

  await sendEmail(emailAddress, subject, text, html, ics ? [ics] : undefined);
}
