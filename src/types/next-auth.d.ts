// src/types/next-auth.d.ts
// Extend NextAuth types with custom fields

import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    userName: string;
    role: string;
    name: string;
    email: string;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      userName: string;
      role: string;

      // Impersonation fields
      isImpersonating?: boolean;
      originalAdmin?: {
        userName: string;
        email: string;
        name: string;
        role: string;
      };
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userName: string;
    role: string;
    name: string;
    email: string;
    loginTime: number;

    // Impersonation fields
    isImpersonating?: boolean;
    originalAdmin?: {
      userName: string;
      email: string;
      name: string;
      role: string;
    };
    impersonationStartTime?: number;
    impersonationSessionId?: string;
  }
}
