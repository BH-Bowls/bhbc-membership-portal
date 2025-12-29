# Renewal Email Feature Specification

**Version:** 1.0
**Date:** 2025-12-27
**Feature:** Admin Renewal Email Sender with PDF Attachments

---

## 1. Overview

This feature allows administrators to send renewal reminder emails to club members. The system will:
- Send templated emails with dynamic variables (member-specific information)
- Optionally attach up to 2 PDF documents converted from DOCX templates
- Track email send status in Google Sheets
- Provide real-time progress feedback
- Handle failures gracefully and continue processing

**Coding Standards:** All code must follow `specs/CODING_STANDARDS.md`

---

## 2. Requirements Summary

### Functional Requirements
- **FR-1:** Admin can trigger renewal email send from admin interface
- **FR-2:** System sends emails only to members with `include = "Y"` in Members sheet
- **FR-3:** System converts DOCX template documents to PDF with member-specific data
- **FR-4:** Admin can optionally include/exclude PDF attachments
- **FR-5:** System tracks email send status in Members sheet
- **FR-6:** System shows real-time progress during send operation
- **FR-7:** System reports summary of successes/failures at completion

### Non-Functional Requirements
- **NFR-1:** Must handle PDF conversion before sending each email (avoid timing issues)
- **NFR-2:** Must continue processing even if individual emails fail
- **NFR-3:** Must use existing Gmail SMTP infrastructure
- **NFR-4:** Must follow coding standards (explicit code, comprehensive comments)

---

## 3. Technical Architecture

### 3.1 Technology Stack
- **Email Service:** Gmail SMTP (existing via Nodemailer)
- **Template Engine:** Handlebars (existing)
- **DOCX Processing:** `mammoth` or `docx-templates` library
- **PDF Generation:** `puppeteer` or `html-pdf-node` library
- **Frontend:** React with Next.js App Router
- **Backend:** Next.js API Routes

### 3.2 Libraries to Install
```bash
npm install docx-templates
npm install puppeteer
# or alternatively:
# npm install mammoth html-pdf-node
```

---

## 4. Data Model Changes

### 4.1 Members Sheet - New Columns

Add two new columns to the `Members` sheet in Google Sheets:

| Column Name | Type | Values | Description |
|------------|------|--------|-------------|
| `include` | Text | "Y" or "N" | Controls which members receive renewal emails |
| `renewal_email_sent_status` | Text | Free text | Tracks email send status and date |

**Column Position:**
- No fixed position required - columns can be added anywhere in the sheet
- System uses `getColumnMap()` to dynamically discover column positions
- Column headers must match exactly: `include` and `renewal_email_sent_status`

**Status Column Format:**
- Success: `"Success. Email sent 27/12/2024"`
- Failure: `"Error: [error message]"`
- Not sent: Empty or `""`

**Column Mapping:**
- Columns are discovered dynamically via `getColumnMap()` function
- Update Member type definition to include these fields
- No code changes needed when column positions change in sheet

---

## 5. File Structure

### 5.1 Existing Template Structure (User-Created)

```
src/lib/email/templates/Member Emails/
├── Email Templates/
│   └── Renewal - Email template.txt          # Email template with <<variables>>
└── Attachment Templates/
    ├── Renewal - Competition entry form.docx  # DOCX template with <<variables>>
    └── Renewal - Membership Details Form.docx # DOCX template with <<variables>>
```

**Template Format:**
- Email templates use `.txt` format with HTML markup
- Subject line is first line of email template: `Subject: <subject text>`
- Variables are marked with `<<variable name>>`
- System will convert `<<>>` to `{{}}` for Handlebars processing

**Dynamic Discovery:**
- System scans `Email Templates/` folder for all `.txt` files
- System scans `Attachment Templates/` folder for all `.docx` files
- No hardcoded template names - supports any number of templates

### 5.2 New Files to Create

```
src/lib/email/
├── renewal-mailer.ts                 # Renewal email sending logic
├── pdf-generator.ts                  # DOCX to PDF conversion logic ✅ (Phase 1 Complete)
└── template-loader.ts                # Dynamic template discovery and loading ✅ (Phase 1 Complete)

app/admin/emails/
└── renewals/
    └── page.tsx                       # Admin UI for sending renewal emails

app/api/admin/emails/
└── send-renewals/
    └── route.ts                       # API endpoint to trigger renewal email send
```

