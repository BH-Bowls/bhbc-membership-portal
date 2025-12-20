# Tea Rota Integration - Quick Reference

## Overview

The Tea Rota sheet has been integrated into the Friendlies system to automatically display tea duty assignments on match cards for home games.

## Sheet Location

**Spreadsheet:** Membership List  
**Sheet Name:** Tea Rota

## Column Structure

| Column | Name | Example | Notes |
|--------|------|---------|-------|
| A | Date | "Sun, 27 April" | Formatted date string |
| B | Time | "14:00" | Match time |
| C | Club Name | "Balcombe" | Opponent club name |
| D | Ladies/Men | "Mixed" | Game type |
| E | Format | "4 Triples" | Game format |
| F | Lead | "Anne Barnes" | Full name of lead tea duty person |
| G | Second | "Tracy McBride" | Full name of second tea duty person |
| H | Third | "" | Full name of third (optional, may be empty) |
| I | Short Lead | "A Barnes" | Abbreviated name for compact display |
| J | Short Second | "T McBride" | Abbreviated name for compact display |
| K | Short Third | "" | Abbreviated name (optional, may be empty) |

## How It Works

### Matching Games to Tea Rota

The system matches tea rota entries to games using three criteria:

1. **Date** - Flexible matching on the date portion (e.g., "27 April")
2. **Time** - Exact match (e.g., "14:00")
3. **Club Name** - Exact match (e.g., "Balcombe")

### Display Rules

- ✅ **Home Games (H/A = "H")** - Tea rota is displayed
- ❌ **Away Games (H/A = "A")** - Tea rota is NOT displayed
- ⚠️ **Missing Entry** - No error, simply doesn't display tea rota section

### Match Card Display

For home games, the match card will show:

```
Tea Duty:
  Lead: Anne Barnes
  Second: Tracy McBride
  Third: [empty or name if applicable]
```

Or using short names for compact display:

```
Tea: A Barnes, T McBride
```

## Implementation Code

### Database Function

```typescript
// lib/sheets/friendlies.ts

export async function getTeaRota(
  date: string, 
  time: string, 
  clubName: string
) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MEMBERS_SPREADSHEET_ID,
    range: 'Tea Rota!A:K',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  // Find matching row by date, time, and club name
  const matchingRow = rows.find((row, index) => {
    if (index === 0) return false; // Skip header
    
    const rowDate = row[0];
    const rowTime = row[1];
    const rowClub = row[2];
    
    // Flexible date matching
    const dateMatch = rowDate && rowDate.includes(date.split(',')[1]?.trim());
    const timeMatch = rowTime === time;
    const clubMatch = rowClub === clubName;
    
    return dateMatch && timeMatch && clubMatch;
  });

  if (!matchingRow) return null;

  return {
    date: matchingRow[0],
    time: matchingRow[1],
    clubName: matchingRow[2],
    ladiesMen: matchingRow[3],
    format: matchingRow[4],
    lead: matchingRow[5] || '',
    second: matchingRow[6] || '',
    third: matchingRow[7] || '',
    shortLead: matchingRow[8] || '',
    shortSecond: matchingRow[9] || '',
    shortThird: matchingRow[10] || '',
  };
}
```

### API Endpoint Usage

```typescript
// app/api/friendlies/match-card/[tabDate]/route.ts

// Get tea rota for home games only
let teaRota = null;
if (game.homeAway === 'H') {
  teaRota = await getTeaRota(game.date, game.time, game.clubName);
}

// Include in response
return NextResponse.json({
  game: { /* game details */ },
  teams: [ /* teams */ ],
  teaRota: teaRota ? {
    lead: teaRota.lead,
    second: teaRota.second,
    third: teaRota.third,
  } : null,
});
```

### UI Component Display

```typescript
// components/friendlies/MatchCard.tsx

{game.homeAway === 'H' && teaRota && (
  <div className="tea-rota-section">
    <h3>Tea Duty</h3>
    <div>
      <strong>Lead:</strong> {teaRota.lead}
    </div>
    <div>
      <strong>Second:</strong> {teaRota.second}
    </div>
    {teaRota.third && (
      <div>
        <strong>Third:</strong> {teaRota.third}
      </div>
    )}
  </div>
)}
```

## Data Management

### Adding Tea Rota Entries

1. Open Membership List spreadsheet
2. Navigate to "Tea Rota" sheet
3. Add new row with:
   - Date in format: "Day, DD Month" (e.g., "Sun, 27 April")
   - Time in format: "HH:MM" (e.g., "14:00")
   - Club Name matching exactly as in Games sheet
   - Assign Lead, Second, Third (full names)
   - Add short names for compact display

### Maintenance

- Ensure date format is consistent: "Day, DD Month"
- Ensure time format is consistent: "HH:MM"
- Ensure club names match exactly with Games sheet
- Short names typically format as: "FirstInitial LastName" (e.g., "A Barnes")

## Testing Checklist

- [ ] Tea rota displays on home game match cards
- [ ] Tea rota does NOT display on away game match cards
- [ ] Tea rota matches correctly by date, time, club name
- [ ] Missing tea rota entry doesn't cause errors
- [ ] Empty third person field handled correctly
- [ ] Short names display correctly
- [ ] Print formatting looks good for both full and short names

## Troubleshooting

### Tea Rota Not Displaying

**Check:**
1. Is the game a home game (H/A = "H")?
2. Does the date format match? Compare Games sheet date to Tea Rota date
3. Does the time match exactly?
4. Does the club name match exactly (case-sensitive)?

### Date Matching Issues

The date matching is flexible and looks for the date portion (e.g., "27 April"):
- Games sheet: "2025-04-27"
- Tea Rota: "Sun, 27 April"
- Matching: Extracts "27 April" from both

If dates still don't match, check for:
- Extra spaces
- Different month abbreviations
- Year included in one but not the other

## Example Data

```
Date              | Time  | Club Name  | Ladies/Men | Format    | Lead         | Second         | Third | Short Lead | Short Second | Short Third
------------------|-------|------------|------------|-----------|--------------|----------------|-------|------------|--------------|-------------
Sun, 27 April     | 14:00 | Balcombe   | Mixed      | 4 Triples | Anne Barnes  | Tracy McBride  |       | A Barnes   | T McBride    |
Wed, 30 April     | 14:00 | Newhaven   | Mixed      | 4 Triples | John Smith   | Mary Johnson   | Bob   | J Smith    | M Johnson    | Bob
Sat, 03 May       | 14:00 | Ringmer    | Mixed      | 4 Triples | Jane Doe     | Peter Brown    |       | J Doe      | P Brown      |
```

## Benefits

1. **Automation** - No manual lookup needed for tea duty
2. **Accuracy** - Always displays current tea rota information
3. **Consistency** - Standardized display across all match cards
4. **Flexibility** - Supports both full and short name formats
5. **Integration** - Seamlessly works with existing match card generation

## Future Enhancements

Potential future improvements:
- Auto-populate Tea Rota from Games sheet when season starts
- Email reminders to tea duty assignees
- Track who actually did tea duty vs who was assigned
- Rotation suggestions based on member availability
- Mobile notifications for upcoming tea duty
