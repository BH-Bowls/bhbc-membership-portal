// app/friendlies/match-card/[tabDate]/page.tsx
// Match Card Display Page - shows formatted match card ready for printing
// Displays team selections, reserves, captain, tea rota (home), and venue details (away)
// Includes print-optimized layout with page breaks for reserve teams

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import Link from 'next/link';
import { MatchCardData } from '@/lib/types/friendlies';
import { parseUKDate } from '@/lib/date-utils';

// ============================================================================
// Main Component
// ============================================================================

/**
 * Match Card Page Component
 * Displays a print-ready match card for a specific game
 *
 * Features:
 * - Teams with player positions and captain indicator
 * - Reserves list with positions
 * - Reserve teams (if applicable)
 * - Tea rota (home games only)
 * - Venue details with directions link (away games only)
 * - Club contacts (away games only)
 * - Driver information with car numbers (away games only)
 * - Print button and optimized print layout
 */
export default function MatchCardPage() {
  // Get current user session
  const { data: session } = useSession();

  // Get route parameters (tabDate identifies the game)
  const params = useParams();
  const tabDate = params.tabDate as string;

  // State: Match card data (teams, reserves, venue, contacts, etc.)
  const [matchCard, setMatchCard] = useState<MatchCardData | null>(null);

  // State: Loading indicator while fetching match card
  const [loading, setLoading] = useState(true);

  // ============================================================================
  // Effects
  // ============================================================================

  /**
   * Effect: Fetch match card when page loads or tabDate changes
   * Runs whenever the tabDate parameter changes
   */
  useEffect(() => {
    // Fetch match card data from API
    fetchMatchCard();
  }, [tabDate]);

  // ============================================================================
  // API Functions
  // ============================================================================

  /**
   * Fetch match card data from API
   * Gets all information needed for the match card display:
   * - Game details
   * - Team selections with positions
   * - Reserves
   * - Reserve teams
   * - Captain of the day
   * - Tea rota (home games)
   * - Venue details (away games)
   * - Club contacts (away games)
   */
  async function fetchMatchCard() {
    // Show loading spinner
    setLoading(true);

    try {
      // Call match card API with game identifier
      const response = await fetch(`/api/friendlies/match-card/${tabDate}`);
      const data = await response.json();

      // Check if request was successful
      if (response.ok) {
        // Update match card data
        setMatchCard(data);
      } else {
        // Show error alert
        alert(data.error || 'Failed to load match card');
      }
    } catch (error) {
      // Network or other error
      console.error('Error fetching match card:', error);
      alert('Failed to load match card');
    } finally {
      // Hide loading spinner
      setLoading(false);
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle Print button click
   * Triggers browser print dialog
   * CSS media queries handle print-specific styling
   */
  function handlePrint() {
    window.print();
  }

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Get position label from position code
   * Converts single-letter codes to full position names
   * @param pos Position code (S, 1, 2, 3)
   * @returns Full position name (Skip, Lead, Second, Third)
   */
  const getPositionLabel = (pos: string) => {
    // Define position code to label mappings
    const labels: { [key: string]: string } = {
      'S': 'Skip',      // S = Skip
      '1': 'Lead',      // 1 = Lead
      '2': 'Second',    // 2 = Second
      '3': 'Third',     // 3 = Third
    };

    // Return label or original code if not found
    return labels[pos] || pos;
  };

  // ============================================================================
  // Loading State
  // ============================================================================

  // Show loading spinner while fetching match card
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading match card...</p>
          </div>
        </div>
      </div>
    );
  }

  // Return null if no match card data (shouldn't happen after loading completes)
  if (!matchCard) return null;

  // ============================================================================
  // Extract Match Card Data
  // ============================================================================

  // Destructure match card data for easier access
  const { game, teams, reserves, reserveTeams, captain, teaRota, clubDetails, clubContacts } = matchCard;

  // ============================================================================
  // Render UI
  // ============================================================================

  return (
    <>
      {/* Print-specific styles - hide navbar and buttons, enable page breaks */}
      <style jsx global>{`
        @media print {
          @page {
            size: auto;
            margin: 10mm;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
          .page-break {
            page-break-after: always;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gray-50">
        {/* Navigation bar - hidden when printing */}
        <div className="no-print">
          <Navbar userName={session?.user.name ?? undefined} userRole={session?.user.role ?? undefined} />
        </div>

        {/* Header with back link and print button - hidden when printing */}
        <div className="no-print bg-white border-b border-gray-200 p-4">
          <div className="container mx-auto max-w-4xl flex justify-between items-center">
            {/* Link back to appropriate page based on user role */}
            <Link
              href={session?.user?.role === 'Captain' || session?.user?.role === 'Admin'
                ? `/friendlies/manage/game/${tabDate}`
                : `/friendlies/game/${tabDate}`}
              className="text-blue-600 hover:text-blue-800"
            >
              ← Back to Game
            </Link>

            {/* Print button - triggers browser print dialog */}
            <button
              onClick={handlePrint}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Print Match Card
            </button>
          </div>
        </div>

        {/* Match card content - main printable area */}
        <div className="container mx-auto max-w-4xl px-4 py-8">
          <div className="bg-white rounded-lg shadow-lg p-8">

            {/* ============================================================ */}
            {/* Header Section - Club name, opponent, date, time, format */}
            {/* ============================================================ */}
            <div className="text-center border-b-2 border-gray-300 pb-4 mb-6">
              {/* Club name */}
              <h1 className="text-3xl font-bold text-gray-900">BURGESS HILL BOWLS CLUB</h1>

              {/* Opponent name */}
              <h2 className="text-2xl font-semibold mt-2 text-blue-600">{game.clubName}</h2>

              {/* Game details - date, time, home/away, format */}
              <div className="mt-3 text-lg">
                {/* Full date with day name */}
                <p>
                  {parseUKDate(game.date).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>

                {/* Time, venue, format, gender */}
                <p className="font-semibold">
                  {game.time} - {game.homeAway === 'H' ? 'HOME' : 'AWAY'} - {game.format} - {game.ladiesMen}
                </p>

                {/* Dress code if specified */}
                {game.dress && <p className="text-sm text-gray-600">Dress: {game.dress}</p>}
              </div>
            </div>

            {/* ============================================================ */}
            {/* Captain of the Day - highlighted box */}
            {/* ============================================================ */}
            {captain && (
              <div className="bg-purple-100 border-2 border-purple-600 rounded-lg p-4 mb-6 text-center">
                <p className="text-lg">
                  <strong>Captain of the Day:</strong> <span className="text-xl font-bold">{captain}</span>
                </p>
              </div>
            )}

            {/* ============================================================ */}
            {/* Teams Section - grid of teams with players and positions */}
            {/* ============================================================ */}
            <div className="mb-6">
              <h3 className="text-xl font-bold mb-4 text-gray-800">TEAMS</h3>

              {/* Display teams in 2-column grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* Loop through each team */}
                {teams.map(team => (
                  <div key={team.team} className="border-2 border-gray-300 rounded-lg p-4">
                    {/* Team number header */}
                    <h4 className="font-bold text-lg mb-3 text-center bg-gray-100 py-2 rounded">
                      Team {team.team}
                    </h4>

                    {/* Players in this team */}
                    <div className="space-y-2">
                      {/* Loop through each player in team */}
                      {team.players.map((player, idx) => (
                        <div
                          key={idx}
                          className={`flex justify-between p-2 rounded ${
                            // Highlight captain with purple background
                            player.isCaptain ? 'bg-purple-100 font-bold' : 'bg-gray-50'
                          }`}
                        >
                          {/* Player name with star if captain */}
                          <span>
                            {player.name}
                            {player.isCaptain && ' ★'}
                          </span>

                          {/* Position label (Skip, Lead, Second, Third) */}
                          <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                        </div>
                      ))}
                    </div>

                    {/* Driver information - only show for away games if team has drivers */}
                    {game.homeAway === 'A' && team.players.some(p => p.driving) && (
                      <div className="mt-3 pt-2 border-t border-gray-300 text-sm">
                        <strong>Drivers:</strong>{' '}
                        {/* List all drivers with car numbers */}
                        {team.players
                          .filter(p => p.driving === 'Y')
                          .map(p => `${p.name}${p.carNumber ? ` (Car ${p.carNumber})` : ''}`)
                          .join(', ')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ============================================================ */}
            {/* Reserves Section - players not in teams but available */}
            {/* ============================================================ */}
            {reserves.length > 0 && (
              <div className="mb-6">
                <h3 className="text-xl font-bold mb-3 text-gray-800">RESERVES</h3>

                {/* Yellow-bordered box for reserves */}
                <div className="border-2 border-yellow-400 bg-yellow-50 rounded-lg p-4">
                  <div className="space-y-2">
                    {/* Loop through each reserve player */}
                    {reserves.map((reserve, idx) => (
                      <div key={idx} className="flex justify-between p-2 bg-white rounded">
                        {/* Reserve player name */}
                        <span className="font-medium">{reserve.name}</span>

                        {/* Position if specified */}
                        {reserve.position && (
                          <span className="text-gray-600">{getPositionLabel(reserve.position)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* Tea Rota - only for home games */}
            {/* Shows who is responsible for making tea */}
            {/* ============================================================ */}
            {game.homeAway === 'H' && teaRota && (
              <div className="mb-6 border-2 border-green-400 bg-green-50 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3 text-gray-800">TEA DUTY</h3>

                {/* List of tea duty roles */}
                <div className="space-y-1">
                  <p><strong>Lead:</strong> {teaRota.lead}</p>
                  <p><strong>Second:</strong> {teaRota.second}</p>
                  {teaRota.third && <p><strong>Third:</strong> {teaRota.third}</p>}
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* Venue Details - only for away games */}
            {/* Shows address, directions, driving costs */}
            {/* ============================================================ */}
            {game.homeAway === 'A' && clubDetails && (
              <div className="mb-6 border-2 border-blue-400 bg-blue-50 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3 text-gray-800">VENUE</h3>

                <div className="space-y-2">
                  {/* Address and postcode */}
                  <div>
                    <p className="font-semibold">{clubDetails.address}</p>
                    <p className="text-lg font-bold">{clubDetails.postCode}</p>
                  </div>

                  {/* Google Maps directions link */}
                  {clubDetails.directionsUrl && (
                    <p>
                      <a
                        href={clubDetails.directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 font-medium"
                      >
                        📍 Get Directions from BHBC
                      </a>
                    </p>
                  )}

                  {/* General information about the venue */}
                  {clubDetails.generalInfo && (
                    <p className="text-sm">
                      <strong>Info:</strong> {clubDetails.generalInfo}
                    </p>
                  )}

                  {/* Petrol cost per person with driving band */}
                  {clubDetails.petrolCost > 0 && (
                    <p className="text-lg font-semibold text-green-700">
                      Petrol Cost: £{clubDetails.petrolCost.toFixed(2)} per person (Band {clubDetails.drivingBand})
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* Club Contacts - only for away games */}
            {/* Shows contact details for opponent club officials */}
            {/* ============================================================ */}
            {game.homeAway === 'A' && clubContacts && clubContacts.length > 0 && (
              <div className="mb-6 border-2 border-blue-700 bg-blue-50 rounded-lg p-4">
                <h3 className="text-xl font-bold mb-3 text-gray-800">CONTACTS</h3>

                <div className="space-y-3">
                  {/* Loop through each contact */}
                  {clubContacts.map((contact, idx) => (
                    <div key={idx} className="bg-white p-3 rounded">
                      {/* Contact name and role */}
                      <p className="font-bold">
                        {contact.name}
                        {contact.role && <span className="text-sm font-normal text-gray-600"> ({contact.role})</span>}
                      </p>

                      {/* Mobile number - clickable to call */}
                      {contact.mobile && (
                        <p className="text-sm">
                          Mobile: <a href={`tel:${contact.mobile.replace(/\s/g, '')}`} className="text-blue-600">{contact.mobile}</a>
                        </p>
                      )}

                      {/* Landline number - clickable to call */}
                      {contact.phone && (
                        <p className="text-sm">
                          Phone: <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="text-blue-600">{contact.phone}</a>
                        </p>
                      )}

                      {/* Email address - clickable to email */}
                      {contact.email && (
                        <p className="text-sm">
                          Email: <a href={`mailto:${contact.email}`} className="text-blue-600">{contact.email}</a>
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* Reserve Teams Section - additional teams beyond main teams */}
            {/* Starts on new page when printing */}
            {/* ============================================================ */}
            {reserveTeams.length > 0 && (
              // Page break before reserve teams when printing
              <div className="page-break">
                <div className="mt-8 pt-8 border-t-4 border-gray-300">
                  <h3 className="text-xl font-bold mb-4 text-gray-800">RESERVE TEAMS</h3>

                  {/* Display reserve teams in 2-column grid */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Loop through each reserve team */}
                    {reserveTeams.map(team => (
                      <div key={team.team} className="border-2 border-orange-400 bg-orange-50 rounded-lg p-4">
                        {/* Reserve team number header */}
                        <h4 className="font-bold text-lg mb-3 text-center bg-orange-200 py-2 rounded">
                          Reserve Team {team.team}
                        </h4>

                        {/* Players in this reserve team */}
                        <div className="space-y-2">
                          {/* Loop through each player in reserve team */}
                          {team.players.map((player, idx) => (
                            <div key={idx} className="flex justify-between p-2 bg-white rounded">
                              {/* Player name */}
                              <span>{player.name}</span>

                              {/* Position label */}
                              <span className="text-gray-600">{getPositionLabel(player.position)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
