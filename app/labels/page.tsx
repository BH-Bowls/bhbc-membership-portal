'use client';

// app/labels/page.tsx
// Label printing — Address, Booklet, Locker, and Membership Card labels using Avery L7163 layout.
// Locker labels print from the Locker Register (/admin/lockers), not the member list.

import { useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { hasRole } from '@/lib/role-utils';
import { validUntilLabel } from '@/lib/membership-card';
import { LOCKER_ROOMS } from '@/types/lockers';
import type { LockerRoom, LockerWithMember } from '@/types/lockers';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LabelConfig {
  booklet_label_message: string;
  banner_url: string;
  label_width_mm: string;
  label_height_mm: string;
  top_margin_mm: string;
  left_margin_mm: string;
  column_gap_mm: string;
  row_gap_mm: string;
  labels_per_row: string;
  labels_per_col: string;
  printer_margin_mm: string;
}

interface LabelMember {
  fullName: string;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  postCode: string | null;
  memberType: string;
  include: string | null;
  userName: string;
  honorary: boolean;
  latestRenewedSeasonYear: number | null;
  // Set on locker labels only (built from the Locker Register)
  locker?: { room: LockerRoom; lockerNumber: number };
}

type LabelType = 'address' | 'booklet' | 'locker' | 'card';
type MemberFilter = 'all' | 'include' | 'manual';
type LockerFilter = 'allocated' | 'all' | 'manual';

// What a locker label says under its number: the allocated member, else "Club
// Locker" for club lockers, else nothing (an unknown occupant or an empty locker).
function lockerLabelName(l: LockerWithMember): string {
  if (l.memberName) return l.memberName;
  if (l.status === 'club') return 'Club Locker';
  return '';
}

function lockerToLabel(l: LockerWithMember): LabelMember {
  return {
    fullName: lockerLabelName(l),
    address1: null, address2: null, address3: null, postCode: null,
    memberType: '', include: null,
    userName: l.userName || '', honorary: false, latestRenewedSeasonYear: null,
    locker: { room: l.room, lockerNumber: l.lockerNumber },
  };
}

const DEFAULT_CONFIG: LabelConfig = {
  booklet_label_message: 'Valid to 28th February 2027',
  banner_url: '/Booklet Label Pic.jpg',
  label_width_mm: '99.1',
  label_height_mm: '38.1',
  top_margin_mm: '15.15',
  left_margin_mm: '4.76',
  column_gap_mm: '2.54',
  row_gap_mm: '0',
  labels_per_row: '2',
  labels_per_col: '7',
  printer_margin_mm: '3',
};

// ── Label components ──────────────────────────────────────────────────────────

function AddressLabel({ member, widthMm, heightMm }: { member: LabelMember; widthMm: number; heightMm: number }) {
  return (
    <div style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, padding: '3mm 4mm', boxSizing: 'border-box', overflow: 'hidden', fontFamily: 'Arial, sans-serif', fontSize: '10pt', lineHeight: '1.35' }}>
      <div style={{ fontWeight: 'bold' }}>{member.fullName}</div>
      {member.address1 && <div>{member.address1}</div>}
      {member.address2 && <div>{member.address2}</div>}
      {member.address3 && <div>{member.address3}</div>}
      {member.postCode && <div>{member.postCode}</div>}
    </div>
  );
}

function BookletLabel({ member, config, widthMm, heightMm }: { member: LabelMember; config: LabelConfig; widthMm: number; heightMm: number }) {
  return (
    <div style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, boxSizing: 'border-box', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
      {/* Banner image — full width */}
      <img
        src={config.banner_url}
        alt=""
        style={{ width: '100%', display: 'block', objectFit: 'cover', maxHeight: '18mm' }}
      />
      {/* Text content below banner */}
      <div style={{ padding: '1mm 3mm', fontSize: '8pt', lineHeight: '1.3' }}>
        <div style={{ fontWeight: 'bold', fontSize: '9pt' }}>{member.fullName}</div>
        <div>{member.memberType}</div>
        <div>{config.booklet_label_message}</div>
      </div>
    </div>
  );
}

function LockerLabel({ member, widthMm, heightMm }: { member: LabelMember; widthMm: number; heightMm: number }) {
  if (member.locker) {
    return (
      <div style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: '4mm', padding: '2mm 5mm', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center', flexShrink: 0, minWidth: '22mm' }}>
          <div style={{ fontSize: '36pt', fontWeight: 'bold', lineHeight: '1' }}>{member.locker.lockerNumber}</div>
          <div style={{ fontSize: '7pt', color: '#6b7280', marginTop: '1mm' }}>{member.locker.room}</div>
        </div>
        {member.fullName && (
          <div style={{ fontSize: '16pt', fontWeight: 'bold', lineHeight: '1.2' }}>{member.fullName}</div>
        )}
      </div>
    );
  }
  return (
    <div style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2mm', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ fontSize: '18pt', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>{member.fullName}</div>
    </div>
  );
}

