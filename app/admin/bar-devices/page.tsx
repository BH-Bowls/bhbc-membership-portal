'use client';

// app/admin/bar-devices/page.tsx
// Admin-managed allowlist of tablets that may log in as the bar till (role 'Bar').
// A device registers itself as pending (app/bar/page.tsx, on first run) and shows a
// pairing code on screen; approving here requires typing that same code, so a device
// can't be approved blind. Admin only.

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
import { getInputClasses, getCardClasses, getAlertClasses } from '@/config/theme-helpers';

interface BarTrustedDevice {
  id: string;
  label: string | null;
  pairingCode: string;
  approved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

export default function BarDevicesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [devices, setDevices] = useState<BarTrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session || !hasRole(session.user?.role, 'Admin')) router.push('/');
  }, [session, status, router]);

  function load() {
    fetch('/api/admin/bar-devices')
      .then((r) => r.json())
      .then((data) => {
        if (data.devices) setDevices(data.devices);
        else setError(data.error || 'Failed to load devices');
      })
      .catch(() => setError('Failed to load devices'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function approve(id: string) {
    if (!pairingCode.trim() || !label.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/bar-devices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', deviceId: id, pairingCode: pairingCode.trim(), label: label.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Approve failed');
      setApprovingId(null); setPairingCode(''); setLabel('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this device? It will be rejected the next time it tries to log in.')) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/bar-devices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', deviceId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Revoke failed');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }
  if (!session || !hasRole(session.user?.role, 'Admin')) return null;

  const pending = devices.filter((d) => !d.approved && !d.revokedAt);
  const approved = devices.filter((d) => d.approved && !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Bar Till Devices</h1>
        <p className="text-sm text-gray-700">
          Only devices approved here can log in as the bar till. A new device shows a
          pairing code on its own screen — read it off the physical tablet and enter it
          below to approve it.
        </p>

        {error && <div className={getAlertClasses('danger')}>{error}</div>}

        <div className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-sm font-medium text-gray-700">Pending</h2>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-500">No devices waiting for approval.</p>
          ) : pending.map((d) => (
            <div key={d.id} className="border border-gray-200 rounded-md p-3 space-y-2">
              <div className="text-sm text-gray-700">
                Registered {new Date(d.createdAt).toLocaleString('en-GB')} — id ends <span className="font-mono">{d.id.slice(-8)}</span>
              </div>
              {approvingId === d.id ? (
                <div className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label className="block text-[10px] text-gray-500">Pairing code (from the till's screen)</label>
                    <input value={pairingCode} onChange={(e) => setPairingCode(e.target.value)} className={`${getInputClasses()} w-32`} />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500">Label</label>
                    <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Clubhouse iPad" className={`${getInputClasses()} w-48`} />
                  </div>
                  <button onClick={() => approve(d.id)} disabled={busy} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium disabled:opacity-50">Confirm</button>
                  <button onClick={() => { setApprovingId(null); setPairingCode(''); setLabel(''); }} className="text-sm text-gray-500">Cancel</button>
                </div>
              ) : (
                <button onClick={() => { setApprovingId(d.id); setPairingCode(''); setLabel(''); }} className="text-sm text-blue-600 hover:text-blue-800">Approve…</button>
              )}
            </div>
          ))}
        </div>

        <div className={`${getCardClasses('md')} space-y-3`}>
          <h2 className="text-sm font-medium text-gray-700">Approved</h2>
          {approved.length === 0 ? (
            <p className="text-sm text-gray-500">No approved devices yet.</p>
          ) : approved.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
              <span>{d.label} <span className="text-gray-400">— approved {d.approvedAt && new Date(d.approvedAt).toLocaleDateString('en-GB')} by {d.approvedBy}</span></span>
              <button onClick={() => revoke(d.id)} disabled={busy} className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50">Revoke</button>
            </div>
          ))}
        </div>

        {revoked.length > 0 && (
          <div className={`${getCardClasses('md')} space-y-3`}>
            <h2 className="text-sm font-medium text-gray-700">Revoked</h2>
            {revoked.map((d) => (
              <div key={d.id} className="text-sm text-gray-400 py-1">
                {d.label || d.id.slice(-8)} — revoked {d.revokedAt && new Date(d.revokedAt).toLocaleDateString('en-GB')} by {d.revokedBy}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
