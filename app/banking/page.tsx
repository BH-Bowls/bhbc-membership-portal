// app/banking/page.tsx
// Banking Reconciliation System - FULL WIDTH UI

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import {
  initializeRenewalState,
  initializePaymentState,
  calculateRenewalTotals,
  calculatePaymentTotals,
  autoMatchIfEqual,
  runGlobalAutoMatch,
  calculatePartPayment,
  type RenewalWithState,
  type PaymentWithState,
} from '@/lib/banking-match';

export default function BankingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // State
  const [renewals, setRenewals] = useState<RenewalWithState[]>([]);
  const [payments, setPayments] = useState<PaymentWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dialogs
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showManualMatchDialog, setShowManualMatchDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentWithState | null>(null);
  const [editingRenewal, setEditingRenewal] = useState<RenewalWithState | null>(null);

  // Payment dialog fields
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentType, setPaymentType] = useState<'TRF' | 'CDM' | 'CHQ' | 'CSH'>('TRF');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  // Manual match fields
  const [manualBanking, setManualBanking] = useState(0);
  const [manualDonations, setManualDonations] = useState(0);
  const [manualDifference, setManualDifference] = useState(0);
  const [manualNotes, setManualNotes] = useState('');

  // CSV import
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [selectedImportType, setSelectedImportType] = useState('TRF');

  // Check authorization
  const canAccess = session?.user?.role === 'Admin' || session?.user?.role === 'T';

  useEffect(() => {
    if (status === 'authenticated') {
      if (!canAccess) {
        router.push('/');
      } else {
        loadData();
      }
    }
  }, [status, canAccess]);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load renewals
      const renewalsRes = await fetch('/api/banking/renewals');
      const renewalsData = await renewalsRes.json();

      // Load payments
      const paymentsRes = await fetch('/api/banking/payments');
      const paymentsData = await paymentsRes.json();

      const renewalsWithState = renewalsData.renewals.map(initializeRenewalState);
      const paymentsWithState = paymentsData.payments.map(initializePaymentState);

      setRenewals(renewalsWithState);
      setPayments(paymentsWithState);

      // Run global auto-match
      runGlobalAutoMatch(renewalsWithState, paymentsWithState);
      setRenewals([...renewalsWithState]);
      setPayments([...paymentsWithState]);

      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load data');
      setLoading(false);
    }
  };

  // Calculate totals
  const renewalTotals = calculateRenewalTotals(renewals);
  const paymentTotals = calculatePaymentTotals(payments);

  // Handle renewal checkbox
  const handleRenewalCheck = (renewal: RenewalWithState) => {
    if (renewal.isMatched) return;

    renewal.isSelected = !renewal.isSelected;
    if (renewal.isSelected) {
      renewal.selected_banking = renewal.outstanding;
    } else {
      renewal.selected_banking = 0;
      renewal.selected_donations = 0;
      renewal.selected_difference = 0;
    }

    // Try auto-match
    autoMatchIfEqual(renewals, payments);
    setRenewals([...renewals]);
    setPayments([...payments]);
  };

  // Handle payment checkbox
  const handlePaymentCheck = (payment: PaymentWithState) => {
    if (payment.isMatched) return;

    payment.isSelected = !payment.isSelected;
    payment.selected_amount = payment.isSelected ? payment.amount : 0;

    // Try auto-match
    autoMatchIfEqual(renewals, payments);
    setRenewals([...renewals]);
    setPayments([...payments]);
  };

  // Open add payment dialog
  const openAddDialog = () => {
    setEditingPayment(null);
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentType('TRF');
    setPaymentAmount('');
    setPaymentReference('');
    setShowPaymentDialog(true);
  };

  // Open amend payment dialog
  const openAmendDialog = (payment: PaymentWithState) => {
    if (payment.isMatched) {
      setError('Cannot amend matched payment');
      return;
    }
    setEditingPayment(payment);
    setPaymentDate(payment.date);
    setPaymentType(payment.type);
    setPaymentAmount(payment.amount.toString());
    setPaymentReference(payment.reference);
    setShowPaymentDialog(true);
  };

  // Add or amend payment
  const handleSavePayment = async () => {
    try {
      const action = editingPayment ? 'amend' : 'add';

      const res = await fetch('/api/banking/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          payment_id: editingPayment?.payment_id,
          date: paymentDate,
          type: paymentType,
          reference: paymentReference,
          amount: parseFloat(paymentAmount),
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      setShowPaymentDialog(false);
      setSuccess(`Payment ${action === 'add' ? 'added' : 'amended'} successfully`);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Delete payment
  const handleDeletePayment = async () => {
    if (!editingPayment) return;

    if (!confirm('Are you sure you want to delete this payment?')) return;

    try {
      const res = await fetch('/api/banking/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          payment_id: editingPayment.payment_id,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      setShowPaymentDialog(false);
      setSuccess('Payment deleted successfully');
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Open manual match dialog
  const openManualMatchDialog = (renewal: RenewalWithState) => {
    if (!renewal.isSelected) return;

    setEditingRenewal(renewal);
    setManualBanking(renewal.selected_banking);
    setManualDonations(renewal.selected_donations);
    setManualDifference(renewal.selected_difference);
    setManualNotes('');
    setShowManualMatchDialog(true);
  };

  // Save manual match adjustments
  const handleSaveManualMatch = () => {
    if (!editingRenewal) return;

    editingRenewal.selected_banking = manualBanking;
    editingRenewal.selected_donations = manualDonations;
    editingRenewal.selected_difference = manualDifference;

    setShowManualMatchDialog(false);

    // Try auto-match with new values
    autoMatchIfEqual(renewals, payments);
    setRenewals([...renewals]);
    setPayments([...payments]);
  };

  // Handle CSV file selection
  const handleCSVChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);

    // Parse CSV
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      const headers = lines[0].split(',');

      const data = lines
        .slice(1)
        .filter(line => line.trim())
        .map(line => {
          const values = line.split(',');
          return {
            Date: values[0]?.trim(),
            Type: values[1]?.trim(),
            Reference: values[2]?.trim(),
            Amount: values[3]?.trim(),
          };
        });

      setCsvData(data);

      // Get unique types
      const types = [...new Set(data.map(d => d.Type))].filter(Boolean);
      setAvailableTypes(types);
      if (types.length > 0) {
        setSelectedImportType(types[0]);
      }

      setShowImportDialog(true);
    };

    reader.readAsText(file);
  };

  // Import CSV
  const handleImportCSV = async () => {
    try {
      const res = await fetch('/api/banking/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvData,
          selectedType: selectedImportType,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      const result = await res.json();

      setShowImportDialog(false);
      setCsvFile(null);
      setSuccess(`Imported ${result.count} payments`);
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Submit matched payments
  const handleSubmit = async () => {
    const matchedRenewals = renewals.filter(r => r.isMatched);
    const matchedPayments = payments.filter(p => p.isMatched);

    if (matchedRenewals.length === 0 || matchedPayments.length === 0) {
      setError('No matched items to submit');
      return;
    }

    try {
      // Prepare data
      const renewalsData = matchedRenewals.map(r => ({
        userName: r.userName,
        outstanding: r.outstanding,
        banking: r.banking,
        donations: r.donations,
        difference: r.difference,
        matched_banking: r.matched_banking,
        matched_donations: r.matched_donations,
        matched_difference: r.matched_difference,
        payment_ids: r.payment_ids,
        payment_notes: manualNotes || paymentReference,
        paymentType: payments.find(p => p.isMatched)?.type || 'TRF',
        paymentTypeAmount: 0, // Will be calculated server-side
      }));

      const paymentsData = matchedPayments.map(p => ({
        payment_id: p.payment_id,
        matched_users: matchedRenewals.map(r => r.userName).join(','),
      }));

      const res = await fetch('/api/banking/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchedRenewals: renewalsData,
          matchedPayments: paymentsData,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      setSuccess('Matched payments submitted successfully');
      loadData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return null;
  }

  const hasMatched = renewals.some(r => r.isMatched) || payments.some(p => p.isMatched);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name} userRole={session?.user?.role} />

      {/* FULL WIDTH CONTAINER */}
      <main className="w-full px-6 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Banking Reconciliation
          </h1>

          <div className="flex space-x-3">
            <button
              onClick={openAddDialog}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center"
            >
              <span className="mr-2">+</span>
              Add Payment
            </button>

            <label className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 cursor-pointer flex items-center">
              <span className="mr-2">📥</span>
              Import CSV
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleCSVChange}
              />
            </label>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">×</button>
          </div>
        )}

        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
            <button onClick={() => setSuccess('')} className="float-right font-bold">×</button>
          </div>
        )}

        {/* TWO-COLUMN LAYOUT - FULL WIDTH */}
        <div className="grid grid-cols-2 gap-6">
          {/* LEFT COLUMN - RENEWALS */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Renewals (Outstanding)</h2>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {renewals.map(renewal => (
                <div
                  key={renewal.userName}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 rounded cursor-pointer border"
                  onClick={() => renewal.isSelected && openManualMatchDialog(renewal)}
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={renewal.isSelected || renewal.isMatched}
                      onChange={() => handleRenewalCheck(renewal)}
                      disabled={renewal.isMatched}
                      className={`h-5 w-5 ${
                        renewal.isMatched ? 'text-red-600' : 'text-gray-900'
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div>
                      <div className="font-medium">{renewal.fullKnownAs}</div>
                      <div className="text-sm text-gray-500">{renewal.userName}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-indigo-600">
                      £{renewal.outstanding.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Renewals Totals */}
            <div className="mt-6 pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Total Outstanding:</span>
                <span className="font-semibold">£{renewalTotals.totalOutstanding.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-red-600">
                <span>Total Matched:</span>
                <span className="font-semibold">£{renewalTotals.totalMatched.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Total Selected:</span>
                <span className="font-semibold">£{renewalTotals.totalSelected.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN - PAYMENTS */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Payments (Unmatched)</h2>

            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {payments.map(payment => (
                <div
                  key={payment.payment_id}
                  className="flex items-center justify-between p-3 hover:bg-gray-50 rounded border"
                  onDoubleClick={() => openAmendDialog(payment)}
                >
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={payment.isSelected || payment.isMatched}
                      onChange={() => handlePaymentCheck(payment)}
                      disabled={payment.isMatched}
                      className={`h-5 w-5 ${
                        payment.isMatched ? 'text-red-600' : 'text-gray-900'
                      }`}
                    />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
                          {payment.date}
                        </span>
                        <span className="text-xs font-semibold text-blue-600">
                          {payment.type}
                        </span>
                      </div>
                      <div className="text-sm mt-1">{payment.reference}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-green-600">
                      £{payment.amount.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Payments Totals */}
            <div className="mt-6 pt-4 border-t space-y-2">
              <div className="flex justify-between text-sm">
                <span>Total Banking:</span>
                <span className="font-semibold">£{paymentTotals.totalBanking.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm text-red-600">
                <span>Total Matched:</span>
                <span className="font-semibold">£{paymentTotals.totalMatched.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Total Selected:</span>
                <span className="font-semibold">£{paymentTotals.totalSelected.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        {hasMatched && (
          <div className="mt-6 text-center">
            <button
              onClick={handleSubmit}
              className="px-8 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-lg font-semibold"
            >
              Submit Matched Payments
            </button>
          </div>
        )}

        {/* Add/Amend Payment Dialog */}
        {showPaymentDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">
                {editingPayment ? 'Amend Payment' : 'Add Payment'}
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select
                    value={paymentType}
                    onChange={(e) => setPaymentType(e.target.value as any)}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="TRF">TRF (Bank Transfer)</option>
                    <option value="CDM">CDM (Card Machine)</option>
                    <option value="CHQ">CHQ (Cheque)</option>
                    <option value="CSH">CSH (Cash)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Reference</label>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowPaymentDialog(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                {editingPayment && (
                  <button
                    onClick={handleDeletePayment}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={handleSavePayment}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  {editingPayment ? 'Amend' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Match Dialog */}
        {showManualMatchDialog && editingRenewal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">Manual Match Renewal</h3>

              <div className="mb-4">
                <div className="text-sm text-gray-600">Member: {editingRenewal.fullKnownAs}</div>
                <div className="text-sm text-gray-600">Total Fee Due: £{editingRenewal.totalPayment.toFixed(2)}</div>
                <div className="text-sm text-gray-600">Outstanding: £{editingRenewal.outstanding.toFixed(2)}</div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Banking</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualBanking}
                    onChange={(e) => setManualBanking(parseFloat(e.target.value) || 0)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Donations</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualDonations}
                    onChange={(e) => setManualDonations(parseFloat(e.target.value) || 0)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Difference</label>
                  <input
                    type="number"
                    step="0.01"
                    value={manualDifference}
                    onChange={(e) => setManualDifference(parseFloat(e.target.value) || 0)}
                    className="w-full border rounded px-3 py-2"
                  />
                </div>

                <div className="pt-2 border-t">
                  <div className="text-sm font-medium">
                    Part Payment: £
                    {calculatePartPayment(
                      editingRenewal.outstanding,
                      manualBanking,
                      manualDonations,
                      manualDifference
                    ).toFixed(2)}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => setShowManualMatchDialog(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveManualMatch}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Amend
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CSV Import Dialog */}
        {showImportDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4">Import Payments</h3>

              {availableTypes.length > 1 ? (
                <div className="mb-4">
                  <p className="text-sm text-gray-600 mb-3">
                    The CSV contains multiple payment types. Select which type to import:
                  </p>
                  <select
                    value={selectedImportType}
                    onChange={(e) => setSelectedImportType(e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  >
                    {availableTypes.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <p className="text-sm text-gray-500 mt-2">
                    Found: {csvData.filter(d => d.Type === selectedImportType).length} {selectedImportType} payments
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-600 mb-4">
                  Found: {csvData.length} {availableTypes[0]} payments
                </p>
              )}

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowImportDialog(false);
                    setCsvFile(null);
                  }}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportCSV}
                  className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                >
                  Import
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
