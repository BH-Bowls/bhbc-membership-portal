// src/components/rowland/RowlandMatchDialog.tsx
// Modal for entering Rowland Cup match results and player names

'use client';

import { useState, useEffect, useRef } from 'react';
import type { CompMatch } from '@/types/competitions';
import type { RowlandMatch } from '@/types/rowland';
import { ROWLAND_ROUND_LABELS } from '@/types/rowland';

export interface RowlandResultData {
  homePlayers?: string[];
  awayPlayers?: string[];
  homeScore?: number;
  awayScore?: number;
  winnerSide?: 1 | 2;
  status?: 'Played' | 'Walkover';
  playedDate?: string;
  scoreSheetUrl?: string;
}

interface RowlandMatchDialogProps {
  compMatch: CompMatch;
  rawMatch: RowlandMatch;
  /** Which side the logged-in club is on — used to auto-focus their player 1 */
  myTeamSide?: 'home' | 'away' | null;
  onSubmit: (matchId: string, data: RowlandResultData) => Promise<void>;
  onClose: () => void;
  saving?: boolean;
  /** API path prefix for uploading score sheet, e.g. /api/rowland/edward-a/matches/edward-a-R1-1 */
  uploadPath?: string;
}

/** Resize + re-encode an image to JPEG at max 1920px on the long edge, ~82% quality.
 *  Keeps file size well under 1 MB for typical score-card photos. */
async function compressImage(file: File): Promise<{ blob: Blob; name: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX_DIM = 1920;
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, name: file.name.replace(/\.[^/.]+$/, '') + '.jpg' });
          else reject(new Error('Compression failed'));
        },
        'image/jpeg',
        0.82,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

function initPlayers(existing: string[]): string[] {
  const result = [...existing];
  while (result.length < 4) result.push('');
  return result.slice(0, 4);
}

