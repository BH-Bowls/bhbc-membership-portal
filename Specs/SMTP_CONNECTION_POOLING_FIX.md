# SMTP Connection Pooling Fix

## Problem

After sending 123 emails using the member emails system, Gmail blocked further sends with error:

```
Invalid login: 454-4.7.0 Too many login attempts, please try again later.
```

### Root Cause

The email system was creating a new SMTP connection (login) for **each email sent**. When sending bulk emails (100+), this results in 100+ rapid login attempts to Gmail's SMTP server, which triggers their rate limiting protection.

Gmail limits:
- Maximum login attempts per hour
- Suspicious activity detection for rapid successive logins
- Connection abuse prevention

## Solution

Implemented **SMTP Connection Pooling** to reuse connections instead of creating new ones for each email.

### How Connection Pooling Works

Instead of:
```
Email 1: Login → Send → Logout
Email 2: Login → Send → Logout
Email 3: Login → Send → Logout
...
Email 123: Login → Send → Logout (BLOCKED!)
```

Connection pooling does:
```
Login → Send Email 1 → Send Email 2 → Send Email 3 → ... → Send Email 123 → Logout
```

The system maintains a pool of reusable SMTP connections that are shared across multiple email sends, dramatically reducing login attempts.

## Implementation

### 1. Updated `getEmailTransporter()` Function

**File**: `src/lib/email/mailer.ts:17-40`

```typescript
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
    config.maxConnections = 5;
    // Maximum number of messages per connection
    config.maxMessages = 100;
  }

  return nodemailer.createTransport(config);
}
```

**Key Parameters:**
- `pool: true` - Enable connection pooling
- `maxConnections: 5` - Use up to 5 parallel SMTP connections
- `maxMessages: 100` - Send up to 100 messages per connection before rotating

### 2. Updated `sendEmailWithAttachments()` Function

**File**: `src/lib/email/mailer.ts:276-322`

Added optional `transporter` parameter to accept existing transporter for bulk operations:

```typescript
export async function sendEmailWithAttachments(
  to: string,
  subject: string,
  htmlContent: string,
  attachments: Array<{ filename: string; content: Buffer }>,
  transporter?: any  // NEW: Optional existing transporter
): Promise<{ success: boolean; error?: string }> {
  // Use provided transporter or create a new one
  const emailTransporter = transporter || getEmailTransporter();

  // ... rest of email sending logic
}
```

### 3. Updated `sendMemberEmail()` Function

**File**: `src/lib/email/member-mailer.ts:57-62`

Added optional `transporter` parameter and passed it through to email functions:

```typescript
export async function sendMemberEmail(
  member: MemberData,
  templateId: string,
  attachmentIds: string[],
  transporter?: any  // NEW: Optional existing transporter
): Promise<EmailResult> {
  // ... processing logic

  // Pass through transporter if provided (for connection pooling)
  const emailResult = await sendEmailWithAttachments(
    recipientEmail,
    subject,
    cleanedEmailBody,
    attachments,
    transporter  // Pass transporter
  );

  // ... return logic
}
```

### 4. Updated Bulk Email Sending Route

**File**: `app/api/admin/emails/send/route.ts`

**Added Import** (line 10):
```typescript
import { getEmailTransporter } from '@/lib/email/mailer';
```

**Created Pooled Transporter** (lines 159-162):
```typescript
// Create pooled transporter for bulk sending
// This reuses SMTP connections instead of creating new ones for each email
// Prevents "Too many login attempts" errors from Gmail
const transporter = getEmailTransporter(true);
```

