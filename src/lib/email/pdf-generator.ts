// src/lib/email/pdf-generator.ts
// DOCX to PDF conversion with variable substitution for email attachments

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

// ============================================================================
// Constants
// ============================================================================

// LibreOffice executable path (adjust if needed)
const LIBREOFFICE_PATH = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * PDF generation result
 */
export interface PdfResult {
  buffer: Buffer;      // PDF file as buffer for email attachment
  fileName: string;    // Suggested filename for attachment
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert {{placeholder}} to {placeholder} in DOCX file
 *
 * DOCX files are ZIP archives containing XML files
 * We need to extract document.xml, replace double braces with single braces,
 * then re-pack the ZIP
 *
 * @param docxBuffer Original DOCX file as buffer
 * @returns Modified DOCX buffer with single-brace placeholders
 */
function convertDoubleBracesToSingle(docxBuffer: Buffer): Buffer {
  try {
    // Load DOCX as ZIP archive
    const zip = new PizZip(docxBuffer);

    // Get document.xml content (main document content)
    const documentXml = zip.file('word/document.xml')?.asText();
    if (!documentXml) {
      throw new Error('Could not find document.xml in DOCX file');
    }

    // Replace {{placeholder}} with {placeholder}
    // Use regex to find all {{...}} patterns and replace with {...}
    const modifiedXml = documentXml.replace(/\{\{([^}]+)\}\}/g, '{$1}');

    // Update document.xml in the ZIP
    zip.file('word/document.xml', modifiedXml);

    // Generate modified DOCX as buffer
    const modifiedBuffer = zip.generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    return modifiedBuffer;
  } catch (error) {
    console.error('[convertDoubleBracesToSingle] Error:', error);
    throw new Error(
      `Failed to convert placeholders: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Convert DOCX to PDF using LibreOffice
 *
 * Uses LibreOffice's headless mode to convert DOCX → PDF
 * This preserves ALL formatting including images, tables, layouts
 *
 * @param docxPath Full path to DOCX file
 * @param outputDir Directory to save PDF (same filename, .pdf extension)
 * @returns Full path to generated PDF file
 */
function convertDocxToPdfWithLibreOffice(docxPath: string, outputDir: string): string {
  try {
    // Verify DOCX file exists
    if (!fs.existsSync(docxPath)) {
      throw new Error(`DOCX file not found: ${docxPath}`);
    }

    // Verify output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Verify LibreOffice is installed
    if (!fs.existsSync(LIBREOFFICE_PATH)) {
      throw new Error(
        `LibreOffice not found at: ${LIBREOFFICE_PATH}. Please install LibreOffice.`
      );
    }

    // Build LibreOffice command
    // --headless: Run without GUI
    // --convert-to pdf: Convert to PDF format
    // --outdir: Output directory for PDF
    const command = `"${LIBREOFFICE_PATH}" --headless --convert-to pdf --outdir "${outputDir}" "${docxPath}"`;

    console.log(`[LibreOffice] Converting: ${path.basename(docxPath)}`);

    // Execute LibreOffice conversion
    // This is synchronous - wait for conversion to complete
    execSync(command, {
      stdio: 'pipe', // Suppress LibreOffice output
      timeout: 30000, // 30 second timeout
    });

    // Build expected PDF path
    // LibreOffice creates PDF with same name as DOCX but .pdf extension
    const docxFileName = path.basename(docxPath);
    const pdfFileName = docxFileName.replace(/\.docx$/i, '.pdf');
    const pdfPath = path.join(outputDir, pdfFileName);

    // Verify PDF was created
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`LibreOffice failed to create PDF: ${pdfPath}`);
    }

    console.log(`[LibreOffice] Created: ${pdfFileName}`);

    return pdfPath;
  } catch (error) {
    console.error('[convertDocxToPdfWithLibreOffice] Error:', error);
    throw new Error(
      `Failed to convert DOCX to PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// ============================================================================
// PDF Generation Functions
// ============================================================================

/**
 * Generate PDF from DOCX template with variable substitution
 *
 * Process:
 * 1. Read DOCX template file
 * 2. Convert {{placeholders}} to {placeholders} (docx-templates uses single braces)
 * 3. Replace {placeholders} with actual data using docx-templates
 * 4. Save filled DOCX to temp file
 * 5. Convert DOCX to PDF using LibreOffice (preserves all formatting)
 * 6. Read PDF as buffer
 * 7. Clean up temp files
 * 8. Return PDF buffer for email attachment
 *
 * @param templatePath Full path to .docx template file
 * @param variables Object containing variable values (keys match placeholder names)
 * @param baseFileName Base name for output file
 * @returns PDF buffer and suggested filename
 * @throws Error if template not found, variable substitution fails, or PDF generation fails
 */
export async function generatePdfFromDocx(
  templatePath: string,
  variables: Record<string, any>,
  baseFileName: string
): Promise<PdfResult> {
  // Create temp directory for intermediate files
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-pdf-'));

  let tempDocxPath: string | null = null;
  let tempPdfPath: string | null = null;

  try {
    // ========================================================================
    // Step 1: Read DOCX template
    // ========================================================================

    // Check if template file exists
    if (!fs.existsSync(templatePath)) {
      throw new Error(`DOCX template not found: ${templatePath}`);
    }

    console.log(`[generatePdfFromDocx] Processing: ${path.basename(templatePath)}`);

    // Read DOCX template file as buffer
    const templateBuffer = fs.readFileSync(templatePath);

    // ========================================================================
    // Step 2: Convert {{placeholders}} to {placeholders}
    // ========================================================================

    console.log(`[generatePdfFromDocx] Converting double braces to single braces`);

    // Convert {{Full Name}} → {Full Name}
    const modifiedTemplateBuffer = convertDoubleBracesToSingle(templateBuffer);

    // ========================================================================
    // Step 3: Replace placeholders with member data
    // ========================================================================

    console.log(`[generatePdfFromDocx] Replacing placeholders with data`);

    // Load modified DOCX with PizZip
    const zip = new PizZip(modifiedTemplateBuffer);

    // Create docxtemplater instance
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      // This option helps fix split tags caused by formatting
      nullGetter: function (part: any) {
        // Return empty string for undefined variables instead of throwing error
        if (!part.module) {
          return '';
        }
        if (part.module === 'rawxml') {
          return '';
        }
        return '';
      },
    });

    try {
      // Render the document with data (replace all placeholders)
      // Modern API: pass data directly to render() instead of setData()
      doc.render(variables);
    } catch (error) {
      // Log render errors with details
      console.error('[generatePdfFromDocx] Render error:', error);
      throw error;
    }

    // Generate the filled DOCX as buffer
    const filledDocxBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // ========================================================================
    // Step 4: Save filled DOCX to temp file
    // ========================================================================

    // Build temp DOCX filename
    const tempDocxFileName = `${baseFileName}_${Date.now()}.docx`;
    tempDocxPath = path.join(tempDir, tempDocxFileName);

    // Write filled DOCX to temp file
    fs.writeFileSync(tempDocxPath, filledDocxBuffer);

    console.log(`[generatePdfFromDocx] Saved temp DOCX: ${tempDocxFileName}`);

    // ========================================================================
    // Step 5: Convert DOCX to PDF using LibreOffice
    // ========================================================================

    console.log(`[generatePdfFromDocx] Converting to PDF with LibreOffice`);

    // Convert DOCX → PDF (preserves all formatting)
    tempPdfPath = convertDocxToPdfWithLibreOffice(tempDocxPath, tempDir);

    // ========================================================================
    // Step 6: Read PDF as buffer
    // ========================================================================

    // Read PDF file into buffer for email attachment
    const pdfBuffer = fs.readFileSync(tempPdfPath);

    console.log(`[generatePdfFromDocx] PDF ready: ${path.basename(tempPdfPath)}`);

    // ========================================================================
    // Step 7: Clean up temp files
    // ========================================================================

    // Delete temp DOCX file
    if (tempDocxPath && fs.existsSync(tempDocxPath)) {
      fs.unlinkSync(tempDocxPath);
    }

    // Delete temp PDF file
    if (tempPdfPath && fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath);
    }

    // Delete temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmdirSync(tempDir);
    }

