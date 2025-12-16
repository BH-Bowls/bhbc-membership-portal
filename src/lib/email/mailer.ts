// src/lib/email/mailer.ts
// Centralized email utility for sending emails via SMTP

import nodemailer from 'nodemailer';
import { readFileSync } from 'fs';
import { join } from 'path';
import Handlebars from 'handlebars';

/**
 * Get configured email transporter
 */
export function getEmailTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

/**
 * Check if SMTP is configured
 */
export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

/**
 * Load email template from file and replace variables
 */
function loadTemplate(templateName: string, variables: Record<string, string | null | undefined>): string {
  try {
    const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', `${templateName}.html`);
    const templateSource = readFileSync(templatePath, 'utf-8');

    // Compile the Handlebars template
    const template = Handlebars.compile(templateSource);

    // Render the template with variables
    return template(variables);
  } catch (error) {
    console.error(`Error loading template ${templateName}:`, error);
    throw new Error(`Failed to load email template: ${templateName}`);
  }
}

/**
 * Convert HTML email to plain text (simple fallback)
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Send email using template
 */
export async function sendTemplateEmail(
  to: string,
  subject: string,
  templateName: string,
  variables: Record<string, string | null | undefined>
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return { success: false, error: 'Email service not configured' };
    }

    const transporter = getEmailTransporter();
    const htmlContent = loadTemplate(templateName, variables);
    const textContent = htmlToPlainText(htmlContent);

    await transporter.sendMail({
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });

    console.log(`✓ Email sent to ${to}: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}

/**
 * Send plain email (without template)
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isEmailConfigured()) {
      console.error('SMTP not configured');
      return { success: false, error: 'Email service not configured' };
    }

    const transporter = getEmailTransporter();

    await transporter.sendMail({
      from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html: html || text,
    });

    console.log(`✓ Email sent to ${to}: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error('Error sending email:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send email'
    };
  }
}
