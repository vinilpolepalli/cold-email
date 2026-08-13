import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

// Clerk is optional: with keys set, its middleware powers sign-in (and Gmail
// sending via the user's OAuth token). Without keys the app runs in
// single-user demo mode and nothing is gated.
const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

/**
 * The app itself is private. Only the waitlist landing page and the waitlist
 * signup endpoint are reachable when signed out; every other page redirects
 * there. API routes are left to answer 401 themselves so callers get JSON
 * rather than an HTML redirect.
 */
const PUBLIC_PAGES = new Set(['/']);

export default hasClerk
  ? clerkMiddleware(async (auth, req) => {
      const { pathname } = req.nextUrl;
      if (PUBLIC_PAGES.has(pathname) || pathname.startsWith('/api') || pathname.startsWith('/__clerk')) {
        return NextResponse.next();
      }
      const { userId } = await auth();
      if (!userId) {
        const waitlist = new URL('/', req.url);
        waitlist.searchParams.set('from', pathname);
        return NextResponse.redirect(waitlist);
      }
      return NextResponse.next();
    })
  : () => NextResponse.next();

export const config = {
  matcher: ['/((?!_next|favicon.ico|.*\\.(?:png|jpg|svg|ico|css|js|map)$).*)', '/(api|trpc)(.*)', '/__clerk/:path*'],
};
