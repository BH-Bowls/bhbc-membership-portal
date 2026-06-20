// app/api/apply/route.ts
// API endpoint for membership applications (public - no auth required)

import { NextRequest, NextResponse } from 'next/server';
import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from '@/lib/sheets';
import { calculateMembershipFee } from '@/lib/renewals-sheets';
import { sendEmailWithAttachments, isEmailConfigured, getEmailTransporter } from '@/lib/email/mailer';
import { processEmailTemplate } from '@/lib/email/template-processor';
import { readFileSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';

// Google Drive PDF link (converted to direct download)
const PDF_URL = 'https://drive.google.com/uc?export=download&id=1e40Od4gBtG8iPdAwWn1eo2AVvhhfBh86';
const PDF_FILENAME = 'BHBC-Membership-Information.pdf';

// BCC email for all applications
const BCC_EMAIL = 'burgesshillbc@gmail.com';

// Rate limiting - simple in-memory store
const submissionTimes: Map<string, number> = new Map();
const RATE_LIMIT_MINUTES = 5;

interface ApplicationData {
  firstName: string;
  lastName: string;
  knownAs?: string;
  gender: 'M' | 'F';
  email: string;
  landline?: string;
  mobile: string;
  address1?: string;
  address2?: string;
  address3?: string;
  postCode?: string;
  ageDemographic: string;
  dob?: string;
  ftEducation?: string;
  memberType: 'Playing' | 'Social';
  previousExperience?: string;
  disabilities?: string;
  proposerName?: string;
  seconderName?: string;
  comments?: string;
  // Honeypot field - should be empty
  website?: string;
}

export async function POST(request: NextRequest) {
  try {
    const data: ApplicationData = await request.json();

    // Honeypot check - if website field is filled, it's likely a bot
    if (data.website) {
      console.log('[Apply] Honeypot triggered - rejecting submission');
      // Return success to not alert the bot, but don't process
      return NextResponse.json({ success: true });
    }

    // Rate limiting by IP
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const lastSubmission = submissionTimes.get(ip);
    const now = Date.now();

    if (lastSubmission && (now - lastSubmission) < RATE_LIMIT_MINUTES * 60 * 1000) {
      return NextResponse.json(
        { error: 'Please wait a few minutes before submitting another application' },
        { status: 429 }
      );
    }

    // Validate required fields
    const errors: string[] = [];
    if (!data.firstName?.trim()) errors.push('First Name is required');
    if (!data.lastName?.trim()) errors.push('Last Name is required');
    if (!data.gender) errors.push('Gender is required');
    if (!data.email?.trim()) errors.push('Email is required');
    if (!data.mobile?.trim()) errors.push('Mobile is required');
    if (!data.ageDemographic) errors.push('Age Demographic is required');
    if (!data.memberType) errors.push('Member Type is required');

    // Conditional validation
    if (data.ageDemographic === 'U18' && !data.dob?.trim()) {
      errors.push('Date of Birth is required for under 18s');
    }
    if (data.ageDemographic === '18-24' && !data.ftEducation) {
      errors.push('Full time education status is required for 18-24 age group');
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (data.email && !emailRegex.test(data.email)) {
      errors.push('Please enter a valid email address');
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join(', ') }, { status: 400 });
    }

    // Get current timestamp
    const createdAt = new Date().toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    // Write to Application sheet
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = getSpreadsheetId();

    // Derive the full member type name from gender + Playing/Social so the
    // membership fee can be calculated. The Members sheet later stores this same
    // full-name form (e.g. "Playing Man").
    let fullMemberType = '';
    if (data.memberType === 'Playing') {
      fullMemberType = data.gender === 'M' ? 'Playing Man' : 'Playing Lady';
    } else if (data.memberType === 'Social') {
      fullMemberType = data.gender === 'M' ? 'Social Man' : 'Social Lady';
    }

    // Calculate the membership fee owed on submission. This is the full
    // (non-pro-rata) subscription; any pro-rata reduction is applied manually by
    // the admin before the payment email is sent. New applicants are never honorary.
    const isFullTimeEducation = data.ftEducation === 'Y';
    const feeDue = calculateMembershipFee(
      data.ageDemographic,
      fullMemberType,
      isFullTimeEducation,
      null
    );

    // Build the new row by column name so the workflow columns (Status, Fee Due)
    // land correctly regardless of their physical position in the sheet.
    const appColMap = await getColumnMap('Applications');

    // Map normalized column name -> value for every field we want to write
    const fieldValues: { [key: string]: any } = {
      first_name: data.firstName?.trim() || '',
      last_name: data.lastName?.trim() || '',
      known_as: data.knownAs?.trim() || '',
      gender: data.gender || '',
      email_address: data.email?.trim() || '',
      landline: data.landline?.trim() || '',
      mobile: data.mobile?.trim() || '',
      address_1: data.address1?.trim() || '',
      address_2: data.address2?.trim() || '',
      address_3: data.address3?.trim() || '',
      post_code: data.postCode?.trim() || '',
      age_demographic: data.ageDemographic || '',
      dob: data.dob || '',
      ft_education: data.ftEducation || '',
      member_type: data.memberType || '',
      previous_experience: data.previousExperience?.trim() || '',
      disabilities: data.disabilities?.trim() || '',
      proposer_name: data.proposerName?.trim() || '',
      seconder_name: data.seconderName?.trim() || '',
      comments: data.comments?.trim() || '',
      created_at: createdAt,
      // Workflow columns set at submission time
      status: 'Submitted',
      fee_due: feeDue,
    };

    // Determine how wide the row needs to be (highest mapped column index)
    let maxIndex = 0;
    for (const index of Object.values(appColMap)) {
      if (index > maxIndex) {
        maxIndex = index;
      }
    }

    // Start with a fully blank row so the append has no undefined holes, then
    // place each value at its mapped column index
    const rowData: any[] = [];
    for (let i = 0; i <= maxIndex; i++) {
      rowData[i] = '';
    }
    for (const [columnName, value] of Object.entries(fieldValues)) {
      const colIndex = appColMap[columnName];
      if (colIndex !== undefined) {
        rowData[colIndex] = value;
      }
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Applications!A:ZZ',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowData],
      },
    });

    console.log(`[Apply] Application saved for ${data.firstName} ${data.lastName}`);

    // Update rate limit tracker
    submissionTimes.set(ip, now);

    // Send confirmation email
    if (isEmailConfigured()) {
      try {
        // Download PDF from Google Drive
        let pdfBuffer: Buffer | null = null;
        try {
          const pdfResponse = await fetch(PDF_URL);
          if (pdfResponse.ok) {
            const arrayBuffer = await pdfResponse.arrayBuffer();
            pdfBuffer = Buffer.from(arrayBuffer);
          } else {
            console.warn('[Apply] Could not download PDF attachment');
          }
        } catch (pdfErr) {
          console.warn('[Apply] Error downloading PDF:', pdfErr);
        }

        // Load and render email template
        const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'application-confirmation.html');
        const templateSource = readFileSync(templatePath, 'utf-8');
        const template = Handlebars.compile(templateSource);

        const genderDisplay = data.gender === 'M' ? 'Male' : 'Female';
        const ftEducationDisplay = data.ftEducation === 'Y' ? 'Yes' : data.ftEducation === 'N' ? 'No' : '';

        const emailVariables = {
          firstName: data.firstName,
          lastName: data.lastName,
          knownAs: data.knownAs || '',
          gender: genderDisplay,
          email: data.email,
          landline: data.landline || '',
          mobile: data.mobile,
          address1: data.address1 || '',
          address2: data.address2 || '',
          address3: data.address3 || '',
          postCode: data.postCode || '',
          ageDemographic: data.ageDemographic,
          dob: data.dob || '',
          ftEducation: ftEducationDisplay,
          memberType: data.memberType,
          previousExperience: data.previousExperience || '',
          disabilities: data.disabilities || '',
          proposerName: data.proposerName || '',
          seconderName: data.seconderName || '',
          comments: data.comments || '',
          showDob: data.ageDemographic === 'U18',
          showFtEducation: data.ageDemographic === '18-24',
        };

        const htmlContent = template(emailVariables);
        const processedHtml = processEmailTemplate(htmlContent);

        // Prepare attachments
        const attachments: Array<{ filename: string; content: Buffer }> = [];
        if (pdfBuffer) {
          attachments.push({
            filename: PDF_FILENAME,
            content: pdfBuffer,
          });
        }

        // Get transporter for sending emails
        const transporter = getEmailTransporter();

        // Convert HTML to plain text
        let textContent = htmlContent
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/div>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\n\s*\n\s*\n/g, '\n\n')
          .trim();

        // Send confirmation email to applicant (with PDF attachment)
        const applicantMailOptions: any = {
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: data.email,
          subject: 'Burgess Hill Bowls Club - Membership Application Received',
          text: textContent,
          html: processedHtml,
          attachments,
        };

        await transporter.sendMail(applicantMailOptions);
        console.log(`[Apply] Confirmation email sent to ${data.email}`);

        // Send notification email to club (without PDF attachment)
        const clubMailOptions: any = {
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: BCC_EMAIL,
          subject: `New Membership Application - ${data.firstName} ${data.lastName}`,
          text: textContent,
          html: processedHtml,
          // No attachments for club notification
        };

        await transporter.sendMail(clubMailOptions);
        console.log(`[Apply] Notification email sent to ${BCC_EMAIL}`);

      } catch (emailErr) {
        // Log email error but don't fail the application
        console.error('[Apply] Error sending confirmation email:', emailErr);
      }
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[Apply] Error processing application:', error);
    return NextResponse.json(
      { error: 'Failed to submit application. Please try again.' },
      { status: 500 }
    );
  }
}
