/**
 * NextAuth catch-all API route.
 * Delegates to the shared config in auth/nextauth.config.ts.
 *
 * Route: /api/auth/[...nextauth]
 */
import NextAuth from 'next-auth';
import { authConfig } from '../../../../auth/nextauth.config';

export default NextAuth(authConfig);
