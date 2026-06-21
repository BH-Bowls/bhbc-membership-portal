// app/admin/members/list/[userName]/page.tsx
// Member detail / amend — admin edits a member's fields. Username is read-only.
// Submits to PUT /api/admin/members/[userName] (which whitelists + validates).
// Admin only (middleware.ts).

'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses, getInputClasses, getCardClasses } from '@/config/theme-helpers';

// The editable fields we send on save (must match the API whitelist).
interface MemberForm {
  firstName: string;
  lastName: string;
  knownAs: string;
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  birthdate: string;
  ageDemographic: string;
  memberType: string;
  yearStarted: string;
  role: string;
  honorary: string;
  handicap: string;
  include: string;
  gmc: string;
  renewStatus: string;
  lockerNo: string;
  buddyUserName: string;
  drivingAwayMatches: string;
  drivingAdditionalInfo: string;
  greenMaintenance: string;
  greenAdditionalInfo: string;
  barDuty: string;
  barAdditionalInfo: string;
  otherSkills: string;
  socialEmails: boolean;
  handbookEntry: boolean;
}

// Convert a possibly-null value to a string for a controlled input.
function str(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export default function MemberDetailPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const userNameParam = decodeURIComponent(String(params.userName));

  const [form, setForm] = useState<MemberForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Other members, for the buddy selector
  const [memberOptions, setMemberOptions] = useState<{ userName: string; name: string }[]>([]);

  // Load the member's current details
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/admin/members/${encodeURIComponent(userNameParam)}`);
        if (!res.ok) {
          setError(res.status === 404 ? 'Member not found.' : 'Failed to load member.');
          setLoading(false);
          return;
        }
        const json = await res.json();
        const m = json.member;
        setForm({
          firstName: str(m.firstName),
          lastName: str(m.lastName),
          knownAs: str(m.knownAs),
          emailAddress: str(m.emailAddress),
          landline: str(m.landline),
          mobile: str(m.mobile),
          address1: str(m.address1),
          address2: str(m.address2),
          address3: str(m.address3),
          postCode: str(m.postCode),
          birthdate: str(m.birthdate),
          ageDemographic: str(m.ageDemographic),
          memberType: str(m.memberType),
          yearStarted: str(m.yearStarted),
          role: str(m.role),
          honorary: str(m.honorary),
          handicap: str(m.handicap),
          include: str(m.include),
          gmc: str(m.gmc),
          renewStatus: str(m.renewStatus),
          lockerNo: str(m.lockerNo),
          buddyUserName: str(m.buddyUserName),
          drivingAwayMatches: str(m.drivingAwayMatches),
          drivingAdditionalInfo: str(m.drivingAdditionalInfo),
          greenMaintenance: str(m.greenMaintenance),
          greenAdditionalInfo: str(m.greenAdditionalInfo),
          barDuty: str(m.barDuty),
          barAdditionalInfo: str(m.barAdditionalInfo),
          otherSkills: str(m.otherSkills),
          socialEmails: m.socialEmails === true,
          handbookEntry: m.handbookEntry === true,
        });
        setLoading(false);
      } catch {
        setError('Failed to load member.');
        setLoading(false);
      }
    };
    load();
  }, [userNameParam]);

  // Load the member list for the buddy selector
  useEffect(() => {
    fetch('/api/admin/members')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.members)) {
          const opts = json.members.map((m: any) => ({
            userName: m.userName,
            name: `${m.firstName} ${m.lastName}`,
          }));
          setMemberOptions(opts);
        }
      })
      .catch(() => {});
  }, []);

  // Update a single form field
  const set = (field: keyof MemberForm, value: any) => {
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  // Save the changes
  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(userNameParam)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: form }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to save changes.');
        setSaving(false);
        return;
      }
      setNotice('Changes saved.');
      setSaving(false);
    } catch {
      setError('Failed to save changes.');
      setSaving(false);
    }
  };

  const navName = session && session.user && session.user.name ? session.user.name : undefined;
  const navRole = session && session.user ? session.user.role : undefined;

  // A labelled text input bound to a form field
  const textField = (label: string, field: keyof MemberForm, type: string = 'text') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} className={getInputClasses()} value={str(form ? form[field] : '')} onChange={(e) => set(field, e.target.value)} />
    </div>
  );

  // A Y/N volunteering preference with an additional-information textarea
  const volunteerField = (label: string, ynField: keyof MemberForm, infoField: keyof MemberForm) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <select className={getInputClasses()} value={str(form ? form[ynField] : '')} onChange={(e) => set(ynField, e.target.value)}>
        <option value="">—</option>
        <option value="Y">Yes</option>
        <option value="N">No</option>
      </select>
      <textarea
        className={`${getInputClasses()} mt-2`}
        rows={2}
        placeholder="Additional information (optional)"
        value={str(form ? form[infoField] : '')}
        onChange={(e) => set(infoField, e.target.value)}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={navName} userRole={navRole} />

      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        <button className="text-sm text-gray-700 mb-2 hover:text-gray-900" onClick={() => router.push('/admin/members/list')}>
          ← Back to members
        </button>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Edit Member</h1>
        <p className="text-sm text-gray-700 mb-4">Username: <span className="font-medium text-gray-900">{userNameParam}</span> (cannot be changed)</p>

        {error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">{error}</div>
        ) : null}
        {notice ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800">{notice}</div>
        ) : null}

        {loading ? (
          <p className="text-sm text-gray-700">Loading…</p>
        ) : form === null ? null : (
          <>
            {/* Personal details */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Personal Details</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {textField('First Name', 'firstName')}
                {textField('Last Name', 'lastName')}
                {textField('Known As', 'knownAs')}
                {textField('Birthdate (DD/MM/YYYY)', 'birthdate')}
              </div>
            </div>

            {/* Contact */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Contact</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {textField('Email Address', 'emailAddress', 'email')}
                {textField('Mobile', 'mobile', 'tel')}
                {textField('Landline', 'landline', 'tel')}
                {textField('Post Code', 'postCode')}
                {textField('Address Line 1', 'address1')}
                {textField('Address Line 2', 'address2')}
                {textField('Address Line 3', 'address3')}
              </div>
            </div>

            {/* Membership */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Membership</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Member Type</label>
                  <select className={getInputClasses()} value={form.memberType} onChange={(e) => set('memberType', e.target.value)}>
                    <option value="">—</option>
                    <option>Playing Lady</option>
                    <option>Social Lady</option>
                    <option>Playing Man</option>
                    <option>Social Man</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Age Demographic</label>
                  <select className={getInputClasses()} value={form.ageDemographic} onChange={(e) => set('ageDemographic', e.target.value)}>
                    <option value="">—</option>
                    <option>U18</option>
                    <option>18-24</option>
                    <option>25-59</option>
                    <option>60+</option>
                    <option>80+</option>
                  </select>
                </div>
                {textField('Year Started', 'yearStarted', 'number')}
                {textField('Locker No', 'lockerNo')}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Buddy</label>
                  <select className={getInputClasses()} value={form.buddyUserName} onChange={(e) => set('buddyUserName', e.target.value)}>
                    <option value="">— none —</option>
                    {memberOptions.map((o) => (
                      <option key={o.userName} value={o.userName}>{o.name}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-700">A buddy can help manage this member&apos;s profile and renewals.</p>
                </div>
              </div>
            </div>

            {/* Admin */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Admin</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {textField('Role (comma-separated)', 'role')}
                {textField('Handicap (0–10)', 'handicap', 'number')}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Honorary</label>
                  <select className={getInputClasses()} value={form.honorary} onChange={(e) => set('honorary', e.target.value)}>
                    <option value="">No</option>
                    <option value="Y">Yes</option>
                    <option value="N">No (explicit)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Include in renewal emails</label>
                  <select className={getInputClasses()} value={form.include} onChange={(e) => set('include', e.target.value)}>
                    <option value="Y">Yes</option>
                    <option value="N">No</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Renewal delivery (Renew Status)</label>
                  <select className={getInputClasses()} value={form.renewStatus} onChange={(e) => set('renewStatus', e.target.value)}>
                    <option value="">—</option>
                    <option value="Renew-Email">Renew-Email</option>
                    <option value="Renew-Post">Renew-Post</option>
                  </select>
                </div>
                {textField('GMC (blank or "GMC")', 'gmc')}
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.socialEmails} onChange={(e) => set('socialEmails', e.target.checked)} />
                  Receives social emails
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={form.handbookEntry} onChange={(e) => set('handbookEntry', e.target.checked)} />
                  Include in handbook
                </label>
              </div>
              <p className="mt-3 text-xs text-gray-700">
                Password reset is handled separately via the password reset flow.
              </p>
            </div>

            {/* Volunteering */}
            <div className={`${getCardClasses('md')} mb-4`}>
              <h2 className="text-base font-semibold text-gray-900 mb-3">Volunteering</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {volunteerField('Driving to away matches', 'drivingAwayMatches', 'drivingAdditionalInfo')}
                {volunteerField('Green maintenance', 'greenMaintenance', 'greenAdditionalInfo')}
                {volunteerField('Bar duty', 'barDuty', 'barAdditionalInfo')}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Other Skills</label>
                  <textarea className={getInputClasses()} rows={2} value={form.otherSkills} onChange={(e) => set('otherSkills', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button className={getButtonClasses('primary', 'md')} disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button className={getButtonClasses('secondary', 'md')} onClick={() => router.push('/admin/members/list')}>
                Cancel
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
