# BHBC Membership Portal — Google Sheets Schema

## Overview

The portal uses **six Google Spreadsheets** (seven environment variables) as its database:

| Environment Variable | Purpose |
|---|---|
| `MEMBERS_SPREADSHEET_ID` | Core member data, auth, renewals, audit logs, suggestions, invite games |
| `FRIENDLIES_SPREADSHEET_ID` | Friendlies/fixtures scheduling, player rosters, per-game tabs |
| `MATCH_DAY_CONTACTS_SPREADSHEET_ID` | Opponent clubs, contacts, petrol bands |
| `COMPETITIONS_SPREADSHEET_ID` | Club knockout competitions (11 comps) |
| `ROWLAND_SPREADSHEET_ID` | Rowland Cup inter-club knock-out |
| `LEAGUES_SPREADSHEET_ID` | Internal club league system |
| `PORTAL_CONFIG_SPREADSHEET_ID` | Key-value configuration/labels |

Additionally, game-management subsystems each have their own spreadsheet:
- `INTERNAL_GAMES_SPREADSHEET_ID` — Internal competitive games
- `SOCIAL_EVENTS_SPREADSHEET_ID` — Social events / non-competitive

Column names are mapped dynamically (header row normalised to `snake_case`). No positions are hardcoded except where noted (CleaningRota, SweepingRota, LoginAttempts, ImpersonationLog).

---

## 1. Members Spreadsheet (`MEMBERS_SPREADSHEET_ID`)

### 1.1 `Members` Sheet

The primary identity and profile store for all club members and system users.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `title` | String | Mr / Mrs / Miss / Ms / Dr etc. — optional |
| `first_name` | String | Required |
| `last_name` | String | Required |
| `known_as` | String | Preferred first name; falls back to `first_name` for emails |
| `full_known_as` | String | Computed "Known As + Last Name" display form |
| `full_name` | String | Denormalised display name (e.g. "Celia Dasey") |
| `email_address` | String | Nullable; not guaranteed unique |
| `landline` | String | Optional phone |
| `mobile` | String | Optional phone |
| `address_1` | String | Address line 1 |
| `address_2` | String | Address line 2 |
| `address_3` | String | Town/city |
| `post_code` | String | Postcode |
| `address` | String | Combined multiline address field (denormalised) |
| `locker_no` | String | Optional locker number |
| `birthdate` | String | Freeform date — not normalised to ISO |
| `age` | Integer | Computed age (numeric) |
| `age_demographic` | String | Computed/categorised age group |
| `member_type` | String | `PL` Playing Lady, `SL` Social Lady, `PM` Playing Man, `SM` Social Man |
| `honorary` | String | `Y` / `N` / blank — honorary membership |
| `year_started` | Integer | Year member joined |
| `renew_status` | String | Current renewal cycle status |
| `friendlies_2023` | Integer | Friendlies played 2023 (historical) |
| `friendlies_2024` | Integer | Friendlies played 2024 (historical) |
| `friendlies_last_year` | String/Int | Count or `X` (manual override) |
| `comments` | String | Admin notes |
| `social_emails` | Boolean | `Y`/`N` — receives social emails |
| `handbook_entry` | Boolean | `Y`/`N` — included in handbook |
| `driving_away_matches` | String | Driving availability for away matches |
| `driving_additional_info` | String | Extra driving notes |
| `green_maintenance` | String | Green maintenance availability |
| `green_additional_info` | String | Extra green maintenance notes |
| `bar_duty` | String | Bar duty availability |
| `bar_additional_info` | String | Extra bar duty notes |
| `other_skills` | String | Free-text skills |
| `gmc` | String | `GMC` or blank — General Management Committee membership |
| `profile_updated_date` | String | ISO timestamp of last profile update |
| `handicap` | Integer | 0–10, null if unset; playing members only |
| `include` | String | `Y`/`N` — controls renewal email inclusion |
| `renewal_email_sent_status` | String | `Success. Email sent DD/MM/YYYY` or `Error: ...` |
| `member_email_sent_status` | String | Same format, for ad-hoc member emails |
| `buddy_user_name` | String | FK → `Members.user_name` — optional buddy pairing |
| `label_0` | String | Gmail label / category tag (admin use) |
| `label_3` | String | Gmail label / category tag (admin use) |
| `darts` | String | Darts team membership flag |
| `label_bar_duty` | String | Gmail label tag for bar duty |
| `county_ladies` | String | County Ladies team membership flag |
| `label_green_maint` | String | Gmail label tag for green maintenance |
| `label_9` | String | Gmail label / category tag (admin use) |
| `label_10` | String | Gmail label / category tag (admin use) |
| `gmail_labels` | String | JSON/csv of all Gmail contact labels applied to this member |
| `user_name` | String | **Primary key** — unique login identifier (e.g. `john.smith`) |
| `password_hash` | String | bcrypt hash |
| `is_temp_password` | Boolean | `Y`/`N` — forces password change on next login |
| `role` | String | Comma-separated roles: `Member`, `Captain`, `Committee`, `Admin`, `Kiosk`, `Club` |
| `last_login_date` | String | ISO timestamp |
| `last_login_failed_date` | String | ISO timestamp |
| `last_password_reset_date` | String | ISO timestamp |
| `reset_token` | String | 64-char hex token, cleared after use |
| `reset_token_expires` | String | ISO timestamp |
| `created_at` | String | ISO timestamp |
| `updated_at` | String | ISO timestamp |

**Constraints (by convention):**
- `user_name` is unique and case-insensitively compared.
- `role` is stored as a comma-separated string; the `role-utils.ts` helpers split and check individual roles.
- `handicap` is only meaningful when `member_type` starts with `P` (Playing member).
- Row 1 is the header; data starts at row 2. Range `A2:BZ`.

---

### 1.2 `LoginAttempts` Sheet

Security audit log for all login attempts (both successful and failed). Used for rate limiting.

Columns are **positional** (not flexible-mapped by code):

| Col | Field | Type | Notes |
|---|---|---|---|
| A | `id` | Integer | Auto-incremented count |
| B | `identifier` | String | Username or email submitted |
| C | `user_name` | String | Resolved username (empty if not found) |
| D | `success` | String | `Y` / `N` |
| E | `failure_reason` | String | Error message if failed |
| F | `ip_address` | String | Client IP |
| G | `user_agent` | String | Browser UA string |
| H | `device_type` | String | Mobile / Desktop etc. |
| I | `attempted_at` | String | ISO timestamp |

Rate-limiting window: 15 minutes. Range `A2:I`.

---

### 1.3 `ImpersonationLog` Sheet

Security audit log for admin impersonation start/stop events.

Columns are **positional**:

| Col | Field | Type | Notes |
|---|---|---|---|
| A | `id` | Integer | Auto-incremented |
| B | `session_id` | String | Session identifier |
| C | `action` | String | `START` or `STOP` |
| D | `admin_email` / `admin_user_name` | String | Admin who triggered impersonation (live header: `Admin Email`) |
| E | `admin_name` | String | Admin's display name |
| F | `admin_role` | String | Admin's role |
| G | `target_email` / `target_user_name` | String | Target user being impersonated (live header: `Target Email`) |
| H | `target_name` | String | Target user's display name |
| I | `target_role` | String | Target user's role |
| J | `ip_address` | String | Client IP |
| K | `user_agent` | String | Browser UA |
| L | `timestamp` | String | ISO timestamp |

Range `A:L`.

---

### 1.4 `MemberEmails` Sheet

Audit log of all bulk/template email sends to members.

Columns are **positional**:

| Col | Field | Type | Notes |
|---|---|---|---|
| A | `id` | Integer | Auto-incremented |
| B | `user_name` | String | Recipient's username |
| C | `email_address` | String | Recipient's email at time of send |
| D | `template_name` | String | Email template identifier |
| E | `subject` | String | Email subject line |
| F | `success` | String | `Y` / `N` |
| G | `error_message` | String | Error if failed |
| H | `sent_by` | String | Username of sender |
| I | `attachments` | String | Comma-separated attachment names |
| J | `sent_at` | String | ISO timestamp |

Range `A:J`.

---

### 1.5 `PasswordResetRequests` Sheet

Rate-limiting log for password reset requests.

Columns are **positional**:

| Col | Field | Type | Notes |
|---|---|---|---|
| A | `id` | Integer | Auto-incremented |
| B | `identifier` | String | Username or email submitted |
| C | `user_name` | String | Resolved username (empty if not found) |
| D | `requested_at` | String | ISO timestamp |

Rate-limit window: 1 hour. Range `A:D`.

---

### 1.6 `Renewals` Sheet

