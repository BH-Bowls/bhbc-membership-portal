import Image from 'next/image';

export default function MaintenancePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-lg">
        <div className="flex flex-col items-center">
          <Image src="/bhbc-logo.jpg" alt="Burgess Hill Bowls Club" width={72} height={72} className="rounded-full" />
          <h1 className="mt-4 text-xl font-bold text-gray-900">Burgess Hill Bowls Club</h1>
        </div>
        <p className="mt-6 text-base font-semibold text-gray-900">Maintenance in progress</p>
        <p className="mt-2 text-sm text-gray-700">
          The portal is temporarily unavailable while we carry out some essential updates. Please check back later.
        </p>
      </div>
    </div>
  );
}
