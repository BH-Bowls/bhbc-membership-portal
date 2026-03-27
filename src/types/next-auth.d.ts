// src/types/next-auth.d.ts
// Extend NextAuth types with custom fields

import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    userName: string;
    role: string;
    roles?: string[]; // parsed from role string (computed in JWT callback if absent)
    name: string;
    email: string;
    clubId?: string; // set for Club role logins
    mustChangePassword?: boolean; // true when admin set a temporary password
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      userName: string;
      role: string;
      roles: string[]; // parsed from role string
      clubId?: string; // set for Club role logins
      mustChangePassword?: boolean; // true when admin set a temporary password

      // Impersonation fields
      isImpersonating?: boolean;
      originalAdmin?: {
        userName: string;
        email: string;
        name: string;
        role: string;
        roles: string[];
      };
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userName: string;
    role: string;
    roles: string[]; // parsed from role string
    name: string;
    email: string;
    loginTime: number;
    clubId?: string; // set for Club role logins
    mustChangePassword?: boolean; // true when admin set a temporary password

    // Impersonation fields
    isImpersonating?: boolean;
    originalAdmin?: {
      userName: string;
      email: string;
      name: string;
      role: string;
      roles: string[];
    };
    impersonationStartTime?: number;
    impersonationSessionId?: string;
  }
}