Annual membership renewal form responses. One row per member per renewal cycle.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `user_name` | String | FK → `Members.user_name` |
| `renewing_membership` | Boolean/String | `Y`/`N`/`X` (X = renewals closed) |
| `playing_fee` | Number | Calculated playing membership fee (£) |
| `social_fee` | Number | Calculated social membership fee (£) |
| `competitions_fee` | Number | Total competition entry fees (£) |
| `club_200_fee` | Number | 200 Club entry fee (£) |
| `total_fee_due` | Number | Sum of all fees (£) |
| `outstanding` | Number | Amount still owed (£) |
| `difference` | Number | Difference between banked and total due (£) |
| `donations` | Number | Voluntary donation amount (£) |
| `card_machine` | Number | Amount paid via card machine (£) |
| `bank_transfer` | Number | Amount paid via bank transfer (£) |
| `cheque` | Number | Amount paid by cheque (£) |
| `cash` | Number | Amount paid in cash (£) |
| `banking` | Number | Amount banked total (£) |
| `date_paid` | String | Date payment received |
| `payment_ids` | String | Comma-separated FK → `RenewalPayments.payment_id` |
| `payment_notes` | String | Free-text payment notes |
| `club_200_entries` | Integer | Number of 200 Club entries |
| `club_200_preferred_numbers` | String | Preferred lucky dip numbers |
| `cleaning_dates_to_avoid` | String | Freeform dates to avoid for cleaning rota |
| `tea_dates_to_avoid` | String | Freeform dates to avoid for tea rota |
| `comp_mens_championship` | Boolean | Entering Men's Championship |
| `comp_ladies_maynard` | Boolean | Entering Ladies Maynard |
| `comp_mens_two_wood` | Boolean | Entering Men's Two Wood |
| `comp_ladies_two_wood` | Boolean | Entering Ladies Two Wood |
| `comp_married_pairs` | Boolean | Entering Married Pairs |
| `comp_drawn_pairs` | Boolean | Entering Drawn Pairs |
| `comp_australian_pairs` | Boolean | Entering Australian Pairs |
| `comp_drawn_triples` | Boolean | Entering Drawn Triples |
| `comp_handicap` | Boolean | Entering Handicap |
| `comp_oldlands` | Boolean | Entering Oldlands |
| `comp_veterans` | Boolean | Entering Veterans |
| `sub_drawn_pairs` | Boolean | Available as substitute for Drawn Pairs |
| `sub_australian_pairs` | Boolean | Available as substitute for Australian Pairs |
| `sub_drawn_triples` | Boolean | Available as substitute for Drawn Triples |
| `triples_league` | Boolean | Entering / interested in Triples League |
| `autumn_aussie_league` | Boolean | Entering / interested in Autumn Aussies League |
| `confirmation_email_date` | String | ISO timestamp of confirmation email send |
| `created_at` | String | ISO timestamp |
| `updated_at` | String | ISO timestamp |

Range `A2:AP` (41 columns actual; documentation previously stated 42). One row per member; rows are created on first access.

---

### 1.7 `RenewalPayments` Sheet

Bank/cash payments matched against renewal fees.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `payment_id` | String | `P###` format, e.g. `P001` |
| `date` | String | Payment date |
| `type` | String | `TRF` Transfer, `CDM` Card Machine, `CHQ` Cheque, `CSH` Cash |
| `reference` | String | Bank reference or cheque number |
| `amount` | Number | Payment amount (£) |
| `status` | String | `Unmatched`, `Matched`, `Deleted` |
| `matched_users` | String | Comma-separated usernames this payment is matched to |

Range `A2:G`.

---

### 1.8 `CleaningRota` Sheet

Club cleaning rota schedule. Columns are **positionally hardcoded** (no `getColumnMap`).

| Col | Field | Type | Notes |
|---|---|---|---|
| A | `date` | String | Display date, e.g. "Sat, 05 September" |
| B | `lead` | String | Lead cleaner's username |
| C | `second` | String | Second cleaner's username |
| D | `third` | String | Third cleaner's username |
| E | `fourth` | String | Fourth cleaner's username |

Rows 2+ are data. Usernames are FK → `Members.user_name`.

---

### 1.9 `SweepingRota` Sheet

Green sweeping rota schedule. Columns are **positionally hardcoded**.

| Col | Field | Type | Notes |
|---|---|---|---|
| A | `date` | String | Stored as Google Sheets date, displayed as DD/MM/YYYY |
| B | `user_name` | String | FK → `Members.user_name` |
| C | `is_blocked` | Boolean | `TRUE`/`FALSE` — blocked dates not assignable |

---

### 1.10 `MemberSuggestions` Sheet

Member-submitted improvement suggestions and their committee workflow status.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `suggestion_id` | String | `YYYY-NNN` format, resets yearly |
| `title` | String | Short title |
| `category` | String | `Facilities`, `Green`, `Grounds`, `Clubhouse`, `Bar`, `Social`, `Finance`, `Other` |
| `description` | String | Full description |
| `reason_for_improvement` | String | Why this improvement is needed |
| `created_by_username` | String | FK → `Members.user_name` |
| `created_at` | String | ISO timestamp |
| `committee_only` | String | Flag for committee-only visibility |
| `date_received` | String | Date committee received/acknowledged |
| `committee_acceptance` | String | `Y` or blank — accepted for review |
| `committee_acceptance_reason` | String | Reason if not accepted |
| `priority` | String | `Low`, `Medium`, `High`, `Safety essential` |
| `coordinator_username` | String | FK → `Members.user_name` — assigned coordinator |
| `estimated_cost` | Number | Estimated cost (£) |
| `funding_source` | String | `Club Funds`, `Grant`, `Fundraising`, `Sponsor`, `Other` |
| `cost_quotes_details` | String | Details of cost quotes |
| `decision` | String | `Approved`, `Not Approved`, `Deferred` |
| `decision_reason` | String | Reason for decision |
| `target_completion_date` | String | Target completion date |
| `progress_notes` | String | Progress updates |
| `review_date` | String | Next review date |
| `final_outcome` | String | `Completed`, `Cancelled`, `On Hold` |
| `date_completed` | String | Completion date |
| `updated_at` | String | ISO timestamp of last update |
| `updated_by_username` | String | FK → `Members.user_name` |

**Note:** The live sheet stores `Created By Full Name` (col 7) and `Coordinator Full Name` (col 15) as denormalised display names — contrary to the earlier assumption that these were looked up dynamically. The code may or may not read these columns; they exist in the sheet regardless.

---

### 1.11 `MemberSuggestionsAttachments` Sheet

File attachments and links for member suggestions.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `attachment_id` | String | `ATT-NNNNNN` format |
| `suggestion_id` | String | FK → `MemberSuggestions.suggestion_id` |
| `type` | String | `link`, `image`, `document` |
| `drive_file_id` | String | Google Drive file ID (nullable) |
| `url` | String | File URL or external link |
| `description` | String | Display label |
| `file_name` | String | Original filename (nullable) |
| `mime_type` | String | MIME type (nullable) |
| `file_size` | Number | File size in bytes (nullable) |
| `display_order` | Integer | Sort order |
| `added_at` | String | ISO timestamp |
| `added_by_username` | String | FK → `Members.user_name` |
| `is_deleted` | Boolean | `TRUE`/`FALSE` — soft-delete |

Range `A2:AZ`. Physical row deletion is used for hard-delete.

---

### 1.12 `InviteGames` Sheet

Admin-created invitation posts for special games (visible to all members).

| Column (normalised key) | Type | Notes |
|---|---|---|
| `invite_game_id` | String | `IG-YYYY-NNN` format, resets yearly |
| `title` | String | Game title |
| `description` | String | Full description (may contain rich text) |
| `closing_date` | String | Entry closing date |
| `game_date` | String | Date of the game |
| `created_by_username` | String | FK → `Members.user_name` |
| `created_at` | String | ISO timestamp |
| `updated_at` | String | ISO timestamp (nullable) |
| `updated_by_username` | String | FK → `Members.user_name` (nullable) |

Note: `createdByFullName` is **not stored** — looked up dynamically.

---

### 1.13 `InviteGamesAttachments` Sheet

Same structure as `MemberSuggestionsAttachments` but for invite games.

**Note:** In the live sheet, column 3 has a typo header `Yype` (should be `Type`). Code reads by column map normalisation so this still maps to the `type` key.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `attachment_id` | String | `IGA-NNNNNN` format |
| `invite_game_id` | String | FK → `InviteGames.invite_game_id` |
| `type` | String | `link`, `image`, `document` (live header: `Yype` — typo) |
| `drive_file_id` | String | Google Drive file ID (nullable) |
| `url` | String | File URL |
| `description` | String | Display label |
| `file_name` | String | Original filename (nullable) |
| `mime_type` | String | MIME type (nullable) |
| `file_size` | Number | File size in bytes (nullable) |
| `display_order` | Integer | Sort order |
| `added_at` | String | ISO timestamp |
| `added_by_username` | String | FK → `Members.user_name` |
| `is_deleted` | Boolean | `TRUE`/`FALSE` |

---

## 2. Friendlies Spreadsheet (`FRIENDLIES_SPREADSHEET_ID`)

### 2.1 `Games` Sheet

