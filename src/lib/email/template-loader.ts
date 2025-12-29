// src/lib/email/template-loader.ts
// Dynamic template discovery and variable format conversion for renewal emails

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Constants
// ============================================================================

// Base path for member email templates
const MEMBER_EMAILS_DIR = path.join(process.cwd(), 'src', 'lib', 'email', 'templates', 'Member Emails');

// Subfolder paths
const EMAIL_TEMPLATES_DIR = path.join(MEMBER_EMAILS_DIR, 'Email Templates');
const ATTACHMENT_TEMPLATES_DIR = path.join(MEMBER_EMAILS_DIR, 'Attachment Templates');

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Email template data extracted from .txt file
 */
export interface EmailTemplate {
  subject: string; // Email subject line
  body: string;    // Email body with {{variables}} format
  filePath: string; // Full path to template file
}

/**
 * Attachment template file information
 */
export interface AttachmentTemplate {
  filePath: string;   // Full path to .docx file
  fileName: string;   // Original filename without path
  baseFileName: string; // Filename without extension
}

// ============================================================================
// Variable Conversion Functions
// ============================================================================

/**
 * Convert variable name from template format to camelCase
 * Handles spaces and special characters in variable names
 *
 * Examples:
 * - "Full Known as" → "fullKnownAs"
 * - "Green / Clubhouse Maintenance" → "greenClubhouseMaintenance"
 * - "userName" → "userName" (no change)
 *
 * @param variableName Variable name from template (may contain spaces)
 * @returns camelCase version of variable name
 */
export function toCamelCase(variableName: string): string {
  // Trim whitespace from start and end
  let cleaned = variableName.trim();

  // Remove special characters like / and replace with space
  cleaned = cleaned.replace(/[\/]/g, ' ');

  // Split by one or more spaces
  const words = cleaned.split(/\s+/);

  // Build camelCase string
  // First word is lowercase
  let result = words[0].toLowerCase();

  // Loop through remaining words starting from index 1
  for (let i = 1; i < words.length; i++) {
    // Get current word
    const word = words[i];

    // Capitalize first letter and lowercase the rest
    const capitalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

    // Add to result
    result += capitalized;
  }

  return result;
}

/**
 * Convert template variable format from <<variable>> to {{variable}}
 * Also converts variable names to camelCase
 *
 * Examples:
 * - "<<Full Known as>>" → "{{fullKnownAs}}"
 * - "<<userName>>" → "{{userName}}"
 * - "<<Email Address>>" → "{{emailAddress}}"
 *
 * @param content Template content with <<variables>>
 * @returns Content with {{variables}} in camelCase
 */
export function convertVariableFormat(content: string): string {
  // Regular expression to find all <<variable>> patterns
  // Matches: << followed by one or more non-> characters, followed by >>
  const pattern = /<<([^>]+)>>/g;

  // Replace all matches using callback function
  const converted = content.replace(pattern, (match, variableName) => {
    // Convert variable name to camelCase
    const camelCased = toCamelCase(variableName);

    // Return in Handlebars format
    return `{{${camelCased}}}`;
  });

  return converted;
}

// ============================================================================
// Template Discovery Functions
// ============================================================================

/**
 * Discover all email template files in Email Templates folder
 * Scans for .txt files and returns their paths
 *
 * @returns Array of file paths to .txt email templates
 * @throws Error if Email Templates directory doesn't exist or no templates found
 */
export function discoverEmailTemplates(): string[] {
  // Check if Email Templates directory exists
  if (!fs.existsSync(EMAIL_TEMPLATES_DIR)) {
    throw new Error(`Email Templates directory not found: ${EMAIL_TEMPLATES_DIR}`);
  }

  // Read all files in Email Templates directory
  const files = fs.readdirSync(EMAIL_TEMPLATES_DIR);

  // Filter for .txt files only
  const txtFiles: string[] = [];
  for (const file of files) {
    // Check if file ends with .txt (case-insensitive)
    if (file.toLowerCase().endsWith('.txt')) {
      // Build full file path
      const filePath = path.join(EMAIL_TEMPLATES_DIR, file);

      // Add to results
      txtFiles.push(filePath);
    }
  }

  // Verify at least one template was found
  if (txtFiles.length === 0) {
    throw new Error(`No .txt email templates found in: ${EMAIL_TEMPLATES_DIR}`);
  }

  return txtFiles;
}

/**
 * Discover all attachment template files in Attachment Templates folder
 * Scans for .docx files and returns template information
 *
 * @returns Array of attachment template information
 */
export function discoverAttachmentTemplates(): AttachmentTemplate[] {
  // Check if Attachment Templates directory exists
  if (!fs.existsSync(ATTACHMENT_TEMPLATES_DIR)) {
    // Return empty array if directory doesn't exist (attachments are optional)
    return [];
  }

  // Read all files in Attachment Templates directory
  const files = fs.readdirSync(ATTACHMENT_TEMPLATES_DIR);

  // Filter for .docx files and build template info
  const templates: AttachmentTemplate[] = [];
  for (const file of files) {
    // Check if file ends with .docx (case-insensitive)
    if (file.toLowerCase().endsWith('.docx')) {
      // Build full file path
      const filePath = path.join(ATTACHMENT_TEMPLATES_DIR, file);

      // Extract base filename (without extension)
      const baseFileName = path.basename(file, path.extname(file));

      // Create template info object
      const template: AttachmentTemplate = {
        filePath,
        fileName: file,
        baseFileName,
      };

      // Add to results
      templates.push(template);
    }
  }

  return templates;
}

// ============================================================================
// Email Template Loading Functions
// ============================================================================

/**
 * Load email template from .txt file
 * Extracts subject from first line and converts variables to Handlebars format
 *
 * Template format:
 * - First line: "Subject: <subject text>"
 * - Remaining lines: Email body with <<variables>>
 *
 * @param templatePath Full path to .txt template file
 * @returns Email template with subject and body
 * @throws Error if template file not found or subject line missing
 */
export function loadEmailTemplate(templatePath: string): EmailTemplate {
  // Check if template file exists
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template file not found: ${templatePath}`);
  }

  // Read template file contents
  const content = fs.readFileSync(templatePath, 'utf-8');

  // Split content into lines
  const lines = content.split('\n');

  // Check if file has at least one line
  if (lines.length === 0) {
    throw new Error(`Email template is empty: ${templatePath}`);
  }

  // Extract subject from first line
  // Expected format: "Subject: <subject text>"
  const firstLine = lines[0].trim();

  // Check if first line starts with "Subject:"
  if (!firstLine.toLowerCase().startsWith('subject:')) {
    throw new Error(`Email template must start with "Subject:" line: ${templatePath}`);
  }

  // Extract subject text after "Subject:"
  const subject = firstLine.substring('subject:'.length).trim();

  // Get body content (all lines after first line)
  // Remove first line (subject) from array
  const bodyLines = lines.slice(1);

  // Join body lines back together
  const body = bodyLines.join('\n');

  // Convert <<variables>> to {{variables}} in body
  const convertedBody = convertVariableFormat(body);

  // Return email template object
  return {
    subject,
    body: convertedBody,
    filePath: templatePath,
  };
}

/**
 * Load the first email template found in Email Templates folder
 * Convenience function for when there's only one email template
 *
 * @returns Email template with subject and body
 * @throws Error if no templates found or template loading fails
 */
export function loadFirstEmailTemplate(): EmailTemplate {
  // Discover all email templates
  const templates = discoverEmailTemplates();

  // Load first template from array
  const template = loadEmailTemplate(templates[0]);

  return template;
}
