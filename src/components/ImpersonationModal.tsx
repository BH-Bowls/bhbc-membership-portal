// src/components/ImpersonationModal.tsx
// Modal for selecting a user to impersonate

'use client';

import { useState, useEffect } from 'react';
import { getInputClasses, getBadgeClasses } from '@/config/theme-helpers';

interface User {
  userName: string;
  name: string;
  fullName: string;
  role: string;
  emailAddress: string;
  lastLoginDate: string | null;
}

interface ImpersonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImpersonate: (userName: string) => void;
}

export function ImpersonationModal({
  isOpen,
  onClose,
  onImpersonate,
}: ImpersonationModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Load users when modal opens
  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setSearchTerm(''); // Reset search
    }
  }, [isOpen]);

  // Filter users based on search term
  useEffect(() => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      const filtered = users.filter(user =>
        user.name.toLowerCase().includes(term) ||
        user.fullName.toLowerCase().includes(term) ||
        user.userName.toLowerCase().includes(term) ||
        user.role.toLowerCase().includes(term)
      );
      setFilteredUsers(filtered);
    } else {
      setFilteredUsers(users);
    }
  }, [searchTerm, users]);

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/admin/impersonate/users');

      if (!response.ok) {
        throw new Error('Failed to load users');
      }

      const data = await response.json();
      setUsers(data.users || []);
      setFilteredUsers(data.users || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImpersonate = (userName: string) => {
    onImpersonate(userName);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Switch User</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Search Input */}
          <input
            type="text"
            placeholder="Search by name, username, or role..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${getInputClasses()} mb-4`}
            autoFocus
          />

          {/* User List */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              Loading users...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchTerm ? 'No users found' : 'No users available to impersonate'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredUsers.map((user) => (
                <div
                  key={user.userName}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleImpersonate(user.userName)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{user.fullName}</div>
                      <div className="text-sm text-gray-600">{user.userName}</div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={getBadgeClasses('primary', 'md')}>
                          {user.role}
                        </span>
                        {user.lastLoginDate && (
                          <span className="text-xs text-gray-500">
                            Last login: {new Date(user.lastLoginDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <svg
                      className="h-5 w-5 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>{filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} available</span>
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