Master schedule of all friendly/fixture/event games. One row per game.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `date` | String | Game date (various formats, normalised to DD/MM/YYYY on read) |
| `tab_date` | String | Short identifier like `25-Sep` |
| `time` | String | Kick-off time, e.g. `14:00` |
| `club_name` | String | Opponent club name — FK → clubs spreadsheet `clubs.club_name` |
| `home_away` / `h_a` | String | `H` (Home) or `A` (Away) (live header: `H/A`) |
| `format` | String | `Rinks`, `Triples`, `Pairs`, `Singles` |
| `ladies_men` | String | `Ladies`, `Men`, `Mixed` (live header: `Ladies/Men`) |
| `dress` | String | Dress code, e.g. `Whites`, `Greys` |
| `league` | String | League name if applicable |
| `tab_name` | String | **Unique game key** — matches game sheet tab name (e.g. `West Hoathly 25-Sep`) |
| `status` | String | `''`, `O`, `L`, `X`, `S`, `P`, `C`, `A` — see GameStatus |
| `include` | String | Optional filtering flag |
| `max_capacity` | Integer | Maximum player capacity |
| `entered` | Integer | Denormalised count of entered players |
| `selected` | Integer | Denormalised count of selected players |
| `reserves` | Integer | Denormalised count of reserves |
| `bhbc_score` | Integer | BHBC score (populated on completion) |
| `opponent_score` | Integer | Opponent score (populated on completion) |
| `reason` | String | Cancellation/abandonment reason |
| `who` | String | Who cancelled |
| `last_modified_by` | String | FK → `Members.user_name` |
| `last_modified_date` | String | ISO timestamp |
| `paired` | String | `Y` if this game is paired with another on the same date |
| `type` | String | `Friendly`, `N/S A`, `N/S B`, `MSL`, `JSL`, `BL`, `Event`, `Test` |
| `club_suffix` | String | Suffix appended to club name (e.g. `A` → "Henfield A") |
| `special_instructions` / `message` | String | Special instructions shown on game card |
| `pickup_info` / `pickup_information` | String | Car-sharing pickup point for away games |
| `captain` | String | FK → `Members.user_name` — captain of the day |
| `locked_by` | String | FK → `Members.user_name` — who holds selection lock |
| `locked_at` | String | ISO timestamp of lock acquisition |
| `tea_lead` | String | FK → `Members.user_name` — tea rota lead for the day |
| `tea_first` | String | FK → `Members.user_name` — tea rota first helper |
| `tea_second` | String | FK → `Members.user_name` — tea rota second helper |

Range `A2:ZZ`. The `tab_name` value must be unique as it is used as the tab name for the per-game player sheet.

**Note:** The `tab_date` column (short identifier like `25-Sep`) listed in some code references does not appear as a header in the live Games sheet; the date-based tab key is derived from the `date` column at runtime.

---

### 2.2 `Players` Sheet

Cross-reference of all members × all games. Fixed-width left columns, then one dynamic column per game.

**Fixed left columns:**

| Column (normalised key) | Type | Notes |
|---|---|---|
| `user_name` | String | FK → `Members.user_name` — may also be `full_name`/`name` depending on sheet setup |
| `entered` | Integer | Total games entered |
| `played` | Integer | Total games played (selected) |
| `future_entered` | Integer | Future games the player is currently entered for |
| `withdrawn` | Integer | Total games withdrawn from |
| `cancelled` | Integer | Total games cancelled (game-level, not player-level) |

**Dynamic game columns** (one per opened game):
- Column header = `tab_name` value from `Games` sheet (e.g. `West Hoathly 25-Sep`)
- Cell value = `PlayerEntryStatus`: `E`, `M`, `D`, `P`, `R`, `T`, `A`, `C`, `EW`, `MW`, `DW`, `PW`, `RW`, `TW`, `AW`

New game columns are appended (and formatted by copying the previous column) when a game is opened (`status → O`).

---

### 2.3 Per-Game Sheet Tabs (dynamic, one per opened game)

Each tab is named after the game's `tab_name` (e.g. `West Hoathly 25-Sep`). One row per player entered in that game.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `name` / `user_name` | String | FK → `Members.user_name` |
| `name_down` | Integer | Count of closed games where player was selected |
| `picked` | Integer | Count of games player was picked to play |
| `percent_played` | Number | Decimal fraction (0.0–1.0) — percentage of selected games played |
| `driver_bar` | String | `D`, `B`, `DB` (live value `D/B`), or blank — read from Members sheet (live header: `Driver/Bar`) |
| `selected` | String | `SelectionStatus`: `''`, `Y`, `R`, `T`, `O` |
| `team` | Integer | Team number (1–4+) or blank |
| `position` | String | `S`, `1`, `2`, `3`, or blank |
| `driving` | String | `D` driver, `B` bar, or blank |
| `car_number` | String | Car number if driving |
| `status` | String | `ConfirmationStatus`: `''`, `Y`, `W` |
| `captain` | String | `Y` if captain of the day, else blank |

---

### 2.4 `ManageLog` Sheet (auto-created)

Append-only audit log of game management actions.

| Column | Field | Type |
|---|---|---|
| A | `timestamp` | String (ISO) |
| B | `username` | String |
| C | `action` | String (e.g. `status:S`) |
| D | `tab_name` | String |
| E | `row_number` | Integer |
| F | `old_status` | String |
| G | `new_status` | String |

---

## 3. Match Day Contacts Spreadsheet (`MATCH_DAY_CONTACTS_SPREADSHEET_ID`)

### 3.1 `clubs` Sheet

Details of all opponent clubs.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `club_name` | String | **Primary key** — unique club name |
| `club_id` | String | Short login identifier for club account (e.g. `henfield`) |
| `club_number` | String | Club landline |
| `club_mobile` | String | Club mobile |
| `club_email_address` / `club_email` | String | Email address (two column names supported) |
| `club_email_note` | String | Notes about email |
| `general_information` / `general_info` | String | General notes (two column names supported) |
| `driving_band` | String | `A`, `B`, `C`, or `D` — FK → `PetrolBands.band` |
| `address_1` | String | Address line 1 |
| `address_2` | String | Address line 2 |
| `address_3` | String | Address line 3 |
| `address_4` | String | Address line 4 |
| `post_code` | String | Postcode |
| `google_address` | String | JSON blob of Google Maps address components (admin/geocoding use) |
| `website` | String | Website URL |
| `latitude` | Number | GPS latitude |
| `longitude` | Number | GPS longitude |
| `web_developer` | String | Web developer contact or flag (admin use) |
| `miles` | String | Distance in miles |
| `club_check` | String | Admin verification/audit flag |
| `travel_time` | String | Estimated travel time (e.g. "45 mins") |
| `last_updated` | String | Date of last update |
| `password` | String | bcrypt hash (or plaintext for temp passwords) — for club portal login |
| `is_temp_password` | String | `Y`/`N` — forces password change |
| `password_reset_token` | String | 64-char hex reset token (club account) |
| `password_reset_expires` | String | ISO timestamp of token expiry |

---

### 3.2 `Contacts` Sheet

Individual named contacts for each club (multiple contacts per club supported).

| Column (normalised key) | Type | Notes |
|---|---|---|
| `club_name` | String | FK → `clubs.club_name` |
| `role` | String | `Captain`, `Secretary`, or other freeform role |
| `first_name` | String | Contact's first name |
| `last_name` | String | Contact's last name |
| `name` | String | Denormalised full name (`first_name + last_name`) |
| `phone_number` | String | Landline |
| `mobile_number` | String | Mobile |
| `notes` | String | Additional notes |
| `email` | String | Email address |
| `merged_last_name` | String | Merged last name for Google Contacts export (live header: `Merged Last Name(For Google Contacts)`) |
| `label` | String | Google Contacts label (live header: `Label (for Google Contacts)`) |
| `clubs_check` | String | Admin verification/audit flag |
| `include` | String | `Y` if contact should receive login credential emails |
| `rowland` | String | Flag/notes for Rowland Cup contact role |

---

### 3.3 `PetrolBands` Sheet

Lookup table mapping distance bands to petrol reimbursement amounts.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `band` | String | `A`, `B`, `C`, `D` |
| `amount` | Number | Reimbursement amount in £ (e.g. 2.00, 3.00) |

Hardcoded fallback: `{A: 2, B: 3, C: 4, D: 5}` used if sheet is absent.

---

## 4. Competitions Spreadsheet (`COMPETITIONS_SPREADSHEET_ID`)

### 4.1 `CompetitionsControl` Sheet

> **⚠ Not found in live spreadsheet.** The script did not find a tab named `CompetitionsControl` in the Competitions spreadsheet. This tab may have been renamed or the competition control data may be stored differently. Code references to this tab should be verified.

