// app/banking/page.tsx
// Banking Reconciliation System - FULL WIDTH UI
//
// Left column has two tabs, sharing the Payments column on the right:
//   Renewals    — tick renewals and payments; equal totals match, then Update
//   Rowland Cup — clubs that still owe entry fees, matched the same way: tick the club
//                 and its payment(s); equal amounts match, less opens the part payment
//                 box. Update saves only the tab on show. One club per match. The payment-received
//                 email goes once an entry is paid in full.

'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  initializeRenewalState,
  initializePaymentState,
  calculateRenewalTotals,
  calculatePaymentTotals,
  autoMatchIfEqual,
  runGlobalAutoMatch,
  type RenewalWithState,
  type PaymentWithState,
} from '@/lib/banking-match';

interface RowlandOwing {
  id: string;
  clubName: string;
  season: string;
  amountDuePence: number;
  amountReceivedPence: number;
  paymentStatus: 'Unpaid' | 'Partial' | 'Paid';
}

interface RowlandWithState extends RowlandOwing {
  isSelected: boolean;
  isMatched: boolean;
  matchedPence: number;
  matchedPaymentIds: string[];
}

function owingPence(entry: RowlandOwing): number {
  return entry.amountDuePence - entry.amountReceivedPence;
}

/** Total of the payments ticked but not yet matched, in pence. */
function selectedPaymentPence(payments: PaymentWithState[]): number {
  let total = 0;
  for (const p of payments) {
    if (p.isSelected && !p.isMatched) total += Math.round(p.amount * 100);
  }
  return total;
}

/** Move the ticked payments onto the club as a staged match (saved on Update). */
function stageRowlandMatch(entry: RowlandWithState, payments: PaymentWithState[]) {
  const ids: string[] = [];
  let total = 0;
  for (const p of payments) {
    if (!p.isSelected || p.isMatched) continue;
    ids.push(p.payment_id);
    total += Math.round(p.amount * 100);
    p.matched_amount = p.amount;
    p.matched_user_names = [`Rowland Cup: ${entry.clubName}`];
    p.selected_amount = 0;
    p.isSelected = false;
    p.isMatched = true;
  }
  entry.matchedPence = total;
  entry.matchedPaymentIds = ids;
  entry.isSelected = false;
  entry.isMatched = true;
}

/**
 * Like the renewals auto-match on load: a payment whose reference names only this club,
 * for exactly what it owes, is matched to it.
 */
function rowlandAutoMatch(entries: RowlandWithState[], payments: PaymentWithState[]) {
  for (const entry of entries) {
    const owed = owingPence(entry);
    let found: PaymentWithState | null = null;
    let count = 0;
    for (const p of suggestRowlandPayments(entry.clubName, payments)) {
      if (p.isSelected || Math.round(p.amount * 100) !== owed) continue;
      let namesAnotherClub = false;
      for (const other of entries) {
        if (other !== entry && suggestRowlandPayments(other.clubName, [p]).length > 0) {
          namesAnotherClub = true;
          break;
        }
      }
      if (namesAnotherClub) continue;
      found = p;
      count++;
    }
    if (count === 1 && found) {
      found.isSelected = true;
      found.selected_amount = found.amount;
      stageRowlandMatch(entry, payments);
    }
  }
}

const CLUB_NAME_NOISE = ['bowls', 'bowling', 'club', 'the', 'and'];

/** Unmatched payments whose reference mentions the club, e.g. "EGR HAYWARDS HEATH". */
function suggestRowlandPayments(clubName: string, payments: PaymentWithState[]): PaymentWithState[] {
  const words: string[] = [];
  for (const w of clubName.toLowerCase().split(/[^a-z]+/)) {
    if (w.length >= 4 && !CLUB_NAME_NOISE.includes(w)) words.push(w);
  }
  const found: PaymentWithState[] = [];
  if (words.length === 0) return found;
  for (const p of payments) {
    if (p.isMatched) continue;
    const reference = p.reference.toLowerCase();
    for (const w of words) {
      if (reference.includes(w)) {
        found.push(p);
        break;
      }
    }
  }
  return found;
}

function gbpFromPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export default function BankingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // State
  const [renewals, setRenewals] = useState<RenewalWithState[]>([]);
  const [payments, setPayments] = useState<PaymentWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Dialogs
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [showManualMatchDialog, setShowManualMatchDialog] = useState(false);
  const [showImportFormatDialog, setShowImportFormatDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentWithState | null>(null);
  const [editingRenewal, setEditingRenewal] = useState<RenewalWithState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // Payment dialog fields
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentType, setPaymentType] = useState<'TRF' | 'CDM' | 'CHQ' | 'CSH'>('TRF');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');

  // Manual match fields
  const [manualBanking, setManualBanking] = useState(0);
  const [manualDonations, setManualDonations] = useState<string | number>('');
  const [manualDifference, setManualDifference] = useState<string | number>('');
  const [manualNotes, setManualNotes] = useState('');

  // CSV import
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Rowland Cup tab
  const [leftTab, setLeftTab] = useState<'renewals' | 'rowland'>('renewals');
  const [rowlandEntries, setRowlandEntries] = useState<RowlandWithState[]>([]);
  const [editingRowland, setEditingRowland] = useState<RowlandWithState | null>(null);
  // Which tabs have had their auto-match since the last load
  const autoMatched = useRef({ renewals: false, rowland: false });
  // Check authorization
  const canAccess = hasRole(session?.user?.role, 'Admin', 'Treasurer', 'T');

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

      // Auto-match only for the tab on show; the other tab's runs when it's opened
      autoMatched.current = { renewals: false, rowland: false };
      if (leftTab === 'renewals') {
        runGlobalAutoMatch(renewalsWithState, paymentsWithState);
        autoMatched.current.renewals = true;
      }

      // Rowland Cup entries still owing, auto-matched the same way
      let rowlandWithState: RowlandWithState[] = [];
      try {
        const rowlandRes = await fetch('/api/banking/rowland');
        const rowlandData = await rowlandRes.json();
        if (!rowlandRes.ok) throw new Error(rowlandData.error || 'Failed to load Rowland Cup entries');
        const owing: RowlandOwing[] = rowlandData.entries || [];
        for (const e of owing) {
          rowlandWithState.push({ ...e, isSelected: false, isMatched: false, matchedPence: 0, matchedPaymentIds: [] });
        }
        if (leftTab === 'rowland') {
          rowlandAutoMatch(rowlandWithState, paymentsWithState);
          autoMatched.current.rowland = true;
        }
      } catch (err) {
        rowlandWithState = [];
        setError(err instanceof Error ? err.message : 'Failed to load Rowland Cup entries');
      }

      setRenewals([...renewalsWithState]);
      setPayments([...paymentsWithState]);
      setRowlandEntries(rowlandWithState);

      setLoading(false);
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Failed to load data');
      setLoading(false);
    }
  };

  // Rowland Cup totals, like the renewals ones
  const paymentsTickedPence = selectedPaymentPence(payments);
  let rowlandSelected: RowlandWithState | null = null;
  let rowlandOutstandingPence = 0;
  let rowlandMatchedPence = 0;
  for (const e of rowlandEntries) {
    if (e.isSelected) rowlandSelected = e;
    rowlandOutstandingPence += owingPence(e) - e.matchedPence;
    rowlandMatchedPence += e.matchedPence;
  }
  let rowlandSelectedPence = 0;
  if (rowlandSelected) rowlandSelectedPence = Math.min(paymentsTickedPence, owingPence(rowlandSelected));

  // Payments staged against a club, so each tab only shows its own matches on the right
  const rowlandStagedIds: string[] = [];
  for (const e of rowlandEntries) {
    for (const id of e.matchedPaymentIds) rowlandStagedIds.push(id);
  }
  const visiblePayments: PaymentWithState[] = [];
  for (const p of payments) {
    const stagedToRowland = rowlandStagedIds.includes(p.payment_id);
    if (leftTab === 'renewals' && stagedToRowland) continue;
    if (leftTab === 'rowland' && p.isMatched && !stagedToRowland) continue;
    visiblePayments.push(p);
  }

  /**
   * Change tab: untick anything ticked but not matched (matches already made are kept
   * for Update), then auto-match the new tab if it hasn't been since the last load.
   */
  const switchTab = (tab: 'renewals' | 'rowland') => {
    if (tab === leftTab) return;
    for (const p of payments) {
      if (p.isSelected && !p.isMatched) {
        p.isSelected = false;
        p.selected_amount = 0;
      }
    }
    clearRenewalSelection();
    clearRowlandSelection();
    if (tab === 'renewals' && !autoMatched.current.renewals) {
      runGlobalAutoMatch(renewals, payments);
      autoMatched.current.renewals = true;
    }
    if (tab === 'rowland' && !autoMatched.current.rowland) {
      rowlandAutoMatch(rowlandEntries, payments);
      autoMatched.current.rowland = true;
    }
    setLeftTab(tab);
    setRenewals([...renewals]);
    setPayments([...payments]);
    setRowlandEntries([...rowlandEntries]);
  };

  /** Untick a club that's ticked but not matched (ticking a renewal does this). */
  const clearRowlandSelection = () => {
    for (const e of rowlandEntries) e.isSelected = false;
  };

  /** Untick renewals that are ticked but not matched (ticking a club does this). */
  const clearRenewalSelection = () => {
    for (const r of renewals) {
      if (!r.isSelected) continue;
      r.isSelected = false;
      r.selected_banking = 0;
      r.selected_donations = 0;
      r.selected_difference = 0;
    }
  };

  // Handle Rowland Cup checkbox — one club at a time, matched like a renewal:
  // equal amounts match, less opens the part payment box, more waits.
  const handleRowlandCheck = (entry: RowlandWithState) => {
    if (entry.isMatched) return;
    const selecting = !entry.isSelected;
    clearRowlandSelection();
    if (selecting) {
      clearRenewalSelection();
      entry.isSelected = true;
      const ticked = selectedPaymentPence(payments);
      const owed = owingPence(entry);
      if (ticked > 0 && ticked === owed) {
        stageRowlandMatch(entry, payments);
      } else if (ticked > 0 && ticked < owed) {
        setEditingRowland(entry);
      }
    }
    setRowlandEntries([...rowlandEntries]);
    setRenewals([...renewals]);
    setPayments([...payments]);
  };

  const handleSaveRowlandPartPay = () => {
    if (!editingRowland) return;
    stageRowlandMatch(editingRowland, payments);
    setEditingRowland(null);
    setRowlandEntries([...rowlandEntries]);
    setPayments([...payments]);
  };

  // Calculate totals (the Payments column's are for the payments on show)
  const renewalTotals = calculateRenewalTotals(renewals);
  const paymentTotals = calculatePaymentTotals(visiblePayments);

  // Handle renewal checkbox
  const handleRenewalCheck = (renewal: RenewalWithState) => {
    if (renewal.isMatched) return;

    if (!renewal.isSelected) {
      clearRowlandSelection();
      setRowlandEntries([...rowlandEntries]);
    }
    renewal.isSelected = !renewal.isSelected;

    if (renewal.isSelected) {
      // Get current totals BEFORE adding this renewal
      const paymentTotals = calculatePaymentTotals(payments);
      const renewalTotals = calculateRenewalTotals(renewals);
      const current_payment = paymentTotals.totalSelected;
      const current_renewal = renewalTotals.totalSelected;
      const current_difference = current_payment - current_renewal;

      // Calculate banking based on current difference
      if (current_difference > 0) {
        renewal.selected_banking = renewal.outstanding;
      } else {
        renewal.selected_banking = renewal.outstanding + current_difference;
      }
    } else {
      renewal.selected_banking = 0;
      renewal.selected_donations = 0;
      renewal.selected_difference = 0;
    }

    // NOW recalculate totals with the new banking
    const updatedPaymentTotals = calculatePaymentTotals(payments);
    const updatedRenewalTotals = calculateRenewalTotals(renewals);
    const new_payment = updatedPaymentTotals.totalSelected;
    const new_renewal = updatedRenewalTotals.totalSelected;
    const new_difference = new_payment - new_renewal;

    // Auto-match logic
    if (new_difference === 0) {
      // Perfect match - auto match all
      autoMatchIfEqual(renewals, payments);
    } else if (new_difference < 0) {
      // Underpayment - open manual match dialog
      setEditingRenewal(renewal);
      setManualDonations('');
      setManualDifference('');
      setManualNotes('');
      setShowManualMatchDialog(true);
    }
    // If new_difference > 0, do nothing - let user continue selecting

    setRenewals([...renewals]);
    setPayments([...payments]);
  };

  // Handle payment checkbox
  const handlePaymentCheck = (payment: PaymentWithState) => {
    if (payment.isMatched) return;

    payment.isSelected = !payment.isSelected;
    payment.selected_amount = payment.isSelected ? payment.amount : 0;

    // Try auto-match — against the ticked club if there is one, otherwise renewals
    let club: RowlandWithState | null = null;
    for (const e of rowlandEntries) {
      if (e.isSelected) club = e;
    }
    if (club) {
      const ticked = selectedPaymentPence(payments);
      if (ticked > 0 && ticked === owingPence(club)) stageRowlandMatch(club, payments);
      setRowlandEntries([...rowlandEntries]);
    } else {
      autoMatchIfEqual(renewals, payments);
    }
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
    // Stripe (STR) payments arrive already matched, so they never reach this dialog
    setPaymentType(payment.type === 'STR' ? 'TRF' : payment.type);
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

  // Helper to close confirmation dialog
  const closeConfirmDialog = () => {
    setConfirmDialog({
      isOpen: false,
      title: '',
      message: '',
      onConfirm: () => {},
    });
  };

  // Delete payment — from the Amend dialog, or the bin beside an unmatched payment
  // (e.g. a receipt that isn't a renewal or Rowland Cup fee)
  const handleDeletePayment = async (payment: PaymentWithState | null = editingPayment) => {
    if (!payment) return;

    setConfirmDialog({
      isOpen: true,
      title: 'Delete Payment',
      message: `Delete ${payment.payment_id} (${payment.reference || 'no reference'}, £${payment.amount.toFixed(2)}) from Banking?`,
      onConfirm: () => {
        closeConfirmDialog();
        performDeletePayment(payment);
      },
    });
  };

  // Perform the actual delete operation. Removes it from the list without reloading,
  // so matches waiting for Update aren't lost.
  const performDeletePayment = async (payment: PaymentWithState) => {
    try {
      const res = await fetch('/api/banking/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          payment_id: payment.payment_id,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      setShowPaymentDialog(false);
      setSuccess(`Payment ${payment.payment_id} deleted`);
      const remaining: PaymentWithState[] = [];
      for (const p of payments) {
        if (p.payment_id !== payment.payment_id) remaining.push(p);
      }
      setPayments(remaining);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Open manual match dialog
  const openManualMatchDialog = (renewal: RenewalWithState) => {
    if (!renewal.isSelected) return;

    setEditingRenewal(renewal);
    setManualBanking(renewal.selected_banking);
    setManualDonations(renewal.selected_donations || '');
    setManualDifference(renewal.selected_difference || '');
    setManualNotes('');
    setShowManualMatchDialog(true);
  };

  // Save manual match adjustments
  const handleSaveManualMatch = () => {
    if (!editingRenewal) return;

    // Calculate totals excluding the current renewal
    const paymentTotals = calculatePaymentTotals(payments);
    const renewalTotals = calculateRenewalTotals(renewals);
    const total_selected_payment = paymentTotals.totalSelected;

    // Exclude current renewal to get available amount
    const other_renewals_total = renewalTotals.totalSelected - editingRenewal.selected_banking;
    const available_for_current = total_selected_payment - other_renewals_total;

    // Parse donations and difference
    const donationsNum = typeof manualDonations === 'string' ? parseFloat(manualDonations) || 0 : manualDonations;
    const differenceNum = typeof manualDifference === 'string' ? parseFloat(manualDifference) || 0 : manualDifference;

    // Banking = total available for this renewal
    // (donations and difference are tracked separately and balance in the outstanding formula)
    const calculatedBanking = available_for_current;

    // Get currently selected items for tracking relationships
    const selectedPaymentIds = payments.filter(p => p.isSelected).map(p => p.payment_id);
    const selectedRenewalUserNames = renewals.filter(r => r.isSelected || r === editingRenewal).map(r => r.userName);

    editingRenewal.selected_banking = calculatedBanking;
    editingRenewal.selected_donations = donationsNum;
    editingRenewal.selected_difference = differenceNum;
    editingRenewal.matched_banking = calculatedBanking;
    editingRenewal.matched_donations = donationsNum;
    editingRenewal.matched_difference = differenceNum;
    editingRenewal.matched_payment_ids = [...selectedPaymentIds]; // Store which payments were used
    editingRenewal.matched_notes = manualNotes; // Store notes on this specific renewal
    // Update outstanding: total_fee_due - banking + donations + difference
    editingRenewal.outstanding = editingRenewal.totalPayment - calculatedBanking + donationsNum + differenceNum;
    editingRenewal.isMatched = true;
    editingRenewal.isSelected = false;

    // Mark ALL other selected renewals as matched
    renewals.forEach(r => {
      if (r.isSelected && r !== editingRenewal) {
        const banking = r.outstanding;
        r.selected_banking = banking;
        r.selected_donations = 0;
        r.selected_difference = 0;
        r.matched_banking = banking;
        r.matched_donations = 0;
        r.matched_difference = 0;
        r.matched_payment_ids = [...selectedPaymentIds]; // Store which payments were used
        r.matched_notes = ''; // Other renewals in this match have no notes
        // Update outstanding: total_fee_due - banking + donations + difference
        r.outstanding = r.totalPayment - banking + 0 + 0;
        r.isMatched = true;
        r.isSelected = false;
      }
    });

    // Mark selected payments as matched
    payments.forEach(p => {
      if (p.isSelected) {
        p.matched_amount = p.amount;
        p.matched_user_names = [...selectedRenewalUserNames]; // Store which renewals were matched
        p.isMatched = true;
        p.isSelected = false;
      }
    });

    setShowManualMatchDialog(false);
    setRenewals([...renewals]);
    setPayments([...payments]);
  };

  // Valid payment types
  const validTypes = ['TRF', 'CDM', 'CHQ', 'CSH'];

  // Handle CSV file selection
  const handleCSVChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);

    // Parse CSV
    // Expected format: Date, Type, Description, Amount, Balance (ignored)
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');

      // A header line is optional: any line whose Amount isn't a number (e.g. "Amount")
      // is treated as a header and skipped, so files with or without one both work
      const cell = (value: string | undefined) => (value || '').trim().replace(/^"|"$/g, '').trim();
      const data = lines
        .filter(line => line.trim())
        .map(line => {
          const values = line.split(',');
          const rawType = cell(values[1]).toUpperCase() || 'TRF';
          // Validate type - default to TRF if invalid
          const type = validTypes.includes(rawType) ? rawType : 'TRF';
          return {
            Date: cell(values[0]),
            Type: type,
            Description: cell(values[2]), // Use Description (column 3) as reference
            Amount: cell(values[3]).replace(/£/g, ''),
          };
        });

      // Skip header lines and empty rows, and outgoings (negative or £0 amounts):
      // only money coming in is matched here
      const filteredData = [];
      let outgoings = 0;
      for (const d of data) {
        if (!d.Date || d.Date === 'Date') continue;
        if (d.Amount === '' || isNaN(Number(d.Amount))) continue; // header line
        const amount = parseFloat(d.Amount);
        if (!(amount > 0)) {
          outgoings++;
          continue;
        }
        filteredData.push(d);
      }

      setCsvData(filteredData);
      setCsvSkipped(outgoings);

      // Show confirmation dialog if there are transactions
      if (filteredData.length === 0) {
        setError(outgoings > 0
          ? `No receipts found in the CSV (${outgoings} outgoing${outgoings === 1 ? '' : 's'} skipped)`
          : 'No transactions found in CSV');
      } else {
        setShowImportDialog(true);
      }
    };

    reader.readAsText(file);
  };

  // Import CSV
  const handleImportCSV = async () => {
    setIsImporting(true);
    setError('');

    try {
      const res = await fetch('/api/banking/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvData,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }

      const result = await res.json();

      setShowImportDialog(false);
      setCsvFile(null);
      setSuccess(`Imported ${result.count} payments successfully`);
      await loadData(); // Reload data to show imported payments
    } catch (err: any) {
      setError(err.message || 'Failed to import CSV');
    } finally {
      setIsImporting(false);
    }
  };

  // Submit matched payments
  /** Reload the renewals list after its matches are saved (the Rowland tab is left alone). */
  const refreshRenewals = async (remainingPayments: PaymentWithState[]) => {
    const res = await fetch('/api/banking/renewals');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reload renewals');
    const fresh: RenewalWithState[] = data.renewals.map(initializeRenewalState);
    runGlobalAutoMatch(fresh, remainingPayments);
    setRenewals(fresh);
    setPayments([...remainingPayments]);
  };

  /** Reload the clubs still owing after Rowland matches are saved (renewals are left alone). */
  const refreshRowland = async () => {
    const res = await fetch('/api/banking/rowland');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to reload Rowland Cup entries');
    const owing: RowlandOwing[] = data.entries || [];
    const fresh: RowlandWithState[] = [];
    for (const e of owing) {
      fresh.push({ ...e, isSelected: false, isMatched: false, matchedPence: 0, matchedPaymentIds: [] });
    }
    setRowlandEntries(fresh);
  };

  /**
   * Take saved payments off the list. Any still marked matched to a club that didn't
   * save (Rowland tab, after an error) go back to unmatched.
   */
  const dropSavedPayments = (savedIds: string[], resetIds: string[]) => {
    const remaining: PaymentWithState[] = [];
    for (const p of payments) {
      if (savedIds.includes(p.payment_id)) continue;
      if (resetIds.includes(p.payment_id)) {
        p.isMatched = false;
        p.isSelected = false;
        p.matched_amount = 0;
        p.selected_amount = 0;
        p.matched_user_names = [];
      }
      remaining.push(p);
    }
    setPayments(remaining);
    return remaining;
  };

  // Update saves only the matches on the tab on show; the other tab's stay waiting
  const handleSubmit = async () => {
    if (leftTab === 'rowland') {
      await submitRowland();
    } else {
      await submitRenewals();
    }
  };

  const submitRowland = async () => {
    const matchedRowland: RowlandWithState[] = [];
    const rowlandPaymentIds: string[] = [];
    for (const e of rowlandEntries) {
      if (!e.isMatched) continue;
      matchedRowland.push(e);
      for (const id of e.matchedPaymentIds) rowlandPaymentIds.push(id);
    }
    if (matchedRowland.length === 0) {
      setError('No Rowland Cup matches to submit');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    const messages: string[] = [];
    const savedIds: string[] = [];
    try {
      // One save per club (recorded for the Xero journal; the payment received email
      // goes when the entry becomes Paid)
      for (const entry of matchedRowland) {
        const res = await fetch('/api/banking/rowland', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entryId: entry.id, paymentIds: entry.matchedPaymentIds }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`${entry.clubName}: ${data.error || 'Failed to match the payment'}`);
        for (const id of entry.matchedPaymentIds) savedIds.push(id);
        let message = `${entry.clubName}: ${gbpFromPence(entry.matchedPence)} matched, now ${data.paymentStatus}.`;
        if (data.paymentStatus === 'Paid') {
          message += data.emailsSent > 0
            ? ` Payment received email sent to ${data.emailsSent} contact${data.emailsSent === 1 ? '' : 's'}.`
            : ' No payment received email was sent (email isn\'t set up, or no contacts).';
        }
        messages.push(message);
      }
      setSuccess(messages.join(' '));
    } catch (err) {
      if (messages.length > 0) setSuccess(messages.join(' '));
      setError(err instanceof Error ? err.message : 'Failed to save the Rowland Cup matches');
    } finally {
      dropSavedPayments(savedIds, rowlandPaymentIds);
      try {
        await refreshRowland();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reload Rowland Cup entries');
      }
      setSubmitting(false);
    }
  };

  const submitRenewals = async () => {
    const rowlandPaymentIds: string[] = [];
    for (const e of rowlandEntries) {
      for (const id of e.matchedPaymentIds) rowlandPaymentIds.push(id);
    }
    const matchedRenewals = renewals.filter(r => r.isMatched);
    const matchedPayments = payments.filter(p => p.isMatched && !rowlandPaymentIds.includes(p.payment_id));

    if (matchedRenewals.length === 0 || matchedPayments.length === 0) {
      setError('No renewal matches to submit');
      return;
    }

    // Set submitting state to show loading indicator
    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      // Prepare data - use stored relationships for each renewal
      const renewalsData = matchedRenewals.map(r => {
        // Use the specific payment IDs that were matched to THIS renewal
        const newPaymentIds = r.matched_payment_ids.join(', ');
        const existingIds = r.payment_ids || '';
        const updatedPaymentIds = existingIds ? `${existingIds}, ${newPaymentIds}` : newPaymentIds;

        // Calculate amounts by payment type for this renewal
        // Find the matched payments for this renewal and sum by type
        const typeAmounts: Record<string, number> = {
          TRF: 0,
          CDM: 0,
          CHQ: 0,
          CSH: 0,
        };

        // Get all payments matched to this renewal
        const renewalPayments = matchedPayments.filter(p =>
          r.matched_payment_ids.includes(p.payment_id)
        );

        // If this renewal has specific matched payments, calculate proportional amounts
        if (renewalPayments.length > 0) {
          // Calculate total from matched payments
          const totalPaymentAmount = renewalPayments.reduce((sum, p) => sum + p.amount, 0);

          // If renewal matched_banking equals total payment amount, use actual payment amounts
          // Otherwise, proportionally distribute the matched_banking across payment types
          if (Math.abs(r.matched_banking - totalPaymentAmount) < 0.01) {
            // Exact match - use actual payment amounts per type
            for (const p of renewalPayments) {
              typeAmounts[p.type] += p.amount;
            }
          } else {
            // Partial match - proportionally distribute matched_banking across types
            const ratio = r.matched_banking / totalPaymentAmount;
            for (const p of renewalPayments) {
              typeAmounts[p.type] += p.amount * ratio;
            }
          }
        }

        return {
          userName: r.userName,
          totalPayment: r.totalPayment,
          outstanding: r.outstanding,
          banking: r.banking,
          donations: r.donations,
          difference: r.difference,
          matched_banking: r.matched_banking,
          matched_donations: r.matched_donations,
          matched_difference: r.matched_difference,
          payment_ids: updatedPaymentIds,
          payment_notes: r.matched_notes || '',
          // Send all type amounts instead of single type
          typeAmounts: {
            bank_transfer: r.bank_transfer + typeAmounts.TRF,
            card_machine: r.card_machine + typeAmounts.CDM,
            cheque: r.cheque + typeAmounts.CHQ,
            cash: r.cash + typeAmounts.CSH,
          },
        };
      });

      // Prepare payment data - use stored relationships for each payment
      const paymentsData = matchedPayments.map(p => ({
        payment_id: p.payment_id,
        matched_users: p.matched_user_names.join(','), // Use the specific users matched to THIS payment
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
      setSuccess('Matched renewal payments submitted successfully');
      const savedIds: string[] = [];
      for (const p of matchedPayments) savedIds.push(p.payment_id);
      await refreshRenewals(dropSavedPayments(savedIds, []));
    } catch (err: any) {
      setError(err.message);
    } finally {
      // Always clear submitting state when done
      setSubmitting(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return null;
  }

  // Matches waiting for Update, shown on each tab (the other tab's are hidden from Payments)
  let renewalsMatchedCount = 0;
  for (const r of renewals) if (r.isMatched) renewalsMatchedCount++;
  let rowlandMatchedCount = 0;
  for (const e of rowlandEntries) if (e.isMatched) rowlandMatchedCount++;

  // Update shows when the tab on show has matches to save
  const hasMatched = leftTab === 'rowland' ? rowlandMatchedCount > 0 : renewalsMatchedCount > 0;

  return (
    <div className="min-h-screen bg-gray-50">

      {/* FULL WIDTH CONTAINER */}
      <main className="w-full px-6 py-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Banking Reconciliation
          </h1>

          <div className="flex space-x-3">
            {hasMatched && (
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className={`px-4 py-2 text-white rounded-md font-semibold inline-flex items-center gap-2 ${
                  submitting
                    ? 'bg-blue-500 cursor-not-allowed'
                    : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {submitting && (
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {submitting ? 'Submitting...' : 'Update'}
              </button>
            )}

            <button
              onClick={() => router.push('/banking/report')}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 flex items-center"
            >
              Report
            </button>

            <button
              onClick={() => router.push('/banking/renewals-xero')}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 flex items-center"
            >
              Renewals → Xero
            </button>

            <button
              onClick={() => router.push('/banking/add-payments')}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center"
            >
              <span className="mr-2">+</span>
              Add Payments
            </button>

            <button
              onClick={() => setShowImportFormatDialog(true)}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center"
            >
              <span className="mr-2">+</span>
              Import CSV
            </button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleCSVChange}
            />
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

        {/* TWO-COLUMN LAYOUT - 40:60 PROPORTION */}
        <div className="grid grid-cols-[40%_60%] gap-6">
          {/* LEFT COLUMN - RENEWALS / ROWLAND CUP (40%) */}
          <div className="bg-white rounded-lg shadow">
            <div className="flex border-b border-gray-200 px-6 pt-4">
              {([['renewals', 'Renewals'], ['rowland', 'Rowland Cup']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => switchTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                    leftTab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-700 hover:text-gray-900'
                  }`}
                >
                  {label}
                  {key === 'rowland' && rowlandEntries.length > 0 && (
                    <span className="ml-2 text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{rowlandEntries.length}</span>
                  )}
                  {(key === 'renewals' ? renewalsMatchedCount : rowlandMatchedCount) > 0 && (
                    <span
                      className="ml-2 text-xs bg-red-50 text-red-700 rounded-full px-2 py-0.5"
                      title="Matched, waiting for Update"
                    >
                      {key === 'renewals' ? renewalsMatchedCount : rowlandMatchedCount} matched
                    </span>
                  )}
                </button>
              ))}
            </div>

            {leftTab === 'rowland' && (
              <>
                <div className="p-6 pb-0">
                  <h2 className="text-lg font-semibold mb-4 text-gray-900">Rowland Cup (Outstanding)</h2>
                  <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 pb-2 border-b font-medium text-sm text-gray-900">
                    <div className="w-5"></div>
                    <div>Club</div>
                    <div className="text-right">Outstanding</div>
                    <div className="text-right w-20">Banking</div>
                  </div>
                </div>

                <div className="px-6 max-h-[600px] overflow-y-auto">
                  {rowlandEntries.length === 0 && (
                    <p className="py-6 text-sm text-gray-700 text-center">No Rowland Cup entries are outstanding.</p>
                  )}
                  {rowlandEntries.map(entry => {
                    const owed = owingPence(entry);
                    let banking = 0;
                    if (entry.isMatched) banking = entry.matchedPence;
                    else if (entry.isSelected) banking = Math.min(paymentsTickedPence, owed);
                    const overpaid = entry.isSelected && paymentsTickedPence > owed;
                    return (
                      <div
                        key={entry.id}
                        className={`grid grid-cols-[auto_1fr_auto_auto] gap-3 py-3 hover:bg-gray-50 border-b border-gray-100 ${
                          entry.isSelected ? 'cursor-pointer' : ''
                        }`}
                        onClick={() => entry.isSelected && setEditingRowland(entry)}
                      >
                        <div>
                          <input
                            type="checkbox"
                            checked={entry.isSelected || entry.isMatched}
                            onChange={() => handleRowlandCheck(entry)}
                            disabled={entry.isMatched}
                            className={`h-5 w-5 ${entry.isMatched ? 'text-red-600' : 'text-gray-900'}`}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div>
                          <div className="font-medium">
                            {entry.clubName} <span className="text-xs font-normal text-gray-700">{entry.season}</span>
                          </div>
                          {entry.paymentStatus === 'Partial' && (
                            <div className="text-xs text-gray-700">
                              Partial: {gbpFromPence(entry.amountReceivedPence)} of {gbpFromPence(entry.amountDuePence)} received
                            </div>
                          )}
                          {overpaid && (
                            <div className="text-xs text-red-700">
                              Ticked payments come to {gbpFromPence(paymentsTickedPence)}, more than they owe
                            </div>
                          )}
                        </div>
                        <div className="text-right font-semibold text-blue-500">
                          {gbpFromPence(owed - entry.matchedPence)}
                        </div>
                        <div className="text-right font-semibold text-green-600 w-20">
                          {gbpFromPence(banking)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-6 pt-4 border-t space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Total Outstanding:</span>
                    <span className="font-semibold">{gbpFromPence(rowlandOutstandingPence)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-red-600">
                    <span>Total Matched:</span>
                    <span className="font-semibold">{gbpFromPence(rowlandMatchedPence)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Total Selected:</span>
                    <span className="font-semibold">{gbpFromPence(rowlandSelectedPence)}</span>
                  </div>
                </div>
              </>
            )}

            {leftTab === 'renewals' && (
            <>
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">Renewals (Outstanding)</h2>

              {/* Column Headers */}
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 pb-2 border-b font-medium text-sm text-gray-900">
                <div className="w-5"></div>
                <div>Member</div>
                <div className="text-right">Outstanding</div>
                <div className="text-right w-20">Banking</div>
              </div>
            </div>

            <div className="px-6 max-h-[600px] overflow-y-auto">
              {renewals.map(renewal => (
                <div
                  key={renewal.userName}
                  className={`grid grid-cols-[auto_1fr_auto_auto] gap-3 py-3 hover:bg-gray-50 border-b border-gray-100 ${
                    renewal.isSelected ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => renewal.isSelected && openManualMatchDialog(renewal)}
                >
                  <div>
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
                  </div>
                  <div className="font-medium">{renewal.fullName}</div>
                  <div className="text-right font-semibold text-blue-500">
                    £{renewal.outstanding.toFixed(2)}
                  </div>
                  <div className="text-right font-semibold text-green-600 w-20">
                    £{renewal.selected_banking.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            {/* Renewals Totals */}
            <div className="p-6 pt-4 border-t space-y-2">
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
            </>
            )}
          </div>

          {/* RIGHT COLUMN - PAYMENTS (65%) */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold mb-4 text-gray-900">Payments (Unmatched)</h2>

              {/* Column Headers - 4 distinct columns */}
              <div className="grid grid-cols-[auto_100px_60px_1fr_100px_32px] gap-3 pb-2 border-b font-medium text-sm text-gray-900">
                <div className="w-5"></div>
                <div>Date</div>
                <div>Type</div>
                <div>Reference</div>
                <div className="text-right">Amount</div>
              </div>
            </div>

            <div className="px-6 max-h-[600px] overflow-y-auto">
              {visiblePayments.map(payment => (
                <div
                  key={payment.payment_id}
                  className="grid grid-cols-[auto_100px_60px_1fr_100px_32px] gap-3 py-3 hover:bg-gray-50 border-b border-gray-100"
                  onDoubleClick={() => openAmendDialog(payment)}
                >
                  <div>
                    <input
                      type="checkbox"
                      checked={payment.isSelected || payment.isMatched}
                      onChange={() => handlePaymentCheck(payment)}
                      disabled={payment.isMatched}
                      className={`h-5 w-5 ${
                        payment.isMatched ? 'text-red-600' : 'text-gray-900'
                      }`}
                    />
                  </div>
                  <div className="text-xs font-mono text-gray-700">
                    {payment.date}
                  </div>
                  <div className="text-xs font-semibold text-blue-600">
                    {payment.type}
                  </div>
                  <div className="text-sm text-gray-900 truncate">
                    {payment.reference}
                  </div>
                  <div className="text-right font-semibold text-green-600">
                    £{payment.amount.toFixed(2)}
                  </div>
                  <div className="text-right">
                    {!payment.isMatched && (
                      <button
                        onClick={() => handleDeletePayment(payment)}
                        className="text-gray-700 hover:text-red-600"
                        title="Delete this payment"
                        aria-label={`Delete payment ${payment.payment_id}`}
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Payments Totals */}
            <div className="p-6 pt-4 border-t space-y-2">
              <div className="grid grid-cols-[auto_100px_60px_1fr_100px_32px] gap-3 text-sm">
                <div></div>
                <div></div>
                <div></div>
                <div>Total Banking:</div>
                <div className="text-right font-semibold">£{paymentTotals.totalBanking.toFixed(2)}</div>
              </div>
              <div className="grid grid-cols-[auto_100px_60px_1fr_100px_32px] gap-3 text-sm text-red-600">
                <div></div>
                <div></div>
                <div></div>
                <div>Total Matched:</div>
                <div className="text-right font-semibold">£{paymentTotals.totalMatched.toFixed(2)}</div>
              </div>
              <div className="grid grid-cols-[auto_100px_60px_1fr_100px_32px] gap-3 text-sm">
                <div></div>
                <div></div>
                <div></div>
                <div>Total Selected:</div>
                <div className="text-right font-semibold">£{paymentTotals.totalSelected.toFixed(2)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Add/Amend Payment Dialog */}
        {showPaymentDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4 text-gray-900">
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
                    onClick={() => handleDeletePayment()}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={handleSavePayment}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {editingPayment ? 'Amend' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Manual Match Dialog */}
        {showManualMatchDialog && editingRenewal && (() => {
          // Calculate totals
          const paymentTotals = calculatePaymentTotals(payments);
          const renewalTotals = calculateRenewalTotals(renewals);

          const total_selected_payment = paymentTotals.totalSelected;

          // Exclude current renewal from the total to get "other renewals"
          const other_renewals_total = renewalTotals.totalSelected - editingRenewal.selected_banking;

          // Available amount for THIS renewal
          const available_for_current = total_selected_payment - other_renewals_total;

          // Parse donations and difference inputs
          const donationsNum = typeof manualDonations === 'string' ? parseFloat(manualDonations) || 0 : manualDonations;
          const differenceNum = typeof manualDifference === 'string' ? parseFloat(manualDifference) || 0 : manualDifference;

          // Banking = available amount for this renewal
          const calculatedBanking = available_for_current;

          // Payment Difference should be 0 when banking equals available
          const paymentDifference = 0;

          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 w-96">
                <h3 className="text-lg font-semibold mb-4 text-gray-900">Manual Match Renewal</h3>

                <div className="mb-4 space-y-1">
                  <div className="text-sm text-gray-600">Member: {editingRenewal.fullName}</div>
                  <div className="text-sm text-gray-600">Total Fee Due: £{editingRenewal.totalPayment.toFixed(2)}</div>
                  <div className="text-sm text-gray-600">Outstanding: £{editingRenewal.outstanding.toFixed(2)}</div>
                  <div className="text-xs text-gray-400 border-t pt-2 mt-2">
                    Selected Payment Total: £{total_selected_payment.toFixed(2)}
                  </div>
                  <div className="text-xs text-gray-400">
                    Other Renewals Total: £{other_renewals_total.toFixed(2)}
                  </div>
                  <div className="text-sm font-medium text-purple-600">
                    Available for This Renewal: £{available_for_current.toFixed(2)}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Donations</label>
                    <input
                      type="text"
                      value={manualDonations}
                      onChange={(e) => setManualDonations(e.target.value)}
                      placeholder="0.00"
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Difference</label>
                    <input
                      type="text"
                      value={manualDifference}
                      onChange={(e) => setManualDifference(e.target.value)}
                      placeholder="0.00"
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Payment Notes</label>
                    <input
                      type="text"
                      value={manualNotes}
                      onChange={(e) => setManualNotes(e.target.value)}
                      placeholder="Optional notes"
                      className="w-full border rounded px-3 py-2"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Banking</label>
                    <div className="text-lg font-semibold text-gray-900">
                      £{calculatedBanking.toFixed(2)}
                    </div>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Payment Difference:</span>
                      <div className="flex items-center space-x-2">
                        <span className={`font-semibold ${paymentDifference !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                          £{paymentDifference.toFixed(2)}
                        </span>
                        {paymentDifference !== 0 && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">
                            Part Pay
                          </span>
                        )}
                      </div>
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
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    Amend
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Rowland Cup Match Dialog */}
        {editingRowland && (() => {
          const owed = owingPence(editingRowland);
          const ticked = paymentsTickedPence;
          const tooMuch = ticked > owed;
          const leftPence = owed - ticked;
          return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
              <div className="bg-white rounded-lg p-6 w-96">
                <h3 className="text-lg font-semibold mb-4 text-gray-900">Manual Match Rowland Cup</h3>

                <div className="mb-4 space-y-1">
                  <div className="text-sm text-gray-700">Club: {editingRowland.clubName}</div>
                  <div className="text-sm text-gray-700">Total Fee Due: {gbpFromPence(editingRowland.amountDuePence)}</div>
                  <div className="text-sm text-gray-700">Outstanding: {gbpFromPence(owed)}</div>
                  <div className="text-sm font-medium text-purple-600 border-t pt-2 mt-2">
                    Selected Payment Total: {gbpFromPence(ticked)}
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Still to pay:</span>
                    <div className="flex items-center space-x-2">
                      <span className={`font-semibold ${leftPence !== 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {gbpFromPence(Math.max(leftPence, 0))}
                      </span>
                      {leftPence > 0 && ticked > 0 && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded font-semibold">Part Pay</span>
                      )}
                    </div>
                  </div>
                  {tooMuch && (
                    <p className="text-sm text-red-700 mt-2">
                      That&apos;s more than they owe. Untick a payment, or if they&apos;ve overpaid, sort out the difference with them first.
                    </p>
                  )}
                  {ticked === 0 && (
                    <p className="text-sm text-gray-700 mt-2">Tick the club&apos;s payment(s) on the right first.</p>
                  )}
                </div>

                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    onClick={() => setEditingRowland(null)}
                    className="px-4 py-2 border rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveRowlandPartPay}
                    disabled={tooMuch || ticked === 0}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    Amend
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* CSV Import Format Dialog */}
        {showImportFormatDialog && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-[480px]">
              <h3 className="text-lg font-semibold mb-4 text-gray-900">Import CSV Format</h3>

              <div className="mb-4 space-y-3">
                <p className="text-sm text-gray-600">
                  The CSV file should have 4 columns: Date, Type, Description, Amount. A header line
                  is optional, and outgoings (negative amounts) are skipped.
                </p>

                <div className="bg-gray-50 rounded-lg p-3 font-mono text-xs">
                  <div className="grid grid-cols-[90px_40px_1fr_60px] gap-2 font-semibold text-gray-700 border-b pb-2 mb-2">
                    <div>Date</div>
                    <div>Type</div>
                    <div>Description</div>
                    <div className="text-right">Amount</div>
                  </div>
                  <div className="space-y-1 text-gray-600">
                    <div className="grid grid-cols-[90px_40px_1fr_60px] gap-2">
                      <div>15/01/2025</div>
                      <div>TRF</div>
                      <div>A & B SMITH SUBS</div>
                      <div className="text-right">248.00</div>
                    </div>
                    <div className="grid grid-cols-[90px_40px_1fr_60px] gap-2">
                      <div>18/01/2025</div>
                      <div>CDM</div>
                      <div>JONES SUBS</div>
                      <div className="text-right">116.00</div>
                    </div>
                    <div className="grid grid-cols-[90px_40px_1fr_60px] gap-2">
                      <div>22/01/2025</div>
                      <div>CHQ</div>
                      <div>John Doe Subs</div>
                      <div className="text-right">110.00</div>
                    </div>
                    <div className="grid grid-cols-[90px_40px_1fr_60px] gap-2">
                      <div>25/01/2025</div>
                      <div>CSH</div>
                      <div>J.R Hartley</div>
                      <div className="text-right">31.00</div>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-gray-500">
                  <span className="font-medium">Types:</span> TRF (Bank Transfer), CDM (Card Machine), CHQ (Cheque), CSH (Cash)
                </div>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowImportFormatDialog(false)}
                  className="px-4 py-2 border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setShowImportFormatDialog(false);
                    csvInputRef.current?.click();
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Select File
                </button>
              </div>
            </div>
          </div>
        )}

        {/* CSV Import Dialog */}
        {showImportDialog && (() => {
          // Count transactions by type
          const typeCounts: Record<string, number> = {};
          csvData.forEach((row: any) => {
            const type = row.Type || 'TRF';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
          });

          return (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-96">
              <h3 className="text-lg font-semibold mb-4 text-gray-900">Import Payments</h3>

              <div className="mb-4">
                <p className="text-sm font-medium text-gray-900">
                  Found: {csvData.length} transactions
                </p>
                {csvSkipped > 0 && (
                  <p className="text-xs text-gray-700 mt-1">
                    {csvSkipped} outgoing{csvSkipped === 1 ? '' : 's'} (negative amounts) skipped
                  </p>
                )}
                <div className="mt-2 space-y-1">
                  {Object.entries(typeCounts).map(([type, count]) => (
                    <p key={type} className="text-xs text-gray-500">
                      {type}: {count} transaction{count !== 1 ? 's' : ''}
                    </p>
                  ))}
                </div>
              </div>

              {isImporting && (
                <div className="mb-4 flex items-center text-sm text-blue-500">
                  <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Importing payments...
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowImportDialog(false);
                    setCsvFile(null);
                    setCsvData([]);
                    // Reset file input so same file can be selected again
                    if (csvInputRef.current) {
                      csvInputRef.current.value = '';
                    }
                  }}
                  disabled={isImporting}
                  className="px-4 py-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportCSV}
                  disabled={isImporting}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                >
                  {isImporting && (
                    <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  )}
                  {isImporting ? 'Importing...' : 'Import'}
                </button>
              </div>
            </div>
          </div>
          );
        })()}
      </main>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />
    </div>
  );
}
