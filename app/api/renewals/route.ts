// app/api/renewals/route.ts
// API route for getting and updating user renewals with buddy authorization.
//
// Draft / Submit (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §3): PUT takes
// action: 'draft' | 'submit' | 'reopen' (missing = 'submit', the behaviour before drafts
// existed). Once a renewal is submitted, every further change is refused with 409 — for
// every role, Admin included. The one exception is 'reopen' on a submitted
// "not renewing" renewal (§3.7).
//
// 200 Club numbers (§9): the picks are saved with the draft and given out on Submit;
// if one has gone since the form loaded, Submit is refused (400, club200Taken) and
// nothing is submitted. The price per entry comes from the season's 200 Club settings.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername } from '@/lib/members-supabase';
import { updateUserProfile } from '@/lib/profile-supabase';
import {
  getRenewalByUsername,
  updateRenewal,
  reopenRenewal,
  calculateFees,
  getPaymentReference,
  sendRenewalConfirmation,
  sendRenewalDraftEmail,
  sendCancellationConfirmation,
  RENEWAL_LOCKED_MESSAGE,
  type Renewal,
  type FeeBreakdown,
} from '@/lib/renewals-supabase';
import { canManageUser, canEditPaymentFields } from '@/lib/buddies-supabase';
import { getBankDetails } from '@/lib/bank-details';
import { getCompetitionEligibility } from '@/lib/competition-eligibility';
import { isStripePaymentsEnabled } from '@/lib/stripe';
import { createSubmitCheckout, isCheckoutHeld, reconcileCheckoutSession } from '@/lib/stripe-payments';
import {
  getRenewal200ClubInfo,
  cleanPicks,
  picksTaken,
  takenMessage,
  claimPickedNumbers,
  releaseNumbers,
} from '@/lib/renewals-200-club';

// The competitions that carry an entry and need eligibility (subs are covered too).
const COMPETITION_FIELDS = [
  'mensChampionship', 'ladiesMaynard', 'mensTwoWood', 'ladiesTwoWood',
  'marriedPairs', 'drawnPairs', 'australianPairs', 'drawnTriples',
  'handicap', 'oldlands', 'veterans',
  'drawnPairsSub', 'australianPairsSub', 'drawnTriplesSub',
];

// GET /api/renewals?userName=target
// Returns renewal data + profile data for calculations (buddy system)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get target user from query params (defaults to self)
    const { searchParams } = new URL(request.url);
    const targetUserName = searchParams.get('userName') || session.user.userName;

    // Check authorization (buddy system)
    const canManage = await canManageUser(
      session.user.userName,
      session.user.role,
      targetUserName
    );

    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get user profile (for age_demographic, member_type, competitionsEligibleOverride)
    const profile = await getUserByUsername(targetUserName);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Get renewal data
    let renewal = await getRenewalByUsername(targetUserName);

    // A "Submit and pay online" page was opened for this renewal — check with Stripe in
    // case it was paid (or expired) without the webhook reaching us (§11.3a)
    if (renewal.pendingCheckoutSessionId && (await isStripePaymentsEnabled())) {
      try {
        const outcome = await reconcileCheckoutSession(renewal.pendingCheckoutSessionId);
        if (outcome !== 'waiting') {
          renewal = await getRenewalByUsername(targetUserName);
        }
      } catch (err) {
        console.error('Could not check the pending Stripe payment:', err);
      }
    }

    if (!renewal) {
      return NextResponse.json(
        { error: 'Failed to load renewal data' },
        { status: 500 }
      );
    }

    // Merge volunteering data from profile into renewal object for frontend
    const renewalWithVolunteering = {
      ...renewal,
      drivingAwayMatches: profile.drivingAwayMatches,
      drivingAdditionalInfo: profile.drivingAdditionalInfo,
      greenMaintenance: profile.greenMaintenance,
      greenAdditionalInfo: profile.greenAdditionalInfo,
      barDuty: profile.barDuty,
      barAdditionalInfo: profile.barAdditionalInfo,
      otherSkills: profile.otherSkills,
    };

    const club200 = await getRenewal200ClubInfo(targetUserName);

    // Calculate current fees
    const fees = calculateFees(
      {
        ageDemographic: profile.ageDemographic,
        memberType: profile.memberType,
        fullTimeEducation: false, // TODO: Add this field to profile if needed
        honorary: profile.honorary,
      },
      renewal,
      club200.price
    );

    // Club competitions: available for at least N friendlies last season (counted live
    // from the friendlies data), unless an Admin has set an override for this member.
    const eligibility = await getCompetitionEligibility(targetUserName, profile.competitionsEligibleOverride);

    return NextResponse.json({
      profile: {
        userName: profile.userName,
        fullKnownAs: profile.fullKnownAs,
        lastName: profile.lastName,
        ageDemographic: profile.ageDemographic,
        memberType: profile.memberType,
        honorary: profile.honorary,
        emailAddress: profile.emailAddress,
        title: profile.title,
        printedMembershipBook: profile.printedMembershipBook,
      },
      renewal: renewalWithVolunteering,
      fees,
      eligibility,
      club200,
      bankDetails: await getBankDetails(),
      paymentReference: getPaymentReference(profile.userName),
      stripeEnabled: await isStripePaymentsEnabled(),
      paymentInProgress: isCheckoutHeld(renewal.pendingCheckoutSessionId, renewal.pendingCheckoutExpiresAt),
      managedUser: {
        userName: targetUserName,
        isSelf: targetUserName === session.user.userName,
      },
    });
  } catch (error) {
    console.error('Error fetching renewal:', error);
    return NextResponse.json(
      { error: 'Failed to fetch renewal data' },
      { status: 500 }
    );
  }
}

