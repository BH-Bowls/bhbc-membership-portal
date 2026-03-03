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
import { checkForUnsavedChanges, clearAllDrafts } from '@/lib/form-draft-utils';
import { ConfirmDialog } from './ConfirmDialog';

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

interface ActionButton {
  label: string;
  onClick: () => void;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

interface NavbarProps {
  userName?: string;
  userRole?: string;
  hasUnsavedChanges?: boolean;
  actionButtons?: {
    primary?: ActionButton;
    secondary?: ActionButton;
  };
}

export function Navbar({ userName, userRole, hasUnsavedChanges = false, actionButtons }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [impersonationModalOpen, setImpersonationModalOpen] = useState(false);
  const [hasBuddies, setHasBuddies] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    confirmVariant?: 'primary' | 'danger';
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Get session for impersonation state
  const { data: session } = useSession();
  const {
    isImpersonating,
    originalAdmin,
    startImpersonation,
    stopImpersonation
  } = useImpersonation();

  const isAdmin = userRole === 'Admin' || userRole === 'superadmin';
  const isTreasurer = userRole === 'T' || userRole === 'Treasurer';
  const isCaptain = userRole === 'Captain';
  const isKiosk = userRole === 'Kiosk';
  const canAccessBanking = isAdmin || isTreasurer;
  const canAccessCaptainTools = isAdmin || isCaptain;
  const isCommittee = userRole && userRole !== 'Member' && userRole !== '' && !isKiosk;

  // Build admin menu items based on role
  const getAdminMenuItems = (): SubMenuItem[] => {
    const items: SubMenuItem[] = [];

    // Admins get all admin functions
    if (isAdmin) {
      items.push({ name: 'Send Member Emails', href: '/admin/emails' });
      items.push({ name: 'Banking', href: '/banking' });
      items.push({ name: 'Friendly Management', href: '/friendlies/manage' });
      items.push({ name: 'Internal Games Management', href: '/internal-games/manage' });
      items.push({ name: 'Data Export', href: '/data-export' });
    } else {
      // Non-admins get role-specific items
      if (canAccessBanking) {
        items.push({ name: 'Banking', href: '/banking' });
      }
      if (canAccessCaptainTools) {
        items.push({ name: 'Friendly Management', href: '/friendlies/manage' });
        items.push({ name: 'Internal Games Management', href: '/internal-games/manage' });
      }
    }

    // Captains and Admins get League Management and Fixtures Management
    if (canAccessCaptainTools) {
      items.push({ name: 'League Management', href: '/leagues' });
      items.push({ name: 'Fixtures Management', href: '/fixtures/manage' });
    }

    // All committee members (Role != "Member") get Member Suggestions, Invite Games, and Competitions admin
    if (isCommittee) {
      items.push({ name: 'Member Suggestions', href: '/member-suggestions' });
      items.push({ name: 'Invite Games', href: '/invite-games' });
      items.push({ name: 'Competitions Admin', href: '/competitions/admin' });
      items.push({ name: 'Handicaps', href: '/competitions/handicaps' });
    }

    return items;
  };

  const adminMenuItems = getAdminMenuItems();

  // Check if regular users have buddies to manage (not for kiosk)
  useEffect(() => {
    // Only check for non-admin, non-kiosk users
    if (!isAdmin && !isKiosk && userName) {
      fetch('/api/admin/impersonate/users')
        .then(res => res.json())
        .then(data => {
          // If they have any users to impersonate, show the button
          setHasBuddies(data.users && data.users.length > 0);
        })
        .catch(() => {
          // On error, hide the button
          setHasBuddies(false);
        });
    }
  }, [isAdmin, isKiosk, userName]);

  // Show impersonation/switch user only to:
  // - Admins (can switch to anyone)
  // - Regular users who have buddies (people who set them as buddy)
  // - Never for kiosk users
  const canShowImpersonation = !isKiosk && (isAdmin || hasBuddies);

  // Kiosk navigation items - simplified for clubhouse tablet
  const kioskNavigationItems: NavItem[] = [
    {
      name: 'Friendlies',
      href: '/friendlies',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      name: 'Internal Games',
      href: '/internal-games',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: 'Lookups',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
      subItems: [
        { name: 'Members', href: '/members' },
        { name: 'Clubs', href: '/clubs' },
        { name: 'Tea Rota', href: '/tea-rota' },
        { name: 'Cleaning Rota', href: '/cleaning-rota' },
        { name: 'Sweeping Rota', href: '/sweeping-rota' },
      ],
    },
  ];

  // Navigation items - easy to add more here
  const regularNavigationItems: NavItem[] = [
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
    // Suggestions - TEMPORARILY DISABLED - Will be re-enabled after committee approval
    // {
    //   name: 'Suggestions',
    //   href: '/member-suggestions',
    //   icon: (
    //     <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    //       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    //     </svg>
    //   ),
    // },
    // Admin submenu - shows role-based admin functions (only appears if user has items to access)

    ...(adminMenuItems.length > 0 ? [{
      name: 'Admin',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      subItems: adminMenuItems,
    }] : []),
//    {
//      name: 'Competitions',
//      href: '/competitions',
//      icon: (
//        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
//        </svg>
//      ),
//    },
    {
      name: 'Fixtures',
      href: '/fixtures',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      name: 'Friendlies',
      href: '/friendlies',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
    },
    {
      name: 'Internal Games',
      href: '/internal-games',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      name: 'Lookups',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      ),
      subItems: [
        { name: 'Members', href: '/members' },
        { name: 'Clubs', href: '/clubs' },
        { name: 'Tea Rota', href: '/tea-rota' },
        { name: 'Cleaning Rota', href: '/cleaning-rota' },
        { name: 'Sweeping Rota', href: '/sweeping-rota' },
      ],
    },
//    {
//      name: 'Social Events',
//      href: '/social-events',
//      icon: (
//        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
//        </svg>
//      ),
//    },
  ];

