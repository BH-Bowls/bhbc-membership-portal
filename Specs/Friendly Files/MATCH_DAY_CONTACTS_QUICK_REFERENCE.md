# Match Day Contacts Integration - Quick Reference

## Overview

The Match Day Contacts spreadsheet provides club details and contact information for away games. This data is automatically included on match cards to help players with directions, petrol costs, and who to contact at the opposing club.

## Spreadsheet Location

**Spreadsheet Name:** Match Day Contacts  
**Contains 2 Sheets:**
1. **clubs** - Club details, addresses, and driving costs
2. **Contacts** - Individual contact persons at each club

---

## Sheet 1: clubs

### Column Structure

| Column | Name | Example | Notes |
|--------|------|---------|-------|
| A | Club Name | "Balcombe" | Exact match to Games sheet |
| B | Club Number | "01444 811233" | Main club phone |
| C | Club Mobile | "07700 900123" | Club mobile phone |
| D | Club email Address | "secretary@balcombe.co.uk" | Main email |
| E | Club email Note | "Secretary only" | Email usage notes |
| F | General Information | "Park in main car park" | Useful info for visitors |
| G | Driving Band | "B" | Cost code: A/B/C/D |
| H | Address 1 | "Balcombe Recreation Ground" | First line of address |
| I | Address 2 | "Haywards Heath Road" | Second line |
| J | Address 3 | "Balcombe" | Town/village |
| K | Address 4 | "West Sussex" | County |
| L | Post Code | "RH17 6PA" | Postcode |
| M | Google Address | "Balcombe Bowls Club" | For Google Maps |
| N | Bowls England URL | "https://..." | Bowls England link |
| O | Website | "https://balcombebowls.co.uk" | Club website |
| P | BH Website | "/clubs/balcombe" | Internal website path |
| Q | Latitude | "51.0536" | GPS coordinate |
| R | Longitude | "-0.1355" | GPS coordinate |

### Driving Band Codes

**Petrol Cost Calculation:**

| Code | Cost per Person |
|------|-----------------|
| A | £2.00 |
| B | £3.00 |
| C | £4.00 |
| D | £5.00 |

**Purpose:** Helps members calculate petrol contribution for car sharing to away games.

---

## Sheet 2: Contacts

### Column Structure

| Column | Name | Example | Notes |
|--------|------|---------|-------|
| A | Club Name | "Balcombe" | Links to clubs sheet |
| B | Role | "Captain" | Captain, Secretary, etc. |
| C | First Name | "John" | Contact's first name |
| D | Last Name | "Smith" | Contact's surname |
| E | Name | "John Smith" | Full name |
| F | Phone Number | "01444 123456" | Home/work phone |
| G | Mobile Number | "07700 900123" | Mobile phone |
| H | Notes | "Available weekdays only" | Additional info |
| I | Email | "john.smith@email.com" | Email address |

### Contact Roles

**Priority Order for Display:**
1. **Captain** - Primary contact (shown first)
2. **Secretary** - Secondary contact
3. **Other roles** - Additional contacts

Multiple contacts can exist for the same club with different roles.

---

## How It Works

### For Away Games (H/A = "A")

The system automatically:
1. Matches game to club using **Club Name**
2. Retrieves club details from **clubs** sheet
3. Retrieves contacts from **Contacts** sheet
4. Displays information on match card

### For Home Games (H/A = "H")

Club details and contacts are **not displayed** (not needed for home games).

---

## Match Card Display

### Away Game Example:

```
BALCOMBE - Wednesday, 30 April 2025 - 14:00
Away - 4 Triples - Mixed

Teams: [team details]

Venue:
  Balcombe Recreation Ground
  Haywards Heath Road
  Balcombe, West Sussex
  RH17 6PA
  [Get Directions from BHBC]

General Information:
  Park in main car park

Petrol Cost: £3.00 per person (Band B)

Contact:
  Captain: John Smith
  Mobile: 07700 900123 (clickable tel: link)
  Email: john.smith@email.com (clickable mailto: link)

Captain: Jane Mackenzie
```

