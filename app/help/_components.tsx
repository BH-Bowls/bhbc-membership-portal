// app/help/_components.tsx
// Shared UI components for all help pages

'use client';

import { useRouter } from 'next/navigation';

export function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      {children}
    </section>
  );
}

export function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3 last:mb-0">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="text-sm text-gray-700 leading-relaxed">{children}</div>
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 mb-4">
      {children}
    </div>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 mb-4">
      {children}
    </div>
  );
}

export function Body({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-700 leading-relaxed mb-3 last:mb-0">{children}</p>;
}

export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="text-blue-600 hover:text-blue-800 text-sm flex items-center gap-1 mb-2"
    >
      ← {label}
    </button>
  );
}
