// app/friendlies/manage/page.tsx
// Captain Management Home - list of all games with status management
// Captains can open/close games, publish selections, mark as played, and cancel games
// Shows table view with game details, player counts, and available actions based on status

'use client';

import { useEffect, useState, useLayoutEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EnteredPlayersModal } from '@/components/game-management/EnteredPlayersModal';
import { GameInstructionsDialog, type InstructionsDialogMode } from '@/components/game-management/GameInstructionsDialog';
import { Game, GameStatus } from '@/lib/types/friendlies';

interface PlayerStatRow {
  userName: string;
  fullName: string;
  selected: number;
  reserve: number;
  reserveTeam: number;
  opposition: number;
  withdrawn: number;
  cancelled: number;
  abandoned: number;
  entered: number;
  total: number;
}
import { getButtonClasses } from '@/config/theme-helpers';
import { groupPairedGames, isPairedGame, type GameOrPair } from '@/lib/friendlies-utils';

// ============================================================================
// Main Component
// ============================================================================

/**
 * Manage Games Page Component
 * Captain-only page for managing friendly match lifecycle
 * Features:
 * - View all games in table format
 * - Filter by game status
 * - Change game status (Open, Close, Publish, Played, Cancel)
 * - View player entry and selection counts
 * - Navigate to team selection page
 */