**Note:** 
- All phone numbers are clickable with `tel:` links
- All email addresses are clickable with `mailto:` links
- The venue address includes a hyperlink to Google Maps with directions from Burgess Hill Bowls Club to the destination using GPS coordinates.

### Compact Display:

```
BALCOMBE | Away | 30 Apr 14:00

Venue: Balcombe Recreation Ground, RH17 6PA [Directions]
Info: Park in main car park
Petrol: £3.00 (Band B)
Contact: John Smith (Captain) - 07700 900123 (clickable)
```

**All displayed phone numbers and emails should be clickable links.**

---

## Implementation Code

### Database Functions

```typescript
// lib/sheets/friendlies.ts

export async function getClubDetails(clubName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MATCH_DAY_CONTACTS_SPREADSHEET_ID,
    range: 'clubs!A:R',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  // Find matching club
  const matchingRow = rows.find((row, index) => {
    if (index === 0) return false; // Skip header
    return row[0] === clubName;
  });

  if (!matchingRow) return null;

  // Map driving band to cost
  const drivingBandMap: { [key: string]: number } = {
    'A': 2.00,
    'B': 3.00,
    'C': 4.00,
    'D': 5.00,
  };

  const drivingBand = matchingRow[6] || '';
  const petrolCost = drivingBandMap[drivingBand] || 0;

  return {
    clubName: matchingRow[0],
    clubNumber: matchingRow[1] || '',
    clubMobile: matchingRow[2] || '',
    clubEmail: matchingRow[3] || '',
    clubEmailNote: matchingRow[4] || '',
    generalInfo: matchingRow[5] || '',
    drivingBand: drivingBand,
    petrolCost: petrolCost,
    address1: matchingRow[7] || '',
    address2: matchingRow[8] || '',
    address3: matchingRow[9] || '',
    address4: matchingRow[10] || '',
    postCode: matchingRow[11] || '',
    googleAddress: matchingRow[12] || '',
    bowlsEnglandUrl: matchingRow[13] || '',
    website: matchingRow[14] || '',
    bhWebsite: matchingRow[15] || '',
    latitude: matchingRow[16] || '',
    longitude: matchingRow[17] || '',
  };
}

export async function getClubContacts(clubName: string) {
  const sheets = await getSheetsClient();
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: MATCH_DAY_CONTACTS_SPREADSHEET_ID,
    range: 'Contacts!A:I',
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  // Find all contacts for this club
  const clubContacts = rows
    .filter((row, index) => {
      if (index === 0) return false; // Skip header
      return row[0] === clubName;
    })
    .map(row => ({
      clubName: row[0],
      role: row[1] || '',
      firstName: row[2] || '',
      lastName: row[3] || '',
      name: row[4] || '',
      phoneNumber: row[5] || '',
      mobileNumber: row[6] || '',
      notes: row[7] || '',
      email: row[8] || '',
    }));

  // Sort by role preference (Captain first, then Secretary)
  const roleOrder: { [key: string]: number } = {
    'Captain': 1,
    'Secretary': 2,
  };

  clubContacts.sort((a, b) => {
    const aOrder = roleOrder[a.role] || 99;
    const bOrder = roleOrder[b.role] || 99;
    return aOrder - bOrder;
  });

  return clubContacts;
}
```

### API Endpoint Usage

```typescript
// app/api/friendlies/match-card/[tabDate]/route.ts

// Get club details and contacts for away games
let clubDetails = null;
let clubContacts: any[] = [];

if (game.homeAway === 'A') {
  clubDetails = await getClubDetails(game.clubName);
  clubContacts = await getClubContacts(game.clubName);
}

// Generate Google Maps directions link
let directionsUrl = null;
if (clubDetails && clubDetails.latitude && clubDetails.longitude) {
  const originPlaceId = 'ChIJcfipELGNdUgRmS1st4mG9X0'; // Burgess Hill Bowls Club
  directionsUrl = `https://www.google.com/maps/dir/?api=1` +
    `&origin=Burgess+Hill+Bowls+Club` +
    `&origin_place_id=${originPlaceId}` +
    `&destination=${clubDetails.latitude}%2C${clubDetails.longitude}`;
}

