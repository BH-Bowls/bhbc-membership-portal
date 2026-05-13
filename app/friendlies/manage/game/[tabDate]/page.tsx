// app/friendlies/manage/game/[tabDate]/page.tsx
// Team selection page for captains to select players, assign teams/positions, and manage game day logistics
// Allows viewing player stats, adding offline players, selecting teams, and generating match cards

'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';
import { SelectionHelperPanel } from '@/components/game-management/SelectionHelperPanel';
import { GameInstructionsDialog } from '@/components/game-management/GameInstructionsDialog';
import Link from 'next/link';
import { usePhoneBackNavigation } from '@/hooks/usePhoneBackNavigation';
import { GameSheetPlayer, Position } from '@/lib/types/friendlies';
import { saveDraft, restoreDraft, clearDraftsByFormName, notifyDraftsChanged } from '@/lib/form-draft-utils';
import { parseUKDate } from '@/lib/date-utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Game data structure returned from API
 * Includes game details and list of all players with their stats
 */
interface GameData {
  // Game information
  game: {
    tabDate: string;        // Game sheet identifier (e.g., "13 Jan 25")
    date: string;           // Game date (DD/MM/YYYY)
    time: string;           // Game time (HH:MM)
    clubName: string;       // Opponent club name
    homeAway: 'H' | 'A';    // Home or Away venue
    format: string;         // Game format (Triples, Pairs, etc.)
    ladiesMen: string;      // Ladies/Men/Mixed
    dress: string;          // Dress code
    status: string;         // Game status (O, X, S, P, C, A)
    tabName: string;        // Tab name in Google Sheets
    entered: number;        // Number of players entered
    selected: number;       // Number of players selected
    reserves: number;       // Number of reserves
    pickupInfo: string;     // Pickup point / time info (away games)
    specialInstructions: string; // Optional special instructions message
  };

  // List of players with stats and selection info
  players: GameSheetPlayer[];
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate the current selection before saving.
 * Returns an array of warning messages (empty array = all good).
 */
function validateSelection(
  players: GameSheetPlayer[],
  game: { format: string; homeAway: 'H' | 'A' }
): string[] {
  const warnings: string[] = [];
  const isAway = game.homeAway === 'A';
  const playingPlayers = players.filter(p => p.selected === 'Y');
  const selectedPlayers = players.filter(p => ['Y', 'R', 'T'].includes(p.selected));

  // 1. No captain selected
  if (!players.some(p => p.captain === 'Y')) {
    warnings.push('No captain has been selected.');
  }

  // 2. Home game: no bar person among playing players
  if (!isAway && !playingPlayers.some(p => p.driverBar && p.driverBar.includes('B'))) {
    warnings.push('No bar volunteer found among selected players (home game).');
  }

  // 3. Away game: incomplete driving / car details (reserves not required)
  if (isAway) {
    const noDetails = playingPlayers.filter(p => !p.carNumber && p.driving !== 'Y');
    if (noDetails.length > 0) {
      warnings.push(`Driving details incomplete for: ${noDetails.map(p => p.fullName).join(', ')}.`);
    }
  }

  // 4. Team composition
  const formatLower = game.format.toLowerCase();
  const teamCountMatch = game.format.match(/^(\d+)/);
  const expectedTeamCount = teamCountMatch ? parseInt(teamCountMatch[1]) : 0;

  let expectedPositions: Position[];
  if (formatLower.includes('pair')) expectedPositions = ['S', '1'];
  else if (formatLower.includes('triple')) expectedPositions = ['S', '1', '2'];
  else expectedPositions = ['S', '1', '2', '3']; // Rinks / Fours

  if (expectedTeamCount > 0) {
    for (let t = 1; t <= expectedTeamCount; t++) {
      const teamPositions = playingPlayers.filter(p => p.team === t).map(p => p.position);
      const missing = expectedPositions.filter(pos => !teamPositions.includes(pos));
      if (missing.length > 0) {
        const missingLabels = missing.map(pos => pos === '1' ? 'L' : pos);
        warnings.push(`Team ${t} is missing: ${missingLabels.join(', ')}.`);
      }
    }
    const teamsAssigned = new Set(playingPlayers.filter(p => p.team !== null).map(p => p.team)).size;
    if (teamsAssigned < expectedTeamCount) {
      warnings.push(`Only ${teamsAssigned} of ${expectedTeamCount} expected teams have players assigned.`);
    }
  }

  return warnings;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Team Selection Page Component
 * Captain-only page for selecting players and building teams
 * Features:
 * - View all entered players with stats (name down, picked, percent played)
 * - Add offline players who didn't enter online
 * - Select players as Playing/Reserve/Reserve Team
 * - Assign team numbers and positions (Skip, Lead, Second, Third)
 * - Select captain of the day
 * - For away games: mark drivers and assign car numbers
 * - Update selection and sync back to Players sheet
 * - Generate match card for printing
 */
export default function TeamSelectionPage() {
  // Get user session for authentication
  const { data: session } = useSession();

  // Get route parameters and navigation
  const params = useParams();
  const router = useRouter();

  // Extract tabDate from URL parameter
  const tabDate = params.tabDate as string;
  usePhoneBackNavigation('/friendlies/manage');

  // State: Game data including game details and all players
  const [gameData, setGameData] = useState<GameData | null>(null);

  // State: Players list (separate from gameData for easier updates)
  const [players, setPlayers] = useState<GameSheetPlayer[]>([]);

  // State: Original players for cancel/reset
  const [originalPlayers, setOriginalPlayers] = useState<GameSheetPlayer[]>([]);

  // State: Edit mode - whether user is editing selections
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false); // ref mirror so async callbacks can read current value

  // State: Loading indicator while fetching game data
  const [loading, setLoading] = useState(true);

  // State: Saving indicator while updating selection
  const [saving, setSaving] = useState(false);

  // State: Refreshing stats indicator
  const [refreshingStats, setRefreshingStats] = useState(false);

  // State: Add Players modal visibility
  const [showAddPlayersModal, setShowAddPlayersModal] = useState(false);

  // State: right panel tab toggle ('preview' or 'helper')
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'helper'>('preview');

  // State: Swap modal
  const [swapModal, setSwapModal] = useState<{ sourceRowNumber: number; targetRowNumber: number | null } | null>(null);

  // State: Save-warnings modal (list of issues found before saving)
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);

