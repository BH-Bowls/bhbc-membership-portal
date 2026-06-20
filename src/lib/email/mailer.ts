// src/lib/email/mailer.ts
// Centralized email utility for sending emails via SMTP

import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';
import { processEmailTemplate } from './template-processor';

/**
 * Get configured email transporter for sending emails
 * Creates a nodemailer SMTP transport using credentials from environment variables
 * Uses TLS on port 587 (standard submission port) for secure email transmission
 * @param usePool Whether to use connection pooling (default: false)
 * @returns Configured nodemailer transporter ready to send emails
 */
export function getEmailTransporter(usePool: boolean = false) {
  const config: any = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  };

  // Add pooling options for bulk operations
  if (usePool) {
    // Enable connection pooling for bulk operations
    // This reuses SMTP connections instead of creating new ones
    config.pool = true;
    // Maximum number of simultaneous connections (Gmail limit is 100)
    config.maxConnections = 1;  // Use single connection for sequential sends
    // Maximum number of messages per connection (unlimited)
    config.maxMessages = Infinity;
    // Keep connection alive between sends
    config.keepAlive = true;
  }

  return nodemailer.createTransport(config);
}

/**
 * Check if SMTP email service is configured
 * Verifies that both SMTP username and password are set in environment variables
 * Required before sending any emails to prevent authentication failures
 * @returns true if email is configured, false if missing credentials
 */
export function isEmailConfigured(): boolean {
  // Check if SMTP username is set
  if (!process.env.SMTP_USER) {
    return false;
  }

  // Check if SMTP password is set
  if (!process.env.SMTP_PASSWORD) {
    return false;
  }

  // Both credentials are present - email is configured
  return true;
}

/**
 * Load email template from file and replace variables using Handlebars
 * Reads HTML template file from src/lib/email/templates/ directory
 * Compiles template with Handlebars to support variable substitution and logic
 * Example: {{userName}} in template is replaced with variables.userName value
 * @param templateName Name of template file (without .html extension)
 * @param variables Object containing template variables to substitute
 * @returns Rendered HTML content with variables replaced
 * @throws Error if template file not found or compilation fails
 */
function loadTemplate(templateName: string, variables: Record<string, string | null | undefined>): string {
  try {
    const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', `${templateName}.html`);
    const templateSource = readFileSync(templatePath, 'utf-8');

    // Compile the Handlebars template
    const template = Handlebars.compile(templateSource);

    // Merge theme values into variables so Handlebars can process them
    // This prevents Handlebars from stripping the {{BRAND_NAME}} etc. placeholders
    const { theme } = require('@/config/theme');
    const allVariables = {
      ...variables,
      BRAND_NAME: theme.brand.name,
      BRAND_SHORT_NAME: theme.brand.shortName,
      HEADER_COLOR: theme.email.headerColor,
      BUTTON_COLOR: theme.email.buttonColor,
      LINK_COLOR: theme.email.buttonColor,
      PRIMARY_COLOR: theme.email.headerColor,
    };

    // Render the template with variables (including theme values)
    const rendered = template(allVariables);

    return rendered;
  } catch (error) {
    console.error(`Error loading template ${templateName}:`, error);
    throw new Error(`Failed to load email template: ${templateName}`);
  }
}

/**
 * Convert HTML email to plain text (simple fallback)
 * Strips HTML tags and converts common elements to plain text formatting
 * Used for email clients that don't support HTML
 * @param html The HTML content to convert
 * @returns Plain text version suitable for text-only email clients
 */
function htmlToPlainText(html: string): string {
  // Start with original HTML
  let text = html;

  // Convert line breaks to newlines
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // Convert paragraph ends to double newlines
  text = text.replace(/<\/p>/gi, '\n\n');

  // Convert div ends to newlines
  text = text.replace(/<\/div>/gi, '\n');

  // Convert list item ends to newlines
  text = text.replace(/<\/li>/gi, '\n');

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  // Non-breaking space to regular space
  text = text.replace(/&nbsp;/g, ' ');

  // Ampersand entity to &
  text = text.replace(/&amp;/g, '&');

  // Less-than entity to <
  text = text.replace(/&lt;/g, '<');

  // Greater-than entity to >
  text = text.replace(/&gt;/g, '>');

  // Quote entity to "
  text = text.replace(/&quot;/g, '"');

  // Clean up excessive newlines (3+ → 2)
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');

  // Remove leading/trailing whitespace
  text = text.trim();

  return text;
}

