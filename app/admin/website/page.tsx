// app/admin/website/page.tsx
// Landing page for the Website Admin section — links to each content type
// editable here, all backed by the "website" Supabase schema that the public
// bhbc-website site reads from. Access: Admin, Captain, GMC.

const SECTIONS: { name: string; href: string; description: string }[] = [
  { name: 'Committee', href: '/admin/website/committee', description: 'Committee list shown on /about' },
  { name: 'Coaches', href: '/admin/website/coaches', description: 'Coaches shown on /coaching' },
  { name: 'Announcements', href: '/admin/website/announcements', description: 'Home page announcement banners/cards' },
  { name: 'Internal Honours', href: '/admin/website/honours-internal', description: "One record per season — the club's own competition winners" },
  { name: 'External Honours', href: '/admin/website/honours-external', description: 'County/national/other external competition results' },
  { name: 'Rowland Cup Winners', href: '/admin/website/rowland-winners', description: 'Winning club per year, shown on /rowland' },
  { name: 'Documents', href: '/admin/website/documents', description: 'Upload PDFs shown on /documents' },
];

export default function WebsiteAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="mb-4">
            <a href="/" className="text-sm text-blue-500 hover:text-blue-600 font-medium">
              ← Back to Home
            </a>
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-2">Website Admin</h1>
          <p className="text-sm text-gray-700 mb-6">
            Content for the public bhbc-website site (burgesshillbowlsclub.com).
            Changes here appear on the live site within a few minutes.
          </p>

          <div className="space-y-3">
            {SECTIONS.map((section) => (
              <a
                key={section.href}
                href={section.href}
                className="block bg-white shadow rounded-lg p-5 hover:shadow-md transition-shadow"
              >
                <p className="font-semibold text-gray-900">{section.name}</p>
                <p className="text-sm text-gray-700">{section.description}</p>
              </a>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