**Note:** This creates a scalable `/admin/emails` module that can support:
- `/admin/emails/renewals` - Renewal reminder emails (current)
- `/admin/emails/friendlies` - Friendlies notifications (future)
- `/admin/emails/general` - General announcements (future)

### 5.3 Files to Modify

```
src/lib/sheets.ts                     # Add new column mappings ✅ (Phase 1 Complete)
middleware.ts                         # Add /admin/emails to protected routes
```

---

## 6. Template Variable System

### 6.1 Variable Format Conversion

**Source Format:** `<<variable name>>`
**Target Format:** `{{variable name}}`

**Examples:**
- `<<Full Known as>>` → `{{fullKnownAs}}`
- `<<userName>>` → `{{userName}}`
- `<<outstanding>>` → `{{outstanding}}`

**Conversion Rules:**
- Remove angle brackets `<<` and `>>`
- Add curly braces `{{` and `}}`
- Convert spaces to camelCase (e.g., "Full Known as" → "fullKnownAs")
- Preserve case for variables without spaces

### 6.2 Available Variables

All templates (email and DOCX) support these variables:

| Variable Template | Handlebars Variable | Source | Example Value |
|-------------------|---------------------|--------|---------------|
| `<<userName>>` | `{{userName}}` | Members sheet | `"john_smith"` |
| `<<Full Known as>>` | `{{fullKnownAs}}` | Members sheet | `"John Smith"` |
| `<<firstName>>` | `{{firstName}}` | Members sheet | `"John"` |
| `<<lastName>>` | `{{lastName}}` | Members sheet | `"Smith"` |
| `<<emailAddress>>` | `{{emailAddress}}` | Members sheet | `"john@example.com"` |
| `<<title>>` | `{{title}}` | Members sheet | `"Mr"` |
| `<<outstanding>>` | `{{outstanding}}` | Renewals sheet | `"45.00"` |
| `<<totalPayment>>` | `{{totalPayment}}` | Renewals sheet | `"125.00"` |
| `<<memberType>>` | `{{memberType}}` | Members sheet | `"Full"` |
| `<<currentDate>>` | `{{currentDate}}` | System | `"27/12/2024"` |
| `<<renewalYear>>` | `{{renewalYear}}` | System | `"2026"` |

### 6.3 Template Processing Flow

1. **Discover Templates:**
   - Scan `Email Templates/` folder for `.txt` files
   - Scan `Attachment Templates/` folder for `.docx` files
   - Load first email template found (or specific one if multiple)

2. **Email Template Processing:**
   - Read `.txt` file
   - Extract subject from first line (format: `Subject: <text>`)
   - Remove subject line from body
   - Convert `<<variables>>` to `{{variables}}`
   - Use Handlebars to replace variables with member data
   - Generate both HTML and plain text versions

3. **DOCX Template Processing:**
   - For each `.docx` file in `Attachment Templates/`:
     - Read DOCX file
     - Convert `<<variables>>` to `{{variables}}`
     - Use `docx-templates` to replace variables
     - Convert to HTML (intermediate step)
     - Use Puppeteer to convert HTML to PDF
     - Create attachment with filename: `{originalFilename}_{userName}.pdf`
     - **IMPORTANT:** Wait for each PDF to complete before starting next one

---

## 7. API Design

### 7.1 Send Renewal Emails Endpoint

**Endpoint:** `POST /api/admin/emails/send-renewals`

**Authorization:** Admin only (check `session?.user?.role === 'Admin'`)

**Request Body:**
```typescript
{
  includeAttachments: boolean  // true = attach PDFs, false = email only
}
```

**Response (Streaming):**
```typescript
// Server-Sent Events (SSE) stream for real-time progress
data: {"type": "progress", "current": 1, "total": 45, "userName": "john_smith"}
data: {"type": "success", "userName": "john_smith"}
data: {"type": "error", "userName": "jane_doe", "error": "Invalid email address"}
data: {"type": "complete", "sent": 45, "succeeded": 43, "failed": 2}
```

