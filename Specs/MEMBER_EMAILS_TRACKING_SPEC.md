# Member Emails Tracking System

## Overview

The Member Emails Tracking System provides comprehensive audit logging for all emails sent to members. It implements a dual-tracking approach:

1. **MemberEmails Sheet**: Full audit trail with complete email history
2. **Member Email Sent Status Column**: Quick reference showing latest email status

## Google Sheets Setup

### MemberEmails Sheet Structure

Create a new sheet named `MemberEmails` with the following columns:

| Column | Field Name | Type | Description |
|--------|------------|------|-------------|
| A | ID | Number | Auto-incrementing unique identifier |
| B | User Name | String | Username of the member (target of email) |
| C | Email Address | String | Recipient email address (empty if no email) |
| D | Template Name | String | Name of email template used |
| E | Subject | String | Email subject line |
| F | Success | String | 'Y' for success, 'N' for failure |
| G | Error Message | String | Error message if send failed (empty on success) |
| H | Sent By | String | Username of person who triggered the email |
| I | Attachments | String | Comma-separated list of attachment names |
| J | Timestamp | ISO Date | ISO 8601 timestamp of when email was sent/failed |

### Members Sheet Update

Add a column named `member_email_sent_status` to the Members sheet:
- **Purpose**: Quick reference for latest email status
- **Format**: "Success: [timestamp]" or "Failed: [error] ([timestamp])"
- **Updates**: Overwritten each time an email is sent (any type)

## Implementation

### 1. Import Required Functions

```typescript
import {
  logMemberEmail,
  updateEmailSentStatus,
} from '@/lib/sheets';
```

### 2. Core Functions

#### `logMemberEmail()`

Records a complete audit entry in the MemberEmails sheet.

```typescript
await logMemberEmail({
  userName: string;           // Target user's username
  emailAddress: string | null; // Recipient email (null if no email)
  templateName: string;       // Name of template used
  subject: string;            // Email subject
  success: boolean;           // Whether send succeeded
  errorMessage?: string | null; // Error message if failed
  sentBy: string;             // Who triggered the email
  attachments?: string[];     // Array of attachment IDs/names
});
```

**Implementation Location**: `src/lib/sheets.ts:630-677`

```typescript
export async function logMemberEmail(email: {
  userName: string;
  emailAddress: string | null;
  templateName: string;
  subject: string;
  success: boolean;
  errorMessage?: string | null;
  sentBy: string;
  attachments?: string[];
}): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'MemberEmails!A:A',
    });

    const nextId = (response.data.values?.length || 1);
    const now = new Date().toISOString();

    // Format attachments as comma-separated list
    const attachmentsList = email.attachments && email.attachments.length > 0
      ? email.attachments.join(', ')
      : '';

    await sheets.spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: 'MemberEmails!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          nextId,
          email.userName,
          email.emailAddress || '',
          email.templateName,
          email.subject,
          email.success ? 'Y' : 'N',
          email.errorMessage || '',
          email.sentBy,
          attachmentsList,
          now
        ]]
      }
    });
  } catch (error) {
    console.error('Error logging member email:', error);
  }
}
```

#### `updateEmailSentStatus()`

Updates the quick reference status column in Members sheet.

```typescript
await updateEmailSentStatus(
  userName: string,          // Target user's username
  success: boolean,          // Whether send succeeded
  errorMessage?: string,     // Error message if failed
  columnName?: string        // Column name (default: 'member_email_sent_status')
);
```

**Implementation Location**: `src/lib/sheets.ts:358-388`

