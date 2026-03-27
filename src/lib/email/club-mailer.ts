// src/lib/email/club-mailer.ts
// Email sending for club contacts with template support

import { getClubEmailTemplateContent, replaceEmailPlaceholders } from './template-reader';
import { sendEmailWithAttachments } from './mailer';
import { ContactWithCredentials } from '@/lib/clubs-sheets';

export interface ClubEmailResult {
  success: boolean;
  error?: string;
}

/**
 * Send email to a club contact using the specified template.
 * Template variables available: Contact Name, First Name, Last Name, Email,
 * Club Name, Club ID, Password, Role
 */
export async function sendClubContactEmail(
  item: ContactWithCredentials,
  templateId: string,
  transporter?: any
): Promise<ClubEmailResult> {
  const { contact, clubId, password } = item;

  if (!contact.email) {
    return { success: false, error: 'No email address for contact' };
  }
  if (!clubId) {
    return { success: false, error: 'No Club ID set for this club' };
  }

  const templateContent = getClubEmailTemplateContent(templateId);
  if (!templateContent) {
    return { success: false, error: `Template not found: ${templateId}` };
  }

  const fullName = contact.name || `${contact.firstName} ${contact.lastName}`.trim() || contact.clubName;

  const templateData: Record<string, string> = {
    'Contact Name': fullName,
    'First Name': contact.firstName,
    'Last Name': contact.lastName,
    'Email': contact.email,
    'Club Name': contact.clubName,
    'Club ID': clubId,
    'Password': password,
    'Role': contact.role,
  };

  const emailBody = replaceEmailPlaceholders(templateContent, templateData);
  const subjectMatch = emailBody.match(/<!--\s*Subject:\s*(.+?)\s*-->/);
  const subject = subjectMatch ? subjectMatch[1] : 'Message from Burgess Hill Bowls Club';
  const cleanedBody = emailBody.replace(/<!--\s*Subject:.*?-->\s*/, '');

  const result = await sendEmailWithAttachments(contact.email, subject, cleanedBody, [], transporter);
  return result;
}