One row per competition. Metadata, status, and round play-by dates.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `comp_id` | String | **Primary key** — e.g. `mens-championship`, `drawn-pairs` |
| `display_name` | String | Human-readable name |
| `comp_type` | String | `singles`, `pairs`, `triples` |
| `status` | String | `Not Started`, `Draw Done`, `In Progress`, `Complete` |
| `year` | Integer | Competition year |
| `finals_date` | String | Finals date — YYYY-MM-DD |
| `prelim_play_by` | String | Preliminary round play-by date |
| `r1_play_by` | String | Round 1 play-by date |
| `r2_play_by` | String | Round 2 play-by date |
| `qf_play_by` | String | Quarter final play-by date |
| `sf_play_by` | String | Semi final play-by date |
| `triples_fixed_day` | Boolean | `Y` — triples has a fixed first-round date |
| `triples_fixed_date` | String | YYYY-MM-DD |
| `draw_side_count` | Integer | Number of sides in the draw (determines bracket size) |
| `comp_start` | String | Competition start date YYYY-MM-DD |
| `comp_description` | String | Short description shown to members |

---

### 4.2 Per-Competition Match Sheets (11 sheets)

One sheet per competition. Named after `COMP_SHEET_CONFIG[compId].sheetName`:

| compId | Sheet Name | Live Status |
|---|---|---|
| `mens-championship` | `CompMensChampionship` | **⚠ Not found in live spreadsheet** |
| `ladies-maynard` | `CompLadiesMaynard` | Present |
| `mens-two-wood` | `CompMensTwoWood` | Present |
| `ladies-two-wood` | `CompLadiesTwoWood` | Present |
| `handicap` | `CompHandicap` | Present |
| `oldlands` | `CompOldlands` | Present |
| `veterans` | `CompVeterans` | Present |
| `married-pairs` | `CompMarriedPairs` | Present |
| `drawn-pairs` | `CompDrawnPairs` | Present |
| `australian-pairs` | `CompAustralianPairs` | Present |
| `drawn-triples` | `CompDrawnTriples` | Present |
| `centenary` | `CompCentenary` | Present |

Each sheet has identical columns:

| Column (normalised key) | Type | Notes |
|---|---|---|
| `match_id` | String | `{compId}-{round}-{position}`, e.g. `mens-championship-r1-1` |
| `round` | String | `Prelim`, `R1`, `R2`, `QF`, `SF`, `F` |
| `position` | Integer | 1-indexed position within round |
| `side1` | String | Pipe-separated usernames, FK → `Members.user_name` (e.g. `john.smith\|jane.doe`) |
| `side2` | String | Same — null/empty = bye |
| `score1` | Integer | Side 1 score |
| `score2` | Integer | Side 2 score |
| `winner_side` | Integer | `1` or `2` |
| `status` | String | `Pending`, `Complete`, `Walkover`, `Bye` |
| `play_by_date` | String | YYYY-MM-DD |
| `played_date` | String | YYYY-MM-DD |

Bracket progression rule: winner of position N feeds into next round, position `ceil(N/2)`.

---

## 5. Rowland Cup Spreadsheet (`ROWLAND_SPREADSHEET_ID`)

Inter-club knockout cup with four divisions.

### 5.1 `RowlandControl` Sheet

One row per competition division.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `comp_id` | String | `edward-a`, `edward-b`, `gladys-a`, `gladys-b` |
| `comp_name` | String | Display name (live header: `Comp Name`) |
| `season` | String | e.g. `2026` (live data uses single year, not `2025-26`) |
| `status` | String | `Not Started`, `Draw Done`, `In Progress`, `Complete` |
| `num_teams` | Integer | Number of entered teams |
| `prelim_play_by` | String | YYYY-MM-DD |
| `r1_play_by` | String | YYYY-MM-DD |
| `r2_play_by` | String | YYYY-MM-DD |
| `qf_play_by` | String | YYYY-MM-DD |
| `sf_play_by` | String | YYYY-MM-DD |
| `f_play_by` | String | YYYY-MM-DD |

---

### 5.2 Per-Division Match Sheets (4 sheets)

`Rowland_edward-a`, `Rowland_edward-b`, `Rowland_gladys-a`, `Rowland_gladys-b`

| Column (normalised key) | Type | Notes |
|---|---|---|
| `match_id` | String | Unique match identifier |
| `round` | String | `Prelim`, `R1`, `R2`, `QF`, `SF`, `F` |
| `position` | Integer | 1-indexed within round |
| `home_club_id` | String | FK → `clubs.club_id` in Match Day Contacts |
| `home_club_name` | String | Denormalised club name |
| `home_team_letter` | String | `A`, `B`, or blank |
| `away_club_id` | String | FK → `clubs.club_id` (nullable for bye) |
| `away_club_name` | String | Denormalised club name |
| `away_team_letter` | String | `A`, `B`, or blank |
| `home_players` | String | Pipe-separated player names (free text, not usernames) |
| `away_players` | String | Pipe-separated player names (free text) |
| `home_score` | Integer | Home team score |
| `away_score` | Integer | Away team score |
| `winner_side` | Integer | `1` (home) or `2` (away) |
| `status` | String | `Pending`, `Played`, `Walkover`, `Bye` |
| `play_by_date` | String | YYYY-MM-DD |
| `played_date` | String | YYYY-MM-DD |
| `notes` | String | Free-text notes |
| `score_sheet_url` | String | URL of uploaded score sheet image |

Note: Unlike the internal competitions, Rowland players are **free-text names**, not usernames — clubs enter their own players.

### 5.3 `RowlandSettings` Sheet (undocumented)

Key-value store for Rowland-system configuration messages.

| Column | Type | Notes |
|---|---|---|
| `key` | String | Setting name (e.g. `message`) |
| `value` | String | Setting value (may be multiline text) |

**Other undocumented tabs in this spreadsheet** (admin/tooling only, not used by portal code): `Template 1`, `Template 2`, `Template 3` (AutoCrat email templates), `NVScriptsProperties` (AutoCrat job properties), `DO NOT DELETE - AutoCrat Job Settings` (AutoCrat job configuration).

---

## 6. Leagues Spreadsheet (`LEAGUES_SPREADSHEET_ID`)

### 6.1 `LeagueControl` Sheet

One row per league.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `league_id` | String | **Primary key** — e.g. `league-1716123456789` |
| `name` | String | Display name |
| `type` | String | `triples` or `pairs` |
| `season` | String | e.g. `2025` |
| `status` | String | `Not Started`, `Entries Open`, `In Progress`, `Complete` |
| `date_label` | String | `Play on/at`, `Play by`, `Play start date` (live header: `Date Label`) |
| `legs` | Integer | `1` or `2` — number of times each pair meets |
| `message` | String | Optional message displayed to members |

---

### 6.2 `LeagueTeams` Sheet

One row per team in a league.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `team_id` | String | **Primary key** — e.g. `team-abc123` |
| `league_id` | String | FK → `LeagueControl.league_id` |
| `team_name` | String | Display name |

---

### 6.3 `LeagueSquad` Sheet

Squad members for each team, one row per member.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `league_id` | String | FK → `LeagueControl.league_id` |
| `username` | String | FK → `Members.user_name` |
| `team_id` | String | FK → `LeagueTeams.team_id` (blank if unassigned) |
| `position` | String | `Skip`, `Captain`, `Lead`, `Two` (triples) or `Skip`, `Captain`, `Lead` (pairs) |

**Note:** `entered_date` column is not present in the live sheet. Column order in live data is: `league_id`, `username`, `team_id`, `position`.

`fullName`, `mobile`, `email` are **not stored** — looked up from `Members` at read time.

---

### 6.4 `LeagueMatches` Sheet

One row per fixture.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `match_id` | String | Unique match identifier |
| `league_id` | String | FK → `LeagueControl.league_id` |
| `matchday` | Integer | Matchday number (round number) |
| `home_team_id` | String | FK → `LeagueTeams.team_id` |
| `away_team_id` | String | FK → `LeagueTeams.team_id` |
| `scheduled_date` | String | YYYY-MM-DD — used for triples |
| `scheduled_time` | String | HH:MM — used for triples |
| `play_by_date` | String | YYYY-MM-DD — used for pairs |
| `home_score` | Integer | Home team shots |
| `away_score` | Integer | Away team shots |
| `home_adj` | Integer | Score adjustment for home (added to shots in standings) |
| `away_adj` | Integer | Score adjustment for away |
| `home_points` | Integer | Override league points for home (bypasses calculation) |
| `away_points` | Integer | Override league points for away |
| `status` | String | `Scheduled`, `Played`, `Walkover`, `Conceded`, `Not Played` |

---

### 6.5 `LeagueAttachments` Sheet

Rules documents and attachments linked to a league.

| Column (normalised key) | Type | Notes |
|---|---|---|
| `attachment_id` | String | `LA-NNNNNN` format |
| `league_id` | String | FK → `LeagueControl.league_id` |
| `type` | String | `link`, `image`, `document` |
| `drive_file_id` | String | Google Drive file ID (nullable) |
| `url` | String | File URL |
| `description` | String | Display label |
| `file_name` | String | Original filename (nullable) |
| `mime_type` | String | MIME type (nullable) |
| `file_size` | Number | Bytes (nullable) |
| `display_order` | Integer | Sort order |
| `added_at` | String | ISO timestamp |
| `added_by_username` | String | FK → `Members.user_name` |
| `is_deleted` | Boolean | `TRUE`/`FALSE` |