```typescript
export async function updateEmailSentStatus(
  userName: string,
  success: boolean,
  errorMessage?: string,
  columnName: string = 'member_email_sent_status'
): Promise<void> {
  try {
    const sheets = getGoogleSheetsClient();

    // Get column map to find the status column
    const columnMap = await getColumnMap('Members');
    const statusColumn = columnMap[columnName];

    if (!statusColumn) {
      console.error(`Column ${columnName} not found in Members sheet`);
      return;
    }

    // Find user's row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: 'Members!A:A',
    });

    const userNameColumn = response.data.values || [];
    const rowIndex = userNameColumn.findIndex(
      (row) => row[0]?.toLowerCase() === userName.toLowerCase()
    );

    if (rowIndex === -1) {
      console.error(`User ${userName} not found in Members sheet`);
      return;
    }

    // Format status message
    const timestamp = new Date().toISOString();
    const statusMessage = success
      ? `Success: ${timestamp}`
      : `Failed: ${errorMessage || 'Unknown error'} (${timestamp})`;

    // Update the status column
    const cellAddress = `${getColumnLetter(statusColumn)}${rowIndex + 1}`;
    await sheets.spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `Members!${cellAddress}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[statusMessage]]
      }
    });
  } catch (error) {
    console.error('Error updating email sent status:', error);
  }
}
```

### 3. Implementation Pattern

Use this pattern for **ALL** email sending operations:

```typescript
try {
  // 1. Send email
  const result = await sendTemplateEmail(
    recipientEmail,
    subject,
    templateId,
    templateData
  );

  // 2. Log to MemberEmails sheet (full audit trail)
  await logMemberEmail({
    userName: targetUserName,
    emailAddress: recipientEmail,
    templateName: 'Template Display Name',
    subject: subject,
    success: result.success,
    errorMessage: result.error,
    sentBy: senderUserName,
    attachments: attachmentIds,
  });

  // 3. Update Members sheet status (quick reference)
  await updateEmailSentStatus(
    targetUserName,
    result.success,
    result.error
  );

  return result;
} catch (error) {
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';

  // Log failed attempt
  await logMemberEmail({
    userName: targetUserName,
    emailAddress: recipientEmail || null,
    templateName: 'Template Display Name',
    subject: subject,
    success: false,
    errorMessage: errorMsg,
    sentBy: senderUserName,
    attachments: attachmentIds,
  });

  // Update Members sheet with failure
  await updateEmailSentStatus(
    targetUserName,
    false,
    errorMsg
  );

  throw error;
}
```

## Email Types and "Sent By" Rules

### 1. Admin Member Campaign Emails

**Location**: `app/api/admin/emails/send/route.ts`

**Sent By**: Admin username who sent the campaign

```typescript
const adminUserName = session.user?.userName || 'Unknown';

await logMemberEmail({
  userName: member.userName,
  emailAddress: member.emailAddress,
  templateName,
  subject: templateSubject,
  success: true,
  sentBy: adminUserName,  // Admin who sent campaign
  attachments: attachmentNames,
});
```

### 2. Renewal Confirmation Emails

**Location**: `src/lib/renewals-sheets.ts:609-780`

**Sent By**: Person who submitted renewal (manager if impersonating, otherwise user)

```typescript
// In API route (app/api/renewals/route.ts)
const managerUserName = session.user.isImpersonating
  ? session.user.originalAdmin?.userName
  : session.user.userName;

await sendRenewalConfirmation(
  targetUserName,
  updatedRenewal,
  fees,
  managerUserName
);

// In sendRenewalConfirmation function
await logMemberEmail({
  userName,
  emailAddress: user.emailAddress,
  templateName: 'Renewal Confirmation',
  subject: 'BHBC Membership Renewal Confirmation',
  success: true,
  sentBy: managerUserName || userName,  // Manager or user themselves
  attachments: [],
});
```

### 3. Password Reset Request Emails

**Location**: `app/api/auth/forgot-password/route.ts`

**Sent By**: 'System' (public endpoint, no authentication)

```typescript
await logMemberEmail({
  userName,
  emailAddress: email,
  templateName: 'Password Reset',
  subject: 'BHBC Password Reset Request',
  success: result.success,
  errorMessage: result.error,
  sentBy: 'System',  // Public endpoint
  attachments: [],
});
```

### 4. Password Change Confirmation Emails

**Location**: `app/api/change-password/route.ts`

**Sent By**: Admin username when impersonating, otherwise user

```typescript
const isAdminManaging = session.user?.isImpersonating &&
                       session.user?.originalAdmin?.role === 'Admin';

const sentBy = isAdminManaging
  ? (session.user?.originalAdmin?.userName || 'Admin')
  : userName;

await logMemberEmail({
  userName,
  emailAddress: recipientEmail,
  templateName: 'Password Changed',
  subject: 'BHBC Password Changed Successfully',
  success: emailResult.success,
  errorMessage: emailResult.error,
  sentBy,  // Admin when managing, user when self-changing
  attachments: [],
});
```

### 5. Reset Password Confirmation Emails

**Location**: `app/api/auth/reset-password/route.ts`

**Sent By**: 'System' (token-based, no session)

```typescript
await logMemberEmail({
  userName,
  emailAddress: email,
  templateName: 'Password Changed',
  subject: 'BHBC Password Changed Successfully',
  success: result.success,
  errorMessage: result.error,
  sentBy: 'System',  // Token-based authentication
  attachments: [],
});
```

## Special Cases

### No Email Address Fallback

When a member has no email address, emails can be sent to:
1. Manager (person submitting) - if impersonating
2. Designated buddy - if buddy system is configured

```typescript
let recipientEmail = user.emailAddress;
let memberName = user.fullKnownAs || user.firstName || 'Member';

