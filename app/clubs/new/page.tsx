// app/clubs/new/page.tsx
// Create new club page - form for adding a new club
// Only non-members (Captains, Admins, etc.) can access this page

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { getButtonClasses } from '@/config/theme-helpers';
import { CreateClubRequest } from '@/lib/types/clubs';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';

export default function NewClubPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [formData, setFormData] = useState<CreateClubRequest>({
    clubName: '',
    clubNumber: '',
    clubMobile: '',
    clubEmailAddress: '',
    clubEmailNote: '',
    generalInformation: '',
    drivingBand: '',
    address1: '',
    address2: '',
    address3: '',
    address4: '',
    postCode: '',
    website: '',
    latitude: null,
    longitude: null,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if user is authorized
  const userRole = session?.user?.role || 'Member';
  const canCreate = userRole !== 'Member';

  // Redirect unauthorized users
  useEffect(() => {
    if (status === 'authenticated' && !canCreate) {
      router.push('/clubs');
    }
  }, [status, canCreate, router]);

  // Auto-save draft when form changes
  useEffect(() => {
    if (session?.user?.userName && formData.clubName) {
      saveDraft('NewClub', session.user.userName, formData);
    }
  }, [formData, session?.user?.userName]);

  // Restore draft on page load
  useEffect(() => {
    if (session?.user?.userName) {
      const draft = restoreDraft<CreateClubRequest>('NewClub', session.user.userName);
      if (draft) {
        setFormData(draft);
      }
    }
  }, [session?.user?.userName]);

  // Handle cancel - clear draft and navigate away
  function handleCancel() {
    if (session?.user?.userName) {
      clearDraft('NewClub', session.user.userName);
    }
    router.push('/clubs');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!formData.clubName.trim()) {
      setError('Club name is required');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/clubs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create club');
      }

      // Clear draft after successful creation
      if (session?.user?.userName) {
        clearDraft('NewClub', session.user.userName);
      }

      // Redirect to the new club's page
      router.push(`/clubs/${encodeURIComponent(formData.clubName)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create club');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={undefined} userRole={undefined} />
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canCreate) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />
        <div className="container mx-auto px-4 py-8 max-w-2xl">
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-red-600">You do not have permission to create clubs.</p>
            <Link href="/clubs" className="mt-4 inline-block text-blue-500 hover:text-blue-600">
              Back to Clubs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Handle form submission from navbar button
  function handleNavbarSubmit() {
    // Trigger the form submission
    const form = document.getElementById('create-club-form') as HTMLFormElement;
    if (form) {
      form.requestSubmit();
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user?.name ?? undefined}
        userRole={session?.user?.role ?? undefined}
        actionButtons={{
          primary: {
            label: 'Create Club',
            onClick: handleNavbarSubmit,
            loading: saving,
          },
          secondary: {
            label: 'Cancel',
            onClick: handleCancel,
            disabled: saving,
          },
        }}
      />

      <div className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/clubs" className="text-gray-500 hover:text-gray-700">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1 className="text-3xl font-bold">Add New Club</h1>
        </div>

        {/* Form */}
        <form id="create-club-form" onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
              {error}
            </div>
          )}

          {/* Club Name */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Club Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.clubName}
              onChange={(e) => setFormData({ ...formData, clubName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g., West Sussex Bowls Club"
              required
            />
          </div>

          {/* Contact Information */}
          <h3 className="font-medium text-gray-900 mb-4 pb-2 border-b">Contact Information</h3>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="text"
                value={formData.clubNumber || ''}
                onChange={(e) => setFormData({ ...formData, clubNumber: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="01onal 123456"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
              <input
                type="text"
                value={formData.clubMobile || ''}
                onChange={(e) => setFormData({ ...formData, clubMobile: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="07xxx xxxxxx"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={formData.clubEmailAddress || ''}
                onChange={(e) => setFormData({ ...formData, clubEmailAddress: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="club@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email Note</label>
              <input
                type="text"
                value={formData.clubEmailNote || ''}
                onChange={(e) => setFormData({ ...formData, clubEmailNote: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., Secretary's email"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
              <input
                type="url"
                value={formData.website || ''}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://www.example.com"
              />
            </div>
          </div>

          {/* Address */}
          <h3 className="font-medium text-gray-900 mb-4 pb-2 border-b">Address</h3>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 1</label>
              <input
                type="text"
                value={formData.address1 || ''}
                onChange={(e) => setFormData({ ...formData, address1: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="Street address"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address Line 2</label>
              <input
                type="text"
                value={formData.address2 || ''}
                onChange={(e) => setFormData({ ...formData, address2: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Town/City</label>
              <input
                type="text"
                value={formData.address3 || ''}
                onChange={(e) => setFormData({ ...formData, address3: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
              <input
                type="text"
                value={formData.address4 || ''}
                onChange={(e) => setFormData({ ...formData, address4: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Post Code</label>
              <input
                type="text"
                value={formData.postCode || ''}
                onChange={(e) => setFormData({ ...formData, postCode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Driving Band</label>
              <select
                value={formData.drivingBand || ''}
                onChange={(e) => setFormData({ ...formData, drivingBand: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select band...</option>
                <option value="A">A - Closest</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D - Furthest</option>
              </select>
            </div>
          </div>

          {/* Location Coordinates */}
          <h3 className="font-medium text-gray-900 mb-4 pb-2 border-b">Location Coordinates (Optional)</h3>
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                value={formData.latitude ?? ''}
                onChange={(e) => setFormData({ ...formData, latitude: e.target.value ? parseFloat(e.target.value) : null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 50.9876"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={formData.longitude ?? ''}
                onChange={(e) => setFormData({ ...formData, longitude: e.target.value ? parseFloat(e.target.value) : null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., -0.1234"
              />
            </div>
          </div>

          {/* General Information */}
          <h3 className="font-medium text-gray-900 mb-4 pb-2 border-b">Additional Information</h3>
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">General Information</label>
            <textarea
              value={formData.generalInformation || ''}
              onChange={(e) => setFormData({ ...formData, generalInformation: e.target.value })}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              placeholder="Any additional notes about the club..."
            />
          </div>

        </form>
      </div>
    </div>
  );
}