---

### 6.6 `LeagueSettings` Sheet

Key-value configuration for the league system.

| Column | Type | Notes |
|---|---|---|
| Key | String | Setting name |
| Value | String | Setting value |

---

## 7. Portal Config Spreadsheet (`PORTAL_CONFIG_SPREADSHEET_ID`)

### 7.1 `Labels` Sheet

Generic key-value config for portal labels and settings.

| Column | Type | Notes |
|---|---|---|
| Key | String | Config key |
| Value | String | Config value |

---

## 8. Relationship Diagram

```
MEMBERS_SPREADSHEET
  Members.user_name (PK)
    ← Renewals.user_name (FK)
    ← LoginAttempts.user_name (FK, soft ref)
    ← ImpersonationLog.admin_user_name, target_user_name (FK, soft ref)
    ← MemberEmails.user_name (FK, soft ref)
    ← PasswordResetRequests.user_name (FK, soft ref)
    ← CleaningRota.lead/second/third/fourth (FK, soft ref)
    ← SweepingRota.user_name (FK, soft ref)
    ← MemberSuggestions.created_by_username, coordinator_username (FK)
    ← MemberSuggestionsAttachments.added_by_username (FK)
    ← InviteGames.created_by_username (FK)
    ← InviteGamesAttachments.added_by_username (FK)
    ← Members.buddy_user_name (self-ref FK)

FRIENDLIES_SPREADSHEET
  Games.tab_name (PK, used as per-game sheet tab name)
    ← Players.[column headers] (FK, dynamic)
    ← [tab_name].name (FK in per-game sheets)
  Games.club_name → MATCH_DAY_CONTACTS.clubs.club_name (soft ref, no constraint)
  Games.captain, locked_by, last_modified_by → Members.user_name

MATCH_DAY_CONTACTS_SPREADSHEET
  clubs.club_name (PK)
    ← Contacts.club_name (FK)
  clubs.driving_band → PetrolBands.band (FK)

COMPETITIONS_SPREADSHEET
  CompetitionsControl.comp_id (PK)
    ← CompXxx.match_id (stored as {comp_id}-{round}-{position})
  CompXxx.side1, side2 → Members.user_name (soft ref, pipe-separated)

ROWLAND_SPREADSHEET
  RowlandControl.comp_id (PK)
    ← Rowland_{comp_id} sheets (tab naming)
  Rowland_*.home_club_id, away_club_id → clubs.club_id (soft ref)
  Rowland_*.home_players, away_players — free text names (no FK)

LEAGUES_SPREADSHEET
  LeagueControl.league_id (PK)
    ← LeagueTeams.league_id (FK)
    ← LeagueSquad.league_id (FK)
    ← LeagueMatches.league_id (FK)
    ← LeagueAttachments.league_id (FK)
  LeagueTeams.team_id (PK)
    ← LeagueSquad.team_id (FK)
    ← LeagueMatches.home_team_id, away_team_id (FK)
  LeagueSquad.username → Members.user_name (soft ref)
```

---

## 9. Equivalent Prisma Schema