export default function ManageGamesPage() {
  // Get current user session
  const { data: session } = useSession();

  // Router for navigation
  const router = useRouter();

  // State: List of all games
  const [games, setGames] = useState<Game[]>([]);

  // State: Current filter selection
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'open' | 'selecting' | 'played'>('all');

  // State: Loading indicator while fetching games
  const [loading, setLoading] = useState(true);

  // State: Explicit reload in progress (shows spinner on reload button)
  const [reloading, setReloading] = useState(false);

  // State: Action loading indicator (stores tabName of game being updated)
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // State: Confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    game?: Game;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    game: undefined,
    onConfirm: () => {},
  });

  // State: Game outcome dialog for Played/Cancelled/Abandoned
  const [outcomeDialog, setOutcomeDialog] = useState<{
    isOpen: boolean;
    tabName: string;
    gameStatus: string;  // Current game status to determine available options
    homeAway: string;    // 'H' or 'A' — controls tea rota email option visibility
    entered: number;     // Number of entered players — controls player email option visibility
    status: 'P' | 'C' | 'A' | '';  // Played, Cancelled, Abandoned
    bhbcScore: string;
    opponentScore: string;
    noScore: boolean;    // Played with no score (reserve team, BH vs BH) — record a reason instead
    reason: string;
    who: 'Burgess Hill' | 'Opponent' | '';
    sendEmail: boolean;
    sendTeaRotaEmail: boolean;
    isSubmitting: boolean;
    result: {
      emailsSent?: number;
      playersWithoutEmail?: string[];
      emailError?: string;
      teaRotaEmailsSent?: number;
      teaRotaMembersWithoutEmail?: string[];
      teaRotaEmailError?: string;
    } | null;
  }>({
    isOpen: false,
    tabName: '',
    gameStatus: '',
    homeAway: '',
    entered: 0,
    status: '',
    bhbcScore: '',
    opponentScore: '',
    noScore: false,
    reason: '',
    who: '',
    sendEmail: false,
    sendTeaRotaEmail: false,
    isSubmitting: false,
    result: null,
  });

  // State: Instructions dialog (replaces separate message/pickup/publish dialogs)
  const [instructionsDialog, setInstructionsDialog] = useState<{
    isOpen: boolean;
    mode: InstructionsDialogMode;
    game: Game | null;
    afterConfirm?: () => void;
  }>({ isOpen: false, mode: 'open', game: null });

  // State: Add Players modal (opens EnteredPlayersModal for a specific game)
  const [addPlayersModal, setAddPlayersModal] = useState<{ isOpen: boolean; game: Game | null }>({
    isOpen: false,
    game: null,
  });

  // State: Per-row action dropdown selections (keyed by tabName)
  const [actionSelections, setActionSelections] = useState<Record<string, string>>({});

  // State: Lock warning dialog — shown when navigating to a game that is already locked
  const [manageLockDialog, setManageLockDialog] = useState<{
    lockedBy: string;
    lockedAt: string;
    onProceed: () => void;
  } | null>(null);

  // State: Manage page view toggle — Games list or Player Stats
  const [manageView, setManageView] = useState<'games' | 'stats'>('games');

  // State: Player stats data
  const [playerStats, setPlayerStats] = useState<PlayerStatRow[] | null>(null);
  const [notPlayedStats, setNotPlayedStats] = useState<{ userName: string; fullName: string }[] | null>(null);
  const [playerStatsLoading, setPlayerStatsLoading] = useState(false);

  // State: Player stats sort
  const [statsSortCol, setStatsSortCol] = useState<keyof PlayerStatRow>('fullName');
  const [statsSortDir, setStatsSortDir] = useState<'asc' | 'desc'>('asc');
  const [showNotPlayed, setShowNotPlayed] = useState(false);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch games when page loads.
   * Uses sessionStorage cache so navigating back is instant.
   * Always re-validates silently in the background.
   */
  // Reconcile orphaned session state before the first paint.
  // This catches cases where last_managed or a FriendliesGame draft was left
  // behind without its counterpart (e.g. username mismatch on clearDraft).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const lastManaged = sessionStorage.getItem('friendlies_last_managed');
    const friendliesDraftKeys = Object.keys(sessionStorage).filter(k =>
      k.startsWith('FormDraft-FriendliesGame-')
    );

    if (lastManaged && friendliesDraftKeys.length === 0) {
      // Resume indicator set but no draft to back it up — stale Resume
      sessionStorage.removeItem('friendlies_last_managed');
    } else if (!lastManaged && friendliesDraftKeys.length > 0) {
      // Orphaned draft(s) with no corresponding Resume — stale orange dot
      friendliesDraftKeys.forEach(k => sessionStorage.removeItem(k));
      window.dispatchEvent(new CustomEvent('drafts-changed'));
    }

    // Restore saved view and filter tab
    const savedView = sessionStorage.getItem('friendlies_manage_view');
    if (savedView === 'games' || savedView === 'stats') setManageView(savedView);

    const savedFilter = sessionStorage.getItem('friendlies_manage_filter');
    if (savedFilter === 'all' || savedFilter === 'upcoming' || savedFilter === 'open' || savedFilter === 'selecting' || savedFilter === 'played') {
      setFilter(savedFilter);
    }
  }, []);

  useEffect(() => {
    const CACHE_KEY = 'friendlies_manage_games_cache';
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      try {
        setGames(JSON.parse(cached));
        setLoading(false);
        fetchGames({ silent: true });
        return;
      } catch {
        // Bad cache — fall through
      }
    }
    fetchGames();
  }, []);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch all games from captain management API.
   * Saves result to sessionStorage so navigating back is instant.
   * Pass { silent: true } to skip the loading spinner (background refresh).
   */
  async function fetchGames({ silent = false }: { silent?: boolean } = {}) {
    const CACHE_KEY = 'friendlies_manage_games_cache';
    if (!silent) setLoading(true);

    try {
      const response = await fetch('/api/friendlies/manage/games');
      const data = await response.json();

      if (response.ok) {
        setGames(data.games);
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.games));
      } else {
        if (!silent) alert(data.error || 'Failed to load games');
      }
    } catch (error) {
      console.error('Error fetching games:', error);
      if (!silent) alert('Failed to load games');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  /** Force a fresh fetch, bypassing the cache. */
  async function handleReload() {
    sessionStorage.removeItem('friendlies_manage_games_cache');
    setReloading(true);
    await fetchGames();
    setReloading(false);
  }

  /** Fetch all-player stats from the manage endpoint */
  async function fetchPlayerStats() {
    setPlayerStatsLoading(true);
    try {
      const res = await fetch('/api/friendlies/manage/player-stats');
      const data = await res.json();
      if (res.ok) {
        setPlayerStats(data.players as PlayerStatRow[]);
        setNotPlayedStats(data.notPlayed ?? []);
      } else {
        console.error('Player stats error:', data.error);
      }
    } catch (error) {
      console.error('Failed to fetch player stats:', error);
    } finally {
      setPlayerStatsLoading(false);
    }
  }

  /**
   * Change game status via API
   * Generic function for all status changes (open, close, publish, etc.)
   * Automatically includes expected_status for optimistic-locking; returns 409 if stale.
   */
  async function changeStatus(
    tabName: string,
    action: string,
    additionalData?: any,
    rowNumber?: number,
  ): Promise<{ success: boolean; data?: Record<string, unknown> }> {
    setActionLoading(tabName || `row-${rowNumber}`);

    // Look up the game's current status so we can send expected_status
    const currentGame = games.find(g =>
      (tabName && g.tabName === tabName) || (rowNumber && g.rowNumber === rowNumber)
    );

    try {
      const response = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabName,
          row_number: rowNumber,
          action,
          expected_status: currentGame?.status,
          ...additionalData,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const key = tabName || `row-${rowNumber}`;
        setActionSelections(prev => { const next = { ...prev }; delete next[key]; return next; });
        await fetchGames();
        return { success: true, data };
      } else if (response.status === 409) {
        // Status has changed since page loaded — clear cache and refresh
        alert("This game's status has changed since you last loaded the page. The page will now refresh.");
        sessionStorage.removeItem('friendlies_manage_games_cache');
        await fetchGames();
        return { success: false };
      } else {
        alert(data.error || 'Failed to update status');
        return { success: false };
      }
    } catch (error) {
      console.error('Error changing status:', error);
      alert('Failed to update status');
      return { success: false };
    } finally {
      setActionLoading(null);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Helper to close confirmation dialog
   */
  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      game: undefined,
      onConfirm: () => {},
    });
  };

  /**
   * Handle Open Game button click — shows instructions dialog first
   */
  function handleOpenGame(game: Game) {
    openInstructionsDialog(game, 'open');
  }

  /**
   * Handle Open for paired games - opens both games together (simple confirm, no instructions)
   */
  function handleOpenPairedGames(gameA: Game, gameB: Game) {
    setConfirmDialog({
      isOpen: true,
      title: 'Open Paired Games',
      message: `Open both ${gameA.clubName} and ${gameB.clubName} games for player entry?`,
      onConfirm: async () => {
        closeConfirmDialog();
        setActionLoading(`paired-${gameA.rowNumber}-${gameB.rowNumber}`);
        try {
          // Open the first; if it fails (e.g. the section-mismatch trap) stop so the
          // captain only sees one error rather than two.
          const a = await changeStatus(gameA.tabName, 'open', undefined, gameA.rowNumber);
          if (!a.success) return;
          await changeStatus(gameB.tabName, 'open', undefined, gameB.rowNumber);
        } finally {
          setActionLoading(null);
        }
      },
    });
  }

  /**
   * Handle backward status step (revert to previous state)
   * O → '' (Open → Upcoming), X → O (Selecting → Open), S → X (Selected → Selecting)
   */
  function handleRevertGame(game: Game, action: string, fromLabel: string, toLabel: string) {
    setConfirmDialog({
      isOpen: true,
      title: 'Revert Game Status',
      message: `Revert from ${fromLabel} back to ${toLabel}?`,
      game,
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(game.tabName, action, undefined, game.rowNumber);
      },
    });
  }

  /**
   * Handle Close Game button click — shows instructions dialog first
   */
  function handleCloseGame(game: Game) {
    openInstructionsDialog(game, 'close');
  }

  /**
   * Handle Close for paired games — closes both games O → X (Selecting).
   * Everyone entered into game 1; the captain moves overflow players into game 2
   * during selection (no allocation step).
   */
  function handleClosePairedGames(gameA: Game, gameB: Game) {
    setConfirmDialog({
      isOpen: true,
      title: 'Close Games',
      message: `Close entries for ${gameA.clubName} and ${gameB.clubName}? Everyone is entered into the first game — you can move players across to the second game during selection.`,
      onConfirm: async () => {
        closeConfirmDialog();
        const pairKey = `paired-${gameA.rowNumber}-${gameB.rowNumber}`;
        setActionLoading(pairKey);
        try {
          // Close game A (O → X)
          const resA = await fetch('/api/friendlies/manage/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: gameA.tabName, row_number: gameA.rowNumber, action: 'close' }),
          });
          if (!resA.ok) {
            const data = await resA.json();
            alert(data.error || 'Failed to close first game');
            return;
          }

          // Close game B (O → X)
          const resB = await fetch('/api/friendlies/manage/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: gameB.tabName, row_number: gameB.rowNumber, action: 'close' }),
          });
          if (!resB.ok) {
            const data = await resB.json();
            alert(data.error || 'Failed to close second game');
            return;
          }

          // Both are now Selecting — refresh the list
          await fetchGames();
        } catch (error) {
          console.error('Error closing paired games:', error);
          alert('Failed to close paired games');
        } finally {
          setActionLoading(null);
        }
      },
    });
  }

  /**
   * Open the instructions dialog in a given mode for a game
   */
  function openInstructionsDialog(game: Game, mode: InstructionsDialogMode, afterConfirm?: () => void) {
    setInstructionsDialog({ isOpen: true, mode, game, afterConfirm });
  }

  /**
   * Called when the instructions dialog completes its action
   */
  async function handleInstructionsConfirm() {
    const key = instructionsDialog.game?.tabName;
    const after = instructionsDialog.afterConfirm;
    setInstructionsDialog({ isOpen: false, mode: 'open', game: null });
    if (key) {
      setActionSelections(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
    if (after) {
      after();
    } else {
      await fetchGames();
    }
  }

  /**
   * Handle game outcome button click (Mark Played, Cancel, Abandon)
   * Opens the outcome dialog for entering game result details
   */
  function handleGameOutcome(tabName: string, gameStatus: string, homeAway = '', entered = 0) {
    // For non-selected games, auto-select Cancel since it's the only option
    const autoStatus = gameStatus !== 'S' ? 'C' : '';

    setOutcomeDialog({
      isOpen: true,
      tabName,
      gameStatus,
      homeAway,
      entered,
      status: autoStatus as 'P' | 'C' | 'A' | '',
      bhbcScore: '',
      opponentScore: '',
      noScore: false,
      reason: '',
      who: '',
      sendEmail: false,
      sendTeaRotaEmail: false,
      isSubmitting: false,
      result: null,
    });
  }

  /**
   * Submit game outcome from the dialog
   */
  async function submitOutcome() {
    const { tabName, status, bhbcScore, opponentScore, noScore, reason, who, sendEmail, sendTeaRotaEmail } = outcomeDialog;

    // Show loading state — keep dialog open while the API call runs
    setOutcomeDialog(prev => ({ ...prev, isSubmitting: true }));

    let result: { success: boolean; data?: Record<string, unknown> } = { success: false };
    if (status === 'P') {
      // A no-score game (e.g. a reserve team, BH vs BH) records a reason instead of scores
      if (noScore) {
        result = await changeStatus(tabName, 'played', {
          no_score: true,
          reason,
        });
      } else {
        result = await changeStatus(tabName, 'played', {
          bhbc_score: parseInt(bhbcScore),
          opponent_score: parseInt(opponentScore),
        });
      }
    } else if (status === 'C') {
      result = await changeStatus(tabName, 'cancel', {
        reason,
        who,
        send_email: sendEmail,
        send_tea_rota_email: sendTeaRotaEmail,
      });
    } else if (status === 'A') {
      result = await changeStatus(tabName, 'abandon', {
        bhbc_score: parseInt(bhbcScore),
        opponent_score: parseInt(opponentScore),
        reason,
        who,
      });
    }

    if (result.success) {
      const d = result.data || {};
      setOutcomeDialog(prev => ({
        ...prev,
        isSubmitting: false,
        result: {
          emailsSent: d.emails_sent as number | undefined,
          playersWithoutEmail: d.players_without_email as string[] | undefined,
          emailError: d.email_error as string | undefined,
          teaRotaEmailsSent: d.tea_rota_emails_sent as number | undefined,
          teaRotaMembersWithoutEmail: d.tea_rota_members_without_email as string[] | undefined,
          teaRotaEmailError: d.tea_rota_email_error as string | undefined,
        },
      }));
    } else {
      // Error already shown via alert — clear loading state so user can retry or dismiss
      setOutcomeDialog(prev => ({ ...prev, isSubmitting: false }));
    }
  }

  /**
   * Check if outcome dialog can be submitted
   */
  function canSubmitOutcome(): boolean {
    const { status, bhbcScore, opponentScore, noScore, reason, who } = outcomeDialog;

    if (!status) return false;

    if (status === 'P') {
      // Played: need both scores, unless "no score" is chosen (then need a reason)
      if (noScore) return reason.trim() !== '';
      return bhbcScore !== '' && opponentScore !== '';
    } else if (status === 'C') {
      // Cancelled: need reason and who
      return reason !== '' && who !== '';
    } else if (status === 'A') {
      // Abandoned: need scores, reason, and who
      return bhbcScore !== '' && opponentScore !== '' && reason !== '' && who !== '';
    }

    return false;
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Parse the number of players required from a format string.
   * e.g. "4 Triples" → 12, "5 Pairs" → 10, "4 Fours" → 16, "6 Singles" → 6
   */
  function parseNumberRequired(format: string): number | null {
    if (!format) return null;
    const sizeMap: Record<string, number> = {
      singles: 1, single: 1,
      pairs: 2, pair: 2,
      triples: 3, triple: 3,
      fours: 4, four: 4, rinks: 4, rink: 4,
      fives: 5, five: 5,
    };
    // Support compound formats e.g. "3 Triples, 4 Rinks"
    const parts = format.split(',').map(s => s.trim());
    let total = 0;
    for (const part of parts) {
      const match = part.match(/^(\d+)\s+(\w+)$/i);
      if (!match) return null;
      const count = parseInt(match[1], 10);
      const size = sizeMap[match[2].toLowerCase()];
      if (!size) return null;
      total += count * size;
    }
    return total > 0 ? total : null;
  }

  /**
   * Parse DD/MM/YYYY date string to Date object
   * Google Sheets dates come in DD/MM/YYYY format which JavaScript doesn't parse correctly
   * @param dateStr Date string in DD/MM/YYYY format (e.g., "27/09/2025")
   * @returns Date object or null if invalid
   */
  // ============================================================================
  // Dropdown Action Helpers
  // ============================================================================

  /** Returns the list of options for the per-row action dropdown */
  function getDefaultAction(game: Game): string {
    switch (game.status) {
      case '':  return 'open';
      case 'O': return 'close-select';
      case 'X': return 'select-team';
      case 'S': return 'record-result';
      case 'P':
      case 'C':
      case 'A': return 'revert-to-selected';
      default:  return '';
    }
  }

  function getActionOptions(game: Game, isLastManaged: boolean): { value: string; label: string }[] {
    switch (game.status) {
      case '':
        return [
          { value: 'open',   label: 'Open' },
          { value: 'cancel', label: 'Cancel Game' },
        ];
      case 'O': {
        const openOptions: { value: string; label: string }[] = [
          { value: 'close-select', label: 'Close & Select' },
          { value: 'close',        label: 'Close' },
          { value: 'players',      label: 'Add Players' },
          { value: 'reopen',       label: '← Upcoming' },
          { value: 'cancel',       label: 'Cancel Game' },
        ];
        if (game.needsPlayers) {
          openOptions.push({ value: 'unflag-needs-players', label: '✕ Remove Players Flag' });
        } else {
          openOptions.push({ value: 'flag-needs-players', label: '🟠 Flag: Players Needed' });
        }
        return openOptions;
      }
      case 'X':
        return [
          { value: 'select-team', label: isLastManaged ? 'Resume' : 'Select Team' },
          { value: 'publish',     label: 'Publish' },
          { value: 'players',     label: 'Add Players' },
          { value: 'reopen-entries', label: '← Open' },
          { value: 'cancel',      label: 'Cancel Game' },
        ];
      case 'S':
        return [
          { value: 'edit',          label: isLastManaged ? 'Resume' : 'Edit Selection' },
          { value: 'record-result', label: 'Record Result' },
          { value: 'players',       label: 'Add Players' },
          { value: 'unpublish', label: '← Selecting' },
          { value: 'cancel',    label: 'Cancel Game' },
        ];
      case 'P':
      case 'C':
      case 'A':
        return [
          { value: 'revert-to-selected', label: '← Set to Selected' },
        ];
      default:
        return [];
    }
  }

  /** Execute the selected action for a game row */
  async function handleGoAction(game: Game) {
    const action = actionSelections[game.tabName] ?? getDefaultAction(game);
    if (!action) return;

    switch (action) {
      case 'open':
        handleOpenGame(game);
        break;
      case 'close':
        handleCloseGame(game);
        break;
      case 'close-select':
        openInstructionsDialog(game, 'close', () => {
          sessionStorage.setItem('friendlies_last_managed', game.tabName);
          router.push(`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`);
        });
        break;
      case 'select-team':
      case 'edit': {
        // Check live lock status from server (client state may be stale)
        const navigate = () => {
          sessionStorage.setItem('friendlies_last_managed', game.tabName);
          router.push(`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`);
        };
        try {
          const lockRes = await fetch(`/api/friendlies/manage/lock?tab_name=${encodeURIComponent(game.tabName)}`);
          if (lockRes.ok) {
            const lockData = await lockRes.json();
            if (lockData.lockedBy && lockData.lockedBy !== session?.user?.userName) {
              setManageLockDialog({
                lockedBy: lockData.lockedBy,
                lockedAt: lockData.lockedAt || '',
                onProceed: () => { setManageLockDialog(null); navigate(); },
              });
              return;
            }
          }
        } catch {
          // If the check fails, navigate anyway — selection page will catch it
        }
        navigate();
        break;
      }
      case 'publish':
        openInstructionsDialog(game, 'publish');
        break;
      case 'players':
        setAddPlayersModal({ isOpen: true, game });
        break;
      case 'record-result':
      case 'cancel':
        handleGameOutcome(game.tabName, game.status, game.homeAway, game.entered);
        break;
      case 'reopen':
        handleRevertGame(game, 'reopen', 'Open', 'Upcoming');
        break;
      case 'reopen-entries':
        handleRevertGame(game, 'reopen-entries', 'Selecting', 'Open');
        break;
      case 'unpublish':
        handleRevertGame(game, 'unpublish', 'Published', 'Selecting');
        break;
      case 'revert-to-selected': {
        const fromLabel = game.status === 'P' ? 'Played' : game.status === 'C' ? 'Cancelled' : 'Abandoned';
        handleRevertGame(game, 'revert-to-selected', fromLabel, 'Selected');
        break;
      }
      case 'flag-needs-players':
      case 'unflag-needs-players':
        await changeStatus(game.tabName, action, undefined, game.rowNumber);
        break;
    }
  }

  function parseDDMMYYYY(dateStr: string): Date | null {
    if (!dateStr) return null;

    const parts = dateStr.split('/');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1; // JavaScript months are 0-indexed
    const year = parseInt(parts[2]);

    return new Date(year, month, day);
  }

  // ============================================================================
  // Filtering and Display Logic
  // ============================================================================

  /**
   * Filter games based on selected filter tab
   * Returns subset of games that match current filter
   */
  const filteredGames = games.filter(game => {
    if (filter === 'all')       return true;
    if (filter === 'upcoming')  return game.status === '';
    if (filter === 'open')      return game.status === 'O';
    if (filter === 'selecting') return ['X', 'S'].includes(game.status);
    if (filter === 'played')    return ['P', 'C', 'A'].includes(game.status);
    return true;
  }).sort((a, b) => {
    // Sort by date (ascending) - earliest dates first
    const parseDate = (dateStr: string) => {
      if (!dateStr) return new Date(0);

      // Try format: "Day, DD Month" (e.g., "Sun, 26 April")
      const dayMonthMatch = dateStr.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{1,2})\s+(\w+)/i);
      if (dayMonthMatch) {
        const day = parseInt(dayMonthMatch[1], 10);
        const monthName = dayMonthMatch[2];
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const monthIndex = monthNames.findIndex(m => m.startsWith(monthName.toLowerCase()));

        if (monthIndex === -1) return new Date(0);

        // Determine year based on current month
        const now = new Date();
        const currentMonth = now.getMonth();
        let year = now.getFullYear();

        // If the month has passed, assume next year
        if (monthIndex < currentMonth - 1) {
          year++;
        }

        return new Date(year, monthIndex, day);
      }

      // Try format: "DD/MM/YYYY" or "DD/MM/YY"
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        let year = parseInt(parts[2], 10);

        // Handle 2-digit years: if year < 100, assume 20xx
        if (year < 100) {
          year += 2000;
        }

        if (isNaN(day) || isNaN(month) || isNaN(year)) return new Date(0);
        return new Date(year, month - 1, day);
      }

      return new Date(0);
    };

    const dateA = parseDate(a.date);
    const dateB = parseDate(b.date);

    // Ascending order: earlier dates first
    return dateA.getTime() - dateB.getTime();
  });

  /**
   * Get status badge component for a game
   * Returns colored badge with label based on game status
   * @param status Game status code
   * @returns JSX element with colored badge
   */
  const getStatusBadge = (status: GameStatus) => {
    // Define badge labels and colors for each status
    const badges: { [key in GameStatus]: { label: string; color: string } } = {
      '': { label: 'Upcoming', color: 'bg-gray-500' },      // Blank = Not opened yet
      'O': { label: 'Open', color: 'bg-green-500' },        // Open for entries
      'X': { label: 'Selecting', color: 'bg-yellow-500' },  // Captain selecting team
      'S': { label: 'Selected', color: 'bg-blue-500' },     // Team selected
      'P': { label: 'Played', color: 'bg-purple-500' },     // Game completed
      'C': { label: 'Cancelled', color: 'bg-red-500' },     // Game cancelled
      'A': { label: 'Abandoned', color: 'bg-orange-500' },  // Game abandoned
    };

    // Get badge config for this status, default to gray if unknown
    const badge = badges[status] || { label: status || 'Unknown', color: 'bg-gray-500' };

    // Return badge component
    return (
      <span className={`inline-block px-2 py-1 text-xs font-semibold text-white rounded ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation bar */}
      <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />

      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Page header with title and link to player view */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold text-gray-900">Manage Friendly Matches</h1>
            <button
              onClick={handleReload}
              disabled={reloading || loading}
              title="Reload games"
              className="text-gray-500 hover:text-blue-600 disabled:opacity-40 transition-colors"
            >
              <svg
                className={`w-5 h-5 ${reloading ? 'animate-spin' : ''}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>

          {/* Link to player view of friendlies */}
          <Link
            href="/friendlies"
            className={getButtonClasses('secondary', 'md')}
          >
            Player View
          </Link>
        </div>

        {/* View switcher: Games | Player Stats */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setManageView('games'); sessionStorage.setItem('friendlies_manage_view', 'games'); }}
            className={`px-4 py-2 rounded font-medium text-sm transition-colors ${
              manageView === 'games'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Games
          </button>
          <button
            onClick={() => {
              setManageView('stats');
              sessionStorage.setItem('friendlies_manage_view', 'stats');
              if (!playerStats) fetchPlayerStats();
            }}
            className={`px-4 py-2 rounded font-medium text-sm transition-colors ${
              manageView === 'stats'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Player Stats
          </button>
        </div>

        {/* Filter tabs - allow captain to filter by game status (games view only) */}
        {manageView === 'games' && (
        <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
          {([
            { value: 'all',       label: 'All' },
            { value: 'upcoming',  label: 'Upcoming' },
            { value: 'open',      label: 'Open' },
            { value: 'selecting', label: 'Selecting' },
            { value: 'played',    label: 'Played' },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setFilter(value); sessionStorage.setItem('friendlies_manage_filter', value); }}
              className={`px-4 py-2 font-medium border-b-2 whitespace-nowrap ${
                filter === value
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        )}

        {/* ── Player Stats view ──────────────────────────────────────────── */}
        {manageView === 'stats' && (() => {
          if (playerStatsLoading) {
            return (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-700">Loading player stats...</p>
              </div>
            );
          }
          if (!playerStats) return null;

          // Sort helper
          const sortedStats = [...playerStats].sort((a, b) => {
            const aVal = a[statsSortCol];
            const bVal = b[statsSortCol];
            if (typeof aVal === 'string' && typeof bVal === 'string') {
              return statsSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            const diff = (aVal as number) - (bVal as number);
            return statsSortDir === 'asc' ? diff : -diff;
          });

          const handleSort = (col: keyof PlayerStatRow) => {
            if (statsSortCol === col) {
              setStatsSortDir(d => d === 'asc' ? 'desc' : 'asc');
            } else {
              setStatsSortCol(col);
              setStatsSortDir(col === 'fullName' ? 'asc' : 'desc');
            }
          };

          const SortIndicator = ({ col }: { col: keyof PlayerStatRow }) =>
            statsSortCol === col
              ? <span className="ml-1 text-xs">{statsSortDir === 'asc' ? '▲' : '▼'}</span>
              : <span className="ml-1 text-xs text-gray-300">⇅</span>;

          const cols: { key: keyof PlayerStatRow; label: string }[] = [
            { key: 'fullName',    label: 'Player' },
            { key: 'selected',    label: 'Selected' },
            { key: 'reserve',     label: 'Reserve' },
            { key: 'reserveTeam', label: 'Res. Team' },
            { key: 'opposition',  label: 'Opposition' },
            { key: 'withdrawn',   label: 'Withdrawn' },
            { key: 'cancelled',   label: 'Cancelled' },
            { key: 'abandoned',   label: 'Abandoned' },
            { key: 'entered',     label: 'Entered' },
            { key: 'total',       label: 'Total' },
          ];

          return (
            <div>
            <p className="text-sm text-gray-600 mb-3">
              {sortedStats.length} {sortedStats.length === 1 ? 'member has' : 'members have'} played at least one friendly.
            </p>
            <div className="bg-white rounded-lg shadow overflow-auto max-h-[70vh]">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    {cols.map(c => (
                      <th
                        key={c.key}
                        onClick={() => handleSort(c.key)}
                        className="px-3 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap bg-gray-50"
                      >
                        {c.label}<SortIndicator col={c.key} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {sortedStats.length === 0 ? (
                    <tr>
                      <td colSpan={cols.length} className="px-3 py-8 text-center text-gray-500">
                        No player data found.
                      </td>
                    </tr>
                  ) : sortedStats.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{p.fullName}</td>
                      <td className="px-3 py-2 text-gray-700">{p.selected || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.reserve || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.reserveTeam || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.opposition || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.withdrawn || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.cancelled || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.abandoned || '-'}</td>
                      <td className="px-3 py-2 text-gray-700">{p.entered || '-'}</td>
                      <td className="px-3 py-2 font-semibold text-gray-900">{p.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Not-played section */}
            {notPlayedStats !== null && (
              <div className="mt-4">
                <button
                  onClick={() => setShowNotPlayed(v => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
                >
                  <span>{showNotPlayed ? '▼' : '▶'}</span>
                  <span>
                    {notPlayedStats.length} playing {notPlayedStats.length === 1 ? 'member has' : 'members have'} not played any friendly
                  </span>
                </button>
                {showNotPlayed && (
                  <div className="mt-2 bg-white rounded-lg shadow border border-gray-200 p-4">
                    {notPlayedStats.length === 0 ? (
                      <p className="text-sm text-gray-500">All playing members have played at least one friendly.</p>
                    ) : (
                      <ul className="columns-2 sm:columns-3 lg:columns-4 gap-x-6 text-sm text-gray-700">
                        {notPlayedStats.map(m => (
                          <li key={m.userName} className="py-0.5">{m.fullName}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
          );
        })()}

        {/* Games table - show loading or table */}
        {manageView === 'games' && (loading ? (
          // Loading state - show spinner while fetching games
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-700">Loading games...</p>
          </div>
        ) : (
          // Games table - show all filtered games
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              {/* Table header */}
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Date/Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Club{filter === 'played' && <span className="normal-case font-normal text-gray-500"> / Score BH – Opp</span>}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Details
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Players
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-900 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>

              {/* Table body - list of games (with paired game grouping) */}
              <tbody className="bg-white divide-y divide-gray-200">
                {groupPairedGames(filteredGames).map((item, index) => {
                  // Paired game row — combined view for Upcoming/Open status
                  if (isPairedGame(item)) {
                    const [gameA, gameB] = item;
                    const pairKey = `paired-${gameA.rowNumber}-${gameB.rowNumber}`;
                    const combinedEntered = Math.max(gameA.entered, gameB.entered);
                    const isPairLoading = actionLoading === pairKey;

                    return (
                      <tr
                        key={pairKey}
                        className={`bg-purple-50 text-gray-900 ${isPairLoading ? 'opacity-50' : ''}`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>{parseDDMMYYYY(gameA.date)?.toLocaleDateString('en-GB') || gameA.date}</div>
                          <div className="text-gray-700">{gameA.time}</div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          <div>{gameA.clubName}{gameA.clubName !== gameB.clubName ? ` + ${gameB.clubName}` : ''}</div>
                          <span className="inline-block mt-1 px-2 py-0.5 text-xs font-medium text-purple-700 bg-purple-100 rounded">
                            {gameA.ladiesMen} + {gameB.ladiesMen}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>
                            {gameA.homeAway === gameB.homeAway
                              ? (gameA.homeAway === 'H' ? 'Home' : 'Away')
                              : `${gameA.homeAway === 'H' ? 'Home' : 'Away'} / ${gameB.homeAway === 'H' ? 'Home' : 'Away'}`
                            }
                          </div>
                          <div className="text-gray-700">{gameA.format} / {gameB.format}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(gameA.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>Entered: {combinedEntered}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                          {gameA.status === '' && (
                            <button
                              onClick={() => handleOpenPairedGames(gameA, gameB)}
                              disabled={isPairLoading}
                              className="text-green-600 hover:text-green-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Open Both
                            </button>
                          )}
                          {gameA.status === 'O' && (
                            <button
                              onClick={() => handleClosePairedGames(gameA, gameB)}
                              disabled={isPairLoading}
                              className="text-yellow-600 hover:text-yellow-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Close
                            </button>
                          )}
                          {['', 'O'].includes(gameA.status) && (
                            <button
                              onClick={() => handleGameOutcome(gameA.tabName, gameA.status, gameA.homeAway, gameA.entered)}
                              disabled={isPairLoading}
                              className="text-red-600 hover:text-red-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }

                  // Standard single game row
                  const game = item as Game;
                  // Task F: highlight the last game the captain was managing (stored in sessionStorage)
                  const lastManaged = typeof window !== 'undefined' ? sessionStorage.getItem('friendlies_last_managed') : null;
                  const isLastManaged = lastManaged === game.tabName;
                  // Number of players required from format string (for counts column)
                  const numberRequired = parseNumberRequired(game.format);
                  return (
                    <tr
                      key={game.tabName && game.tabName.trim() ? game.tabName : `${game.date}-${game.clubName}-${game.time}-${index}`}
                      className={`${actionLoading === game.tabName ? 'opacity-50' : ''} ${isLastManaged ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : ''}`}
                    >
                      {/* Date and time column */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>{parseDDMMYYYY(game.date)?.toLocaleDateString('en-GB') || game.date}</div>
                        <div className="text-gray-700">{game.time}</div>
                      </td>

                      {/* Club name column */}
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-1.5">
                          {game.clubName}
                          {game.needsPlayers && <span title="Players needed">🟠</span>}
                        </div>
                        {filter === 'played' && game.status === 'P' && game.bhbcScore !== null && game.opponentScore !== null && (
                          <div className="text-xs text-gray-500 font-normal mt-0.5">
                            {game.bhbcScore} – {game.opponentScore}
                          </div>
                        )}
                        {filter === 'played' && (game.status === 'C' || game.status === 'A') && (
                          <div className="text-xs text-gray-500 font-normal mt-0.5 space-y-0.5">
                            {game.status === 'A' && game.bhbcScore !== null && game.opponentScore !== null && (
                              <div>{game.bhbcScore} – {game.opponentScore}</div>
                            )}
                            {game.who && <div>By: {game.who}</div>}
                            {game.reason && <div>Reason: {game.reason}</div>}
                          </div>
                        )}
                      </td>

                      {/* Game details column (venue and format) */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>{game.homeAway === 'H' ? 'Home' : 'Away'}</div>
                        <div className="text-gray-700">{game.format}</div>
                      </td>

                      {/* Status badge column */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(game.status)}
                      </td>

                      {/* Player counts column */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          Entered: {game.entered}
                          {numberRequired != null && (
                            <span className="ml-1 text-gray-500">/ {numberRequired} req</span>
                          )}
                        </div>
                      </td>

                      {/* Actions column — single dropdown + Go */}
                      <td className="px-6 py-4 text-sm">
                        {(() => {
                          const opts = getActionOptions(game, isLastManaged);
                          if (opts.length === 0) return null;
                          const selected = actionSelections[game.tabName] ?? getDefaultAction(game);
                          return (
                            <div className="flex items-center gap-1.5">
                              <select
                                value={selected}
                                onChange={e =>
                                  setActionSelections(prev => ({ ...prev, [game.tabName]: e.target.value }))
                                }
                                className="text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-700 bg-white min-w-[148px] focus:outline-none focus:ring-1 focus:ring-blue-400"
                              >
                                <option value="" disabled>Action…</option>
                                {opts.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleGoAction(game)}
                                disabled={!selected || actionLoading === game.tabName || actionLoading === `row-${game.rowNumber}`}
                                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                Go
                              </button>
                            </div>
                          );
                        })()}
                        {isLastManaged && (
                          <span className="mt-1 block text-xs text-blue-600 font-medium">● Resume</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Game Instructions Dialog — open, close, publish, and editor instructions */}
      {instructionsDialog.isOpen && instructionsDialog.game && (
        <GameInstructionsDialog
          isOpen={instructionsDialog.isOpen}
          mode={instructionsDialog.mode}
          game={{
            tabName: instructionsDialog.game.tabName,
            rowNumber: instructionsDialog.game.rowNumber,
            clubName: instructionsDialog.game.clubName,
            date: instructionsDialog.game.date,
            time: instructionsDialog.game.time,
            format: instructionsDialog.game.format,
            homeAway: instructionsDialog.game.homeAway,
            specialInstructions: instructionsDialog.game.specialInstructions,
            pickupInfo: instructionsDialog.game.pickupInfo,
            status: instructionsDialog.game.status,
          }}
          onConfirm={handleInstructionsConfirm}
          onCancel={() => setInstructionsDialog({ isOpen: false, mode: 'open', game: null })}
        />
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      >
        {confirmDialog.game && (() => {
          const g = confirmDialog.game!;
          const d = parseDDMMYYYY(g.date);
          const displayDate = d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : g.date;
          return (
            <div className="bg-gray-50 rounded-lg px-4 py-3 mb-6 text-sm text-gray-700 space-y-1">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="font-medium text-gray-900">Club:</span> {g.clubName}{g.clubSuffix ? ` ${g.clubSuffix}` : ''}</span>
                <span><span className="font-medium text-gray-900">Date:</span> {displayDate}</span>
                <span><span className="font-medium text-gray-900">Time:</span> {g.time}</span>
                <span><span className="font-medium text-gray-900">Venue:</span> {g.homeAway === 'H' ? 'Home' : 'Away'}</span>
                {g.format && <span><span className="font-medium text-gray-900">Format:</span> {g.format}</span>}
              </div>
            </div>
          );
        })()}
      </ConfirmDialog>

      {/* Game Outcome Dialog for Played/Cancelled/Abandoned */}
      {outcomeDialog.isOpen && (
        <>
          {/* Backdrop — not dismissible while submitting or showing result */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => !outcomeDialog.isSubmitting && !outcomeDialog.result && setOutcomeDialog({ ...outcomeDialog, isOpen: false })}
          />

          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">

              {/* ── Result screen (shown after successful save) ── */}
              {outcomeDialog.result ? (
                <>
                  <h2 className="text-xl font-bold mb-4 text-gray-900">
                    {outcomeDialog.status === 'P' ? 'Game Recorded as Played' :
                     outcomeDialog.status === 'C' ? 'Game Cancelled' :
                     'Game Recorded as Abandoned'}
                  </h2>
                  <div className="space-y-3">
                    {/* Confirmation row */}
                    <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                      <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>
                        {outcomeDialog.status === 'P'
                          ? (outcomeDialog.noScore
                              ? `No score — ${outcomeDialog.reason}`
                              : `Score: BHBC ${outcomeDialog.bhbcScore} – ${outcomeDialog.opponentScore}`) :
                         outcomeDialog.status === 'C' ? `Cancelled by ${outcomeDialog.who} — ${outcomeDialog.reason}` :
                         `Abandoned — ${outcomeDialog.reason}`}
                      </span>
                    </div>
                    {/* Player emails */}
                    {outcomeDialog.result.emailsSent !== undefined && outcomeDialog.result.emailsSent > 0 && (
                      <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Cancellation email sent to {outcomeDialog.result.emailsSent} player{outcomeDialog.result.emailsSent !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {outcomeDialog.result.playersWithoutEmail && outcomeDialog.result.playersWithoutEmail.length > 0 && (
                      <div className="bg-yellow-50 p-3 rounded">
                        <p className="text-yellow-800 font-medium mb-1">
                          {outcomeDialog.result.playersWithoutEmail.length} player{outcomeDialog.result.playersWithoutEmail.length !== 1 ? 's' : ''} without email address:
                        </p>
                        <ul className="text-yellow-700 text-sm list-disc list-inside">
                          {outcomeDialog.result.playersWithoutEmail.map((name, i) => <li key={i}>{name}</li>)}
                        </ul>
                      </div>
                    )}
                    {outcomeDialog.result.emailError && (
                      <div className="bg-red-50 p-3 rounded text-red-700">
                        <p className="font-medium">Email error:</p>
                        <p className="text-sm">{outcomeDialog.result.emailError}</p>
                      </div>
                    )}
                    {/* Tea rota emails */}
                    {outcomeDialog.result.teaRotaEmailsSent !== undefined && outcomeDialog.result.teaRotaEmailsSent > 0 && (
                      <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                        <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Tea rota email sent to {outcomeDialog.result.teaRotaEmailsSent} member{outcomeDialog.result.teaRotaEmailsSent !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {outcomeDialog.result.teaRotaMembersWithoutEmail && outcomeDialog.result.teaRotaMembersWithoutEmail.length > 0 && (
                      <div className="bg-yellow-50 p-3 rounded">
                        <p className="text-yellow-800 font-medium mb-1">
                          {outcomeDialog.result.teaRotaMembersWithoutEmail.length} tea rota member{outcomeDialog.result.teaRotaMembersWithoutEmail.length !== 1 ? 's' : ''} without email:
                        </p>
                        <ul className="text-yellow-700 text-sm list-disc list-inside">
                          {outcomeDialog.result.teaRotaMembersWithoutEmail.map((name, i) => <li key={i}>{name}</li>)}
                        </ul>
                      </div>
                    )}
                    {outcomeDialog.result.teaRotaEmailError && (
                      <div className="bg-red-50 p-3 rounded text-red-700">
                        <p className="font-medium">Tea rota email error:</p>
                        <p className="text-sm">{outcomeDialog.result.teaRotaEmailError}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-end mt-6">
                    <button
                      onClick={() => setOutcomeDialog({ ...outcomeDialog, isOpen: false, result: null })}
                      className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700"
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                /* ── Entry form ── */
                <>
                  <h2 className="text-xl font-bold mb-4 text-gray-900">
                    {outcomeDialog.gameStatus === 'S' ? 'Record Game Outcome' : 'Cancel Game'}
                  </h2>

                  <div className="space-y-4">
                    {/* Status Selection - only show for Selected games (has multiple options) */}
                    {outcomeDialog.gameStatus === 'S' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          What happened?
                        </label>
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={() => setOutcomeDialog({ ...outcomeDialog, status: 'P' })}
                            className={`flex-1 px-4 py-3 rounded-lg font-medium shadow-sm transition-all ${
                              outcomeDialog.status === 'P'
                                ? 'bg-green-600 text-white ring-2 ring-green-600 ring-offset-2'
                                : 'bg-white text-gray-700 border-2 border-gray-200 hover:border-green-400 hover:bg-green-50'
                            }`}
                          >
                            Played
                          </button>
                          <button
                            type="button"
                            onClick={() => setOutcomeDialog({ ...outcomeDialog, status: 'C' })}
                            className={`flex-1 px-4 py-3 rounded-lg font-medium shadow-sm transition-all ${
                              outcomeDialog.status === 'C'
                                ? 'bg-red-600 text-white ring-2 ring-red-600 ring-offset-2'
                                : 'bg-white text-gray-700 border-2 border-gray-200 hover:border-red-400 hover:bg-red-50'
                            }`}
                          >
                            Cancelled
                          </button>
                          <button
                            type="button"
                            onClick={() => setOutcomeDialog({ ...outcomeDialog, status: 'A' })}
                            className={`flex-1 px-4 py-3 rounded-lg font-medium shadow-sm transition-all ${
                              outcomeDialog.status === 'A'
                                ? 'bg-orange-600 text-white ring-2 ring-orange-600 ring-offset-2'
                                : 'bg-white text-gray-700 border-2 border-gray-200 hover:border-orange-400 hover:bg-orange-50'
                            }`}
                          >
                            Abandoned
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Scores - show for Played or Abandoned */}
                    {/* No-score option — e.g. a reserve team (Burgess Hill vs Burgess Hill) */}
                    {outcomeDialog.status === 'P' && (
                      <label className="flex items-center gap-2 text-sm text-gray-900">
                        <input
                          type="checkbox"
                          checked={outcomeDialog.noScore}
                          onChange={(e) => setOutcomeDialog({
                            ...outcomeDialog,
                            noScore: e.target.checked,
                            // Default the reason to "Reserve Team" the first time it's ticked
                            reason: e.target.checked && !outcomeDialog.reason ? 'Reserve Team' : outcomeDialog.reason,
                          })}
                          className="w-4 h-4"
                        />
                        No score (e.g. reserve team)
                      </label>
                    )}

                    {/* Scores — for Abandoned, and for Played unless "no score" is ticked */}
                    {(outcomeDialog.status === 'A' || (outcomeDialog.status === 'P' && !outcomeDialog.noScore)) && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Burgess Hill Score</label>
                          <input
                            type="number"
                            min="0"
                            value={outcomeDialog.bhbcScore}
                            onChange={(e) => setOutcomeDialog({ ...outcomeDialog, bhbcScore: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Opponent Score</label>
                          <input
                            type="number"
                            min="0"
                            value={outcomeDialog.opponentScore}
                            onChange={(e) => setOutcomeDialog({ ...outcomeDialog, opponentScore: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </>
                    )}

                    {/* Reason — for a no-score Played game (defaults to "Reserve Team") */}
                    {outcomeDialog.status === 'P' && outcomeDialog.noScore && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                        <input
                          type="text"
                          value={outcomeDialog.reason}
                          onChange={(e) => setOutcomeDialog({ ...outcomeDialog, reason: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Reserve Team"
                          maxLength={100}
                        />
                      </div>
                    )}

                    {/* Reason and Who - show for Cancelled or Abandoned */}
                    {(outcomeDialog.status === 'C' || outcomeDialog.status === 'A') && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                          <input
                            type="text"
                            value={outcomeDialog.reason}
                            onChange={(e) => setOutcomeDialog({ ...outcomeDialog, reason: e.target.value })}
                            placeholder="e.g., Weather, Insufficient players"
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Who {outcomeDialog.status === 'C' ? 'Cancelled' : 'Abandoned'}?
                          </label>
                          <select
                            value={outcomeDialog.who}
                            onChange={(e) => setOutcomeDialog({ ...outcomeDialog, who: e.target.value as 'Burgess Hill' | 'Opponent' | '' })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">Select...</option>
                            <option value="Burgess Hill">Burgess Hill</option>
                            <option value="Opponent">Opponent</option>
                          </select>
                        </div>

                        {/* Email options — only for Cancelled games with entered players */}
                        {outcomeDialog.status === 'C' && outcomeDialog.entered > 0 && (
                          <div className="border-t border-gray-200 pt-3 space-y-2">
                            <p className="text-sm font-medium text-gray-700">Notify by email</p>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={outcomeDialog.sendEmail}
                                onChange={(e) => setOutcomeDialog({ ...outcomeDialog, sendEmail: e.target.checked })}
                                className="rounded border-gray-300 text-blue-600"
                              />
                              <span className="text-sm text-gray-700">
                                Email all entered players ({outcomeDialog.entered})
                                <span className="text-gray-500"> — includes calendar cancellation</span>
                              </span>
                            </label>
                            {outcomeDialog.homeAway === 'H' && (
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={outcomeDialog.sendTeaRotaEmail}
                                  onChange={(e) => setOutcomeDialog({ ...outcomeDialog, sendTeaRotaEmail: e.target.checked })}
                                  className="rounded border-gray-300 text-blue-600"
                                />
                                <span className="text-sm text-gray-700">Email tea rota members</span>
                              </label>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      onClick={() => setOutcomeDialog({ ...outcomeDialog, isOpen: false })}
                      disabled={outcomeDialog.isSubmitting}
                      className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitOutcome}
                      disabled={!canSubmitOutcome() || outcomeDialog.isSubmitting}
                      className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {outcomeDialog.isSubmitting && (
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      {outcomeDialog.isSubmitting ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add Players Modal — shows all entered players, allows adding/removing */}
      {addPlayersModal.game && (
        <EnteredPlayersModal
          isOpen={addPlayersModal.isOpen}
          onClose={() => setAddPlayersModal({ isOpen: false, game: null })}
          gameId={addPlayersModal.game.tabName}
          gameType="friendlies"
          gameName={`${addPlayersModal.game.clubName} — ${addPlayersModal.game.date}`}
          currentUserRole={session?.user.role}
          onPlayersChanged={fetchGames}
        />
      )}

      {/* Selection Lock Warning Dialog — shown when navigating to a game locked by another captain */}
      {manageLockDialog && (
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
                <span className="font-medium text-gray-900">{manageLockDialog.lockedBy}</span> is currently editing the team selection for this game
                {manageLockDialog.lockedAt ? (() => {
                  const d = new Date(manageLockDialog.lockedAt);
                  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                  return <> since {date} at {time}</>;
                })() : null}.
              </p>
              <p className="text-sm text-gray-500 text-center mb-6">
                You can continue to the page, but be aware that editing may conflict with their changes.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setManageLockDialog(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={manageLockDialog.onProceed}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded hover:bg-amber-700"
                >
                  Continue Anyway
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