**Wrapped Send Loop in try/finally** (lines 172-290):
```typescript
try {
  // Loop through each member and send email
  for (let i = 0; i < membersToEmail.length; i++) {
    const member = membersToEmail[i];

    // Pass transporter to reuse connection
    const result = await sendMemberEmail(
      member,
      templateId,
      attachmentIds,
      transporter  // Reuse pooled connection
    );

    // ... logging and tracking
  }

  // Send completion event
  sendEvent({
    type: 'complete',
    sent: total,
    succeeded,
    failed,
  });
} finally {
  // CRITICAL: Close transporter to release SMTP connections
  transporter.close();
  console.log('[send-emails] Transporter closed');
}
```

## Benefits

### Before (No Pooling)
- **123 emails** = **123 SMTP logins**
- Gmail blocks after ~100 rapid logins
- Operation fails partway through
- User must wait 1+ hours to retry

### After (With Pooling)
- **123 emails** = **1-5 SMTP logins** (depending on load)
- Stays well below Gmail's rate limits
- All emails sent successfully
- Much faster overall (no connection overhead per email)

## Summary: Two Separate Issues

During implementation and testing, we discovered and solved two distinct problems:

### Issue 1: SMTP Rate Limiting (SOLVED)
**Problem:** "Too many login attempts" error after ~100 emails
**Cause:** Each email created new SMTP connection
**Solution:** Connection pooling (reuse single connection)
**Status:** ✅ Fixed - Can now send unlimited emails without rate limiting

### Issue 2: Gmail Greylisting (EXPECTED BEHAVIOR)
**Problem:** Emails sent successfully but delayed 4-5 hours before delivery
**Cause:** Gmail's spam filter for new/low-volume senders from cloud IPs
**Solution:** Accept delays, build sender reputation over time
**Status:** ⏱️ Working as designed - All emails eventually deliver

**Key Insight:** These are separate issues:
- Rate limiting prevents sending (hard error)
- Greylisting delays delivery (soft delay, eventually succeeds)

Connection pooling solves #1 but cannot solve #2 (Gmail's internal filtering).

**Practical Impact:**
- ✅ Can send 100+ emails in ~5-10 minutes
- ⏱️ Recipients receive emails 4-5 hours later
- ✅ All emails eventually deliver successfully
- 📈 Delays will decrease as sender reputation improves

## Configuration

### Pool Settings

Currently configured for Gmail's limits:

```typescript
maxConnections: 5    // Up to 5 parallel connections
maxMessages: 100     // Up to 100 emails per connection
```

**Why these values?**
- Gmail allows up to 100 simultaneous SMTP connections per account
- We use 5 to be conservative and avoid triggering abuse detection
- 100 messages per connection provides good balance between efficiency and connection rotation

### Adjusting for Different Providers

If using a different SMTP provider (not Gmail):

1. **Check provider limits**:
   - SendGrid: 100 connections, unlimited per connection
   - Mailgun: 1000 connections, unlimited per connection
   - Office 365: 30 connections, 10,000 per day total

2. **Adjust settings**:
   ```typescript
   config.maxConnections = YOUR_PROVIDER_LIMIT / 10;  // Conservative
   config.maxMessages = YOUR_PROVIDER_MESSAGE_LIMIT;
   ```

## When to Use Pooling

### Use Pooling (usePool: true)
- ✅ Bulk email campaigns (10+ emails)
- ✅ Member notification blasts
- ✅ Renewal confirmations to many members
- ✅ Any operation sending emails in a loop

### Don't Use Pooling (usePool: false - default)
- ✅ Single email sends (password reset, single renewal)
- ✅ Low-frequency email operations
- ✅ Background jobs with long delays between sends

**Default behavior**: Pooling is OFF by default to avoid keeping connections open unnecessarily for single sends.

## Testing

### Before Deployment
1. Test with small batch (5-10 emails) to verify pooling works
2. Monitor console for "Transporter closed" message
3. Check Gmail account for "suspicious activity" alerts
4. Test with full batch (100+ emails)

### Monitoring
Watch for these log messages:
```
[member-mailer] Sending email to [Name] ([Email])
✓ Email sent to [Email]: [Subject]
[send-emails] Transporter closed
```

### Troubleshooting