// Include in response
return NextResponse.json({
  game: { /* game details */ },
  teams: [ /* teams */ ],
  clubDetails: clubDetails ? {
    address: [
      clubDetails.address1,
      clubDetails.address2,
      clubDetails.address3,
      clubDetails.address4,
      clubDetails.postCode,
    ].filter(Boolean).join(', '),
    postCode: clubDetails.postCode,
    generalInfo: clubDetails.generalInfo,
    petrolCost: clubDetails.petrolCost,
    drivingBand: clubDetails.drivingBand,
    googleAddress: clubDetails.googleAddress,
    website: clubDetails.website,
    directionsUrl: directionsUrl,
  } : null,
  clubContacts: clubContacts.length > 0 ? clubContacts.map(c => ({
    name: c.name,
    role: c.role,
    phone: c.phoneNumber,
    mobile: c.mobileNumber,
    email: c.email,
    notes: c.notes,
  })) : null,
});
```

### UI Component Display

```typescript
// components/friendlies/MatchCard.tsx

{game.homeAway === 'A' && (
  <>
    {clubDetails && (
      <div className="venue-section">
        <h3>Venue</h3>
        <div className="address">
          {clubDetails.address1 && <div>{clubDetails.address1}</div>}
          {clubDetails.address2 && <div>{clubDetails.address2}</div>}
          {clubDetails.address3 && <div>{clubDetails.address3}</div>}
          {clubDetails.address4 && <div>{clubDetails.address4}</div>}
          {clubDetails.postCode && <div><strong>{clubDetails.postCode}</strong></div>}
        </div>
        
        {clubDetails.directionsUrl && (
          <div className="directions-link">
            <a 
              href={clubDetails.directionsUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="btn btn-primary"
            >
              📍 Get Directions from BHBC
            </a>
          </div>
        )}
        
        {clubDetails.generalInfo && (
          <div className="general-info">
            <strong>Information:</strong> {clubDetails.generalInfo}
          </div>
        )}
        
        <div className="petrol-cost">
          <strong>Petrol Cost:</strong> £{clubDetails.petrolCost.toFixed(2)} per person
          {clubDetails.drivingBand && ` (Band ${clubDetails.drivingBand})`}
        </div>
        
        {/* Club-level contact info (if available) */}
        {clubDetails.clubNumber && (
          <div className="club-phone">
            <strong>Club Phone:</strong>{' '}
            <a href={`tel:${clubDetails.clubNumber.replace(/\s/g, '')}`}>
              {clubDetails.clubNumber}
            </a>
          </div>
        )}
        
        {clubDetails.clubMobile && (
          <div className="club-mobile">
            <strong>Club Mobile:</strong>{' '}
            <a href={`tel:${clubDetails.clubMobile.replace(/\s/g, '')}`}>
              {clubDetails.clubMobile}
            </a>
          </div>
        )}
        
        {clubDetails.clubEmail && (
          <div className="club-email">
            <strong>Club Email:</strong>{' '}
            <a href={`mailto:${clubDetails.clubEmail}`}>
              {clubDetails.clubEmail}
            </a>
          </div>
        )}
        
        {clubDetails.website && (
          <div className="website">
            <a href={clubDetails.website} target="_blank" rel="noopener noreferrer">
              Club Website
            </a>
          </div>
        )}
      </div>
    )}
    
    {clubContacts && clubContacts.length > 0 && (
      <div className="contacts-section">
        <h3>Contact{clubContacts.length > 1 ? 's' : ''}</h3>
        {clubContacts.map((contact, idx) => (
          <div key={idx} className="contact">
            <div className="contact-name">
              <strong>{contact.name}</strong>
              {contact.role && ` (${contact.role})`}
            </div>
            {contact.mobile && (
              <div>
                <strong>Mobile:</strong>{' '}
                <a href={`tel:${contact.mobile.replace(/\s/g, '')}`}>
                  {contact.mobile}
                </a>
              </div>
            )}
            {contact.phone && (
              <div>
                <strong>Phone:</strong>{' '}
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                  {contact.phone}
                </a>
              </div>
            )}
            {contact.email && (
              <div>
                <strong>Email:</strong>{' '}
                <a href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              </div>
            )}
            {contact.notes && (
              <div className="contact-notes"><em>{contact.notes}</em></div>
            )}
          </div>
        ))}
      </div>
    )}
  </>
)}
```

**Important Notes:**
- **All phone numbers** use `tel:` links with spaces removed for proper dialing
- **All email addresses** use `mailto:` links for one-click email composition
- Links open in appropriate app on mobile (Phone, Mail)
- Format: `<a href="tel:07700900123">07700 900123</a>` (spaces removed in href)
- Format: `<a href="mailto:name@email.com">name@email.com</a>`

---

## Data Management

### Adding New Clubs

**In clubs sheet:**
1. Add row with club name matching exactly as in Games sheet
2. Fill in address details (Address 1-4, Post Code)
3. Set Driving Band (A/B/C/D based on distance)
4. Add General Information (parking, access notes, etc.)
5. Optional: Add phone numbers, email, website

**In Contacts sheet:**
1. Add captain with Club Name, Role="Captain", full contact details
2. Add secretary with Role="Secretary"
3. Add other contacts as needed

### Updating Club Information

**Common Updates:**
- Address changes: Update Address 1-4 and Post Code
- Driving Band: Update if distance/cost changes
- Contacts: Add/remove/update in Contacts sheet
- General Info: Update parking, access instructions

### Driving Band Assessment

**Guidelines for setting bands:**
- **Band A (£2):** < 10 miles (local clubs)
- **Band B (£3):** 10-20 miles (nearby)
- **Band C (£4):** 20-35 miles (moderate distance)
- **Band D (£5):** 35+ miles (distant)

*Adjust based on actual travel time and road conditions*

---

## Testing Checklist

**Club Details:**
- [ ] Club details display on away game match cards
- [ ] Club details do NOT display on home game match cards
- [ ] Address displays correctly formatted
- [ ] Post code displays prominently
- [ ] Google Maps directions link displays and works correctly
- [ ] Directions link opens from BHBC to correct destination
- [ ] Directions use GPS coordinates (latitude/longitude)
- [ ] General information displays when present
- [ ] Missing club details handled gracefully

**Petrol Costs:**
- [ ] Band A = £2.00 ✓
- [ ] Band B = £3.00 ✓
- [ ] Band C = £4.00 ✓
- [ ] Band D = £5.00 ✓
- [ ] Invalid/missing band handled (shows £0.00 or hidden)

**Contacts:**
- [ ] Captain displays first (if present)
- [ ] Secretary displays second (if present)
- [ ] Multiple contacts display correctly
- [ ] Phone numbers are clickable (tel: links)
- [ ] Email addresses are clickable (mailto: links)
- [ ] Missing contacts handled gracefully

**Matching:**
- [ ] Clubs matched correctly by exact name
- [ ] Case-sensitive matching works
- [ ] Missing club data doesn't break match cards

---

## Troubleshooting

### Club Details Not Displaying

**Check:**
1. Is the game an away game (H/A = "A")?
2. Does the club name in Games sheet match exactly (case-sensitive)?
3. Does the club exist in clubs sheet?

**Common Issues:**
- Spelling differences (e.g., "St. Johns" vs "St Johns")
- Extra spaces before/after club name
- Different punctuation

### Petrol Cost Shows £0.00

**Check:**
1. Is Driving Band column populated?
2. Is the band code valid (A, B, C, or D)?
3. Check for typos or lowercase letters

### Contact Not Appearing

**Check:**
1. Does contact exist in Contacts sheet?
2. Does Club Name match exactly?
3. Is the contact for the correct club?

**Role Priority:**
If multiple contacts exist, only the highest priority roles may display:
1. Captain (always shown first)
2. Secretary (shown second)
3. Others (shown in order found)

### Directions Link Not Working

**Check:**
1. Does the club have latitude and longitude values?
2. Are the GPS coordinates valid numbers?
3. Is the link opening in a browser or map app?

**Common Issues:**
- Missing latitude/longitude → No directions link shown
- Invalid coordinates (non-numeric) → Link won't work
- Mobile: Should open in Google Maps app
- Desktop: Opens in Google Maps web version

**Manual Fix:**
If coordinates are missing or invalid:
1. Look up venue on Google Maps
2. Right-click location and select coordinates
3. Update clubs sheet with correct latitude/longitude

---

## Advanced Features

### Google Maps Integration

Using the `googleAddress` field:

```typescript
const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clubDetails.googleAddress)}`;
```

