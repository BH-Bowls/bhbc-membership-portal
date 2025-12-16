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
      },
      renewal
    );

    // Calculate eligibility
    const eligibility = {
      canEnterCompetitions: profile.friendliesLastYear >= 8,
      friendliesLastYear: profile.friendliesLastYear,
    };

    return NextResponse.json({
      profile: {
        userName: profile.userName,
        fullKnownAs: profile.fullKnownAs,
        ageDemographic: profile.ageDemographic,
        memberType: profile.memberType,
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

    // Split data: volunteering fields go to Users sheet, rest goes to Renewals sheet
    const volunteeringFields = {
      drivingAwayMatches: data.drivingAwayMatches,
      drivingAdditionalInfo: data.drivingAdditionalInfo,
      greenMaintenance: data.greenMaintenance,
      greenAdditionalInfo: data.greenAdditionalInfo,
      barDuty: data.barDuty,
      barAdditionalInfo: data.barAdditionalInfo,
      otherSkills: data.otherSkills,
    };

    // Remove volunteering fields from renewal data
    const renewalData = { ...data };
    delete renewalData.userName; // Don't include userName in updates
    delete renewalData.drivingAwayMatches;
    delete renewalData.drivingAdditionalInfo;
    delete renewalData.greenMaintenance;
    delete renewalData.greenAdditionalInfo;
    delete renewalData.barDuty;
    delete renewalData.barAdditionalInfo;
    delete renewalData.otherSkills;

    // Filter payment fields (admin-only edit)
    if (!canEditPaymentFields(session.user.role)) {
      delete renewalData.banking;
      delete renewalData.dateReceived;
    }

    // Calculate fees
    const fees = calculateFees(
      {
        ageDemographic: profile.ageDemographic,
        memberType: profile.memberType,
        fullTimeEducation: false, // TODO: Add this field to profile if needed
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
        { error: profileUpdateResult.error || 'Failed to update volunteering preferences' },
        { status: 400 }
      );
    }

    // Prepare renewal updates with calculated fees
    const renewalUpdates: Partial<Renewal> = {
      ...renewalData,
      playingFees: profile.memberType === 'Playing' ? fees.membershipFee : 0,
      socialFees: profile.memberType === 'Social' ? fees.membershipFee : 0,
      compsFee: fees.compsFee,
      fee200Club: fees.club200Fee,
      totalPayment: fees.total,
      outstanding: fees.total,
    };

    // Update renewal data in Renewals sheet
    const result = await updateRenewal(targetUserName, renewalUpdates);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update renewal' },
        { status: 400 }
      );
    }

    // Get updated renewal data
    const updatedRenewal = await getRenewalByUsername(targetUserName);

    if (!updatedRenewal) {
      return NextResponse.json(
        { error: 'Failed to retrieve updated renewal' },
        { status: 500 }
      );
    }

    // Send confirmation email if renewing (to target user, not current user)
    if (data.renewingMembership) {
      const emailResult = await sendRenewalConfirmation(
        targetUserName,
        updatedRenewal,
        fees
      );

      if (!emailResult.success) {
        console.error('Failed to send confirmation email:', emailResult.error);
        // Don't fail the request if email fails, just log it
        return NextResponse.json({
          success: true,
          renewal: updatedRenewal,
          fees,
          warning: 'Renewal saved but confirmation email could not be sent',
        });
      }
    }

    return NextResponse.json({
      success: true,
      renewal: updatedRenewal,
      fees,
      message: data.renewingMembership
        ? 'Renewal submitted successfully. Confirmation email sent.'
        : 'Renewal updated successfully',
    });
  } catch (error) {
    console.error('Error updating renewal:', error);
    return NextResponse.json(
      { error: 'Failed to update renewal' },
      { status: 500 }
    );
  }
}
