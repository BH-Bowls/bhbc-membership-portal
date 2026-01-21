# Social Events System Setup

## Google Sheets Structure

You need to create a new Google Spreadsheet for the Social Events system.

### Environment Variable

Add to your `.env.local`:
```
SOCIAL_EVENTS_SPREADSHEET_ID=your_spreadsheet_id_here
```

---

## Sheet 1: SocialEvents

This sheet contains the list of all social events.

### Required Columns:

| Column Name | Description | Example Values |
|------------|-------------|----------------|
| `Date` | Full date (DD/MM/YYYY) | "13/01/2025", "20/01/2025" |
| `Time` | Event time | "14:00", "18:00", "10:00" |
| `Event Name` | Name of the social event | "Summer BBQ", "Quiz Night", "Bowls Trip to Bath" |
| `Tab Name` | Sheet tab identifier (populated automatically) | "Summer BBQ 13 Jan 25" |
| `Location` | Event location | "Clubhouse", "Green Room", "Victoria Park", "" |
| `Description` | Event description (optional) | "Annual summer barbecue with games", "Teams of 4, £5 entry" |
| `Status` | Event status | "" (not opened), "O" (open), "X" (closed), "S" (confirmed), "P" (completed), "C" (cancelled), "A" (archived) |
| `Max Capacity` | Maximum attendees allowed | 50, 100, 30, or blank for unlimited |
| `Entered` | Number of people entered | Calculated automatically |
| `Attending` | Number confirmed attending | Calculated automatically |
| `Waitlist` | Number on waitlist | Calculated automatically |

### Auto-Populated Fields:
- **`Tab Name`**: Leave empty when creating events. System populates as "Event Name DD MMM YY" (e.g., "Summer BBQ 13 Jan 25") when event opens/closes. Used as the sheet tab name.

### Notes:
- **No opponent club** (social events)
- **No home/away** (just location)
- **No format/ladies/men/dress** (not competitive)
- **No stats tracking** (unlike friendlies)
- **No captain selection** (unlike friendlies)
- **No team selection** (unlike internal games/friendlies)
- **Simple attendance tracking** (Yes/No/Maybe/Waitlist)

---

## Sheet 2: Members (Entry Matrix)

This sheet tracks which members have expressed interest in which events. Start with **just the header row**:

### Required Columns:

| Column Name | Description |
|------------|-------------|
| `User Name` | Member's username (added automatically when they enter) |

**Dynamic columns**: One column per event will be added automatically when events are opened.

### Notes:
- Start with EMPTY sheet (just `User Name` header)
- When a member expresses interest in an event, their username is added if not present
- When an offline member is added manually, their username is added if not present
- Member details (Full Name, Member Type) are looked up from the main MEMBERS_SPREADSHEET_ID

---

## Individual Event Sheets

When an event is closed for entry (status changes to 'X'), a new sheet tab is created automatically with the event's `Tab Name`.

### Example Tab Name:
`Summer BBQ 13 Jan 25`

### Required Columns (created automatically):

| Column Name | Description | Values |
|------------|-------------|---------|
| `User Name` | Member's username | From members list |
| `Attendance` | Attendance status | "Y" (attending), "N" (not attending), "M" (maybe), "W" (waitlist) |
| `Status` | Confirmation status | "" (no response), "Y" (confirmed), "W" (withdrawn) |

### Not Included (compared to Friendlies/Internal Games):
- ❌ No `Selected` (no team selection)
- ❌ No `Team` (no teams)
- ❌ No `Position` (no positions)
- ❌ No `Name Down` (stats)
- ❌ No `Picked` (stats)
- ❌ No `Percent Played` (stats)
- ❌ No `Driver Bar` (no driving initially)
- ❌ No `Driving` (no driving initially)
- ❌ No `Car Number` (no driving initially)
- ❌ No `Captain` (no captain)

---

## Workflow

### 1. Create Event
Add a new row to the `SocialEvents` sheet with event details.

### 2. Open for Entry
Set `Status` to "O" to allow members to express interest.

### 3. Close for Entry
Set `Status` to "X" - this creates the individual event sheet with all interested members.

### 4. Manage Attendance
Admin uses the manage interface to:
- Mark attendees as Attending (Y), Maybe (M), or Waitlist (W)
- Mark non-attendees as Not Attending (N)
- Handle capacity limits and waitlists

### 5. Confirm Event
Set `Status` to "S" - attendance list is now confirmed and visible to members.

### 6. After Event
Set `Status` to "P" for completed, or "C" for cancelled.

---

## Key Differences from Friendlies/Internal Games

| Feature | Friendlies | Internal Games | Social Events |
|---------|-----------|----------------|---------------|
| Opponent Club | ✅ Yes | ❌ No | ❌ No |
| Home/Away | ✅ Yes | ❌ No | ❌ No |
| Format/Dress | ✅ Yes | ✅ Yes | ❌ No |
| Stats Tracking | ✅ Yes | ❌ No | ❌ No |
| Captain Selection | ✅ Yes | ❌ No | ❌ No |
| Team Selection | ✅ Yes | ✅ Yes | ❌ No |
| Position Assignment | ✅ Yes | ✅ Yes | ❌ No |
| Attendance Tracking | ❌ No | ❌ No | ✅ Yes |
| Driving | ✅ Yes (away) | ❌ No | ❌ No (initially) |
| Bar Duty | ✅ Yes | ❌ No | ❌ No |
| Capacity Limits | ✅ Yes | ✅ Yes | ✅ Yes |

---

## Sample Data

### Events Sheet (when first created):

| Date | Time | Event Name | Tab Name | Location | Description | Status | Max Capacity | Entered | Attending | Waitlist |
|------|------|------------|----------|----------|-------------|--------|--------------|---------|-----------|----------|
| 13/01/2025 | 18:00 | Quiz Night | | Clubhouse | Teams of 4, £5 entry | | 40 | 0 | 0 | 0 |
| 20/01/2025 | 14:00 | Summer BBQ | | Main Green | Annual summer barbecue | | 100 | 0 | 0 | 0 |

### After opening events (Status → "O"):

| Date | Time | Event Name | Tab Name | Location | Description | Status | Max Capacity | Entered | Attending | Waitlist |
|------|------|------------|----------|----------|-------------|--------|--------------|---------|-----------|----------|
| 13/01/2025 | 18:00 | Quiz Night | Quiz Night 13 Jan 25 | Clubhouse | Teams of 4, £5 entry | O | 40 | 0 | 0 | 0 |
| 20/01/2025 | 14:00 | Summer BBQ | Summer BBQ 20 Jan 25 | Main Green | Annual summer barbecue | O | 100 | 0 | 0 | 0 |

**Note**: System auto-populates `Tab Name` when event status changes to ensure it matches the sheet tab name.

---

## Testing

1. **Create the spreadsheet** with the structure above
2. **Add the environment variable** to `.env.local`
3. **Grant service account access** to the spreadsheet (Editor permissions)
4. **Add sample events** to test the system
5. **Navigate to** `/social-events` to see the events list
6. **Test entry workflow** once implemented
