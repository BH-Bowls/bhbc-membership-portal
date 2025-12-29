// src/lib/email/renewal-mailer.ts
// Renewal email sending logic with PDF attachment support

import { User } from '../sheets';
import { loadFirstEmailTemplate, discoverAttachmentTemplates } from './template-loader';
import { generateAllPdfs } from './pdf-generator';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of sending a renewal email
 */
export interface SendRenewalResult {
  success: boolean;
  error?: string;
  userName: string;
}

// ============================================================================
// Variable Building Functions
// ============================================================================

/**
 * Build variables object for email and PDF templates from member data
 * Handles special formatting for address and boolean fields
 *
 * @param member Member/User data from Members sheet
 * @returns Object with all template variables in correct format
 */
export function buildMemberVariables(member: User): Record<string, any> {
  // Build full address from multiple fields
  // Combines address_1, address_2, town, county, post_code
  // Filters out empty values and joins with comma-space
  const addressParts: string[] = [];

  // Add address line 1 if present
  if (member.address1) {
    addressParts.push(member.address1);
  }

  // Add address line 2 if present
  if (member.address2) {
    addressParts.push(member.address2);
  }

  // Add address line 3 if present
  if (member.address3) {
    addressParts.push(member.address3);
  }

  // Add post code if present
  if (member.postCode) {
    addressParts.push(member.postCode);
  }

  // Join all address parts with comma and space
  const fullAddress = addressParts.join(', ');

  // Convert boolean fields to "Yes" or "No" strings
  // Template expects string values, not boolean
  const handbookEntryText = member.handbookEntry ? 'Yes' : 'No';
  const socialEmailsText = member.socialEmails ? 'Yes' : 'No';

  // Get current date in DD/MM/YYYY format
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are 0-based
  const year = now.getFullYear();
  const currentDate = `${day}/${month}/${year}`;

  // Calculate renewal year (next year)
  const renewalYear = String(year + 1);

  // Build complete variables object
  // All fields use camelCase to match template variable format
  const variables: Record<string, any> = {
    // System variables
    currentDate,
    renewalYear,

    // Basic member info
    userName: member.userName || '',
    title: member.title || '',
    firstName: member.firstName || '',
    lastName: member.lastName || '',
    knownAs: member.knownAs || '',
    fullKnownAs: member.fullKnownAs || '',
    fullName: member.fullKnownAs || '', // Alias for Full Name variable

    // Contact info
    emailAddress: member.emailAddress || '',
    mobile: member.mobile || '',
    landline: member.landline || '',
    address: fullAddress,

    // Member details
    ageDem: member.ageDemographic || '',
    memberType: member.memberType || '',

    // Volunteer/duty fields
    barDuty: member.barDuty || '',
    barAddnInfo: member.barAdditionalInfo || '',
    drivingAwayMatches: member.drivingAwayMatches || '',
    drivingAddnInfo: member.drivingAdditionalInfo || '',
    greenClubhouseMaintenance: member.greenMaintenance || '',
    greenAddnInfo: member.greenAdditionalInfo || '',
    otherSkills: member.otherSkills || '',

    // Preference fields (converted to Yes/No)
    handbookEntry: handbookEntryText,
    socialEmails: socialEmailsText,
  };

  return variables;
}

/**
 * Update renewal email sent status in Members sheet
 * Sets the renewal_email_sent_status column for a specific member
 *
 * @param userName Username of member to update
 * @param status Status message to set (e.g., "Success. Email sent 27/12/2024" or "Error: ...")
 */
