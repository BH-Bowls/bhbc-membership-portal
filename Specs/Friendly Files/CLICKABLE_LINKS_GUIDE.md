# Clickable Links Guide - Tel and Mailto

## Overview

All phone numbers and email addresses displayed on match cards must be clickable links to enable one-tap calling and emailing on mobile devices and quick access on desktop.

---

## Phone Links (tel:)

### Purpose
Enable users to call phone numbers with a single tap/click, eliminating manual dialing errors and improving user experience.

### Format

**HTML Structure:**
```html
<a href="tel:07700900123">07700 900123</a>
```

**Key Requirements:**
- `href` attribute uses `tel:` protocol
- Phone number in href must have **all spaces removed**
- Display text can keep spaces for readability
- No country code needed for UK numbers (will use device default)

### Implementation

**React/TypeScript:**
```typescript
// Phone number with spaces (as stored)
const phoneNumber = "07700 900123";

// Render with clickable link
<a href={`tel:${phoneNumber.replace(/\s/g, '')}`}>
  {phoneNumber}
</a>

// Result: <a href="tel:07700900123">07700 900123</a>
```

**JavaScript:**
```javascript
function renderPhone(phoneNumber) {
  const cleanNumber = phoneNumber.replace(/\s/g, '');
  return `<a href="tel:${cleanNumber}">${phoneNumber}</a>`;
}

// Usage
renderPhone("01444 123456");
// Returns: <a href="tel:01444123456">01444 123456</a>
```

### Examples

**Mobile Numbers:**
```html
<a href="tel:07700900123">07700 900123</a>
<a href="tel:07912345678">07912 345678</a>
```

**Landline Numbers:**
```html
<a href="tel:01444811233">01444 811233</a>
<a href="tel:02012345678">020 1234 5678</a>
```

**International Format (if needed):**
```html
<a href="tel:+447700900123">+44 7700 900123</a>
```

### User Experience

**Mobile Devices:**
1. User taps phone number
2. Phone app opens automatically
3. Number pre-filled ready to dial
4. User taps "Call" to connect

**Desktop:**
1. User clicks phone number
2. Default phone app opens (Skype, FaceTime, etc.)
3. Number ready to dial
4. Or option to add to contacts

### Best Practices

✅ **Do:**
- Remove all spaces from href
- Keep spaces in display text for readability
- Use consistent formatting (e.g., "07700 900123" or "07700900123")
- Test on both mobile and desktop

❌ **Don't:**
- Include spaces in tel: href
- Add extra characters (brackets, hyphens) in href
- Use tel: links for non-phone text
- Forget to handle null/empty values

### Code Example

**Full Implementation:**
```typescript
interface ContactPhoneProps {
  label: string;
  phoneNumber?: string;
}

function ContactPhone({ label, phoneNumber }: ContactPhoneProps) {
  if (!phoneNumber) return null;
  
  const cleanNumber = phoneNumber.replace(/\s/g, '');
  
  return (
    <div className="contact-phone">
      <strong>{label}:</strong>{' '}
      <a 
        href={`tel:${cleanNumber}`}
        className="phone-link"
      >
        {phoneNumber}
      </a>
    </div>
  );
}

// Usage
<ContactPhone label="Mobile" phoneNumber="07700 900123" />
<ContactPhone label="Phone" phoneNumber="01444 811233" />
```

---

## Email Links (mailto:)

### Purpose
Enable users to compose emails with a single tap/click, with the recipient automatically pre-filled.

### Format

**HTML Structure:**
```html
<a href="mailto:john.smith@email.com">john.smith@email.com</a>
```

**Key Requirements:**
- `href` attribute uses `mailto:` protocol
- Email address in href (no modification needed)
- Display text typically same as email address
- Can add subject, cc, bcc, body as optional parameters

### Implementation

**React/TypeScript:**
```typescript
// Basic email link
const email = "john.smith@email.com";

<a href={`mailto:${email}`}>
  {email}
</a>

// Result: <a href="mailto:john.smith@email.com">john.smith@email.com</a>
```

**With Subject Line:**
```typescript
const email = "secretary@balcombe.com";
const subject = "Friendly Match Enquiry";

<a href={`mailto:${email}?subject=${encodeURIComponent(subject)}`}>
  {email}
</a>
```

**JavaScript:**
```javascript
function renderEmail(email) {
  return `<a href="mailto:${email}">${email}</a>`;
}

// Usage
renderEmail("contact@club.com");
// Returns: <a href="mailto:contact@club.com">contact@club.com</a>
```

### Examples

**Simple Email:**
```html
<a href="mailto:john.smith@email.com">john.smith@email.com</a>
```

**With Subject:**
```html
<a href="mailto:secretary@club.com?subject=Match%20Enquiry">
  secretary@club.com
</a>
```

**With Subject and Body:**
```html
<a href="mailto:captain@club.com?subject=Match%20Request&body=Dear%20Captain">
  captain@club.com
</a>
```

