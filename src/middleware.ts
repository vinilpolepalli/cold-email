import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

// Clerk is optional: with keys set, its middleware powers Google sign-in
// (and Gmail sending via the user's OAuth token). Without keys the app runs
// in single-user demo mode.
const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

export default hasClerk ? clerkMiddleware() : () => NextResponse.next();

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:png|jpg|svg|ico|css|js|map)$).*)'],
};