```prisma
// =============================================================================
// MEMBERS & AUTH
// =============================================================================

model Member {
  userName              String   @id @map("user_name")
  title                 String?
  firstName             String   @map("first_name")
  lastName              String   @map("last_name")
  knownAs               String?  @map("known_as")
  fullName              String   @map("full_name")
  emailAddress          String?  @map("email_address")
  landline              String?
  mobile                String?
  address1              String?  @map("address_1")
  address2              String?  @map("address_2")
  address3              String?  @map("address_3")
  postCode              String?  @map("post_code")
  lockerNo              String?  @map("locker_no")
  birthdate             String?
  ageDemographic        String   @map("age_demographic")
  memberType            String   @map("member_type")         // PL, SL, PM, SM
  honorary              String?                              // Y, N
  yearStarted           Int?     @map("year_started")
  renewStatus           String?  @map("renew_status")
  friendlies2023        Int      @default(0) @map("friendlies_2023")
  friendlies2024        Int      @default(0) @map("friendlies_2024")
  friendliesLastYear    String   @default("0") @map("friendlies_last_year") // Int or "X"
  comments              String?
  socialEmails          Boolean  @default(false) @map("social_emails")
  handbookEntry         Boolean  @default(false) @map("handbook_entry")
  drivingAwayMatches    String?  @map("driving_away_matches")
  drivingAdditionalInfo String?  @map("driving_additional_info")
  greenMaintenance      String?  @map("green_maintenance")
  greenAdditionalInfo   String?  @map("green_additional_info")
  barDuty               String?  @map("bar_duty")
  barAdditionalInfo     String?  @map("bar_additional_info")
  otherSkills           String?  @map("other_skills")
  gmc                   String?                              // "GMC" or null
  profileUpdatedDate    DateTime? @map("profile_updated_date")
  handicap              Int?                                 // 0-10, playing members only
  include               String?                              // Y, N
  renewalEmailSentStatus String?  @map("renewal_email_sent_status")
  memberEmailSentStatus  String?  @map("member_email_sent_status")
  buddyUserName         String?  @map("buddy_user_name")
  passwordHash          String   @map("password_hash")
  isTempPassword        Boolean  @default(false) @map("is_temp_password")
  role                  String   @default("Member")          // comma-separated roles
  lastLoginDate         DateTime? @map("last_login_date")
  lastLoginFailedDate   DateTime? @map("last_login_failed_date")
  lastPasswordResetDate DateTime? @map("last_password_reset_date")
  resetToken            String?  @map("reset_token")
  resetTokenExpires     DateTime? @map("reset_token_expires")
  createdAt             DateTime @map("created_at")
  updatedAt             DateTime @map("updated_at")

  // Self-referencing buddy relationship
  buddy                 Member?  @relation("BuddyPair", fields: [buddyUserName], references: [userName])
  buddiedBy             Member[] @relation("BuddyPair")

  // Relations
  renewal               Renewal?
  loginAttempts         LoginAttempt[]
  memberEmails          MemberEmail[]
  passwordResetRequests PasswordResetRequest[]
  cleaningLeadSlots     CleaningRota[]        @relation("CleaningLead")
  cleaningSecondSlots   CleaningRota[]        @relation("CleaningSecond")
  cleaningThirdSlots    CleaningRota[]        @relation("CleaningThird")
  cleaningFourthSlots   CleaningRota[]        @relation("CleaningFourth")
  sweepingRotaEntries   SweepingRotaEntry[]
  suggestions           MemberSuggestion[]    @relation("SuggestionCreator")
  coordinatedSuggestions MemberSuggestion[]   @relation("SuggestionCoordinator")
  suggestionAttachments MemberSuggestionAttachment[]
  inviteGames           InviteGame[]
  inviteGameAttachments InviteGameAttachment[]
}

// =============================================================================
// AUDIT / SECURITY LOGS
// =============================================================================

model LoginAttempt {
  id            Int      @id @default(autoincrement())
  identifier    String
  userName      String?  @map("user_name")
  success       Boolean
  failureReason String?  @map("failure_reason")
  ipAddress     String?  @map("ip_address")
  userAgent     String?  @map("user_agent")
  deviceType    String?  @map("device_type")
  attemptedAt   DateTime @map("attempted_at")

  member        Member?  @relation(fields: [userName], references: [userName])
}

model ImpersonationLog {
  id             Int      @id @default(autoincrement())
  sessionId      String   @map("session_id")
  action         String                // START, STOP
  adminUserName  String   @map("admin_user_name")
  adminName      String   @map("admin_name")
  adminRole      String   @map("admin_role")
  targetUserName String?  @map("target_user_name")
  targetName     String?  @map("target_name")
  targetRole     String?  @map("target_role")
  ipAddress      String?  @map("ip_address")
  userAgent      String?  @map("user_agent")
  timestamp      DateTime
}

model MemberEmail {
  id           Int      @id @default(autoincrement())
  userName     String   @map("user_name")
  emailAddress String?  @map("email_address")
  templateName String   @map("template_name")
  subject      String
  success      Boolean
  errorMessage String?  @map("error_message")
  sentBy       String   @map("sent_by")
  attachments  String?                 // comma-separated
  sentAt       DateTime @map("sent_at")

  member       Member   @relation(fields: [userName], references: [userName])
}

model PasswordResetRequest {
  id          Int      @id @default(autoincrement())
  identifier  String
  userName    String?  @map("user_name")
  requestedAt DateTime @map("requested_at")

  member      Member?  @relation(fields: [userName], references: [userName])
}

// =============================================================================
// RENEWALS & PAYMENTS
// =============================================================================

model Renewal {
  userName                String   @id @map("user_name")
  renewingMembership      Boolean  @map("renewing_membership")
  playingFees             Float    @map("playing_fee")
  socialFees              Float    @map("social_fee")
  compsFee                Float    @map("competitions_fee")
  fee200Club              Float    @map("club_200_fee")
  totalPayment            Float    @map("total_fee_due")
  outstanding             Float?
  banking                 Float?
  datePaid                String?  @map("date_paid")
  number200ClubEntries    Int      @default(0) @map("club_200_entries")
  pref200Club             String?  @map("club_200_preferred_numbers")
  cleaningDatesToAvoid    String?  @map("cleaning_dates_to_avoid")
  teaDatesToAvoid         String?  @map("tea_dates_to_avoid")
  compMensChampionship    Boolean  @default(false) @map("comp_mens_championship")
  compLadiesMaynard       Boolean  @default(false) @map("comp_ladies_maynard")
  compMensTwoWood         Boolean  @default(false) @map("comp_mens_two_wood")
  compLadiesTwoWood       Boolean  @default(false) @map("comp_ladies_two_wood")
  compMarriedPairs        Boolean  @default(false) @map("comp_married_pairs")
  compDrawnPairs          Boolean  @default(false) @map("comp_drawn_pairs")
  compAustralianPairs     Boolean  @default(false) @map("comp_australian_pairs")
  compDrawnTriples        Boolean  @default(false) @map("comp_drawn_triples")
  compHandicap            Boolean  @default(false) @map("comp_handicap")
  compOldlands            Boolean  @default(false) @map("comp_oldlands")
  compVeterans            Boolean  @default(false) @map("comp_veterans")
  subDrawnPairs           Boolean  @default(false) @map("sub_drawn_pairs")
  subAustralianPairs      Boolean  @default(false) @map("sub_australian_pairs")
  subDrawnTriples         Boolean  @default(false) @map("sub_drawn_triples")
  confirmationEmailDate   DateTime? @map("confirmation_email_date")
  createdAt               DateTime? @map("created_at")
  updatedAt               DateTime? @map("updated_at")

  member  Member  @relation(fields: [userName], references: [userName])
}

model RenewalPayment {
  paymentId    String  @id @map("payment_id")              // P###
  date         String
  type         String                // TRF, CDM, CHQ, CSH
  reference    String
  amount       Float
  status       String                // Unmatched, Matched, Deleted
  matchedUsers String?  @map("matched_users")              // comma-separated usernames
}

// =============================================================================
// ROTAS
// =============================================================================

model CleaningRota {
  id          Int     @id @default(autoincrement())
  date        String  @unique
  displayDate String  @map("display_date")
  leadUser    String? @map("lead")
  secondUser  String? @map("second")
  thirdUser   String? @map("third")
  fourthUser  String? @map("fourth")

  lead        Member? @relation("CleaningLead",   fields: [leadUser],   references: [userName])
  second      Member? @relation("CleaningSecond", fields: [secondUser], references: [userName])
  third       Member? @relation("CleaningThird",  fields: [thirdUser],  references: [userName])
  fourth      Member? @relation("CleaningFourth", fields: [fourthUser], references: [userName])
}

model SweepingRotaEntry {
  id        Int     @id @default(autoincrement())
  date      String
  userName  String  @map("user_name")
  isBlocked Boolean @default(false) @map("is_blocked")

  member    Member  @relation(fields: [userName], references: [userName])
}

// =============================================================================
// SUGGESTIONS
// =============================================================================

model MemberSuggestion {
  suggestionId               String   @id @map("suggestion_id")  // YYYY-NNN
  title                      String
  category                   String
  description                String
  reasonForImprovement       String   @map("reason_for_improvement")
  createdByUsername          String   @map("created_by_username")
  createdAt                  DateTime @map("created_at")
  committeeOnly              String?  @map("committee_only")
  dateReceived               String?  @map("date_received")
  committeeAcceptance        String?  @map("committee_acceptance")  // Y or ""
  committeeAcceptanceReason  String?  @map("committee_acceptance_reason")
  priority                   String?
  coordinatorUsername        String?  @map("coordinator_username")
  estimatedCost              Float?   @map("estimated_cost")
  fundingSource              String?  @map("funding_source")
  costQuotesDetails          String?  @map("cost_quotes_details")
  decision                   String?
  decisionReason             String?  @map("decision_reason")
  targetCompletionDate       String?  @map("target_completion_date")
  progressNotes              String?  @map("progress_notes")
  reviewDate                 String?  @map("review_date")
  finalOutcome               String?  @map("final_outcome")
  dateCompleted              String?  @map("date_completed")
  updatedAt                  DateTime? @map("updated_at")
  updatedByUsername          String?  @map("updated_by_username")

  creator     Member  @relation("SuggestionCreator",      fields: [createdByUsername],  references: [userName])
  coordinator Member? @relation("SuggestionCoordinator",  fields: [coordinatorUsername], references: [userName])
  attachments MemberSuggestionAttachment[]
}

model MemberSuggestionAttachment {
  attachmentId     String   @id @map("attachment_id")  // ATT-NNNNNN
  suggestionId     String   @map("suggestion_id")
  type             String                               // link, image, document
  driveFileId      String?  @map("drive_file_id")
  url              String
  description      String
  fileName         String?  @map("file_name")
  mimeType         String?  @map("mime_type")
  fileSize         Int?     @map("file_size")
  displayOrder     Int      @map("display_order")
  addedAt          DateTime @map("added_at")
  addedByUsername  String   @map("added_by_username")
  isDeleted        Boolean  @default(false) @map("is_deleted")

  suggestion  MemberSuggestion @relation(fields: [suggestionId],   references: [suggestionId])
  addedBy     Member           @relation(fields: [addedByUsername], references: [userName])
}

// =============================================================================
// INVITE GAMES
// =============================================================================

model InviteGame {
  inviteGameId     String   @id @map("invite_game_id")  // IG-YYYY-NNN
  title            String
  description      String
  closingDate      String?  @map("closing_date")
  gameDate         String?  @map("game_date")
  createdByUsername String  @map("created_by_username")
  createdAt        DateTime @map("created_at")
  updatedAt        DateTime? @map("updated_at")
  updatedByUsername String?  @map("updated_by_username")

  createdBy   Member  @relation(fields: [createdByUsername], references: [userName])
  attachments InviteGameAttachment[]
}

model InviteGameAttachment {
  attachmentId     String   @id @map("attachment_id")  // IGA-NNNNNN
  inviteGameId     String   @map("invite_game_id")
  type             String
  driveFileId      String?  @map("drive_file_id")
  url              String
  description      String
  fileName         String?  @map("file_name")
  mimeType         String?  @map("mime_type")
  fileSize         Int?     @map("file_size")
  displayOrder     Int      @map("display_order")
  addedAt          DateTime @map("added_at")
  addedByUsername  String   @map("added_by_username")
  isDeleted        Boolean  @default(false) @map("is_deleted")

  inviteGame  InviteGame @relation(fields: [inviteGameId],    references: [inviteGameId])
  addedBy     Member     @relation(fields: [addedByUsername], references: [userName])
}

// =============================================================================
// FRIENDLIES / FIXTURES
// =============================================================================

model FriendlyGame {
  tabName             String  @id @map("tab_name")
  date                String
  // tabDate (tab_date) does not appear as a header in the live Games sheet
  time                String?
  clubName            String  @map("club_name")
  homeAway            String  @map("home_away")              // H, A
  format              String?
  ladiesMen           String? @map("ladies_men")
  dress               String?
  league              String?
  status              String  @default("")                    // '', O, L, X, S, P, C, A
  include             String?
  maxPlayers          Int     @default(0) @map("max_capacity")
  entered             Int     @default(0)
  selected            Int     @default(0)
  reserves            Int     @default(0)
  bhbcScore           Int?    @map("bhbc_score")
  opponentScore       Int?    @map("opponent_score")
  reason              String?
  who                 String?
  lastModifiedBy      String? @map("last_modified_by")
  lastModifiedDate    DateTime? @map("last_modified_date")
  paired              String?                                 // Y or ""
  gameType            String  @default("Friendly") @map("type")
  clubSuffix          String  @default("") @map("club_suffix")
  specialInstructions String? @map("special_instructions")
  pickupInfo          String? @map("pickup_info")
  captain             String?
  lockedBy            String? @map("locked_by")
  lockedAt            DateTime? @map("locked_at")

  captainMember   Member? @relation("GameCaptain",      fields: [captain],     references: [userName])
  lockedByMember  Member? @relation("GameLock",         fields: [lockedBy],    references: [userName])
  opponentClub    Club?   @relation(                    fields: [clubName],    references: [clubName])
  playerEntries   FriendlyGamePlayer[]
  manageLogs      ManageLog[]
}

model FriendlyPlayerStat {
  // Represents one row in the Players sheet (one member × their cross-game stats)
  // The dynamic game-column entries are modelled separately
  id            Int    @id @default(autoincrement())
  userName      String @unique @map("user_name")
  // individual game columns are not fixed — modelled as FriendlyGameEntry below
}

model FriendlyGameEntry {
  // Represents the value in Players sheet at Players[game tabName][player row]
  id       Int    @id @default(autoincrement())
  userName String @map("user_name")
  tabName  String @map("tab_name")     // FK → FriendlyGame.tabName
  status   String                      // E, M, D, P, R, T, A, C, EW, etc.

  player   Member?      @relation(fields: [userName], references: [userName])
  game     FriendlyGame @relation(fields: [tabName],  references: [tabName])

  @@unique([userName, tabName])
}

model FriendlyGamePlayer {
  // Represents one row in a per-game tab sheet
  id             Int     @id @default(autoincrement())
  tabName        String  @map("tab_name")
  userName       String  @map("user_name")            // name/user_name column
  nameDown       Int     @default(0) @map("name_down")
  picked         Int     @default(0)
  percentPlayed  Float   @default(0) @map("percent_played")
  driverBar      String  @default("") @map("driver_bar")
  selected       String  @default("")                  // '', Y, R, T, O
  team           Int?
  position       String  @default("")                  // S, 1, 2, 3
  driving        String  @default("")
  carNumber      String  @default("") @map("car_number")
  status         String  @default("")                  // '', Y, W
  captain        String  @default("")                  // Y or ""

  game    FriendlyGame @relation(fields: [tabName],  references: [tabName])
  member  Member?      @relation(fields: [userName], references: [userName])

  @@unique([tabName, userName])
}

model ManageLog {
  id         Int      @id @default(autoincrement())
  timestamp  DateTime
  username   String
  action     String
  tabName    String   @map("tab_name")
  rowNumber  Int?     @map("row_number")
  oldStatus  String?  @map("old_status")
  newStatus  String?  @map("new_status")

  game  FriendlyGame? @relation(fields: [tabName], references: [tabName])
}

// =============================================================================
// CLUBS (MATCH DAY CONTACTS)
// =============================================================================

model Club {
  clubName           String  @id @map("club_name")
  clubId             String? @unique @map("club_id")    // login identifier
  clubNumber         String? @map("club_number")
  clubMobile         String? @map("club_mobile")
  clubEmailAddress   String? @map("club_email_address")
  clubEmailNote      String? @map("club_email_note")
  generalInformation String? @map("general_information")
  drivingBand        String? @map("driving_band")
  address1           String? @map("address_1")
  address2           String? @map("address_2")
  address3           String? @map("address_3")
  address4           String? @map("address_4")
  postCode           String? @map("post_code")
  website            String?
  latitude           Float?
  longitude          Float?
  miles              String?
  travelTime         String? @map("travel_time")
  lastUpdated        String? @map("last_updated")
  passwordHash       String? @map("password")
  isTempPassword     Boolean @default(false) @map("is_temp_password")

  contacts     ClubContact[]
  friendlyGames FriendlyGame[]
  petrolBand   PetrolBand? @relation(fields: [drivingBand], references: [band])
}

model ClubContact {
  id           Int    @id @default(autoincrement())
  clubName     String @map("club_name")
  role         String?
  firstName    String? @map("first_name")
  lastName     String? @map("last_name")
  name         String?                            // denormalised full name
  phoneNumber  String? @map("phone_number")
  mobileNumber String? @map("mobile_number")
  notes        String?
  email        String?
  include      String?                            // Y = receives credential emails

  club  Club @relation(fields: [clubName], references: [clubName])
}

model PetrolBand {
  band   String @id
  amount Float

  clubs  Club[]
}

// =============================================================================
// COMPETITIONS (BHBC internal knock-outs)
// =============================================================================

model Competition {
  compId           String   @id @map("comp_id")
  displayName      String   @map("display_name")
  compType         String   @map("comp_type")           // singles, pairs, triples
  status           String   @default("Not Started")
  year             Int
  finalsDate       String?  @map("finals_date")
  prelimPlayBy     String?  @map("prelim_play_by")
  r1PlayBy         String?  @map("r1_play_by")
  r2PlayBy         String?  @map("r2_play_by")
  qfPlayBy         String?  @map("qf_play_by")
  sfPlayBy         String?  @map("sf_play_by")
  triplesFixedDay  Boolean  @default(false) @map("triples_fixed_day")
  triplesFixedDate String?  @map("triples_fixed_date")
  drawSideCount    Int?     @map("draw_side_count")
  compStartDate    String?  @map("comp_start")
  compDescription  String?  @map("comp_description")

  matches  CompMatch[]
}

model CompMatch {
  matchId    String  @id @map("match_id")              // {compId}-{round}-{position}
  compId     String  @map("comp_id")
  round      String                                     // Prelim, R1, R2, QF, SF, F
  position   Int
  side1      String?                                    // pipe-separated usernames
  side2      String?                                    // pipe-separated usernames; null = bye
  score1     Int?
  score2     Int?
  winnerSide Int?    @map("winner_side")               // 1 or 2
  status     String  @default("Pending")               // Pending, Complete, Walkover, Bye
  playByDate String? @map("play_by_date")
  playedDate String? @map("played_date")

  competition  Competition @relation(fields: [compId], references: [compId])
}

// =============================================================================
// ROWLAND CUP (inter-club)
// =============================================================================

model RowlandComp {
  compId       String  @id @map("comp_id")              // edward-a, edward-b, gladys-a, gladys-b
  compName     String  @map("comp_name")
  season       String
  status       String  @default("Not Started")
  numTeams     Int     @map("num_teams")
  prelimPlayBy String? @map("prelim_play_by")
  r1PlayBy     String? @map("r1_play_by")
  r2PlayBy     String? @map("r2_play_by")
  qfPlayBy     String? @map("qf_play_by")
  sfPlayBy     String? @map("sf_play_by")
  fPlayBy      String? @map("f_play_by")

  matches  RowlandMatch[]
}

model RowlandMatch {
  matchId        String  @id @map("match_id")
  compId         String  @map("comp_id")
  round          String
  position       Int
  homeClubId     String? @map("home_club_id")
  homeClubName   String? @map("home_club_name")
  homeTeamLetter String? @map("home_team_letter")
  awayClubId     String? @map("away_club_id")
  awayClubName   String? @map("away_club_name")
  awayTeamLetter String? @map("away_team_letter")
  homePlayers    String? @map("home_players")           // pipe-separated free-text names
  awayPlayers    String? @map("away_players")
  homeScore      Int?    @map("home_score")
  awayScore      Int?    @map("away_score")
  winnerSide     Int?    @map("winner_side")
  status         String  @default("Pending")
  playByDate     String? @map("play_by_date")
  playedDate     String? @map("played_date")
  notes          String  @default("")
  scoreSheetUrl  String? @map("score_sheet_url")

  comp  RowlandComp @relation(fields: [compId], references: [compId])
}

// =============================================================================
// LEAGUES
// =============================================================================

model League {
  leagueId       String @id @map("league_id")
  name           String
  type           String                                // triples, pairs
  season         String
  status         String @default("Not Started")
  dateLabel      String @map("date_label")
  legs           Int    @default(2)                   // 1 or 2
  message        String @default("")

  teams      LeagueTeam[]
  squadEntries LeagueSquadMember[]
  matches    LeagueMatch[]
  attachments LeagueAttachment[]
}

model LeagueTeam {
  teamId    String @id @map("team_id")
  leagueId  String @map("league_id")
  teamName  String @map("team_name")

  league      League @relation(fields: [leagueId], references: [leagueId])
  squadMembers LeagueSquadMember[]
  homeMatches LeagueMatch[] @relation("HomeTeam")
  awayMatches LeagueMatch[] @relation("AwayTeam")
}

model LeagueSquadMember {
  id          Int    @id @default(autoincrement())
  leagueId    String @map("league_id")
  username    String
  teamId      String @map("team_id")
  position    String?                               // Skip, Captain, Lead, Two

  league  League     @relation(fields: [leagueId], references: [leagueId])
  team    LeagueTeam @relation(fields: [teamId],   references: [teamId])
  // username → Member.userName (enforced in app, not Prisma due to cross-DB)
}

model LeagueMatch {
  matchId       String   @id @map("match_id")
  leagueId      String   @map("league_id")
  matchday      Int
  homeTeamId    String   @map("home_team_id")
  awayTeamId    String   @map("away_team_id")
  scheduledDate String?  @map("scheduled_date")
  scheduledTime String?  @map("scheduled_time")
  playByDate    String?  @map("play_by_date")
  homeScore     Int?     @map("home_score")
  awayScore     Int?     @map("away_score")
  homeAdj       Int?     @map("home_adj")
  awayAdj       Int?     @map("away_adj")
  homePoints    Int?     @map("home_points")
  awayPoints    Int?     @map("away_points")
  status        String   @default("Scheduled")

  league    League     @relation(fields: [leagueId],   references: [leagueId])
  homeTeam  LeagueTeam @relation("HomeTeam", fields: [homeTeamId], references: [teamId])
  awayTeam  LeagueTeam @relation("AwayTeam", fields: [awayTeamId], references: [teamId])
}

model LeagueAttachment {
  attachmentId    String   @id @map("attachment_id")   // LA-NNNNNN
  leagueId        String   @map("league_id")
  type            String
  driveFileId     String?  @map("drive_file_id")
  url             String
  description     String
  fileName        String?  @map("file_name")
  mimeType        String?  @map("mime_type")
  fileSize        Int?     @map("file_size")
  displayOrder    Int      @map("display_order")
  addedAt         DateTime @map("added_at")
  addedByUsername String   @map("added_by_username")
  isDeleted       Boolean  @default(false) @map("is_deleted")

  league  League @relation(fields: [leagueId], references: [leagueId])
}

// =============================================================================
// PORTAL CONFIG
// =============================================================================

model LabelConfig {
  key   String @id
  value String
}
```

