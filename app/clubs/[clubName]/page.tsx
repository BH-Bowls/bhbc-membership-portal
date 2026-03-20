// app/clubs/[clubName]/page.tsx
// Club detail page - displays club information and contacts
// Non-members can edit club details and manage contacts

'use client';

import { useEffect, useState, use } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';
import { Club, ClubContact, UpdateClubRequest, UpdateContactRequest } from '@/lib/types/clubs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';

interface PageProps {
  params: Promise<{ clubName: string }>;
}

export default function ClubDetailPage({ params }: PageProps) {
  const { clubName: encodedClubName } = use(params);
  const clubName = decodeURIComponent(encodedClubName);

  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Determine back URL based on where user came from
  const fromPage = searchParams.get('from');
  const backUrl = fromPage === 'friendlies' ? '/friendlies' : '/clubs';

  const [club, setClub] = useState<Club | null>(null);
  const [contacts, setContacts] = useState<ClubContact[]>([]);
  const [canEditFromApi, setCanEditFromApi] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Kiosk / Rowland users cannot edit, even if API says they can
  const userRole = session?.user?.role || 'Member';
  const isKiosk = userRole === 'Kiosk';
  const canEdit = canEditFromApi && !isKiosk && userRole !== 'Rowland';

  // Edit states
  const [isEditingClub, setIsEditingClub] = useState(false);
  const [editedClub, setEditedClub] = useState<UpdateClubRequest>({});
  const [savingClub, setSavingClub] = useState(false);

  // Contact edit states
  const [editingContactRow, setEditingContactRow] = useState<number | null>(null);
  const [editedContact, setEditedContact] = useState<UpdateContactRequest>({});
  const [savingContact, setSavingContact] = useState(false);

  // Add contact states
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContact, setNewContact] = useState({
    role: '',
    firstName: '',
    lastName: '',
    phoneNumber: '',
    mobileNumber: '',
    email: '',
    notes: '',
  });

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'club' | 'contact';
    contactRow?: number;
  }>({ isOpen: false, type: 'club' });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchClub();
  }, [clubName]);

  // Auto-save draft when editing
  useEffect(() => {
    if (isEditingClub && session?.user?.userName && Object.keys(editedClub).length > 0) {
      saveDraft('Club', session.user.userName, { clubName, editedClub });
    }
  }, [editedClub, isEditingClub, session?.user?.userName, clubName]);

  // Restore draft on page load
  useEffect(() => {
    if (session?.user?.userName && club && !isEditingClub) {
      const draft = restoreDraft<{ clubName: string; editedClub: UpdateClubRequest }>(
        'Club',
        session.user.userName
      );
      if (draft && draft.clubName === clubName) {
        setEditedClub(draft.editedClub);
        setIsEditingClub(true);
      }
    }
  }, [session?.user?.userName, club, clubName]);

  async function fetchClub() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubName)}`);
      if (!response.ok) {
        if (response.status === 404) {
          setError('Club not found');
        } else {
          setError('Failed to load club');
        }
        return;
      }
      const data = await response.json();
      setClub(data.club);
      setContacts(data.contacts || []);
      setCanEditFromApi(data.canEdit || false);
    } catch (err) {
      console.error('Failed to fetch club:', err);
      setError('Failed to load club');
    } finally {
      setLoading(false);
    }
  }

  // Start editing club
  function startEditingClub() {
    if (!club) return;
    setEditedClub({
      clubNumber: club.clubNumber,
      clubMobile: club.clubMobile,
      clubEmailAddress: club.clubEmailAddress,
      clubEmailNote: club.clubEmailNote,
      generalInformation: club.generalInformation,
      drivingBand: club.drivingBand,
      address1: club.address1,
      address2: club.address2,
      address3: club.address3,
      address4: club.address4,
      postCode: club.postCode,
      website: club.website,
      latitude: club.latitude,
      longitude: club.longitude,
    });
    setIsEditingClub(true);
  }

  // Save club changes
  async function saveClubChanges() {
    setSavingClub(true);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedClub),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save changes');
      }
      await fetchClub();
      setIsEditingClub(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSavingClub(false);
    }
  }

  // Delete club
  async function deleteClub() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubName)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete club');
      }
      router.push('/clubs');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete club');
    } finally {
      setDeleting(false);
      setDeleteConfirm({ isOpen: false, type: 'club' });
    }
  }

  // Start editing contact
  function startEditingContact(contact: ClubContact) {
    setEditedContact({
      role: contact.role,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phoneNumber: contact.phoneNumber,
      mobileNumber: contact.mobileNumber,
      email: contact.email,
      notes: contact.notes,
    });
    setEditingContactRow(contact._rowNumber);
  }

  // Save contact changes
  async function saveContactChanges(rowNumber: number) {
    setSavingContact(true);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubName)}/contacts/${rowNumber}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedContact),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save contact');
      }
      await fetchClub();
      setEditingContactRow(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save contact');
    } finally {
      setSavingContact(false);
    }
  }

  // Add new contact
  async function addNewContact() {
    setSavingContact(true);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubName)}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newContact),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add contact');
      }
      await fetchClub();
      setIsAddingContact(false);
      setNewContact({
        role: '',
        firstName: '',
        lastName: '',
        phoneNumber: '',
        mobileNumber: '',
        email: '',
        notes: '',
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add contact');
    } finally {
      setSavingContact(false);
    }
  }

  // Delete contact
  async function deleteContact(rowNumber: number) {
    setDeleting(true);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubName)}/contacts/${rowNumber}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete contact');
      }
      await fetchClub();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete contact');
    } finally {
      setDeleting(false);
      setDeleteConfirm({ isOpen: false, type: 'club' });
    }
  }

  // Build full address string
  const getFullAddress = (club: Club): string => {
    return [club.address1, club.address2, club.address3, club.address4, club.postCode]
      .filter(Boolean)
      .join(', ');
  };

  // Get OpenStreetMap embed URL
  const getMapUrl = (club: Club): string | null => {
    if (club.latitude && club.longitude) {
      // Create a bounding box around the marker (approximately 0.005 degrees ~ 500m)
      const delta = 0.005;
      const bbox = `${club.longitude - delta},${club.latitude - delta},${club.longitude + delta},${club.latitude + delta}`;
      return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${club.latitude},${club.longitude}`;
    }
    return null;
  };

  // Get Google Maps directions URL
  const getDirectionsUrl = (club: Club): string => {
    if (club.latitude && club.longitude) {
      return `https://www.google.com/maps/dir/?api=1&destination=${club.latitude},${club.longitude}`;
    }
    const address = getFullAddress(club);
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading club...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !club) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-red-600">{error || 'Club not found'}</p>
            <Link href={backUrl} className="mt-4 inline-block text-blue-500 hover:text-blue-600">
              Go Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Handle cancel - clear draft and exit edit mode
  function handleCancelEdit() {
    if (session?.user?.userName) {
      clearDraft('Club', session.user.userName);
    }
    setIsEditingClub(false);
    // Reset to original values
    if (club) {
      setEditedClub({});
    }
  }

  // Handle save - clear draft after successful save
  async function handleSaveClubChanges() {
    await saveClubChanges();
    if (session?.user?.userName) {
      clearDraft('Club', session.user.userName);
    }
  }

  // Build navbar action buttons - only when editing
  const getNavbarActionButtons = () => {
    if (!isEditingClub) return undefined;

    return {
      primary: {
        label: 'Save',
        onClick: handleSaveClubChanges,
        loading: savingClub,
      },
      secondary: {
        label: 'Cancel',
        onClick: handleCancelEdit,
        disabled: savingClub,
      },
    };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={getNavbarActionButtons()}
      />

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            {isEditingClub ? (
              <span className="text-gray-300 cursor-not-allowed">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </span>
            ) : (
              <Link href={backUrl} className="text-gray-500 hover:text-gray-700">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
            )}
            <h1 className="text-3xl font-bold">{club.clubName}</h1>
            {club.drivingBand && (
              <span className={`px-2 py-1 text-sm font-semibold text-white rounded ${
                club.drivingBand === 'A' ? 'bg-green-500' :
                club.drivingBand === 'B' ? 'bg-yellow-500' :
                club.drivingBand === 'C' ? 'bg-orange-500' :
                'bg-red-500'
              }`}>
                Band {club.drivingBand}
              </span>
            )}
          </div>
          {/* Edit and Delete buttons in view mode */}
          {canEdit && !isEditingClub && (
            <div className="flex gap-2">
              <button
                onClick={startEditingClub}
                className={getButtonClasses('secondary', 'md')}
              >
                Edit
              </button>
              <button
                onClick={() => setDeleteConfirm({ isOpen: true, type: 'club' })}
                className={getButtonClasses('danger', 'md')}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* Contact Info and Map */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          {/* Contact Information */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Contact Information</h2>

            {isEditingClub ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={editedClub.clubNumber || ''}
                    onChange={(e) => setEditedClub({ ...editedClub, clubNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                  <input
                    type="text"
                    value={editedClub.clubMobile || ''}
                    onChange={(e) => setEditedClub({ ...editedClub, clubMobile: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={editedClub.clubEmailAddress || ''}
                    onChange={(e) => setEditedClub({ ...editedClub, clubEmailAddress: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email Note</label>
                  <input
                    type="text"
                    value={editedClub.clubEmailNote || ''}
                    onChange={(e) => setEditedClub({ ...editedClub, clubEmailNote: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <input
                    type="url"
                    value={editedClub.website || ''}
                    onChange={(e) => setEditedClub({ ...editedClub, website: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {club.clubNumber && (
                  <div className="flex items-center">
                    <svg className="h-5 w-5 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <a href={`tel:${club.clubNumber}`} className="text-blue-600 hover:underline">{club.clubNumber}</a>
                  </div>
                )}
                {club.clubMobile && (
                  <div className="flex items-center">
                    <svg className="h-5 w-5 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    <a href={`tel:${club.clubMobile}`} className="text-blue-600 hover:underline">{club.clubMobile}</a>
                  </div>
                )}
                {club.clubEmailAddress && (
                  <div className="flex items-start">
                    <svg className="h-5 w-5 mr-2 mt-0.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <div>
                      <a href={`mailto:${club.clubEmailAddress}`} className="text-blue-600 hover:underline">{club.clubEmailAddress}</a>
                      {club.clubEmailNote && <p className="text-sm text-gray-500">{club.clubEmailNote}</p>}
                    </div>
                  </div>
                )}
                {club.website && (
                  <div className="flex items-center">
                    <svg className="h-5 w-5 mr-2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <a href={club.website.startsWith('http') ? club.website : `https://${club.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      {club.website}
                    </a>
                  </div>
                )}
                {!club.clubNumber && !club.clubMobile && !club.clubEmailAddress && !club.website && (
                  <p className="text-gray-500 italic">No contact information available</p>
                )}
              </div>
            )}
          </div>

          {/* Map */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Location</h2>
            {club.latitude && club.longitude ? (
              <>
                <div className="aspect-video bg-gray-100 rounded-lg overflow-hidden mb-3">
                  <iframe
                    src={getMapUrl(club) || ''}
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    allowFullScreen
                    loading="lazy"
                  />
                </div>
                <a
                  href={getDirectionsUrl(club)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center ${getButtonClasses('primary', 'sm')}`}
                >
                  <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Get Directions
                </a>
              </>
            ) : getFullAddress(club) ? (
              <>
                <div className="h-32 flex items-center justify-center text-gray-500 bg-gray-100 rounded-lg mb-3">
                  <div className="text-center">
                    <svg className="h-8 w-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <p className="text-sm">No coordinates available</p>
                  </div>
                </div>
                <a
                  href={getDirectionsUrl(club)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center ${getButtonClasses('primary', 'sm')}`}
                >
                  <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Get Directions
                </a>
              </>
            ) : (
              <p className="text-gray-500 italic">Location not available</p>
            )}
          </div>
        </div>

        {/* Address */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Address</h2>
          {isEditingClub ? (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
                <input
                  type="text"
                  value={editedClub.address1 || ''}
                  onChange={(e) => setEditedClub({ ...editedClub, address1: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
                <input
                  type="text"
                  value={editedClub.address2 || ''}
                  onChange={(e) => setEditedClub({ ...editedClub, address2: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Town/City</label>
                <input
                  type="text"
                  value={editedClub.address3 || ''}
                  onChange={(e) => setEditedClub({ ...editedClub, address3: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
                <input
                  type="text"
                  value={editedClub.address4 || ''}
                  onChange={(e) => setEditedClub({ ...editedClub, address4: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Post Code</label>
                <input
                  type="text"
                  value={editedClub.postCode || ''}
                  onChange={(e) => setEditedClub({ ...editedClub, postCode: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Driving Band</label>
                <select
                  value={editedClub.drivingBand || ''}
                  onChange={(e) => setEditedClub({ ...editedClub, drivingBand: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select band...</option>
                  <option value="A">A - Closest</option>
                  <option value="B">B</option>
                  <option value="C">C</option>
                  <option value="D">D - Furthest</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={editedClub.latitude ?? ''}
                  onChange={(e) => setEditedClub({ ...editedClub, latitude: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={editedClub.longitude ?? ''}
                  onChange={(e) => setEditedClub({ ...editedClub, longitude: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          ) : (
            <>
              {getFullAddress(club) ? (
                <p className="text-gray-700 whitespace-pre-line">
                  {[club.address1, club.address2, club.address3, club.address4, club.postCode].filter(Boolean).join('\n')}
                </p>
              ) : (
                <p className="text-gray-500 italic">Address not specified</p>
              )}
            </>
          )}
        </div>

        {/* General Information */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">General Information</h2>
          {isEditingClub ? (
            <textarea
              value={editedClub.generalInformation || ''}
              onChange={(e) => setEditedClub({ ...editedClub, generalInformation: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="Enter general information about the club..."
            />
          ) : (
            <>
              {club.generalInformation ? (
                <p className="text-gray-700 whitespace-pre-wrap">{club.generalInformation}</p>
              ) : (
                <p className="text-gray-500 italic">No additional information</p>
              )}
            </>
          )}
        </div>

        {/* Contacts */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Contacts</h2>
            {canEdit && !isAddingContact && (
              <button
                onClick={() => setIsAddingContact(true)}
                className={getButtonClasses('primary', 'sm')}
              >
                Add Contact
              </button>
            )}
          </div>

          {/* Add contact form */}
          {isAddingContact && (
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <h3 className="font-medium mb-3">New Contact</h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <input
                    type="text"
                    value={newContact.role}
                    onChange={(e) => setNewContact({ ...newContact, role: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Captain, Secretary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                  <input
                    type="text"
                    value={newContact.firstName}
                    onChange={(e) => setNewContact({ ...newContact, firstName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                  <input
                    type="text"
                    value={newContact.lastName}
                    onChange={(e) => setNewContact({ ...newContact, lastName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="text"
                    value={newContact.phoneNumber}
                    onChange={(e) => setNewContact({ ...newContact, phoneNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                  <input
                    type="text"
                    value={newContact.mobileNumber}
                    onChange={(e) => setNewContact({ ...newContact, mobileNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={newContact.email}
                    onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <input
                    type="text"
                    value={newContact.notes}
                    onChange={(e) => setNewContact({ ...newContact, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setIsAddingContact(false)}
                  disabled={savingContact}
                  className={getButtonClasses('secondary', 'sm')}
                >
                  Cancel
                </button>
                <button
                  onClick={addNewContact}
                  disabled={savingContact}
                  className={getButtonClasses('primary', 'sm')}
                >
                  {savingContact ? 'Adding...' : 'Add Contact'}
                </button>
              </div>
            </div>
          )}

          {/* Contacts list */}
          {contacts.length === 0 ? (
            <p className="text-gray-500 italic">No contacts listed for this club</p>
          ) : (
            <div className="space-y-4">
              {contacts.map((contact) => (
                <div key={contact._rowNumber} className="border border-gray-200 rounded-lg p-4">
                  {editingContactRow === contact._rowNumber ? (
                    // Edit mode for contact
                    <div>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                          <input
                            type="text"
                            value={editedContact.role || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, role: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                          <input
                            type="text"
                            value={editedContact.firstName || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, firstName: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                          <input
                            type="text"
                            value={editedContact.lastName || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, lastName: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                          <input
                            type="text"
                            value={editedContact.phoneNumber || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, phoneNumber: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
                          <input
                            type="text"
                            value={editedContact.mobileNumber || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, mobileNumber: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                          <input
                            type="email"
                            value={editedContact.email || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, email: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                          <input
                            type="text"
                            value={editedContact.notes || ''}
                            onChange={(e) => setEditedContact({ ...editedContact, notes: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => setEditingContactRow(null)}
                          disabled={savingContact}
                          className={getButtonClasses('secondary', 'sm')}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveContactChanges(contact._rowNumber)}
                          disabled={savingContact}
                          className={getButtonClasses('primary', 'sm')}
                        >
                          {savingContact ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    // View mode for contact
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium">{contact.name || `${contact.firstName} ${contact.lastName}`.trim() || 'Unnamed Contact'}</span>
                          {contact.role && (
                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">{contact.role}</span>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          {contact.phoneNumber && (
                            <div>
                              <span className="text-gray-400">Phone:</span>{' '}
                              <a href={`tel:${contact.phoneNumber}`} className="text-blue-600 hover:underline">{contact.phoneNumber}</a>
                            </div>
                          )}
                          {contact.mobileNumber && (
                            <div>
                              <span className="text-gray-400">Mobile:</span>{' '}
                              <a href={`tel:${contact.mobileNumber}`} className="text-blue-600 hover:underline">{contact.mobileNumber}</a>
                            </div>
                          )}
                          {contact.email && (
                            <div>
                              <span className="text-gray-400">Email:</span>{' '}
                              <a href={`mailto:${contact.email}`} className="text-blue-600 hover:underline">{contact.email}</a>
                            </div>
                          )}
                          {contact.notes && (
                            <div className="text-gray-500 italic">{contact.notes}</div>
                          )}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEditingContact(contact)}
                            className="text-blue-600 hover:text-blue-700"
                            title="Edit"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ isOpen: true, type: 'contact', contactRow: contact._rowNumber })}
                            className="text-red-600 hover:text-red-700"
                            title="Delete"
                          >
                            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Last Updated */}
        {club.lastUpdated && (
          <p className="text-sm text-gray-500 mt-4 text-right">
            Last updated: {club.lastUpdated}
          </p>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title={deleteConfirm.type === 'club' ? 'Delete Club' : 'Delete Contact'}
        message={deleteConfirm.type === 'club'
          ? `Are you sure you want to delete "${club.clubName}"? This will also delete all contacts for this club. This action cannot be undone.`
          : 'Are you sure you want to delete this contact? This action cannot be undone.'
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete'}
        confirmVariant="danger"
        onConfirm={() => {
          if (deleteConfirm.type === 'club') {
            deleteClub();
          } else if (deleteConfirm.contactRow) {
            deleteContact(deleteConfirm.contactRow);
          }
        }}
        onCancel={() => setDeleteConfirm({ isOpen: false, type: 'club' })}
      />
    </div>
  );
}
