// app/renewals/page.tsx
// Membership renewal page for the current season.
//
// Draft / Submit (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §3): a renewing member can Save
// Draft as often as they like, then Submit — after which the renewal is locked for
// everyone (the API enforces it). "Not renewing" submits straight away, and can be
// reopened back to a draft. (The browser's own unsaved-changes autosave below —
// form-draft-utils — is separate from a saved draft and only covers changes not yet saved.)

'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useNavbarConfig } from '@/lib/navbar-config';
import { hasRole } from '@/lib/role-utils';
import { getMemberTypeDisplay, getMemberTypeOptions, isPlayer } from '@/lib/member-type-utils';
import { saveDraft, restoreDraft, clearDraft } from '@/lib/form-draft-utils';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SearchableSelect } from '@/components/SearchableSelect';
import { formatOrdinalDate } from '@/lib/date-utils';
import type { BankDetails } from '@/lib/bank-details';
import Club200NumberPicker, { type Club200Info } from '@/components/Club200NumberPicker';

interface UserProfile {
  userName: string;
  fullKnownAs: string;
  lastName: string;
  ageDemographic: string;
  memberType: string; // PL=Playing Lady, SL=Social Lady, PM=Playing Man, SM=Social Man
  honorary: string | null; // "Y" or "N" or null
  emailAddress: string;
  title: string | null;
  printedMembershipBook: boolean | null;
}

interface Renewal {
  userName: string;
  renewingMembership: boolean;
  number200ClubEntries: number;
  pref200Club?: string;
  club200PickedNumbers?: string[]; // 200 Club numbers chosen (spec §9), given out on Submit
  cleaningDatesToAvoid?: string;
  teaDatesToAvoid?: string;
  drivingAwayMatches?: string;
  drivingAdditionalInfo?: string;
  greenMaintenance?: string;
  greenAdditionalInfo?: string;
  barDuty?: string;
  barAdditionalInfo?: string;
  otherSkills?: string;
  mensChampionship: boolean;
  ladiesMaynard: boolean;
  mensTwoWood: boolean;
  ladiesTwoWood: boolean;
  marriedPairs: boolean;
  drawnPairs: boolean;
  australianPairs: boolean;
  drawnTriples: boolean;
  handicap: boolean;
  oldlands: boolean;
  veterans: boolean;
  drawnPairsSub: boolean;
  australianPairsSub: boolean;
  drawnTriplesSub: boolean;
  outstanding?: number | null;
  banking?: number | null;
  dateReceived?: string | null;
  renewalsClosed?: boolean;
  submittedAt?: string | null; // null = draft
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  paidAtSubmission?: boolean;
  pendingCheckoutSessionId?: string | null; // a "Submit and pay online" page is open
  totalPayment?: number;
  // Stored on the member profile, not the renewal — carried here so it saves with the form
  printedMembershipBook?: boolean | null;
}

// 'pay' = Submit and pay online (spec §11.3a): saved as a draft, submitted by the Stripe
// webhook once paid
type SaveAction = 'draft' | 'submit' | 'pay';

interface FeeBreakdown {
  membershipFee: number;
  club200Fee: number;
  compsFee: number;
  total: number;
}

