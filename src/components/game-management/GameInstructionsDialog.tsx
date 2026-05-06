// src/components/game-management/GameInstructionsDialog.tsx
// Reusable dialog for viewing/editing game instructions and pickup info.
// Used in four contexts: Open, Close, Publish, and the game editor Instructions button.

'use client';

import { useState, useEffect } from 'react';

// ============================================================================
// Types
// ============================================================================

export type InstructionsDialogMode = 'open' | 'close' | 'publish' | 'instructions';

interface GameSummary {
  tabName: string;
  rowNumber: number;
  clubName: string;
  date: string;         // DD/MM/YYYY display date
  time: string;         // HH:MM
  format: string;
  homeAway: 'H' | 'A';
  specialInstructions: string;
  pickupInfo: string;
}

interface ClubInfo {
  generalInfo: string;
  drivingBand: string;
  miles: string;
  travelTime: string;
}

interface PublishResult {
  emailsSent?: number;
  playersWithoutEmail?: string[];
  emailError?: string;
  teaRotaEmailsSent?: number;
  teaRotaMembersWithoutEmail?: string[];
  teaRotaEmailError?: string;
}

interface GameInstructionsDialogProps {
  isOpen: boolean;
  mode: InstructionsDialogMode;
  game: GameSummary;
  /** Called after successful save/action (not used for publish which manages its own result) */
  onConfirm: () => void;
  onCancel: () => void;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate the default pickup time based on travel time.
 * Travel time is always plain integer minutes.
 * ≤35 min → 60 min before start
 * ≤50 min → 75 min before start
 * >50 min → 90 min before start
 */
function calcDefaultPickup(time: string, travelTimeStr: string): string {
  const travelMins = parseInt(travelTimeStr, 10);
  let leadMins = 60;
  if (!isNaN(travelMins)) {
    if (travelMins <= 35) leadMins = 60;
    else if (travelMins <= 50) leadMins = 75;
    else leadMins = 90;
  }

  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h)) return '';

  const totalMins = h * 60 + (isNaN(m) ? 0 : m) - leadMins;
  const pickupH = Math.floor(((totalMins % 1440) + 1440) % 1440 / 60);
  const pickupM = ((totalMins % 1440) + 1440) % 1440 % 60;
  return `Pickup at Clubhouse at ${pickupH.toString().padStart(2, '0')}:${pickupM.toString().padStart(2, '0')}`;
}

// ============================================================================
// Component
// ============================================================================