### Google Maps Directions from BHBC

The system automatically generates directions from Burgess Hill Bowls Club to the away venue:

```typescript
// Constants
const BHBC_PLACE_ID = 'ChIJcfipELGNdUgRmS1st4mG9X0';
const BHBC_NAME = 'Burgess Hill Bowls Club';

// Generate directions URL using GPS coordinates
if (clubDetails && clubDetails.latitude && clubDetails.longitude) {
  const directionsUrl = `https://www.google.com/maps/dir/?api=1` +
    `&origin=${encodeURIComponent(BHBC_NAME)}` +
    `&origin_place_id=${BHBC_PLACE_ID}` +
    `&destination=${clubDetails.latitude}%2C${clubDetails.longitude}`;
}
```

**Example URL:**
```
https://www.google.com/maps/dir/?api=1
  &origin=Burgess+Hill+Bowls+Club
  &origin_place_id=ChIJcfipELGNdUgRmS1st4mG9X0
  &destination=50.9254976%2C-0.1375561
```

**Benefits:**
- One-click directions from BHBC to away venue
- Uses GPS coordinates for accuracy
- Opens in Google Maps app on mobile devices
- Works on desktop browsers too
- Shows estimated travel time and route options

### GPS Navigation

Using latitude/longitude:

```typescript
const gpsUrl = `https://www.google.com/maps/search/?api=1&query=${clubDetails.latitude},${clubDetails.longitude}`;
```

### Multiple Contacts Display

```typescript
// Filter contacts by role
const captains = clubContacts.filter(c => c.role === 'Captain');
const secretaries = clubContacts.filter(c => c.role === 'Secretary');
const others = clubContacts.filter(c => !['Captain', 'Secretary'].includes(c.role));

