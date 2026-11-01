'use client';

// src/components/SquareTerminalSetup.tsx
// Square Terminal set-up on /admin/bar-devices (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10).
// Pair the Terminal with a sign-in code (or, in the sandbox, pick a simulated one), and
// sort out any card payment that went through on the Terminal but couldn't be recorded.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCardClasses, getAlertClasses, getInputClasses } from '@/config/theme-helpers';

interface Setup {
  enabled: boolean;
  configured: boolean;
  sandbox: boolean;
  deviceId: string;
  deviceName: string;
}

interface AttentionItem {
  id: string;
  kind: 'sale' | 'topup' | 'membership';
  amountPence: number;
  recorded: boolean;
  recordError: string | null;
  payload: { userName?: string | null; staff?: string };
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = { sale: 'Bar sale', topup: 'Account top-up', membership: 'Membership fees' };

export default function SquareTerminalSetup() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [testDevices, setTestDevices] = useState<{ id: string; name: string }[]>([]);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState('Bar Terminal');
  const [pairing, setPairing] = useState<{ codeId: string; code: string; pairBy: string | null; status: string } | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/square-terminal')
      .then((r) => r.json())
      .then((data) => {
        if (data.setup) {
          setSetup(data.setup);
          setTestDevices(data.testDevices || []);
          setAttention(data.attention || []);
        } else {
          setError(data.error || 'Failed to load the Terminal set-up');
        }
      })
      .catch(() => setError('Failed to load the Terminal set-up'));
  }, []);
  useEffect(load, [load]);

  async function post(body: Record<string, unknown>): Promise<any> {
    const res = await fetch('/api/admin/square-terminal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Square request failed');
    return data;
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }
  useEffect(() => stopPolling, []);

  async function startPairing() {
    setBusy(true); setError(null);
    try {
      const data = await post({ action: 'pair', name: name });
      setPairing({ codeId: data.code.id, code: data.code.code, pairBy: data.code.pairBy, status: data.code.status });
      stopPolling();
      // Check every 5 seconds until the code has been entered on the Terminal
      pollRef.current = setInterval(async () => {
        try {
          const check = await post({ action: 'check', codeId: data.code.id, name: name });
          setPairing((p) => (p ? { ...p, status: check.code.status } : p));
          if (check.code.status !== 'UNPAIRED') {
            stopPolling();
            load();
          }
        } catch {
          // keep trying — a dropped request isn't fatal
        }
      }, 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function run(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      await post(body);
      setConfirmUnpair(false);
      setPairing(null);
      stopPolling();
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className={`${getCardClasses('md')} space-y-2`}>
        <h2 className="text-sm font-medium text-gray-700">Square Terminal</h2>
        {error ? <div className={getAlertClasses('danger')}>{error}</div> : <p className="text-sm text-gray-700">Loading…</p>}
      </div>
    );
  }

  return (
    <div className={`${getCardClasses('md')} space-y-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-700">Square Terminal</h2>
        {setup.configured && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded ${setup.sandbox ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-900'}`}>
            {setup.sandbox ? 'Sandbox (test)' : 'Live'}
          </span>
        )}
      </div>

      {error && <div className={getAlertClasses('danger')}>{error}</div>}

      {!setup.configured ? (
        <p className="text-sm text-gray-700">
          Square isn&apos;t connected yet — set <span className="font-mono">SQUARE_ACCESS_TOKEN</span> and{' '}
          <span className="font-mono">SQUARE_LOCATION_ID</span> in the environment. Until then the till takes card
          payments on the card machine and staff tick to confirm.
        </p>
      ) : setup.enabled ? (
        <div className="space-y-2">
          <p className="text-sm text-gray-900">
            The till sends card payments to <strong>{setup.deviceName || 'the Terminal'}</strong>.
          </p>
          <p className="text-xs text-gray-700">Device id <span className="font-mono">{setup.deviceId}</span></p>
          {confirmUnpair ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3">
              <span className="text-sm text-red-800">Stop using this Terminal? The till goes back to the card machine tick box.</span>
              <button onClick={() => run({ action: 'unpair' })} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50">Stop using it</button>
              <button onClick={() => setConfirmUnpair(false)} className="text-sm text-gray-700">Keep</button>
            </div>
          ) : (
            <button onClick={() => setConfirmUnpair(true)} className="text-sm text-red-700 hover:text-red-900">Stop using this Terminal…</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            No Terminal paired — the till takes card payments on the card machine and staff tick to confirm.
          </p>

          {pairing ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 space-y-1">
              {pairing.status === 'UNPAIRED' ? (
                <>
                  <p className="text-sm text-gray-900">On the Terminal, choose <strong>Sign in with device code</strong> and enter:</p>
                  <p className="text-3xl font-bold tracking-widest text-gray-900">{pairing.code}</p>
                  <p className="text-xs text-gray-700">
                    Waiting for the Terminal…{pairing.pairBy ? ` The code expires ${new Date(pairing.pairBy).toLocaleString('en-GB')}.` : ''}
                  </p>
                </>
              ) : pairing.status === 'PAIRED' ? (
                <p className="text-sm font-medium text-green-800">Paired.</p>
              ) : (
                <p className="text-sm font-medium text-red-800">That code has expired — get a new one.</p>
              )}
              <button onClick={() => { stopPolling(); setPairing(null); }} className="text-sm text-gray-700 underline">Cancel</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="block text-xs text-gray-700">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className={`${getInputClasses()} w-48`} />
              </div>
              <button onClick={startPairing} disabled={busy} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50">Pair a Terminal</button>
            </div>
          )}

          {testDevices.length > 0 && !pairing && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-sm text-gray-700">
                Sandbox: there&apos;s no real Terminal, so use a simulated one. Test payments over £25.00 stay waiting until they time out.
              </p>
              <div className="flex flex-wrap gap-2">
                {testDevices.map((d) => (
                  <button key={d.id} onClick={() => run({ action: 'test-device', deviceId: d.id })} disabled={busy}
                    className="px-3 py-1.5 rounded border border-gray-300 bg-white text-sm text-gray-900 hover:bg-gray-50 disabled:opacity-50">
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {setup.sandbox && setup.enabled && testDevices.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-sm text-gray-700">Sandbox: switch to another simulated Terminal to test what the till does.</p>
          <div className="flex flex-wrap gap-2">
            {testDevices.map((d) => (
              <button key={d.id} onClick={() => run({ action: 'test-device', deviceId: d.id })} disabled={busy || d.id === setup.deviceId}
                className={`px-3 py-1.5 rounded border text-sm disabled:opacity-60 ${d.id === setup.deviceId ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'}`}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {attention.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <h3 className="text-sm font-semibold text-red-800">Card payments needing attention</h3>
          <p className="text-xs text-gray-700">
            These were paid on the Terminal, but the till couldn&apos;t record them cleanly. Sort each one out by hand
            (record it in Banking, or refund it in Square), then mark it dealt with.
          </p>
          {attention.map((a) => (
            <div key={a.id} className="rounded-md border border-red-200 bg-red-50 p-3 space-y-1">
              <div className="flex flex-wrap justify-between gap-2 text-sm text-gray-900">
                <span className="font-medium">
                  {KIND_LABELS[a.kind] || a.kind} — £{(a.amountPence / 100).toFixed(2)}
                  {a.payload.userName ? ` — ${a.payload.userName}` : ''}
                </span>
                <span className="text-gray-700">{new Date(a.createdAt).toLocaleString('en-GB')}</span>
              </div>
              <p className="text-sm text-red-800">{a.recordError}</p>
              <p className="text-xs text-gray-700">
                {a.recorded ? 'It was recorded, but check the amount.' : 'Nothing was recorded.'} Square checkout{' '}
                <span className="font-mono">{a.id}</span>{a.payload.staff ? `, served by ${a.payload.staff}` : ''}.
              </p>
              <button onClick={() => run({ action: 'dealt-with', id: a.id })} disabled={busy}
                className="text-sm font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50">Mark dealt with</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
