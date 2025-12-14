// app/profile/page.tsx
// User profile page with view and edit functionality and buddy system

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { UserSelector } from '@/components/UserSelector';

interface ProfileData {
  title: string;
  firstName: string;
  lastName: string;
  knownAs: string;
  fullKnownAs: string;
  buddyUserName: string;
  emailAddress: string;
  landline: string;
  mobile: string;
  address1: string;
  address2: string;
  address3: string;
  postCode: string;
  lockerNo: string;
  birthdate: string;
  ageDemographic: string;
  memberType: string;
  yearStarted: number;
  socialEmails: boolean;
  handbookEntry: boolean;
  drivingAwayMatches: string;
  drivingAdditionalInfo: string;
  greenMaintenance: string;
  greenAdditionalInfo: string;
  barDuty: string;
  barAdditionalInfo: string;
  otherSkills: string;
  profileUpdatedDate: string;
}

interface ManageableUser {
  userName: string;
  fullKnownAs: string;
  isSelf: boolean;
}

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [editedProfile, setEditedProfile] = useState<Partial<ProfileData>>({});

  // Buddy system state
  const [manageableUsers, setManageableUsers] = useState<ManageableUser[]>([]);
  const [selectedUserName, setSelectedUserName] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);

  // Load manageable users on mount
  useEffect(() => {
    if (status === 'authenticated') {
      loadManageableUsers();
    }
  }, [status]);

  // Load profile when selected user changes
  useEffect(() => {
    if (selectedUserName) {
      loadProfile(selectedUserName);
    }
  }, [selectedUserName]);

  const loadManageableUsers = async () => {
    try {
      const response = await fetch('/api/buddies');
      if (!response.ok) throw new Error('Failed to load manageable users');

      const data = await response.json();
      setManageableUsers(data.users);
      setIsAdmin(data.isAdmin);

      // Default to self
      const self = data.users.find((u: ManageableUser) => u.isSelf);
      if (self) {
        setSelectedUserName(self.userName);
      }
    } catch (err) {
      setError('Failed to load manageable users');
    }
  };

  const loadProfile = async (userName: string) => {
    try {
      const response = await fetch(`/api/profile?userName=${userName}`);
      if (!response.ok) throw new Error('Failed to load profile');

      const data = await response.json();
      setProfile(data.profile);
      setEditedProfile(data.profile);
    } catch (err) {
      setError('Failed to load profile');
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setError('');
    setSuccessMessage('');
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedProfile(profile || {});
    setError('');
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: selectedUserName,
          updates: editedProfile,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update profile');
      }

      setSuccessMessage('Profile updated successfully!');
      setIsEditing(false);
      await loadProfile(selectedUserName); // Reload fresh data
    } catch (err: any) {
      setError(err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChange = (field: keyof ProfileData, value: any) => {
    setEditedProfile(prev => ({ ...prev, [field]: value }));
  };

  // Convert DD/MM/YYYY to YYYY-MM-DD for HTML date input
  const formatDateForInput = (dateStr: string | null): string => {
    if (!dateStr) return '';

    // Check if already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }

    // Convert DD/MM/YYYY to YYYY-MM-DD
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    return '';
  };

  // Convert YYYY-MM-DD to DD/MM/YYYY for storage
  const formatDateForStorage = (dateStr: string): string => {
    if (!dateStr) return '';

    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }

    return dateStr;
  };

  if (status === 'loading' || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => router.push('/')}
                className="text-indigo-600 hover:text-indigo-700 font-medium"
              >
                ← Back to Home
              </button>
            </div>
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">My Profile</h1>
            </div>
            <div className="w-24"></div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Messages */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        {successMessage && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {successMessage}
          </div>
        )}

        {/* User Selector (if managing others) */}
        <UserSelector
          users={manageableUsers}
          selectedUserName={selectedUserName}
          onChange={(userName) => {
            setSelectedUserName(userName);
            setIsEditing(false); // Exit edit mode when switching users
          }}
          featureName="profile"
          isAdmin={isAdmin}
          disabled={isEditing}
        />

        {/* Profile Card */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 mb-6">
              {!isEditing ? (
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  Edit Profile
                </button>
              ) : (
                <>
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                    disabled={isSaving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </>
              )}
            </div>

            {/* Personal Information */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Personal Information</h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Title</label>
                  {isEditing ? (
                    <select
                      value={editedProfile.title || ''}
                      onChange={(e) => handleChange('title', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    >
                      <option value="Mr">Mr</option>
                      <option value="Mrs">Mrs</option>
                      <option value="Miss">Miss</option>
                      <option value="Ms">Ms</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.title}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">First Name</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.firstName || ''}
                      onChange={(e) => handleChange('firstName', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.firstName}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Last Name</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.lastName || ''}
                      onChange={(e) => handleChange('lastName', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.lastName}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Known As</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.knownAs || ''}
                      onChange={(e) => handleChange('knownAs', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                      placeholder="Leave blank to use first name"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.knownAs || '—'}</p>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Display Name (for Membership book etc)
                  </label>
                  <p className="mt-1 text-sm text-gray-900">{profile.fullKnownAs || '—'}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Buddy User ID</label>
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={editedProfile.buddyUserName || ''}
                        onChange={(e) => handleChange('buddyUserName', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                        placeholder="john_smith"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Format: firstname_lastname (e.g., john_smith)
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.buddyUserName || '—'}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Contact Information</h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Email Address
                  </label>
                  {isEditing ? (
                    <input
                      type="email"
                      value={editedProfile.emailAddress || ''}
                      onChange={(e) => handleChange('emailAddress', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.emailAddress || '—'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Landline</label>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editedProfile.landline || ''}
                      onChange={(e) => handleChange('landline', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.landline || '—'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Mobile</label>
                  {isEditing ? (
                    <input
                      type="tel"
                      value={editedProfile.mobile || ''}
                      onChange={(e) => handleChange('mobile', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.mobile || '—'}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Address */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Address</h3>
              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Address Line 1</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.address1 || ''}
                      onChange={(e) => handleChange('address1', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.address1 || '—'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Address Line 2</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.address2 || ''}
                      onChange={(e) => handleChange('address2', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.address2 || '—'}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Town/City</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.address3 || ''}
                        onChange={(e) => handleChange('address3', e.target.value)}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-gray-900">{profile.address3 || '—'}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Post Code</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.postCode || ''}
                        onChange={(e) => handleChange('postCode', e.target.value.toUpperCase())}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-gray-900">{profile.postCode || '—'}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Membership Information */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Membership Information</h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Member Type</label>
                  {isEditing ? (
                    <select
                      value={editedProfile.memberType || ''}
                      onChange={(e) => handleChange('memberType', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    >
                      <option value="Playing">Playing</option>
                      <option value="Social">Social</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.memberType}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Year Started</label>
                  {isEditing ? (
                    <input
                      type="number"
                      value={editedProfile.yearStarted || ''}
                      onChange={(e) => handleChange('yearStarted', parseInt(e.target.value))}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.yearStarted || '—'}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">Age Demographic</label>
                  {isEditing ? (
                    <select
                      value={editedProfile.ageDemographic || ''}
                      onChange={(e) => handleChange('ageDemographic', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    >
                      <option value="U18">Under 18</option>
                      <option value="18-24">Between 18 and 24</option>
                      <option value="25-59">Between 25 and 59</option>
                      <option value="60+">Over 60</option>
                      <option value="80+">Over 80</option>
                    </select>
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.ageDemographic}</p>
                  )}
                </div>

                {/* CONDITIONAL DATE OF BIRTH - Only show if U18 */}
                {(isEditing ? editedProfile.ageDemographic : profile.ageDemographic) === 'U18' && (
                  <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200 animate-in fade-in duration-200">
                    <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200">
                      <label className="block text-sm font-medium text-gray-700">
                        Date of Birth
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          Required for Under 18
                        </span>
                      </label>
                      {isEditing ? (
                        <input
                          type="date"
                          value={formatDateForInput(editedProfile.birthdate || '')}
                          onChange={(e) => handleChange('birthdate', formatDateForStorage(e.target.value))}
                          required
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                        />
                      ) : (
                        <p className="mt-1 text-sm text-gray-900">
                          {profile.birthdate ? (
                            profile.birthdate.includes('/') ? profile.birthdate : new Date(profile.birthdate).toLocaleDateString('en-GB')
                          ) : (
                            <span className="text-red-600">Not provided</span>
                          )}
                        </p>
                      )}
                      {!profile.birthdate && (
                        <p className="mt-1 text-xs text-red-600 flex items-center">
                          <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                          </svg>
                          Date of birth is required for junior members
                        </p>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700">Locker Number</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.lockerNo || ''}
                      onChange={(e) => handleChange('lockerNo', e.target.value)}
                      className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{profile.lockerNo || '—'}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Volunteering Preferences */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Volunteering</h3>
              
              {/* Driving */}
              <div className="mb-6 pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Driving to Away Matches
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Are you willing to drive other members to away matches?
                </p>
                {isEditing ? (
                  <>
                    <select
                      value={editedProfile.drivingAwayMatches || ''}
                      onChange={(e) => handleChange('drivingAwayMatches', e.target.value)}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border mb-2 text-gray-900"
                    >
                      <option value="" disabled>Please select</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                    <textarea
                      value={editedProfile.drivingAdditionalInfo || ''}
                      onChange={(e) => handleChange('drivingAdditionalInfo', e.target.value)}
                      placeholder="Additional information (e.g., limited space)"
                      rows={2}
                      className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-gray-900">
                      {profile.drivingAwayMatches || '—'}
                    </p>
                    {profile.drivingAdditionalInfo && (
                      <p className="mt-1 text-sm text-gray-500">
                        {profile.drivingAdditionalInfo}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Green Maintenance */}
              <div className="mb-6 pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Green & Clubhouse Maintenance
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Are you willing to help with green maintenance, mowing, hedges, etc.?
                </p>
                {isEditing ? (
                  <>
                    <select
                      value={editedProfile.greenMaintenance || ''}
                      onChange={(e) => handleChange('greenMaintenance', e.target.value)}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border mb-2 text-gray-900"
                    >
                      <option value="" disabled>Please select</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                    <textarea
                      value={editedProfile.greenAdditionalInfo || ''}
                      onChange={(e) => handleChange('greenAdditionalInfo', e.target.value)}
                      placeholder="Additional information"
                      rows={2}
                      className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-gray-900">
                      {profile.greenMaintenance || '—'}
                    </p>
                    {profile.greenAdditionalInfo && (
                      <p className="mt-1 text-sm text-gray-500">
                        {profile.greenAdditionalInfo}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Bar Duty */}
              <div className="mb-6 pb-6 border-b">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Bar Duty
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Are you willing to help with running the bar?
                </p>
                {isEditing ? (
                  <>
                    <select
                      value={editedProfile.barDuty || ''}
                      onChange={(e) => handleChange('barDuty', e.target.value)}
                      className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border mb-2 text-gray-900"
                    >
                      <option value="" disabled>Please select</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                    <textarea
                      value={editedProfile.barAdditionalInfo || ''}
                      onChange={(e) => handleChange('barAdditionalInfo', e.target.value)}
                      placeholder="Additional information"
                      rows={2}
                      className="mt-2 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                    />
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm text-gray-900">
                      {profile.barDuty || '—'}
                    </p>
                    {profile.barAdditionalInfo && (
                      <p className="mt-1 text-sm text-gray-500">
                        {profile.barAdditionalInfo}
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Other Skills */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Other Skills
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Any other skills that may benefit the club (plumbing, IT, legal, etc.)
                </p>
                {isEditing ? (
                  <textarea
                    value={editedProfile.otherSkills || ''}
                    onChange={(e) => handleChange('otherSkills', e.target.value)}
                    rows={3}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                  />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">
                    {profile.otherSkills || '—'}
                  </p>
                )}
              </div>
            </div>

            {/* Permissions */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Permissions</h3>
              <div className="space-y-4">
                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      checked={editedProfile.socialEmails ?? profile.socialEmails}
                      onChange={(e) => handleChange('socialEmails', e.target.checked)}
                      disabled={!isEditing}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">Social event emails</label>
                    <p className="text-gray-500">Receive emails about social events and club news</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      checked={editedProfile.handbookEntry ?? profile.handbookEntry}
                      onChange={(e) => handleChange('handbookEntry', e.target.checked)}
                      disabled={!isEditing}
                      className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                    />
                  </div>
                  <div className="ml-3 text-sm">
                    <label className="font-medium text-gray-700">Handbook entry</label>
                    <p className="text-gray-500">Include contact details in membership handbook</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Last Updated */}
            <div className="border-t pt-4">
              <p className="text-xs text-gray-500">
                Profile last updated: {profile.profileUpdatedDate ? new Date(profile.profileUpdatedDate).toLocaleDateString() : 'Never'}
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