// Credit-card dimensions (ISO/IEC 7810 ID-1).
const CARD_WIDTH_MM = 85.6;
const CARD_HEIGHT_MM = 53.98;
// Gap kept between the card's cut line and the label edge, so the outline still
// prints if the sheet feeds slightly off.
const CARD_INSET_MM = 1;

// The My Account membership card (app/account/page.tsx) with its QR "back" folded
// in on the right, so one card carries both. Drawn as a cut-out outline centred on
// the label: credit-card width, and credit-card height when the label is tall
// enough (otherwise as tall as the label allows). White background to save ink.
// The QR encodes the username, same as the on-screen card, for the till lookup.
function CardLabel({ member, qrSrc, widthMm, heightMm }: { member: LabelMember; qrSrc: string | undefined; widthMm: number; heightMm: number }) {
  const validity = validUntilLabel(member);
  const cardW = Math.min(CARD_WIDTH_MM, widthMm - 2 * CARD_INSET_MM);
  const cardH = Math.min(CARD_HEIGHT_MM, heightMm - 2 * CARD_INSET_MM);
  const qrMm = Math.min(cardH - 11, 30);
  return (
    <div style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ width: `${cardW}mm`, height: `${cardH}mm`, boxSizing: 'border-box', border: '0.2mm solid #9ca3af', borderRadius: '3mm', display: 'flex', alignItems: 'center', padding: '3mm', gap: '3mm', color: '#111827' }}>
        <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2mm' }}>
            <img src="/bhbc-logo.jpg" alt="" style={{ height: '9mm', width: 'auto' }} />
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '9pt', lineHeight: '1.15', color: '#1e3a8a' }}>Burgess Hill Bowls Club</div>
              <div style={{ fontSize: '6.5pt', color: '#6b7280' }}>Membership Card</div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12pt', fontWeight: 600, lineHeight: '1.15', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{member.fullName}</div>
            <div style={{ fontSize: '7pt', marginTop: '0.5mm', color: validity.renewalDue ? '#b45309' : '#4b5563', fontWeight: validity.renewalDue ? 600 : 400 }}>{validity.text}</div>
          </div>
        </div>
        {qrSrc && <img src={qrSrc} alt="" style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, flexShrink: 0 }} />}
      </div>
    </div>
  );
}

function LabelContent({ type, member, config, qrCodes }: { type: LabelType; member: LabelMember; config: LabelConfig; qrCodes: Record<string, string> }) {
  const w = parseFloat(config.label_width_mm);
  const h = parseFloat(config.label_height_mm);
  if (type === 'address') return <AddressLabel member={member} widthMm={w} heightMm={h} />;
  if (type === 'booklet') return <BookletLabel member={member} config={config} widthMm={w} heightMm={h} />;
  if (type === 'card') return <CardLabel member={member} qrSrc={qrCodes[member.userName]} widthMm={w} heightMm={h} />;
  return <LockerLabel member={member} widthMm={w} heightMm={h} />;
}

// ── Label sheet ───────────────────────────────────────────────────────────────