**Algorithm:**
1. Verify admin authorization
2. Fetch all members where `include = "Y"`
3. For each member:
   - If `includeAttachments = true`:
     - Generate PDF from template 1 (wait for completion)
     - Generate PDF from template 2 (wait for completion)
   - Load member data from Members and Renewals sheets
   - Build variable object
   - Send email with/without attachments
   - Update `renewal_email_sent_status` column
   - Send progress event to client
4. Send completion summary

---

## 8. UI Design

### 8.1 Page Location
`/admin/emails/renewals`

**Navigation Path:** Admin → Emails → Renewal Reminders

**Future Expansion:**
- `/admin/emails/renewals` - Renewal reminder emails
- `/admin/emails/friendlies` - Friendlies match notifications
- `/admin/emails/general` - General member announcements

### 8.2 UI Components

**Header Section:**
```
┌─────────────────────────────────────────┐
│ Send Renewal Reminder Emails            │
│                                          │
│ This will send emails to all members    │
│ with "Include" set to "Y" in the        │
│ Members sheet.                           │
└─────────────────────────────────────────┘
```

**Options Section:**
```
┌─────────────────────────────────────────┐
│ ☐ Include PDF attachments               │
│   (Renewal documents will be attached   │
│    as PDFs if checked)                   │
└─────────────────────────────────────────┘
```

**Action Button:**
```
┌─────────────────────────────────────────┐
│ [Send Renewal Emails]                   │
└─────────────────────────────────────────┘
```

**Progress Display (shown after clicking button):**
```
┌─────────────────────────────────────────┐
│ Sending Emails...                        │
│                                          │
│ Progress: 12 / 45                        │
│                                          │
│ ✓ john_smith - Success                  │
│ ✓ jane_doe - Success                    │
│ ✗ bob_jones - Error: Invalid email     │
│ ✓ alice_wong - Success                  │
│ ...                                      │
└─────────────────────────────────────────┘
```

**Completion Summary:**
```
┌─────────────────────────────────────────┐
│ ✓ Email Send Complete                   │
│                                          │
│ 45 emails sent                           │
│ 43 succeeded                             │
│ 2 failed                                 │
│                                          │
│ [Close]                                  │
└─────────────────────────────────────────┘
```

### 8.3 Confirmation Dialog

Before sending, show confirmation:
```
┌─────────────────────────────────────────┐
│ Send Renewal Emails?                    │
│                                          │
│ This will send emails to members with   │
│ "Include" = "Y" in the Members sheet.   │
│                                          │
│ Attachments: Yes / No                   │
│                                          │
│ This action cannot be undone.           │
│                                          │
│ [Cancel]              [Send Emails]     │
└─────────────────────────────────────────┘
```

---

## 9. Implementation Details

### 9.1 Email Sending Logic (`src/lib/email/renewal-mailer.ts`)

**Function:** `sendRenewalEmail(member, includeAttachments)`

**Algorithm:**
```
1. Fetch member data from Members sheet
2. Fetch renewal data from Renewals sheet for this member
3. Build variables object from member + renewal data
4. Add system variables (currentDate, renewalYear)
5. IF includeAttachments is true:
   a. Discover all DOCX templates in Attachment Templates/ folder
   b. FOR EACH DOCX template:
      - Generate PDF with variables
      - WAIT for PDF generation to complete before proceeding
      - Add PDF to attachments array
   c. End loop when all PDFs generated
6. Load email template from Email Templates/ folder
7. Extract subject from first line
8. Convert <<variables>> to {{variables}} in template
9. Send email via nodemailer with/without attachments
10. IF success:
    a. Update status = "Success. Email sent DD/MM/YYYY"
    b. Return { success: true }
11. IF error:
    a. Update status = "Error: [error message]"
    b. Return { success: false, error: message }
```

**Key Points:**
- Must wait for each PDF to complete before starting next one
- Use `async/await` with sequential processing (NOT parallel)
- Do NOT use `Promise.all()` for PDF generation (causes timing issues)
- Support any number of attachment templates dynamically

### 9.2 Template Discovery (`src/lib/email/template-loader.ts`)

**Function:** `discoverEmailTemplates()`