// PUT /api/renewals
// Updates renewal data and sends confirmation email (buddy system)
export async function PUT(request: NextRequest) {
  // Track what we've updated for error reporting (partial success handling)
  let profileUpdated = false;
  let renewalUpdated = false;
  let emailSent = false;
  // 200 Club numbers given out by this Submit — taken back if the Submit then fails
  let claimedNumbers: string[] = [];
  let claimedFor = '';

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const data = await request.json();
    const targetUserName = data.userName || session.user.userName;

    // Check authorization (buddy system)
    const canManage = await canManageUser(
      session.user.userName,
      session.user.role,
      targetUserName
    );

    if (!canManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get user profile for fee calculation
    const profile = await getUserByUsername(targetUserName);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Get existing renewal data to preserve partial payments
    let existingRenewal = await getRenewalByUsername(targetUserName);

    // A held "Submit and pay online" draft: make sure Stripe hasn't already taken the
    // payment before anything is saved over it (it may now be submitted and locked)
    if (existingRenewal.pendingCheckoutSessionId) {
      try {
        const outcome = await reconcileCheckoutSession(existingRenewal.pendingCheckoutSessionId);
        if (outcome !== 'waiting') {
          existingRenewal = await getRenewalByUsername(targetUserName);
        }
      } catch (err) {
        console.error('Could not check the pending Stripe payment:', err);
        return NextResponse.json(
          { error: 'Could not check the online payment for this renewal. Please try again in a moment.', paymentInProgress: true },
          { status: 409 }
        );
      }
    }

    if (!existingRenewal) {
      return NextResponse.json(
        { error: 'Failed to load existing renewal data' },
        { status: 500 }
      );
    }

    let action: 'draft' | 'submit' | 'reopen' | 'pay' = 'submit';
    if (data.action === 'draft' || data.action === 'reopen' || data.action === 'pay') {
      action = data.action;
    }

    // While a "Submit and pay online" page is open the draft is held, so the amount being
    // paid can't drift from the form (§11.3a). An expired hold is simply released below.
    if (isCheckoutHeld(existingRenewal.pendingCheckoutSessionId, existingRenewal.pendingCheckoutExpiresAt)) {
      return NextResponse.json(
        { error: 'An online payment for this renewal is in progress. Finish or cancel it on the payment page first.', paymentInProgress: true },
        { status: 409 }
      );
    }

    // Reopen a submitted "not renewing" renewal back to a draft (§3.7). Nothing else
    // in the request is saved — the member edits and submits it again as normal.
    if (action === 'reopen') {
      const reopenResult = await reopenRenewal(targetUserName);
      if (!reopenResult.success) {
        return NextResponse.json({ error: reopenResult.error }, { status: 409 });
      }
      const reopenedRenewal = await getRenewalByUsername(targetUserName);
      return NextResponse.json({
        success: true,
        reopened: true,
        renewal: reopenedRenewal,
        message: 'Your renewal has been reopened as a draft.',
      });
    }

    // The lock: a submitted renewal can't be changed by anyone (§3.4). updateRenewal's
    // onlyIfDraft below re-checks this inside the UPDATE itself, in case two saves race.
    if (existingRenewal.submittedAt) {
      return NextResponse.json({ error: RENEWAL_LOCKED_MESSAGE, locked: true }, { status: 409 });
    }

    if (data.renewingMembership !== true && data.renewingMembership !== false) {
      return NextResponse.json(
        { error: 'Please choose whether you are renewing or cancelling your membership.' },
        { status: 400 }
      );
    }

    // Not renewing has no draft stage — it always submits (§3.3).
    const isSubmit = action === 'submit' || data.renewingMembership === false;
    // "Submit and pay online" (§11.3a): every Submit check runs, but it's saved as a draft
    // and only submitted by the Stripe webhook once the payment has gone through.
    const isPay = action === 'pay' && data.renewingMembership === true;
    if (isPay && !(await isStripePaymentsEnabled())) {
      return NextResponse.json({ error: 'Online payments are not available.' }, { status: 400 });
    }

    if ((isSubmit || isPay) && data.renewingMembership === true
      && data.printedMembershipBook !== true && data.printedMembershipBook !== false) {
      return NextResponse.json(
        { error: 'Please say whether you would like a printed membership book.' },
        { status: 400 }
      );
    }

    // Competition entries need eligibility — checked here, not just by the form's
    // disabled checkboxes.
    if (data.renewingMembership === true) {
      let anyCompetition = false;
      for (const field of COMPETITION_FIELDS) {
        if (data[field] === true) anyCompetition = true;
      }
      if (anyCompetition) {
        const eligibility = await getCompetitionEligibility(targetUserName, profile.competitionsEligibleOverride);
        if (!eligibility.canEnterCompetitions) {
          return NextResponse.json(
            { error: `Competition entries need ${eligibility.friendliesRequired} friendlies in ${eligibility.previousSeasonYear}. Please untick the competitions, or contact BHBC if you think this is wrong.` },
            { status: 400 }
          );
        }
      }
    }

    // 200 Club (§9): entries need the season's settings row; picks must be real, free numbers
    const club200 = await getRenewal200ClubInfo(targetUserName);
    let club200Picks: string[] = [];
    if (data.renewingMembership === true) {
      const entries = Number(data.number200ClubEntries) || 0;
      if (entries > 0 && !club200.open) {
        return NextResponse.json(
          { error: `200 Club entries for ${club200.season} are not open yet. Please set the number of entries to 0.` },
          { status: 400 }
        );
      }
      const cleaned = cleanPicks(data.club200PickedNumbers, entries, club200);
      if (cleaned.error) {
        return NextResponse.json({ error: cleaned.error }, { status: 400 });
      }
      club200Picks = cleaned.picks;
      if (isSubmit || isPay) {
        const taken = picksTaken(club200Picks, club200);
        if (taken.length > 0) {
          return NextResponse.json({ error: takenMessage(taken), club200Taken: taken, club200 }, { status: 400 });
        }
      }
    }

    // Who actually pressed Submit — the real Admin when impersonating, never the member.
    let submittedBy = session.user.userName;
    if (session.user.isImpersonating && session.user.originalAdmin && session.user.originalAdmin.userName) {
      submittedBy = session.user.originalAdmin.userName;
    }

    // Split data: volunteering fields + demographics go to Users sheet, rest goes to Renewals sheet
    const volunteeringFields: Record<string, any> = {
      drivingAwayMatches: data.drivingAwayMatches,
      drivingAdditionalInfo: data.drivingAdditionalInfo,
      greenMaintenance: data.greenMaintenance,
      greenAdditionalInfo: data.greenAdditionalInfo,
      barDuty: data.barDuty,
      barAdditionalInfo: data.barAdditionalInfo,
      otherSkills: data.otherSkills,
    };

    // Also sync age demographic and member type to Members sheet if provided
    if (data.ageDemographic) {
      volunteeringFields.ageDemographic = data.ageDemographic;
    }
    if (data.memberType) {
      volunteeringFields.memberType = data.memberType;
    }
    // Printed membership book is a standing preference on the member, not the renewal
    // (§3.8) — only asked when renewing, so "not renewing" leaves it unchanged.
    if (data.renewingMembership === true
      && (data.printedMembershipBook === true || data.printedMembershipBook === false)) {
      volunteeringFields.printedMembershipBook = data.printedMembershipBook;
    }

    // Remove volunteering fields and demographics from renewal data
    const renewalData = { ...data };
    delete renewalData.userName; // Don't include userName in updates
    delete renewalData.drivingAwayMatches;
    delete renewalData.drivingAdditionalInfo;
    delete renewalData.greenMaintenance;
    delete renewalData.greenAdditionalInfo;
    delete renewalData.barDuty;
    delete renewalData.barAdditionalInfo;
    delete renewalData.otherSkills;
    delete renewalData.ageDemographic; // Don't save to Renewals sheet
    delete renewalData.memberType; // Don't save to Renewals sheet
    delete renewalData.printedMembershipBook; // Saved on the member profile
    delete renewalData.action;
    // Server-controlled — never taken from the browser
    delete renewalData.submittedAt;
    delete renewalData.submittedBy;
    delete renewalData.renewalsClosed;
    delete renewalData.confirmationEmailDate;
    delete renewalData.paidAtSubmission;
    delete renewalData.pendingCheckoutSessionId;
    delete renewalData.pendingCheckoutExpiresAt;
    // 200 Club: the cleaned picks are set below; the old free-text box isn't written any more
    delete renewalData.club200PickedNumbers;
    delete renewalData.pref200Club;

    // Filter payment fields (admin-only edit)
    if (!canEditPaymentFields(session.user.role)) {
      delete renewalData.banking;
      delete renewalData.dateReceived;
    }

    // Calculate fees (use new demographics if provided, otherwise use profile values)
    const fees = calculateFees(
      {
        ageDemographic: data.ageDemographic || profile.ageDemographic,
        memberType: data.memberType || profile.memberType,
        fullTimeEducation: false, // TODO: Add this field to profile if needed
        honorary: profile.honorary,
      },
      renewalData,
      club200.price
    );

    // Update volunteering preferences in Users sheet (profile)
    const profileUpdateResult = await updateUserProfile(
      targetUserName,
      volunteeringFields
    );

    if (!profileUpdateResult.success) {
      return NextResponse.json(
        {
          error: profileUpdateResult.error || 'Failed to update volunteering preferences',
          partialSuccess: false,
          profileUpdated: false,
          renewalUpdated: false,
        },
        { status: 400 }
      );
    }

    // Track that profile update succeeded
    profileUpdated = true;

    // Prepare renewal updates
    let renewalUpdates: Partial<Renewal>;

    // If user is NOT renewing, clear all renewal data except renewingMembership
    if (!data.renewingMembership) {
      renewalUpdates = {
        renewingMembership: false,
        playingFees: 0,
        socialFees: 0,
        compsFee: 0,
        fee200Club: 0,
        totalPayment: 0,
        outstanding: 0,
        banking: null,
        dateReceived: null,
        number200ClubEntries: 0,
        club200PickedNumbers: [],
        cleaningDatesToAvoid: null,
        teaDatesToAvoid: null,
        mensChampionship: false,
        ladiesMaynard: false,
        mensTwoWood: false,
        ladiesTwoWood: false,
        marriedPairs: false,
        drawnPairs: false,
        australianPairs: false,
        drawnTriples: false,
        handicap: false,
        oldlands: false,
        veterans: false,
        drawnPairsSub: false,
        australianPairsSub: false,
        drawnTriplesSub: false,
      };
    } else {
      // User IS renewing - calculate fees and prepare normal update
      const effectiveMemberType = data.memberType || profile.memberType;

      // Calculate outstanding amount correctly:
      // - If admin is updating banking amount, use the new amount from renewalData
      // - Otherwise, use existing banking amount to preserve partial payments
      // Formula: outstanding = totalPayment - amountPaid
      const bankingAmount = renewalData.banking !== undefined
        ? renewalData.banking  // Admin is updating payment amount
        : (existingRenewal.banking || 0);  // Use existing payment amount

      const calculatedOutstanding = fees.total - bankingAmount;

      // Ensure outstanding is never negative (can't overpay)
      const validatedOutstanding = Math.max(0, calculatedOutstanding);

      renewalUpdates = {
        ...renewalData,
        playingFees: (effectiveMemberType === 'Playing Lady' || effectiveMemberType === 'Playing Man') ? fees.membershipFee : 0,
        socialFees: (effectiveMemberType === 'Social Lady' || effectiveMemberType === 'Social Man') ? fees.membershipFee : 0,
        compsFee: fees.compsFee,
        fee200Club: fees.club200Fee,
        totalPayment: fees.total,
        outstanding: validatedOutstanding,
        club200PickedNumbers: club200Picks,
      };
    }

    if (isSubmit) {
      renewalUpdates.submittedAt = new Date().toISOString();
      renewalUpdates.submittedBy = submittedBy;
    }
    // Any hold left from an expired "Submit and pay online" page goes with this save
    if (existingRenewal.pendingCheckoutSessionId) {
      renewalUpdates.pendingCheckoutSessionId = null;
      renewalUpdates.pendingCheckoutExpiresAt = null;
    }

    // Give out the picked 200 Club numbers — all or none. Someone may have taken one
    // since the check above; then nothing is submitted.
    if (isSubmit && data.renewingMembership === true && club200Picks.length > 0) {
      const claim = await claimPickedNumbers(targetUserName, club200Picks, false);
      if (claim.taken.length > 0) {
        const fresh = await getRenewal200ClubInfo(targetUserName);
        return NextResponse.json({ error: takenMessage(claim.taken), club200Taken: claim.taken, club200: fresh }, { status: 400 });
      }
      claimedNumbers = claim.claimed;
      claimedFor = targetUserName;
    }

    // Update renewal data — only while it's still a draft (the lock, §3.4)
    const result = await updateRenewal(targetUserName, renewalUpdates, { onlyIfDraft: true });

    if (result.locked || !result.success) {
      await releaseNumbers(claimedFor, claimedNumbers);
      claimedNumbers = [];
    }

    if (result.locked) {
      return NextResponse.json({ error: RENEWAL_LOCKED_MESSAGE, locked: true }, { status: 409 });
    }

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || 'Failed to update renewal',
          partialSuccess: profileUpdated,  // Profile was updated but renewal failed
          profileUpdated,
          renewalUpdated: false,
          message: profileUpdated
            ? 'Profile updated successfully but renewal update failed. Please try again.'
            : 'Failed to update renewal',
        },
        { status: 207 }  // 207 Multi-Status for partial success
      );
    }

    // Track that renewal update succeeded
    renewalUpdated = true;
    claimedNumbers = []; // submitted — the numbers are theirs now

    // Get updated renewal data
    const updatedRenewal = await getRenewalByUsername(targetUserName);

    if (!updatedRenewal) {
      return NextResponse.json(
        { error: 'Failed to retrieve updated renewal' },
        { status: 500 }
      );
    }

    // Get the actual manager's userName for email sending
    // If impersonating, use originalAdmin.userName, otherwise use current user
    const managerUserName = session.user.isImpersonating
      ? session.user.originalAdmin?.userName
      : session.user.userName;

    // Submit and pay online — saved as a draft; send the browser to Stripe. No draft email:
    // the confirmation goes out when the webhook submits it.
    if (isPay) {
      if (fees.total <= 0) {
        return NextResponse.json({ error: 'There is nothing to pay on this renewal — use Submit Renewal.' }, { status: 400 });
      }
      try {
        let memberParam: string | null = null;
        if (data.userName && data.userName.toLowerCase() !== session.user.userName.toLowerCase()) {
          memberParam = targetUserName;
        }
        const checkoutUrl = await createSubmitCheckout({
          payer: submittedBy,
          userName: targetUserName,
          memberParam: memberParam,
        });
        return NextResponse.json({ success: true, submitted: false, checkoutUrl: checkoutUrl, renewal: updatedRenewal, fees });
      } catch (err) {
        console.error('Failed to start Stripe checkout:', err);
        return NextResponse.json(
          { error: 'Your renewal was saved as a draft, but the payment page could not be opened. Please try again, or submit and pay another way.' },
          { status: 502 }
        );
      }
    }

    // Save Draft — the draft email (no bank details, clearly says it isn't submitted)
    if (!isSubmit) {
      const draftEmailResult = await sendRenewalDraftEmail(
        targetUserName,
        updatedRenewal,
        fees,
        data.memberType || profile.memberType,
        managerUserName
      );
      if (!draftEmailResult.success) {
        console.error('Failed to send draft email:', draftEmailResult.error);
      }
      return NextResponse.json({
        success: true,
        submitted: false,
        renewal: updatedRenewal,
        fees,
        emailSent: draftEmailResult.success,
        warning: draftEmailResult.success ? undefined : 'Draft saved but the email could not be sent',
        message: 'Your renewal has been saved as a draft. It is not submitted yet.',
      });
    }

    // Send confirmation email based on renewal status
    if (data.renewingMembership) {
      // Send renewal confirmation email
      const emailResult = await sendRenewalConfirmation(
        targetUserName,
        updatedRenewal,
        fees,
        managerUserName
      );

      if (!emailResult.success) {
        console.error('Failed to send confirmation email:', emailResult.error);
        // Don't fail the request if email fails, just log it
        emailSent = false;
        return NextResponse.json({
          success: true,
          submitted: true,
          partialSuccess: true,
          renewal: updatedRenewal,
          fees,
          club200: await getRenewal200ClubInfo(targetUserName),
          profileUpdated: true,
          renewalUpdated: true,
          emailSent: false,
          warning: 'Renewal saved but confirmation email could not be sent',
        });
      }

      // Track that email was sent successfully
      emailSent = true;
    } else {
      // Send cancellation confirmation email
      const emailResult = await sendCancellationConfirmation(
        targetUserName,
        managerUserName
      );

      if (!emailResult.success) {
        console.error('Failed to send cancellation email:', emailResult.error);
        // Don't fail the request if email fails, just log it
        emailSent = false;
        return NextResponse.json({
          success: true,
          submitted: true,
          partialSuccess: true,
          renewal: updatedRenewal,
          fees,
          club200: await getRenewal200ClubInfo(targetUserName),
          profileUpdated: true,
          renewalUpdated: true,
          emailSent: false,
          warning: 'Cancellation saved but confirmation email could not be sent',
        });
      }

      // Track that email was sent successfully
      emailSent = true;
    }

    return NextResponse.json({
      success: true,
      submitted: true,
      renewal: updatedRenewal,
      fees,
      club200: await getRenewal200ClubInfo(targetUserName),
      emailSent: true,
      message: data.renewingMembership
        ? 'Renewal submitted successfully. Confirmation email sent.'
        : 'Cancellation confirmed. Confirmation email sent.',
    });
  } catch (error) {
    console.error('Error updating renewal:', error);
    if (claimedNumbers.length > 0) {
      await releaseNumbers(claimedFor, claimedNumbers);
    }

    // Provide detailed error information including what was successfully updated
    const partialSuccess = profileUpdated || renewalUpdated || emailSent;

    return NextResponse.json(
      {
        error: 'Failed to update renewal',
        details: error instanceof Error ? error.message : 'Unknown error',
        partialSuccess,
        profileUpdated,
        renewalUpdated,
        emailSent,
        message: partialSuccess
          ? `Partial update completed. Profile: ${profileUpdated ? 'updated' : 'not updated'}, Renewal: ${renewalUpdated ? 'updated' : 'not updated'}, Email: ${emailSent ? 'sent' : 'not sent'}`
          : 'Fatal error occurred before any updates could be made.',
      },
      { status: partialSuccess ? 207 : 500 }  // 207 Multi-Status for partial success, 500 for complete failure
    );
  }
}