**Multiple Recipients:**
```html
<a href="mailto:captain@club.com,secretary@club.com">
  captain@club.com
</a>
```

### User Experience

**Mobile Devices:**
1. User taps email address
2. Email app opens automatically
3. Recipient pre-filled in "To:" field
4. User writes message and sends

**Desktop:**
1. User clicks email address
2. Default email client opens (Outlook, Mail, Gmail, etc.)
3. New message with recipient pre-filled
4. User composes and sends

### Best Practices

✅ **Do:**
- Use simple mailto: format for basic links
- URL-encode subject and body parameters
- Validate email addresses before rendering
- Test on multiple email clients

❌ **Don't:**
- Add spaces in email addresses
- Forget to encode special characters in parameters
- Make subject lines too long
- Pre-fill body text without user knowledge

### Code Example

**Full Implementation:**
```typescript
interface ContactEmailProps {
  label: string;
  email?: string;
  subject?: string;
}

function ContactEmail({ label, email, subject }: ContactEmailProps) {
  if (!email) return null;
  
  let href = `mailto:${email}`;
  if (subject) {
    href += `?subject=${encodeURIComponent(subject)}`;
  }
  
  return (
    <div className="contact-email">
      <strong>{label}:</strong>{' '}
      <a 
        href={href}
        className="email-link"
      >
        {email}
      </a>
    </div>
  );
}

// Usage
<ContactEmail 
  label="Email" 
  email="john.smith@email.com" 
/>

<ContactEmail 
  label="Secretary" 
  email="secretary@club.com"
  subject="Friendly Match Enquiry"
/>
```

---

## Match Card Implementation

### Club-Level Contacts

Display club phone/email from clubs sheet in Match Day Contacts:

```typescript
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
```

### Individual Contacts

Display contact phone/email from Contacts sheet:

```typescript
{clubContacts && clubContacts.map((contact, idx) => (
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
  </div>
))}
```

---

## Complete Example

### Match Card Contact Section

```typescript
// components/friendlies/MatchCardContacts.tsx

interface MatchCardContactsProps {
  clubDetails?: {
    clubNumber?: string;
    clubMobile?: string;
    clubEmail?: string;
  };
  contacts?: Array<{
    name: string;
    role?: string;
    phone?: string;
    mobile?: string;
    email?: string;
  }>;
}

export function MatchCardContacts({ 
  clubDetails, 
  contacts 
}: MatchCardContactsProps) {
  return (
    <div className="contacts-section">
      {/* Club-level contact info */}
      {(clubDetails?.clubNumber || clubDetails?.clubMobile || clubDetails?.clubEmail) && (
        <div className="club-contacts">
          <h3>Club Contact</h3>
          
          {clubDetails.clubNumber && (
            <div>
              <strong>Phone:</strong>{' '}
              <a href={`tel:${clubDetails.clubNumber.replace(/\s/g, '')}`}>
                {clubDetails.clubNumber}
              </a>
            </div>
          )}
          
          {clubDetails.clubMobile && (
            <div>
              <strong>Mobile:</strong>{' '}
              <a href={`tel:${clubDetails.clubMobile.replace(/\s/g, '')}`}>
                {clubDetails.clubMobile}
              </a>
            </div>
          )}
          
          {clubDetails.clubEmail && (
            <div>
              <strong>Email:</strong>{' '}
              <a href={`mailto:${clubDetails.clubEmail}`}>
                {clubDetails.clubEmail}
              </a>
            </div>
          )}
        </div>
      )}
      
      {/* Individual contacts */}
      {contacts && contacts.length > 0 && (
        <div className="individual-contacts">
          <h3>Contact{contacts.length > 1 ? 's' : ''}</h3>
          
          {contacts.map((contact, idx) => (
            <div key={idx} className="contact">
              <div className="contact-name">
                <strong>{contact.name}</strong>
                {contact.role && <span className="role"> ({contact.role})</span>}
              </div>
              
              {contact.mobile && (
                <div className="contact-detail">
                  <strong>Mobile:</strong>{' '}
                  <a href={`tel:${contact.mobile.replace(/\s/g, '')}`}>
                    {contact.mobile}
                  </a>
                </div>
              )}
              
              {contact.phone && (
                <div className="contact-detail">
                  <strong>Phone:</strong>{' '}
                  <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                    {contact.phone}
                  </a>
                </div>
              )}
              
              {contact.email && (
                <div className="contact-detail">
                  <strong>Email:</strong>{' '}
                  <a href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## CSS Styling

### Basic Styling

```css
/* Phone and email links */
.phone-link,
.email-link {
  color: #0066cc;
  text-decoration: none;
  transition: color 0.2s;
}

.phone-link:hover,
.email-link:hover {
  color: #0052a3;
  text-decoration: underline;
}

/* Mobile optimization */
@media (max-width: 768px) {
  .phone-link,
  .email-link {
    font-size: 16px; /* Prevent zoom on tap */
    padding: 8px 0;
    display: inline-block;
  }
}

