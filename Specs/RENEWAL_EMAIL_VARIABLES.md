# Renewal Email Template Variables

## Variables Found in Templates

### Email Template Variables
| Template Variable | Handlebars Variable | Source Sheet | Column Name | Notes |
|-------------------|---------------------|--------------|-------------|-------|
| `<<Full Known as>>` | `{{fullKnownAs}}` | Members | `full_known_as` | Member's preferred full name |

### Competition Entry Form Variables
| Template Variable | Handlebars Variable | Source Sheet | Column Name | Notes |
|-------------------|---------------------|--------------|-------------|-------|
| `<<Full Name>>` | `{{fullName}}` | Members | `full_known_as` | Member's full name |

### Membership Details Form Variables
| Template Variable | Handlebars Variable | Source Sheet | Column Name | Notes |
|-------------------|---------------------|--------------|-------------|-------|
| `<<Address>>` | `{{address}}` | Members | Combined | Full address: address_1, address_2, town, county, post_code |
| `<<Age Dem>>` | `{{ageDem}}` | Members | `age_demographic` | Age demographic category |
| `<<Bar Addn Info>>` | `{{barAddnInfo}}` | Members | `bar_additional_info` | Additional bar duty information |
| `<<Bar Duty>>` | `{{barDuty}}` | Members | `bar_duty` | Bar duty preference/status |
| `<<Driving Addn Info>>` | `{{drivingAddnInfo}}` | Members | `driving_additional_info` | Additional driving information |
| `<<Driving Away Matches>>` | `{{drivingAwayMatches}}` | Members | `driving_away_matches` | Driving availability for away matches |
| `<<Email Address>>` | `{{emailAddress}}` | Members | `email_address` | Member's email |
| `<<First Name>>` | `{{firstName}}` | Members | `first_name` | Member's first name |
| `<<Full Name>>` | `{{fullName}}` | Members | `full_known_as` | Member's full name |
| `<<Green / Clubhouse Maintenance>>` | `{{greenClubhouseMaintenance}}` | Members | `green_maintenance` | Maintenance volunteer preference |
| `<<Green Addn Info>>` | `{{greenAddnInfo}}` | Members | `green_additional_info` | Additional green maintenance info |
| `<<Handbook Entry>>` | `{{handbookEntry}}` | Members | `handbook_entry` | Handbook entry preference (boolean: Yes/No) |
| `<<Known as>>` | `{{knownAs}}` | Members | `known_as` | Member's preferred name |
| `<<Landline>>` | `{{landline}}` | Members | `landline` | Member's landline number |
| `<<Last Name>>` | `{{lastName}}` | Members | `last_name` | Member's last name |
| `<<Mobile>>` | `{{mobile}}` | Members | `mobile` | Member's mobile number |
| `<<Other Skills>>` | `{{otherSkills}}` | Members | `other_skills` | Other skills/volunteer areas |
| `<<Social Emails>>` | `{{socialEmails}}` | Members | `social_emails` | Social email preference (boolean: Yes/No) |

## Variable Naming Conversion Rules

### Space to CamelCase
- `<<Full Known as>>` → `{{fullKnownAs}}`
- `<<Age Dem>>` → `{{ageDem}}`
- `<<Bar Addn Info>>` → `{{barAddnInfo}}`
- `<<Bar Duty>>` → `{{barDuty}}`
- `<<Driving Addn Info>>` → `{{drivingAddnInfo}}`
- `<<Driving Away Matches>>` → `{{drivingAwayMatches}}`
- `<<Email Address>>` → `{{emailAddress}}`
- `<<First Name>>` → `{{firstName}}`
- `<<Full Name>>` → `{{fullName}}`
- `<<Green / Clubhouse Maintenance>>` → `{{greenClubhouseMaintenance}}`
- `<<Green Addn Info>>` → `{{greenAddnInfo}}`
- `<<Handbook Entry>>` → `{{handbookEntry}}`
- `<<Known as>>` → `{{knownAs}}`
- `<<Last Name>>` → `{{lastName}}`
- `<<Other Skills>>` → `{{otherSkills}}`
- `<<Social Emails>>` → `{{socialEmails}}`

### Special Characters
- `/` is removed: `Green / Clubhouse` → `greenClubhouse`
- Multiple spaces become one camelCase boundary

## Data Source Mapping - COMPLETE ✅

All variables have been mapped to Members sheet columns:

### Confirmed Column Mappings:
1. **Address Fields:**
   - `<<Address>>` → Combined from: `address_1`, `address_2`, `town`, `county`, `post_code`

2. **Volunteer/Duty Fields:**
   - `<<Bar Duty>>` → `bar_duty`
   - `<<Bar Addn Info>>` → `bar_additional_info`
   - `<<Driving Away Matches>>` → `driving_away_matches`
   - `<<Driving Addn Info>>` → `driving_additional_info`
   - `<<Green / Clubhouse Maintenance>>` → `green_maintenance`
   - `<<Green Addn Info>>` → `green_additional_info`
   - `<<Other Skills>>` → `other_skills`

3. **Preference Fields:**
   - `<<Handbook Entry>>` → `handbook_entry` (boolean)
   - `<<Social Emails>>` → `social_emails` (boolean)

## Implementation Notes

### Variable Conversion Function

The system will automatically convert variables using this algorithm:

```typescript
function convertVariableName(templateVar: string): string {
  // Remove << and >>
  let name = templateVar.replace(/<<|>>/g, '');

  // Trim whitespace
  name = name.trim();

  // Remove special characters (/, etc.)
  name = name.replace(/[\/]/g, ' ');

  // Split by spaces
  const words = name.split(/\s+/);

  // First word lowercase, rest capitalized
  let result = words[0].toLowerCase();
  for (let i = 1; i < words.length; i++) {
    result += words[i].charAt(0).toUpperCase() + words[i].slice(1).toLowerCase();
  }

  return result;
}
```

### Example Conversions:
- `convertVariableName('<<Full Known as>>')` → `'fullKnownAs'`
- `convertVariableName('<<Green / Clubhouse Maintenance>>')` → `'greenClubhouseMaintenance'`
- `convertVariableName('<<Age Dem>>')` → `'ageDem'`

## Template Processing

When sending emails, the system will:

1. Load member data from Members sheet
2. Load renewal data from Renewals sheet (if needed)
3. Build variables object with all mapped fields
4. Convert `<<variable>>` to `{{variable}}` in templates
5. Use Handlebars to replace variables with actual data
6. Generate PDFs from DOCX templates
7. Send email with populated content

## Next Steps

1. **System Implementation:** ✅ All column mappings identified
2. **Create variable mapping utility:** Build function that combines address fields and formats boolean values
3. **Testing:** Verify all variables are populated correctly in generated PDFs and emails

## Special Handling Required

### Address Field
The `<<Address>>` variable needs special handling to combine multiple fields:
```typescript
const address = [
  member.address1,
  member.address2,
  member.town,
  member.county,
  member.postCode
].filter(Boolean).join(', ');
```

### Boolean Fields
Convert boolean values to user-friendly strings:
- `handbook_entry`: true → "Yes", false → "No"
- `social_emails`: true → "Yes", false → "No"