**Algorithm:**
```
1. Scan Email Templates/ folder for .txt files
2. Return array of template file paths
3. If no templates found, throw error
```

**Function:** `discoverAttachmentTemplates()`

**Algorithm:**
```
1. Scan Attachment Templates/ folder for .docx files
2. Return array of template file paths
3. Return empty array if no templates found (attachments optional)
```

**Function:** `loadEmailTemplate(templatePath)`

**Algorithm:**
```
1. Read .txt file contents
2. Split into lines
3. Extract subject from first line (format: "Subject: <text>")
4. Remove subject line from body
5. Join remaining lines as email body
6. Convert <<variables>> to {{variables}} using regex
7. Return { subject, body }
```

**Function:** `convertVariableFormat(content)`

**Algorithm:**
```
1. Use regex to find all <<variable name>> patterns
2. For each match:
   a. Extract variable name between << and >>
   b. Convert to camelCase if contains spaces
   c. Replace with {{variableName}}
3. Return converted content
```

**Regex Pattern:**
```typescript
const pattern = /<<([^>]+)>>/g;
```

**CamelCase Conversion:**
```typescript
// "Full Known as" → "fullKnownAs"
// "userName" → "userName" (no change)
function toCamelCase(str: string): string {
  // Split by spaces
  const words = str.trim().split(/\s+/);

  // First word lowercase
  let result = words[0].toLowerCase();

  // Capitalize first letter of subsequent words
  for (let i = 1; i < words.length; i++) {
    result += words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase();
  }

  return result;
}
```

### 9.3 PDF Generation (`src/lib/email/pdf-generator.ts`)

**Function:** `generatePdfFromDocx(templatePath, variables, baseFileName)`

**Algorithm:**
```
1. Read DOCX template file from Attachment Templates/ folder
2. Convert <<variables>> to {{variables}} in DOCX
3. Use docx-templates library to replace {{variables}} with member data
4. Convert DOCX to HTML (intermediate step using mammoth)
5. Use Puppeteer to convert HTML to PDF buffer
6. Return PDF as Buffer for email attachment
7. Log any errors for debugging
```

**Libraries:**
```typescript
import * as fs from 'fs';
import { createReport } from 'docx-templates';
import mammoth from 'mammoth';
import puppeteer from 'puppeteer';
```

**Important:**
- Each PDF generation is async and must complete before next step
- Return Buffer (not file path) for direct email attachment
- Handle errors gracefully (missing template, variable errors)
- Filename format: `{baseFileName}_{userName}.pdf`

### 9.4 Members Sheet Updates

**Function:** `updateRenewalEmailStatus(userName, status)`

**Algorithm:**
```
1. Get column map for Members sheet
2. Find row for this userName
3. Update renewal_email_sent_status column with status text
4. Use batch update for efficiency
5. Log success/failure
```

**Status Format:**
- Success: `"Success. Email sent 27/12/2024"` (use current date in DD/MM/YYYY)
- Error: `"Error: [specific error message]"`

---

## 10. Error Handling Strategy

### 10.1 Error Types and Responses

| Error Type | Handling | User Feedback | Status Column |
|------------|----------|---------------|---------------|
| Invalid email address | Skip member, continue | Show in progress list | "Error: Invalid email address" |
| PDF generation fails | Skip attachments, send email only | Show warning | "Success (no attachments). Email sent DD/MM/YYYY" |
| Email send fails | Skip member, continue | Show in progress list | "Error: Failed to send email" |
| Member not found | Skip, continue | Show in progress list | "Error: Member not found" |
| SMTP error | Skip member, continue | Show in progress list | "Error: SMTP error" |

### 10.2 Recovery Actions

**For Individual Email Failures:**
- Log error details to console
- Update status column with error
- Continue to next member
- Increment failure counter

**For Complete Failures:**
- Show error message to admin
- Display partial results if any succeeded
- Don't update status columns for unsent emails

---

## 11. Testing Approach

### 11.1 Test Data Setup

**Members Sheet - Test Records:**
Create test members with:
- `include = "Y"` (3 test members)
- `include = "N"` (2 test members)
- Various email addresses (valid and invalid)
- Different member types and outstanding balances

### 11.2 Test Scenarios

