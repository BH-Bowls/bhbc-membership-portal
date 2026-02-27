/**
 * create-competition-sheets.gs
 *
 * Run this once from Google Apps Script (Tools → Script editor in your spreadsheet).
 * Creates CompetitionsControl + 11 match sheets, all positioned after "ReportOutput".
 * Safe to re-run — skips any sheet that already exists.
 */

function createCompetitionSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Find the insertion position (after ReportOutput) ──────────────────────
  var allSheets = ss.getSheets();
  var reportOutputIndex = -1;
  for (var i = 0; i < allSheets.length; i++) {
    if (allSheets[i].getName() === 'ReportOutput') {
      reportOutputIndex = i;
      break;
    }
  }
  if (reportOutputIndex === -1) {
    SpreadsheetApp.getUi().alert('Could not find a sheet named "ReportOutput". Aborting.');
    return;
  }

  // New sheets will be inserted starting at this 1-based position
  var insertAfter = reportOutputIndex + 1; // 0-based index of ReportOutput → insert at +1
  var nextPosition = insertAfter + 1;      // getSheets() is 0-based; insertSheet position is 1-based

  // ── Helper: create a sheet if it doesn't exist, positioned in sequence ─────
  function ensureSheet(name) {
    var existing = ss.getSheetByName(name);
    if (existing) {
      Logger.log('Sheet already exists, skipping: ' + name);
      return existing;
    }
    var sheet = ss.insertSheet(name, nextPosition);
    nextPosition++;
    Logger.log('Created sheet: ' + name);
    return sheet;
  }

  // ── Helper: write a header row and freeze it ──────────────────────────────
  function writeHeaders(sheet, headers) {
    var range = sheet.getRange(1, 1, 1, headers.length);
    range.setValues([headers]);
    range.setFontWeight('bold');
    range.setBackground('#f3f4f6');
    sheet.setFrozenRows(1);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. CompetitionsControl
  // ══════════════════════════════════════════════════════════════════════════
  var controlSheet = ensureSheet('CompetitionsControl');

  var controlHeaders = [
    'Comp ID', 'Display Name', 'Comp Type', 'Status', 'Year',
    'Finals Date', 'Prelim Play By', 'R1 Play By', 'R2 Play By',
    'QF Play By', 'SF Play By', 'Triples Fixed Day', 'Triples Fixed Date'
  ];
  writeHeaders(controlSheet, controlHeaders);

  // Only write data rows if the sheet was freshly created (no data below header)
  if (controlSheet.getLastRow() <= 1) {
    var competitions = [
      ['mens-championship',  "Men's Championship", 'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['ladies-maynard',     'Ladies Maynard',      'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['mens-two-wood',      "Men's Two Wood",      'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['ladies-two-wood',    'Ladies Two Wood',     'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['handicap',           'Handicap',            'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['oldlands',           'Oldlands',            'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['veterans',           'Veterans',            'singles', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['married-pairs',      'Married Pairs',       'pairs',   'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['drawn-pairs',        'Drawn Pairs',         'pairs',   'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['australian-pairs',   'Australian Pairs',    'pairs',   'Not Started', 2026, '', '', '', '', '', '', '', ''],
      ['drawn-triples',      'Drawn Triples',       'triples', 'Not Started', 2026, '', '', '', '', '', '', '', ''],
    ];
    controlSheet.getRange(2, 1, competitions.length, controlHeaders.length).setValues(competitions);

    // Set column widths for readability
    controlSheet.setColumnWidth(1, 160);  // Comp ID
    controlSheet.setColumnWidth(2, 180);  // Display Name
    controlSheet.setColumnWidth(3, 80);   // Comp Type
    controlSheet.setColumnWidth(4, 100);  // Status
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Match sheets (one per competition)
  // ══════════════════════════════════════════════════════════════════════════
  var matchHeaders = [
    'Match ID', 'Round', 'Position', 'Side1', 'Side2',
    'Score1', 'Score2', 'Winner Side', 'Status', 'Play By Date', 'Played Date'
  ];

  var matchSheets = [
    'CompMensChampionship',
    'CompLadiesMaynard',
    'CompMensTwoWood',
    'CompLadiesTwoWood',
    'CompHandicap',
    'CompOldlands',
    'CompVeterans',
    'CompMarriedPairs',
    'CompDrawnPairs',
    'CompAustralianPairs',
    'CompDrawnTriples',
  ];

  for (var j = 0; j < matchSheets.length; j++) {
    var ms = ensureSheet(matchSheets[j]);
    if (ms.getLastRow() === 0) {
      writeHeaders(ms, matchHeaders);

      // Set useful column widths
      ms.setColumnWidth(1, 200);  // Match ID
      ms.setColumnWidth(4, 200);  // Side1
      ms.setColumnWidth(5, 200);  // Side2
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Done
  // ══════════════════════════════════════════════════════════════════════════
  SpreadsheetApp.getUi().alert(
    '✅ Done!\n\n' +
    'Created (or skipped if already existing):\n' +
    '  • CompetitionsControl (with 11 competition rows)\n' +
    '  • 11 match sheets (CompMensChampionship … CompDrawnTriples)\n\n' +
    'All sheets placed after ReportOutput.\n\n' +
    'Remember to add a "Handicap" column to the Members sheet manually.'
  );
}