// If user has no email, send to the person managing
if (!recipientEmail && isAdminManaging && session.user?.originalAdmin?.userName) {
  const manager = await getUserByUsername(session.user.originalAdmin.userName);
  if (manager?.emailAddress) {
    recipientEmail = manager.emailAddress;
    memberName = `${memberName} (sent to manager: ${manager.fullKnownAs || manager.firstName})`;
  }
}

// If still no email and user has a designated buddy
if (!recipientEmail && user.buddyUserName) {
  const buddy = await getUserByUsername(user.buddyUserName);
  if (buddy?.emailAddress) {
    recipientEmail = buddy.emailAddress;
    memberName = `${memberName} (sent to buddy: ${buddy.fullKnownAs || buddy.firstName})`;
  }
}

// Log with actual recipient
await logMemberEmail({
  userName: user.userName,  // Original target user
  emailAddress: recipientEmail,  // Actual recipient (may be manager/buddy)
  templateName: 'Template Name',
  subject: 'Subject',
  success: result.success,
  errorMessage: result.error,
  sentBy: managerUserName || 'System',
  attachments: [],
});
```

### Error Handling

Always log failures to maintain audit trail:

```typescript
try {
  const result = await sendTemplateEmail(...);

  // Log success or failure from result
  await logMemberEmail({
    success: result.success,
    errorMessage: result.error,
    ...
  });
} catch (error) {
  // Log exception as failure
  const errorMsg = error instanceof Error ? error.message : 'Unknown error';

  await logMemberEmail({
    success: false,
    errorMessage: errorMsg,
    ...
  });
}
```

### Server-Sent Events (SSE) Progress Tracking

For bulk email operations, use SSE to stream progress:

```typescript
// Send progress updates during bulk operation
for (let i = 0; i < members.length; i++) {
  const member = members[i];

  try {
    const result = await sendMemberEmail(member, templateId, attachmentIds);

    if (result.success) {
      // Log success
      await logMemberEmail({
        userName: member.userName,
        emailAddress: member.emailAddress,
        templateName,
        subject: templateSubject,
        success: true,
        sentBy: adminUserName,
        attachments: attachmentNames,
      });

      // Update quick reference
      await updateEmailSentStatus(member.userName, true);

      // Send SSE progress event
      sendEvent({ type: 'success', userName });
    } else {
      // Log failure
      await logMemberEmail({
        userName: member.userName,
        emailAddress: member.emailAddress,
        templateName,
        subject: templateSubject,
        success: false,
        errorMessage: result.error,
        sentBy: adminUserName,
        attachments: attachmentNames,
      });

      // Update quick reference
      await updateEmailSentStatus(member.userName, false, result.error);

      // Send SSE error event
      sendEvent({ type: 'error', userName, error: result.error });
    }
  } catch (error) {
    // Handle exceptions...
  }
}
```

## Benefits

### Audit Trail
- Complete historical record of all emails sent
- Tracks who sent what, when, and whether it succeeded
- Essential for compliance and debugging

### Quick Reference
- At-a-glance status in Members sheet
- No need to search through audit log for latest status
- Useful for bulk operations monitoring

### Debugging
- Error messages logged for failed sends
- Can identify patterns (e.g., specific template always failing)
- Track down missing emails

### Accountability
- Know who triggered each email
- Distinguish between System, Admin, and User actions
- Important for impersonation/buddy system

## Checklist for Adding Email Tracking

When adding a new email type:

- [ ] Import `logMemberEmail` and `updateEmailSentStatus` from `@/lib/sheets`
- [ ] Determine correct "Sent By" value (System/Admin/User/Manager)
- [ ] Call `logMemberEmail()` after successful send
- [ ] Call `logMemberEmail()` after failed send
- [ ] Call `updateEmailSentStatus()` after both success and failure
- [ ] Handle exceptions with try/catch and log failures
- [ ] Test with members who have no email address
- [ ] Verify impersonation/buddy system correctly tracks sender
- [ ] Check MemberEmails sheet for correct audit entry
- [ ] Verify Member Email Sent Status column updated in Members sheet

## Example: Adding a New Email Type

```typescript
// app/api/some-new-feature/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendTemplateEmail, isEmailConfigured } from '@/lib/email/mailer';
import {
  getUserByUsername,
  logMemberEmail,
  updateEmailSentStatus
} from '@/lib/sheets';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get target user and your data
    const { targetUserName, ...data } = await request.json();

    // Determine sender (handle impersonation)
    const senderUserName = session.user.isImpersonating
      ? session.user.originalAdmin?.userName || 'Admin'
      : session.user.userName;

    // Get user details
    const user = await getUserByUsername(targetUserName);
    if (!user || !user.emailAddress) {
      return NextResponse.json({ error: 'User or email not found' }, { status: 404 });
    }

    // Check SMTP configured
    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'Email not configured' }, { status: 500 });
    }

    // Send email
    const subject = 'Your Subject Here';
    const result = await sendTemplateEmail(
      user.emailAddress,
      subject,
      'your-template-id',
      {
        memberName: user.fullKnownAs || user.firstName,
        // ...other template data
      }
    );

    // Log to MemberEmails sheet (full audit trail)
    await logMemberEmail({
      userName: targetUserName,
      emailAddress: user.emailAddress,
      templateName: 'Your Template Name',
      subject,
      success: result.success,
      errorMessage: result.error,
      sentBy: senderUserName,
      attachments: [],
    });

    // Update Member Email Sent Status (quick reference)
    await updateEmailSentStatus(
      targetUserName,
      result.success,
      result.error
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to send email' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending email:', error);

    // Try to log the failure if we have enough info
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';

    // Only log if we have the basic info needed
    const body = await request.json().catch(() => null);
    if (body?.targetUserName) {
      await logMemberEmail({
        userName: body.targetUserName,
        emailAddress: null,
        templateName: 'Your Template Name',
        subject: 'Your Subject Here',
        success: false,
        errorMessage: errorMsg,
        sentBy: 'System',
        attachments: [],
      }).catch(logError => console.error('Failed to log email error:', logError));

      await updateEmailSentStatus(
        body.targetUserName,
        false,
        errorMsg
      ).catch(statusError => console.error('Failed to update status:', statusError));
    }

    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