1. **Happy Path:**
   - Send emails without attachments
   - Verify all 3 "Y" members receive emails
   - Verify status columns updated correctly
   - Verify "N" members do NOT receive emails

2. **With Attachments:**
   - Send emails with PDF attachments
   - Verify PDFs are generated correctly
   - Verify PDFs contain correct member data
   - Verify attachments are included in emails

3. **Error Handling:**
   - Member with invalid email address
   - Member with missing renewal data
   - Verify system continues after errors
   - Verify status columns show errors

4. **Progress Updates:**
   - Verify real-time progress displays correctly
   - Verify completion summary shows accurate counts

5. **Authorization:**
   - Verify non-admin users cannot access page
   - Verify API endpoint rejects non-admin requests

---

## 12. Implementation Phases

### Phase 1: Data Model & Templates
**Files:**
- Modify `src/lib/sheets.ts` (add column mappings)
- Create email template from user-supplied text
- Add DOCX templates to specs/documents/

**Tasks:**
1. Add `include` and `renewal_email_sent_status` columns to Members sheet
2. Convert user's .txt email template to HTML
3. Save DOCX templates to specs/documents/
4. Update Member type definition
5. Update getColumnMap() function

### Phase 2: PDF Generation
**Files:**
- Create `src/lib/email/pdf-generator.ts`

**Tasks:**
1. Install docx-templates and puppeteer
2. Implement generatePdfFromDocx() function
3. Test with sample data
4. Verify variable substitution works correctly

### Phase 3: Email Logic
**Files:**
- Create `src/lib/email/renewal-mailer.ts`

**Tasks:**
1. Implement sendRenewalEmail() function
2. Implement updateRenewalEmailStatus() function
3. Test email sending without attachments
4. Test email sending with attachments
5. Verify status updates work correctly

### Phase 4: API Endpoint
**Files:**
- Create `app/api/admin/renewals/send-emails/route.ts`

**Tasks:**
1. Implement POST handler with admin authorization
2. Implement Server-Sent Events for progress
3. Implement batch email sending logic
4. Test with 2-3 test members
5. Verify error handling

### Phase 5: Admin UI
**Files:**
- Create `app/admin/renewals/email/page.tsx`
- Update `middleware.ts`

**Tasks:**
1. Create page component with form
2. Implement confirmation dialog
3. Implement progress display
4. Implement completion summary
5. Add route protection in middleware
6. Test end-to-end flow

### Phase 6: Testing & Refinement
**Tasks:**
1. Test with full dataset (all members with include="Y")
2. Verify PDF generation performance
3. Verify no timing issues with sequential PDF generation
4. Test error scenarios
5. Verify status column updates are accurate

---

## 13. Code Style Requirements

**All code must follow `specs/CODING_STANDARDS.md`:**

### Required Standards:
- ✅ Every file has header comment with path and description
- ✅ Every function has comment explaining what it does
- ✅ Every loop has comment explaining what it's iterating
- ✅ Every API call has comment explaining what data it fetches/updates
- ✅ Every if statement (complex logic) has comment explaining condition
- ✅ Avoid optional chaining (`?.`) - use explicit if checks
- ✅ Avoid nullish coalescing (`??`) - use explicit fallbacks
- ✅ Simple `.map()` for arrays is OK
- ✅ Complex object creation uses for loops with comments
- ✅ All Google Sheets operations include context (row numbers, column letters)
- ✅ All error handling explains what errors mean

### Example Code Structure:

