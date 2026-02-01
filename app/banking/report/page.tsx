// app/banking/report/page.tsx
// Banking Report - Paid/Unpaid Subs and Allocated/Unallocated Payments

'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';

interface RenewalReportRow {
  userName: string;
  fullName: string;
  renewingMembership: string;
  playingFee: number;
  socialFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number;
  banking: number;
  difference: number;
  donations: number;
  cardMachine: number;
  bankTransfer: number;
  cheque: number;
  cash: number;
}

interface PaymentReportRow {
  paymentId: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH';
  reference: string;
  amount: number;
  status: string;
  matchedUsers: string;
}

interface ReportTotals {
  playingFee: number;
  socialFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number;
  banking: number;
  difference: number;
  donations: number;
  cardMachine: number;
  bankTransfer: number;
  cheque: number;
  cash: number;
  count: number;
}

interface PaymentTotals {
  TRF: { amount: number; count: number };
  CDM: { amount: number; count: number };
  CHQ: { amount: number; count: number };
  CSH: { amount: number; count: number };
  total: { amount: number; count: number };
}

interface ReportData {
  paidSubs: { rows: RenewalReportRow[]; totals: ReportTotals };
  unpaidSubs: { rows: RenewalReportRow[]; totals: ReportTotals };
  allocatedPayments: { rows: PaymentReportRow[]; totals: PaymentTotals };
  unallocatedPayments: { rows: PaymentReportRow[]; totals: PaymentTotals };
}

// Format currency
const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

// Payment type labels
const typeLabels: Record<string, string> = {
  TRF: 'Bank Transfer',
  CDM: 'Card Machine',
  CHQ: 'Cheque',
  CSH: 'Cash',
};

// Get payment types used by a member
const getPaymentTypes = (row: RenewalReportRow): string => {
  const types: string[] = [];
  if (row.bankTransfer > 0) types.push('TRF');
  if (row.cardMachine > 0) types.push('CDM');
  if (row.cheque > 0) types.push('CHQ');
  if (row.cash > 0) types.push('CSH');
  return types.join(', ') || '-';
};

