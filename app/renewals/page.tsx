// app/renewals/page.tsx
// Membership renewal page for 2026 season

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { getMemberTypeDisplay, getMemberTypeOptions, isPlayer } from '@/lib/member-type-utils';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';

interface UserProfile {
  userName: string;
  fullKnownAs: string;
  lastName: string;
  ageDemographic: string;
  memberType: string; // PL=Playing Lady, SL=Social Lady, PM=Playing Man, SM=Social Man
  honorary: string | null; // "Y" or "N" or null
  friendliesLastYear: number | string; // Can be a number or "X" for manual override
  emailAddress: string;
  title: string | null;
}

interface Renewal {
  userName: string;
  renewingMembership: boolean;
  number200ClubEntries: number;
  pref200Club?: string;
  cleaningDatesToAvoid?: string;
  teaDatesToAvoid?: string;
  drivingAwayMatches?: string;
  drivingAdditionalInfo?: string;
  greenMaintenance?: string;
  greenAdditionalInfo?: string;
  barDuty?: string;
  barAdditionalInfo?: string;
  otherSkills?: string;
  mensChampionship: boolean;
  ladiesMaynard: boolean;
  mensTwoWood: boolean;
  ladiesTwoWood: boolean;
  marriedPairs: boolean;
  drawnPairs: boolean;
  australianPairs: boolean;
  drawnTriples: boolean;
  handicap: boolean;
  oldlands: boolean;
  veterans: boolean;
  drawnPairsSub: boolean;
  australianPairsSub: boolean;
  drawnTriplesSub: boolean;
  outstanding?: number | null;
  banking?: number | null;
  dateReceived?: string | null;
}

interface FeeBreakdown {
  membershipFee: number;
  club200Fee: number;
  compsFee: number;
  total: number;
}

