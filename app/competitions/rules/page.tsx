// app/competitions/rules/page.tsx
// Public competition rules & markers' instructions page. Fully data-driven: the three
// shared sections (General Rules, Standard Scoring Procedure, Marker Responsibilities)
// come from CompetitionsSettings, and each competition's rules come from its row in
// CompetitionsControl (compDescription + extraDescription + markersNotes). Committee
// edit the text in the sheets (or via the /competitions box and each competition page).
//
// Publicly readable and PIN-exempt (see middleware.ts) so it can be linked from the
// club's website. Deep-linked per competition via #<compId> (see competition-rules.ts).

'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useNavbarConfig } from '@/lib/navbar-config';
import { RichText } from '@/components/RichText';
import type { CompType } from '@/types/competitions';

const TYPE_LABELS: Record<CompType, string> = {
  singles: 'Singles',
  pairs: 'Pairs',
  triples: 'Triples',
};

// The per-competition rules shape returned by /api/competitions/rules-text.
interface CompRules {
  compId: string;
  displayName: string;
  compType: CompType;
  compDescription: string;
  extraDescription: string;
  markersNotes: string;
}

interface RulesText {
  generalRules: string;
  scoringProcedure: string;
  markerResponsibilities: string;
}

// Section headings sit under a sticky navbar, so give anchored jumps breathing room.
const SECTION = 'scroll-mt-24';

export default function CompetitionRulesPage() {
  const { data: session, status } = useSession();
  const isGuest = status === 'unauthenticated';
  const router = useRouter();

  const [competitions, setCompetitions] = useState<CompRules[]>([]);
  const [rulesText, setRulesText] = useState<RulesText>({ generalRules: '', scoringProcedure: '', markerResponsibilities: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/competitions/rules-text')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setCompetitions(data.competitions || []);
        setRulesText({
          generalRules: data.generalRules || '',
          scoringProcedure: data.scoringProcedure || '',
          markerResponsibilities: data.markerResponsibilities || '',
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Table of contents: the three shared sections, then one entry per competition.
  const contents: { id: string; label: string }[] = [
    { id: 'general', label: 'General Rules' },
    { id: 'scoring', label: 'Standard Scoring Procedure' },
    { id: 'markers', label: 'Marker Responsibilities' },
    ...competitions.map((c) => ({ id: c.compId, label: c.displayName })),
  ];

  useNavbarConfig({ showLogoOnly: isGuest });

  return (
    <div className="min-h-screen bg-gray-50">

      <div className="container mx-auto px-4 py-8 max-w-3xl">
        {/* Print-only club heading (the nav is hidden when printing) */}
        <p className="hidden print:block text-sm text-gray-700 mb-2">
          Burgess Hill Bowls Club — Competition Rules
        </p>

        {/* Header */}
        <button
          onClick={() => router.push('/competitions')}
          className="print:hidden text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-3"
        >
          ← All Competitions
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Competition Rules</h1>
            <p className="text-gray-700 mt-1">Rules &amp; markers&apos; instructions for all club competitions.</p>
          </div>
          <button
            onClick={() => window.print()}
            className="print:hidden shrink-0 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6v-8z" />
            </svg>
            Print this Guide
          </button>
        </div>

        {loading && <div className="text-center py-12 text-gray-400">Loading rules…</div>}
        {error && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        )}

        {!loading && !error && (
          <>
            {/* Contents */}
            <nav className="print:hidden mt-6 mb-8 bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Contents</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {contents.map((c) => (
                  <li key={c.id}>
                    <a href={`#${c.id}`} className="text-blue-600 hover:text-blue-800 hover:underline">
                      {c.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="space-y-10">
              {/* Shared sections */}
              <section id="general" className={SECTION}>
                <h2 className="text-xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-4">General Rules</h2>
                <RichText text={rulesText.generalRules} className="text-gray-800 text-sm leading-relaxed" />
              </section>

              <section id="scoring" className={SECTION}>
                <h2 className="text-xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-4">Standard Scoring Procedure</h2>
                <RichText text={rulesText.scoringProcedure} className="text-gray-800 text-sm leading-relaxed" />
              </section>

              <section id="markers" className={SECTION}>
                <h2 className="text-xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-4">Marker Responsibilities</h2>
                <RichText text={rulesText.markerResponsibilities} className="text-gray-800 text-sm leading-relaxed" />
              </section>

              {/* One section per competition (Control-sheet order) */}
              {competitions.map((comp) => (
                <section key={comp.compId} id={comp.compId} className={SECTION}>
                  <h2 className="text-xl font-bold text-gray-900 border-b border-gray-200 pb-2 mb-4">
                    {comp.displayName}
                  </h2>
                  <p className="text-sm text-gray-800 mb-1">
                    <span className="font-semibold">Format: </span>{TYPE_LABELS[comp.compType]}
                  </p>
                  <RichText text={comp.compDescription} className="text-gray-800 text-sm leading-relaxed" />

                  {comp.extraDescription && comp.extraDescription.trim() && (
                    <RichText text={comp.extraDescription} className="text-gray-800 text-sm leading-relaxed mt-3" />
                  )}

                  {comp.markersNotes && comp.markersNotes.trim() && (
                    <div className="mt-3">
                      <h3 className="text-sm font-semibold text-gray-900 mb-1">Markers&apos; Instructions</h3>
                      <RichText text={comp.markersNotes} className="text-gray-800 text-sm leading-relaxed" />
                    </div>
                  )}
                </section>
              ))}
            </div>

            <div className="print:hidden mt-10 pt-6 border-t border-gray-200">
              <a href="#" className="text-sm text-blue-600 hover:text-blue-800 hover:underline">↑ Back to top</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
