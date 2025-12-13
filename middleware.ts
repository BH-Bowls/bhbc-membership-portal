import { withAuth } from 'next-auth/middleware';

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/((?!api/auth|login|forgot-password|reset-password|_next/static|_next/image|favicon.ico).*)',
  ],
};