  // Use kiosk or regular navigation based on role.
  const navigationItems = isKiosk ? kioskNavigationItems : regularNavigationItems;

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

  // Check if we need to open impersonation modal after navigation
  useEffect(() => {
    const shouldOpen = sessionStorage.getItem('openImpersonationModal');
    if (shouldOpen === 'true') {
      sessionStorage.removeItem('openImpersonationModal');
      setImpersonationModalOpen(true);
    }
  }, [pathname]); // Run when pathname changes (after navigation)

  // Helper to close confirmation dialog
  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: () => {},
    });
  };

  // Handle logout with unsaved changes warning
  const handleLogout = () => {
    if (checkForUnsavedChanges()) {
      setConfirmDialog({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Your work will be lost. Continue?',
        confirmLabel: 'Logout Anyway',
        confirmVariant: 'danger',
        onConfirm: () => {
          closeConfirmDialog();
          clearAllDrafts();
          handleSignOut();
        },
      });
      return;
    }
    handleSignOut();
  };

  // Handle switch user with unsaved changes warning
  const handleSwitchUser = () => {
    if (checkForUnsavedChanges()) {
      setConfirmDialog({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Your work will be lost. Continue?',
        confirmLabel: 'Switch Anyway',
        confirmVariant: 'danger',
        onConfirm: () => {
          closeConfirmDialog();
          // Clear drafts IMMEDIATELY after confirmation (prevents auto-save race condition)
          clearAllDrafts();
          // If already on home page, open modal directly
          if (pathname === '/') {
            setImpersonationModalOpen(true);
          } else {
            // Set flag to open modal after navigation
            sessionStorage.setItem('openImpersonationModal', 'true');
            // Navigate to home IMMEDIATELY to unmount current page and prevent auto-save
            router.push('/');
          }
          setProfileMenuOpen(false);
        },
      });
      return;
    }
    // If already on home page, open modal directly
    if (pathname === '/') {
      setImpersonationModalOpen(true);
    } else {
      // Set flag to open modal after navigation
      sessionStorage.setItem('openImpersonationModal', 'true');
      // Navigate to home IMMEDIATELY to unmount current page and prevent auto-save
      router.push('/');
    }
    setProfileMenuOpen(false);
  };

  // Wrapper for impersonation that clears drafts and navigates to home after switching
  const handleImpersonateUser = async (userName: string) => {
    // Clear drafts again just before impersonation (belt and suspenders approach)
    clearAllDrafts();
    await startImpersonation(userName);
    // Navigate to home to force clean state after switching users
    router.push('/');
  };

  // Handle exit switch with unsaved changes warning
  const handleExitSwitch = () => {
    if (checkForUnsavedChanges()) {
      setConfirmDialog({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes. Your work will be lost. Continue?',
        confirmLabel: 'Exit Anyway',
        confirmVariant: 'danger',
        onConfirm: () => {
          closeConfirmDialog();
          clearAllDrafts();
          // Navigate to home IMMEDIATELY to unmount current page and prevent auto-save
          router.push('/');
          stopImpersonation();
          setProfileMenuOpen(false);
        },
      });
      return;
    }
    // Navigate to home IMMEDIATELY to unmount current page and prevent auto-save
    router.push('/');
    stopImpersonation();
    setProfileMenuOpen(false);
  };

  // Handle navigation with unsaved changes warning
  // Only warns for page-level changes (e.g., Change Password with filled fields)
  // Does NOT warn for auto-saved drafts (Profile/Renewals) - those persist across navigation
  const handleNavigation = (e: React.MouseEvent, href: string) => {
    // Only check page-level unsaved changes, NOT sessionStorage drafts
    // Drafts are preserved and will be restored when user returns to the page
    if (hasUnsavedChanges) {
      e.preventDefault();

      setConfirmDialog({
        isOpen: true,
        title: 'Unsaved Changes',
        message: 'You have unsaved password changes. Please save or cancel before navigating away.',
        confirmLabel: 'Leave Anyway',
        confirmVariant: 'primary',
        onConfirm: () => {
          closeConfirmDialog();
          // Navigate away (no need to clear drafts since this is page-level only)
          router.push(href);
        },
      });
      // If not confirmed, do nothing (stay on page)
    }
    // If no unsaved changes, let the Link handle navigation normally
  };

  // Get button styling based on variant
  const getActionButtonClasses = (variant: ActionButton['variant'] = 'primary', disabled?: boolean, loading?: boolean) => {
    const baseClasses = 'inline-flex items-center px-4 py-2 border rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors cursor-pointer';

    if (disabled || loading) {
      return `${baseClasses} bg-gray-400 text-white cursor-not-allowed`;
    }

    switch (variant) {
      case 'primary':
        return `${baseClasses} bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-500`;
      case 'secondary':
        return `${baseClasses} bg-white border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-gray-500`;
      case 'danger':
        return `${baseClasses} bg-red-500 text-white hover:bg-red-600 focus:ring-red-500`;
      default:
        return `${baseClasses} bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-500`;
    }
  };

  // Render action button
  const renderActionButton = (button: ActionButton, key: string) => (
    <button
      key={key}
      onClick={button.onClick}
      disabled={button.disabled || button.loading}
      className={getActionButtonClasses(button.variant, button.disabled, button.loading)}
    >
      {button.loading && (
        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      )}
      {button.icon && <span className="mr-2">{button.icon}</span>}
      {button.label}
    </button>
  );

  return (
    <nav className="sticky top-0 z-50 bg-white shadow-sm">
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
            {/* Show action buttons if provided, otherwise show normal navigation */}
            {actionButtons ? (
              <div className="flex items-center space-x-3">
                {actionButtons.secondary && renderActionButton(actionButtons.secondary, 'secondary')}
                {actionButtons.primary && renderActionButton(actionButtons.primary, 'primary')}
              </div>
            ) : (
              navigationItems.map((item) => (
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
                            onClick={(e) => {
                              handleNavigation(e, subItem.href);
                              setOpenDropdown(null);
                            }}
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
                  onClick={(e) => handleNavigation(e, item.href!)}
                  className={getNavItemClasses(isActive(item.href!))}
                >
                  {item.icon && <span className="mr-2">{item.icon}</span>}
                  {item.name}
                </Link>
              )
            )))}

            {/* Profile Icon Dropdown (or Hamburger Menu when editing) */}
            <div ref={profileDropdownRef} className="relative ml-4 pl-4 border-l border-gray-200">
              {actionButtons ? (
                // Hamburger menu when editing
                <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className={`relative inline-flex items-center justify-center p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-inset ${
                    isImpersonating
                      ? 'text-orange-600 hover:text-orange-700 hover:bg-orange-50 focus:ring-orange-500'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100 focus:ring-blue-500'
                  }`}
                  aria-expanded="false"
                  title="Open menu"
                >
                  <span className="sr-only">Open menu</span>
                  <svg className="block h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                  {isImpersonating && (
                    <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white"></span>
                  )}
                </button>
              ) : (
                // Profile icon in view mode
                <button
                  onClick={() => setProfileMenuOpen(!profileMenuOpen)}
                  className={getProfileIconClasses(isImpersonating || false)}
                  title={isImpersonating ? `Impersonating ${userName}` : userName || 'User Profile'}
                >
                  {getUserInitials(userName)}
                </button>
              )}
              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    {/* Kiosk mode header - but show full menu if impersonating */}
                    {isKiosk && !isImpersonating ? (
                      <>
                        <div className="px-4 py-2 text-sm font-medium text-blue-700 border-b border-gray-200 bg-blue-50">
                          Kiosk Mode
                        </div>
                        <button
                          onClick={handleLogout}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Logout
                        </button>
                        <div className="px-4 py-2 border-t border-gray-200">
                          <VersionDisplay showBuildDate={true} />
                        </div>
                      </>
                    ) : (
                      <>
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
                                onClick={handleExitSwitch}
                                className="block w-full text-left px-4 py-2 text-sm text-orange-700 hover:bg-orange-50 border-b border-gray-200"
                              >
                                Exit Switch
                              </button>
                            ) : (
                              <button
                                onClick={handleSwitchUser}
                                className="block w-full text-left px-4 py-2 text-sm text-blue-500 hover:bg-blue-50 border-b border-gray-200"
                              >
                                Switch User
                              </button>
                            )}
                          </>
                        )}

                        {/* Change Password - available for own account and when managing buddies */}
                        <Link
                          href="/change-password"
                          onClick={(e) => {
                            handleNavigation(e, '/change-password');
                            setProfileMenuOpen(false);
                          }}
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        >
                          Change Password
                        </Link>

                        {/* Hide logout when impersonating */}
                        {!isImpersonating && (
                          <button
                            onClick={handleLogout}
                            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            Logout
                          </button>
                        )}

                        {/* Version info */}
                        <div className="px-4 py-2 border-t border-gray-200">
                          <VersionDisplay showBuildDate={true} />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile Action Buttons or Menu Button */}
          <div className="flex items-center md:hidden">
            {/* Show action buttons in center space if provided */}
            {actionButtons && (
              <div className="flex items-center space-x-2 mr-4">
                {actionButtons.secondary && renderActionButton(actionButtons.secondary, 'secondary-mobile')}
                {actionButtons.primary && renderActionButton(actionButtons.primary, 'primary-mobile')}
              </div>
            )}

            {/* Hamburger menu button */}
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

      {/* Navigation menu overlay (used on mobile always, and on desktop when editing) */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setMobileMenuOpen(false)}
          ></div>

          {/* Menu panel */}
          <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-xl z-50 overflow-y-auto">
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
                            onClick={(e) => {
                              handleNavigation(e, subItem.href);
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
                    onClick={(e) => {
                      handleNavigation(e, item.href!);
                      setMobileMenuOpen(false);
                    }}
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
              {isKiosk && !isImpersonating ? (
                /* Kiosk mode mobile menu - but show full menu if impersonating */
                <>
                  <div className="px-4 mb-3">
                    <div className="text-sm font-medium text-blue-700 bg-blue-50 px-3 py-2 rounded-md">
                      Kiosk Mode
                    </div>
                  </div>
                  <div className="px-2 space-y-1">
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-3 py-2 text-base font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md"
                    >
                      Logout
                    </button>
                  </div>
                  <div className="px-4 py-3 mt-4 border-t border-gray-200 text-center">
                    <VersionDisplay showBuildDate={true} />
                  </div>
                </>
              ) : (
                /* Regular user mobile menu */
                <>
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
                              handleExitSwitch();
                              setMobileMenuOpen(false);
                            }}
                            className="block w-full text-left px-3 py-2 text-base font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded-md"
                          >
                            Exit Switch
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              handleSwitchUser();
                              setMobileMenuOpen(false);
                            }}
                            className="block w-full text-left px-3 py-2 text-base font-medium text-blue-600 hover:bg-blue-50 rounded-md"
                          >
                            Switch User
                          </button>
                        )}
                      </>
                    )}

                    {/* Change Password - available for own account and when managing buddies */}
                    <Link
                      href="/change-password"
                      onClick={(e) => {
                        handleNavigation(e, '/change-password');
                        setMobileMenuOpen(false);
                      }}
                      className="block px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-100 rounded-md"
                    >
                      Change Password
                    </Link>

                    {/* Hide logout when impersonating */}
                    {!isImpersonating && (
                      <button
                        onClick={handleLogout}
                        className="block w-full text-left px-3 py-2 text-base font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md"
                      >
                        Logout
                      </button>
                    )}
                  </div>

                  {/* Version info */}
                  <div className="px-4 py-3 mt-4 border-t border-gray-200 text-center">
                    <VersionDisplay showBuildDate={true} />
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Impersonation Modal */}
      <ImpersonationModal
        isOpen={impersonationModalOpen}
        onClose={() => setImpersonationModalOpen(false)}
        onImpersonate={handleImpersonateUser}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        confirmVariant={confirmDialog.confirmVariant}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />
    </nav>
  );
}