    // ========================================================================
    // Step 8: Return PDF buffer
    // ========================================================================

    // Build suggested filename
    const userName = variables.userName || variables['User Name'] || 'member';
    const safeUserName = userName.replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `${baseFileName}_${safeUserName}.pdf`;

    return {
      buffer: pdfBuffer,
      fileName,
    };
  } catch (error) {
    // Clean up temp files on error
    try {
      if (tempDocxPath && fs.existsSync(tempDocxPath)) {
        fs.unlinkSync(tempDocxPath);
      }
      if (tempPdfPath && fs.existsSync(tempPdfPath)) {
        fs.unlinkSync(tempPdfPath);
      }
      if (fs.existsSync(tempDir)) {
        fs.rmdirSync(tempDir);
      }
    } catch (cleanupError) {
      console.error('[generatePdfFromDocx] Cleanup error:', cleanupError);
    }

    // Log error details for debugging
    console.error(`[generatePdfFromDocx] Failed to generate PDF from ${templatePath}:`, error);

    // Re-throw error with context
    throw new Error(
      `Failed to generate PDF from template: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Generate PDFs from all attachment templates
 *
 * Processes templates sequentially (NOT in parallel) to avoid timing issues
 * Each PDF generation must complete before starting the next one
 *
 * @param attachmentTemplates Array of attachment template information
 * @param variables Object containing variable values
 * @returns Array of PDF results (buffers and filenames)
 */
export async function generateAllPdfs(
  attachmentTemplates: Array<{ filePath: string; baseFileName: string }>,
  variables: Record<string, any>
): Promise<PdfResult[]> {
  // Array to collect generated PDFs
  const pdfs: PdfResult[] = [];

  // Loop through each template
  // IMPORTANT: Process sequentially, not in parallel
  for (const template of attachmentTemplates) {
    // Generate PDF from this template
    // WAIT for completion before proceeding to next template
    const pdf = await generatePdfFromDocx(
      template.filePath,
      variables,
      template.baseFileName
    );

    // Add to results array
    pdfs.push(pdf);

    // Log progress for monitoring
    console.log(`✓ Generated PDF: ${pdf.fileName}`);
  }

  return pdfs;
}