```typescript
// src/lib/email/renewal-mailer.ts
// Renewal email sending logic with PDF attachment support

/**
 * Send renewal reminder email to a member
 * Generates PDFs from DOCX templates if attachments are requested
 * Updates Members sheet with send status
 */
export async function sendRenewalEmail(
  userName: string,
  includeAttachments: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    // Fetch member data from Members sheet
    const member = await getMemberByUserName(userName);

    // Check if member exists
    if (!member) {
      return { success: false, error: 'Member not found' };
    }

    // Fetch renewal data from Renewals sheet
    const renewal = await getRenewalByUserName(userName);

    // Build variables object for template
    const variables = {
      userName: member.userName,
      fullKnownAs: member.fullKnownAs,
      firstName: member.firstName,
      // ... more variables
    };

    // Generate PDF attachments if requested
    let attachments = [];
    if (includeAttachments) {
      // Generate first PDF from template 1
      // IMPORTANT: Wait for completion before proceeding
      const pdf1 = await generatePdfFromDocx('renewal_template_1', variables, `renewal_${userName}_1.pdf`);

      // Generate second PDF from template 2
      // IMPORTANT: Wait for completion before proceeding
      const pdf2 = await generatePdfFromDocx('renewal_template_2', variables, `renewal_${userName}_2.pdf`);

      // Build attachments array for email
      attachments = [
        { filename: `renewal_${userName}_1.pdf`, content: pdf1 },
        { filename: `renewal_${userName}_2.pdf`, content: pdf2 },
      ];
    }

    // Send email with template and optional attachments
    const result = await sendTemplateEmailWithAttachments(
      member.emailAddress,
      'Renewal Reminder',
      'renewal-reminder',
      variables,
      attachments
    );

    // Update status column based on result
    if (result.success) {
      // Format current date as DD/MM/YYYY
      const now = new Date();
      const dateStr = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

      // Update status to success with date
      await updateRenewalEmailStatus(userName, `Success. Email sent ${dateStr}`);

      return { success: true };
    } else {
      // Update status to error with message
      await updateRenewalEmailStatus(userName, `Error: ${result.error}`);

      return { success: false, error: result.error };
    }
  } catch (error) {
    // Log error for debugging
    console.error(`Error sending renewal email to ${userName}:`, error);

    // Update status column with error
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await updateRenewalEmailStatus(userName, `Error: ${errorMsg}`);

    return { success: false, error: errorMsg };
  }
}
```

---

## 14. Security Considerations

1. **Authorization:**
   - Only Admin role can access `/admin/renewals/email`
   - API endpoint verifies Admin role on every request
   - Middleware protects admin routes

2. **Email Validation:**
   - Verify email addresses are valid before sending
   - Skip invalid emails rather than failing entire batch

3. **Template Injection:**
   - Use Handlebars auto-escaping for HTML
   - Sanitize member data before template substitution

4. **Rate Limiting:**
   - Consider adding delay between emails if sending to many members
   - Gmail SMTP has sending limits (500/day for standard accounts)

---

## 15. User-Supplied Assets (COMPLETED)

User has already provided all required assets:

1. **Email Template:** ✅
   - Location: `src/lib/email/templates/Member Emails/Email Templates/Renewal - Email template.txt`
   - Format: Text with HTML markup
   - Subject: "Burgess Hill Bowls Club - Membership Renewal"
   - Variables: `<<Full Known as>>`

2. **DOCX Templates:** ✅
   - Template 1: `Renewal - Competition entry form.docx`
   - Template 2: `Renewal - Membership Details Form.docx`
   - Location: `src/lib/email/templates/Member Emails/Attachment Templates/`
   - Variables: Marked with `<<variable name>>`

**Next Step:** Implementation begins with Phase 1 (Data Model & Template Conversion).

---

## 16. Success Criteria

The feature is complete when:

- ✅ Admin can navigate to `/admin/renewals/email`
- ✅ Admin sees confirmation dialog before sending
- ✅ System sends emails only to members with `include = "Y"`
- ✅ System generates PDFs with correct member data when attachments enabled
- ✅ System updates `renewal_email_sent_status` column for each member
- ✅ Admin sees real-time progress during send operation
- ✅ Admin sees completion summary with success/failure counts
- ✅ Failed emails don't stop the batch process
- ✅ All code follows `specs/CODING_STANDARDS.md`
- ✅ Non-admin users cannot access the feature
- ✅ Email template uses Handlebars variables correctly
- ✅ PDF attachments contain correct member-specific data

---

## 17. Implementation Summary

**All prerequisites are met:**
- ✅ Email template provided with subject and variables
- ✅ 2 DOCX attachment templates provided
- ✅ Dynamic folder structure in place
- ✅ Variable format defined (`<<>>` → `{{}}`)
- ✅ Column mapping approach defined (dynamic via getColumnMap)

**Ready to begin implementation with Phase 1.**
