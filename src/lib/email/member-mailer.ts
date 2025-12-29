// src/lib/email/member-mailer.ts
// Email sending functions for member emails with template support

import { getEmailTemplateContent, getAttachmentTemplatePath, replaceEmailPlaceholders } from './template-reader';
import { sendEmailWithAttachments } from './mailer';
import { generatePdfFromDocx } from './pdf-generator';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Member data from Google Sheets
 * Using actual User interface property names
 */
export interface MemberData {
  userName: string;
  firstName: string;
  lastName: string;
  knownAs: string | null;
  fullKnownAs: string | null;
  emailAddress: string | null;
  title: string | null;
  mobile: string | null;
  landline: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  postCode: string | null;
  memberType: string;
  [key: string]: any;  // Allow any other fields from Members sheet
}

/**
 * Email sending result
 */
export interface EmailResult {
  success: boolean;
  error?: string;
}

// ============================================================================
// Email Sending Functions
// ============================================================================

/**
 * Send email to a member using specified template and attachments
 *
 * @param member Member data from Google Sheets
 * @param templateId Email template ID (filename without extension)
 * @param attachmentIds Array of attachment template IDs to include
 * @returns Result indicating success or failure
 */
export async function sendMemberEmail(
  member: MemberData,
  templateId: string,
  attachmentIds: string[]
): Promise<EmailResult> {
  try {
    // Get recipient email address
    const recipientEmail = member.emailAddress;
    if (!recipientEmail) {
      return {
        success: false,
        error: 'No email address found for member',
      };
    }

    // Get recipient name for logging
    const recipientName = `${member.firstName} ${member.lastName}`.trim() || member.userName || 'Unknown';

    console.log(`[member-mailer] Sending email to ${recipientName} (${recipientEmail})`);

    // ========================================================================
    // Load and Process Email Template
    // ========================================================================

    // Load email template content
    const templateContent = getEmailTemplateContent(templateId);
    if (!templateContent) {
      return {
        success: false,
        error: `Email template not found: ${templateId}`,
      };
    }

    // Create template data object with placeholder names matching template format
    // Maps User interface properties to template placeholder names

    // Build combined address from address lines
    const addressParts = [
      member.address1,
      member.address2,
      member.address3,
      member.postCode,
    ].filter(part => part); // Remove null/empty parts
    const combinedAddress = addressParts.join('\n');

    // Helper function to convert boolean to Y/N for templates
    const boolToYN = (value: boolean | null | undefined): string => {
      if (value === true) return 'Y';
      if (value === false) return 'N';
      return '';
    };

    // Helper function to convert boolean-like strings (TRUE/FALSE) to Y/N
    const stringToYN = (value: string | null | undefined): string => {
      if (!value) return '';
      const upper = value.toUpperCase();
      if (upper === 'TRUE' || upper === 'Y' || upper === 'YES') return 'Y';
      if (upper === 'FALSE' || upper === 'N' || upper === 'NO') return 'N';
      return value; // Return original if not boolean-like
    };

    const templateData: Record<string, any> = {
      // Basic info
      'Full Name': `${member.firstName} ${member.lastName}`.trim(),
      'First Name': member.firstName,
      'Last Name': member.lastName,
      'Title': member.title,
      'Known As': member.knownAs || '', // Blank if not set
      'Full Known As': member.fullKnownAs,

      // Contact info
      'Email': member.emailAddress,
      'Email Address': member.emailAddress, // Alias for Email
      'Mobile': member.mobile,
      'Landline': member.landline,

      // Address fields
      'Address': combinedAddress, // Combined address with line breaks
      'Address 1': member.address1,
      'Address 2': member.address2,
      'Address 3': member.address3,
      'Post Code': member.postCode,

      // Membership info
      'Member Type': member.memberType,
      'User Name': member.userName,
      'Locker No': member.lockerNo,
      'Birthdate': member.birthdate,
      'Age Demographic': member.ageDemographic,
      'Year Started': member.yearStarted,
      'Renew Status': member.renewStatus,

      // Friendlies info
      'Friendlies 2023': member.friendlies2023,
      'Friendlies 2024': member.friendlies2024,
      'Friendlies Last Year': member.friendliesLastYear,

      // Preferences
      'Comments': member.comments,
      'Social Emails': boolToYN(member.socialEmails),
      'Handbook Entry': boolToYN(member.handbookEntry),

      // Driving info
      'Driving Away Matches': stringToYN(member.drivingAwayMatches),
      'Driving Additional Info': member.drivingAdditionalInfo,

      // Green maintenance
      'Green Maintenance': stringToYN(member.greenMaintenance),
      'Green Additional Info': member.greenAdditionalInfo,

      // Bar duty
      'Bar Duty': stringToYN(member.barDuty),
      'Bar Additional Info': member.barAdditionalInfo,

      // Other fields
      'Other Skills': member.otherSkills,
      'Age': member.ageDemographic, // Map Age to Age Demographic
      'Buddy User Name': member.buddyUserName,
      'Role': member.role,
      'Include': member.include,
      'Renewal Email Sent Status': member.renewalEmailSentStatus,
      'Profile Updated Date': member.profileUpdatedDate,
      'Last Login Date': member.lastLoginDate,
      'Last Login Failed Date': member.lastLoginFailedDate,
      'Last Password Reset Date': member.lastPasswordResetDate,
      'Created At': member.createdAt,
      'Updated At': member.updatedAt,

      ...member,  // Include all camelCase properties as fallback
    };

    // Replace placeholders in email template with member data
    const emailBody = replaceEmailPlaceholders(templateContent, templateData);

    // Extract subject from HTML comment <!-- Subject: ... -->
    const subjectMatch = emailBody.match(/<!--\s*Subject:\s*(.+?)\s*-->/);
    const subject = subjectMatch ? subjectMatch[1] : 'Message from Burgess Hill Bowls Club';

    // Remove the subject comment from the email body
    const cleanedEmailBody = emailBody.replace(/<!--\s*Subject:.*?-->\s*/, '');

    // ========================================================================
    // Process Attachments
    // ========================================================================

    const attachments: Array<{ filename: string; content: Buffer }> = [];

    // Process each selected attachment template
    for (const attachmentId of attachmentIds) {
      try {
        console.log(`[member-mailer] Processing attachment: ${attachmentId}`);

        // Get DOCX template path
        const docxTemplatePath = getAttachmentTemplatePath(attachmentId);
        if (!docxTemplatePath) {
          console.error(`[member-mailer] Attachment template not found: ${attachmentId}`);
          continue;  // Skip this attachment but continue with others
        }

        // Generate base filename for this attachment
        const safeUserName = (member.userName || 'member').replace(/[^a-zA-Z0-9]/g, '_');
        const baseFileName = `${attachmentId.replace('Renewal - ', '')}_${safeUserName}`;

        // Generate PDF from DOCX template with member data
        // This will replace placeholders and convert to PDF
        const pdfResult = await generatePdfFromDocx(
          docxTemplatePath,
          templateData,  // Use the same templateData we used for email body
          baseFileName
        );

        // Add PDF buffer to attachments list
        // The email library will use the buffer directly
        const pdfFilename = pdfResult.fileName || `${attachmentId.replace('Renewal - ', '')}.pdf`;
        attachments.push({
          filename: pdfFilename,
          content: pdfResult.buffer,  // Use buffer directly
        } as any);  // Type cast to avoid TS error with nodemailer types

        console.log(`[member-mailer] Attachment ready: ${pdfFilename}`);
      } catch (attachmentError) {
        console.error(`[member-mailer] Error processing attachment ${attachmentId}:`, attachmentError);
        // Continue with other attachments
      }
    }

    // ========================================================================
    // Send Email
    // ========================================================================

    console.log(`[member-mailer] Sending email with ${attachments.length} attachments`);

    // Send email using mail transport
    const emailResult = await sendEmailWithAttachments(
      recipientEmail,
      subject,
      cleanedEmailBody,
      attachments
    );

    // Return result
    if (emailResult.success) {
      console.log(`[member-mailer] Email sent successfully to ${recipientName}`);
      return { success: true };
    } else {
      console.error(`[member-mailer] Email failed for ${recipientName}:`, emailResult.error);
      return {
        success: false,
        error: emailResult.error || 'Failed to send email',
      };
    }
  } catch (error) {
    // Log error
    console.error('[member-mailer] Error in sendMemberEmail:', error);

    // Return error result
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