export async function updateRenewalEmailStatus(
  userName: string,
  status: string
): Promise<void> {
  // Import sheets functions (dynamic import to avoid circular dependencies)
  const { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } = await import('../sheets');

  try {
    // Get column mapping for Members sheet
    const colMap = await getColumnMap('Members');

    // Get Google Sheets client
    const sheets = getGoogleSheetsClient();

    // Fetch all members to find the row for this user
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A2:ZZ', // All columns, starting from row 2 (skip header)
    });

    // Get rows from response
    const rows = response.data.values || [];

    // Get column index for user_name
    const userNameCol = colMap['user_name'];

    // Find row index for this user
    // Loop through data rows to find matching username
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      // Check if this row's username matches
      const rowUserName = rows[i][userNameCol];
      if (rowUserName === userName) {
        rowIndex = i;
        break;
      }
    }

    // Check if user was found
    if (rowIndex < 0) {
      throw new Error(`User ${userName} not found in Members sheet`);
    }

    // Calculate actual row number in sheet
    // Row 1 is header, row 2 is first data row
    const rowNumber = rowIndex + 2;

    // Get column index for renewal_email_sent_status
    const statusCol = colMap['renewal_email_sent_status'];

    // Check if status column exists
    if (statusCol === undefined) {
      throw new Error('renewal_email_sent_status column not found in Members sheet');
    }

    // Convert column index to letter (A, B, C, etc.)
    // This is needed for the range format
    const columnLetter = getColumnLetterFromIndex(statusCol);

    // Build range for this specific cell
    // Format: "Members!{column}{row}"
    // Example: "Members!AZ42"
    const range = `Members!${columnLetter}${rowNumber}`;

    // Update the status cell
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[status]],
      },
    });

    // Log success for monitoring
    console.log(`✓ Updated email status for ${userName}: ${status}`);
  } catch (error) {
    // Log error details for debugging
    console.error(`[updateRenewalEmailStatus] Failed to update status for ${userName}:`, error);

    // Re-throw error with context
    throw new Error(
      `Failed to update email status for ${userName}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Convert column index to Excel-style column letter
 * Uses bijective base-26 numeration (A-Z, AA-ZZ, AAA-ZZZ, etc.)
 *
 * @param colIndex Column index (0-based)
 * @returns Column letter (e.g., 0 → "A", 25 → "Z", 26 → "AA")
 */
function getColumnLetterFromIndex(colIndex: number): string {
  // Start with 1-based index for algorithm
  let index = colIndex + 1;
  let column = '';

  // Loop to build column letter
  while (index > 0) {
    // Get remainder for this position
    const remainder = (index - 1) % 26;

    // Convert to letter (A-Z)
    // 0 → A, 1 → B, ..., 25 → Z
    column = String.fromCharCode(remainder + 65) + column;

    // Move to next position
    index = Math.floor((index - 1) / 26);
  }

  return column;
}

// ============================================================================
// Email Sending Functions
// ============================================================================

/**
 * Send renewal reminder email to a member
 *
 * Process:
 * 1. Fetch member data
 * 2. Build variables object
 * 3. Generate PDFs if attachments requested (sequential, not parallel)
 * 4. Load and populate email template
 * 5. Send email
 * 6. Update status in Members sheet
 *
 * @param member Member data from Members sheet
 * @param includeAttachments Whether to generate and attach PDFs
 * @returns Result with success status and any error message
 */
export async function sendRenewalEmail(
  member: User,
  includeAttachments: boolean
): Promise<SendRenewalResult> {
  try {
    // Build variables object for templates
    const variables = buildMemberVariables(member);

    // Array to hold PDF attachments
    let attachments: Array<{ filename: string; content: Buffer }> = [];

    // Generate PDF attachments if requested
    if (includeAttachments) {
      // Discover all attachment templates
      const attachmentTemplates = discoverAttachmentTemplates();

      // Check if any attachment templates were found
      if (attachmentTemplates.length > 0) {
        // Generate PDFs from all templates
        // IMPORTANT: generateAllPdfs processes sequentially, not in parallel
        // Each PDF completes before next one starts (avoids timing issues)
        const pdfs = await generateAllPdfs(attachmentTemplates, variables);

        // Build attachments array for email
        // Convert PDF results to nodemailer attachment format
        for (const pdf of pdfs) {
          attachments.push({
            filename: pdf.fileName,
            content: pdf.buffer,
          });
        }

        // Log attachment count for monitoring
        console.log(`✓ Generated ${pdfs.length} PDF attachments for ${member.userName}`);
      }
    }

    // Load email template
    const emailTemplate = loadFirstEmailTemplate();

    // Import email sending function
    const { sendEmailWithAttachments } = await import('./mailer');

    // Compile email template with Handlebars
    const Handlebars = await import('handlebars');
    const template = Handlebars.compile(emailTemplate.body);
    const htmlContent = template(variables);

    // Send email with or without attachments
    const emailResult = await sendEmailWithAttachments(
      member.emailAddress || '',
      emailTemplate.subject,
      htmlContent,
      attachments
    );

    // Check if email send failed
    if (!emailResult.success) {
      throw new Error(emailResult.error || 'Failed to send email');
    }

    // Format current date for status message
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dateStr = `${day}/${month}/${year}`;

    // Update status column with success message
    const statusMessage = `Success. Email sent ${dateStr}`;
    await updateRenewalEmailStatus(member.userName, statusMessage);

    // Return success result
    return {
      success: true,
      userName: member.userName,
    };
  } catch (error) {
    // Log error details for debugging
    console.error(`[sendRenewalEmail] Error sending email to ${member.userName}:`, error);

    // Build error message
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Try to update status column with error
    // Don't fail if this update fails (already in error state)
    try {
      await updateRenewalEmailStatus(member.userName, `Error: ${errorMsg}`);
    } catch (statusError) {
      // Log but don't throw - original error is more important
      console.error(`[sendRenewalEmail] Failed to update error status:`, statusError);
    }

    // Return failure result
    return {
      success: false,
      error: errorMsg,
      userName: member.userName,
    };
  }
}
