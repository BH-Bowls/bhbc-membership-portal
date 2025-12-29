// src/components/UserSelector.tsx
// Reusable user selector component for buddy system

'use client';

import { SearchableSelect } from './SearchableSelect';

interface User {
  userName: string;
  fullKnownAs: string;
  isSelf: boolean;
}

interface UserSelectorProps {
  users: User[];
  selectedUserName: string;
  onChange: (userName: string) => void;
  featureName: string; // 'profile', 'renewals', etc.
  isAdmin?: boolean;
  disabled?: boolean;
}

export function UserSelector({
  users,
  selectedUserName,
  onChange,
  featureName,
  isAdmin = false,
  disabled = false,
}: UserSelectorProps) {
  // Only show if multiple users
  if (users.length <= 1) {
    return null;
  }

  const selectedUser = users.find((u) => u.userName === selectedUserName);
  const isManagingOther = !selectedUser?.isSelf;

  // Filter out any users with empty userName (defensive)
  const validUsers = users.filter((u) => u.userName && u.userName.trim() !== '');

  return (
    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Managing {featureName} for:
        {isAdmin && <span className="ml-2 text-xs text-gray-600">(Admin)</span>}
      </label>

      {/* User selector dropdown - searchable */}
      <SearchableSelect
        options={validUsers.map((user) => ({
          value: user.userName,
          label: `${user.fullKnownAs}${user.isSelf ? ' (You)' : ''}`,
        }))}
        value={selectedUserName}
        onChange={onChange}
        placeholder="Type to search users..."
        className="max-w-md"
      />

      {/* Warning when managing someone else */}
      {isManagingOther && (
        <div className="mt-3 flex items-start">
          <svg
            className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm text-blue-700">
            You are managing <strong>{selectedUser?.fullKnownAs}'s</strong>{' '}
            {featureName}.
            {featureName !== 'friendlies' &&
              ' Changes will be saved to their account and emails sent to their address.'}
          </p>
        </div>
      )}
    </div>
  );
}