---

## 10. Structural Observations and Improvement Suggestions

### 10.1 Denormalised player counts in `Games`

`Games.entered`, `Games.selected`, and `Games.reserves` are computed counts that are manually kept in sync. If a write to the game sheet succeeds but the `Games` count update fails (or vice versa), these drift. A relational DB would derive these via `COUNT()` joins.

**Suggestion:** Remove the three count columns and compute them from `FriendlyGamePlayer` and `FriendlyGameEntry` on read. If read performance is a concern, use a single "last sync" timestamp instead.

---

### 10.2 Pipe-separated multi-values in a single cell

Several fields embed arrays into a single string cell:
- `CompMatch.side1` / `side2` — usernames pipe-separated (`john.smith|jane.doe`)
- `RowlandMatch.home_players` / `away_players` — pipe-separated names
- `Member.role` — comma-separated roles

This is the most significant anti-relational pattern. Each array requires client-side split/join logic and breaks filtering, indexing, and joins.

**Suggestion:**
- Replace `side1`/`side2` with a `CompMatchParticipant` table: `(matchId, side, position, userName)`.
- Replace `role` with a `MemberRole` table: `(userName, role)`.
- Replace Rowland players with a `RowlandMatchPlayer` table: `(matchId, side, playerName)`.

---

### 10.3 Dynamic columns in the `Players` sheet (EAV-like)