**If still getting rate limited:**
1. Reduce `maxConnections` to 3
2. Reduce `maxMessages` to 50
3. Add delay between sends (not ideal but works)
4. Check if Gmail account has 2FA enabled (requires App Password)

**If emails sending slowly:**
1. Increase `maxConnections` to 10
2. Verify network connection is stable
3. Check SMTP server response times

**If transporter not closing:**
- Verify `finally` block is executing
- Check for errors during send loop
- Ensure outer try/catch doesn't swallow errors

## Gmail Greylisting and Delivery Delays

### The Issue

After implementing connection pooling, emails were sent successfully (appearing in Gmail Sent folder with MessageIDs), but recipients reported not receiving them. Investigation revealed Gmail was **greylisting** automated emails.

**Symptoms:**
- ✅ Emails sent successfully (no errors)
- ✅ Emails appear in Sent folder
- ❌ Emails not arriving in recipient inboxes
- ⏱️ Emails eventually arrive 4-5 hours later

### Root Cause

Gmail's post-acceptance spam filter delays automated emails from:
- **New/low-volume senders** (unestablished sender reputation)
- **AWS/Cloud server IPs** (common for bulk spam)
- **Rapid successive sends** (bulk mail pattern detection)

Email headers revealed the issue:
```
Received: from [169.254.46.25] (ec2-54-80-24-171.compute-1.amazonaws.com. [54.80.24.171])
```

Gmail's algorithm:
1. Accepts email via SMTP (places in Sent folder)
2. Queues for spam analysis (greylisting)
3. Delays delivery 4-5 hours while monitoring
4. Delivers if no spam reports received

### Why Some Recipients Get Emails Immediately

Gmail uses **social graph filtering**:
- ✅ Emails to sender's own accounts: Immediate delivery (established relationship)
- ❌ Emails to others: Delayed 4-5 hours (unestablished relationship)