```

## Testing

### Test Cases

1. **Successful Send**
   - Verify entry in MemberEmails with Success = 'Y'
   - Verify Member Email Sent Status shows "Success: [timestamp]"

2. **Failed Send**
   - Verify entry in MemberEmails with Success = 'N' and error message
   - Verify Member Email Sent Status shows "Failed: [error] ([timestamp])"

3. **No Email Address**
   - Verify email sent to manager/buddy
   - Verify log shows original target user but actual recipient email

4. **Impersonation**
   - Verify "Sent By" shows admin username, not impersonated user

5. **Exception Handling**
   - Verify failed sends due to exceptions are logged
   - Verify error messages are descriptive

### Manual Testing Steps

1. Create MemberEmails sheet with correct structure
2. Send test email via each email type
3. Check MemberEmails sheet for new row with all fields populated
4. Check Members sheet for updated status in member_email_sent_status
5. Trigger a failure (e.g., invalid email) and verify logging
6. Test impersonation flow and verify correct sender tracking

## Migration Notes

If migrating existing email functionality:

1. **Identify all email send operations** in your codebase
2. **Import tracking functions** into each file
3. **Wrap email sends** with logging calls (success and failure)
4. **Determine correct "Sent By"** for each context
5. **Test each email type** thoroughly
6. **Update any email-related documentation**

## Related Files

- `src/lib/sheets.ts` - Core tracking functions
- `src/lib/renewals-sheets.ts` - Renewal email tracking
- `app/api/change-password/route.ts` - Password change tracking
- `app/api/auth/forgot-password/route.ts` - Password reset request tracking
- `app/api/auth/reset-password/route.ts` - Password reset confirmation tracking
- `app/api/admin/emails/send/route.ts` - Member campaign email tracking

## Version History

- **v1.0** (2026-01-09): Initial implementation
  - MemberEmails sheet structure defined
  - Dual-tracking system implemented
  - All email types tracked (campaigns, renewals, password operations)
  - Impersonation/buddy system sender tracking
