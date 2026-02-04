// app/api/renewals/route.ts
// API route for getting and updating user renewals with buddy authorization

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserByUsername } from '@/lib/sheets';
import { updateUserProfile } from '@/lib/profile-sheets';
import {
  getRenewalByUsername,
  updateRenewal,
  calculateFees,
  sendRenewalConfirmation,
  sendCancellationConfirmation,
  type Renewal,
  type FeeBreakdown,
} from '@/lib/renewals-sheets';
import { canManageUser, canEditPaymentFields } from '@/lib/buddies-sheets';

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

    // Get user profile (for age_demographic, friendlies_last_year, member_type)
    const profile = await getUserByUsername(targetUserName);

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found' },
        { status: 404 }
      );
    }

    // Get renewal data
    const renewal = await getRenewalByUsername(targetUserName);

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

    // Calculate current fees
    const fees = calculateFees(
      {
        ageDemographic: profile.ageDemographic,
        memberType: profile.memberType,
        fullTimeEducation: false, // TODO: Add this field to profile if needed
        honorary: profile.honorary,
      },
      renewal
    );

    // Calculate eligibility
    // Allow competitions if:
    // - friendliesLastYear >= 8 (met requirement)
    // - friendliesLastYear === "X" (manual override for illness/exceptional circumstances)
    const friendliesValue = profile.friendliesLastYear;
    const canEnterCompetitions =
      friendliesValue === 'X' ||
      (typeof friendliesValue === 'number' && friendliesValue >= 8);

    const eligibility = {
      canEnterCompetitions,
      friendliesLastYear: friendliesValue,
    };

    return NextResponse.json({
      profile: {
        userName: profile.userName,
        fullKnownAs: profile.fullKnownAs,
        lastName: profile.lastName,
        ageDemographic: profile.ageDemographic,
        memberType: profile.memberType,
        honorary: profile.honorary,
        friendliesLastYear: profile.friendliesLastYear,
        emailAddress: profile.emailAddress,
        title: profile.title,
      },
      renewal: renewalWithVolunteering,
      fees,
      eligibility,
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
    const existingRenewal = await getRenewalByUsername(targetUserName);

    if (!existingRenewal) {
      return NextResponse.json(
        { error: 'Failed to load existing renewal data' },
        { status: 500 }
      );
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
      renewalData
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
        pref200Club: null,
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
      };
    }

    // Update renewal data in Renewals sheet
    const result = await updateRenewal(targetUserName, renewalUpdates);

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
          partialSuccess: true,
          renewal: updatedRenewal,
          fees,
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
          partialSuccess: true,
          renewal: updatedRenewal,
          fees,
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
      renewal: updatedRenewal,
      fees,
      emailSent: true,
      message: data.renewingMembership
        ? 'Renewal submitted successfully. Confirmation email sent.'
        : 'Cancellation confirmed. Confirmation email sent.',
    });
  } catch (error) {
    console.error('Error updating renewal:', error);

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