export default function RenewalsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [renewal, setRenewal] = useState<Renewal | null>(null);
  const [editedRenewal, setEditedRenewal] = useState<Renewal | null>(null);
  const [fees, setFees] = useState<FeeBreakdown>({
    membershipFee: 0,
    club200Fee: 0,
    compsFee: 0,
    total: 0,
  });

  // Editable fields for renewal (not saved to profile)
  const [ageDemographic, setAgeDemographic] = useState<string>('');
  const [memberType, setMemberType] = useState<string>('');
  const [editedAgeDemographic, setEditedAgeDemographic] = useState<string>('');
  const [editedMemberType, setEditedMemberType] = useState<string>('');
  const [fullTimeEducation, setFullTimeEducation] = useState<boolean>(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [emailSent, setEmailSent] = useState(true); // Track if confirmation email was sent
  const [emailWarning, setEmailWarning] = useState(''); // Warning if email failed
  const [eligibility, setEligibility] = useState<{
    canEnterCompetitions: boolean;
    friendliesLastYear: number | string;
  }>({
    canEnterCompetitions: false,
    friendliesLastYear: 0,
  });

  // Load renewal data on mount and when session changes (uses session.user.userName automatically)
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.userName) {
      loadRenewalData();
    }
  }, [status, session?.user?.userName, session?.user?.isImpersonating]);

  // Reset editing state when user changes (prevents stale state after switching users)
  useEffect(() => {
    setIsEditing(false);
    setEditedRenewal(null); // Clear edited data to prevent auto-save race condition
  }, [session?.user?.userName]);

  // Recalculate fees whenever renewal data or demographics change
  useEffect(() => {
    if (profile) {
      const currentRenewal = isEditing ? editedRenewal : renewal;
      const currentAgeDemographic = isEditing ? editedAgeDemographic : ageDemographic;
      const currentMemberType = isEditing ? editedMemberType : memberType;

      if (currentRenewal && currentAgeDemographic && currentMemberType) {
        const newFees = calculateFeesClient(
          { ...profile, ageDemographic: currentAgeDemographic, memberType: currentMemberType },
          currentRenewal,
          fullTimeEducation
        );
        setFees(newFees);
      }
    }
  }, [profile, renewal, editedRenewal, ageDemographic, editedAgeDemographic, memberType, editedMemberType, fullTimeEducation, isEditing]);

  // Scroll to top when error is displayed
  useEffect(() => {
    if (error) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [error]);

  const loadRenewalData = async () => {
    try {
      setIsLoading(true);
      setError('');
      setSuccessMessage('');
      // No userName parameter needed - API uses session.user.userName
      const response = await fetch('/api/renewals');
      if (!response.ok) throw new Error('Failed to load renewal data');

      const data = await response.json();
      setProfile(data.profile);
      setRenewal(data.renewal);
      setFees(data.fees);
      setEligibility(data.eligibility);

      // Initialize fields from profile
      setAgeDemographic(data.profile.ageDemographic);
      setMemberType(data.profile.memberType);

      // Check for draft and restore if found
      if (session?.user?.userName) {
        const draft = restoreDraft<{
          renewal: Renewal;
          ageDemographic: string;
          memberType: string;
        }>('Renewals', session.user.userName);

        if (draft) {
          setEditedRenewal(draft.renewal);
          setEditedAgeDemographic(draft.ageDemographic);
          setEditedMemberType(draft.memberType);
          setIsEditing(true);
          // Show notification that draft was restored
          setSuccessMessage('Draft restored from previous session');
          setTimeout(() => setSuccessMessage(''), 3000);
        } else {
          setEditedRenewal(data.renewal);
          setEditedAgeDemographic(data.profile.ageDemographic);
          setEditedMemberType(data.profile.memberType);
        }
      } else {
        setEditedRenewal(data.renewal);
        setEditedAgeDemographic(data.profile.ageDemographic);
        setEditedMemberType(data.profile.memberType);
      }
    } catch (err) {
      setError('Failed to load renewal data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-save drafts when editing
  useEffect(() => {
    if (!renewal || !session?.user?.userName || !isEditing) return;

    const draftData = {
      renewal: editedRenewal,
      ageDemographic: editedAgeDemographic,
      memberType: editedMemberType,
    };

    const hasChanges = JSON.stringify(draftData) !== JSON.stringify({
      renewal,
      ageDemographic,
      memberType,
    });

    // Auto-save draft when in edit mode and changes exist
    if (hasChanges) {
      saveDraft('Renewals', session.user.userName, draftData);
    }
  }, [editedRenewal, editedAgeDemographic, editedMemberType, renewal, ageDemographic, memberType, isEditing, session?.user?.userName]);

  const handleEdit = () => {
    setIsEditing(true);
    setError('');
    setSuccessMessage('');
  };

  const handleCancel = () => {
    if (session?.user?.userName) {
      clearDraft('Renewals', session.user.userName);
    }
    setIsEditing(false);
    setEditedRenewal(renewal);
    setEditedAgeDemographic(ageDemographic);
    setEditedMemberType(memberType);
    setError('');
    setSuccessMessage('');
  };

  const handleChange = (field: keyof Renewal, value: any) => {
    if (!editedRenewal) return;
    setEditedRenewal({ ...editedRenewal, [field]: value });
  };

  const handleSave = async () => {
    if (!editedRenewal) return;

    // Validation: Check if required fields are set
    if (!editedAgeDemographic || !editedMemberType) {
      setError('Please select both Age Demographic and Member Type before saving.');
      return;
    }

    setIsSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/renewals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editedRenewal,
          ageDemographic: editedAgeDemographic, // Include age demographic for Members sheet update
          memberType: editedMemberType, // Include member type for Members sheet update
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save renewal');
      }

      const data = await response.json();
      setFees(data.fees);

      // Track email status
      setEmailSent(data.emailSent !== false); // Default to true if not specified
      setEmailWarning(data.warning || '');

      // Clear draft on successful save
      if (session?.user?.userName) {
        clearDraft('Renewals', session.user.userName);
      }

      // Update main state with saved values
      setRenewal(editedRenewal);
      setAgeDemographic(editedAgeDemographic);
      setMemberType(editedMemberType);
      setIsEditing(false);
      setIsSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to save renewal');
    } finally {
      setIsSaving(false);
    }
  };

  // Client-side fee calculation (mirrors backend logic)
  const calculateFeesClient = (
    profile: UserProfile,
    renewal: Renewal,
    fullTimeEdu: boolean = false
  ): FeeBreakdown => {
    let membershipFee = 0;

    const ageDem = profile.ageDemographic;
    const memType = profile.memberType;
    const isHonorary = profile.honorary === 'Y';

    // Honorary members pay no fee regardless of member type
    if (isHonorary) {
      membershipFee = 0;
    }
    // Playing members (Playing Lady or Playing Man)
    else if (memType === 'Playing Lady' || memType === 'Playing Man') {
      switch (ageDem) {
        case 'U18':
          membershipFee = 10;
          break;
        case '18-24':
          membershipFee = fullTimeEdu ? 10 : 60;
          break;
        case '25-59':
          membershipFee = 110;
          break;
        case '60+':
          membershipFee = 110;
          break;
        case '80+':
          membershipFee = 60;
          break;
      }
    }
    // Social members (Social Lady or Social Man)
    else if (memType === 'Social Lady' || memType === 'Social Man') {
      membershipFee = 25;
    }

    // Calculate 200 Club fees
    const club200Fee = renewal.number200ClubEntries * 6;

    // Calculate competition fees
    const competitions = [
      'mensChampionship',
      'ladiesMaynard',
      'mensTwoWood',
      'ladiesTwoWood',
      'marriedPairs',
      'drawnPairs',
      'australianPairs',
      'drawnTriples',
      'handicap',
      'oldlands',
      'veterans',
    ];

    const compCount = competitions.filter(
      (comp) => renewal[comp as keyof Renewal] === true
    ).length;

    const compsFee = compCount * 2;

    const total = membershipFee + club200Fee + compsFee;

    return { membershipFee, club200Fee, compsFee, total };
  };

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

  // Get allowed member types for dropdown
  const getAllowedMemberTypes = () => {
    // Return all member type options
    return getMemberTypeOptions();
  };

  // Determine if user can enter a competition based on member type
  const canEnterCompetition = (competitionKey: string): boolean => {
    if (!profile?.memberType) return true; // Default to allow if no member type

    const isMale = profile.memberType === 'Playing Man' || profile.memberType === 'Social Man';
    const isFemale = profile.memberType === 'Playing Lady' || profile.memberType === 'Social Lady';

    // Men's only competitions
    if (competitionKey === 'mensChampionship' || competitionKey === 'mensTwoWood') {
      return isMale;
    }

    // Ladies' only competitions
    if (competitionKey === 'ladiesMaynard' || competitionKey === 'ladiesTwoWood') {
      return isFemale;
    }

    // All other competitions are open to everyone
    return true;
  };

  if (status === 'loading' || isLoading || !profile || !renewal) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading renewal data...</p>
        </div>
      </div>
    );
  }

  // Check if payment has been received (form should be read-only)
  // Admins can edit even after payment is received
  const isAdmin = session?.user?.role === 'Admin' || session?.user?.role === 'Super Admin';
  const paymentReceived = (renewal.banking !== null && renewal.banking !== undefined) && !isAdmin;

  // Helper variables: use edited values when editing, otherwise use saved values
  const currentRenewal = isEditing ? editedRenewal : renewal;
  const currentAgeDemographic = isEditing ? editedAgeDemographic : ageDemographic;
  const currentMemberType = isEditing ? editedMemberType : memberType;
  const isFormDisabled = !isEditing || paymentReceived;

  // Success message after submission
  if (isSubmitted && renewal.renewingMembership) {
    const isImpersonating = session?.user?.isImpersonating || false;

    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />

        <main className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
          <div className="bg-white shadow-lg rounded-lg overflow-hidden">
            <div className="bg-green-50 px-6 py-4 border-b border-green-100">
              <div className="flex items-center">
                <svg className="h-6 w-6 text-green-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <h2 className="text-lg font-semibold text-green-900">
                  {isImpersonating
                    ? `Thank you! ${profile?.fullKnownAs}'s renewal has been submitted.`
                    : 'Thank you! Your renewal has been submitted.'}
                </h2>
              </div>
            </div>

            <div className="px-6 py-8">
              <div className="mb-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Fee Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Membership Fee:</span>
                    <span className="font-medium">{formatCurrency(fees.membershipFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">200 Club:</span>
                    <span className="font-medium">{formatCurrency(fees.club200Fee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Competitions:</span>
                    <span className="font-medium">{formatCurrency(fees.compsFee)}</span>
                  </div>
                  <div className="border-t pt-2 mt-2 flex justify-between text-lg">
                    <span className="font-semibold text-gray-900">Total Payable:</span>
                    <span className="font-bold text-blue-500">{formatCurrency(fees.total)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-medium text-blue-900 mb-3">Payment Details</h3>
                <div className="space-y-1 text-sm text-blue-800">
                  <p><span className="font-medium">Bank:</span> HSBC</p>
                  <p><span className="font-medium">Sort Code:</span> 40-15-16</p>
                  <p><span className="font-medium">Account Number:</span> 81554948</p>
                  <p><span className="font-medium">Account Name:</span> Burgess Hill Bowls Club</p>
                  <p><span className="font-medium">Reference:</span> SUBS {profile.lastName.toUpperCase()}</p>
                </div>
                <p className="mt-4 text-sm text-blue-700">
                  Please make payment at your earliest convenience. Card payments are also accepted at the bar.
                </p>
              </div>

              {renewal.drawnTriples && (
                <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6">
                  <div className="flex items-start">
                    <svg className="h-5 w-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-yellow-900 mb-1">Important: Drawn Triples Competition</p>
                      <p className="text-sm text-yellow-800">
                        The 1st round of TRIPLES is to be played at 10 a.m. on Sunday 24th May, unless an earlier date is agreed by all 6 players.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {emailSent ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    ✉️ A confirmation email has been sent{profile?.emailAddress ? ' to' : ''}{' '}
                    {isImpersonating && profile?.emailAddress && (
                      <span className="font-medium">{profile?.fullKnownAs} at </span>
                    )}
                    {profile?.emailAddress && (
                      <span className="font-medium">{profile?.emailAddress}</span>
                    )}
                  </p>
                </div>
              ) : emailWarning && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    ⚠️ {emailWarning}
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => router.push('/')}
                  className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Return to Home
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={isEditing ? {
          primary: {
            label: editedRenewal?.renewingMembership ? 'Submit Renewal' : 'Save',
            onClick: handleSave,
            loading: isSaving,
            variant: 'primary' as const,
          },
          secondary: {
            label: 'Cancel',
            onClick: handleCancel,
            disabled: isSaving,
            variant: 'secondary' as const,
          },
        } : undefined}
      />

      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {successMessage}
          </div>
        )}

        {/* Success Message (non-renewing) */}
        {isSubmitted && !renewal.renewingMembership && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            Your renewal status has been updated.
          </div>
        )}

        {/* Renewal Form */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            {/* Edit Button (View Mode Only) - Submit/Cancel are in navbar when editing */}
            {!isEditing && !paymentReceived && (
              <div className="flex justify-end space-x-3 mb-6">
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  Edit Renewal
                </button>
              </div>
            )}

            {/* Membership Renewal Section */}
            <div className="mb-8">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={currentRenewal?.renewingMembership || false}
                  onChange={(e) => handleChange('renewingMembership', e.target.checked)}
                  disabled={isFormDisabled}
                  className="h-5 w-5 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <label className="ml-3 text-lg font-medium text-gray-900">
                  I will be renewing my membership for the 2026 season
                </label>
              </div>

              {currentRenewal?.renewingMembership && (
                <div className="mt-6 p-4 bg-gray-50 rounded-md">
                  <p className="text-sm text-gray-600 mb-4">
                    Please ensure you select the correct age demographic as that affects the membership level.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Age Demographic
                      </label>
                      <select
                        value={currentAgeDemographic}
                        onChange={(e) => isEditing ? setEditedAgeDemographic(e.target.value) : setAgeDemographic(e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">-- Select Age Demographic --</option>
                        <option value="U18">Under 18</option>
                        <option value="18-24">18-24</option>
                        <option value="25-59">25-59</option>
                        <option value="60+">60+</option>
                        <option value="80+">80+</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Member Type
                      </label>
                      <select
                        value={currentMemberType}
                        onChange={(e) => isEditing ? setEditedMemberType(e.target.value) : setMemberType(e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">-- Select Member Type --</option>
                        {getAllowedMemberTypes().map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {profile?.honorary === 'Y' && (
                        <p className="mt-2 text-sm text-gray-600 italic">
                          Honorary Member
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Full-time Education Checkbox (only for 18-24) */}
                  {ageDemographic === '18-24' && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={fullTimeEducation}
                          onChange={(e) => setFullTimeEducation(e.target.checked)}
                          disabled={isFormDisabled}
                          className="h-4 w-4 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <label className="ml-2 text-sm text-gray-700">
                          I am in full-time education
                          <span className="ml-2 text-xs text-gray-500">(reduces fee from £60 to £10)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-700">Membership Fee:</span>
                      <span className="text-lg font-semibold text-blue-500">
                        {formatCurrency(fees.membershipFee)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {currentRenewal?.renewingMembership && (
              <>
                {/* 200 Club Section */}
                <div className="mb-8 pb-8 border-b">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">200 Club</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    A 200 club entry costs £6 per year for a monthly draw for cash prizes throughout the playing season. Please enter the total number of 200 club entries required.
                  </p>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Number of entries (£6 per entry)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={currentRenewal?.number200ClubEntries}
                        onChange={(e) => handleChange('number200ClubEntries', parseInt(e.target.value) || 0)}
                        disabled={isFormDisabled}
                        className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>
                    {currentRenewal?.number200ClubEntries > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Preferred numbers (optional)
                        </label>
                        <input
                          type="text"
                          value={currentRenewal?.pref200Club || ''}
                          onChange={(e) => handleChange('pref200Club', e.target.value)}
                          placeholder="e.g., 7, 23, 45"
                          disabled={isFormDisabled}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                      </div>
                    )}
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-sm font-medium text-gray-700">200 Club Fee:</span>
                      <span className="text-lg font-semibold text-blue-500">
                        {formatCurrency(fees.club200Fee)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Volunteering Section */}
                <div className="mb-8 pb-8 border-b">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Volunteering</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    The club relies on volunteers to run the club, so please consider how you can help.
                  </p>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tea Duty - Dates to avoid (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        All FULL members are expected to take their turn with tea duty throughout the season. Please indicate any days or dates you are not available, or if you are willing to do additional duties.
                      </p>
                      <textarea
                        value={currentRenewal?.teaDatesToAvoid || ''}
                        onChange={(e) => handleChange('teaDatesToAvoid', e.target.value)}
                        rows={2}
                        placeholder="e.g., July 15, August 10-20"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cleaning - Dates to avoid (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        All FULL members are expected to take their turn with cleaning duty on a Saturday morning. Please indicate any dates you are not available.
                      </p>
                      <textarea
                        value={currentRenewal?.cleaningDatesToAvoid || ''}
                        onChange={(e) => handleChange('cleaningDatesToAvoid', e.target.value)}
                        rows={2}
                        placeholder="e.g., December, summer holidays"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>

                    {/* Driving - Only for Playing members */}
                    {isPlayer(memberType) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Driving to Away Matches (optional)
                        </label>
                        <p className="text-xs text-gray-500 mb-2">
                          Please indicate if you are willing to drive other members to away matches occasionally.
                        </p>
                        <select
                          value={currentRenewal?.drivingAwayMatches || ''}
                          onChange={(e) => handleChange('drivingAwayMatches', e.target.value)}
                          disabled={isFormDisabled}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border mb-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                        >
                          <option value="">Please select</option>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                        <textarea
                          value={currentRenewal?.drivingAdditionalInfo || ''}
                          onChange={(e) => handleChange('drivingAdditionalInfo', e.target.value)}
                          rows={2}
                          placeholder="Additional information (e.g., limited space, certain days only)"
                          disabled={isFormDisabled}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                      </div>
                    )}

                    {/* Green, Bar, Other Skills - Available for all members */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Green &amp; Surrounds Maintenance (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Please indicate if you are willing to help keeping up with the many things that need to be done outside, for instance sweeping, mowing surrounds, hedges &amp; general maintenance.
                      </p>
                      <select
                        value={currentRenewal?.greenMaintenance || ''}
                        onChange={(e) => handleChange('greenMaintenance', e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border mb-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">Please select</option>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                      <textarea
                        value={currentRenewal?.greenAdditionalInfo || ''}
                        onChange={(e) => handleChange('greenAdditionalInfo', e.target.value)}
                        rows={2}
                        placeholder="Additional information"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bar Duty (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Please indicate if you are willing to help with running the bar. This can involve one or two voluntary evening shifts per month or opening the bar after a home game.
                      </p>
                      <select
                        value={currentRenewal?.barDuty || ''}
                        onChange={(e) => handleChange('barDuty', e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border mb-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">Please select</option>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                      <textarea
                        value={currentRenewal?.barAdditionalInfo || ''}
                        onChange={(e) => handleChange('barAdditionalInfo', e.target.value)}
                        rows={2}
                        placeholder="Additional information"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Other Skills (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        If you have any other skills which may benefit the club, or other ways in which you may be able to help, please give details here. (e.g. plumbing, electrics, decorating, bookkeeping, legal, IT, local councillor, grant applications etc)
                      </p>
                      <textarea
                        value={currentRenewal?.otherSkills || ''}
                        onChange={(e) => handleChange('otherSkills', e.target.value)}
                        rows={3}
                        placeholder="e.g., plumbing, IT support, legal advice..."
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Club Competitions Section - Only for Playing members */}
                {isPlayer(memberType) && (
                  <div className="mb-8 pb-8 border-b">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Club Competitions</h3>

                    {/* Detailed Instructions */}
                    <div className="mb-4 space-y-2 text-sm text-gray-700">
                      <p>Entry to competitions will only be accepted by playing members who have made themselves available for 8 Friendly matches in the previous season.</p>
                      <p>
                        According to our information, the number of friendlies that you made yourself available for was <span className="font-semibold">{eligibility.friendliesLastYear}</span>
                        {eligibility.friendliesLastYear === 'X' && <span className="ml-1 text-xs text-blue-600">(manual override approved)</span>}, therefore you are <span className={eligibility.canEnterCompetitions ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>{eligibility.canEnterCompetitions ? 'eligible' : 'NOT eligible'}</span> to enter Club Comps next year.
                      </p>
                      <p className="text-xs">New members shall not be eligible to enter any Club competition in their first full playing season. Exceptions will be made for experienced bowlers by the Tournament Committee.</p>
                      <p className="text-xs">The OLDLAND competition is open only to those members who have NOT won a BHBC singles competition.</p>
                      <p className="text-xs font-medium">The FINALS are on Sat 5th and Sun 6th Sep. PLEASE DO NOT enter competitions unless you can participate on those days.</p>
                      <p className="text-xs font-bold text-red-600">The 1st round of TRIPLES is to be played at 10 a.m. on Sunday 24th May, unless an earlier date is agreed by all 6 players.</p>
                      <p className="text-xs">To be eligible to play in the Veterans Mixed, you must be 60 or over on the 1st March.</p>
                      <p className="mt-3 font-medium">Please select each competition you are entering. There is an entry fee of £2.00 per competition.</p>
                    </div>

                    {/* Competition Checkboxes */}
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[
                          { key: 'mensChampionship', label: "Men's Championship" },
                          { key: 'ladiesMaynard', label: "Ladies' Maynard" },
                          { key: 'mensTwoWood', label: "Men's Two Wood" },
                          { key: 'ladiesTwoWood', label: "Ladies' Two Wood" },
                          { key: 'marriedPairs', label: 'Married Pairs' },
                          { key: 'drawnPairs', label: 'Drawn Pairs' },
                          { key: 'australianPairs', label: 'Australian Pairs' },
                          { key: 'drawnTriples', label: 'Drawn Triples' },
                          { key: 'handicap', label: 'Handicap' },
                          { key: 'oldlands', label: 'Oldlands' },
                          { key: 'veterans', label: 'Veterans (60+)' },
                        ]
                          .filter(({ key }) => canEnterCompetition(key))
                          .map(({ key, label }) => (
                            <div key={key} className="flex items-center">
                              <input
                                type="checkbox"
                                checked={currentRenewal[key as keyof Renewal] as boolean}
                                onChange={(e) => handleChange(key as keyof Renewal, e.target.checked)}
                                disabled={!eligibility.canEnterCompetitions || paymentReceived}
                                className="h-4 w-4 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <label className={`ml-2 text-sm ${
                                !eligibility.canEnterCompetitions ? 'text-gray-400' : 'text-gray-900'
                              }`}>
                                {label}
                              </label>
                            </div>
                          ))}
                      </div>

                      {/* Substitutions (no fee) - Also require 8+ friendlies */}
                      <div className="mt-6 pt-6 border-t">
                        <p className="text-sm font-medium text-gray-700 mb-3">
                          Substitutes (no fee unless called upon to play)
                        </p>
                        <div className="space-y-2">
                          {[
                            { key: 'drawnPairsSub', label: 'Drawn Pairs Substitute' },
                            { key: 'australianPairsSub', label: 'Australian Pairs Substitute' },
                            { key: 'drawnTriplesSub', label: 'Drawn Triples Substitute' },
                          ].map(({ key, label }) => (
                            <div key={key} className="flex items-center">
                              <input
                                type="checkbox"
                                checked={currentRenewal[key as keyof Renewal] as boolean}
                                onChange={(e) => handleChange(key as keyof Renewal, e.target.checked)}
                                disabled={!eligibility.canEnterCompetitions || paymentReceived}
                                className="h-4 w-4 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <label className={`ml-2 text-sm ${
                                !eligibility.canEnterCompetitions ? 'text-gray-400' : 'text-gray-900'
                              }`}>
                                {label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700">Competition Fees:</span>
                        <span className="text-lg font-semibold text-blue-500">
                          {formatCurrency(fees.compsFee)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Total Fee Section */}
            {currentRenewal?.renewingMembership && (
              <div className="mb-8 bg-blue-50 border-2 border-blue-500 rounded-lg p-6">
                <div className="flex justify-between items-center">
                  <span className="text-xl font-bold text-gray-900">Total Fee Payable:</span>
                  <span className="text-3xl font-bold text-blue-500">
                    {formatCurrency(fees.total)}
                  </span>
                </div>
              </div>
            )}

            {/* Payment Received Message */}
            {paymentReceived && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <svg className="h-6 w-6 text-green-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <h3 className="text-lg font-medium text-green-900">Payment Received</h3>
                      <p className="text-sm text-green-700 mt-1">
                        Your renewal payment has been received. Your details are locked and cannot be modified.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/')}
                    className="ml-4 px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer"
                  >
                    Return to Home
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
