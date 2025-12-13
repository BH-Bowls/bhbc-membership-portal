import { google } from 'googleapis';

export async function testSheetsConnection() {
  try {
    // Initialize Google Sheets client
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get spreadsheet metadata
    const spreadsheetId = process.env.MEMBERSHIP_SPREADSHEET_ID;
    const response = await sheets.spreadsheets.get({
      spreadsheetId,
    });

    console.log('✅ Successfully connected to Google Sheets!');
    console.log('📊 Spreadsheet Title:', response.data.properties?.title);
    console.log('📑 Number of sheets:', response.data.sheets?.length);
    console.log('📋 Sheet names:', response.data.sheets?.map(s => s.properties?.title).join(', '));

    return { success: true, data: response.data };
  } catch (error: any) {
    console.error('❌ Failed to connect to Google Sheets');
    console.error('Error:', error.message);
    return { success: false, error: error.message };
  }
}