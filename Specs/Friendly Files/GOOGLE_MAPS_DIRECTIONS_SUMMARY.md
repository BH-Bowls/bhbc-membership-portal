# Google Maps Directions Integration - Summary

## Overview

Match cards for away games now include a **one-click directions link** from Burgess Hill Bowls Club (BHBC) to the destination venue using GPS coordinates.

---

## Key Features

### 🗺️ Automatic Directions Generation

Every away game match card automatically includes:
- Hyperlink from venue address: **"Get Directions from BHBC"**
- Uses GPS coordinates (latitude/longitude) from clubs sheet
- Opens in Google Maps with route from BHBC to destination

### 📍 URL Format

```
https://www.google.com/maps/dir/?api=1
  &origin=Burgess+Hill+Bowls+Club
  &origin_place_id=ChIJcfipELGNdUgRmS1st4mG9X0
  &destination={latitude}%2C{longitude}
```

**Components:**
- `origin`: Burgess Hill Bowls Club (text name)
- `origin_place_id`: ChIJcfipELGNdUgRmS1st4mG9X0 (Google Place ID for BHBC)
- `destination`: GPS coordinates from clubs sheet (e.g., 50.9254976,-0.1375561)

---

## Implementation

### Database Layer

**clubs Sheet in Match Day Contacts:**
```
Club Name | ... | Latitude  | Longitude
----------|-----|-----------|----------
Balcombe  | ... | 50.925498 | -0.137556
Newhaven  | ... | 50.792344 | 0.058421
```

### API Layer

```typescript
// lib/sheets/friendlies.ts

export async function getClubDetails(clubName: string) {
  // ... fetch club data
  
  return {
    clubName: matchingRow[0],
    // ... other fields
    latitude: matchingRow[16] || '',
    longitude: matchingRow[17] || '',
  };
}
```

### Match Card API

```typescript
// app/api/friendlies/match-card/[tabDate]/route.ts

// Constants
const BHBC_PLACE_ID = 'ChIJcfipELGNdUgRmS1st4mG9X0';

// Get club details for away games
if (game.homeAway === 'A') {
  clubDetails = await getClubDetails(game.clubName);
  
  // Generate directions URL
  if (clubDetails && clubDetails.latitude && clubDetails.longitude) {
    directionsUrl = `https://www.google.com/maps/dir/?api=1` +
      `&origin=Burgess+Hill+Bowls+Club` +
      `&origin_place_id=${BHBC_PLACE_ID}` +
      `&destination=${clubDetails.latitude}%2C${clubDetails.longitude}`;
  }
}

// Include in response
return NextResponse.json({
  clubDetails: clubDetails ? {
    // ... other fields
    directionsUrl: directionsUrl,
  } : null,
});
```

### UI Component

```typescript
// components/friendlies/MatchCard.tsx

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
  </div>
)}
```

---

## Match Card Display Example

### Before:

```
Venue:
  Balcombe Recreation Ground
  Haywards Heath Road
  Balcombe, West Sussex
  RH17 6PA

General Information:
  Park in main car park
```

### After:

```
Venue:
  Balcombe Recreation Ground
  Haywards Heath Road
  Balcombe, West Sussex
  RH17 6PA
  [📍 Get Directions from BHBC] ← clickable hyperlink

General Information:
  Park in main car park
```

---

## User Experience

### Desktop
1. Click "Get Directions from BHBC" link
2. Opens Google Maps in browser
3. Shows route from BHBC to destination
4. Displays estimated time and distance
5. Offers route alternatives

### Mobile
1. Tap "Get Directions from BHBC" link
2. Opens Google Maps app (if installed)
3. Auto-loads route from BHBC
4. One tap to "Start" navigation
5. Turn-by-turn voice guidance ready

---

## Clickable Contact Links

All phone numbers and email addresses on match cards are displayed as clickable links for easy access.

### Phone Numbers (tel: links)

**Implementation:**
```typescript
// Remove spaces for href, keep spaces for display
<a href={`tel:${phoneNumber.replace(/\s/g, '')}`}>
  {phoneNumber}