export default function RenewalsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [renewal, setRenewal] = useState<Renewal | null>(null);
  const [editedRenewal, setEditedRenewal] = useState<Renewal | null>(null);
  const [fees, setFees] = useState<FeeBreakdown>({
    membershipFee: 0,
    club200Fee: 0,
    compsFee: 0,
    total: 0,
  });

  // Editable fields for renewal (not saved to profile)
  const [ageDemographic, setAgeDemographic] = useState<string>('');
  const [memberType, setMemberType] = useState<string>('');
  const [editedAgeDemographic, setEditedAgeDemographic] = useState<string>('');
  const [editedMemberType, setEditedMemberType] = useState<string>('');
  const [fullTimeEducation, setFullTimeEducation] = useState<boolean>(false);

  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [isReopening, setIsReopening] = useState(false);
  // Online payments (spec §11)
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [paymentInProgress, setPaymentInProgress] = useState(false);
  const [confirmPayOpen, setConfirmPayOpen] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<{ tone: 'info' | 'success' | 'warning'; text: string } | null>(null);
  const [isPayingOnline, setIsPayingOnline] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [emailSent, setEmailSent] = useState(true); // Track if confirmation email was sent
  const [emailWarning, setEmailWarning] = useState(''); // Warning if email failed
  // 200 Club (spec §9): this season's price and numbers, which are taken, and which this member holds
  const [club200, setClub200] = useState<Club200Info | null>(null);
  const [eligibility, setEligibility] = useState<{
    canEnterCompetitions: boolean;
    friendliesRequired: number;
    friendliesLastSeason: number | null;
    previousSeasonYear: number;
    override: boolean | null;
  }>({
    canEnterCompetitions: false,
    friendliesRequired: 6,
    friendliesLastSeason: null,
    previousSeasonYear: new Date().getFullYear() - 1,
    override: null,
  });

  // Admin member selector (spec §4): a real Admin (not impersonating) can open any
  // member's renewal here. null = their own. Impersonation isn't used for this because it
  // swaps the role, so the Admin-only Void button would never show.
  const isRealAdmin = hasRole(session?.user?.role, 'Admin') && !(session?.user?.isImpersonating);
  const [targetUserName, setTargetUserName] = useState<string | null>(null);
  // Bumped to reload the renewal (e.g. once a Stripe payment has been recorded)
  const [reloadKey, setReloadKey] = useState(0);
  const loadCounter = useRef(0);
  const [memberOptions, setMemberOptions] = useState<{ userName: string; name: string }[]>([]);
  const ownUserName = session?.user?.userName || '';
  // Searchable list for the selector — "Me" first, then everyone else
  const memberSelectOptions: { value: string; label: string }[] = [{ value: ownUserName, label: `Me (${ownUserName})` }];
  for (const m of memberOptions) {
    if (m.userName.toLowerCase() !== ownUserName.toLowerCase()) {
      memberSelectOptions.push({ value: m.userName, label: m.name });
    }
  }
  // Whose unsaved-changes copy the browser keeps — the member being edited
  const draftOwner = targetUserName || ownUserName;

  // Void (spec §5)
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidInfo, setVoidInfo] = useState<{
    canVoid: boolean;
    blocker: string | null;
    attachments: { club200Numbers: string[]; competitions: { compId: string; name: string }[] };
  } | null>(null);

  // Load renewal data on mount, when the session changes, and when an Admin picks another member
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.userName) {
      loadRenewalData();
    }
  }, [status, session?.user?.userName, session?.user?.isImpersonating, targetUserName, reloadKey]);

  // Reset editing state when user changes (prevents stale state after switching users)
  useEffect(() => {
    setIsEditing(false);
    setIsSubmitted(false);
    setEditedRenewal(null); // Clear edited data to prevent auto-save race condition
  }, [session?.user?.userName, targetUserName]);

  // Members for the Admin selector
  useEffect(() => {
    if (!isRealAdmin) return;
    fetch('/api/admin/members')
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json && Array.isArray(json.members)) {
          const options: { userName: string; name: string }[] = [];
          for (const m of json.members) {
            options.push({ userName: m.userName, name: `${m.firstName} ${m.lastName}` });
          }
          setMemberOptions(options);
        }
      })
      .catch(() => {});
  }, [isRealAdmin]);

  // Recalculate fees whenever renewal data or demographics change
  useEffect(() => {
    if (profile) {
      const currentRenewal = isEditing ? editedRenewal : renewal;
      const currentAgeDemographic = isEditing ? editedAgeDemographic : ageDemographic;
      const currentMemberType = isEditing ? editedMemberType : memberType;

      if (currentRenewal && currentAgeDemographic && currentMemberType) {
        const newFees = calculateFeesClient(
          { ...profile, ageDemographic: currentAgeDemographic, memberType: currentMemberType },
          currentRenewal,
          fullTimeEducation
        );
        setFees(newFees);
      }
    }
  }, [profile, renewal, editedRenewal, ageDemographic, editedAgeDemographic, memberType, editedMemberType, fullTimeEducation, isEditing, club200]);

  // Scroll to top when error is displayed
  useEffect(() => {
    if (error) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [error]);

  // Scroll to top on successful save too — the Save button lives in the sticky navbar
  // so it's reachable while scrolled down, but the success view/banner renders at the
  // top of the page content and would otherwise go unseen.
  useEffect(() => {
    if (isSubmitted) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [isSubmitted]);

  const loadRenewalData = async () => {
    // Only the latest load counts — switching member quickly (or coming back from Stripe
    // to another member's renewal) can leave an earlier load still arriving
    loadCounter.current += 1;
    const thisLoad = loadCounter.current;
    try {
      setIsLoading(true);
      setError('');
      setSuccessMessage('');
      // No userName = the session user (or the impersonated member); an Admin's selector passes one
      const response = await fetch(targetUserName ? `/api/renewals?userName=${encodeURIComponent(targetUserName)}` : '/api/renewals');
      if (thisLoad !== loadCounter.current) return;
      if (!response.ok) throw new Error('Failed to load renewal data');

      const data = await response.json();
      if (thisLoad !== loadCounter.current) return;
      // The printed membership book answer lives on the member profile; carry it on the
      // renewal object so it's edited and saved along with the rest of the form.
      const loadedRenewal: Renewal = {
        ...data.renewal,
        printedMembershipBook: data.profile.printedMembershipBook,
      };
      setProfile(data.profile);
      setRenewal(loadedRenewal);
      setFees(data.fees);
      setEligibility(data.eligibility);
      setClub200(data.club200 || null);
      setBankDetails(data.bankDetails);
      setPaymentReference(data.paymentReference || '');
      setStripeEnabled(data.stripeEnabled === true);
      setPaymentInProgress(data.paymentInProgress === true);

      // Initialize fields from profile
      setAgeDemographic(data.profile.ageDemographic);
      setMemberType(data.profile.memberType);

      // Restore unsaved changes kept in the browser — but never onto a submitted
      // renewal, which can't be changed any more.
      let localChanges: { renewal: Renewal; ageDemographic: string; memberType: string } | null = null;
      if (draftOwner) {
        if (loadedRenewal.submittedAt) {
          clearDraft('Renewals', draftOwner);
        } else {
          localChanges = restoreDraft<{
            renewal: Renewal;
            ageDemographic: string;
            memberType: string;
          }>('Renewals', draftOwner);
        }
      }

      if (localChanges) {
        setEditedRenewal(localChanges.renewal);
        setEditedAgeDemographic(localChanges.ageDemographic);
        setEditedMemberType(localChanges.memberType);
        setIsEditing(true);
        setSuccessMessage('Your unsaved changes from last time have been restored.');
        setTimeout(() => setSuccessMessage(''), 3000);
      } else {
        setEditedRenewal(loadedRenewal);
        setEditedAgeDemographic(data.profile.ageDemographic);
        setEditedMemberType(data.profile.memberType);
      }
    } catch (err) {
      if (thisLoad === loadCounter.current) {
        setError('Failed to load renewal data. Please try again.');
      }
    } finally {
      if (thisLoad === loadCounter.current) {
        setIsLoading(false);
      }
    }
  };

  // Auto-save drafts when editing
  useEffect(() => {
    if (!renewal || !draftOwner || !isEditing) return;

    const draftData = {
      renewal: editedRenewal,
      ageDemographic: editedAgeDemographic,
      memberType: editedMemberType,
    };

    const hasChanges = JSON.stringify(draftData) !== JSON.stringify({
      renewal,
      ageDemographic,
      memberType,
    });

    // Auto-save draft when in edit mode and changes exist
    if (hasChanges) {
      saveDraft('Renewals', draftOwner, draftData);
    }
  }, [editedRenewal, editedAgeDemographic, editedMemberType, renewal, ageDemographic, memberType, isEditing, draftOwner]);

  const handleEdit = () => {
    setIsEditing(true);
    setError('');
    setSuccessMessage('');
  };

  const handleCancel = () => {
    if (draftOwner) {
      clearDraft('Renewals', draftOwner);
    }
    setIsEditing(false);
    setEditedRenewal(renewal);
    setEditedAgeDemographic(ageDemographic);
    setEditedMemberType(memberType);
    setError('');
    setSuccessMessage('');
  };

  const handleChange = (field: keyof Renewal, value: any) => {
    if (!editedRenewal) return;
    setEditedRenewal({ ...editedRenewal, [field]: value });
  };

  // Fewer entries than picks — drop the highest picks so there's never more picks than entries
  const handle200ClubEntriesChange = (entries: number) => {
    if (!editedRenewal) return;
    const picks = editedRenewal.club200PickedNumbers || [];
    const kept = picks.slice(0, Math.max(0, entries));
    setEditedRenewal({ ...editedRenewal, number200ClubEntries: entries, club200PickedNumbers: kept });
  };

  const handleSave = async (action: SaveAction) => {
    if (!editedRenewal) return;

    if (editedRenewal.renewingMembership !== true && editedRenewal.renewingMembership !== false) {
      setError('Please choose whether you are renewing or cancelling your membership.');
      return;
    }

    // Validation: Check if required fields are set
    if (editedRenewal.renewingMembership && (!editedAgeDemographic || !editedMemberType)) {
      setError('Please select both Age Demographic and Member Type before saving.');
      return;
    }

    if ((action === 'submit' || action === 'pay') && editedRenewal.renewingMembership
      && editedRenewal.printedMembershipBook !== true && editedRenewal.printedMembershipBook !== false) {
      setError('Please say whether you would like a printed membership book before submitting.');
      return;
    }

    setIsSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/renewals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editedRenewal,
          action,
          ageDemographic: editedAgeDemographic, // Include age demographic for Members sheet update
          memberType: editedMemberType, // Include member type for Members sheet update
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        // A picked 200 Club number has gone since the form loaded — show it crossed out
        // so the member can choose another. Nothing was submitted.
        if (Array.isArray(data.club200Taken) && data.club200) {
          setClub200(data.club200);
        }
        if (response.status === 409) {
          // Submitted elsewhere (another tab, or a buddy) — show the locked renewal.
          if (draftOwner) {
            clearDraft('Renewals', draftOwner);
          }
          setIsEditing(false);
          await loadRenewalData();
        }
        throw new Error(data.error || 'Failed to save renewal');
      }

      const data = await response.json();

      // Submit and pay online — off to Stripe's payment page. The form is saved as a
      // draft on the server, so the browser's copy isn't needed.
      if (data.checkoutUrl) {
        if (draftOwner) {
          clearDraft('Renewals', draftOwner);
        }
        setIsPayingOnline(true);
        window.location.href = data.checkoutUrl;
        return;
      }

      setFees(data.fees);
      if (data.club200) setClub200(data.club200);

      // Track email status
      setEmailSent(data.emailSent !== false); // Default to true if not specified
      setEmailWarning(data.warning || '');

      // The browser's unsaved-changes copy isn't needed once the server has it
      if (draftOwner) {
        clearDraft('Renewals', draftOwner);
      }

      // Update main state with saved values
      let submittedAt: string | null = null;
      if (data.renewal && data.renewal.submittedAt) {
        submittedAt = data.renewal.submittedAt;
      }
      setRenewal({ ...editedRenewal, submittedAt });
      setAgeDemographic(editedAgeDemographic);
      setMemberType(editedMemberType);
      setIsEditing(false);

      if (data.submitted) {
        setIsSubmitted(true);
      } else {
        setSuccessMessage(data.emailSent === false
          ? 'Saved as a draft. Your renewal is NOT submitted yet — come back and press Submit Renewal when you are ready.'
          : 'Saved as a draft and emailed to you. Your renewal is NOT submitted yet — come back and press Submit Renewal when you are ready.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to save renewal');
    } finally {
      setIsSaving(false);
    }
  };

  // Submit asks for confirmation first when renewing, since it locks the renewal for good.
  // "Not renewing" submits straight away (it can be reopened).
  const handleSubmitClick = () => {
    if (editedRenewal && editedRenewal.renewingMembership) {
      setConfirmSubmitOpen(true);
    } else {
      handleSave('submit');
    }
  };

  const handleConfirmSubmit = () => {
    setConfirmSubmitOpen(false);
    handleSave('submit');
  };

  const handleConfirmPay = () => {
    setConfirmPayOpen(false);
    handleSave('pay');
  };

  // Pay online for a submitted renewal — the same Stripe page as My Account's Pay online
  const handlePayOutstanding = async () => {
    if (!renewal) return;
    setError('');
    setIsPayingOnline(true);
    try {
      const res = await fetch('/api/payments/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userNames: [renewal.userName] }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start the payment.');
        setIsPayingOnline(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Could not start the payment.');
      setIsPayingOnline(false);
    }
  };

  // Release a held draft — the member left Stripe's page without paying. Cancels by
  // member (null = the session user); the server finds the payment page from the renewal.
  // Returns 'recorded' if Stripe shows it was paid after all.
  const cancelHeldPayment = async (memberUserName: string | null): Promise<string> => {
    try {
      const res = await fetch('/api/payments/stripe/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', userName: memberUserName || undefined }),
      });
      const data = await res.json();
      return data.outcome || '';
    } catch {
      return '';
    }
  };

  const cancelledNotice = (outcome: string) => {
    if (outcome === 'recorded') {
      setPaymentNotice({ tone: 'success', text: 'That payment had already gone through — the renewal is submitted and paid.' });
    } else {
      setPaymentNotice({ tone: 'warning', text: "The online payment was cancelled. The renewal hasn't been submitted — it's still a draft, and nothing has been taken." });
    }
  };

  const handleCancelHeldPayment = async () => {
    if (!renewal) return;
    setIsSaving(true);
    const outcome = await cancelHeldPayment(targetUserName);
    setIsSaving(false);
    cancelledNotice(outcome);
    setReloadKey((k) => k + 1);
  };

  // The browser's Back button from Stripe's page can show this page from the browser's
  // memory as it was before leaving — reload it so the renewal is up to date.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Back from Stripe: ?payment=processing (paid — wait for the webhook to submit it) or
  // ?payment=cancelled (left without paying — release the draft). &member= brings an
  // Admin back to the member they were working on. Runs once the session is known.
  const [returnHandled, setReturnHandled] = useState(false);
  useEffect(() => {
    if (returnHandled || status !== 'authenticated') return;
    setReturnHandled(true);
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    const sessionId = params.get('session_id');
    const member = params.get('member');
    if (payment !== 'cancelled' && payment !== 'processing') return;
    let memberUserName: string | null = null;
    if (member && isRealAdmin) {
      memberUserName = member;
      setTargetUserName(member);
    }
    window.history.replaceState(null, '', '/renewals');

    if (payment === 'cancelled') {
      cancelHeldPayment(memberUserName).then((outcome) => {
        cancelledNotice(outcome);
        setReloadKey((k) => k + 1);
      });
      return;
    }

    if (payment === 'processing' && sessionId) {
      setPaymentNotice({ tone: 'info', text: 'Payment received — submitting your renewal…' });
      let attempts = 0;
      const check = () => {
        attempts += 1;
        fetch('/api/payments/stripe/status?session=' + encodeURIComponent(sessionId))
          .then((r) => r.json())
          .then((data) => {
            if (data.status === 'recorded') {
              setPaymentNotice({ tone: 'success', text: 'Thank you — your renewal is submitted and paid. A confirmation email is on its way, and Stripe will email a receipt.' });
              setReloadKey((k) => k + 1);
            } else if (data.status === 'expired') {
              setPaymentNotice({ tone: 'warning', text: "That payment page expired before it was paid. Nothing has been taken, and your renewal is still a draft." });
              setReloadKey((k) => k + 1);
            } else if (attempts >= 20) {
              setPaymentNotice({ tone: 'warning', text: "Your payment is taking longer than usual to show here. There's no need to pay again — refresh this page in a few minutes." });
            } else {
              setTimeout(check, 2000);
            }
          })
          .catch(() => {
            if (attempts < 20) setTimeout(check, 2000);
          });
      };
      check();
    }
  }, [status, returnHandled, isRealAdmin]);

  // Reopen a submitted "not renewing" renewal back to a draft (spec §3.7)
  const handleReopen = async () => {
    setIsReopening(true);
    setError('');
    setSuccessMessage('');
    try {
      const response = await fetch('/api/renewals', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen', userName: targetUserName || undefined }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to reopen renewal');
      }
      setIsSubmitted(false);
      await loadRenewalData();
      setIsEditing(true);
      setSuccessMessage('Your renewal has been reopened. Make your choices below, then submit it.');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to reopen renewal');
    } finally {
      setIsReopening(false);
    }
  };

  // Void (Admin, spec §5): check it's allowed and fetch what's still attached, then open the dialog
  const handleVoidClick = async () => {
    if (!renewal) return;
    setError('');
    setVoidReason('');
    setVoidInfo(null);
    try {
      const response = await fetch(`/api/renewals/void?userName=${encodeURIComponent(renewal.userName)}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to check renewal');
      }
      if (!data.canVoid) {
        setError(data.blocker || 'This renewal can\'t be voided.');
        return;
      }
      setVoidInfo(data);
      setVoidDialogOpen(true);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Failed to check renewal');
    }
  };

  const handleConfirmVoid = async () => {
    if (!renewal || !voidReason.trim()) return;
    setIsVoiding(true);
    setError('');
    try {
      const response = await fetch('/api/renewals/void', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: renewal.userName, reason: voidReason.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to void renewal');
      }
      setVoidDialogOpen(false);
      await loadRenewalData();
      setSuccessMessage('The renewal has been voided. Nothing is owed on it now.');
    } catch (err) {
      setVoidDialogOpen(false);
      setError(err instanceof Error && err.message ? err.message : 'Failed to void renewal');
    } finally {
      setIsVoiding(false);
    }
  };

  // The season's 200 Club price per entry (£6 until the settings have loaded)
  let club200Price = 6;
  if (club200 && club200.open) club200Price = club200.price;

  // Client-side fee calculation (mirrors backend logic)
  const calculateFeesClient = (
    profile: UserProfile,
    renewal: Renewal,
    fullTimeEdu: boolean = false
  ): FeeBreakdown => {
    let membershipFee = 0;

    const ageDem = profile.ageDemographic;
    const memType = profile.memberType;
    const isHonorary = profile.honorary === 'Y';

    // Honorary members pay no fee regardless of member type
    if (isHonorary) {
      membershipFee = 0;
    }
    // Playing members (Playing Lady or Playing Man)
    else if (memType === 'Playing Lady' || memType === 'Playing Man') {
      switch (ageDem) {
        case 'U18':
          membershipFee = 10;
          break;
        case '18-24':
          membershipFee = fullTimeEdu ? 10 : 60;
          break;
        case '25-59':
          membershipFee = 110;
          break;
        case '60+':
          membershipFee = 110;
          break;
        case '80+':
          membershipFee = 60;
          break;
      }
    }
    // Social members (Social Lady or Social Man)
    else if (memType === 'Social Lady' || memType === 'Social Man') {
      membershipFee = 25;
    }

    // Calculate 200 Club fees — the season's price from the 200 Club settings (spec §9.3)
    const club200Fee = renewal.number200ClubEntries * club200Price;

    // Calculate competition fees
    const competitions = [
      'mensChampionship',
      'ladiesMaynard',
      'mensTwoWood',
      'ladiesTwoWood',
      'marriedPairs',
      'drawnPairs',
      'australianPairs',
      'drawnTriples',
      'handicap',
      'oldlands',
      'veterans',
    ];

    const compCount = competitions.filter(
      (comp) => renewal[comp as keyof Renewal] === true
    ).length;

    const compsFee = compCount * 2;

    const total = membershipFee + club200Fee + compsFee;

    return { membershipFee, club200Fee, compsFee, total };
  };

  const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

  // Get allowed member types for dropdown
  const getAllowedMemberTypes = () => {
    // Return all member type options
    return getMemberTypeOptions();
  };

  // Determine if user can enter a competition based on member type
  const canEnterCompetition = (competitionKey: string): boolean => {
    if (!profile?.memberType) return true; // Default to allow if no member type

    const isMale = profile.memberType === 'Playing Man' || profile.memberType === 'Social Man';
    const isFemale = profile.memberType === 'Playing Lady' || profile.memberType === 'Social Lady';

    // Men's only competitions
    if (competitionKey === 'mensChampionship' || competitionKey === 'mensTwoWood') {
      return isMale;
    }

    // Ladies' only competitions
    if (competitionKey === 'ladiesMaynard' || competitionKey === 'ladiesTwoWood') {
      return isFemale;
    }

    // All other competitions are open to everyone
    return true;
  };

  // The navbar holds two buttons. Renewing: Submit + Save Draft (Cancel is on the page).
  // Not renewing: Save (which submits) + Cancel.
  const editingRenewing = !!(editedRenewal && editedRenewal.renewingMembership);
  useNavbarConfig({
    actionButtons: isEditing ? {
      primary: {
        label: editingRenewing ? 'Submit Renewal' : 'Save',
        onClick: handleSubmitClick,
        loading: isSaving,
        variant: 'primary' as const,
      },
      secondary: editingRenewing ? {
        label: 'Save Draft',
        onClick: () => handleSave('draft'),
        disabled: isSaving,
        variant: 'secondary' as const,
      } : {
        label: 'Cancel',
        onClick: handleCancel,
        disabled: isSaving,
        variant: 'secondary' as const,
      },
    } : undefined,
  });

  if (status === 'loading' || isLoading || !profile || !renewal) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading renewal data...</p>
        </div>
      </div>
    );
  }

  // A submitted renewal is locked for everyone, Admin included (spec §3.4) — the API
  // refuses any change, this just shows it read-only.
  const isAdmin = hasRole(session?.user?.role, 'Admin', 'Super Admin');
  const isImpersonating = session?.user?.isImpersonating || false;
  const isLocked = !!renewal.submittedAt;
  const paymentReceived = renewal.banking !== null && renewal.banking !== undefined && renewal.banking > 0;
  let submittedOnLabel = '';
  if (renewal.submittedAt) {
    submittedOnLabel = formatOrdinalDate(renewal.submittedAt.substring(0, 10));
  }

  // Renewals closed check — show closed message to non-admin, non-impersonating users
  if (renewal.renewalsClosed && !isAdmin && !isImpersonating) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="max-w-3xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
          <div className="bg-white shadow rounded-lg p-8 text-center">
            <p className="text-gray-700 text-lg">
              Sorry. Membership renewals are now closed for this season.
              Please contact the Club Secretary.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Helper variables: use edited values when editing, otherwise use saved values
  const currentRenewal = isEditing ? editedRenewal : renewal;
  const currentAgeDemographic = isEditing ? editedAgeDemographic : ageDemographic;
  const currentMemberType = isEditing ? editedMemberType : memberType;
  const isFormDisabled = !isEditing || isLocked;

  // Admin member selector (spec §4) — view any member's renewal, and reach Void. Also shown
  // on the "submitted" screen so the Admin can go straight on to the next member.
  const adminMemberSelector = isRealAdmin ? (
    <div className="mb-4 bg-white shadow rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
      <label className="text-sm font-medium text-gray-900">Member:</label>
      <SearchableSelect
        options={memberSelectOptions}
        value={targetUserName || ''}
        onChange={(value) => setTargetUserName(value === '' || value === ownUserName ? null : value)}
        disabled={isSaving}
        placeholder={`Me (${ownUserName}) — type to search members...`}
        className="w-full sm:w-80"
      />
      {targetUserName && (
        <span className="text-sm text-gray-700">Viewing {profile.fullKnownAs} {profile.lastName}&apos;s renewal</span>
      )}
    </div>
  ) : null;

  // Success message after submission
  if (isSubmitted && renewal.renewingMembership) {

    return (
      <div className="min-h-screen bg-gray-50">
        <main className={'max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 ' + (isRealAdmin ? 'py-6' : 'py-12')}>
          {adminMemberSelector}
          <div className="bg-white shadow-lg rounded-lg overflow-hidden">
            <div className="bg-green-50 px-6 py-4 border-b border-green-100">
              <div className="flex items-center">
                <svg className="h-6 w-6 text-green-600 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <h2 className="text-lg font-semibold text-green-900">
                  {isImpersonating || targetUserName
                    ? `Thank you! ${profile?.fullKnownAs}'s renewal has been submitted.`
                    : 'Thank you! Your renewal has been submitted.'}
                </h2>
              </div>
            </div>

            <div className="px-6 py-8">
              <div className="mb-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Fee Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Membership Fee:</span>
                    <span className="font-medium">{formatCurrency(fees.membershipFee)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">200 Club:</span>
                    <span className="font-medium">{formatCurrency(fees.club200Fee)}</span>
                  </div>
                  {club200 && renewal.number200ClubEntries > 0 && (
                    <Club200NumberPicker
                      info={club200}
                      entries={renewal.number200ClubEntries}
                      picks={renewal.club200PickedNumbers || []}
                      disabled={true}
                      submitted={true}
                      onChange={() => {}}
                    />
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Competitions:</span>
                    <span className="font-medium">{formatCurrency(fees.compsFee)}</span>
                  </div>
                  <div className="border-t pt-2 mt-2 flex justify-between text-lg">
                    <span className="font-semibold text-gray-900">Total Payable:</span>
                    <span className="font-bold text-blue-500">{formatCurrency(fees.total)}</span>
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-medium text-blue-900 mb-3">Payment Details</h3>
                <div className="space-y-1 text-sm text-blue-800">
                  <p><span className="font-medium">Bank:</span> {bankDetails ? bankDetails.bankName : ''}</p>
                  <p><span className="font-medium">Sort Code:</span> {bankDetails ? bankDetails.bankSortCode : ''}</p>
                  <p><span className="font-medium">Account Number:</span> {bankDetails ? bankDetails.bankAccountNumber : ''}</p>
                  <p><span className="font-medium">Account Name:</span> {bankDetails ? bankDetails.bankAccountName : ''}</p>
                  <p><span className="font-medium">Reference:</span> {paymentReference}</p>
                </div>
                <p className="mt-4 text-sm text-blue-700">
                  Please make payment at your earliest convenience. Card payments are also accepted at the bar.
                </p>
                {stripeEnabled && (
                  <button
                    onClick={handlePayOutstanding}
                    disabled={isPayingOnline}
                    className="mt-4 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isPayingOnline ? 'Opening payment page…' : 'Pay online by card'}
                  </button>
                )}
              </div>

              {renewal.drawnTriples && (
                <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6">
                  <div className="flex items-start">
                    <svg className="h-5 w-5 text-yellow-600 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-yellow-900 mb-1">Important: Drawn Triples Competition</p>
                      <p className="text-sm text-yellow-800">
                        The 1st round of TRIPLES is to be played at 10 a.m. on Sunday 24th May, unless an earlier date is agreed by all 6 players.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {emailSent ? (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <p className="text-sm text-gray-700">
                    ✉️ A confirmation email has been sent{profile?.emailAddress ? ' to' : ''}{' '}
                    {isImpersonating && profile?.emailAddress && (
                      <span className="font-medium">{profile?.fullKnownAs} at </span>
                    )}
                    {profile?.emailAddress && (
                      <span className="font-medium">{profile?.emailAddress}</span>
                    )}
                  </p>
                </div>
              ) : emailWarning && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800">
                    ⚠️ {emailWarning}
                  </p>
                </div>
              )}

              <div className="mt-6 flex justify-center">
                <button
                  onClick={() => router.push('/')}
                  className="px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Return to Home
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Main Content */}
      <main className="max-w-4xl mx-auto py-6 sm:px-6 lg:px-8">
        {adminMemberSelector}

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {/* Success Message */}
        {successMessage && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {successMessage}
          </div>
        )}

        {/* Success Message (non-renewing) */}
        {isSubmitted && !renewal.renewingMembership && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            Your renewal status has been updated.
          </div>
        )}

        {/* Renewal Form */}
        <div className="bg-white shadow rounded-lg">
          <div className="px-4 py-5 sm:p-6">
            {/* Status: voided (spec §5) — nothing is owed */}
            {renewal.voidedAt && (
              <div className="mb-6 bg-gray-100 border border-gray-300 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-900">
                  This renewal was voided on {formatOrdinalDate(renewal.voidedAt.substring(0, 10))}
                  {renewal.voidedBy ? ` by ${renewal.voidedBy}` : ''}. Nothing is owed on it.
                </p>
                {renewal.voidReason && (
                  <p className="text-sm text-gray-700 mt-1">Reason: {renewal.voidReason}</p>
                )}
              </div>
            )}

            {/* Status: submitted (locked) */}
            {isLocked && !renewal.voidedAt && (
              <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-sm font-medium text-green-900">
                  {renewal.renewingMembership
                    ? `Renewal submitted on ${submittedOnLabel}.`
                    : `You told us on ${submittedOnLabel} that you are not renewing your membership.`}
                </p>
                <p className="text-sm text-green-800 mt-1">
                  {renewal.renewingMembership
                    ? 'A submitted renewal can\'t be changed. If something is wrong, please contact the Treasurer.'
                    : 'If you change your mind, you can reopen your renewal and fill it in.'}
                </p>
                {!renewal.renewingMembership && (
                  <button
                    onClick={handleReopen}
                    disabled={isReopening}
                    className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isReopening ? 'Reopening…' : 'Reopen renewal'}
                  </button>
                )}
                {/* Void — Admin only, renewing, nothing paid (re-checked by the server) */}
                {isRealAdmin && renewal.renewingMembership && !paymentReceived && (
                  <div className="mt-3 pt-3 border-t border-green-200">
                    <button
                      onClick={handleVoidClick}
                      disabled={isVoiding}
                      className="px-4 py-2 bg-white text-red-700 border border-red-300 rounded-md hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Void renewal
                    </button>
                    <p className="text-xs text-gray-700 mt-1">
                      Admin only. Cancels what&apos;s owed on this renewal. Only possible while nothing has been paid.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Back from Stripe, or an online payment cancelled */}
            {paymentNotice && (
              <div className={'mb-6 rounded-lg p-4 text-sm border ' + (
                paymentNotice.tone === 'success' ? 'bg-green-50 border-green-200 text-green-900'
                  : paymentNotice.tone === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-blue-50 border-blue-200 text-blue-900'
              )}>
                {paymentNotice.text}
              </div>
            )}

            {/* A "Submit and pay online" page is open — the draft is held until it's paid or cancelled */}
            {!isLocked && paymentInProgress && (
              <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm font-medium text-blue-900">An online payment for this renewal is in progress.</p>
                <p className="text-sm text-blue-900 mt-1">
                  It can&apos;t be changed until the payment is finished. If you left the payment page without paying, cancel it here.
                </p>
                <button
                  onClick={handleCancelHeldPayment}
                  disabled={isSaving}
                  className="mt-3 px-4 py-2 bg-white text-blue-700 border border-blue-500 rounded-md hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel the online payment
                </button>
              </div>
            )}

            {/* Status: a saved draft that hasn't been submitted */}
            {!isLocked && renewal.renewingMembership === true && (
              <div className="mb-6 bg-yellow-50 border border-yellow-300 rounded-lg p-4">
                <p className="text-sm font-medium text-yellow-900">
                  Your renewal is saved as a draft. It is NOT submitted yet.
                </p>
                <p className="text-sm text-yellow-900 mt-1">
                  You can change it as often as you like. When you are happy with it, press Submit Renewal. Please don&apos;t pay until you have submitted.
                </p>
              </div>
            )}

            {/* Edit Button (View Mode Only) - Submit / Save Draft are in the navbar when editing */}
            {!isEditing && !isLocked && !paymentInProgress && (
              <div className="flex justify-end space-x-3 mb-6">
                <button
                  onClick={handleEdit}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer"
                >
                  {renewal.renewingMembership === true ? 'Continue Renewal' : 'Start Renewal'}
                </button>
              </div>
            )}

            {/* Cancel unsaved changes — the navbar's two buttons are Submit and Save Draft when renewing */}
            {isEditing && editingRenewing && (
              <div className="flex justify-end mb-6">
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel changes
                </button>
              </div>
            )}

            {/* Membership Renewal Section */}
            <div className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    name="membershipStatus"
                    checked={currentRenewal?.renewingMembership === true}
                    onChange={() => handleChange('renewingMembership', true)}
                    disabled={isFormDisabled}
                    className="h-5 w-5 text-blue-500 focus:ring-blue-500 border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="ml-3 text-lg font-medium text-gray-900">
                    I will be renewing my membership
                  </span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    name="membershipStatus"
                    checked={currentRenewal?.renewingMembership === false}
                    onChange={() => handleChange('renewingMembership', false)}
                    disabled={isFormDisabled}
                    className="h-5 w-5 text-red-500 focus:ring-red-500 border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="ml-3 text-lg font-medium text-gray-900">
                    I will be cancelling my membership
                  </span>
                </label>
              </div>

              {currentRenewal?.renewingMembership && (
                <div className="mt-6 p-4 bg-gray-50 rounded-md">
                  <p className="text-sm text-gray-600 mb-4">
                    Please ensure you select the correct age demographic as that affects the membership level.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Age Demographic
                      </label>
                      <select
                        value={currentAgeDemographic}
                        onChange={(e) => isEditing ? setEditedAgeDemographic(e.target.value) : setAgeDemographic(e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">-- Select Age Demographic --</option>
                        <option value="U18">Under 18</option>
                        <option value="18-24">18-24</option>
                        <option value="25-59">25-59</option>
                        <option value="60+">60+</option>
                        <option value="80+">80+</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Member Type
                      </label>
                      <select
                        value={currentMemberType}
                        onChange={(e) => isEditing ? setEditedMemberType(e.target.value) : setMemberType(e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">-- Select Member Type --</option>
                        {getAllowedMemberTypes().map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {profile?.honorary === 'Y' && (
                        <p className="mt-2 text-sm text-gray-600 italic">
                          Honorary Member
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Full-time Education Checkbox (only for 18-24) */}
                  {currentAgeDemographic === '18-24' && (
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={fullTimeEducation}
                          onChange={(e) => setFullTimeEducation(e.target.checked)}
                          disabled={isFormDisabled}
                          className="h-4 w-4 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                        />
                        <label className="ml-2 text-sm text-gray-700">
                          I am in full-time education
                          <span className="ml-2 text-xs text-gray-500">(reduces fee from £60 to £10)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-gray-700">Membership Fee:</span>
                      <span className="text-lg font-semibold text-blue-500">
                        {formatCurrency(fees.membershipFee)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {currentRenewal?.renewingMembership && (
              <>
                {/* Printed Membership Book — saved on the member profile, carried from year to year (spec §3.8) */}
                <div className="mb-8 pb-8 border-b">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Printed Membership Book</h3>
                  <p className="text-sm text-gray-700 mb-4">
                    Do you want a printed membership book? (contains contact names and fixtures)
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 sm:gap-8">
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="printedMembershipBook"
                        checked={currentRenewal?.printedMembershipBook === true}
                        onChange={() => handleChange('printedMembershipBook', true)}
                        disabled={isFormDisabled}
                        className="h-5 w-5 text-blue-500 focus:ring-blue-500 border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-900">Yes, please</span>
                    </label>
                    <label className="flex items-center cursor-pointer">
                      <input
                        type="radio"
                        name="printedMembershipBook"
                        checked={currentRenewal?.printedMembershipBook === false}
                        onChange={() => handleChange('printedMembershipBook', false)}
                        disabled={isFormDisabled}
                        className="h-5 w-5 text-blue-500 focus:ring-blue-500 border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="ml-3 text-sm font-medium text-gray-900">No, thank you</span>
                    </label>
                  </div>
                  {isEditing && currentRenewal?.printedMembershipBook !== true && currentRenewal?.printedMembershipBook !== false && (
                    <p className="mt-2 text-sm text-gray-700">Please choose one before you submit.</p>
                  )}
                </div>

                {/* 200 Club Section */}
                <div className="mb-8 pb-8 border-b">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">200 Club</h3>
                  <p className="text-sm text-gray-700 mb-4">
                    A 200 club entry costs {formatCurrency(club200Price)} per year for a monthly draw for cash prizes throughout the playing season. Please enter the total number of 200 club entries required.
                  </p>
                  {/* Entries need the season's 200 Club settings (spec §9.3) — an existing
                      count is still shown so it can be set back to 0 */}
                  {club200 && !club200.open && (
                    <p className="mb-4 text-sm font-medium text-amber-800">
                      200 Club entries for {club200.season} are not open yet.
                    </p>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Number of entries ({formatCurrency(club200Price)} per entry)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={currentRenewal?.number200ClubEntries}
                        onChange={(e) => handle200ClubEntriesChange(parseInt(e.target.value) || 0)}
                        disabled={isFormDisabled || (club200 !== null && !club200.open && !(currentRenewal?.number200ClubEntries > 0))}
                        className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>
                    {club200 && club200.open && currentRenewal?.number200ClubEntries > 0 && (
                      <Club200NumberPicker
                        info={club200}
                        entries={currentRenewal.number200ClubEntries}
                        picks={currentRenewal.club200PickedNumbers || []}
                        disabled={isFormDisabled}
                        submitted={isLocked}
                        onChange={(picks) => handleChange('club200PickedNumbers', picks)}
                      />
                    )}
                    <div className="flex justify-between items-center pt-2">
                      <span className="text-sm font-medium text-gray-700">200 Club Fee:</span>
                      <span className="text-lg font-semibold text-blue-500">
                        {formatCurrency(fees.club200Fee)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Volunteering Section */}
                <div className="mb-8 pb-8 border-b">
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Volunteering</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    The club relies on volunteers to run the club, so please consider how you can help.
                  </p>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tea Duty - Dates to avoid (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        All FULL members are expected to take their turn with tea duty throughout the season. Please indicate any days or dates you are not available, or if you are willing to do additional duties.
                      </p>
                      <textarea
                        value={currentRenewal?.teaDatesToAvoid || ''}
                        onChange={(e) => handleChange('teaDatesToAvoid', e.target.value)}
                        rows={2}
                        placeholder="e.g., July 15, August 10-20"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cleaning - Dates to avoid (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        All FULL members are expected to take their turn with cleaning duty on a Saturday morning. Please indicate any dates you are not available.
                      </p>
                      <textarea
                        value={currentRenewal?.cleaningDatesToAvoid || ''}
                        onChange={(e) => handleChange('cleaningDatesToAvoid', e.target.value)}
                        rows={2}
                        placeholder="e.g., December, summer holidays"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>

                    {/* Driving - Only for Playing members */}
                    {isPlayer(memberType) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Driving to Away Matches (optional)
                        </label>
                        <p className="text-xs text-gray-500 mb-2">
                          Please indicate if you are willing to drive other members to away matches occasionally.
                        </p>
                        <select
                          value={currentRenewal?.drivingAwayMatches || ''}
                          onChange={(e) => handleChange('drivingAwayMatches', e.target.value)}
                          disabled={isFormDisabled}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border mb-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                        >
                          <option value="">Please select</option>
                          <option value="Y">Y</option>
                          <option value="N">N</option>
                        </select>
                        <textarea
                          value={currentRenewal?.drivingAdditionalInfo || ''}
                          onChange={(e) => handleChange('drivingAdditionalInfo', e.target.value)}
                          rows={2}
                          placeholder="Additional information (e.g., limited space, certain days only)"
                          disabled={isFormDisabled}
                          className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                        />
                      </div>
                    )}

                    {/* Green, Bar, Other Skills - Available for all members */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Green &amp; Surrounds Maintenance (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Please indicate if you are willing to help keeping up with the many things that need to be done outside, for instance sweeping, mowing surrounds, hedges &amp; general maintenance.
                      </p>
                      <select
                        value={currentRenewal?.greenMaintenance || ''}
                        onChange={(e) => handleChange('greenMaintenance', e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border mb-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">Please select</option>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                      <textarea
                        value={currentRenewal?.greenAdditionalInfo || ''}
                        onChange={(e) => handleChange('greenAdditionalInfo', e.target.value)}
                        rows={2}
                        placeholder="Additional information"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bar Duty (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        Please indicate if you are willing to help with running the bar. This can involve one or two voluntary evening shifts per month or opening the bar after a home game.
                      </p>
                      <select
                        value={currentRenewal?.barDuty || ''}
                        onChange={(e) => handleChange('barDuty', e.target.value)}
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border mb-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      >
                        <option value="">Please select</option>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                      </select>
                      <textarea
                        value={currentRenewal?.barAdditionalInfo || ''}
                        onChange={(e) => handleChange('barAdditionalInfo', e.target.value)}
                        rows={2}
                        placeholder="Additional information"
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Other Skills (optional)
                      </label>
                      <p className="text-xs text-gray-500 mb-2">
                        If you have any other skills which may benefit the club, or other ways in which you may be able to help, please give details here. (e.g. plumbing, electrics, decorating, bookkeeping, legal, IT, local councillor, grant applications etc)
                      </p>
                      <textarea
                        value={currentRenewal?.otherSkills || ''}
                        onChange={(e) => handleChange('otherSkills', e.target.value)}
                        rows={3}
                        placeholder="e.g., plumbing, IT support, legal advice..."
                        disabled={isFormDisabled}
                        className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                </div>

                {/* Club Competitions Section - Only for Playing members */}
                {isPlayer(memberType) && (
                  <div className="mb-8 pb-8 border-b">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Club Competitions</h3>

                    {/* Detailed Instructions */}
                    <div className="mb-4 space-y-2 text-sm text-gray-700">
                      <p>Entry to competitions will only be accepted by playing members who have made themselves available for {eligibility.friendliesRequired} Friendly matches in the previous season.</p>
                      {eligibility.override === null && (
                        <p>
                          {eligibility.friendliesLastSeason === null
                            ? `There are no friendlies records for ${eligibility.previousSeasonYear}.`
                            : `You made yourself available for ${eligibility.friendliesLastSeason} Friendly ${eligibility.friendliesLastSeason === 1 ? 'match' : 'matches'} in ${eligibility.previousSeasonYear}.`}
                        </p>
                      )}
                      <p>
                        You are <span className={eligibility.canEnterCompetitions ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>{eligibility.canEnterCompetitions ? 'eligible' : 'NOT eligible'}</span> to enter Club Comps this season. {!eligibility.canEnterCompetitions && 'If you believe this is incorrect, please contact BHBC.'}
                      </p>
                      <p className="text-xs">New members shall not be eligible to enter any Club competition in their first full playing season. Exceptions will be made for experienced bowlers by the Tournament Committee.</p>
                      <p className="text-xs">The OLDLAND competition is open only to those members who have NOT won a BHBC singles competition.</p>
                      <p className="text-xs font-medium">The FINALS are on Sat 5th and Sun 6th Sep. PLEASE DO NOT enter competitions unless you can participate on those days.</p>
                      <p className="text-xs font-bold text-red-600">The 1st round of TRIPLES is to be played at 10 a.m. on Sunday 24th May, unless an earlier date is agreed by all 6 players.</p>
                      <p className="text-xs">To be eligible to play in the Veterans Mixed, you must be 60 or over on the 1st March.</p>
                      <p className="mt-3 font-medium">Please select each competition you are entering. There is an entry fee of £2.00 per competition.</p>
                    </div>

                    {/* Competition Checkboxes */}
                    <div className="space-y-3">
                      {(() => {
                        const mainToSubKey: Record<string, keyof Renewal> = {
                          drawnPairs: 'drawnPairsSub',
                          australianPairs: 'australianPairsSub',
                          drawnTriples: 'drawnTriplesSub',
                        };
                        const subToMainKey: Record<string, keyof Renewal> = {
                          drawnPairsSub: 'drawnPairs',
                          australianPairsSub: 'australianPairs',
                          drawnTriplesSub: 'drawnTriples',
                        };
                        return (
                          <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[
                          { key: 'mensChampionship', label: "Men's Championship" },
                          { key: 'ladiesMaynard', label: "Ladies' Maynard" },
                          { key: 'mensTwoWood', label: "Men's Two Wood" },
                          { key: 'ladiesTwoWood', label: "Ladies' Two Wood" },
                          { key: 'marriedPairs', label: 'Married Pairs' },
                          { key: 'drawnPairs', label: 'Drawn Pairs' },
                          { key: 'australianPairs', label: 'Australian Pairs' },
                          { key: 'drawnTriples', label: 'Drawn Triples' },
                          { key: 'handicap', label: 'Handicap' },
                          { key: 'oldlands', label: 'Oldlands' },
                          { key: 'veterans', label: 'Veterans (60+)' },
                        ]
                          .filter(({ key }) => canEnterCompetition(key))
                          .map(({ key, label }) => (
                            <div key={key} className="flex items-center">
                              <input
                                type="checkbox"
                                checked={currentRenewal[key as keyof Renewal] as boolean}
                                onChange={(e) => handleChange(key as keyof Renewal, e.target.checked)}
                                disabled={!eligibility.canEnterCompetitions || isFormDisabled || !!(mainToSubKey[key] && currentRenewal[mainToSubKey[key] as keyof Renewal])}
                                className="h-4 w-4 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <label className={`ml-2 text-sm ${
                                !eligibility.canEnterCompetitions ? 'text-gray-400' : 'text-gray-900'
                              }`}>
                                {label}
                              </label>
                            </div>
                          ))}
                      </div>

                      {/* Substitutions (no fee) - Also require 8+ friendlies */}
                      <div className="mt-6 pt-6 border-t">
                        <p className="text-sm font-medium text-gray-700 mb-3">
                          Eligible Players not entering PAIRS and TRIPLES are invited to register as substitutes to be called upon in case of holidays or illness to playing participants. £2.00 will be charged if called upon to play in any competition.
                        </p>
                        <div className="space-y-2">
                          {[
                            { key: 'drawnPairsSub', label: 'Drawn Pairs Substitute' },
                            { key: 'australianPairsSub', label: 'Australian Pairs Substitute' },
                            { key: 'drawnTriplesSub', label: 'Drawn Triples Substitute' },
                          ].map(({ key, label }) => (
                            <div key={key} className="flex items-center">
                              <input
                                type="checkbox"
                                checked={currentRenewal[key as keyof Renewal] as boolean}
                                onChange={(e) => handleChange(key as keyof Renewal, e.target.checked)}
                                disabled={!eligibility.canEnterCompetitions || isFormDisabled || !!(subToMainKey[key] && currentRenewal[subToMainKey[key] as keyof Renewal])}
                                className="h-4 w-4 text-blue-500 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <label className={`ml-2 text-sm ${
                                !eligibility.canEnterCompetitions ? 'text-gray-400' : 'text-gray-900'
                              }`}>
                                {label}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-6 pt-4 border-t flex justify-between items-center">
                        <span className="text-sm font-medium text-gray-700">Competition Fees:</span>
                        <span className="text-lg font-semibold text-blue-500">
                          {formatCurrency(fees.compsFee)}
                        </span>
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Total Fee Section */}
            {currentRenewal?.renewingMembership && (
              <div className="mb-8 bg-blue-50 border-2 border-blue-500 rounded-lg p-6">
                <div className="flex justify-between items-center">
                  <span className="text-xl font-bold text-gray-900">Total Fee Payable:</span>
                  <span className="text-3xl font-bold text-blue-500">
                    {formatCurrency(fees.total)}
                  </span>
                </div>
              </div>
            )}

            {/* Not submitted yet — no payment details until it is, so nobody pays for a draft */}
            {!isLocked && currentRenewal?.renewingMembership && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-gray-700">
                  How to pay will be shown, and emailed to you, once you submit your renewal.
                </p>
              </div>
            )}

            {/* Save / Submit at the bottom of the form too, so nobody has to scroll back up */}
            {isEditing && (
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 mb-6">
                <button
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel changes
                </button>
                {editingRenewing && (
                  <button
                    onClick={() => handleSave('draft')}
                    disabled={isSaving}
                    className="px-4 py-2 bg-white text-blue-700 border border-blue-500 rounded-md hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Save Draft
                  </button>
                )}
                <button
                  onClick={handleSubmitClick}
                  disabled={isSaving || isPayingOnline}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : editingRenewing ? 'Submit Renewal' : 'Save'}
                </button>
                {/* Submit and pay online (spec §11.3a) — this renewal only */}
                {editingRenewing && stripeEnabled && fees.total > 0 && (
                  <button
                    onClick={() => setConfirmPayOpen(true)}
                    disabled={isSaving || isPayingOnline}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isPayingOnline ? 'Opening payment page…' : `Submit and pay ${formatCurrency(fees.total)} online`}
                  </button>
                )}
              </div>
            )}

            {/* Payment Details — once submitted, while payment not yet received */}
            {isLocked && renewal.renewingMembership && !paymentReceived && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <h3 className="text-lg font-medium text-blue-900 mb-3">Payment Details</h3>
                <div className="space-y-1 text-sm text-blue-800">
                  <p><span className="font-medium">Bank:</span> {bankDetails ? bankDetails.bankName : ''}</p>
                  <p><span className="font-medium">Sort Code:</span> {bankDetails ? bankDetails.bankSortCode : ''}</p>
                  <p><span className="font-medium">Account Number:</span> {bankDetails ? bankDetails.bankAccountNumber : ''}</p>
                  <p><span className="font-medium">Account Name:</span> {bankDetails ? bankDetails.bankAccountName : ''}</p>
                  <p><span className="font-medium">Reference:</span> {paymentReference}</p>
                </div>
                <p className="mt-4 text-sm text-blue-700">
                  Please make payment at your earliest convenience. Card payments are also accepted at the bar.
                </p>
                {stripeEnabled && (
                  <button
                    onClick={handlePayOutstanding}
                    disabled={isPayingOnline}
                    className="mt-4 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isPayingOnline ? 'Opening payment page…' : 'Pay online by card'}
                  </button>
                )}
              </div>
            )}

            {/* Payment Received Message */}
            {paymentReceived && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <svg className="h-6 w-6 text-green-600 mr-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <h3 className="text-lg font-medium text-green-900">Payment Received</h3>
                      <p className="text-sm text-green-800 mt-1">
                        Your renewal payment has been received. Thank you.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => router.push('/')}
                    className="ml-4 px-6 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors cursor-pointer"
                  >
                    Return to Home
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        isOpen={voidDialogOpen}
        title={`Void ${profile.fullKnownAs} ${profile.lastName}'s renewal?`}
        message={`This cancels the ${formatCurrency(renewal.totalPayment || fees.total)} owed. It doesn't change their choices, competition entries or 200 Club numbers.`}
        confirmLabel={isVoiding ? 'Voiding…' : 'Void renewal'}
        confirmVariant="danger"
        confirmDisabled={isVoiding || voidReason.trim() === ''}
        onConfirm={handleConfirmVoid}
        onCancel={() => setVoidDialogOpen(false)}
      >
        <div className="mb-4 text-left">
          <label htmlFor="void-reason" className="block text-sm font-medium text-gray-900 mb-1">Reason (required)</label>
          <textarea
            id="void-reason"
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            rows={3}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
          />
          {voidInfo && (voidInfo.attachments.club200Numbers.length > 0 || voidInfo.attachments.competitions.length > 0) && (
            <div className="mt-3 bg-yellow-50 border border-yellow-300 rounded-md p-3 text-sm text-yellow-900">
              <p className="font-medium mb-1">Still attached — the void won&apos;t remove these, so deal with them by hand:</p>
              {voidInfo.attachments.club200Numbers.length > 0 && (
                <p>
                  200 Club {voidInfo.attachments.club200Numbers.length === 1 ? 'number' : 'numbers'}:{' '}
                  <a href="/200-club" className="underline">{voidInfo.attachments.club200Numbers.join(', ')}</a>
                </p>
              )}
              {voidInfo.attachments.competitions.length > 0 && (
                <ul className="mt-1 list-disc list-inside">
                  {voidInfo.attachments.competitions.map((c) => (
                    <li key={c.name}>
                      <a href={`/competitions/${c.compId}`} className="underline">{c.name}</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        isOpen={confirmSubmitOpen}
        title="Submit your renewal?"
        message={`Once submitted, your renewal can't be changed. Total payable: ${formatCurrency(fees.total)}. Submit now?`}
        confirmLabel="Submit Renewal"
        cancelLabel="Not yet"
        onConfirm={handleConfirmSubmit}
        onCancel={() => setConfirmSubmitOpen(false)}
      />

      <ConfirmDialog
        isOpen={confirmPayOpen}
        title="Submit and pay online?"
        message={`You'll go to a secure Stripe page to pay ${formatCurrency(fees.total)} by card. Your renewal is submitted once the payment goes through, and can't be changed after that. If you don't finish paying, it stays as a draft.`}
        confirmLabel="Go to payment"
        cancelLabel="Not yet"
        onConfirm={handleConfirmPay}
        onCancel={() => setConfirmPayOpen(false)}
      />
    </div>
  );
}