// Display in priority order
const orderedContacts = [...captains, ...secretaries, ...others];
```

---

## Benefits

1. **Convenience** - All away game details in one place
2. **Cost Transparency** - Clear petrol cost expectations
3. **Easy Contact** - Direct links to phone/email contacts
4. **Navigation Ready** - One-click directions from BHBC using GPS coordinates
5. **Accurate Routing** - Uses latitude/longitude for precise navigation
6. **Mobile Friendly** - Opens directly in Google Maps app on phones
7. **Consistent Display** - Standardized information across all matches
8. **Offline Access** - Print match cards with all details

---

## Integration Summary

### Data Flow

```
Games Sheet (Club Name)
    ↓
Match Day Contacts → clubs sheet (address, driving band)
    ↓
Match Day Contacts → Contacts sheet (people)
    ↓
Match Card API (combines data)
    ↓
Match Card Component (displays for away games only)
```

### Automatic Population

When captain generates match card:
- System checks H/A field
- If "A": Fetches club details + contacts
- If "H": Only shows tea rota (from different system)
- Displays appropriate information automatically

---

## Future Enhancements

Potential improvements:
- **Embedded Maps:** Show map preview on match card (not just link)
- **Weather:** Current weather at away venue
- **Traffic Updates:** Real-time travel time with traffic conditions
- **Nearby Facilities:** Restaurants, petrol stations, parking
- **Club History:** Past results against this club
- **Photo Gallery:** Images of away venues
- **Check-in System:** Track who's arrived at away games
- **Parking Availability:** Real-time parking status
- **Carpool Matching:** Help members organize shared rides