/* Print styling */
@media print {
  .phone-link,
  .email-link {
    color: black;
    text-decoration: none;
  }
  
  .phone-link::after {
    content: " (" attr(href) ")";
    font-size: 0.9em;
    color: #666;
  }
}
```

### Enhanced Styling

```css
/* Contact section */
.contacts-section {
  margin: 20px 0;
  padding: 15px;
  background: #f9f9f9;
  border-radius: 8px;
}

.contact {
  margin-bottom: 15px;
  padding: 10px;
  background: white;
  border-left: 3px solid #0066cc;
}

.contact-name {
  font-size: 1.1em;
  margin-bottom: 8px;
}

.role {
  color: #666;
  font-weight: normal;
}

.contact-detail {
  margin: 5px 0;
  padding-left: 10px;
}

/* Icons (optional) */
.phone-link::before {
  content: "📞 ";
}

.email-link::before {
  content: "✉️ ";
}
```

---

## Testing

### Manual Testing Checklist

**Phone Links:**
- [ ] Click phone number on desktop
- [ ] Tap phone number on mobile
- [ ] Verify phone app opens
- [ ] Verify number is pre-filled
- [ ] Test with various formats (landline, mobile, international)
- [ ] Check spaces are removed from href
- [ ] Verify display format is readable

**Email Links:**
- [ ] Click email address on desktop
- [ ] Tap email address on mobile
- [ ] Verify email client opens
- [ ] Verify recipient is pre-filled
- [ ] Test with subject parameter (if used)
- [ ] Check email format is valid

**Cross-Browser Testing:**
- [ ] Chrome (desktop and mobile)
- [ ] Firefox
- [ ] Safari (desktop and iOS)
- [ ] Edge
- [ ] Samsung Internet (Android)

### Automated Testing

```typescript
// Test phone link formatting
describe('Phone Link', () => {
  it('should remove spaces from tel href', () => {
    const phoneNumber = '07700 900123';
    const cleanNumber = phoneNumber.replace(/\s/g, '');
    expect(cleanNumber).toBe('07700900123');
  });
  
  it('should render clickable phone link', () => {
    const { getByText } = render(
      <ContactPhone label="Mobile" phoneNumber="07700 900123" />
    );
    const link = getByText('07700 900123');
    expect(link).toHaveAttribute('href', 'tel:07700900123');
  });
});

// Test email link formatting
describe('Email Link', () => {
  it('should render clickable email link', () => {
    const { getByText } = render(
      <ContactEmail label="Email" email="test@example.com" />
    );
    const link = getByText('test@example.com');
    expect(link).toHaveAttribute('href', 'mailto:test@example.com');
  });
  
  it('should encode subject parameter', () => {
    const subject = 'Match Enquiry';
    const encoded = encodeURIComponent(subject);
    expect(encoded).toBe('Match%20Enquiry');
  });
});
```

---

## Accessibility

### Screen Reader Support

```html
<!-- Add aria-label for context -->
<a 
  href="tel:07700900123" 
  aria-label="Call mobile number 07700 900123"
>
  07700 900123
</a>

<a 
  href="mailto:john.smith@email.com"
  aria-label="Send email to john.smith@email.com"
>
  john.smith@email.com
</a>
```

### Keyboard Navigation

- Links must be keyboard accessible (Tab key)
- Enter key should activate link
- Visible focus indicator required
- Skip link option for multiple contacts

---

## Troubleshooting

### Phone Links Not Working

**Symptoms:**
- Click/tap does nothing
- Wrong app opens
- Number not pre-filled

**Solutions:**
1. Verify `tel:` protocol is correct
2. Check spaces are removed from href
3. Ensure no invalid characters in href
4. Test if device has phone app installed
5. Check browser permissions

### Email Links Not Working

**Symptoms:**
- Click/tap does nothing
- Wrong email client opens
- Recipient not pre-filled

**Solutions:**
1. Verify `mailto:` protocol is correct
2. Check email address is valid
3. Ensure no spaces in email address
4. Test if device has email client installed
5. Check default email client settings

---

## Summary

### Required Format

**Phone Numbers:**
```html
<a href="tel:{number-no-spaces}">{number-with-spaces}</a>
```

**Email Addresses:**
```html
<a href="mailto:{email}">{email}</a>
```

### Key Points

- ✅ All phone numbers must be clickable
- ✅ All email addresses must be clickable
- ✅ Remove spaces from tel: href only
- ✅ Keep spaces in display for readability
- ✅ Test on both mobile and desktop
- ✅ Consider accessibility
- ✅ Style appropriately for your design
- ✅ Handle null/empty values gracefully

### Benefits

- 📱 One-tap calling on mobile
- ✉️ One-tap emailing on mobile
- 🚀 Faster communication
- ✏️ Reduces manual entry errors
- ♿ Improves accessibility
- 👍 Better user experience