export function GameInstructionsDialog({
  isOpen,
  mode,
  game,
  onConfirm,
  onCancel,
}: GameInstructionsDialogProps) {
  // Editable fields
  const [specialInstructions, setSpecialInstructions] = useState('');
  const [pickupInfo, setPickupInfo] = useState('');

  // Away game club info
  const [clubInfo, setClubInfo] = useState<ClubInfo | null>(null);
  const [loadingClub, setLoadingClub] = useState(false);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Publish-specific state
  const [sendEmail, setSendEmail] = useState(false);
  const [sendTeaRotaEmail, setSendTeaRotaEmail] = useState(false);
  const [testEmailState, setTestEmailState] = useState<{ sending: boolean; sent: boolean; error: string }>({
    sending: false, sent: false, error: '',
  });
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  // Initialise editable fields when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    setSpecialInstructions(game.specialInstructions || '');
    setPickupInfo(game.pickupInfo || '');
    setSaving(false);
    setSendEmail(false);
    setSendTeaRotaEmail(false);
    setTestEmailState({ sending: false, sent: false, error: '' });
    setPublishResult(null);
    setClubInfo(null);

    // For away games, fetch club details
    if (game.homeAway === 'A') {
      setLoadingClub(true);
      fetch(`/api/clubs/${encodeURIComponent(game.clubName)}`)
        .then(r => r.json())
        .then(data => {
          const club = data.club;
          if (club) {
            setClubInfo({
              generalInfo: club.generalInformation || '',
              drivingBand: club.drivingBand || '',
              miles: club.miles || '',
              travelTime: club.travelTime || '',
            });
            // Pre-fill pickup if blank using calculated default
            if (!game.pickupInfo && data.club.travelTime) {
              setPickupInfo(calcDefaultPickup(game.time, data.club.travelTime));
            }
          }
        })
        .catch(() => {/* club info optional */})
        .finally(() => setLoadingClub(false));
    }
  }, [isOpen, game.tabName]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  // ============================================================================
  // Actions
  // ============================================================================

  async function handleSave() {
    setSaving(true);
    try {
      // Save special instructions and pickup info in parallel
      const saves: Promise<Response>[] = [
        fetch('/api/friendlies/manage/message', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tab_name: game.tabName,
            row_number: game.rowNumber,
            message: specialInstructions,
          }),
        }),
      ];
      if (game.homeAway === 'A') {
        saves.push(
          fetch('/api/friendlies/manage/pickup-info', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tab_name: game.tabName,
              row_number: game.rowNumber,
              pickup_info: pickupInfo,
            }),
          })
        );
      }
      const results = await Promise.all(saves);
      for (const res of results) {
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to save');
          setSaving(false);
          return;
        }
      }
      onConfirm();
    } catch {
      alert('Failed to save');
      setSaving(false);
    }
  }

  async function handleOpenGame() {
    setSaving(true);
    try {
      // First save instructions, then open game
      const saves: Promise<Response>[] = [
        fetch('/api/friendlies/manage/message', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, message: specialInstructions }),
        }),
      ];
      if (game.homeAway === 'A') {
        saves.push(
          fetch('/api/friendlies/manage/pickup-info', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, pickup_info: pickupInfo }),
          })
        );
      }
      const saveResults = await Promise.all(saves);
      for (const res of saveResults) {
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to save instructions');
          setSaving(false);
          return;
        }
      }

      // Now open the game
      const res = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, action: 'open' }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to open game');
        setSaving(false);
        return;
      }
      onConfirm();
    } catch {
      alert('Failed to open game');
      setSaving(false);
    }
  }

  async function handleCloseGame() {
    setSaving(true);
    try {
      // Save instructions in parallel with close
      const saves: Promise<Response>[] = [
        fetch('/api/friendlies/manage/message', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, message: specialInstructions }),
        }),
      ];
      if (game.homeAway === 'A') {
        saves.push(
          fetch('/api/friendlies/manage/pickup-info', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, pickup_info: pickupInfo }),
          })
        );
      }
      const saveResults = await Promise.all(saves);
      for (const res of saveResults) {
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to save instructions');
          setSaving(false);
          return;
        }
      }

      // Now close the game
      const res = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, action: 'close' }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Failed to close game');
        setSaving(false);
        return;
      }
      onConfirm();
    } catch {
      alert('Failed to close game');
      setSaving(false);
    }
  }

  async function handlePublish() {
    setSaving(true);
    try {
      // Save instructions first
      const saves: Promise<Response>[] = [
        fetch('/api/friendlies/manage/message', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, message: specialInstructions }),
        }),
      ];
      if (game.homeAway === 'A') {
        saves.push(
          fetch('/api/friendlies/manage/pickup-info', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tab_name: game.tabName, row_number: game.rowNumber, pickup_info: pickupInfo }),
          })
        );
      }
      const saveResults = await Promise.all(saves);
      for (const res of saveResults) {
        if (!res.ok) {
          const data = await res.json();
          alert(data.error || 'Failed to save instructions');
          setSaving(false);
          return;
        }
      }

      // Now publish
      const res = await fetch('/api/friendlies/manage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tab_name: game.tabName,
          action: 'publish',
          send_email: sendEmail,
          send_tea_rota_email: sendTeaRotaEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to publish selection');
        setSaving(false);
        return;
      }

      setSaving(false);
      const hasEmailResult = sendEmail && (data.emails_sent > 0 || data.players_without_email?.length > 0 || data.email_error);
      const hasTeaRotaResult = sendTeaRotaEmail && (data.tea_rota_emails_sent > 0 || data.tea_rota_members_without_email?.length > 0 || data.tea_rota_email_error);

      if (hasEmailResult || hasTeaRotaResult) {
        setPublishResult({
          emailsSent: data.emails_sent,
          playersWithoutEmail: data.players_without_email,
          emailError: data.email_error,
          teaRotaEmailsSent: data.tea_rota_emails_sent,
          teaRotaMembersWithoutEmail: data.tea_rota_members_without_email,
          teaRotaEmailError: data.tea_rota_email_error,
        });
      } else {
        onConfirm();
      }
    } catch {
      alert('Failed to publish selection');
      setSaving(false);
    }
  }

  async function handleSendTestEmail() {
    setTestEmailState({ sending: true, sent: false, error: '' });
    try {
      const res = await fetch('/api/friendlies/manage/send-test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab_name: game.tabName }),
      });
      const data = await res.json();
      if (data.success) {
        setTestEmailState({ sending: false, sent: true, error: '' });
      } else {
        setTestEmailState({ sending: false, sent: false, error: data.error || 'Failed to send test email' });
      }
    } catch {
      setTestEmailState({ sending: false, sent: false, error: 'Failed to send test email' });
    }
  }

  function handlePrimaryAction() {
    switch (mode) {
      case 'open': handleOpenGame(); break;
      case 'close': handleCloseGame(); break;
      case 'publish': handlePublish(); break;
      case 'instructions': handleSave(); break;
    }
  }

  // ============================================================================
  // Labels / titles
  // ============================================================================

  const titleMap: Record<InstructionsDialogMode, string> = {
    open: 'Open Game',
    close: 'Close Game',
    publish: 'Publish Selection',
    instructions: 'Game Instructions',
  };

  const primaryLabelMap: Record<InstructionsDialogMode, string> = {
    open: saving ? 'Opening…' : 'Open',
    close: saving ? 'Closing…' : 'Close',
    publish: saving ? 'Publishing…' : 'Publish',
    instructions: saving ? 'Saving…' : 'Save',
  };

  // ============================================================================
  // Render
  // ============================================================================

  // Publish result screen
  if (mode === 'publish' && publishResult) {
    return (
      <>
        <div className="fixed inset-0 bg-black bg-opacity-50 z-40" />
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4 text-gray-900">Selection Published</h2>
            <div className="space-y-3">
              {publishResult.emailsSent !== undefined && publishResult.emailsSent > 0 && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Email sent to {publishResult.emailsSent} player{publishResult.emailsSent !== 1 ? 's' : ''}</span>
                </div>
              )}
              {publishResult.playersWithoutEmail && publishResult.playersWithoutEmail.length > 0 && (
                <div className="bg-yellow-50 p-3 rounded">
                  <p className="text-yellow-800 font-medium mb-1">
                    {publishResult.playersWithoutEmail.length} player{publishResult.playersWithoutEmail.length !== 1 ? 's' : ''} without email:
                  </p>
                  <ul className="text-yellow-700 text-sm list-disc list-inside">
                    {publishResult.playersWithoutEmail.map((name, i) => <li key={i}>{name}</li>)}
                  </ul>
                </div>
              )}
              {publishResult.emailError && (
                <div className="bg-red-50 p-3 rounded text-red-700">
                  <p className="font-medium">Email error:</p>
                  <p className="text-sm">{publishResult.emailError}</p>
                </div>
              )}
              {publishResult.teaRotaEmailsSent !== undefined && publishResult.teaRotaEmailsSent > 0 && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded">
                  <svg className="w-5 h-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Tea rota email sent to {publishResult.teaRotaEmailsSent} member{publishResult.teaRotaEmailsSent !== 1 ? 's' : ''}</span>
                </div>
              )}
              {publishResult.teaRotaMembersWithoutEmail && publishResult.teaRotaMembersWithoutEmail.length > 0 && (
                <div className="bg-yellow-50 p-3 rounded">
                  <p className="text-yellow-800 font-medium mb-1">
                    {publishResult.teaRotaMembersWithoutEmail.length} tea rota member{publishResult.teaRotaMembersWithoutEmail.length !== 1 ? 's' : ''} without email:
                  </p>
                  <ul className="text-yellow-700 text-sm list-disc list-inside">
                    {publishResult.teaRotaMembersWithoutEmail.map((name, i) => <li key={i}>{name}</li>)}
                  </ul>
                </div>
              )}
              {publishResult.teaRotaEmailError && (
                <div className="bg-red-50 p-3 rounded text-red-700">
                  <p className="font-medium">Tea rota email error:</p>
                  <p className="text-sm">{publishResult.teaRotaEmailError}</p>
                </div>
              )}
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={onConfirm}
                className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={() => !saving && onCancel()}
      />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">

          {/* Header */}
          <h2 className="text-xl font-bold mb-4 text-gray-900">{titleMap[mode]}</h2>

          {/* Game summary (read-only) */}
          <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm text-gray-700 space-y-1">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span><span className="font-medium text-gray-900">Club:</span> {game.clubName}</span>
              <span><span className="font-medium text-gray-900">Date:</span> {game.date}</span>
              <span><span className="font-medium text-gray-900">Time:</span> {game.time}</span>
              <span><span className="font-medium text-gray-900">Format:</span> {game.format}</span>
              <span><span className="font-medium text-gray-900">Venue:</span> {game.homeAway === 'H' ? 'Home' : 'Away'}</span>
            </div>
          </div>

          {/* Away game: club information (read-only) */}
          {game.homeAway === 'A' && (
            <div className="mb-4">
              {loadingClub ? (
                <p className="text-sm text-gray-500">Loading club details…</p>
              ) : clubInfo ? (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-gray-700 space-y-1">
                  {clubInfo.generalInfo && (
                    <p><span className="font-medium text-gray-900">General info:</span> {clubInfo.generalInfo}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {clubInfo.drivingBand && (
                      <span><span className="font-medium text-gray-900">Driving band:</span> {clubInfo.drivingBand}</span>
                    )}
                    {clubInfo.miles && (
                      <span><span className="font-medium text-gray-900">Distance:</span> {clubInfo.miles} miles</span>
                    )}
                    {clubInfo.travelTime && (
                      <span><span className="font-medium text-gray-900">Travel time:</span> {clubInfo.travelTime} minutes</span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Special Instructions */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Special Instructions
            </label>
            <textarea
              value={specialInstructions}
              onChange={e => setSpecialInstructions(e.target.value)}
              rows={3}
              placeholder="e.g. Please wear whites. Meet at the clubhouse 30 minutes before start."
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
            />
          </div>

          {/* Away game: Pickup Information */}
          {game.homeAway === 'A' && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Pickup Information
              </label>
              <textarea
                value={pickupInfo}
                onChange={e => setPickupInfo(e.target.value)}
                rows={3}
                placeholder="e.g. Car 1: Dave picking up from Waitrose at 12:30. Car 2: Meet at club 12:45."
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-y"
              />
            </div>
          )}

          {/* Publish-only: email options */}
          {mode === 'publish' && (
            <div className="mb-4 space-y-2">
              <label className="flex items-center gap-3 p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={e => setSendEmail(e.target.checked)}
                  disabled={saving}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                />
                <div>
                  <span className="font-medium text-gray-900">Email entered players</span>
                  <p className="text-sm text-gray-700">Send notification to all players who entered this game</p>
                </div>
              </label>

              {game.homeAway === 'H' && (
                <label className="flex items-center gap-3 p-3 bg-gray-50 rounded cursor-pointer hover:bg-gray-100">
                  <input
                    type="checkbox"
                    checked={sendTeaRotaEmail}
                    onChange={e => setSendTeaRotaEmail(e.target.checked)}
                    disabled={saving}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-medium text-gray-900">Email tea rota</span>
                    <p className="text-sm text-gray-700">Notify members on tea duty with game details and rota assignments</p>
                  </div>
                </label>
              )}

              {testEmailState.sent && (
                <p className="text-sm text-green-700 bg-green-50 p-2 rounded">
                  Test email sent to your address.
                </p>
              )}
              {testEmailState.error && (
                <p className="text-sm text-red-700 bg-red-50 p-2 rounded">
                  {testEmailState.error}
                </p>
              )}
            </div>
          )}

          {/* Footer buttons */}
          <div className={`flex items-center mt-2 ${mode === 'publish' ? 'justify-between' : 'justify-end'} gap-3`}>
            {mode === 'publish' && (
              <button
                onClick={handleSendTestEmail}
                disabled={saving || testEmailState.sending}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2 text-sm"
                title="Send a preview to your own email address only"
              >
                {testEmailState.sending && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {testEmailState.sending ? 'Sending…' : 'Send Test Email'}
              </button>
            )}
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                disabled={saving}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handlePrimaryAction}
                disabled={saving}
                className="px-4 py-2 text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && (
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {primaryLabelMap[mode]}
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}