export default function BankingReportPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const printRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ReportData | null>(null);

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    paidSubs: false,
    unpaidSubs: false,
    allocatedPayments: false,
    unallocatedPayments: false,
  });

  // Check authorization
  const canAccess = session?.user?.role === 'Admin' || session?.user?.role === 'T';

  useEffect(() => {
    if (status === 'authenticated') {
      if (!canAccess) {
        router.push('/');
      } else {
        loadReport();
      }
    }
  }, [status, canAccess]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError('');

      const res = await fetch('/api/banking/report');
      if (!res.ok) {
        throw new Error('Failed to load report');
      }

      const reportData = await res.json();
      setData(reportData);
    } catch (err: any) {
      setError(err.message || 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Print functionality
  const handlePrint = () => {
    window.print();
  };

  // CSV Export functionality
  const handleExportCSV = () => {
    if (!data) return;

    let csv = '';

    // Paid Subs section
    csv += 'PAID SUBS\n';
    csv += 'Member,Playing Fee,Social Fee,Competitions Fee,Club 200 Fee,Total Fee Due,Outstanding,Banking,Difference,Donations,Card Machine,Bank Transfer,Cheque,Cash\n';
    for (const row of data.paidSubs.rows) {
      csv += `"${row.fullName}",${row.playingFee},${row.socialFee},${row.competitionsFee},${row.club200Fee},${row.totalFeeDue},${row.outstanding},${row.banking},${row.difference},${row.donations},${row.cardMachine},${row.bankTransfer},${row.cheque},${row.cash}\n`;
    }
    const pt = data.paidSubs.totals;
    csv += `"TOTAL (${pt.count} records)",${pt.playingFee},${pt.socialFee},${pt.competitionsFee},${pt.club200Fee},${pt.totalFeeDue},${pt.outstanding},${pt.banking},${pt.difference},${pt.donations},${pt.cardMachine},${pt.bankTransfer},${pt.cheque},${pt.cash}\n`;
    csv += '\n';

    // Unpaid Subs section
    csv += 'UNPAID SUBS\n';
    csv += 'Member,Playing Fee,Social Fee,Competitions Fee,Club 200 Fee,Total Fee Due,Outstanding\n';
    for (const row of data.unpaidSubs.rows) {
      csv += `"${row.fullName}",${row.playingFee},${row.socialFee},${row.competitionsFee},${row.club200Fee},${row.totalFeeDue},${row.outstanding}\n`;
    }
    const ut = data.unpaidSubs.totals;
    csv += `"TOTAL (${ut.count} records)",${ut.playingFee},${ut.socialFee},${ut.competitionsFee},${ut.club200Fee},${ut.totalFeeDue},${ut.outstanding}\n`;
    csv += '\n';

    // Allocated Payments section
    csv += 'ALLOCATED PAYMENTS\n';
    csv += 'Payment ID,Date,Type,Reference,Amount,Matched Users\n';
    for (const row of data.allocatedPayments.rows) {
      csv += `${row.paymentId},${row.date},${row.type},"${row.reference}",${row.amount},"${row.matchedUsers}"\n`;
    }
    const at = data.allocatedPayments.totals;
    csv += `"Bank Transfer",,,,${at.TRF.amount},"${at.TRF.count} records"\n`;
    csv += `"Card Machine",,,,${at.CDM.amount},"${at.CDM.count} records"\n`;
    csv += `"Cheque",,,,${at.CHQ.amount},"${at.CHQ.count} records"\n`;
    csv += `"Cash",,,,${at.CSH.amount},"${at.CSH.count} records"\n`;
    csv += `"GRAND TOTAL",,,,${at.total.amount},"${at.total.count} records"\n`;
    csv += '\n';

    // Unallocated Payments section
    csv += 'UNALLOCATED PAYMENTS\n';
    csv += 'Payment ID,Date,Type,Reference,Amount\n';
    for (const row of data.unallocatedPayments.rows) {
      csv += `${row.paymentId},${row.date},${row.type},"${row.reference}",${row.amount}\n`;
    }
    const uat = data.unallocatedPayments.totals;
    csv += `"Bank Transfer",,,,${uat.TRF.amount},"${uat.TRF.count} records"\n`;
    csv += `"Card Machine",,,,${uat.CDM.amount},"${uat.CDM.count} records"\n`;
    csv += `"Cheque",,,,${uat.CHQ.amount},"${uat.CHQ.count} records"\n`;
    csv += `"Cash",,,,${uat.CSH.amount},"${uat.CSH.count} records"\n`;
    csv += `"GRAND TOTAL",,,,${uat.total.amount},"${uat.total.count} records"\n`;

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `banking-report-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading report...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={session?.user?.role ?? undefined} />

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6 print:mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Banking Report</h1>
            <p className="text-sm text-gray-500">Generated: {new Date().toLocaleDateString('en-GB')}</p>
          </div>

          <div className="flex space-x-3 print:hidden">
            <button
              onClick={() => router.push('/banking')}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Back to Banking
            </button>
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Download CSV
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Print
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {data && (
          <div ref={printRef} className="space-y-6">
            {/* Paid Subs Section */}
            <div className="bg-white rounded-lg shadow">
              <button
                onClick={() => toggleSection('paidSubs')}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 print:hover:bg-white"
              >
                <div className="flex items-center space-x-3">
                  <span className={`transform transition-transform ${expandedSections.paidSubs ? 'rotate-90' : ''} print:hidden`}>
                    ▶
                  </span>
                  <h2 className="text-lg font-semibold text-green-700">Paid Subs</h2>
                  <span className="text-sm text-gray-500">({data.paidSubs.totals.count} members)</span>
                </div>
                <span className="text-lg font-bold text-green-700">
                  {formatCurrency(data.paidSubs.totals.totalFeeDue)}
                </span>
              </button>

              {/* Totals Summary */}
              <div className="px-6 pb-4 border-t">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 py-4 text-sm">
                  <div>
                    <span className="text-gray-500">Playing Fee</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.playingFee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Social Fee</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.socialFee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Competitions</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.competitionsFee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Club 200</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.club200Fee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Banking</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.banking)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Donations</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.donations)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Difference</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.difference)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t text-sm">
                  <div>
                    <span className="text-gray-500">Bank Transfer</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.bankTransfer)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Card Machine</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.cardMachine)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cheque</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.cheque)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cash</span>
                    <div className="font-semibold">{formatCurrency(data.paidSubs.totals.cash)}</div>
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              {expandedSections.paidSubs && (
                <div className="border-t max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">Member</th>
                        <th className="px-2 py-2 text-right">Playing</th>
                        <th className="px-2 py-2 text-right">Social</th>
                        <th className="px-2 py-2 text-right">Comp</th>
                        <th className="px-2 py-2 text-right">Club 200</th>
                        <th className="px-2 py-2 text-right">Total</th>
                        <th className="px-2 py-2 text-right">Banking</th>
                        <th className="px-2 py-2 text-right">Diff</th>
                        <th className="px-2 py-2 text-right">Donations</th>
                        <th className="px-2 py-2 text-center">Payment Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.paidSubs.rows.map((row, index) => (
                        <tr key={row.userName} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2">
                            {row.fullName}
                            {row.renewingMembership === 'N' && (
                              <span className="ml-1 text-orange-600 text-xs">(leaving)</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.playingFee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.socialFee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.competitionsFee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.club200Fee)}</td>
                          <td className="px-2 py-2 text-right font-semibold">{formatCurrency(row.totalFeeDue)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.banking)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.difference)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.donations)}</td>
                          <td className="px-2 py-2 text-center">{getPaymentTypes(row)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Unpaid Subs Section */}
            <div className="bg-white rounded-lg shadow">
              <button
                onClick={() => toggleSection('unpaidSubs')}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 print:hover:bg-white"
              >
                <div className="flex items-center space-x-3">
                  <span className={`transform transition-transform ${expandedSections.unpaidSubs ? 'rotate-90' : ''} print:hidden`}>
                    ▶
                  </span>
                  <h2 className="text-lg font-semibold text-red-700">Unpaid Subs</h2>
                  <span className="text-sm text-gray-500">({data.unpaidSubs.totals.count} members)</span>
                </div>
                <span className="text-lg font-bold text-red-700">
                  {formatCurrency(data.unpaidSubs.totals.outstanding)}
                </span>
              </button>

              {/* Totals Summary */}
              <div className="px-6 pb-4 border-t">
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 py-4 text-sm">
                  <div>
                    <span className="text-gray-500">Playing Fee</span>
                    <div className="font-semibold">{formatCurrency(data.unpaidSubs.totals.playingFee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Social Fee</span>
                    <div className="font-semibold">{formatCurrency(data.unpaidSubs.totals.socialFee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Competitions</span>
                    <div className="font-semibold">{formatCurrency(data.unpaidSubs.totals.competitionsFee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Club 200</span>
                    <div className="font-semibold">{formatCurrency(data.unpaidSubs.totals.club200Fee)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Total Fee Due</span>
                    <div className="font-semibold">{formatCurrency(data.unpaidSubs.totals.totalFeeDue)}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Outstanding</span>
                    <div className="font-semibold text-red-600">{formatCurrency(data.unpaidSubs.totals.outstanding)}</div>
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              {expandedSections.unpaidSubs && (
                <div className="border-t max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">Member</th>
                        <th className="px-2 py-2 text-right">Playing</th>
                        <th className="px-2 py-2 text-right">Social</th>
                        <th className="px-2 py-2 text-right">Comp</th>
                        <th className="px-2 py-2 text-right">Club 200</th>
                        <th className="px-2 py-2 text-right">Total Due</th>
                        <th className="px-2 py-2 text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unpaidSubs.rows.map((row, index) => (
                        <tr key={row.userName} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2">{row.fullName}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.playingFee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.socialFee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.competitionsFee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.club200Fee)}</td>
                          <td className="px-2 py-2 text-right">{formatCurrency(row.totalFeeDue)}</td>
                          <td className="px-2 py-2 text-right font-semibold text-red-600">{formatCurrency(row.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Allocated Payments Section */}
            <div className="bg-white rounded-lg shadow">
              <button
                onClick={() => toggleSection('allocatedPayments')}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 print:hover:bg-white"
              >
                <div className="flex items-center space-x-3">
                  <span className={`transform transition-transform ${expandedSections.allocatedPayments ? 'rotate-90' : ''} print:hidden`}>
                    ▶
                  </span>
                  <h2 className="text-lg font-semibold text-blue-700">Allocated Payments</h2>
                  <span className="text-sm text-gray-500">({data.allocatedPayments.totals.total.count} payments)</span>
                </div>
                <span className="text-lg font-bold text-blue-700">
                  {formatCurrency(data.allocatedPayments.totals.total.amount)}
                </span>
              </button>

              {/* Totals by Type */}
              <div className="px-6 pb-4 border-t">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 py-4 text-sm">
                  <div>
                    <span className="text-gray-500">Bank Transfer</span>
                    <div className="font-semibold">{formatCurrency(data.allocatedPayments.totals.TRF.amount)}</div>
                    <div className="text-xs text-gray-400">{data.allocatedPayments.totals.TRF.count} records</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Card Machine</span>
                    <div className="font-semibold">{formatCurrency(data.allocatedPayments.totals.CDM.amount)}</div>
                    <div className="text-xs text-gray-400">{data.allocatedPayments.totals.CDM.count} records</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cheque</span>
                    <div className="font-semibold">{formatCurrency(data.allocatedPayments.totals.CHQ.amount)}</div>
                    <div className="text-xs text-gray-400">{data.allocatedPayments.totals.CHQ.count} records</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cash</span>
                    <div className="font-semibold">{formatCurrency(data.allocatedPayments.totals.CSH.amount)}</div>
                    <div className="text-xs text-gray-400">{data.allocatedPayments.totals.CSH.count} records</div>
                  </div>
                  <div className="border-l pl-4">
                    <span className="text-gray-500 font-medium">Grand Total</span>
                    <div className="font-bold text-blue-700">{formatCurrency(data.allocatedPayments.totals.total.amount)}</div>
                    <div className="text-xs text-gray-400">{data.allocatedPayments.totals.total.count} records</div>
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              {expandedSections.allocatedPayments && (
                <div className="border-t max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">ID</th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Type</th>
                        <th className="px-2 py-2 text-left">Reference</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                        <th className="px-4 py-2 text-left">Matched To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.allocatedPayments.rows.map((row, index) => (
                        <tr key={row.paymentId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2 font-mono text-xs">{row.paymentId}</td>
                          <td className="px-2 py-2">{row.date}</td>
                          <td className="px-2 py-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                              {row.type}
                            </span>
                          </td>
                          <td className="px-2 py-2 truncate max-w-xs">{row.reference}</td>
                          <td className="px-2 py-2 text-right font-semibold">{formatCurrency(row.amount)}</td>
                          <td className="px-4 py-2 text-gray-600 truncate max-w-xs">{row.matchedUsers}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Unallocated Payments Section */}
            <div className="bg-white rounded-lg shadow">
              <button
                onClick={() => toggleSection('unallocatedPayments')}
                className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 print:hover:bg-white"
              >
                <div className="flex items-center space-x-3">
                  <span className={`transform transition-transform ${expandedSections.unallocatedPayments ? 'rotate-90' : ''} print:hidden`}>
                    ▶
                  </span>
                  <h2 className="text-lg font-semibold text-orange-700">Unallocated Payments</h2>
                  <span className="text-sm text-gray-500">({data.unallocatedPayments.totals.total.count} payments)</span>
                </div>
                <span className="text-lg font-bold text-orange-700">
                  {formatCurrency(data.unallocatedPayments.totals.total.amount)}
                </span>
              </button>

              {/* Totals by Type */}
              <div className="px-6 pb-4 border-t">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 py-4 text-sm">
                  <div>
                    <span className="text-gray-500">Bank Transfer</span>
                    <div className="font-semibold">{formatCurrency(data.unallocatedPayments.totals.TRF.amount)}</div>
                    <div className="text-xs text-gray-400">{data.unallocatedPayments.totals.TRF.count} records</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Card Machine</span>
                    <div className="font-semibold">{formatCurrency(data.unallocatedPayments.totals.CDM.amount)}</div>
                    <div className="text-xs text-gray-400">{data.unallocatedPayments.totals.CDM.count} records</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cheque</span>
                    <div className="font-semibold">{formatCurrency(data.unallocatedPayments.totals.CHQ.amount)}</div>
                    <div className="text-xs text-gray-400">{data.unallocatedPayments.totals.CHQ.count} records</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Cash</span>
                    <div className="font-semibold">{formatCurrency(data.unallocatedPayments.totals.CSH.amount)}</div>
                    <div className="text-xs text-gray-400">{data.unallocatedPayments.totals.CSH.count} records</div>
                  </div>
                  <div className="border-l pl-4">
                    <span className="text-gray-500 font-medium">Grand Total</span>
                    <div className="font-bold text-orange-700">{formatCurrency(data.unallocatedPayments.totals.total.amount)}</div>
                    <div className="text-xs text-gray-400">{data.unallocatedPayments.totals.total.count} records</div>
                  </div>
                </div>
              </div>

              {/* Detail rows */}
              {expandedSections.unallocatedPayments && (
                <div className="border-t max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-4 py-2 text-left">ID</th>
                        <th className="px-2 py-2 text-left">Date</th>
                        <th className="px-2 py-2 text-left">Type</th>
                        <th className="px-2 py-2 text-left">Reference</th>
                        <th className="px-2 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unallocatedPayments.rows.map((row, index) => (
                        <tr key={row.paymentId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-4 py-2 font-mono text-xs">{row.paymentId}</td>
                          <td className="px-2 py-2">{row.date}</td>
                          <td className="px-2 py-2">
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
                              {row.type}
                            </span>
                          </td>
                          <td className="px-2 py-2 truncate max-w-xs">{row.reference}</td>
                          <td className="px-2 py-2 text-right font-semibold">{formatCurrency(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: auto;
            margin: 10mm;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:max-h-none {
            max-height: none !important;
          }
          .print\\:overflow-visible {
            overflow: visible !important;
          }
          .print\\:mb-4 {
            margin-bottom: 1rem !important;
          }
          .print\\:hover\\:bg-white:hover {
            background-color: white !important;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          /* Ensure tables can shrink */
          table {
            font-size: 9pt;
          }
        }
      `}</style>
    </div>
  );
}
