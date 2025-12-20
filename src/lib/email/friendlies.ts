// Email notifications for Friendlies system
import { sendEmail } from './mailer';
import { getUserByUsername, getAllUsers } from '../sheets';
import { Game, GameSheetPlayer } from '../types/friendlies';

/**
 * Get email addresses for all captains and admins
 */
export async function getCaptainEmails(): Promise<string[]> {
  try {
    const users = await getAllUsers();
    const captains = users.filter(
      u => (u.role === 'Captain' || u.role === 'Admin') && u.emailAddress
    );
    return captains.map(c => c.emailAddress!);
  } catch (error) {
    console.error('Error getting captain emails:', error);
    return [];
  }
}

/**
 * Send withdrawal notification to all captains
 */
export async function sendWithdrawalEmail(
  userName: string,
  game: Game,
  selection: {
    selected: string;
    team: number | null;
    position: string;
  },
  appUrl: string
): Promise<void> {
  try {
    // Get user's full name
    const user = await getUserByUsername(userName);
    const userFullName = user?.fullKnownAs || user?.firstName + ' ' + user?.lastName || userName;

    // Get captain emails
    const captainEmails = await getCaptainEmails();

    if (captainEmails.length === 0) {
      console.warn('No captain emails found for withdrawal notification');
      return;
    }

    // Build email content
    const subject = `Friendly Match Withdrawal - ${game.clubName} ${game.tabDate}`;

    const statusText = selection.selected === 'Y' ? 'Playing (Regular team)' :
                      selection.selected === 'R' ? 'Reserve' :
                      selection.selected === 'T' ? 'Reserve Team' : 'Selected';

    const text = `
${userFullName} has withdrawn from the ${game.clubName} game on ${game.date} at ${game.time}.

Current status: ${statusText}
Team: ${selection.team || 'N/A'}
Position: ${selection.position || 'N/A'}

Please select a replacement player.

View game: ${appUrl}/friendlies/manage/${game.tabDate}

---
Burgess Hill Bowls Club
Friendlies Management System
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background-color: #0066cc;
      color: white;
      padding: 20px;
      text-align: center;
      border-radius: 5px 5px 0 0;
    }
    .content {
      background-color: #f9f9f9;
      padding: 20px;
      border: 1px solid #ddd;
    }
    .details {
      background-color: white;
      padding: 15px;
      margin: 15px 0;
      border-left: 4px solid #ff6b6b;
    }
    .button {
      display: inline-block;
      background-color: #0066cc;
      color: white;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 5px;
      margin-top: 15px;
    }
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
    <div class="header">
      <h2>Friendly Match Withdrawal</h2>
    </div>
    <div class="content">
      <p><strong>${userFullName}</strong> has withdrawn from the <strong>${game.clubName}</strong> game.</p>

      <div class="details">
        <p><strong>Date:</strong> ${game.date} at ${game.time}</p>
        <p><strong>Current status:</strong> ${statusText}</p>
        <p><strong>Team:</strong> ${selection.team || 'N/A'}</p>
        <p><strong>Position:</strong> ${selection.position || 'N/A'}</p>
      </div>

      <p>Please select a replacement player from the reserves or add an offline player.</p>

      <a href="${appUrl}/friendlies/manage/${game.tabDate}" class="button">View Game & Select Replacement</a>
    </div>
    <div class="footer">
      <p>Burgess Hill Bowls Club - Friendlies Management System</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    // Send to all captains
    for (const email of captainEmails) {
      await sendEmail(email, subject, text, html);
    }

    console.log(`Withdrawal notification sent to ${captainEmails.length} captain(s)`);
  } catch (error) {
    console.error('Error sending withdrawal email:', error);
    // Don't throw - email failure shouldn't block the withdrawal
  }
}

/**
 * Send game status change notification (optional future enhancement)
 */
export async function sendGameStatusChangeEmail(
  game: Game,
  newStatus: string,
  appUrl: string
): Promise<void> {
  // Future enhancement: notify players when game status changes to 'S' (Selected)
  console.log(`Game status change notification: ${game.tabDate} -> ${newStatus}`);
}
