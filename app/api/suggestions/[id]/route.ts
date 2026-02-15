// app/api/suggestions/[id]/route.ts
// API routes for individual suggestion operations - GET one + PUT update

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getSuggestionById,
  updateSuggestion,
  getAllMembersForCoordinator,
} from '@/lib/suggestions-sheets';
import { getSuggestionStatus } from '@/types/suggestions';

/**
 * GET /api/suggestions/[id]
 * Get single suggestion with access control
 *
 * Access Rules:
 * - Committee members: Full access to all suggestions
 * - Regular members: Can view own suggestions + ongoing/review projects
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: suggestionId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.userName;
    // Check if user is committee member
    // Committee = anyone with a Role that is not "Member" (or empty)
    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

    // Get suggestion
    const suggestion = await getSuggestionById(suggestionId);

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Block non-committee access to committee-only suggestions
    if (!isCommittee && suggestion.committeeOnly === 'Y') {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check access permissions
    const isOwner = suggestion.createdByUsername === userName;
    const isCoordinator = suggestion.coordinatorUsername === userName;

    // Check if member can view this suggestion
    if (!isCommittee) {
      // Regular members can only view:
      // 1. Their own suggestions
      // 2. Ongoing/review projects (accepted and not finished)
      const status = getSuggestionStatus(suggestion);
      const canView = isOwner || status === 'ongoing' || status === 'review';

      if (!canView) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
    }

    // Determine edit permissions
    const canEdit = isCommittee || isCoordinator;
    const canEditAdminFields = isCommittee; // Only committee can edit admin fields
    const canEditCoordinatorFields = isCoordinator; // Coordinator can edit specific fields
    // Owner can edit basic fields (title, description, why) until committee accepts
    const canEditBasicFields = isOwner && suggestion.committeeAcceptance !== 'Y';

    // Get all members for coordinator dropdown (committee only)
    let allMembers: Array<{ userName: string; fullName: string }> = [];
    if (isCommittee) {
      allMembers = await getAllMembersForCoordinator();
    }

    return NextResponse.json({
      suggestion,
      canEdit,
      canEditAdminFields,
      canEditCoordinatorFields,
      canEditBasicFields,
      isCommittee,
      committeeMembers: allMembers,
    });
  } catch (error) {
    console.error(`[GET /api/suggestions/${suggestionId}] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch suggestion' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/suggestions/[id]
 * Update suggestion with field-level permissions
 *
 * Permissions:
 * - Committee members: Can edit all admin fields
 * - Coordinators: Can edit progressNotes, estimatedCost, costQuotesDetails only
 * - Regular members: Cannot edit after submission
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: suggestionId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userName = session.user.userName;
    // Check if user is committee member
    // Committee = anyone with a Role that is not "Member" (or empty)
    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

    // Get existing suggestion
    const suggestion = await getSuggestionById(suggestionId);

    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Check permissions
    const isOwner = suggestion.createdByUsername === userName;
    const isCoordinator = suggestion.coordinatorUsername === userName;
    const canEditBasicFields = isOwner && suggestion.committeeAcceptance !== 'Y';

    if (!isCommittee && !isCoordinator && !canEditBasicFields) {
      return NextResponse.json(
        { error: 'Access denied - only committee members, assigned coordinators, and suggestion owners (before acceptance) can edit suggestions' },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Define allowed fields based on role
    let allowedFields: string[] = [];

    if (isCommittee) {
      // Committee can edit all admin fields
      // Note: coordinatorFullName is computed from coordinatorUsername, not stored
      allowedFields = [
        'committeeOnly',
        'title',
        'description',
        'reasonForImprovement',
        'category',
        'dateReceived',
        'committeeAcceptance',
        'committeeAcceptanceReason',
        'priority',
        'coordinatorUsername',
        'estimatedCost',
        'fundingSource',
        'costQuotesDetails',
        'decision',
        'decisionReason',
        'targetCompletionDate',
        'progressNotes',
        'reviewDate',
        'finalOutcome',
        'dateCompleted',
      ];
    } else if (canEditBasicFields) {
      // Owner can only edit basic fields before acceptance
      allowedFields = ['title', 'description', 'reasonForImprovement'];
    } else if (isCoordinator) {
      // Coordinator can only edit specific progress fields
      allowedFields = ['progressNotes', 'estimatedCost', 'costQuotesDetails'];
    }

    // Filter updates to only allowed fields
    const filteredUpdates: any = {};
    for (const field of allowedFields) {
      if (field in body) {
        filteredUpdates[field] = body[field];
      }
    }

    // Check if any updates were provided
    if (Object.keys(filteredUpdates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // Update suggestion
    const result = await updateSuggestion(
      suggestionId,
      filteredUpdates,
      userName
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update suggestion' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[PUT /api/suggestions/${suggestionId}] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to update suggestion' },
      { status: 500 }
    );
  }
}
