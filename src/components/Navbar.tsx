// src/components/Navbar.tsx
// Shared navigation bar component with mobile responsiveness

'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { useImpersonation } from '@/hooks/useImpersonation';
import { ImpersonationModal } from './ImpersonationModal';
import { getNavItemClasses, getProfileIconClasses, getButtonClasses } from '@/config/theme-helpers';
import { VersionDisplay } from './VersionDisplay';

interface SubMenuItem {
  name: string;
  href: string;
}

interface NavItem {
  name: string;
  href?: string;
  icon?: React.ReactNode;
  adminOnly?: boolean;
  subItems?: SubMenuItem[];
}

interface NavbarProps {
  userName?: string;
  userRole?: string;
}

export function Navbar({ userName, userRole }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [impersonationModalOpen, setImpersonationModalOpen] = useState(false);
  const [hasImpersonatableUsers, setHasImpersonatableUsers] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Get session for impersonation state
  const { data: session } = useSession();
  const {
    isImpersonating,
    originalAdmin,
    startImpersonation,
    stopImpersonation
  } = useImpersonation();

  const isAdmin = userRole === 'Admin' || userRole === 'superadmin';
  const isTreasurer = userRole === 'T';
  const isCaptain = userRole === 'Captain';
  const canAccessBanking = isAdmin || isTreasurer;
  const canAccessCaptainTools = isAdmin || isCaptain;

  // Check if user has anyone they can impersonate
  useEffect(() => {
    async function checkImpersonationAccess() {
      if (!session?.user?.userName) {
        setHasImpersonatableUsers(false);
        return;
      }

      try {
        const response = await fetch('/api/admin/impersonate/users');
        if (response.ok) {
          const data = await response.json();
          setHasImpersonatableUsers(data.count > 0);
        } else {
          setHasImpersonatableUsers(false);
        }
      } catch (error) {
        console.error('Failed to check impersonation access:', error);
        setHasImpersonatableUsers(false);
      }
    }

    checkImpersonationAccess();
  }, [session?.user?.userName]);

  // Show impersonation controls only if user has someone to impersonate
  const canShowImpersonation = hasImpersonatableUsers;

  // Navigation items - easy to add more here
  const navigationItems: NavItem[] = [
    {
      name: 'Home',
      href: '/',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      name: 'Profile',
      href: '/profile',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
    {
      name: 'Renewals',
      href: '/renewals',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
    },
    // Admin submenu - shows ALL non-member functions (admin-only, treasurer, and captain functions)
    ...(isAdmin ? [{
      name: 'Admin',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      subItems: [
        { name: 'Send Member Emails', href: '/admin/emails' },
        { name: 'Banking', href: '/banking' },
        { name: 'Friendly Management', href: '/friendlies/manage' },
      ],
    }] : []),
    // Treasurer submenu - exclusive to Treasurer role (not shown to admin)
    ...(isTreasurer && !isAdmin ? [{
      name: 'Treasurer',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      subItems: [
        { name: 'Banking', href: '/banking' },
      ],
    }] : []),
    // Captain submenu - exclusive to Captain role (not shown to admin)
    ...(isCaptain && !isAdmin ? [{
      name: 'Captain',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      ),
      subItems: [
        { name: 'Friendly Management', href: '/friendlies/manage' },
      ],
    }] : []),
    {
      name: 'Friendlies',
      href: '/friendlies',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname?.startsWith(href);
  };

  const isDropdownActive = (subItems?: SubMenuItem[]) => {
    if (!subItems) return false;
    return subItems.some(item => isActive(item.href));
  };

  const toggleDropdown = (itemName: string) => {
    setOpenDropdown(openDropdown === itemName ? null : itemName);
  };

  const handleSignOut = () => {
    signOut({ callbackUrl: '/login' });
  };

  // Get user initials from name (e.g., "Liam Dasey" -> "LD")
  const getUserInitials = (name: string | undefined): string => {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };

    if (profileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [profileMenuOpen]);

  return (
    <nav className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo/Brand */}
          <div className="flex items-center">
            <Link href="/" className="flex-shrink-0 flex items-center">
              <img
                src="/bhbc-logo.jpg"
                alt="BHBC Logo"
                style={{ height: '40px', width: 'auto' }}
              />
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex md:items-center md:space-x-4">
            {navigationItems.map((item) => (
              item.subItems ? (
                // Dropdown menu item
                <div key={item.name} className="relative">
                  <button
                    onClick={() => toggleDropdown(item.name)}
                    className={getNavItemClasses(isDropdownActive(item.subItems))}
                  >
                    {item.icon && <span className="mr-2">{item.icon}</span>}
                    {item.name}
                    <svg className="ml-1 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {openDropdown === item.name && (
                    <div className="absolute left-0 mt-2 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                      <div className="py-1">
                        {item.subItems.map((subItem) => (
                          <Link
                            key={subItem.name}
                            href={subItem.href}
                            onClick={() => setOpenDropdown(null)}
                            className={`block px-4 py-2 text-sm ${
                              isActive(subItem.href)
                                ? 'bg-blue-100 text-blue-700'
                                : 'text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {subItem.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                // Regular link item
                <Link
                  key={item.name}
                  href={item.href!}
                  className={getNavItemClasses(isActive(item.href!))}
                >
                  {item.icon && <span className="mr-2">{item.icon}</span>}
                  {item.name}
                </Link>
              )
            ))}

            {/* Profile Icon Dropdown */}
            <div ref={profileDropdownRef} className="relative ml-4 pl-4 border-l border-gray-200">
              <button
                onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                className={getProfileIconClasses(isImpersonating || false)}
                title={isImpersonating ? `Impersonating ${userName}` : userName || 'User Profile'}
              >
                {getUserInitials(userName)}
              </button>
              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    {/* User name header */}
                    {userName && (
                      <div className="px-4 py-2 text-sm font-medium text-gray-900 border-b border-gray-200">
                        {userName}
                        {isImpersonating && (
                          <div className="text-xs text-orange-600 font-normal mt-1">
                            Switched User
                          </div>
                        )}
                      </div>
                    )}

                    {/* Show original admin when impersonating */}
                    {isImpersonating && originalAdmin && (
                      <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-200">
                        Logged in as: {originalAdmin.name}
                      </div>
                    )}

                    {/* Impersonation controls */}
                    {(canShowImpersonation || isImpersonating) && (
                      <>
                        {isImpersonating ? (
                          <button
                            onClick={() => {
                              stopImpersonation();
                              setProfileMenuOpen(false);
                            }}
                            className="block w-full text-left px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 border-b border-gray-200"
                          >
                            Exit Switch
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setImpersonationModalOpen(true);
                              setProfileMenuOpen(false);
                            }}
                            className="block w-full text-left px-4 py-2 text-sm text-blue-500 hover:bg-blue-50 border-b border-gray-200"
                          >
                            Switch User
                          </button>
                        )}
                      </>
                    )}

                    {/* Regular menu items */}
                    <Link
                      href="/profile"
                      onClick={() => setProfileMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Profile
                    </Link>

                    {/* Hide these when impersonating */}
                    {!isImpersonating && (
                      <>
                        <Link
                          href="/change-password"
                          onClick={() => setProfileMenuOpen(false)}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Change Password
                        </Link>
                        <button
                          onClick={handleSignOut}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Logout
                        </button>
                      </>
                    )}

                    {/* Version info */}
                    <div className="px-4 py-2 border-t border-gray-200">
                      <VersionDisplay showBuildDate={true} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className={`relative inline-flex items-center justify-center p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-inset ${
                isImpersonating
                  ? 'text-orange-600 hover:text-orange-700 hover:bg-orange-50 focus:ring-orange-500'
                  : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100 focus:ring-blue-500'
              }`}
              aria-expanded="false"
              title={isImpersonating ? `Impersonating ${userName}` : 'Open menu'}
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
              {/* Orange indicator dot when impersonating */}
              {isImpersonating && (
                <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white"></span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          ></div>

          {/* Menu panel */}
          <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-xl z-50 md:hidden overflow-y-auto">
            {/* Menu header with close button */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-lg font-semibold text-gray-900">Menu</h2>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Close menu"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-2 pt-2 pb-3 space-y-1">
              {navigationItems.map((item) => (
                item.subItems ? (
                  // Dropdown menu item in mobile
                  <div key={item.name}>
                    <button
                      onClick={() => toggleDropdown(item.name)}
                      className={`flex items-center justify-between w-full px-3 py-2 rounded-md text-base font-medium ${
                        isDropdownActive(item.subItems)
                          ? 'bg-blue-100 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <span className="flex items-center">
                        {item.icon && <span className="mr-3">{item.icon}</span>}
                        {item.name}
                      </span>
                      <svg
                        className={`h-4 w-4 transition-transform ${openDropdown === item.name ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {openDropdown === item.name && (
                      <div className="ml-6 mt-1 space-y-1">
                        {item.subItems.map((subItem) => (
                          <Link
                            key={subItem.name}
                            href={subItem.href}
                            onClick={() => {
                              setMobileMenuOpen(false);
                              setOpenDropdown(null);
                            }}
                            className={`block px-3 py-2 text-sm rounded-md ${
                              isActive(subItem.href)
                                ? 'bg-blue-100 text-blue-700'
                                : 'text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            {subItem.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  // Regular link item in mobile
                  <Link
                    key={item.name}
                    href={item.href!}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 rounded-md text-base font-medium ${
                      isActive(item.href!)
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {item.icon && <span className="mr-3">{item.icon}</span>}
                    {item.name}
                  </Link>
                )
              ))}
            </div>
            <div className="pt-4 pb-3 border-t border-gray-200">
              {userName && (
                <div className="px-4 mb-3">
                  <div className={`text-sm font-medium ${isImpersonating ? 'text-orange-600' : 'text-gray-900'}`}>
                    {userName}
                    {isImpersonating && (
                      <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                        Switched User
                      </span>
                    )}
                  </div>
                  {isImpersonating && originalAdmin && (
                    <div className="text-xs text-gray-500 mt-1">
                      Logged in as: {originalAdmin.name}
                    </div>
                  )}
                  {userRole && !isImpersonating && (
                    <div className="text-xs text-gray-500">Role: {userRole}</div>
                  )}
                </div>
              )}
              <div className="px-2 space-y-1">
                {/* Impersonation controls */}
                {(canShowImpersonation || isImpersonating) && (
                  <>
                    {isImpersonating ? (
                      <button
                        onClick={() => {
                          stopImpersonation();
                          setMobileMenuOpen(false);
                        }}
                        className="block w-full text-left px-3 py-2 text-base font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md"
                      >
                        Exit Switch
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setImpersonationModalOpen(true);
                          setMobileMenuOpen(false);
                        }}
                        className="block w-full text-left px-3 py-2 text-base font-medium text-blue-600 hover:bg-blue-50 rounded-md"
                      >
                        Switch User
                      </button>
                    )}
                  </>
                )}

                <Link
                  href="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  Profile
                </Link>

                {/* Hide these when impersonating */}
                {!isImpersonating && (
                  <>
                    <Link
                      href="/change-password"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-100 rounded-md"
                    >
                      Change Password
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="block w-full text-left px-3 py-2 text-base font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md"
                    >
                      Logout
                    </button>
                  </>
                )}
              </div>

              {/* Version info */}
              <div className="px-4 py-3 mt-4 border-t border-gray-200 text-center">
                <VersionDisplay showBuildDate={true} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Impersonation Modal */}
      <ImpersonationModal
        isOpen={impersonationModalOpen}
        onClose={() => setImpersonationModalOpen(false)}
        onImpersonate={startImpersonation}
      />
    </nav>
  );
}