</a>
```

**Example:**
```html
<!-- Display: 07700 900123 -->
<a href="tel:07700900123">07700 900123</a>
```

**User Experience:**
- **Mobile:** Tap → Opens phone app ready to dial
- **Desktop:** Click → Opens default phone/Skype app

### Email Addresses (mailto: links)

**Implementation:**
```typescript
<a href={`mailto:${email}`}>
  {email}
</a>
```

**Example:**
```html
<a href="mailto:john.smith@email.com">john.smith@email.com</a>
```

**User Experience:**
- **Mobile:** Tap → Opens email app with recipient pre-filled
- **Desktop:** Click → Opens default email client

### Applies To

**Club-Level Contacts:**
- Club Phone (from clubs sheet)
- Club Mobile (from clubs sheet)
- Club Email (from clubs sheet)

**Individual Contacts:**
- Phone Number (from Contacts sheet)
- Mobile Number (from Contacts sheet)
- Email (from Contacts sheet)

---

## Benefits

✅ **One-Click Navigation** - No manual address entry needed
✅ **Accurate Location** - Uses GPS coordinates, not just text address
✅ **Consistent Starting Point** - Always from BHBC, not user's current location
✅ **Mobile Optimized** - Opens directly in maps app
✅ **Desktop Compatible** - Works in web browsers too
✅ **Real-Time Routes** - Google Maps provides current traffic conditions
✅ **Alternative Routes** - Users can choose fastest, shortest, or scenic routes
✅ **Clickable Phone Numbers** - All phone numbers use tel: links for one-tap calling
✅ **Clickable Emails** - All email addresses use mailto: links for one-tap messaging

---

## Data Requirements

### Essential
- **Latitude** (Column Q in clubs sheet)
- **Longitude** (Column R in clubs sheet)

### Optional but Recommended
- Address fields (for display)
- Post code (for reference)

### How to Get Coordinates

**Method 1: Google Maps**
1. Find venue on Google Maps
2. Right-click on location
3. Click on coordinates to copy
4. Paste into clubs sheet

**Method 2: Google Search**
1. Search "what3words [venue name]"
2. Visit what3words website
3. View coordinates in URL or page
4. Enter into clubs sheet

**Format:**
- Latitude: Decimal degrees (e.g., 50.925498)
- Longitude: Decimal degrees (e.g., -0.137556)
- Use 6-7 decimal places for accuracy

---

## Error Handling

### Missing Coordinates
**Behavior:** Directions link not displayed
**User Impact:** Can still see address, just no one-click directions
**Fix:** Add latitude/longitude to clubs sheet

### Invalid Coordinates
**Behavior:** Link may not work or go to wrong location
**User Impact:** May get lost or confused
**Fix:** Verify coordinates are correct decimal degrees

### No GPS/Internet
**Behavior:** Link won't open
**User Impact:** Need alternative directions
**Fallback:** Print address is still visible on match card

---

## Testing Checklist

**Directions Link:**
- [ ] Directions link displays on away game match cards
- [ ] Directions link does NOT display on home game match cards
- [ ] Link opens from BHBC to correct destination
- [ ] Works on desktop browsers
- [ ] Works on mobile devices (opens Maps app)
- [ ] Missing coordinates handled gracefully (no link shown)
- [ ] Invalid coordinates detected and handled
- [ ] Link opens in new tab/window (target="_blank")
- [ ] Route shows estimated time and distance
- [ ] Multiple route options available

**Phone Links (tel:):**
- [ ] All phone numbers are clickable
- [ ] Tel links work on mobile (open phone app)
- [ ] Tel links work on desktop (open phone/Skype app)
- [ ] Spaces removed from href (e.g., tel:07700900123)
- [ ] Display keeps spaces for readability (e.g., 07700 900123)
- [ ] Club phone numbers are clickable
- [ ] Club mobile numbers are clickable
- [ ] Contact phone numbers are clickable
- [ ] Contact mobile numbers are clickable

**Email Links (mailto:):**
- [ ] All email addresses are clickable
- [ ] Mailto links work on mobile (open email app)
- [ ] Mailto links work on desktop (open email client)
- [ ] Recipient pre-filled when opened
- [ ] Club email addresses are clickable
- [ ] Contact email addresses are clickable

---

## Troubleshooting

### Link Not Appearing

**Check:**
1. Is it an away game? (H/A = "A")
2. Does club have latitude/longitude values?
3. Are coordinates valid numbers?

**Debug:**
```typescript
console.log('Club Details:', clubDetails);
console.log('Latitude:', clubDetails?.latitude);
console.log('Longitude:', clubDetails?.longitude);
console.log('Directions URL:', directionsUrl);
```

### Wrong Destination

**Symptoms:**
- Map opens but shows wrong location
- Coordinates way off

**Causes:**
- Latitude/longitude swapped
- Wrong decimal places or format
- Coordinates for different venue

**Fix:**
1. Look up venue on Google Maps
2. Verify coordinates are correct
3. Update clubs sheet

### Link Not Opening on Mobile

**Causes:**
- Google Maps app not installed
- Browser blocking pop-ups
- Invalid URL format

**Solutions:**
- Install Google Maps app
- Allow pop-ups for site
- Try different browser

---

## Constants Reference

```typescript
// Burgess Hill Bowls Club
const BHBC_COORDS = {
  latitude: 51.9608,
  longitude: -0.1256,
  placeId: 'ChIJcfipELGNdUgRmS1st4mG9X0',
  name: 'Burgess Hill Bowls Club',
};

