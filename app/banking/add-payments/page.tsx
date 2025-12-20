// app/banking/add-payments/page.tsx
// Bulk payment entry page for banking reconciliation

'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

interface PaymentRow {
  id: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH';
  reference: string;
  amount: string;
}

export default function AddPaymentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Check authorization
  const canAccess = session?.user?.role === 'Admin' || session?.user?.role === 'T';

  const [payments, setPayments] = useState<PaymentRow[]>([
    {
      id: crypto.randomUUID(),
      date: new Date().toISOString().split('T')[0],
      type: 'TRF',
      reference: '',
      amount: '',
    },
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  // Add a new empty row
  const addRow = () => {
    setPayments([
      ...payments,
      {
        id: crypto.randomUUID(),
        date: new Date().toISOString().split('T')[0],
        type: 'TRF',
        reference: '',
        amount: '',
      },
    ]);
  };

  // Remove a row
  const removeRow = (id: string) => {
    if (payments.length === 1) return; // Keep at least one row
    setPayments(payments.filter((p) => p.id !== id));
  };

  // Update a field in a row
  const updateRow = (id: string, field: keyof PaymentRow, value: string) => {
    setPayments(
      payments.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  // Validate and save all payments
  const handleSave = async () => {
    // Validate: check all fields are filled
    const invalidRows = payments.filter(
      (p) => !p.date || !p.type || !p.reference || !p.amount || isNaN(parseFloat(p.amount))
    );

    if (invalidRows.length > 0) {
      setError('Please fill in all fields with valid data before saving.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      // Save each payment via API
      for (const payment of payments) {
        const res = await fetch('/api/banking/payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'add',
            date: payment.date,
            type: payment.type,
            reference: payment.reference,
            amount: parseFloat(payment.amount),
          }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || 'Failed to add payment');
        }
      }

      // Success - redirect back to banking page
      router.push('/banking');
    } catch (err: any) {
      setError(err.message || 'Failed to save payments');
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    router.push('/banking');
  };

  // Redirect if not authorized
  if (status === 'authenticated' && !canAccess) {
    router.push('/');
    return null;
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />

      <main className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Add Payments</h1>
              <p className="mt-1 text-sm text-gray-500">
                Add multiple payments to the banking reconciliation system
              </p>
            </div>
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">×</button>
          </div>
        )}

        {/* Payments Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reference
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Amount (£)
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-20">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {payments.map((payment, index) => (
                  <tr key={payment.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="date"
                        value={payment.date}
                        onChange={(e) => updateRow(payment.id, 'date', e.target.value)}
                        className="block w-full border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={payment.type}
                        onChange={(e) => updateRow(payment.id, 'type', e.target.value)}
                        className="block w-full border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      >
                        <option value="TRF">TRF (Bank Transfer)</option>
                        <option value="CDM">CDM (Card Machine)</option>
                        <option value="CHQ">CHQ (Cheque)</option>
                        <option value="CSH">CSH (Cash)</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={payment.reference}
                        onChange={(e) => updateRow(payment.id, 'reference', e.target.value)}
                        placeholder="Payment reference"
                        className="block w-full border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        step="0.01"
                        value={payment.amount}
                        onChange={(e) => updateRow(payment.id, 'amount', e.target.value)}
                        placeholder="0.00"
                        className="block w-full border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => removeRow(payment.id)}
                        disabled={payments.length === 1}
                        className="text-red-600 hover:text-red-900 disabled:text-gray-400 disabled:cursor-not-allowed"
                        title="Remove row"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add Row Button */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
            <button
              onClick={addRow}
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-100 rounded-md hover:bg-indigo-200"
            >
              <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Row
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex justify-end space-x-3">
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : `Save ${payments.length} Payment${payments.length > 1 ? 's' : ''}`}
          </button>
        </div>

        {/* Summary */}
        <div className="mt-4 text-sm text-gray-500 text-right">
          Total: £{payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0).toFixed(2)}
        </div>
      </main>
    </div>
  );
}
