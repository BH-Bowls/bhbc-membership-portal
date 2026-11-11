// src/lib/email/gmail-api.ts
// Sends email through the Gmail API instead of Gmail SMTP — same Gmail account, same
// limits, same Sent folder, but each email is one HTTPS request:
//  - no SMTP connection or STARTTLS, so it works on Cloudflare Workers as well as Vercel
//  - signs in with an OAuth refresh token limited to sending (scope gmail.send), so a
//    leaked token can't read the mailbox the way a leaked app password could
//
// Deliberately uses nothing but fetch and Buffer (no nodemailer, no googleapis package):
// the email itself (headers, text, HTML, attachments) is built here as plain MIME text.
//
// The refresh token comes from scripts/get-gmail-token.mjs. The OAuth client (id/secret)
// is the one Drive already uses: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export interface MailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

/** The subset of nodemailer's mail options the portal uses. */
export interface MailOptions {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  subject?: string;
  text?: string;
  html?: string;
  headers?: Record<string, string>;
  attachments?: MailAttachment[];
}

/** What the portal's email code calls on a transporter — SMTP (nodemailer) or this one. */
export interface MailTransport {
  sendMail(options: MailOptions): Promise<{ messageId: string }>;
  verify(): Promise<boolean>;
  close(): void;
}

// ── Access tokens ────────────────────────────────────────────────────────────

// Access tokens last an hour; keep one per refresh token (club and Rowland accounts)
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = accessTokens.get(refreshToken);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set to send email through the Gmail API');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      throw new Error('Gmail sign-in failed: the refresh token is invalid, revoked or expired (or the account’s password was changed). '
        + 'Get a new one with scripts/get-gmail-token.mjs and update GMAIL_REFRESH_TOKEN (or ROWLAND_GMAIL_REFRESH_TOKEN).');
    }
    if (data.error === 'invalid_client') {
      throw new Error('Gmail sign-in failed: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are wrong.');
    }
    const reason = data.error ? `${data.error}${data.error_description ? ' (' + data.error_description + ')' : ''}` : 'HTTP ' + res.status;
    throw new Error(`Gmail sign-in failed: ${reason}`);
  }
  accessTokens.set(refreshToken, { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 });
  return data.access_token;
}

// ── Building the email ───────────────────────────────────────────────────────

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 126) return false;
  }
  return true;
}

/** A header value with non-ASCII text (e.g. "—", "£") encoded the MIME way. Each encoded
 * chunk stays within the 75-character limit, split between characters (never mid-"£"). */
function encodeWord(s: string): string {
  if (isAscii(s)) return s;
  const words: string[] = [];
  let chunk = '';
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf-8') > 45) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf-8').toString('base64')}?=`);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk !== '') words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf-8').toString('base64')}?=`);
  return words.join(' ');
}

/** One address, e.g. `"Rowland Cup – BHBC" <x@gmail.com>` — the name part encoded if needed. */
function encodeAddress(address: string): string {
  const match = address.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!match) return address.trim();
  const name = match[1].trim();
  if (name === '') return `<${match[2]}>`;
  if (isAscii(name)) return `"${name.replace(/"/g, '')}" <${match[2]}>`;
  return `${encodeWord(name)} <${match[2]}>`;
}

/** Splits "a@x.com, "Smith, J" <b@y.com>" on the commas between addresses, not inside quotes. */
function splitAddresses(value: string): string[] {
  const list: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charAt(i);
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) {
      list.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  list.push(current);
  return list;
}

/** A To/Cc/Bcc value: an array, or a comma-separated string as the portal often passes. */
function encodeAddressList(value: string | string[]): string {
  const parts: string[] = [];
  const list = Array.isArray(value) ? value : splitAddresses(value);
  for (const item of list) {
    if (item.trim() !== '') parts.push(encodeAddress(oneLine(item)));
  }
  return parts.join(', ');
}

/** A header value on one line — a line break in it would start a new header. */
function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ');
}

/** Base64, wrapped at 76 characters per line as MIME expects. */
function base64Lines(content: string | Buffer): string {
  const b64 = (typeof content === 'string' ? Buffer.from(content, 'utf-8') : content).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

function boundary(): string {
  return '----=_bhbc_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function textPart(contentType: string, content: string): string {
  return `Content-Type: ${contentType}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(content)}`;
}

/** The message body: text and/or HTML, plus any attachments (e.g. .ics invites). */
function buildBody(options: MailOptions): string {
  let body: string;
  if (options.text && options.html) {
    const b = boundary();
    body = `Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n`
      + `--${b}\r\n${textPart('text/plain', options.text)}\r\n`
      + `--${b}\r\n${textPart('text/html', options.html)}\r\n`
      + `--${b}--`;
  } else if (options.html) {
    body = textPart('text/html', options.html);
  } else {
    body = textPart('text/plain', options.text || '');
  }

  const attachments = options.attachments || [];
  if (attachments.length === 0) return body;

  const b = boundary();
  let mixed = `Content-Type: multipart/mixed; boundary="${b}"\r\n\r\n--${b}\r\n${body}\r\n`;
  for (const a of attachments) {
    const type = a.contentType || 'application/octet-stream';
    const name = encodeWord(a.filename).replace(/"/g, '');
    mixed += `--${b}\r\n`
      + `Content-Type: ${type}; name="${name}"\r\n`
      + `Content-Disposition: attachment; filename="${name}"\r\n`
      + `Content-Transfer-Encoding: base64\r\n\r\n`
      + `${base64Lines(a.content)}\r\n`;
  }
  return mixed + `--${b}--`;
}

/** The whole email as MIME text. Gmail adds Date and Message-ID, and removes Bcc before sending. */
export function buildMimeMessage(options: MailOptions): string {
  const headers: string[] = [];
  if (options.from) headers.push(`From: ${encodeAddress(oneLine(options.from))}`);
  if (options.to) headers.push(`To: ${encodeAddressList(options.to)}`);
  if (options.cc) headers.push(`Cc: ${encodeAddressList(options.cc)}`);
  if (options.bcc) headers.push(`Bcc: ${encodeAddressList(options.bcc)}`);
  if (options.replyTo) headers.push(`Reply-To: ${encodeAddress(oneLine(options.replyTo))}`);
  headers.push(`Subject: ${encodeWord(oneLine(options.subject || ''))}`);
  headers.push('MIME-Version: 1.0');
  if (options.headers) {
    for (const key of Object.keys(options.headers)) {
      headers.push(`${oneLine(key)}: ${oneLine(String(options.headers[key]))}`);
    }
  }
  return headers.join('\r\n') + '\r\n' + buildBody(options);
}

// ── Sending ──────────────────────────────────────────────────────────────────

/** A transporter that sends through the Gmail API as the account the refresh token belongs to. */
export function createGmailApiTransport(refreshToken: string): MailTransport {
  return {
    async sendMail(options: MailOptions) {
      const accessToken = await getAccessToken(refreshToken);
      const raw = Buffer.from(buildMimeMessage(options), 'utf-8').toString('base64url');
      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: raw }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error && data.error.message ? data.error.message : 'HTTP ' + res.status;
        throw new Error(`Gmail API send failed: ${message}`);
      }
      return { messageId: String(data.id) };
    },
    // Checks the account can sign in (the SMTP "verify the connection" equivalent)
    async verify() {
      await getAccessToken(refreshToken);
      return true;
    },
    // Nothing to close — there's no connection between sends
    close() {},
  };
}
