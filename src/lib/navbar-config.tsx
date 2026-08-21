// src/lib/navbar-config.tsx
// Lets a page customize the persistent, layout-level Navbar (app/layout.tsx renders it
// once now, not per-page — see NAVBAR_PERSISTENT_LAYOUT_SPEC.md) without Navbar being
// re-mounted for every navigation. A page calls useNavbarConfig({...}) with whichever
// fields it needs; everything else stays at Navbar's own defaults. Config is
// automatically cleared when the calling page unmounts, so nothing can leak into
// whatever page the user navigates to next.
//
// Split into two contexts (value vs setter) deliberately. useState's setter is
// referentially stable across renders, but wrapping it together with the live config
// in one object (as a single context) recreates that wrapper every update — which
// makes every *page* (a consumer, via useNavbarConfig) a subscriber to that same
// context, so a config update forces the page to re-render too. That rebuilds
// inline props like actionButtons as new object references, which the effect below
// sees as "changed" and re-sends, forcing another update — an infinite render loop.
// With the setter on its own context, its value never changes identity, so pages
// calling useNavbarConfig are never forced to re-render by a config update; only
// Navbar (via useNavbarConfigValue, the value context) re-renders when config changes.

'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface NavbarActionButton {
  label: string;
  onClick: () => void;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

export interface NavbarPageConfig {
  showLogoOnly?: boolean;
  isTokenMode?: boolean;
  guestButtons?: ReactNode;
  actionButtons?: {
    primary?: NavbarActionButton;
    secondary?: NavbarActionButton;
  };
  hasUnsavedChanges?: boolean;
}

const DEFAULT_CONFIG: NavbarPageConfig = {};

const NavbarConfigValueContext = createContext<NavbarPageConfig>(DEFAULT_CONFIG);
const NavbarConfigSetterContext = createContext<((config: NavbarPageConfig) => void) | null>(null);

export function NavbarConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<NavbarPageConfig>(DEFAULT_CONFIG);
  return (
    <NavbarConfigSetterContext.Provider value={setConfig}>
      <NavbarConfigValueContext.Provider value={config}>
        {children}
      </NavbarConfigValueContext.Provider>
    </NavbarConfigSetterContext.Provider>
  );
}

/** Read-only — used by the single layout-level <Navbar>, not by pages. */
export function useNavbarConfigValue(): NavbarPageConfig {
  return useContext(NavbarConfigValueContext);
}

/**
 * Called by a page to customize the shared Navbar while it's mounted. Re-registers on
 * every render (so live-changing values like actionButtons.primary.loading stay in
 * sync — deliberately no dependency-array diffing here, since actionButtons carries
 * fresh onClick closures every render anyway) and resets to defaults on unmount, so
 * the next page never inherits stale config.
 */
export function useNavbarConfig(config: NavbarPageConfig) {
  const setConfig = useContext(NavbarConfigSetterContext);
  if (!setConfig) throw new Error('useNavbarConfig must be used within NavbarConfigProvider');

  // Avoid re-triggering Navbar's own re-render when a page passes an equivalent but
  // newly-allocated config object every render (common — most callers build the
  // object inline). Shallow-compare against the last value we actually sent.
  const lastSentRef = useRef<NavbarPageConfig | null>(null);

  useEffect(() => {
    if (!shallowConfigEqual(lastSentRef.current, config)) {
      lastSentRef.current = config;
      setConfig(config);
    }
  });

  useEffect(() => {
    return () => {
      lastSentRef.current = null;
      setConfig(DEFAULT_CONFIG);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function shallowConfigEqual(a: NavbarPageConfig | null, b: NavbarPageConfig): boolean {
  if (!a) return false;
  return (
    a.showLogoOnly === b.showLogoOnly &&
    a.isTokenMode === b.isTokenMode &&
    a.guestButtons === b.guestButtons &&
    a.hasUnsavedChanges === b.hasUnsavedChanges &&
    a.actionButtons === b.actionButtons
  );
}
