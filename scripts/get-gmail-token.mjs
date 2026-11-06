// scripts/get-gmail-token.mjs
// Gets a Gmail API refresh token for sending email (scope gmail.send only — it can send,
// but can't read the mailbox). Run once per account: the club account for
// GMAIL_REFRESH_TOKEN, and the Rowland Cup account for ROWLAND_GMAIL_REFRESH_TOKEN.
//
//   npx dotenv -e .env.dev.local -- node scripts/get-gmail-token.mjs
//
// Uses the OAuth client Drive already uses (GOOGLE_OAUTH_CLIENT_ID / _SECRET). Before the
// first run, in that client's Google Cloud project:
//   1. APIs & Services > Library > Gmail API > Enable
//   2. OAuth consent screen: publishing status "In production" — in "Testing", refresh
//      tokens expire after 7 days and email would quietly stop
//   3. If the client is a "Web application" type, add http://127.0.0.1:53682 to its
//      Authorised redirect URIs (a "Desktop app" client needs nothing)
//
// Sign in as the account the emails should come FROM. Google warns the app isn't verified;
// that's expected for the club's own use: Advanced > Go to (app).

import http from 'node:http';

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
// gmail.send to send; email only so the script can show which account you signed in as
const SCOPE = 'https://www.googleapis.com/auth/gmail.send email';

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set (run with dotenv -e .env.dev.local).');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',          // always return a refresh token, even if granted before
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) { res.writeHead(404); res.end(); return; }

  if (error) {
    res.end(`Google said: ${error}. You can close this tab.`);
    console.error(`\nSign-in failed: ${error}`);
    server.close();
    return;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const data = await tokenRes.json();
  if (!tokenRes.ok || !data.refresh_token) {
    res.end('Something went wrong — see the terminal. You can close this tab.');
    console.error('\nCould not get a refresh token:', data);
    server.close();
    return;
  }

  // Google's sign-in lists each permission with its own tick box — make sure "send" was ticked
  if (!String(data.scope || '').includes('gmail.send')) {
    res.end('The "Send email on your behalf" permission wasn’t ticked — see the terminal. You can close this tab.');
    console.error('\nNo token saved: the "Send email on your behalf" box wasn’t ticked on Google’s sign-in screen.');
    console.error('Run the script again and tick it (or "Select all") before clicking Continue.');
    server.close();
    return;
  }

  // Which account was this? (from the email scope — gmail.send itself can't tell us)
  const infoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${data.access_token}`);
  const info = await infoRes.json();

  res.end('Done — the refresh token is in the terminal. You can close this tab.');
  console.log(`\nSigned in as: ${info.email || '(not shown — check you used the right account)'}`);
  console.log('Refresh token (keep it secret):\n');
  console.log(data.refresh_token);
  console.log('\nClub account   -> GMAIL_REFRESH_TOKEN=...');
  console.log('Rowland account -> ROWLAND_GMAIL_REFRESH_TOKEN=...');
  server.close();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Open this link, and sign in as the account the emails should come FROM:\n');
  console.log(authUrl + '\n');
  console.log(`Waiting for Google to send you back to ${REDIRECT_URI} ...`);
});
