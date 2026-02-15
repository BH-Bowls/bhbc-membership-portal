// app/api/suggestions/route.ts
// API routes for member suggestions - GET all + POST create

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAllSuggestions,
  createSuggestion,
  getAllMembersForCoordinator,
} from '@/lib/suggestions-sheets';
import { getSuggestionStatus } from '@/types/suggestions';
import type { MemberSuggestion } from '@/types/suggestions';

/**
 * GET /api/suggestions
 * Returns filtered suggestions based on user role
 *
 * Access Rules:
 * - Committee members (Role != "Member"): See all suggestions
 * - Regular members: See own suggestions + ongoing/review projects
 */
export async function GET(request: NextRequest) {
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

    // Get all suggestions from sheet
    const allSuggestions = await getAllSuggestions();

    // Filter suggestions based on role
    const filteredSuggestions = isCommittee
      ? allSuggestions // Committee members see all suggestions
      : allSuggestions.filter((s) => {
          // Hide committee-only suggestions from regular members
          if (s.committeeOnly === 'Y') return false;

          // Regular members can see:
          // 1. Suggestions they created
          if (s.createdByUsername === userName) return true;

          // 2. Ongoing projects (accepted and not finished)
          const status = getSuggestionStatus(s);
          if (status === 'ongoing' || status === 'review') return true;

          return false;
        });

    // Get all members for coordinator dropdown (only for committee)
    let allMembers: Array<{ userName: string; fullName: string }> = [];
    if (isCommittee) {
      allMembers = await getAllMembersForCoordinator();
    }

    return NextResponse.json({
      suggestions: filteredSuggestions,
      isCommittee,
      committeeMembers: allMembers,
    });
  } catch (error) {
    console.error('[GET /api/suggestions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suggestions' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suggestions
 * Create a new suggestion
 *
 * Required fields: title, category, description, reasonForImprovement
 * Authorization: Any logged-in member can create suggestions
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, reasonForImprovement } = body;

    // Validation
    if (!title || !description || !reasonForImprovement) {
      return NextResponse.json(
        { error: 'Missing required fields: title, description, reasonForImprovement' },
        { status: 400 }
      );
    }

    // Determine if creator is a committee member
    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

    // Create suggestion with default category "Other"
    const result = await createSuggestion({
      title,
      category: 'Other',
      description,
      reasonForImprovement,
      createdByUsername: session.user.userName,
      committeeOnly: isCommittee ? 'Y' : '',
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create suggestion' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      suggestionId: result.suggestionId,
    });
  } catch (error) {
    console.error('[POST /api/suggestions] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create suggestion' },
      { status: 500 }
    );
  }
}
