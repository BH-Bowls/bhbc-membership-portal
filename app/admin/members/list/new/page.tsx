// app/admin/members/list/new/page.tsx
// Create a new member manually. Submits to POST /api/admin/members, then shows the
// generated username + temporary password (and whether a welcome email was sent).
// Admin only (middleware.ts).

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses, getInputClasses, getCardClasses } from '@/config/theme-helpers';

// Result shown after a successful create
interface CreatedResult {
  userName: string;
  tempPassword: string;
  emailSent: boolean;
  emailError?: string;
}

export default function CreateMemberPage() {
  const { data: session } = useSession();
  const router = useRouter();

  // Form state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [knownAs, setKnownAs] = useState('');
  const [gender, setGender] = useState('');
  const [memberType, setMemberType] = useState('');
  const [ageDemographic, setAgeDemographic] = useState('');
  const [dob, setDob] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [mobile, setMobile] = useState('');
  const [landline, setLandline] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [address3, setAddress3] = useState('');
  const [postCode, setPostCode] = useState('');
  const [sendWelcomeEmail, setSendWelcomeEmail] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedResult | null>(null);

  // Submit the new member
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName, lastName, knownAs, gender, memberType, ageDemographic, dob,
          emailAddress, mobile, landline, address1, address2, address3, postCode,
          sendWelcomeEmail,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to create member.');
        setSubmitting(false);
        return;
      }
      setCreated({
        userName: json.userName,
        tempPassword: json.tempPassword,
        emailSent: json.emailSent === true,
        emailError: json.emailError,
      });
      setSubmitting(false);
    } catch {
      setError('Failed to create member.');
      setSubmitting(false);
    }
  };

  const navName = session && session.user && session.user.name ? session.user.name : undefined;
  const navRole = session && session.user ? session.user.role : undefined;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={navName} userRole={navRole} />

      <main className="max-w-2xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <button className="text-sm text-gray-700 mb-2 hover:text-gray-900" onClick={() => router.push('/admin/members/list')}>
          ← Back to members
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Add Member</h1>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}

        {created ? (
          // Success summary with the generated credentials
          <div className={`${getCardClasses('md')}`}>
            <h2 className="text-base font-semibold text-gray-900 mb-2">Member created</h2>
            <p className="text-sm text-gray-700 mb-1">Username: <span className="font-mono font-medium text-gray-900">{created.userName}</span></p>
            <p className="text-sm text-gray-700 mb-1">Temporary password: <span className="font-mono font-medium text-gray-900">{created.tempPassword}</span></p>
            <p className="text-sm text-gray-700 mb-3">
              {created.emailSent
                ? 'A welcome email with these details has been sent.'
                : 'No welcome email was sent — note these details and pass them to the member.'}
              {created.emailError ? ` (Email error: ${created.emailError})` : ''}
            </p>
            <p className="text-xs text-gray-700 mb-4">The member will be asked to change their password on first login.</p>
            <div className="flex gap-3">
              <button className={getButtonClasses('primary', 'md')} onClick={() => router.push(`/admin/members/list/${encodeURIComponent(created.userName)}`)}>
                Edit Member
              </button>
              <button className={getButtonClasses('secondary', 'md')} onClick={() => router.push('/admin/members/list')}>
                Back to Members
              </button>
            </div>
          </div>
        ) : (
          <div className={`${getCardClasses('md')}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                <input type="text" className={getInputClasses()} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                <input type="text" className={getInputClasses()} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Known As</label>
                <input type="text" className={getInputClasses()} value={knownAs} onChange={(e) => setKnownAs(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gender *</label>
                <select className={getInputClasses()} value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">—</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Member Type *</label>
                <select className={getInputClasses()} value={memberType} onChange={(e) => setMemberType(e.target.value)}>
                  <option value="">—</option>
                  <option value="Playing">Playing</option>
                  <option value="Social">Social</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Age Demographic *</label>
                <select className={getInputClasses()} value={ageDemographic} onChange={(e) => setAgeDemographic(e.target.value)}>
                  <option value="">—</option>
                  <option>U18</option>
                  <option>18-24</option>
                  <option>25-59</option>
                  <option>60+</option>
                  <option>80+</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Birthdate (DD/MM/YYYY)</label>
                <input type="text" className={getInputClasses()} value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input type="email" className={getInputClasses()} value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                <input type="tel" className={getInputClasses()} value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Landline</label>
                <input type="tel" className={getInputClasses()} value={landline} onChange={(e) => setLandline(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Post Code</label>
                <input type="text" className={getInputClasses()} value={postCode} onChange={(e) => setPostCode(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
                <input type="text" className={getInputClasses()} value={address1} onChange={(e) => setAddress1(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
                <input type="text" className={getInputClasses()} value={address2} onChange={(e) => setAddress2(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 3</label>
                <input type="text" className={getInputClasses()} value={address3} onChange={(e) => setAddress3(e.target.value)} />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 mt-4">
              <input type="checkbox" checked={sendWelcomeEmail} onChange={(e) => setSendWelcomeEmail(e.target.checked)} />
              Send welcome email with login details (requires an email address)
            </label>

            <div className="flex gap-3 mt-4">
              <button className={getButtonClasses('primary', 'md')} disabled={submitting} onClick={submit}>
                {submitting ? 'Creating…' : 'Create Member'}
              </button>
              <button className={getButtonClasses('secondary', 'md')} onClick={() => router.push('/admin/members/list')}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