// Google Maps Directions API
const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/';
const API_PARAM = '?api=1';
```

---

## Integration Points

### Updated Files

1. **Technical Spec** (`FRIENDLIES_TECHNICAL_SPEC.md`)
   - Section 4.7: Added directions URL format

2. **Implementation Guide** (`FRIENDLIES_IMPLEMENTATION_GUIDE.md`)
   - Section 3.1: Added latitude/longitude to getClubDetails
   - Section 5.1: Added directions URL generation
   - Section 8: Environment variables (MATCH_DAY_CONTACTS_SPREADSHEET_ID)

3. **Changes Log** (`FRIENDLIES_CHANGES_LOG.md`)
   - Section 5: Added Google Maps directions feature
   - Added test cases for directions

4. **Match Day Contacts Quick Reference** (`MATCH_DAY_CONTACTS_QUICK_REFERENCE.md`)
   - Added Google Maps Directions section
   - Updated display examples
   - Added troubleshooting guide

---

## Future Enhancements

Potential improvements:
- **Estimated Travel Time**: Display time/distance before clicking
- **Alternative Origins**: Allow directions from member's current location
- **Carpool Routes**: Optimize route for picking up multiple members
- **Traffic Alerts**: Notify captain if delays expected
- **Historical Times**: Show typical journey time based on past data
- **Route Preview**: Show map thumbnail on match card
- **Save to Calendar**: Include directions in calendar invite

---

## Summary

The Google Maps directions integration provides a seamless navigation experience for away games by:

1. **Automating** directions link generation from GPS coordinates
2. **Simplifying** navigation with one-click access
3. **Ensuring** consistency by always starting from BHBC
4. **Supporting** both desktop and mobile users
5. **Maintaining** accuracy through GPS coordinates vs text addresses

This feature eliminates the need for members to manually enter addresses, reduces the chance of getting lost, and provides real-time routing with traffic updates - all from a single click on the match card.

---

## Quick Reference Card

```
┌─────────────────────────────────────────┐
│  Google Maps Directions                 │
├─────────────────────────────────────────┤
│  Origin: Burgess Hill Bowls Club        │
│  Place ID: ChIJcfipELGNdUgRmS1st4mG9X0  │
│                                          │
│  Destination: GPS coordinates from       │
│               clubs sheet (Lat, Long)    │
│                                          │
│  Display: Away games only (H/A = "A")   │
│                                          │
│  Link Text: "Get Directions from BHBC"  │
│                                          │
│  Opens: Google Maps app/browser         │
│                                          │
│  Provides: Route, time, distance,       │
│            alternatives, traffic         │
└─────────────────────────────────────────┘
```
