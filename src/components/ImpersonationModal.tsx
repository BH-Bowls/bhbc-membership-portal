// src/components/ImpersonationModal.tsx
// Modal for selecting a user or club to impersonate

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

interface ClubEntry {
  clubId: string;
  clubName: string;
}

interface ImpersonationModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** id = userName for users, clubId for clubs */
  onImpersonate: (id: string, type: 'user' | 'club') => void;
  /** Show the User/Club radio toggle (Admin and Rowland BHBC role only) */
  showClubOption?: boolean;
}

export function ImpersonationModal({
  isOpen,
  onClose,
  onImpersonate,
  showClubOption = false,
}: ImpersonationModalProps) {
  const [targetType, setTargetType] = useState<'user' | 'club'>('user');
  const [users, setUsers] = useState<User[]>([]);
  const [clubs, setClubs] = useState<ClubEntry[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [filteredClubs, setFilteredClubs] = useState<ClubEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset and load when modal opens
  useEffect(() => {
    if (isOpen) {
      setTargetType('user');
      setSearchTerm('');
      loadUsers();
    }
  }, [isOpen]);

  // Load clubs when switching to club tab
  useEffect(() => {
    if (isOpen && targetType === 'club' && clubs.length === 0) {
      loadClubs();
    }
  }, [targetType, isOpen]);

  // Filter based on search term
  useEffect(() => {
    const term = searchTerm.toLowerCase();
    if (targetType === 'user') {
      setFilteredUsers(
        term
          ? users.filter(
              (u) =>
                u.name.toLowerCase().includes(term) ||
                u.fullName.toLowerCase().includes(term) ||
                u.userName.toLowerCase().includes(term) ||
                u.role.toLowerCase().includes(term)
            )
          : users
      );
    } else {
      setFilteredClubs(
        term
          ? clubs.filter(
              (c) =>
                c.clubName.toLowerCase().includes(term) ||
                c.clubId.toLowerCase().includes(term)
            )
          : clubs
      );
    }
  }, [searchTerm, users, clubs, targetType]);

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/impersonate/users');
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      const valid = (data.users || []).filter((u: User) => u.userName?.trim());
      setUsers(valid);
      setFilteredUsers(valid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const loadClubs = async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/impersonate/clubs');
      if (!res.ok) throw new Error('Failed to load clubs');
      const data = await res.json();
      setClubs(data.clubs || []);
      setFilteredClubs(data.clubs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clubs');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (id: string) => {
    onImpersonate(id, targetType);
    onClose();
  };

  const switchType = (t: 'user' | 'club') => {
    setTargetType(t);
    setSearchTerm('');
  };

  if (!isOpen) return null;

  const count = targetType === 'user' ? filteredUsers.length : filteredClubs.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Switch User</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
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

          {/* User / Club radio toggle — only for Admin + Rowland */}
          {showClubOption && (
            <div className="flex gap-4 mb-4">
              {(['user', 'club'] as const).map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="targetType"
                    value={t}
                    checked={targetType === t}
                    onChange={() => switchType(t)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm font-medium text-gray-700 capitalize">{t}</span>
                </label>
              ))}
            </div>
          )}

          {/* Search */}
          <input
            type="text"
            placeholder={targetType === 'club' ? 'Search clubs…' : 'Search by name, username, or role…'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={`${getInputClasses()} mb-4`}
            autoFocus
          />

          {/* List */}
          {isLoading ? (
            <div className="text-center py-8 text-gray-500">Loading…</div>
          ) : targetType === 'user' ? (
            filteredUsers.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {searchTerm ? 'No users found' : 'No users available to impersonate'}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredUsers.map((user) => (
                  <div
                    key={user.userName}
                    className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => handleSelect(user.userName)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{user.fullName}</div>
                        <div className="text-sm text-gray-600">{user.userName}</div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={getBadgeClasses('primary', 'md')}>{user.role}</span>
                          {user.lastLoginDate && (
                            <span className="text-xs text-gray-500">
                              Last login: {new Date(user.lastLoginDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : filteredClubs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {searchTerm ? 'No clubs found' : 'No clubs with a login configured'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredClubs.map((club) => (
                <div
                  key={club.clubId}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => handleSelect(club.clubId)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{club.clubName}</div>
                      <div className="text-sm text-gray-600">{club.clubId}</div>
                    </div>
                    <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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
            <span>{count} {targetType}{count !== 1 ? 's' : ''} available</span>
            <button onClick={onClose} className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
