// src/lib/email/application-mailer.ts
// Email helpers for the membership application workflow.
// Sends the payment-request email (when an application is approved or a resend is
// requested) and the welcome / credentials email (when an application is converted
// into a member). Both use the shared sendTemplateEmail helper.

import { sendTemplateEmail } from './mailer';
import type { Application } from '../applications-sheets';

// Club inbox copied on the payment request and used as the applicant contact.
const CLUB_EMAIL = 'burgesshillbc@gmail.com';

/**
 * Resolve the public portal URL for login links in emails.
 * Prefers the explicit public app URL, then NEXTAUTH_URL, then a sensible default.
 *
 * @returns The portal base URL
 */
function getPortalUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  if (process.env.NEXTAUTH_URL) {
    return process.env.NEXTAUTH_URL;
  }
  return 'https://members.burgesshill-bowls.co.uk';
}

/**
 * Build the applicant's preferred first name for greetings.
 *
 * @param application The application
 * @returns Known-as name when present, otherwise the first name
 */
function getGreetingName(application: Application): string {
  if (application.knownAs) {
    return application.knownAs;
  }
  return application.firstName;
}

/**
 * Build a human-readable member type label (e.g. "Playing Lady", "Social Man")
 * from the gender and Playing/Social type on the application.
 *
 * @param application The application
 * @returns The full member type label, or the raw type if it cannot be resolved
 */
function getMemberTypeLabel(application: Application): string {
  if (application.memberType === 'Playing') {
    return application.gender === 'M' ? 'Playing Man' : 'Playing Lady';
  }
  if (application.memberType === 'Social') {
    return application.gender === 'M' ? 'Social Man' : 'Social Lady';
  }
  return application.memberType;
}

/**
 * Format a fee as a £XX.XX string.
 *
 * @param amount The fee amount in pounds
 * @returns Formatted currency string
 */
function formatFee(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

/**
 * Build the bank payment reference for an applicant, e.g. "SUBS DASEY SIMON".
 * Format is SUBS + surname + first name (known-as preferred), all uppercased, so
 * the treasurer can match the incoming payment to the person.
 *
 * @param application The application
 * @returns The payment reference string
 */
function buildPaymentReference(application: Application): string {
  const surname = application.lastName.toUpperCase();
  const firstPart = getGreetingName(application).toUpperCase();
  return `SUBS ${surname} ${firstPart}`.trim();
}

/**
 * Send the membership payment-request email to an applicant.
 * Copies the club inbox. Bank details are fixed in the template.
 *
 * @param application The approved application
 * @param feeAmount The fee the applicant should pay (after any manual pro-rata)
 * @returns Success flag with an error message on failure
 */
export async function sendApplicationPaymentEmail(
  application: Application,
  feeAmount: number
): Promise<{ success: boolean; error?: string }> {
  // Cannot send without an email address on the application
  if (!application.emailAddress) {
    return { success: false, error: 'No email address on the application' };
  }

  return sendTemplateEmail(
    application.emailAddress,
    'Burgess Hill Bowls Club — Membership Fee',
    'application-payment-request',
    {
      firstName: getGreetingName(application),
      feeAmount: formatFee(feeAmount),
      memberType: getMemberTypeLabel(application),
      paymentReference: buildPaymentReference(application),
      contactEmail: CLUB_EMAIL,
    },
    { cc: CLUB_EMAIL }
  );
}

/**
 * Send the welcome / credentials email to a newly converted member.
 * Sent to the applicant only (no CC). Includes the plain-text temporary password —
 * the only time it is sent in plain text.
 *
 * @param application The converted application
 * @param userName The new portal username
 * @param tempPassword The plain-text temporary password
 * @returns Success flag with an error message on failure
 */
export async function sendApplicationWelcomeEmail(
  application: Application,
  userName: string,
  tempPassword: string
): Promise<{ success: boolean; error?: string }> {
  // Cannot send without an email address on the application
  if (!application.emailAddress) {
    return { success: false, error: 'No email address on the application' };
  }

  return sendTemplateEmail(
    application.emailAddress,
    'Welcome to Burgess Hill Bowls Club — Your Portal Login',
    'application-welcome',
    {
      firstName: getGreetingName(application),
      userName,
      tempPassword,
      portalUrl: getPortalUrl(),
    }
  );
}