  // State: Lock dialog — shown when another captain holds the selection lock
  const [lockDialog, setLockDialog] = useState<{
    lockedBy: string;
    lockedAt: string;
    onOverride: () => void;
  } | null>(null);

  // State: Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // State: Instructions / Publish dialog (shared GameInstructionsDialog)
  const [instructionsDialogMode, setInstructionsDialogMode] = useState<'instructions' | 'publish' | null>(null);

  // Ref to track if initial setup has been done for this tabDate
  const setupDoneRef = useRef<string | null>(null);

  // Draft form name for sessionStorage
  const draftFormName = `FriendliesGame-${tabDate}`;
  const userName = session?.user?.userName || session?.user?.name || '';

  // ============================================================================
  // Effects
  // ============================================================================

  // sessionStorage keys for this game
  const cacheKey = `manage_game_cache_${tabDate}`;
  const backNavKey = `manage_game_back_nav_${tabDate}`;

  /** Save current game data to sessionStorage before navigating to a print page */
  function saveToCache(data: GameData) {
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
      // Record when stats were last refreshed so the picker can skip get-stats
      sessionStorage.setItem(`stats_refreshed_${tabDate}`, String(Date.now()));
    } catch { /* quota / private mode — ignore */ }
  }

  /** Set the back-nav flag so we restore from cache when we return */
  function markPrintNavigation(data: GameData) {
    try {
      sessionStorage.setItem(backNavKey, 'true');
      saveToCache(data);
    } catch { /* ignore */ }
  }

  /**
   * Effect: Initialize page - fetch data, restore draft, then refresh stats
   * On back-navigation from a print page, restore from sessionStorage cache
   * instead of hitting the Sheets API again.
   */
  useEffect(() => {
    // Wait for session to be ready (needed for draft check)
    if (!session?.user) return;

    // Skip if we've already set up for this tabDate
    if (setupDoneRef.current === tabDate) return;

    async function initializePage() {
      setLoading(true);

      // Check whether the user just came back from a print page
      const isBackNav = sessionStorage.getItem(backNavKey) === 'true';
      sessionStorage.removeItem(backNavKey);

      if (isBackNav) {
        try {
          const cached = sessionStorage.getItem(cacheKey);
          if (cached) {
            const data: GameData = JSON.parse(cached);
            setGameData(data);
            setOriginalPlayers(data.players);

            // Still honour any in-progress draft
            const currentUserName = session?.user?.userName || session?.user?.name || '';
            if (currentUserName) {
              const draft = restoreDraft<GameSheetPlayer[]>(draftFormName, currentUserName);
              if (draft && draft.length > 0) {
                setPlayers(draft);
                setIsEditing(true); isEditingRef.current = true;
              } else {
                setPlayers(data.players);
              }
            } else {
              setPlayers(data.players);
            }

            setupDoneRef.current = tabDate;
            setLoading(false);
            return; // Skip all API calls
          }
        } catch { /* cache parse failed — fall through to normal load */ }
      }

      try {
        // 1. Fetch game data and show it immediately
        const response = await fetch(`/api/friendlies/manage/game/${tabDate}`);
        const data = await response.json();

        if (!response.ok) {
          alert(data.error || 'Failed to load game');
          router.push('/friendlies/manage');
          return;
        }

        setGameData(data);
        setOriginalPlayers(data.players);

        // 2. Check for draft before showing players
        const currentUserName = session?.user?.userName || session?.user?.name || '';
        if (currentUserName) {
          const draft = restoreDraft<GameSheetPlayer[]>(draftFormName, currentUserName);
          if (draft && draft.length > 0) {
            setPlayers(draft);
            setIsEditing(true); isEditingRef.current = true;
          } else {
            setPlayers(data.players);
          }
        } else {
          setPlayers(data.players);
        }

        setupDoneRef.current = tabDate;
        setLoading(false);

        // 3. Refresh stats in the background — updates nameDown/picked/% and
        //    last-6-games without blocking the initial render
        try {
          await fetch('/api/friendlies/manage/get-stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: data.game.tabName }),
          });

          const refreshed = await fetch(`/api/friendlies/manage/game/${tabDate}`);
          if (refreshed.ok) {
            const refreshedData = await refreshed.json();
            setOriginalPlayers(refreshedData.players);
            // Don't overwrite the player list if the captain is already editing
            if (!isEditingRef.current) {
              setPlayers(refreshedData.players);
            }
            // Keep cache up to date with fresh stats
            saveToCache(refreshedData);
          }
        } catch (statsError) {
          console.error('Error refreshing stats:', statsError);
        }
      } catch (error) {
        console.error('Error fetching game:', error);
        alert('Failed to load game');
        router.push('/friendlies/manage');
        setLoading(false);
      }
    }

    initializePage();
  }, [tabDate, session, draftFormName, router]);

  /**
   * Effect: Auto-save draft when editing
   */
  useEffect(() => {
    if (isEditing && players.length > 0 && userName) {
      saveDraft(draftFormName, userName, players);
    }
  }, [isEditing, players, draftFormName, userName]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Helper to close confirmation dialog
   */
  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: () => {},
    });
  };

  /**
   * Refresh stats from Players sheet and add any new players
   * Preserves current edits - only adds truly new players
   * Called after adding players via the modal
   */
  async function refreshStats() {
    if (!gameData) return;

    setRefreshingStats(true);

    try {
      const response = await fetch('/api/friendlies/manage/get-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: gameData.game.tabName }),
      });

      const data = await response.json();

      if (response.ok) {
        // Get fresh game data to find new players
        const gameResponse = await fetch(`/api/friendlies/manage/game/${tabDate}`);
        const gameDataResult = await gameResponse.json();
        if (gameResponse.ok) {
          setGameData(gameDataResult);

          // If we're editing, merge new players with existing edits
          if (isEditing) {
            const existingRowNumbers = new Set(players.map(p => p.rowNumber));
            const newPlayers = gameDataResult.players.filter(
              (p: GameSheetPlayer) => !existingRowNumbers.has(p.rowNumber)
            );
            if (newPlayers.length > 0) {
              setPlayers([...players, ...newPlayers]);
            }
          } else {
            // Not editing, just replace
            setPlayers(gameDataResult.players);
            setOriginalPlayers(gameDataResult.players);
          }
        }
      } else {
        console.error('Failed to refresh stats:', data.error);
      }
    } catch (error) {
      console.error('Error refreshing stats:', error);
    } finally {
      setRefreshingStats(false);
    }
  }

  /**
   * Refetch game data and merge into current state.
   * Called after add/remove player operations to keep the game sheet player list in sync.
   */
  async function refreshGameData() {
    if (!gameData) return;
    try {
      const gameResponse = await fetch(`/api/friendlies/manage/game/${tabDate}`);
      const gameDataResult = await gameResponse.json();
      if (gameResponse.ok) {
        setGameData(gameDataResult);
        // Always update originalPlayers and cache so Cancel / print-back-nav stay current
        setOriginalPlayers(gameDataResult.players);
        saveToCache(gameDataResult);
        if (isEditing) {
          // Merge: preserve unsaved edits for players still in the sheet,
          // drop players who were removed, and update status for withdrawn ones.
          setPlayers(prev => {
            const freshMap = new Map<number, GameSheetPlayer>(
              gameDataResult.players.map((p: GameSheetPlayer) => [p.rowNumber, p])
            );
            const merged = prev
              .filter(p => freshMap.has(p.rowNumber)) // drop fully removed players
              .map(p => {
                const fresh = freshMap.get(p.rowNumber)!;
                // If withdrawn externally, use fresh state (don't preserve stale edits)
                return fresh.status === 'W' ? fresh : p;
              });
            // Append any brand-new rows not yet in the editing state
            const existingRows = new Set(prev.map(p => p.rowNumber));
            const added = gameDataResult.players.filter((p: GameSheetPlayer) => !existingRows.has(p.rowNumber));
            return [...merged, ...added];
          });
        } else {
          setPlayers(gameDataResult.players);
        }
      }
    } catch (error) {
      console.error('Error refreshing game data:', error);
    }
  }

  /**
   * Handle adding players via the EnteredPlayersModal
   * The add-players API adds players to both Players sheet AND game sheet directly
   */
  async function handleAddPlayers(playerUserNames: string[]): Promise<{ success: boolean; error?: string }> {
    if (!gameData) return { success: false, error: 'Game data not loaded' };

    try {
      const response = await fetch('/api/friendlies/add-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: gameData.game.tabName,
          playerUserNames,
        }),
      });

      const data = await response.json();

      if (data.success) {
        await refreshGameData();
        return { success: true };
      } else {
        return { success: false, error: data.error || 'Failed to add players' };
      }
    } catch (error) {
      console.error('Error adding players:', error);
      return { success: false, error: 'Failed to add players' };
    }
  }

  // ============================================================================
  // Lock Helpers
  // ============================================================================

  const releaseLock = useCallback(async (tabName: string) => {
    try {
      await fetch('/api/friendlies/manage/lock', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: tabName }),
      });
    } catch { /* ignore */ }
  }, []);

  const acquireLock = useCallback(async (tabName: string, force = false) => {
    try {
      const res = await fetch('/api/friendlies/manage/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: tabName, force }),
      });
      if (res.ok) return { acquired: true as const };
      if (res.status === 409) {
        const data = await res.json();
        return { acquired: false as const, lockedBy: data.lockedBy as string, lockedAt: data.lockedAt as string };
      }
      return { acquired: true as const }; // graceful degradation on other errors
    } catch {
      return { acquired: true as const };
    }
  }, []);

  // ============================================================================
  // Edit Mode Functions
  // ============================================================================

  /**
   * Enter edit mode — acquires the selection lock first.
   * Shows a blocking dialog if the game is already locked by another captain.
   */
  const startEditing = useCallback(async () => {
    if (!gameData) return;
    const lockResult = await acquireLock(gameData.game.tabName);
    if (!lockResult.acquired) {
      setLockDialog({
        lockedBy: lockResult.lockedBy,
        lockedAt: lockResult.lockedAt,
        onOverride: async () => {
          setLockDialog(null);
          await acquireLock(gameData.game.tabName, true);
          setOriginalPlayers(players);
          setIsEditing(true); isEditingRef.current = true;
        },
      });
      return;
    }
    setOriginalPlayers(players);
    setIsEditing(true); isEditingRef.current = true;
  }, [gameData, players, acquireLock]);

  /**
   * Perform the actual save — called directly or after the user confirms warnings.
   */
  const doSave = useCallback(async () => {
    if (!gameData) return;

    setSaving(true);

    try {
      // 1. Save selection to game sheet
      const captainUserName = players.find(p => p.captain === 'Y')?.name || '';
      const selections = players.map(p => ({
        row_number: p.rowNumber,
        selected: p.status === 'W' ? '' : p.selected,
        team: p.team,
        position: p.position,
        driving: p.driving,
        car_number: p.carNumber,
        status: p.status,
      }));

      const response = await fetch('/api/friendlies/manage/update-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: gameData.game.tabName,
          captain_username: captainUserName,
          selections,
        }),
      });

      const data = await response.json();

      if (response.status === 409) {
        // Another captain has taken the selection lock — show dialog
        setLockDialog({
          lockedBy: data.lockedBy || 'another captain',
          lockedAt: data.lockedAt || '',
          onOverride: async () => {
            setLockDialog(null);
            await acquireLock(gameData.game.tabName, true);
            await doSave();
          },
        });
        return;
      }

      if (!response.ok) {
        alert(data.error || 'Failed to save selection');
        return;
      }

      // 2. Update stats to Players sheet (recalculates from all game columns)
      // 3. Refresh game sheet stats from the now-updated Players sheet
      // 4. Re-fetch game data to get updated stats for display
      let updatedPlayers = data.sorted_players;
      try {
        await fetch('/api/friendlies/manage/update-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: gameData.game.tabName }),
        });

        await fetch('/api/friendlies/manage/get-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: gameData.game.tabName }),
        });

        const refreshResponse = await fetch(`/api/friendlies/manage/game/${encodeURIComponent(gameData.game.tabName)}`);
        if (refreshResponse.ok) {
          const refreshData = await refreshResponse.json();
          if (refreshData.players) {
            updatedPlayers = refreshData.players;
          }
        }
      } catch (statsError) {
        console.error('Error updating stats:', statsError);
        // Don't fail the save - just use data from save response
      }

      setPlayers(updatedPlayers);
      setOriginalPlayers(updatedPlayers);
      clearDraftsByFormName(draftFormName);      // clears all keys regardless of username
      sessionStorage.removeItem('friendlies_last_managed');
      notifyDraftsChanged();                     // tell Navbar to re-check immediately
      // Release selection lock now that save is complete
      await releaseLock(gameData.game.tabName);
      setIsEditing(false); isEditingRef.current = false;
      // Success - no alert needed, UI reflects saved state
    } catch (error) {
      console.error('Error saving selection:', error);
      // Keep error alert as user needs to know save failed
      alert('Failed to save selection');
    } finally {
      setSaving(false);
    }
  }, [gameData, players, draftFormName, acquireLock, releaseLock]);

  /**
   * Validate selection then save — shows a warnings modal if issues are found.
   */
  const handleSave = useCallback(async () => {
    if (!gameData) return;
    const warnings = validateSelection(players, gameData.game);
    if (warnings.length > 0) {
      setSaveWarnings(warnings);
      return;
    }
    await doSave();
  }, [gameData, players, doSave]);

  /**
   * Cancel changes and exit edit mode — releases the selection lock.
   */
  const handleCancel = useCallback(async () => {
    if (gameData) await releaseLock(gameData.game.tabName);
    setPlayers(originalPlayers);
    clearDraftsByFormName(draftFormName);        // clears all keys regardless of username
    sessionStorage.removeItem('friendlies_last_managed');
    notifyDraftsChanged();                       // tell Navbar to re-check immediately
    setIsEditing(false); isEditingRef.current = false;
  }, [originalPlayers, draftFormName, gameData, releaseLock]);

  // ============================================================================
  // Local State Update Functions
  // ============================================================================

  /**
   * Update a single field for a single player
   * Updates local state only - doesn't save to server until Save clicked
   * Special handling for captain field - only one player can be captain
   */
  function updatePlayer(rowNumber: number, field: string, value: any) {
    setPlayers(prev =>
      prev.map(p => {
        if (p.rowNumber === rowNumber) {
          const updated = { ...p, [field]: value };
          // Auto-promote Reserve → Playing when a team number is assigned
          if (field === 'team' && value && updated.selected === 'R') {
            updated.selected = 'Y';
          }
          return updated;
        }
        // Ensure only one captain at a time
        if (field === 'captain' && value === 'Y') return { ...p, captain: '' };
        return p;
      })
    );
  }

  /** Swap team/position/driving/carNumber/status between two players */
  function executeSwap(sourceRowNumber: number, targetRowNumber: number) {
    setPlayers(prev => {
      const src = prev.find(p => p.rowNumber === sourceRowNumber);
      const tgt = prev.find(p => p.rowNumber === targetRowNumber);
      if (!src || !tgt) return prev;
      const swapFields = (a: GameSheetPlayer, b: GameSheetPlayer): GameSheetPlayer => ({
        ...a,
        selected: b.selected,
        team: b.team,
        position: b.position,
        driving: b.driving,
        carNumber: b.carNumber,
      });
      return prev.map(p => {
        if (p.rowNumber === sourceRowNumber) return swapFields(p, tgt);
        if (p.rowNumber === targetRowNumber) return swapFields(p, src);
        return p;
      });
    });
    setSwapModal(null);
  }

  // ============================================================================
  // Preview Data (derived from players state, updates on every change)
  // ============================================================================

  const previewData = useMemo(() => {
    const positionOrder: Record<string, number> = { '1': 0, '2': 1, '3': 2, 'S': 3 };

    // Teams: selected === 'Y' with team assigned
    const teamPlayers = players.filter(p => p.selected === 'Y' && p.team !== null);
    const teamMap = new Map<number, GameSheetPlayer[]>();
    teamPlayers.forEach(p => {
      const t = p.team!;
      if (!teamMap.has(t)) teamMap.set(t, []);
      teamMap.get(t)!.push(p);
    });
    const teams = Array.from(teamMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([teamNum, tPlayers]) => ({
        team: teamNum,
        players: [...tPlayers].sort((a, b) => (positionOrder[a.position] ?? 99) - (positionOrder[b.position] ?? 99)),
      }));

    // Reserves: selected === 'R'
    const reserves = players.filter(p => p.selected === 'R');

    // Reserve teams: selected === 'T' with team assigned
    const rtPlayers = players.filter(p => p.selected === 'T' && p.team !== null);
    const rtMap = new Map<number, GameSheetPlayer[]>();
    rtPlayers.forEach(p => {
      const t = p.team!;
      if (!rtMap.has(t)) rtMap.set(t, []);
      rtMap.get(t)!.push(p);
    });
    const reserveTeams = Array.from(rtMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([teamNum, tPlayers]) => ({
        team: teamNum,
        players: [...tPlayers].sort((a, b) => (positionOrder[a.position] ?? 99) - (positionOrder[b.position] ?? 99)),
      }));

    // Car shares: from all selected players (Y, R, T)
    const carMap = new Map<string, { driver: string; passengers: string[] }>();
    const ownTransport: string[] = [];
    const allSelected = players.filter(p => p.selected === 'Y' || p.selected === 'R' || p.selected === 'T');
    allSelected.forEach(p => {
      if (p.carNumber && p.carNumber.toUpperCase() === 'O') {
        // 'O' means own transport
        ownTransport.push(p.fullName);
      } else if (p.driving === 'Y' && p.carNumber) {
        if (!carMap.has(p.carNumber)) {
          carMap.set(p.carNumber, { driver: p.fullName, passengers: [] });
        } else {
          carMap.get(p.carNumber)!.driver = p.fullName;
        }
      } else if (p.carNumber) {
        if (!carMap.has(p.carNumber)) {
          carMap.set(p.carNumber, { driver: '', passengers: [p.fullName] });
        } else {
          carMap.get(p.carNumber)!.passengers.push(p.fullName);
        }
      } else if (p.driving === 'Y') {
        ownTransport.push(p.fullName);
      }
    });
    const carGroups: { carNumber: string; driver: string; passengers: string[] }[] = [];
    carMap.forEach((value, carNumber) => {
      if (value.driver && value.passengers.length === 0) {
        ownTransport.push(value.driver);
      } else {
        carGroups.push({ carNumber, driver: value.driver, passengers: value.passengers });
      }
    });
    carGroups.sort((a, b) => a.carNumber.localeCompare(b.carNumber));

    // Opposition players: selected === 'O'
    const opposition = players.filter(p => p.selected === 'O');

    // Withdrawn players: status === 'W'
    const withdrawn = players.filter(p => p.status === 'W');

    return { teams, reserves, reserveTeams, carGroups, ownTransport, opposition, withdrawn };
  }, [players]);

  // ============================================================================
  // Loading State
  // ============================================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-700">Loading game...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gameData) return null;

  const { game } = gameData;
  const isAway = game.homeAway === 'A';

  // Position display: stored as '1' (Lead) but shown as 'L'
  const positionLabel = (pos: string) => pos === '1' ? 'L' : (pos || '-');

  // Build navbar action buttons - only show Save/Cancel when editing
  const navbarActionButtons = isEditing
    ? {
        primary: {
          label: 'Save',
          onClick: handleSave,
          loading: saving,
        },
        secondary: {
          label: 'Cancel',
          onClick: handleCancel,
          variant: 'secondary' as const,
        },
      }
    : undefined;

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        userName={session?.user.name ?? undefined}
        userRole={session?.user.role ?? undefined}
        actionButtons={navbarActionButtons}
      />

      <div className="px-4 py-8">
        {/* Two-column layout: left = all content, right = preview / helper panel */}
        <div className="lg:flex lg:gap-6">
          <div className="lg:flex-1 lg:min-w-0">

        {/* Header with back link and game details */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <Link href="/friendlies/manage" className="text-blue-600 hover:text-blue-800">← Back to Manage Games</Link>
            <div className="flex gap-2 items-center">
              {!isEditing && (
                <button
                  onClick={startEditing}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Selection
                </button>
              )}
            </div>
          </div>

          <h1 className="text-3xl font-bold text-gray-900">{game.clubName} - Team Selection</h1>

          <div className="text-gray-900 mt-2">
            {parseUKDate(game.date).toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {' at '}
            {game.time}
            {' - '}
            {game.homeAway === 'H' ? 'Home' : 'Away'}
            {' - '}
            {game.format}
          </div>

          {/* Refreshing stats indicator */}
          {refreshingStats && (
            <div className="mt-2 text-sm text-blue-600 flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Refreshing player stats...
            </div>
          )}
        </div>

        {/* Action buttons panel */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap gap-3 items-center">
          {/* Add Players button — always visible */}
          <button
            onClick={() => setShowAddPlayersModal(true)}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Players
          </button>

          {/* Instructions button — opens dialog to edit special instructions and pickup info */}
          {!isEditing && (
            <button
              onClick={() => setInstructionsDialogMode('instructions')}
              className="bg-amber-600 text-white px-4 py-2 rounded hover:bg-amber-700 transition-colors"
            >
              Instructions
            </button>
          )}

          {/* Publish / Republish — hidden when editing, for X (selecting) or S (published) games */}
          {!isEditing && (game.status === 'X' || game.status === 'S') && (
            <button
              onClick={() => setInstructionsDialogMode('publish')}
              className={`text-white px-4 py-2 rounded transition-colors flex items-center gap-2 ${
                game.status === 'S'
                  ? 'bg-orange-600 hover:bg-orange-700'
                  : 'bg-teal-600 hover:bg-teal-700'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              {game.status === 'S' ? 'Republish' : 'Publish'}
            </button>
          )}

          {/* Print Match Card link — hidden when editing */}
          {!isEditing && (
            <Link
              href={`/friendlies/match-card/${tabDate}`}
              onClick={() => markPrintNavigation(gameData!)}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
            >
              Print Match Card
            </Link>
          )}

          {/* Print Picker Sheet link — hidden when editing */}
          {!isEditing && (
            <Link
              href={`/friendlies/manage/picker/${tabDate}`}
              onClick={() => markPrintNavigation(gameData!)}
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 transition-colors"
            >
              Print Picker Sheet
            </Link>
          )}
        </div>

            {/* Selection table - main UI for selecting players and assigning teams */}
            <div className="bg-white rounded-lg shadow">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-16 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Name</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Stats</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">D/B</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Sel</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Tm</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Pos</th>

                    {isAway && (
                      <>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Drv</th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Car</th>
                      </>
                    )}

                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Cpt</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-700 uppercase">Conf</th>
                  </tr>
                </thead>

                <tbody className="bg-white divide-y divide-gray-200">
                  {players.map(player => (
                    <tr
                      key={player.rowNumber}
                      className={`text-gray-900 ${player.status === 'W' ? 'bg-red-50' : ''}`}
                    >
                      <td className="px-2 py-2 text-sm font-medium text-gray-900">
                        <span
                          className="cursor-help"
                          title={player.last8Games && player.last8Games.length > 0 ? player.last8Games.join('\n') : 'No recent games'}
                        >
                          {player.fullName}
                        </span>
                      </td>

                      <td className="px-2 py-2 text-sm text-gray-900">
                        <div className="text-xs">
                          {player.nameDown}/{player.picked}({Math.round(player.percentPlayed > 1 ? player.percentPlayed : player.percentPlayed * 100)}%)+{player.futureEntered}
                        </div>
                      </td>

                      <td className="px-2 py-2 text-sm">
                        <span className="text-xs bg-gray-100 text-gray-900 px-2 py-1 rounded">{player.driverBar}</span>
                      </td>

                      <td className="px-2 py-2">
                        <select
                          value={player.selected}
                          onChange={e => {
                            if (e.target.value === '__swap__') {
                              setSwapModal({ sourceRowNumber: player.rowNumber, targetRowNumber: null });
                            } else {
                              updatePlayer(player.rowNumber, 'selected', e.target.value);
                            }
                          }}
                          disabled={!isEditing}
                          tabIndex={-1}
                          className={`text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        >
                          <option value="Y">Y</option>
                          <option value="R">R</option>
                          <option value="T">T</option>
                          <option value="" disabled>──</option>
                          <option value="__swap__">Swap…</option>
                        </select>
                      </td>

                      <td className="px-2 py-2">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={player.team || ''}
                          onChange={e => {
                            const v = e.target.value.replace(/\D/g, '');
                            updatePlayer(player.rowNumber, 'team', v ? parseInt(v) : null);
                          }}
                          disabled={!isEditing}
                          className={`w-10 text-sm text-center border border-gray-300 rounded px-1 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        />
                      </td>

                      <td className="px-2 py-2">
                        <select
                          value={player.position}
                          onChange={e => updatePlayer(player.rowNumber, 'position', e.target.value)}
                          disabled={!isEditing}
                          className={`text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                        >
                          <option value="">-</option>
                          <option value="S">S</option>
                          <option value="1">L</option>
                          <option value="2">2</option>
                          <option value="3">3</option>
                        </select>
                      </td>

                      {isAway && (
                        <>
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={player.driving === 'Y'}
                              onChange={e => updatePlayer(player.rowNumber, 'driving', e.target.checked ? 'Y' : '')}
                              disabled={!isEditing}
                              tabIndex={-1}
                              className={`w-4 h-4 ${!isEditing ? 'cursor-not-allowed' : ''}`}
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              value={player.carNumber || ''}
                              onChange={e => updatePlayer(player.rowNumber, 'carNumber', e.target.value)}
                              disabled={!isEditing}
                              tabIndex={-1}
                              className={`w-10 text-sm text-center border border-gray-300 rounded px-1 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isEditing ? 'bg-gray-100 cursor-not-allowed' : ''}`}
                            />
                          </td>
                        </>
                      )}

                      <td className="px-2 py-2">
                        <input
                          type="radio"
                          name="captain"
                          checked={player.captain === 'Y'}
                          onChange={() => updatePlayer(player.rowNumber, 'captain', 'Y')}
                          disabled={!isEditing}
                          tabIndex={-1}
                          className={`w-4 h-4 ${!isEditing ? 'cursor-not-allowed' : ''}`}
                        />
                      </td>

                      <td className="px-2 py-2 text-sm">
                        {player.status === 'W' ? (
                          <span className="text-red-600 text-xs">Withdrawn</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={player.status === 'Y'}
                            onChange={e => updatePlayer(player.rowNumber, 'status', e.target.checked ? 'Y' : '')}
                            disabled={!isEditing}
                            tabIndex={-1}
                            className={`w-4 h-4 ${!isEditing ? 'cursor-not-allowed' : ''}`}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Instructions panel */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold mb-2 text-gray-900">Instructions:</h4>
              <ul className="text-sm space-y-1 list-disc list-inside text-gray-900">
                <li>Player stats are populated when the game is closed and when new players are added</li>
                <li>Click <strong>Edit Selection</strong> to start editing — if another captain is already editing you can wait or override them</li>
                <li>Assign team numbers and positions for selected players — <strong>hover over a name</strong> to see their stats and recent game entries</li>
                <li>Players set to Y (Playing) automatically when a team number is entered; change to R (Reserve) or T (Reserve Team) if needed</li>
                <li>Select ONE captain of the day (radio button)</li>
                <li>For away games, mark drivers and assign car numbers</li>
                <li>The <strong>Conf</strong> column shows a tick when a player has confirmed; withdrawn players show "Withdrawn"</li>
                <li>The right-hand panel shows a <strong>Live Preview</strong> of teams as you select, or switch to <strong>Selection Helper</strong> for fairness guidance (reserve streaks, first timers, buddy pairs, % played)</li>
                <li>Click <strong>Save</strong> to save selections (also updates Players sheet), or <strong>Cancel</strong> to discard changes</li>
                <li><strong>Adding/removing players:</strong> use the <strong>Add Players</strong> button. During Open or Selecting, removing a player deletes them from the game entirely. Once Published, you are asked whether to <strong>Remove</strong> (completely — e.g. to move them to another game) or <strong>Withdraw</strong> (marks them as withdrawn in the sheet)</li>
                <li><strong>Publishing/Republishing:</strong> tick <em>Email entered players</em> to notify players. Choose <em>All players</em> or <em>Select players</em> — use Select when only one swap was made so you only email the replacement</li>
              </ul>
            </div>
          </div>

          {/* Right side: tabbed panel — Live Preview / Selection Helper */}
          <div className="w-64 shrink-0 hidden lg:block">
            <div className="sticky top-20 max-h-[calc(100vh-5.5rem)] overflow-y-auto pr-1">

              {/* Tab toggle */}
              <div className="flex border-b border-gray-200 mb-3">
                <button
                  onClick={() => setRightPanelTab('preview')}
                  className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                    rightPanelTab === 'preview'
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Live Preview
                </button>
                <button
                  onClick={() => setRightPanelTab('helper')}
                  className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${
                    rightPanelTab === 'helper'
                      ? 'text-amber-600 border-b-2 border-amber-500'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Selection Helper
                </button>
              </div>

              {/* Selection Helper tab */}
              {rightPanelTab === 'helper' && gameData && (
                <SelectionHelperPanel tabName={gameData.game.tabName} active={rightPanelTab === 'helper'} />
              )}

              {/* Live Preview tab */}
              {rightPanelTab === 'preview' && <div className="space-y-3">

                {/* Teams */}
                {previewData.teams.length > 0 ? (
                  previewData.teams.map(team => (
                    <div key={team.team} className="border border-gray-300 rounded bg-white">
                      <div className="bg-gray-100 px-3 py-1 border-b border-gray-300">
                        <span className="text-sm font-semibold text-gray-900">Team {team.team}</span>
                      </div>
                      <div className="px-3 py-1">
                        {team.players.map(p => (
                          <div key={p.rowNumber} className="flex text-sm py-0.5 text-gray-900">
                            <span className="text-gray-700 w-6">{positionLabel(p.position)}</span>
                            <span className="flex-1 ml-2">
                              {p.fullName}
                              {p.captain === 'Y' && <span className="text-purple-600 ml-1">&#9733;</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-700 italic">No teams assigned yet</p>
                )}

                {/* Reserves */}
                {previewData.reserves.length > 0 && (
                  <div className="border border-gray-300 rounded bg-white">
                    <div className="bg-yellow-50 px-3 py-1 border-b border-gray-300">
                      <span className="text-sm font-semibold text-gray-900">Reserves</span>
                    </div>
                    <div className="px-3 py-1">
                      {previewData.reserves.map(p => (
                        <div key={p.rowNumber} className="text-sm py-0.5 text-gray-900">{p.fullName}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Car Shares (away games only) */}
                {isAway && (previewData.carGroups.length > 0 || previewData.ownTransport.length > 0) && (
                  <div className="border border-gray-300 rounded bg-white">
                    <div className="bg-blue-50 px-3 py-1 border-b border-gray-300">
                      <span className="text-sm font-semibold text-gray-900">Car Shares</span>
                    </div>
                    <div className="px-3 py-1 text-sm text-gray-900 space-y-1">
                      {previewData.carGroups.map((group, idx) => (
                        <div key={idx} className="py-0.5">
                          <div className="font-medium text-gray-900">Car {group.carNumber}</div>
                          <div>
                            {group.driver && <span>{group.driver} (Driver)</span>}
                            {group.passengers.map((p, pidx) => (
                              <span key={pidx}>{(group.driver || pidx > 0) ? ', ' : ''}{p}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                      {previewData.ownTransport.length > 0 && (
                        <div className="py-0.5 border-t border-gray-200 mt-1 pt-1">
                          <div className="font-medium text-gray-900">Own Transport</div>
                          <div>{previewData.ownTransport.join(', ')}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Reserve Teams */}
                {previewData.reserveTeams.map(team => (
                  <div key={team.team} className="border border-gray-300 rounded bg-white">
                    <div className="bg-orange-100 px-3 py-1 border-b border-gray-300">
                      <span className="text-sm font-semibold text-gray-900">Reserve Team {team.team}</span>
                    </div>
                    <div className="px-3 py-1">
                      {team.players.map(p => (
                        <div key={p.rowNumber} className="flex text-sm py-0.5">
                          <span className="text-gray-700 w-6">{positionLabel(p.position)}</span>
                          <span className="flex-1 ml-2">{p.fullName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Opposition */}
                {previewData.opposition.length > 0 && (
                  <div className="border border-blue-300 rounded bg-white">
                    <div className="bg-blue-50 px-3 py-1 border-b border-blue-300">
                      <span className="text-sm font-semibold text-blue-700">{gameData!.game.clubName}</span>
                    </div>
                    <div className="px-3 py-1">
                      {previewData.opposition.map(p => (
                        <div key={p.rowNumber} className="text-sm py-0.5 text-gray-900">{p.fullName}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Withdrawn */}
                {previewData.withdrawn.length > 0 && (
                  <div className="border border-red-200 rounded bg-white">
                    <div className="bg-red-50 px-3 py-1 border-b border-red-200">
                      <span className="text-sm font-semibold text-red-600">Withdrawn</span>
                    </div>
                    <div className="px-3 py-1">
                      {previewData.withdrawn.map(p => (
                        <div key={p.rowNumber} className="text-sm py-0.5 text-gray-500 line-through">{p.fullName}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />

      {/* Add Players Modal */}
      <EnteredPlayersModal
        isOpen={showAddPlayersModal}
        onClose={() => setShowAddPlayersModal(false)}
        gameId={game.tabName}
        gameType="friendlies"
        gameName={game.clubName}
        gameStatus={game.status}
        ladiesMen={game.ladiesMen}
        currentUserRole={session?.user?.role}
        onPlayersChanged={refreshGameData}
        onAddPlayers={handleAddPlayers}
      />

      {/* ================================================================== */}
      {/* Swap Modal */}
      {/* ================================================================== */}
      {swapModal && (() => {
        const swapSource = players.find(p => p.rowNumber === swapModal.sourceRowNumber);
        const swapCandidates = players.filter(p => p.rowNumber !== swapModal.sourceRowNumber);
        return (
          <div className="fixed inset-0 z-[100] overflow-y-auto">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black bg-opacity-50"
              onClick={() => setSwapModal(null)}
            />
            {/* Panel */}
            <div className="flex min-h-full items-center justify-center p-4">
              <div
                className="relative bg-white rounded-lg shadow-xl max-w-sm w-full p-6"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Swap Player Details</h3>
                <p className="text-sm text-gray-700 mb-4">
                  Swapping <span className="font-medium text-gray-900">{swapSource?.fullName ?? '?'}</span> with:
                </p>

                <select
                  value={swapModal.targetRowNumber ?? ''}
                  onChange={e => {
                    const val = e.target.value;
                    setSwapModal(prev => prev ? { ...prev, targetRowNumber: val ? parseInt(val) : null } : null);
                  }}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
                >
                  <option value="">— select a player —</option>
                  {swapCandidates.map(p => (
                    <option key={p.rowNumber} value={p.rowNumber}>
                      {p.fullName}
                      {p.selected === 'Y' ? ` (Tm ${p.team ?? '?'}, ${p.position === '1' ? 'L' : (p.position || '-')})` :
                       p.selected === 'R' ? ' (Reserve)' :
                       p.selected === 'T' ? ' (Reserve Team)' : ''}
                    </option>
                  ))}
                </select>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setSwapModal(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (swapModal.targetRowNumber !== null) {
                        executeSwap(swapModal.sourceRowNumber, swapModal.targetRowNumber);
                      }
                    }}
                    disabled={swapModal.targetRowNumber === null}
                    className={`px-4 py-2 text-sm font-medium text-white rounded ${
                      swapModal.targetRowNumber === null
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    Swap
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================================== */}
      {/* Save Warnings Modal */}
      {/* ================================================================== */}
      {saveWarnings.length > 0 && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setSaveWarnings([])}
          />
          {/* Panel */}
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={e => e.stopPropagation()}
            >
              {/* Icon */}
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-yellow-100">
                <svg className="w-6 h-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
                Save with Warnings?
              </h3>
              <p className="text-sm text-gray-700 text-center mb-3">
                The following issues were found:
              </p>

              <ul className="text-sm text-gray-700 space-y-1 mb-6 list-disc list-inside bg-yellow-50 border border-yellow-200 rounded p-3">
                {saveWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setSaveWarnings([])}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Go Back
                </button>
                <button
                  onClick={async () => {
                    setSaveWarnings([]);
                    await doSave();
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  Save Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* ================================================================== */}
      {/* Selection Lock Dialog */}
      {/* ================================================================== */}
      {lockDialog && (
        <div className="fixed inset-0 z-[100] overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" />
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 rounded-full bg-amber-100">
                <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">Selection in Progress</h3>
              <p className="text-sm text-gray-700 text-center mb-1">
                <span className="font-medium text-gray-900">{lockDialog.lockedBy}</span> is currently editing the team selection for this game
                {lockDialog.lockedAt ? (() => {
                  const d = new Date(lockDialog.lockedAt);
                  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                  return <> since {date} at {time}</>;
                })() : null}.
              </p>
              <p className="text-sm text-gray-500 text-center mb-6">
                You can override and take over, but their unsaved changes will be discarded.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setLockDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={lockDialog.onOverride}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded hover:bg-amber-700"
                >
                  Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instructions / Publish dialog */}
      {instructionsDialogMode && gameData && (
        <GameInstructionsDialog
          isOpen={true}
          mode={instructionsDialogMode}
          game={{
            tabName: gameData.game.tabName,
            rowNumber: 0,
            clubName: gameData.game.clubName,
            date: gameData.game.date,
            time: gameData.game.time,
            format: gameData.game.format,
            homeAway: gameData.game.homeAway,
            specialInstructions: gameData.game.specialInstructions || '',
            pickupInfo: gameData.game.pickupInfo || '',
            status: gameData.game.status,
          }}
          onConfirm={() => {
            setInstructionsDialogMode(null);
            fetch(`/api/friendlies/manage/game/${tabDate}`)
              .then(r => r.json())
              .then(data => {
                if (data.game) setGameData(prev => prev ? { ...prev, game: data.game } : prev);
              })
              .catch(() => {/* ignore */});
          }}
          onCancel={() => setInstructionsDialogMode(null)}
        />
      )}
    </div>
  );
}