The `Players` sheet in the Friendlies spreadsheet uses one dynamic column per opened game. This is an Entity-Attribute-Value (EAV) pattern. Adding a new column on game open is an expensive API call that also copies formatting from the previous column. Querying "all games for a user" requires scanning every cell in a row.

**Suggestion:** The `FriendlyGameEntry` model above shows the correct relational equivalent — a simple `(userName, tabName, status)` table. This would make per-user and per-game queries trivially efficient.

---

### 10.4 No true referential integrity

All foreign keys are "soft references" — string values that happen to match a PK in another sheet. There is no enforcement of:
- `Players` entries referencing valid `Members`
- `Games.club_name` matching a `clubs.club_name`
- `CleaningRota.lead` matching a `Members.user_name`
- Competition `side1`/`side2` usernames existing in `Members`

Stale references silently return empty data (the `getColumnMap` pattern returns `null` when the FK is not found).

**Suggestion:** Add application-level validation on write, or migrate to a database with FK constraints.

---

### 10.5 Dates stored as strings in multiple formats

Date values arrive from Google Sheets in multiple formats depending on the cell type:
- UK locale: `D/M/YYYY` or `DD/MM/YYYY`
- ISO: `YYYY-MM-DD`
- Google Sheets serial number (integer)
- ISO timestamp: `YYYY-MM-DDTHH:MM:SS.sssZ`
- Freeform display strings (e.g. `CleaningRota.date`: "Sat, 05 September")

Each data layer has its own `normalizeDate()` helper (duplicated across `competitions-sheets.ts`, `leagues-sheets.ts`, `rowland-sheets.ts`).

**Suggestion:** Store all dates as ISO 8601 (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM:SS.sssZ`). Centralise the single `normalizeDate` utility (it already exists in `date-utils.ts`).

---

### 10.6 ID generation without transactions

Sequential IDs (`P###`, `ATT-NNNNNN`, `IGA-NNNNNN`, `LA-NNNNNN`, `YYYY-NNN`) are generated by reading all existing IDs, finding the maximum, and incrementing. This creates a TOCTOU race condition under concurrent load. The code itself acknowledges this.

**Suggestion:** Use UUID v4 for all new IDs, which provides uniqueness without requiring a read-before-write.

---

### 10.7 Club authentication embedded in the clubs sheet

The `clubs` sheet mixes venue/contact data with credentials (`club_id`, `password`, `is_temp_password`). This means listing clubs for display requires reading sensitive credential data.

**Suggestion:** Separate credentials into a `ClubCredentials` table (or a dedicated `ClubAuth` sheet), with only `club_id` as the link.

---

### 10.8 `full_name` is denormalised in `Members`

`Members.full_name` duplicates `first_name + last_name`. It could drift if name fields are updated without updating `full_name`. The code uses it as a display name but reads it directly from the sheet.

**Suggestion:** Remove `full_name` and compute it at read time (`[knownAs || firstName] + ' ' + lastName`), or keep it as a generated/computed column.

---

### 10.9 Per-game sheet tabs do not share a schema

Each opened friendly game creates a new sheet tab. If the format of these tabs ever changes, historical tabs would need manual migration.

**Suggestion:** In a relational system this is naturally handled by the `FriendlyGamePlayer` table. For the Sheets-based approach, consider moving all player-selection data into a single `GamePlayers` sheet with a `tab_name` column, rather than one tab per game.

---

### 10.10 Rowland player names are not linked to Members

`RowlandMatch.home_players` / `away_players` are free-text names entered by clubs, not `userName` foreign keys. This means statistics, profiles, and reporting cannot link Rowland participation back to a `Member` record.

**Suggestion:** For BHBC players, encourage use of usernames. Accept free-text only for guest/external players and add an `is_external` flag.

---

## 11. Live-Data Verification Notes (2026-05-14)

This schema was verified against live Google Sheets data by running `scripts/verify-schema.ts`. The following discrepancies were found and corrected in the sections above:

| Spreadsheet | Sheet | Finding |
|---|---|---|
| MEMBERS | `Members` | Extra admin/labelling columns present: `Full Known As`, `Address` (combined), `Age`, `Label_0`, `label_3`, `Darts`, `Label Bar Duty`, `County Ladies`, `Label Green Maint`, `label_9`, `label_10`, `Gmail Labels` |
| MEMBERS | `ImpersonationLog` | Col D header is `Admin Email` (not `admin_user_name`); col G is `Target Email` (not `target_user_name`) |
| MEMBERS | `MemberSuggestions` | `Created By Full Name` (col 7) and `Coordinator Full Name` (col 15) are stored in the sheet, contrary to earlier documentation |
| MEMBERS | `InviteGamesAttachments` | Col 3 header has typo: `Yype` instead of `Type` |
| MEMBERS | `Renewals` | 10 extra undocumented columns: `Difference`, `Donations`, `Card Machine`, `Bank Transfer`, `Cheque`, `Cash`, `Payment IDs`, `Payment Notes`, `Triples League`, `Autumn Aussie League`; total is 41 cols not 42 |
| FRIENDLIES | `Games` | Extra columns: `Tea Lead`, `Tea First`, `Tea Second`; live headers `H/A` and `Ladies/Men` differ from normalised keys; `tab_date` not present as a header |
| FRIENDLIES | `Players` | Extra stat columns between username and game columns: `Future Entered`, `Withdrawn`, `Cancelled` |
| FRIENDLIES | Per-game tabs | `Driver/Bar` is the live column header; combined value is `D/B` not `DB` |
| CONTACTS | `clubs` | Extra columns: `Google Address` (JSON), `Web Developer`, `Club Check`, `password_reset_token`, `password_reset_expires` |
| CONTACTS | `Contacts` | Extra columns: `Merged Last Name(For Google Contacts)`, `Label (for Google Contacts)`, `Clubs Check`, `Rowland` |
| COMPS | — | `CompetitionsControl` tab **not found** in live spreadsheet |
| COMPS | — | `CompMensChampionship` tab **not found** in live spreadsheet |
| ROWLAND | — | `Season` stored as single year (e.g. `2026`), not `YYYY-YY` format |
| ROWLAND | — | Extra admin-only tabs: `RowlandSettings`, `NVScriptsProperties`, `Template 1/2/3`, `DO NOT DELETE - AutoCrat Job Settings` |
| LEAGUES | `LeagueControl` | `squad_size` and `players_per_match` columns **not present** in live sheet (8 cols, not 10) |
| LEAGUES | `LeagueSquad` | `entered_date` column **not present** in live sheet (4 cols, not 5); column order differs |
