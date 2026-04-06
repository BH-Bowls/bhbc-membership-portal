// app/friendlies/manage/page.tsx
// Captain Management Home - list of all games with status management
// Captains can open/close games, publish selections, mark as played, and cancel games
// Shows table view with game details, player counts, and available actions based on status

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Game, GameStatus } from '@/lib/types/friendlies';
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

  // State: Current filter selection (all or specific status)
  const [filter, setFilter] = useState<'all' | GameStatus>('all');

  // State: Loading indicator while fetching games
  const [loading, setLoading] = useState(true);

  // State: Action loading indicator (stores tabName of game being updated)
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  // State: Game outcome dialog for Played/Cancelled/Abandoned
  const [outcomeDialog, setOutcomeDialog] = useState<{
    isOpen: boolean;
    tabName: string;
    gameStatus: string;  // Current game status to determine available options
    status: 'P' | 'C' | 'A' | '';  // Played, Cancelled, Abandoned
    bhbcScore: string;
    opponentScore: string;
    reason: string;
    who: 'Burgess Hill' | 'Opponent' | '';
  }>({
    isOpen: false,
    tabName: '',
    gameStatus: '',
    status: '',
    bhbcScore: '',
    opponentScore: '',
    reason: '',
    who: '',
  });

  // State: Message dialog for editing special instructions
  const [messageDialog, setMessageDialog] = useState<{
    isOpen: boolean;
    tabName: string;
    rowNumber: number;
    draft: string;
    saving: boolean;
  }>({ isOpen: false, tabName: '', rowNumber: 0, draft: '', saving: false });

  // State: Publish dialog for publishing team selection
  const [publishDialog, setPublishDialog] = useState<{
    isOpen: boolean;
    tabName: string;
    isHomeGame: boolean;
    sendEmail: boolean;
    sendTeaRotaEmail: boolean;
    submitting: boolean;
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
    isHomeGame: false,
    sendEmail: false,
    sendTeaRotaEmail: false,
    submitting: false,
    result: null,
  });

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch games when page loads
   * Runs once on component mount
   */
  useEffect(() => {
    // Fetch all games from API
    fetchGames();
  }, []);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch all games from captain management API
   * Gets games with entry and selection counts
   */
  async function fetchGames() {
    // Show loading spinner
    setLoading(true);

    try {
      // Call captain management API to get all games
      const response = await fetch('/api/friendlies/manage/games');
      const data = await response.json();

      // Check if request was successful
      if (response.ok) {
        // Update games list
        setGames(data.games);
      } else {
        // Show error alert
        alert(data.error || 'Failed to load games');
      }
    } catch (error) {
      // Network or other error
      console.error('Error fetching games:', error);
      alert('Failed to load games');
    } finally {
      // Hide loading spinner
      setLoading(false);
    }
  }

  /**
   * Change game status via API
   * Generic function for all status changes (open, close, publish, etc.)
   * @param tabName Game tab name identifier
   * @param action Action to perform (open, close, publish, played, cancel)
   * @param additionalData Optional data for action (e.g., scores for played)
   */
  async function changeStatus(tabName: string, action: string, additionalData?: any, rowNumber?: number) {
    // Show loading indicator for this specific game (use rowNumber as key if tabName is empty)
    setActionLoading(tabName || `row-${rowNumber}`);

    try {
      // Call status change API
      const response = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabName,
          row_number: rowNumber,
          action,
          ...additionalData,
        }),
      });

      const data = await response.json();

      // Check if status change was successful
      if (response.ok) {
        // Refresh games list to show updated status
        await fetchGames();
      } else {
        // Show error message
        alert(data.error || 'Failed to update status');
      }
    } catch (error) {
      // Network or other error
      console.error('Error changing status:', error);
      alert('Failed to update status');
    } finally {
      // Hide loading indicator
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
      onConfirm: () => {},
    });
  };

  /**
   * Handle Open Game button click
   * Changes status from blank to 'O' (Open)
   * Allows players to start entering the game
   */
  function handleOpenGame(tabName: string, rowNumber: number) {
    // Show confirmation dialog
    setConfirmDialog({
      isOpen: true,
      title: 'Open Game',
      message: 'Open this game for player entry?',
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(tabName, 'open', undefined, rowNumber);
      },
    });
  }

  /**
   * Handle Open for paired games - opens both games together
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
          await changeStatus(gameA.tabName, 'open', undefined, gameA.rowNumber);
          await changeStatus(gameB.tabName, 'open', undefined, gameB.rowNumber);
        } finally {
          setActionLoading(null);
        }
      },
    });
  }

  /**
   * Handle Close Game button click
   * Changes status from 'O' (Open) to 'X' (Selecting)
   * Closes entries and creates game sheet for team selection
   */
  function handleCloseGame(tabName: string, rowNumber: number) {
    // Show confirmation dialog
    setConfirmDialog({
      isOpen: true,
      title: 'Close Game',
      message: 'Close this game and create team selection sheet?',
      onConfirm: () => {
        closeConfirmDialog();
        changeStatus(tabName, 'close', undefined, rowNumber);
      },
    });
  }

  /**
   * Handle Close for paired games - transitions O → L (Allocating) and redirects to allocation
   * Game sheets are NOT created yet — allocation happens first, then sheets are created with only allocated players
   */
  function handleClosePairedGames(gameA: Game, gameB: Game) {
    setConfirmDialog({
      isOpen: true,
      title: 'Close & Allocate',
      message: `Close entries for ${gameA.clubName} and ${gameB.clubName} and allocate players between games?`,
      onConfirm: async () => {
        closeConfirmDialog();
        const pairKey = `paired-${gameA.rowNumber}-${gameB.rowNumber}`;
        setActionLoading(pairKey);
        try {
          // Set game A to Allocating (O → L)
          const resA = await fetch('/api/friendlies/manage/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: gameA.tabName, row_number: gameA.rowNumber, action: 'allocate' }),
          });
          if (!resA.ok) {
            const data = await resA.json();
            alert(data.error || 'Failed to close first game');
            return;
          }

          // Set game B to Allocating (O → L)
          const resB = await fetch('/api/friendlies/manage/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: gameB.tabName, row_number: gameB.rowNumber, action: 'allocate' }),
          });
          if (!resB.ok) {
            const data = await resB.json();
            alert(data.error || 'Failed to close second game');
            return;
          }

          // Redirect to allocation page using the shared date
          router.push(`/friendlies/manage/allocate/${encodeURIComponent(gameA.date)}`);
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
   * Handle Publish Selection button click
   * Opens the publish dialog with email option
   */
  function handlePublishSelection(game: Game) {
    setPublishDialog({
      isOpen: true,
      tabName: game.tabName,
      isHomeGame: game.homeAway === 'H',
      sendEmail: false,
      sendTeaRotaEmail: false,
      submitting: false,
      result: null,
    });
  }

  /**
   * Submit the publish action from the publish dialog
   */
  async function submitPublish() {
    const { tabName, sendEmail, sendTeaRotaEmail } = publishDialog;

    // Show submitting state
    setPublishDialog(prev => ({ ...prev, submitting: true }));

    try {
      const response = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: tabName,
          action: 'publish',
          send_email: sendEmail,
          send_tea_rota_email: sendTeaRotaEmail,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        const hasEmailResult = sendEmail && (data.emails_sent > 0 || data.players_without_email?.length > 0 || data.email_error);
        const hasTeaRotaResult = sendTeaRotaEmail && (data.tea_rota_emails_sent > 0 || data.tea_rota_members_without_email?.length > 0 || data.tea_rota_email_error);

        if (hasEmailResult || hasTeaRotaResult) {
          setPublishDialog(prev => ({
            ...prev,
            submitting: false,
            result: {
              emailsSent: data.emails_sent,
              playersWithoutEmail: data.players_without_email,
              emailError: data.email_error,
              teaRotaEmailsSent: data.tea_rota_emails_sent,
              teaRotaMembersWithoutEmail: data.tea_rota_members_without_email,
              teaRotaEmailError: data.tea_rota_email_error,
            },
          }));
        } else {
          // No email or no result to show - close dialog and refresh
          setPublishDialog(prev => ({ ...prev, isOpen: false }));
          await fetchGames();
        }
      } else {
        alert(data.error || 'Failed to publish selection');
        setPublishDialog(prev => ({ ...prev, submitting: false }));
      }
    } catch (error) {
      console.error('Error publishing selection:', error);
      alert('Failed to publish selection');
      setPublishDialog(prev => ({ ...prev, submitting: false }));
    }
  }

  /**
   * Close the publish dialog and refresh games
   */
  function closePublishDialog() {
    setPublishDialog({
      isOpen: false,
      tabName: '',
      isHomeGame: false,
      sendEmail: false,
      sendTeaRotaEmail: false,
      submitting: false,
      result: null,
    });
    fetchGames();
  }

  /**
   * Open message dialog for a game
   */
  function handleEditMessage(game: Game) {
    setMessageDialog({ isOpen: true, tabName: game.tabName, rowNumber: game.rowNumber, draft: game.message || '', saving: false });
  }

  /**
   * Save the special instructions message for a game
   */
  async function saveMessage() {
    setMessageDialog(prev => ({ ...prev, saving: true }));
    try {
      const res = await fetch('/api/friendlies/manage/message', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: messageDialog.tabName, row_number: messageDialog.rowNumber, message: messageDialog.draft }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to save message');
        setMessageDialog(prev => ({ ...prev, saving: false }));
        return;
      }
      setMessageDialog({ isOpen: false, tabName: '', rowNumber: 0, draft: '', saving: false });
      await fetchGames();
    } catch {
      alert('Failed to save message');
      setMessageDialog(prev => ({ ...prev, saving: false }));
    }
  }

  /**
   * Handle game outcome button click (Mark Played, Cancel, Abandon)
   * Opens the outcome dialog for entering game result details
   */
  function handleGameOutcome(tabName: string, gameStatus: string) {
    // For non-selected games, auto-select Cancel since it's the only option
    const autoStatus = gameStatus !== 'S' ? 'C' : '';

    setOutcomeDialog({
      isOpen: true,
      tabName,
      gameStatus,
      status: autoStatus as 'P' | 'C' | 'A' | '',
      bhbcScore: '',
      opponentScore: '',
      reason: '',
      who: '',
    });
  }

  /**
   * Submit game outcome from the dialog
   */
  function submitOutcome() {
    const { tabName, status, bhbcScore, opponentScore, reason, who } = outcomeDialog;

    // Close dialog
    setOutcomeDialog({ ...outcomeDialog, isOpen: false });

    if (status === 'P') {
      // Mark as Played - just need scores
      changeStatus(tabName, 'played', {
        bhbc_score: parseInt(bhbcScore),
        opponent_score: parseInt(opponentScore),
      });
    } else if (status === 'C') {
      // Mark as Cancelled - need reason and who
      changeStatus(tabName, 'cancel', { reason, who });
    } else if (status === 'A') {
      // Mark as Abandoned - need scores, reason, and who
      changeStatus(tabName, 'abandon', {
        bhbc_score: parseInt(bhbcScore),
        opponent_score: parseInt(opponentScore),
        reason,
        who,
      });
    }
  }

  /**
   * Check if outcome dialog can be submitted
   */
  function canSubmitOutcome(): boolean {
    const { status, bhbcScore, opponentScore, reason, who } = outcomeDialog;

    if (!status) return false;

    if (status === 'P') {
      // Played: need both scores
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
   * Parse DD/MM/YYYY date string to Date object
   * Google Sheets dates come in DD/MM/YYYY format which JavaScript doesn't parse correctly
   * @param dateStr Date string in DD/MM/YYYY format (e.g., "27/09/2025")
   * @returns Date object or null if invalid
   */
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
    // If 'all' filter selected, show all games
    if (filter === 'all') return true;

    // Otherwise, only show games with matching status
    return game.status === filter;
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
      'L': { label: 'Allocating', color: 'bg-amber-500' },  // Paired games: allocating players
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
          <h1 className="text-3xl font-bold text-gray-900">Manage Friendly Matches</h1>

          {/* Link to player view of friendlies */}
          <Link
            href="/friendlies"
            className={getButtonClasses('secondary', 'md')}
          >
            Player View
          </Link>
        </div>

        {/* Filter tabs - allow captain to filter by game status */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
          {/* Loop through all possible status values */}
          {(['all', '', 'O', 'L', 'X', 'S', 'P', 'C', 'A'] as const).map(status => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 font-medium border-b-2 whitespace-nowrap ${
                filter === status
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {/* Display friendly label for each status */}
              {status === 'all' ? 'All' : status === '' ? 'Upcoming' : status === 'L' ? 'Allocating' : status}
            </button>
          ))}
        </div>

        {/* Games table - show loading or table */}
        {loading ? (
          // Loading state - show spinner while fetching games
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading games...</p>
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
                    Club
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
                        className={`bg-purple-50 ${isPairLoading ? 'opacity-50' : ''}`}
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
                              : `${gameA.homeAway === 'H' ? 'H' : 'A'} / ${gameB.homeAway === 'H' ? 'H' : 'A'}`
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
                              Close & Allocate
                            </button>
                          )}
                          {gameA.status === 'L' && (
                            <Link
                              href={`/friendlies/manage/allocate/${encodeURIComponent(gameA.date)}`}
                              className="text-amber-600 hover:text-amber-800 font-medium"
                            >
                              Allocate Players
                            </Link>
                          )}
                          {['', 'O', 'L'].includes(gameA.status) && (
                            <button
                              onClick={() => handleGameOutcome(gameA.tabName, gameA.status)}
                              disabled={isPairLoading}
                              className="text-red-600 hover:text-red-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            onClick={() => handleEditMessage(gameA)}
                            className={`font-medium cursor-pointer ${gameA.message ? 'text-amber-600 hover:text-amber-800' : 'text-gray-400 hover:text-gray-600'}`}
                          >
                            Message
                          </button>
                        </td>
                      </tr>
                    );
                  }

                  // Standard single game row (unchanged)
                  const game = item as Game;
                  return (
                    <tr
                      key={game.tabName && game.tabName.trim() ? game.tabName : `${game.date}-${game.clubName}-${game.time}-${index}`}
                      className={actionLoading === game.tabName ? 'opacity-50' : ''}
                    >
                      {/* Date and time column */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>{parseDDMMYYYY(game.date)?.toLocaleDateString('en-GB') || game.date}</div>
                        <div className="text-gray-700">{game.time}</div>
                      </td>

                      {/* Club name column */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {game.clubName}
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
                        <div>Entered: {game.entered}</div>
                        <div className="text-gray-700">Selected: {game.selected}</div>
                      </td>

                      {/* Actions column - buttons vary based on game status */}
                      <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                        {/* Upcoming games (blank status) - show Open button */}
                        {game.status === '' && (
                          <button
                            onClick={() => handleOpenGame(game.tabName, game.rowNumber)}
                            disabled={actionLoading === game.tabName || actionLoading === `row-${game.rowNumber}`}
                            className="text-green-600 hover:text-green-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Open
                          </button>
                        )}

                        {/* Open games - show Close button */}
                        {game.status === 'O' && (
                          <button
                            onClick={() => handleCloseGame(game.tabName, game.rowNumber)}
                            disabled={actionLoading === game.tabName || actionLoading === `row-${game.rowNumber}`}
                            className="text-yellow-600 hover:text-yellow-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Close
                          </button>
                        )}

                        {/* Selecting games - show Select Team link and Publish button */}
                        {game.status === 'X' && (
                          <>
                            <Link
                              href={`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Select Team
                            </Link>
                            <button
                              onClick={() => handlePublishSelection(game)}
                              disabled={actionLoading === game.tabName}
                              className="text-blue-600 hover:text-blue-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Publish
                            </button>
                          </>
                        )}

                        {/* Selected games - show Edit link and Record Result button */}
                        {game.status === 'S' && (
                          <>
                            <Link
                              href={`/friendlies/manage/game/${encodeURIComponent(game.tabName)}`}
                              className="text-blue-600 hover:text-blue-800 font-medium"
                            >
                              Edit
                            </Link>
                            <button
                              onClick={() => handleGameOutcome(game.tabName, game.status)}
                              disabled={actionLoading === game.tabName}
                              className="text-purple-600 hover:text-purple-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Record Result
                            </button>
                          </>
                        )}

                        {/* Cancel button - show for non-selected active games (Open, Closing) */}
                        {['', 'O', 'X'].includes(game.status) && (
                          <button
                            onClick={() => handleGameOutcome(game.tabName, game.status)}
                            disabled={actionLoading === game.tabName}
                            className="text-red-600 hover:text-red-800 font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Cancel
                          </button>
                        )}

                        {/* Message button — available for all non-played/cancelled/abandoned games */}
                        {!['P', 'C', 'A'].includes(game.status) && (
                          <button
                            onClick={() => handleEditMessage(game)}
                            className={`font-medium cursor-pointer ${game.message ? 'text-amber-600 hover:text-amber-800' : 'text-gray-400 hover:text-gray-600'}`}
                          >
                            Message
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Message / Special Instructions Dialog */}
      {messageDialog.isOpen && (
        <>
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => !messageDialog.saving && setMessageDialog(prev => ({ ...prev, isOpen: false }))}
          />
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h2 className="text-xl font-bold mb-2 text-gray-900">Special Instructions</h2>
              <p className="text-sm text-gray-500 mb-4">
                This message will appear on the game card as a "See Special Instructions" link.
                Leave blank to remove it.
              </p>
              <textarea
                value={messageDialog.draft}
                onChange={e => setMessageDialog(prev => ({ ...prev, draft: e.target.value }))}
                rows={5}
                placeholder="e.g. Please wear whites. Meet at the clubhouse 30 minutes before start."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
                autoFocus
              />
              <div className="flex justify-end gap-3 mt-4">
                <button
                  onClick={() => setMessageDialog(prev => ({ ...prev, isOpen: false }))}
                  disabled={messageDialog.saving}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={saveMessage}
                  disabled={messageDialog.saving}
                  className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {messageDialog.saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />

      {/* Game Outcome Dialog for Played/Cancelled/Abandoned */}
      {outcomeDialog.isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => setOutcomeDialog({ ...outcomeDialog, isOpen: false })}
          />

          {/* Dialog */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
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
                      {/* Played */}
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
                      {/* Cancelled */}
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
                      {/* Abandoned */}
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
                {(outcomeDialog.status === 'P' || outcomeDialog.status === 'A') && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Burgess Hill Score
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={outcomeDialog.bhbcScore}
                        onChange={(e) => setOutcomeDialog({ ...outcomeDialog, bhbcScore: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Opponent Score
                      </label>
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

                {/* Reason and Who - show for Cancelled or Abandoned */}
                {(outcomeDialog.status === 'C' || outcomeDialog.status === 'A') && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Reason
                      </label>
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
                  </>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setOutcomeDialog({ ...outcomeDialog, isOpen: false })}
                  className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitOutcome}
                  disabled={!canSubmitOutcome()}
                  className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Publish Selection Dialog */}
      {publishDialog.isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-40"
            onClick={() => !publishDialog.submitting && !publishDialog.result && closePublishDialog()}
          />

          {/* Dialog */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              {publishDialog.result ? (
                // Show email result
                <>
                  <h2 className="text-xl font-bold mb-4 text-gray-900">Selection Published</h2>

                  <div className="space-y-3">
                    {publishDialog.result.emailsSent !== undefined && publishDialog.result.emailsSent > 0 && (
                      <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Email sent to {publishDialog.result.emailsSent} player{publishDialog.result.emailsSent !== 1 ? 's' : ''}</span>
                      </div>
                    )}

                    {publishDialog.result.playersWithoutEmail && publishDialog.result.playersWithoutEmail.length > 0 && (
                      <div className="bg-yellow-50 p-3 rounded">
                        <p className="text-yellow-800 font-medium mb-1">
                          {publishDialog.result.playersWithoutEmail.length} player{publishDialog.result.playersWithoutEmail.length !== 1 ? 's' : ''} without email:
                        </p>
                        <ul className="text-yellow-700 text-sm list-disc list-inside">
                          {publishDialog.result.playersWithoutEmail.map((name, i) => (
                            <li key={i}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {publishDialog.result.emailError && (
                      <div className="bg-red-50 p-3 rounded text-red-700">
                        <p className="font-medium">Email error:</p>
                        <p className="text-sm">{publishDialog.result.emailError}</p>
                      </div>
                    )}

                    {publishDialog.result.teaRotaEmailsSent !== undefined && publishDialog.result.teaRotaEmailsSent > 0 && (
                      <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Tea rota email sent to {publishDialog.result.teaRotaEmailsSent} member{publishDialog.result.teaRotaEmailsSent !== 1 ? 's' : ''}</span>
                      </div>
                    )}

                    {publishDialog.result.teaRotaMembersWithoutEmail && publishDialog.result.teaRotaMembersWithoutEmail.length > 0 && (
                      <div className="bg-yellow-50 p-3 rounded">
                        <p className="text-yellow-800 font-medium mb-1">
                          {publishDialog.result.teaRotaMembersWithoutEmail.length} tea rota member{publishDialog.result.teaRotaMembersWithoutEmail.length !== 1 ? 's' : ''} without email:
                        </p>
                        <ul className="text-yellow-700 text-sm list-disc list-inside">
                          {publishDialog.result.teaRotaMembersWithoutEmail.map((name, i) => (
                            <li key={i}>{name}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {publishDialog.result.teaRotaEmailError && (
                      <div className="bg-red-50 p-3 rounded text-red-700">
                        <p className="font-medium">Tea rota email error:</p>
                        <p className="text-sm">{publishDialog.result.teaRotaEmailError}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end mt-6">
                    <button
                      onClick={closePublishDialog}
                      className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700"
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                // Show publish form
                <>
                  <h2 className="text-xl font-bold mb-4 text-gray-900">Publish Selection</h2>

                  <p className="text-gray-700 mb-4">
                    Publish the team selection for this game? Players will be able to see their selection status.
                  </p>

                  <label className="flex items-center gap-3 p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100">
                    <input
                      type="checkbox"
                      checked={publishDialog.sendEmail}
                      onChange={(e) => setPublishDialog(prev => ({ ...prev, sendEmail: e.target.checked }))}
                      disabled={publishDialog.submitting}
                      className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                    />
                    <div>
                      <span className="font-medium text-gray-900">Email entered players</span>
                      <p className="text-sm text-gray-600">
                        Send notification to all players who entered this game
                      </p>
                    </div>
                  </label>

                  {publishDialog.isHomeGame && (
                    <label className="flex items-center gap-3 p-3 mt-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100">
                      <input
                        type="checkbox"
                        checked={publishDialog.sendTeaRotaEmail}
                        onChange={(e) => setPublishDialog(prev => ({ ...prev, sendTeaRotaEmail: e.target.checked }))}
                        disabled={publishDialog.submitting}
                        className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <div>
                        <span className="font-medium text-gray-900">Email tea rota</span>
                        <p className="text-sm text-gray-600">
                          Notify members on tea duty with game details and rota assignments
                        </p>
                      </div>
                    </label>
                  )}

                  <div className="flex justify-end gap-3 mt-6">
                    <button
                      onClick={closePublishDialog}
                      disabled={publishDialog.submitting}
                      className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={submitPublish}
                      disabled={publishDialog.submitting}
                      className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {publishDialog.submitting && (
                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      {publishDialog.submitting ? 'Publishing...' : 'Publish'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
