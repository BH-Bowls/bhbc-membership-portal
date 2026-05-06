// src/lib/email/friendlies.ts
// Email notification functions for Friendlies system
// Handles sending withdrawal notifications to captains and future game status notifications
// Uses the club's email service to notify captains when players withdraw from selected teams

import { sendEmail } from './mailer';
import { getUserByUsername, getAllUsers } from '../sheets';
import { Game, GameSheetPlayer } from '../types/friendlies';
import { hasRole } from '../role-utils';

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
    // Priority: fullKnownAs → firstName + lastName → userName
    let userFullName = '';

    // Try fullKnownAs first (preferred display name)
    if (user && user.fullKnownAs) {
      userFullName = user.fullKnownAs;
    }
    // Try building name from firstName + lastName
    else if (user && user.firstName && user.lastName) {
      userFullName = user.firstName + ' ' + user.lastName;
    }
    // Fall back to username
    else {
      userFullName = userName;
    }

    // Get list of all captain/admin email addresses
    const captainEmails = await getCaptainEmails();

    // Exit early if no captains configured (log warning but don't throw error)
    if (captainEmails.length === 0) {
      console.warn('No captain emails found for withdrawal notification');
      return;
    }

    // Build email subject line with game details
    const subject = `Friendly Match Withdrawal - ${game.clubName} ${game.tabName}`;

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

    // Send email to all captain/admin email addresses
    // Loop through each captain and send individual emails
    for (const email of captainEmails) {
      await sendEmail(email, subject, text, html);
    }

    // Log successful send
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
    fullName: string;
    email: string | null;
    selected?: string;   // SelectionStatus: 'Y' | 'R' | 'T' | ''
    team?: number | null;
    position?: string;
  }>,
  appUrl: string,
  isRepublish = false,
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
    const gameUrl = `${appUrl}/friendlies/game/${encodeURIComponent(game.tabName)}`;
    const subject = isRepublish
      ? `Team Selection Updated - ${game.clubName} ${game.date}`
      : `Team Selection Published - ${game.clubName} ${game.date}`;
    const venue = game.homeAway === 'H' ? 'Home' : 'Away';
    const emailHeading = isRepublish ? 'Team Selection Updated' : 'Team Selection Published';
    const emailIntro = isRepublish
      ? `The team selection for the <strong>${game.clubName}</strong> game has been updated.`
      : `The team has been selected for the <strong>${game.clubName}</strong> game.`;

    const BUTTON_STYLE = 'display:inline-block;background-color:#0066cc;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:5px;margin-top:15px;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;';

    // Resolve selection status to a human-readable label and colour
    const resolveStatus = (selected?: string): { label: string; color: string } => {
      switch (selected) {
        case 'Y': return { label: 'Selected — Playing', color: '#1a7a1a' };
        case 'R': return { label: 'Reserve', color: '#b45309' };
        case 'T': return { label: 'Reserve Team', color: '#6b21a8' };
        default:  return { label: 'Entered (not yet assigned)', color: '#555555' };
      }
    };

    let emailsSent = 0;
    const failedPlayers: string[] = [];

    for (const player of playersWithEmail) {
      const { label, color } = resolveStatus(player.selected);

      const teamInfo = player.team != null ? ` — Team ${player.team}` : '';

      const text = `
${emailHeading}

Hi ${player.fullName},

${isRepublish ? `The team selection for the ${game.clubName} game has been updated.` : `The team has been selected for the ${game.clubName} game.`}

Date: ${game.date}
Time: ${game.time}
Venue: ${venue}
Format: ${game.format}

Your status: ${label}${teamInfo}

You can view the full team selection and sign off your name either by clicking the link below or visiting the clubhouse:
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
        <p style="margin:0;"><strong>Your status:</strong> <span style="color:${color};font-weight:bold;">${label}</span>${teamInfo ? `<span style="color:#555;"> ${teamInfo}</span>` : ''}</p>
      </div>
      <p>You can view the full team selection and sign off your name either by clicking the button below or visiting the clubhouse.</p>
      <a href="${gameUrl}" style="${BUTTON_STYLE}">View Game Details</a>
    </div>
    <div class="footer">
      <p>Burgess Hill Bowls Club - Friendlies Management System</p>
    </div>
  </div>
</body>
</html>
      `.trim();

      try {
        await transporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: player.email!,
          subject,
          text,
          html,
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
