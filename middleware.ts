import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Protect /friendlies/manage routes - Captain or Admin only
    if (pathname.startsWith('/friendlies/manage')) {
      if (!token || !['Captain', 'Admin'].includes(token.role as string)) {
        return NextResponse.redirect(new URL('/friendlies', req.url));
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    '/((?!api/auth|login|forgot-password|reset-password|_next/static|_next/image|favicon.ico).*)',
  ],
};
