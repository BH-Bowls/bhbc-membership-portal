// src/lib/email/template-reader.ts
// Utility functions to read email and attachment templates from filesystem

import fs from 'fs';
import path from 'path';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Email template information
 */
export interface EmailTemplate {
  id: string;              // Filename without extension
  name: string;            // Display name (from filename)
  subject: string;         // Email subject (from HTML comment)
  filePath: string;        // Full path to template file
}

/**
 * Attachment template information
 */
export interface AttachmentTemplate {
  id: string;              // Filename without extension
  name: string;            // Display name (from filename)
  filePath: string;        // Full path to DOCX file
}

// ============================================================================
// Constants
// ============================================================================

// Base path for all member email templates
const MEMBER_EMAILS_PATH = path.join(process.cwd(), 'src', 'lib', 'email', 'templates', 'Member Emails');

// Path to email templates folder
const EMAIL_TEMPLATES_PATH = path.join(MEMBER_EMAILS_PATH, 'Email Templates');

// Path to attachment templates folder
const ATTACHMENT_TEMPLATES_PATH = path.join(MEMBER_EMAILS_PATH, 'Attachment Templates');

// ============================================================================
// Email Template Functions
// ============================================================================

/**
 * Get all available email templates
 * Reads HTML files from Email Templates folder
 * Extracts subject line from <!-- Subject: ... --> comment
 * @returns Array of email template information
 */
export function getEmailTemplates(): EmailTemplate[] {
  // Initialize results array
  const templates: EmailTemplate[] = [];

  // Check if email templates directory exists
  if (!fs.existsSync(EMAIL_TEMPLATES_PATH)) {
    console.error('Email templates directory not found:', EMAIL_TEMPLATES_PATH);
    return templates;
  }

  // Read all files from email templates directory
  const files = fs.readdirSync(EMAIL_TEMPLATES_PATH);

  // Loop through each file
  for (const file of files) {
    // Only process HTML files
    if (!file.endsWith('.html')) {
      continue;
    }

    // Get full path to file
    const filePath = path.join(EMAIL_TEMPLATES_PATH, file);

    // Get filename without extension for ID
    const id = file.replace('.html', '');

    // Get display name from filename (remove " - Email Template" suffix if present)
    let name = id.replace(' - Email Template', '');

    // Read file content to extract subject
    const content = fs.readFileSync(filePath, 'utf-8');

    // Extract subject from HTML comment <!-- Subject: ... -->
    const subjectMatch = content.match(/<!--\s*Subject:\s*(.+?)\s*-->/);
    const subject = subjectMatch ? subjectMatch[1] : name;

    // Add template to results
    templates.push({
      id,
      name,
      subject,
      filePath,
    });
  }

  // Sort templates by name
  templates.sort((a, b) => a.name.localeCompare(b.name));

  return templates;
}

/**
 * Get email template content by ID
 * Reads the HTML file and returns the content
 * @param templateId Template ID (filename without extension)
 * @returns HTML content of template, or null if not found
 */
export function getEmailTemplateContent(templateId: string): string | null {
  // Build file path
  const filePath = path.join(EMAIL_TEMPLATES_PATH, `${templateId}.html`);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error('Email template not found:', filePath);
    return null;
  }

  // Read and return file content
  const content = fs.readFileSync(filePath, 'utf-8');
  return content;
}

/**
 * Replace placeholders in email template with member data
 * Replaces {{Placeholder Name}} with actual values
 * @param template Email template HTML content
 * @param memberData Member data object with column names as keys
 * @returns Template with placeholders replaced
 */
export function replaceEmailPlaceholders(template: string, memberData: Record<string, any>): string {
  // Start with original template
  let result = template;

  // Loop through each field in member data
  for (const [key, value] of Object.entries(memberData)) {
    // Create regex to find {{Key}} placeholder (case-sensitive, with spaces)
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');

    // Replace all instances of this placeholder with actual value
    result = result.replace(placeholder, String(value || ''));
  }

  return result;
}

// ============================================================================
// Attachment Template Functions
// ============================================================================

/**
 * Get all available attachment templates
 * Reads DOCX files from Attachment Templates folder
 * @returns Array of attachment template information
 */
export function getAttachmentTemplates(): AttachmentTemplate[] {
  // Initialize results array
  const templates: AttachmentTemplate[] = [];

  // Check if attachment templates directory exists
  if (!fs.existsSync(ATTACHMENT_TEMPLATES_PATH)) {
    console.error('Attachment templates directory not found:', ATTACHMENT_TEMPLATES_PATH);
    return templates;
  }

  // Read all files from attachment templates directory
  const files = fs.readdirSync(ATTACHMENT_TEMPLATES_PATH);

  // Loop through each file
  for (const file of files) {
    // Only process DOCX files
    if (!file.endsWith('.docx')) {
      continue;
    }

    // Get full path to file
    const filePath = path.join(ATTACHMENT_TEMPLATES_PATH, file);

    // Get filename without extension for ID
    const id = file.replace('.docx', '');

    // Get display name from filename (clean up formatting)
    let name = id.replace('Renewal - ', '');

    // Add template to results
    templates.push({
      id,
      name,
      filePath,
    });
  }

  // Sort templates by name
  templates.sort((a, b) => a.name.localeCompare(b.name));

  return templates;
}

/**
 * Get attachment template file path by ID
 * @param templateId Template ID (filename without extension)
 * @returns Full path to DOCX file, or null if not found
 */
export function getAttachmentTemplatePath(templateId: string): string | null {
  // Build file path
  const filePath = path.join(ATTACHMENT_TEMPLATES_PATH, `${templateId}.docx`);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    console.error('Attachment template not found:', filePath);
    return null;
  }

  return filePath;
}

// ============================================================================
// Club Email Template Functions
// ============================================================================

// Path for club email templates
const CLUB_EMAIL_TEMPLATES_PATH = path.join(process.cwd(), 'src', 'lib', 'email', 'templates', 'Club Emails', 'Email Templates');

/**
 * Get all available club email templates
 * Reads HTML files from Club Emails/Email Templates folder
 */
export function getClubEmailTemplates(): EmailTemplate[] {
  const templates: EmailTemplate[] = [];

  if (!fs.existsSync(CLUB_EMAIL_TEMPLATES_PATH)) {
    return templates;
  }

  const files = fs.readdirSync(CLUB_EMAIL_TEMPLATES_PATH);

  for (const file of files) {
    if (!file.endsWith('.html')) continue;

    const filePath = path.join(CLUB_EMAIL_TEMPLATES_PATH, file);
    const id = file.replace('.html', '');
    const name = id;
    const content = fs.readFileSync(filePath, 'utf-8');
    const subjectMatch = content.match(/<!--\s*Subject:\s*(.+?)\s*-->/);
    const subject = subjectMatch ? subjectMatch[1] : name;

    templates.push({ id, name, subject, filePath });
  }

  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

/**
 * Get club email template content by ID
 */
export function getClubEmailTemplateContent(templateId: string): string | null {
  const filePath = path.join(CLUB_EMAIL_TEMPLATES_PATH, `${templateId}.html`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}