/**
 * Send email using Handlebars template
 * Loads HTML template from file, replaces variables, and sends via SMTP
 * Automatically generates plain text version from HTML for email client compatibility
 * Returns success/error status so caller can handle failures appropriately
 * @param to Recipient email address
 * @param subject Email subject line
 * @param templateName Name of template file (without .html extension)
 * @param variables Object containing template variables to substitute
 * @param options Optional extras — currently a `cc` address to copy in
 * @returns Promise with success status and error message if failed
 */
export async function sendTemplateEmail(
  to: string,
  subject: string,
  templateName: string,
  variables: Record<string, string | null | undefined>,
  options?: { cc?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify SMTP credentials are configured before attempting to send
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return { success: false, error: 'Email service not configured' };
    }

    // Get authenticated email transporter
    const transporter = getEmailTransporter();

    // Load template file and replace variables with actual values
    const htmlContent = loadTemplate(templateName, variables);

    // Convert HTML to plain text for non-HTML email clients
    const textContent = htmlToPlainText(htmlContent);

    // Send email with both HTML and plain text versions
    const mailOptions: any = {
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: textContent,
      html: htmlContent,
      // REMOVED custom headers temporarily to test if they're causing Gmail to drop emails
    };

    // Add a CC recipient when requested (e.g. copying the club inbox)
    if (options && options.cc) {
      mailOptions.cc = options.cc;
    }

    const info = await transporter.sendMail(mailOptions);

    // Log successful send for monitoring
    console.log(`✓ Email sent to ${to}: ${subject} [MessageId: ${info.messageId}]`);
    return { success: true };
  } catch (error) {
    // Log error details for debugging
    console.error('Error sending email:', error);

    // Return error message to caller
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}

export interface EmailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

/**
 * Send plain email without template
 * Sends email directly from provided content without loading from template file
 * Use this when content is generated programmatically or for simple notifications
 * For templated emails with variable substitution, use sendTemplateEmail instead
 * @param to Recipient email address
 * @param subject Email subject line
 * @param text Plain text version of email (required)
 * @param html Optional HTML version of email (falls back to text if not provided)
 * @param attachments Optional array of file attachments (e.g. .ics calendar files)
 * @returns Promise with success status and error message if failed
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string,
  attachments?: EmailAttachment[]
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify SMTP credentials are configured before attempting to send
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return { success: false, error: 'Email service not configured' };
    }

    // Get authenticated email transporter
    const transporter = getEmailTransporter();

    // Determine HTML content
    // If HTML version not provided, use plain text for both
    let htmlContent = html;
    if (!htmlContent) {
      htmlContent = text;
    }

    // Send email with both text and HTML versions
    const mailOptions: any = {
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html: htmlContent,
      // REMOVED custom headers temporarily to test if they're causing Gmail to drop emails
    };
    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments;
    }
    await transporter.sendMail(mailOptions);

    // Log successful send for monitoring
    console.log(`✓ Email sent to ${to}: ${subject}`);
    return { success: true };
  } catch (error) {
    // Log error details for debugging
    console.error('Error sending email:', error);

    // Return error message to caller
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}

/**
 * Send email with HTML content and optional file attachments
 * Sends email directly from provided HTML content with PDF or other file attachments
 * Use this for emails with generated content or file attachments like renewal PDFs
 *
 * @param to Recipient email address
 * @param subject Email subject line
 * @param htmlContent HTML content for email body
 * @param attachments Array of file attachments with filename and buffer
 * @param transporter Optional existing transporter (for connection pooling in bulk operations)
 * @returns Promise with success status and error message if failed
 */
export async function sendEmailWithAttachments(
  to: string,
  subject: string,
  htmlContent: string,
  attachments: Array<{ filename: string; content: Buffer }>,
  transporter?: any
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify SMTP credentials are configured before attempting to send
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return { success: false, error: 'Email service not configured' };
    }

    // Use provided transporter or create a new one
    const emailTransporter = transporter || getEmailTransporter();

    // Process theme placeholders in HTML content
    const processedHtml = processEmailTemplate(htmlContent);

    // Convert HTML to plain text for non-HTML email clients
    const textContent = htmlToPlainText(processedHtml);

    // Send email with both HTML and plain text versions plus attachments
    const mailOptions: any = {
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: textContent,
      html: processedHtml,
      attachments, // Array of {filename, content} objects
      // REMOVED custom headers temporarily to test if they're causing Gmail to drop emails
    };
    const info = await emailTransporter.sendMail(mailOptions);

    // Log successful send for monitoring
    console.log(`✓ Email sent to ${to}: ${subject} (${attachments.length} attachments) [MessageId: ${info.messageId}]`);
    return { success: true };
  } catch (error) {
    // Log error details for debugging
    console.error('Error sending email with attachments:', error);

    // Return error message to caller
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}