function LabelSheet({ labelsOnSheet, type, config, qrCodes, skipCount = 0 }: { labelsOnSheet: LabelMember[]; type: LabelType; config: LabelConfig; qrCodes: Record<string, string>; skipCount?: number }) {
  const w = parseFloat(config.label_width_mm);
  const h = parseFloat(config.label_height_mm);
  const top = parseFloat(config.top_margin_mm);
  const left = parseFloat(config.left_margin_mm);
  const colGap = parseFloat(config.column_gap_mm);
  const rowGap = parseFloat(config.row_gap_mm);
  const cols = parseInt(config.labels_per_row);
  // @page uses top/bottom margin only (no left/right), so the full 210mm width is
  // available and paddingLeft maps 1:1 to paper position.
  const pm = parseFloat(config.printer_margin_mm || '0');
  const pageW = 210;
  const pageH = 297 - 2 * pm;

  return (
    <div style={{ width: `${pageW}mm`, minHeight: `${pageH}mm`, backgroundColor: 'white', boxSizing: 'border-box', paddingTop: `${top - pm}mm`, paddingLeft: `${left}mm` }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, ${w}mm)`,
        columnGap: `${colGap}mm`,
        rowGap: `${rowGap}mm`,
      }}>
        {Array.from({ length: skipCount }).map((_, i) => (
          <div key={`skip-${i}`} style={{ width: `${w}mm`, height: `${h}mm` }} />
        ))}
        {labelsOnSheet.map((member, i) => (
          <div key={i} style={{ width: `${w}mm`, height: `${h}mm`, overflow: 'hidden', border: '0.1mm dashed #ccc' }} className="label-cell">
            <LabelContent type={type} member={member} config={config} qrCodes={qrCodes} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LabelsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [config, setConfig] = useState<LabelConfig>(DEFAULT_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);

  const [members, setMembers] = useState<LabelMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [labelType, setLabelType] = useState<LabelType>('address');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all');
  const [sortOrder, setSortOrder] = useState<'original' | 'lastName'>('original');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState(1);
  const [skipLabels, setSkipLabels] = useState(0);

  // Locker labels — from the Locker Register, loaded the first time Locker is picked
  const [lockers, setLockers] = useState<LockerWithMember[] | null>(null);
  const [lockerRoom, setLockerRoom] = useState<'all' | LockerRoom>('all');
  const [lockerFilter, setLockerFilter] = useState<LockerFilter>('allocated');
  const [selectedLockerIds, setSelectedLockerIds] = useState<Set<string>>(new Set());

  // Auth guard
  useEffect(() => {
    if (status === 'loading') return;
    if (!session || !hasRole(session.user?.role, 'Admin')) {
      router.push('/');
    }
  }, [session, status, router]);

  // Load config (read-only here — edited at /admin/config's Labels tab)
  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig({ ...DEFAULT_CONFIG, ...data.config });
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoading(false));
  }, []);

  // Load members
  useEffect(() => {
    fetch('/api/admin/labels/members')
      .then((r) => r.json())
      .then((data) => { if (data.members) setMembers(data.members); })
      .catch(() => {})
      .finally(() => setMembersLoading(false));
  }, []);

  useEffect(() => {
    if (labelType !== 'locker' || lockers !== null) return;
    fetch('/api/admin/lockers')
      .then((r) => r.json())
      .then((data) => setLockers(data.lockers || []))
      .catch(() => setLockers([]));
  }, [labelType, lockers]);

  const lockersInRoom = useMemo(
    () => (lockers || []).filter((l) => lockerRoom === 'all' || l.room === lockerRoom),
    [lockers, lockerRoom]
  );

  // QR codes (as SVG data URIs, so they print crisp) for membership card labels,
  // keyed by username — generated on demand for whoever is selected.
  const [qrCodes, setQrCodes] = useState<Record<string, string>>({});

  // Filtered members for manual selection list
  const filteredForSearch = useMemo(() => {
    if (!searchTerm) return members;
    const term = searchTerm.toLowerCase();
    return members.filter((m) => m.fullName.toLowerCase().includes(term));
  }, [members, searchTerm]);

  // Members that will appear on labels
  const selectedMembers = useMemo(() => {
    if (labelType === 'locker') {
      let chosen = lockersInRoom;
      if (lockerFilter === 'allocated') chosen = chosen.filter((l) => l.status !== 'empty');
      else if (lockerFilter === 'manual') chosen = chosen.filter((l) => selectedLockerIds.has(l.id));
      return chosen.map(lockerToLabel);
    }
    let list: LabelMember[];
    if (memberFilter === 'all') list = members;
    else if (memberFilter === 'include') list = members.filter((m) => m.include === 'Y');
    else list = members.filter((m) => selectedNames.has(m.fullName));

    if (sortOrder === 'lastName') {
      const lastName = (m: LabelMember) => {
        const parts = m.fullName.trim().split(/\s+/);
        return parts[parts.length - 1].toLowerCase();
      };
      return [...list].sort((a, b) => lastName(a).localeCompare(lastName(b)));
    }
    return list;
  }, [labelType, lockersInRoom, lockerFilter, selectedLockerIds, members, memberFilter, selectedNames, sortOrder]);

  useEffect(() => {
    if (labelType !== 'card') return;
    const missing = selectedMembers.map((m) => m.userName).filter((u) => u && !qrCodes[u]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((u) =>
        QRCode.toString(u, { type: 'svg', margin: 0 })
          .then((svg) => [u, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)] as const)
          .catch(() => null)
      )
    ).then((results) => {
      if (cancelled) return;
      setQrCodes((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [labelType, selectedMembers, qrCodes]);

  // Expand for copies
  const labelList = useMemo(() => {
    const list: LabelMember[] = [];
    for (const m of selectedMembers) {
      for (let i = 0; i < copies; i++) list.push(m);
    }
    return list;
  }, [selectedMembers, copies]);

  // Split into sheets (first sheet may have fewer slots due to skip)
  const labelsPerSheet = parseInt(config.labels_per_row) * parseInt(config.labels_per_col);
  const sheets = useMemo(() => {
    const result: LabelMember[][] = [];
    if (labelList.length === 0) return result;
    const firstCapacity = Math.max(0, labelsPerSheet - skipLabels);
    result.push(labelList.slice(0, firstCapacity));
    for (let i = firstCapacity; i < labelList.length; i += labelsPerSheet) {
      result.push(labelList.slice(i, i + labelsPerSheet));
    }
    return result;
  }, [labelList, labelsPerSheet, skipLabels]);

  function toggleLocker(id: string) {
    setSelectedLockerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(name: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (status === 'loading' || configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!session || !hasRole(session.user?.role, 'Admin')) return null;

  const isLocker = labelType === 'locker';
  const labelTypeLabel = { address: 'Address', booklet: 'Booklet', locker: 'Locker', card: 'Membership Card' };

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media screen { #print-area { display: none; } }
        @media print {
          .screen-only { display: none !important; }
          #print-area { display: block; }
          #print-area .label-cell { border: none !important; }
          @page { size: A4 portrait; margin: ${parseFloat(config.printer_margin_mm || '3')}mm 0; }
        }
      `}</style>

      {/* Print area — hidden on screen, shown when printing */}
      <div id="print-area">
        {sheets.map((sheet, i) => (
          <div key={i} style={{ pageBreakAfter: i < sheets.length - 1 ? 'always' : 'auto' }}>
            <LabelSheet labelsOnSheet={sheet} type={labelType} config={config} qrCodes={qrCodes} skipCount={i === 0 ? skipLabels : 0} />
          </div>
        ))}
      </div>

      {/* Screen content — hidden when printing */}
      <div className="screen-only min-h-screen bg-gray-50">

      <main className="max-w-5xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 sm:px-0 space-y-6">

          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Print Labels</h1>
            {labelList.length > 0 && (
              <button
                onClick={() => window.print()}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
              >
                Print {labelList.length} label{labelList.length !== 1 ? 's' : ''} ({sheets.length} sheet{sheets.length !== 1 ? 's' : ''})
              </button>
            )}
          </div>

          {/* ── Label type ── */}
          <div className="bg-white shadow rounded-lg p-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Label type</h2>
            <div className="flex gap-4">
              {(['address', 'booklet', 'locker', 'card'] as LabelType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="labelType" value={t} checked={labelType === t} onChange={() => setLabelType(t)} className="text-blue-600" />
                  <span className="text-sm text-gray-700">{labelTypeLabel[t]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Members (or Lockers) ── */}
          <div className="bg-white shadow rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">{isLocker ? 'Lockers' : 'Members'}</h2>
              {isLocker && <Link href="/admin/lockers" className="text-sm text-blue-600 hover:text-blue-800">Locker Register →</Link>}
            </div>

            {isLocker && (
              <>
                <div className="flex flex-wrap gap-4">
                  {([['all', 'Both rooms'], ...LOCKER_ROOMS.map((r) => [r, r])] as ['all' | LockerRoom, string][]).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="lockerRoom" value={v} checked={lockerRoom === v} onChange={() => setLockerRoom(v)} className="text-blue-600" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap gap-4">
                  {([['allocated', 'In use (not empty)'], ['all', 'All lockers (empty ones print number only)'], ['manual', 'Manual selection']] as [LockerFilter, string][]).map(([v, label]) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="lockerFilter" value={v} checked={lockerFilter === v} onChange={() => setLockerFilter(v)} className="text-blue-600" />
                      <span className="text-sm text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            {/* Filter */}
            {!isLocker && <>
            <div className="flex gap-4">
              {([['all', 'All members'], ['include', 'Include = Y only'], ['manual', 'Manual selection']] as [MemberFilter, string][]).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="memberFilter" value={v} checked={memberFilter === v} onChange={() => setMemberFilter(v)} className="text-blue-600" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>

            {/* Sort order */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Sort order</span>
              {([['original', 'Original order'], ['lastName', 'Last name A–Z']] as ['original' | 'lastName', string][]).map(([v, label]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="sortOrder" value={v} checked={sortOrder === v} onChange={() => setSortOrder(v)} className="text-blue-600" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
            </>}

            {/* Copies / skip */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700 whitespace-nowrap">Skip labels</label>
                <input
                  type="number"
                  min={0}
                  max={labelsPerSheet - 1}
                  value={skipLabels}
                  onChange={(e) => setSkipLabels(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700 whitespace-nowrap">Copies per {isLocker ? 'locker' : 'member'}</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={copies}
                  onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 border border-gray-300 rounded-md px-2 py-1 text-sm text-center"
                />
              </div>
            </div>

            {isLocker && lockerFilter === 'manual' && (
              <div className="space-y-2">
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                  {lockers === null ? (
                    <p className="text-sm text-gray-500 p-3">Loading...</p>
                  ) : lockersInRoom.length === 0 ? (
                    <p className="text-sm text-gray-500 p-3">No lockers found</p>
                  ) : (
                    lockersInRoom.map((l) => (
                      <label key={l.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedLockerIds.has(l.id)}
                          onChange={() => toggleLocker(l.id)}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-900">{l.room} {l.lockerNumber}</span>
                        <span className="text-sm text-gray-600">{lockerLabelName(l)}</span>
                      </label>
                    ))
                  )}
                </div>
                {selectedLockerIds.size > 0 && (
                  <p className="text-xs text-gray-500">{selectedLockerIds.size} locker{selectedLockerIds.size !== 1 ? 's' : ''} selected</p>
                )}
              </div>
            )}

            {isLocker && lockerFilter !== 'manual' && lockers !== null && (
              <p className="text-sm text-gray-500">
                {selectedMembers.length} locker{selectedMembers.length !== 1 ? 's' : ''}
                {copies > 1 ? ` × ${copies} copies = ${labelList.length} labels` : ''}
              </p>
            )}

            {!isLocker && memberFilter === 'manual' && (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Search members..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                  {membersLoading ? (
                    <p className="text-sm text-gray-500 p-3">Loading...</p>
                  ) : filteredForSearch.length === 0 ? (
                    <p className="text-sm text-gray-500 p-3">No members found</p>
                  ) : (
                    filteredForSearch.map((m) => (
                      <label key={m.fullName} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedNames.has(m.fullName)}
                          onChange={() => toggleSelected(m.fullName)}
                          className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-900">{m.fullName}</span>
                        <span className="text-xs text-gray-400 ml-auto">{m.memberType}</span>
                      </label>
                    ))
                  )}
                </div>
                {selectedNames.size > 0 && (
                  <p className="text-xs text-gray-500">{selectedNames.size} member{selectedNames.size !== 1 ? 's' : ''} selected</p>
                )}
              </div>
            )}

            {!isLocker && memberFilter !== 'manual' && !membersLoading && (
              <p className="text-sm text-gray-500">
                {selectedMembers.length} member{selectedMembers.length !== 1 ? 's' : ''}
                {copies > 1 ? ` × ${copies} copies = ${labelList.length} labels` : ''}
              </p>
            )}
          </div>

          {/* ── Config ── */}
          <div className="bg-white shadow rounded-lg p-4 flex items-center justify-between">
            <span className="text-sm text-gray-500">Label dimensions, margins, and booklet message are configured in Admin &gt; Config.</span>
            <Link href="/admin/config" className="text-sm text-blue-600 hover:text-blue-800 whitespace-nowrap">Edit label config →</Link>
          </div>

          {/* ── Preview ── */}
          {labelList.length > 0 && (
            <div className="bg-white shadow rounded-lg p-4">
              <h2 className="text-sm font-medium text-gray-700 mb-3">
                Preview — {labelList.length} label{labelList.length !== 1 ? 's' : ''} on {sheets.length} sheet{sheets.length !== 1 ? 's' : ''}
              </h2>
              <div className="overflow-x-auto space-y-6">
                {sheets.map((sheet, i) => (
                  <div key={i}>
                    {sheets.length > 1 && <p className="text-xs text-gray-400 mb-1">Sheet {i + 1}</p>}
                    {/* Scale preview to fit screen */}
                    <div style={{ transform: 'scale(0.55)', transformOrigin: 'top left', width: '210mm', marginBottom: '-130mm' }}>
                      <LabelSheet labelsOnSheet={sheet} type={labelType} config={config} qrCodes={qrCodes} skipCount={i === 0 ? skipLabels : 0} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {labelList.length === 0 && (isLocker ? lockers !== null : !membersLoading) && (
            <div className="bg-white shadow rounded-lg p-8 text-center text-sm text-gray-500">
              {isLocker
                ? (lockerFilter === 'manual' ? 'Select lockers above to preview labels.' : 'No lockers match the selected filter.')
                : (memberFilter === 'manual' ? 'Select members above to preview labels.' : 'No members match the selected filter.')}
            </div>
          )}

        </div>
      </main>
      </div>
    </>
  );
}