export function RowlandMatchDialog({
  compMatch,
  rawMatch,
  myTeamSide,
  onSubmit,
  onClose,
  saving = false,
  uploadPath,
}: RowlandMatchDialogProps) {
  const isBye = compMatch.side2Usernames?.[0] === 'Bye';

  const [homePlayers, setHomePlayers] = useState<string[]>(() => initPlayers(rawMatch.homePlayers));
  const [awayPlayers, setAwayPlayers] = useState<string[]>(() => initPlayers(rawMatch.awayPlayers));
  const [homeScore, setHomeScore] = useState(rawMatch.homeScore != null ? String(rawMatch.homeScore) : '');
  const [awayScore, setAwayScore] = useState(rawMatch.awayScore != null ? String(rawMatch.awayScore) : '');
  const [playedDate, setPlayedDate] = useState(
    rawMatch.playedDate ?? new Date().toISOString().split('T')[0]
  );
  const [showWalkover, setShowWalkover] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Score sheet upload
  const [scoreSheetFile, setScoreSheetFile] = useState<File | null>(null);
  const [scoreSheetPreview, setScoreSheetPreview] = useState<string | null>(
    rawMatch.scoreSheetUrl ?? null
  );
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(rawMatch.scoreSheetUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const homeName = compMatch.side1Usernames[0] ?? 'Home';
  const awayName = isBye ? 'Bye' : (compMatch.side2Usernames?.[0] ?? 'Away');
  const roundLabel = ROWLAND_ROUND_LABELS[rawMatch.round] ?? rawMatch.round;

  // Auto-focus first input of the logged-in club's column
  const homePlayer0Ref = useRef<HTMLInputElement>(null);
  const awayPlayer0Ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (myTeamSide === 'home') {
      homePlayer0Ref.current?.focus();
    } else if (myTeamSide === 'away') {
      awayPlayer0Ref.current?.focus();
    }
  }, [myTeamSide]);

  async function uploadScoreSheet(): Promise<string | null> {
    if (!scoreSheetFile || !uploadPath) return uploadedUrl;
    setUploading(true);
    try {
      let uploadBlob: Blob = scoreSheetFile;
      let uploadName = scoreSheetFile.name || 'score-sheet.jpg';
      try {
        const compressed = await compressImage(scoreSheetFile);
        uploadBlob = compressed.blob;
        uploadName = compressed.name;
      } catch {
        // compression failed — upload original and let the server enforce size limit
      }
      const fd = new FormData();
      fd.append('file', uploadBlob, uploadName);
      const res = await fetch(`${uploadPath}/score-sheet`, { method: 'POST', body: fd });
      if (!res.ok) {
        let msg = 'Upload failed';
        try { const d = await res.json(); msg = d.error || msg; } catch { /* non-JSON error body */ }
        throw new Error(msg);
      }
      const { url } = await res.json();
      setUploadedUrl(url);
      setScoreSheetFile(null);
      return url;
    } catch (err: any) {
      setError(`Score sheet upload failed: ${err.message}`);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setError(null);

    const sheetUrl = await uploadScoreSheet();

    const s1raw = homeScore.trim();
    const s2raw = awayScore.trim();
    const s1 = parseInt(s1raw, 10);
    const s2 = parseInt(s2raw, 10);
    const hasScore = s1raw !== '' && s2raw !== '' && !isNaN(s1) && !isNaN(s2);

    if (hasScore) {
      if (s1 < 0 || s2 < 0) { setError('Scores cannot be negative'); return; }
      if (s1 === s2) { setError('Scores cannot be equal — there must be a winner'); return; }
      await onSubmit(compMatch.matchId, {
        homeScore: s1,
        awayScore: s2,
        winnerSide: s1 > s2 ? 1 : 2,
        status: 'Played',
        homePlayers: homePlayers.filter(Boolean),
        awayPlayers: awayPlayers.filter(Boolean),
        playedDate,
        scoreSheetUrl: sheetUrl ?? undefined,
      });
    } else {
      await onSubmit(compMatch.matchId, {
        homePlayers: homePlayers.filter(Boolean),
        awayPlayers: awayPlayers.filter(Boolean),
        playedDate,
        scoreSheetUrl: sheetUrl ?? undefined,
      });
    }
  }

  async function handleWalkover(winnerSide: 1 | 2) {
    const sheetUrl = await uploadScoreSheet();
    await onSubmit(compMatch.matchId, {
      winnerSide,
      status: 'Walkover',
      homePlayers: homePlayers.filter(Boolean),
      awayPlayers: awayPlayers.filter(Boolean),
      playedDate,
      scoreSheetUrl: sheetUrl ?? undefined,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{roundLabel}</h2>
            <p className="text-sm text-gray-500">{homeName} vs {awayName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {!showWalkover ? (
            <div className="p-5 space-y-5">
              {/* Players */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Players</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5 truncate">{homeName}</p>
                    {homePlayers.map((p, i) => (
                      <input
                        key={i}
                        ref={i === 0 ? homePlayer0Ref : undefined}
                        type="text"
                        value={p}
                        onChange={e => {
                          const next = [...homePlayers];
                          next[i] = e.target.value;
                          setHomePlayers(next);
                        }}
                        placeholder={`Player ${i + 1}`}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-1 focus:outline-none focus:border-blue-400"
                      />
                    ))}
                  </div>
                  {!isBye && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1.5 truncate">{awayName}</p>
                      {awayPlayers.map((p, i) => (
                        <input
                          key={i}
                          ref={i === 0 ? awayPlayer0Ref : undefined}
                          type="text"
                          value={p}
                          onChange={e => {
                            const next = [...awayPlayers];
                            next[i] = e.target.value;
                            setAwayPlayers(next);
                          }}
                          placeholder={`Player ${i + 1}`}
                          className="w-full border border-gray-300 rounded px-2 py-1 text-sm mb-1 focus:outline-none focus:border-blue-400"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Score + date */}
              {!isBye && (
                <div className="space-y-3 border-t border-gray-100 pt-4">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Result</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-600 mb-1 truncate">{homeName}</label>
                      <input
                        type="number"
                        min="0"
                        value={homeScore}
                        onChange={e => setHomeScore(e.target.value)}
                        placeholder="Score"
                        className="w-full border border-gray-300 rounded px-2 py-2 text-base font-mono text-center focus:outline-none focus:border-blue-400"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1 truncate">{awayName}</label>
                      <input
                        type="number"
                        min="0"
                        value={awayScore}
                        onChange={e => setAwayScore(e.target.value)}
                        placeholder="Score"
                        className="w-full border border-gray-300 rounded px-2 py-2 text-base font-mono text-center focus:outline-none focus:border-blue-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Date played</label>
                    <input
                      type="date"
                      value={playedDate}
                      onChange={e => setPlayedDate(e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                    />
                  </div>

                  {/* Score sheet upload */}
                  {uploadPath && (
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Score sheet (optional)</label>
                      {scoreSheetPreview ? (
                        <div className="flex items-center gap-2">
                          <a href={scoreSheetPreview} target="_blank" rel="noopener noreferrer">
                            <img
                              src={scoreSheetPreview}
                              alt="Score sheet"
                              className="h-16 w-auto rounded border border-gray-200 object-cover"
                            />
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setScoreSheetPreview(null);
                              setUploadedUrl(null);
                              setScoreSheetFile(null);
                            }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0] ?? null;
                              setScoreSheetFile(f);
                              if (f) {
                                const reader = new FileReader();
                                reader.onload = (ev) => setScoreSheetPreview(ev.target?.result as string);
                                reader.readAsDataURL(f);
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {scoreSheetFile ? scoreSheetFile.name : 'Add photo / take photo'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {error && <p className="text-sm text-red-600">{error}</p>}

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setShowWalkover(true)}
                      className="text-sm text-orange-600 hover:text-orange-700"
                    >
                      Record walkover instead
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving || uploading}
                      className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploading ? 'Uploading…' : saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {/* Bye — just save players */}
              {isBye && (
                <div className="border-t border-gray-100 pt-4 flex justify-end">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">Which team advances by walkover?</p>
              <div className="space-y-2">
                <button
                  onClick={() => handleWalkover(1)}
                  disabled={saving}
                  className="w-full text-left px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-sm font-medium text-orange-800 disabled:opacity-50"
                >
                  {homeName} advances
                </button>
                {!isBye && (
                  <button
                    onClick={() => handleWalkover(2)}
                    disabled={saving}
                    className="w-full text-left px-4 py-3 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-sm font-medium text-orange-800 disabled:opacity-50"
                  >
                    {awayName} advances
                  </button>
                )}
              </div>
              <button
                onClick={() => setShowWalkover(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ← Back to score entry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
