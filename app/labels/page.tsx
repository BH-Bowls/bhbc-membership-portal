'use client';

// app/labels/page.tsx
// Label printing — Address, Booklet, and Locker labels using Avery L7163 layout

import { useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { hasRole } from '@/lib/role-utils';

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
}

type LabelType = 'address' | 'booklet' | 'locker';
type MemberFilter = 'all' | 'include' | 'manual';

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
  return (
    <div style={{ width: `${widthMm}mm`, height: `${heightMm}mm`, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2mm', overflow: 'hidden', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ fontSize: '18pt', fontWeight: 'bold', textAlign: 'center', lineHeight: '1.2' }}>{member.fullName}</div>
    </div>
  );
}

function LabelContent({ type, member, config }: { type: LabelType; member: LabelMember; config: LabelConfig }) {
  const w = parseFloat(config.label_width_mm);
  const h = parseFloat(config.label_height_mm);
  if (type === 'address') return <AddressLabel member={member} widthMm={w} heightMm={h} />;
  if (type === 'booklet') return <BookletLabel member={member} config={config} widthMm={w} heightMm={h} />;
  return <LockerLabel member={member} widthMm={w} heightMm={h} />;
}

// ── Label sheet ───────────────────────────────────────────────────────────────

function LabelSheet({ labelsOnSheet, type, config, skipCount = 0 }: { labelsOnSheet: LabelMember[]; type: LabelType; config: LabelConfig; skipCount?: number }) {
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
            <LabelContent type={type} member={member} config={config} />
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
  const [editConfig, setEditConfig] = useState<LabelConfig>(DEFAULT_CONFIG);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  const [members, setMembers] = useState<LabelMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const [labelType, setLabelType] = useState<LabelType>('address');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState(1);
  const [skipLabels, setSkipLabels] = useState(0);

  // Auth guard
  useEffect(() => {
    if (status === 'loading') return;
    if (!session || !hasRole(session.user?.role, 'Admin')) {
      router.push('/');
    }
  }, [session, status, router]);

  // Load config
  useEffect(() => {
    fetch('/api/admin/labels/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          const merged = { ...DEFAULT_CONFIG, ...data.config };
          setConfig(merged);
          setEditConfig(merged);
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

  // Filtered members for manual selection list
  const filteredForSearch = useMemo(() => {
    if (!searchTerm) return members;
    const term = searchTerm.toLowerCase();
    return members.filter((m) => m.fullName.toLowerCase().includes(term));
  }, [members, searchTerm]);

  // Members that will appear on labels
  const selectedMembers = useMemo(() => {
    if (memberFilter === 'all') return members;
    if (memberFilter === 'include') return members.filter((m) => m.include === 'Y');
    return members.filter((m) => selectedNames.has(m.fullName));
  }, [members, memberFilter, selectedNames]);

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

  function toggleSelected(name: string) {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function saveConfig() {
    setSavingConfig(true);
    try {
      await fetch('/api/admin/labels/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editConfig),
      });
      setConfig(editConfig);
      setIsEditingConfig(false);
    } catch {
      alert('Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  }

  if (status === 'loading' || configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!session || !hasRole(session.user?.role, 'Admin')) return null;

  const labelTypeLabel = { address: 'Address', booklet: 'Booklet', locker: 'Locker' };

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
            <LabelSheet labelsOnSheet={sheet} type={labelType} config={config} skipCount={i === 0 ? skipLabels : 0} />
          </div>
        ))}
      </div>

      {/* Screen content — hidden when printing */}
      <div className="screen-only min-h-screen bg-gray-50">
      <Navbar userName={session.user?.name ?? undefined} userRole={session.user?.role ?? undefined} />

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
              {(['address', 'booklet', 'locker'] as LabelType[]).map((t) => (
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="labelType" value={t} checked={labelType === t} onChange={() => setLabelType(t)} className="text-blue-600" />
                  <span className="text-sm text-gray-700">{labelTypeLabel[t]}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ── Members ── */}
          <div className="bg-white shadow rounded-lg p-4 space-y-4">
            <h2 className="text-sm font-medium text-gray-700">Members</h2>

            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex gap-4">
                {([['all', 'All members'], ['include', 'Include = Y only'], ['manual', 'Manual selection']] as [MemberFilter, string][]).map(([v, label]) => (
                  <label key={v} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="memberFilter" value={v} checked={memberFilter === v} onChange={() => setMemberFilter(v)} className="text-blue-600" />
                    <span className="text-sm text-gray-700">{label}</span>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-4 ml-auto">
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
                  <label className="text-sm text-gray-700 whitespace-nowrap">Copies per member</label>
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
            </div>

            {memberFilter === 'manual' && (
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

            {memberFilter !== 'manual' && !membersLoading && (
              <p className="text-sm text-gray-500">
                {selectedMembers.length} member{selectedMembers.length !== 1 ? 's' : ''}
                {copies > 1 ? ` × ${copies} copies = ${labelList.length} labels` : ''}
              </p>
            )}
          </div>

          {/* ── Config ── */}
          <div className="bg-white shadow rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Label configuration</h2>
              {!isEditingConfig ? (
                <button onClick={() => setIsEditingConfig(true)} className="text-sm text-blue-600 hover:text-blue-800">Edit</button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => { setEditConfig(config); setIsEditingConfig(false); }} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                  <button onClick={saveConfig} disabled={savingConfig} className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
                    {savingConfig ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {([
                ['booklet_label_message', 'Booklet label message'],
                ['banner_url', 'Banner image URL'],
                ['label_width_mm', 'Label width (mm)'],
                ['label_height_mm', 'Label height (mm)'],
                ['top_margin_mm', 'Top margin (mm)'],
                ['left_margin_mm', 'Left margin (mm)'],
                ['column_gap_mm', 'Column gap (mm)'],
                ['row_gap_mm', 'Row gap (mm)'],
                ['labels_per_row', 'Labels per row'],
                ['labels_per_col', 'Labels per column'],
                ['printer_margin_mm', 'Printer margin (mm)'],
              ] as [keyof LabelConfig, string][]).map(([key, label]) => (
                <div key={key}>
                  <span className="text-gray-500">{label}: </span>
                  {isEditingConfig ? (
                    <input
                      type="text"
                      value={editConfig[key]}
                      onChange={(e) => setEditConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                      className="border border-gray-300 rounded px-2 py-0.5 text-sm w-full mt-0.5"
                    />
                  ) : (
                    <span className="text-gray-900">{config[key]}</span>
                  )}
                </div>
              ))}
            </div>
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
                      <LabelSheet labelsOnSheet={sheet} type={labelType} config={config} skipCount={i === 0 ? skipLabels : 0} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {labelList.length === 0 && !membersLoading && (
            <div className="bg-white shadow rounded-lg p-8 text-center text-sm text-gray-500">
              {memberFilter === 'manual' ? 'Select members above to preview labels.' : 'No members match the selected filter.'}
            </div>
          )}

        </div>
      </main>
      </div>
    </>
  );
}