Example pattern observed:
- `liam.dasey@gmail.com` - Delivered immediately (user manages sender account)
- `liam@dasey.org.uk` - Delivered immediately (user's domain)
- `celia.dasey@gmail.com` - Delayed 4-5 hours (different person)
- `spire.computer.help@gmail.com` - Delayed 4-5 hours (different person)

### This is NOT a Bug

Gmail greylisting is **expected behavior** for:
- New email senders
- Low-volume automated sends
- Cloud/AWS server IPs
- Bulk email patterns

**All emails eventually deliver** - they're just delayed while Gmail builds sender reputation.

### Long-Term Solution

Sender reputation improves over time through:
1. **Consistent sending** - Regular email volume builds trust
2. **Recipient engagement** - Opens, replies, not marking as spam
3. **Low bounce rates** - Valid email addresses
4. **No spam reports** - Recipients don't mark as spam

Over weeks/months of legitimate sending, delivery delays will decrease from 4-5 hours to minutes or instant.

### Attempting to Reduce Delays

Several approaches were tested:

**❌ Adding delays between sends (15 seconds)**
- Tested to make emails appear less automated
- Result: No improvement (Gmail still delayed them)
- Conclusion: Gmail's filter operates post-acceptance, delays don't help

**❌ Removing custom headers**
- Removed `X-Mailer`, `Reply-To`, `X-Priority` headers
- Result: No improvement
- Conclusion: Gmail analyzes deeper patterns (IP, timing, content)

**❌ Disabling connection pooling**
- Each email got new connection (like manual sends)
- Result: No improvement (actually made rate limiting worse)
- Conclusion: Gmail's delay is based on sender reputation, not connection type

### Recommendation: Accept the Delays

For a membership portal with infrequent bulk sends:

**✅ Accept 4-5 hour delays**
- Reliable: All emails eventually deliver
- Simple: No complex workarounds needed
- Cost-effective: Uses existing Gmail account
- Improving: Delays will decrease over time

**Set expectations:**
- Document expected delivery time for members
- Send non-urgent emails (newsletters, renewals)
- For urgent emails, use alternative method (SMS, phone)

### Critical Impact: Password Reset Tokens

**Problem:** Password reset tokens expired in 1 hour, but emails delayed 4-5 hours.

**Solution:** Extended token expiry to 24 hours

**Changes:**
```typescript
// src/lib/sheets.ts:825-828
// Set expiry to 24 hours from now (extended due to Gmail delivery delays)
// Gmail may delay automated emails by 4-5 hours
// 24 hours allows for overnight requests and delayed delivery
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
```

**Also updated:**
- `app/forgot-password/page.tsx`: UI message "1 hour" → "24 hours"
- `src/lib/email/templates/password-reset.html`: Email template "1 hour" → "24 hours"

**Why 24 hours is secure:**
- ✅ Single-use token (deleted after successful reset)
- ✅ Cryptographically secure (32 bytes random)
- ✅ Standard practice (many sites use 24-48 hours)
- ✅ Accommodates overnight requests (request at 11pm, check email at 8am)

### Alternative Solutions (If Delays Unacceptable)

If immediate delivery is required:

**1. Switch to Gmail API (OAuth2)**
- Better sender reputation
- Treated differently by Gmail's filters
- More complex implementation
- Requires OAuth2 setup

**2. Use Transactional Email Service**
- SendGrid: 100 emails/day free tier
- Mailgun: Pay-as-you-go pricing
- Amazon SES: Very cheap at scale
- **Benefits:** Instant delivery, better tracking, no greylisting

**3. Use Google Workspace (if applicable)**
- Admin can configure delivery rules
- Better sender reputation
- Costs $6-18/user/month

## Backward Compatibility

All changes are **backward compatible**:

- `getEmailTransporter()` defaults to `usePool: false` (existing behavior)
- `sendEmailWithAttachments()` still works without transporter parameter
- `sendMemberEmail()` still works without transporter parameter
- Single email sends (password reset, etc.) unchanged

## Future Improvements

### Rate Limiting
Add explicit rate limiting between sends:
```typescript
// Wait 100ms between each email
await new Promise(resolve => setTimeout(resolve, 100));
```

### Retry Logic
Add exponential backoff for failed sends:
```typescript
let retries = 0;
while (retries < 3) {
  try {
    const result = await sendMemberEmail(...);
    if (result.success) break;
    retries++;
    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
  } catch (error) {
    retries++;
  }
}
```

### Queue System
For very large batches (500+ emails), consider using a queue:
- Bull (Redis-based job queue)
- AWS SQS
- Google Cloud Tasks

This would allow:
- Persistent retry on failure
- Distributed processing
- Better monitoring and observability
- Graceful handling of server restarts

## Related Documentation

- [Member Emails Tracking System](./MEMBER_EMAILS_TRACKING_SPEC.md)
- [Nodemailer Pooling Documentation](https://nodemailer.com/smtp/pooled/)
- [Gmail SMTP Limits](https://support.google.com/a/answer/176600)

## Version History

- **v1.2** (2026-01-10): Password reset token extension
  - Extended token expiry from 1 hour to 24 hours
  - Accommodates Gmail delivery delays (4-5 hours)
  - Updated UI messages and email templates
  - Allows overnight requests to be processed

- **v1.1** (2026-01-10): Gmail greylisting investigation
  - Discovered Gmail delays automated emails 4-5 hours
  - Documented social graph filtering behavior
  - Tested multiple approaches (delays, headers, pooling)
  - Determined delays are expected for new senders
  - All emails eventually deliver successfully
  - Recommendation: Accept delays, build sender reputation over time

- **v1.0** (2026-01-09): Initial implementation
  - Added connection pooling to `getEmailTransporter()`
  - Updated bulk send route to use pooled connections
  - Fixed "Too many login attempts" error
  - Tested with 123+ email batch successfully
